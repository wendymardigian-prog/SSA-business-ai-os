-- ============================================================================
-- 00218 — El origen de cada automatización: `source_type` / `source_id`  (Tirón 2, D1)
-- ============================================================================
-- Hoy una sesión de flujo (`flow_sessions`) o un evento (`automation_events`) tiene que traer un contacto, o una
-- persona del equipo, o (solo la sesión) un envío de webhook. Esa lista de excepciones está cableada en un CHECK, y
-- cualquier disparador nuevo sin contacto —Tareas va a sumar «Tarea completada» y «Tarea vencida», con o sin
-- contacto— la rompe: hay que tocar la base cada vez.
--
-- Esta migración suma el ORIGEN, una sola vez y para siempre:
--   source_type  qué la disparó: contact | member | webhook | task | form | booking | sale | call | system
--   source_id    la entidad que la disparó (el envío, el evento, la persona...), como texto
-- y los CHECK pasan a exigir «contacto, o un origen». Es un SUPERCONJUNTO del que había: todo lo que se aceptaba antes
-- se sigue aceptando. `member_user_id` e `inbound_webhook_id` se quedan (el código los usa).
--   - `flow_sessions`: contacto, persona, envío de webhook, o un origen.
--   - `automation_events`: contacto; o una persona del equipo con uno de los tres tipos que ya admitía (`eod_submitted`,
--     `task_completed`, `task_overdue`: un evento de CONTACTO —`tag_added`, `booking_created`…— sin contacto sigue
--     rechazado, aunque traiga una persona); o, lo NUEVO, un evento sin contacto NI persona con un origen declarado
--     (`system`, `task`…). Así un disparador de sistema no necesita tocar la base, y la protección de los eventos de
--     contacto no se pierde.
--
-- El código viejo sigue andando mientras se despliega el nuevo: un trigger BEFORE INSERT completa el origen cuando no
-- viene (webhook si trae envío; persona si trae persona y no contacto; contacto si trae contacto). Las filas que ya
-- existen se completan con el mismo criterio. Todo antes de recrear el CHECK.
--
-- Orden: se aplica ANTES de desplegar el código (el motor nuevo escribe `source_type`). Es aditiva.
--
-- DEFINICIONES VIGENTES (leídas con pg_get_constraintdef el 14/10/2026), para volver atrás:
--   flow_sessions_contact_or_member (flow_sessions):
--     CHECK (((contact_id IS NOT NULL) OR (member_user_id IS NOT NULL) OR (inbound_webhook_id IS NOT NULL)))
--   automation_events_contact_or_member (automation_events):
--     CHECK (((contact_id IS NOT NULL) OR ((event_type = ANY (ARRAY['eod_submitted'::text, 'task_completed'::text, 'task_overdue'::text])) AND (member_user_id IS NOT NULL))))
--
-- Como volver atras:
--   ALTER TABLE public.flow_sessions ADD CONSTRAINT flow_sessions_contact_or_member
--     CHECK (((contact_id IS NOT NULL) OR (member_user_id IS NOT NULL) OR (inbound_webhook_id IS NOT NULL)));
--   ALTER TABLE public.automation_events ADD CONSTRAINT automation_events_contact_or_member
--     CHECK (((contact_id IS NOT NULL) OR ((event_type = ANY (ARRAY['eod_submitted'::text, 'task_completed'::text, 'task_overdue'::text])) AND (member_user_id IS NOT NULL))));
--   ALTER TABLE public.flow_sessions DROP CONSTRAINT IF EXISTS flow_sessions_contact_or_source;
--   ALTER TABLE public.automation_events DROP CONSTRAINT IF EXISTS automation_events_contact_or_source;
--   (un evento con origen y sin contacto ni persona que ya se haya guardado impediria recrear el viejo: borrarlo antes)
--   DROP TRIGGER IF EXISTS fill_source_before_insert ON public.flow_sessions;
--   DROP TRIGGER IF EXISTS fill_source_before_insert ON public.automation_events;
--   DROP FUNCTION IF EXISTS private.fill_automation_source();
--   ALTER TABLE public.flow_sessions DROP CONSTRAINT IF EXISTS flow_sessions_source_type_check, DROP COLUMN IF EXISTS source_type, DROP COLUMN IF EXISTS source_id;
--   ALTER TABLE public.automation_events DROP CONSTRAINT IF EXISTS automation_events_source_type_check, DROP COLUMN IF EXISTS source_type, DROP COLUMN IF EXISTS source_id;
-- Riesgo: bajo (aditiva e idempotente; el CHECK nuevo acepta todo lo que aceptaba el viejo).
-- ============================================================================

SET search_path = '';

-- ------------------------------------------------------------
-- 1. Las columnas
-- ------------------------------------------------------------
ALTER TABLE public.flow_sessions
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id text;

ALTER TABLE public.automation_events
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id text;

COMMENT ON COLUMN public.flow_sessions.source_type IS
  'Que disparo la sesion (00218): contact | member | webhook | task | form | booking | sale | call | system. Una sesion sin contacto lo exige.';
COMMENT ON COLUMN public.flow_sessions.source_id IS 'La entidad que disparo la sesion (el envio, el evento, la persona...), como texto.';
COMMENT ON COLUMN public.automation_events.source_type IS
  'Que origino el evento (00218). Un evento sin contacto lo exige: la base lo completa para contacto y persona.';
COMMENT ON COLUMN public.automation_events.source_id IS 'La entidad que origino el evento, como texto.';

-- ------------------------------------------------------------
-- 2. Los valores admitidos (la misma lista que `AUTOMATION_SOURCE_TYPES` en lib/flow-engine/registry/types.ts)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flow_sessions_source_type_check' AND conrelid = 'public.flow_sessions'::regclass) THEN
    ALTER TABLE public.flow_sessions ADD CONSTRAINT flow_sessions_source_type_check
      CHECK (source_type IS NULL OR source_type IN ('contact', 'member', 'webhook', 'task', 'form', 'booking', 'sale', 'call', 'system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_events_source_type_check' AND conrelid = 'public.automation_events'::regclass) THEN
    ALTER TABLE public.automation_events ADD CONSTRAINT automation_events_source_type_check
      CHECK (source_type IS NULL OR source_type IN ('contact', 'member', 'webhook', 'task', 'form', 'booking', 'sale', 'call', 'system'));
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Lo que ya existe se completa con el mismo criterio que usa el trigger de abajo
-- ------------------------------------------------------------
UPDATE public.flow_sessions
   SET source_type = CASE
         WHEN inbound_webhook_id IS NOT NULL THEN 'webhook'
         WHEN member_user_id IS NOT NULL AND contact_id IS NULL THEN 'member'
         WHEN contact_id IS NOT NULL THEN 'contact'
         WHEN member_user_id IS NOT NULL THEN 'member'
       END,
       source_id = CASE
         WHEN inbound_webhook_id IS NOT NULL THEN inbound_webhook_id::text
         WHEN member_user_id IS NOT NULL AND contact_id IS NULL THEN member_user_id::text
         WHEN contact_id IS NOT NULL THEN contact_id::text
         WHEN member_user_id IS NOT NULL THEN member_user_id::text
       END
 WHERE source_type IS NULL;

UPDATE public.automation_events
   SET source_type = CASE
         WHEN member_user_id IS NOT NULL AND contact_id IS NULL THEN 'member'
         WHEN contact_id IS NOT NULL THEN 'contact'
         WHEN member_user_id IS NOT NULL THEN 'member'
       END,
       source_id = CASE
         WHEN member_user_id IS NOT NULL AND contact_id IS NULL THEN member_user_id::text
         WHEN contact_id IS NOT NULL THEN contact_id::text
         WHEN member_user_id IS NOT NULL THEN member_user_id::text
       END
 WHERE source_type IS NULL;

-- ------------------------------------------------------------
-- 4. El origen por defecto: el codigo viejo (y los emisores en SQL, como el reporte de fin de dia) no lo mandan
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.fill_automation_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  r jsonb := to_jsonb(NEW);
BEGIN
  IF NEW.source_type IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Las dos tablas tienen contacto y persona; solo la sesion tiene envio de webhook (por eso `to_jsonb`).
  IF r ->> 'inbound_webhook_id' IS NOT NULL THEN
    NEW.source_type := 'webhook';
    NEW.source_id := r ->> 'inbound_webhook_id';
  ELSIF NEW.member_user_id IS NOT NULL AND NEW.contact_id IS NULL THEN
    NEW.source_type := 'member';
    NEW.source_id := NEW.member_user_id::text;
  ELSIF NEW.contact_id IS NOT NULL THEN
    NEW.source_type := 'contact';
    NEW.source_id := NEW.contact_id::text;
  ELSIF NEW.member_user_id IS NOT NULL THEN
    NEW.source_type := 'member';
    NEW.source_id := NEW.member_user_id::text;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION private.fill_automation_source() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS fill_source_before_insert ON public.flow_sessions;
CREATE TRIGGER fill_source_before_insert
  BEFORE INSERT ON public.flow_sessions
  FOR EACH ROW EXECUTE FUNCTION private.fill_automation_source();

DROP TRIGGER IF EXISTS fill_source_before_insert ON public.automation_events;
CREATE TRIGGER fill_source_before_insert
  BEFORE INSERT ON public.automation_events
  FOR EACH ROW EXECUTE FUNCTION private.fill_automation_source();

-- ------------------------------------------------------------
-- 5. Los CHECK nuevos: contacto, o un origen. Superconjunto de los viejos.
--    Se crean NOT VALID y se validan (no bloquea escrituras) antes de soltar los viejos.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flow_sessions_contact_or_source' AND conrelid = 'public.flow_sessions'::regclass) THEN
    ALTER TABLE public.flow_sessions ADD CONSTRAINT flow_sessions_contact_or_source
      CHECK (contact_id IS NOT NULL OR member_user_id IS NOT NULL OR inbound_webhook_id IS NOT NULL OR source_type IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- Se recrea siempre (DROP IF EXISTS + ADD): la regla de los eventos de persona vive en esta definicion.
ALTER TABLE public.automation_events DROP CONSTRAINT IF EXISTS automation_events_contact_or_source;
ALTER TABLE public.automation_events ADD CONSTRAINT automation_events_contact_or_source
  CHECK (
    contact_id IS NOT NULL
    OR (member_user_id IS NOT NULL AND event_type = ANY (ARRAY['eod_submitted'::text, 'task_completed'::text, 'task_overdue'::text]))
    OR (member_user_id IS NULL AND source_type IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public.flow_sessions VALIDATE CONSTRAINT flow_sessions_contact_or_source;
ALTER TABLE public.automation_events VALIDATE CONSTRAINT automation_events_contact_or_source;

ALTER TABLE public.flow_sessions DROP CONSTRAINT IF EXISTS flow_sessions_contact_or_member;
ALTER TABLE public.automation_events DROP CONSTRAINT IF EXISTS automation_events_contact_or_member;
