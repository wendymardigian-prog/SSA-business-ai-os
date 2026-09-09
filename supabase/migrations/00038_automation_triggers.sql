-- ============================================================
-- MIGRACION 00038 — TIPOS NUEVOS DE TRIGGER (F3, F4, F5)
-- ============================================================
-- La tabla `triggers` viene de ZernFlow con seis tipos, todos disparados por
-- algo que hace el contacto en el chat: una palabra clave, un boton, el primer
-- mensaje. La Fase 2 suma tres que nacen en otro lado:
--
--   new_contact  — se creo un contacto (por mensaje, por import o a mano)
--   crm_event    — cambio algo del contacto (tag, campo, setter/vendedor,
--                  marca de no contactar)
--   inactivity   — pasaron X horas sin respuesta del lead
--
-- F6 (palabra clave en respuesta a historia) NO suma un tipo: es un filtro
-- adicional adentro del config del trigger `keyword`, que es exactamente como
-- lo pide el requerimiento. Un tipo nuevo ahi seria un duplicado del matcher.
--
-- Lo que crea:
--   1. Los tres tipos nuevos en el CHECK de triggers.type.
--   2. triggers.workspace_id, desnormalizado.
--   3. triggers.updated_at.
--   4. RLS mas estricta: escribir triggers pasa a ser cosa de Owner/Admin.
--   5. La tabla trigger_fires, que resuelve la idempotencia de los tres.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tipos nuevos
-- ------------------------------------------------------------
-- Mismo patron que la 00016 con channels.platform: se tira el CHECK y se
-- rehace, porque Postgres no deja extender uno existente.
ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;

ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (
  type IN (
    'keyword',
    'postback',
    'quick_reply',
    'welcome',
    'default',
    'comment_keyword',
    'new_contact',
    'crm_event',
    'inactivity'
  )
);

-- ------------------------------------------------------------
-- 2. workspace_id desnormalizado
-- ------------------------------------------------------------
-- Hasta ahora al workspace de un trigger se llegaba por join con flows. Para
-- los triggers de mensaje daba igual, porque la consulta ya joineaba flows para
-- filtrar por status. Pero el cron de inactividad y el drenaje de eventos de
-- CRM arrancan al reves —tienen un workspace y buscan sus triggers— y ahi el
-- join es puro peso. Ademas permite escribir la RLS sin subconsulta.
ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS workspace_id uuid
  REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.triggers t
   SET workspace_id = f.workspace_id
  FROM public.flows f
 WHERE f.id = t.flow_id
   AND t.workspace_id IS DISTINCT FROM f.workspace_id;

DO $$
BEGIN
  -- Recien despues del backfill: si quedara alguna fila huerfana, mejor que
  -- falle aca y no en un insert cualquiera dentro de seis meses.
  IF NOT EXISTS (SELECT 1 FROM public.triggers WHERE workspace_id IS NULL) THEN
    ALTER TABLE public.triggers ALTER COLUMN workspace_id SET NOT NULL;
  ELSE
    RAISE WARNING 'Quedan triggers sin workspace_id: la columna queda opcional. Revisar filas huerfanas.';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_triggers_workspace_type
  ON public.triggers(workspace_id, type, is_active);

-- Lo mantiene al dia sin que el codigo tenga que acordarse.
CREATE OR REPLACE FUNCTION public.triggers_set_workspace_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT f.workspace_id INTO NEW.workspace_id
      FROM public.flows f WHERE f.id = NEW.flow_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS triggers_fill_workspace_id ON public.triggers;
CREATE TRIGGER triggers_fill_workspace_id
  BEFORE INSERT OR UPDATE OF flow_id ON public.triggers
  FOR EACH ROW EXECUTE FUNCTION public.triggers_set_workspace_id();

-- ------------------------------------------------------------
-- 3. updated_at
-- ------------------------------------------------------------
ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ------------------------------------------------------------
-- 4. RLS mas estricta
-- ------------------------------------------------------------
-- Las policies que venian de ZernFlow (migracion 00002) daban FOR ALL a
-- cualquier miembro del workspace: un Member podia crear, editar y borrar
-- triggers de cualquier flow. Es incoherente con el resto del sistema, donde
-- crear y publicar flows es cosa de Owner/Admin, y ademas es un agujero: un
-- trigger es lo que decide que automatizacion le contesta a un lead.
DROP POLICY IF EXISTS "Users can view triggers via flow" ON public.triggers;
DROP POLICY IF EXISTS "Users can manage triggers via flow" ON public.triggers;

DROP POLICY IF EXISTS "triggers_select" ON public.triggers;
CREATE POLICY "triggers_select" ON public.triggers
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "triggers_insert" ON public.triggers;
CREATE POLICY "triggers_insert" ON public.triggers
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "triggers_update" ON public.triggers;
CREATE POLICY "triggers_update" ON public.triggers
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "triggers_delete" ON public.triggers;
CREATE POLICY "triggers_delete" ON public.triggers
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 5. Idempotencia de los disparos
-- ------------------------------------------------------------
-- Los tres tipos nuevos necesitan lo mismo: no disparar dos veces por el mismo
-- motivo. Cambia solo que es "el mismo motivo":
--
--   new_contact — el contacto (dispara una vez en la vida)
--   crm_event   — el evento puntual que lo genero
--   inactivity  — la conversacion y la ventana ("conv:<id>:24h")
--
-- Una sola tabla con una clave de deduplicacion que arma quien dispara. El
-- indice unico es lo que garantiza la idempotencia: dos corridas del cron en
-- paralelo chocan en la base, no en la logica.
CREATE TABLE IF NOT EXISTS public.trigger_fires (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id   uuid NOT NULL REFERENCES public.triggers(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  dedupe_key   text NOT NULL,
  contact_id   uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  fired_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.trigger_fires IS
  'Un disparo ya ocurrido. El indice unico sobre (trigger_id, dedupe_key) es lo que impide que un trigger dispare dos veces por el mismo motivo.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_trigger_fires_dedupe
  ON public.trigger_fires(trigger_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_trigger_fires_workspace
  ON public.trigger_fires(workspace_id, fired_at DESC);

ALTER TABLE public.trigger_fires ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trigger_fires_select" ON public.trigger_fires;
CREATE POLICY "trigger_fires_select" ON public.trigger_fires
  FOR SELECT USING (public.is_workspace_member(workspace_id));
-- Escribe solo el motor, con service role. Sin policies de escritura.

-- Los disparos viejos no le sirven a nadie, salvo los de new_contact, que
-- valen para toda la vida del contacto. Se limpian los de mas de 90 dias que
-- tengan una ventana en la clave (los de inactividad).
CREATE OR REPLACE FUNCTION public.purge_trigger_fires(p_retention_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.trigger_fires
  WHERE fired_at < now() - make_interval(days => p_retention_days)
    AND dedupe_key LIKE 'conv:%';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_trigger_fires(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_trigger_fires(integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-purge-trigger-fires') THEN
    PERFORM cron.unschedule('ssa-cron-purge-trigger-fires');
  END IF;
END;
$$;

SELECT cron.schedule(
  'ssa-cron-purge-trigger-fires',
  '30 4 * * *',
  $$SELECT public.purge_trigger_fires(90)$$
);

-- El trigger de inactividad corre por cron cada 15 minutos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-inactivity') THEN
    PERFORM cron.unschedule('ssa-cron-inactivity');
  END IF;
END;
$$;

SELECT cron.schedule(
  'ssa-cron-inactivity',
  '*/15 * * * *',
  $$SELECT private.call_app_cron('inactivity')$$
);
