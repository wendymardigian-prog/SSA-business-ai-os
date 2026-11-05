-- ============================================================
-- 00292_flow_run_history
-- ============================================================
-- El historial de ejecuciones de una automatizacion (noviembre 2026).
--
-- Hasta ahora `flow_sessions` tenia una fila por ejecucion, pero sin hora de fin,
-- sin motivo y sin el error, y `analytics_events` casi nunca dice a que ejecucion
-- pertenece cada evento. Con eso no se puede contestar "que paso con esta persona".
--
-- Esta migracion:
--   1. Suma `flow_session_steps`: una fila por paso corrido.
--   2. Suma a `flow_sessions`: finished_at, end_reason, error_message,
--      has_failed_step y flow_version.
--   3. Un trigger pone `finished_at` cuando la sesion deja de estar activa: hay
--      diez lugares que cierran sesiones y ninguno tiene que acordarse.
--   4. Un indice para listar las ejecuciones de un flujo.
--   5. `can_see_flow_session` y la politica de lectura nueva: hace falta
--      `flows.view` y, si la ejecucion tiene contacto, poder ver ese contacto.
--   6. `flow_sessions.variables` deja de poder leerse con la sesion: lleva datos
--      personales y copias de los webhooks. La pantalla no la necesita y el motor
--      lee con el cliente de servicio.
--
-- `flow_session_steps` no lleva `contact_id` a proposito: el contacto sale de la
-- sesion, y asi `merge_contacts` y su guardia no cambian.
--
-- Las columnas y la tabla son aditivas. Va ANTES de desplegar el codigo. El motor
-- las escribe en escrituras aparte y en try/catch: sin esta migracion los flujos
-- siguen corriendo, solo que sin historial.
--
-- Sin backfill: lo que corrio antes no tiene hora de fin ni pasos, y reconstruirlo
-- seria adivinar.
--
-- La politica de lectura que se reemplaza (00002_rls_policies):
--
--   create policy "Users can view flow sessions via flow"
--     on flow_sessions for select
--     using (
--       exists (
--         select 1 from flows f
--         where f.id = flow_sessions.flow_id
--           and is_workspace_member(f.workspace_id)
--       )
--     );
--
-- Como volver atras:
--   DROP POLICY IF EXISTS flow_sessions_select ON public.flow_sessions;
--   CREATE POLICY "Users can view flow sessions via flow" ... (la de arriba);
--   GRANT SELECT ON public.flow_sessions TO authenticated;
--   DROP FUNCTION IF EXISTS public.can_see_flow_session(uuid, uuid);
--   DROP TRIGGER IF EXISTS flow_sessions_set_finished_at ON public.flow_sessions;
--   DROP FUNCTION IF EXISTS private.flow_sessions_set_finished_at();
--   DROP INDEX IF EXISTS public.idx_flow_sessions_flow_created;
--   DROP TABLE IF EXISTS public.flow_session_steps;
--   ALTER TABLE public.flow_sessions DROP COLUMN IF EXISTS finished_at,
--     DROP COLUMN IF EXISTS end_reason, DROP COLUMN IF EXISTS error_message,
--     DROP COLUMN IF EXISTS has_failed_step, DROP COLUMN IF EXISTS flow_version;
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas de flow_sessions
-- ------------------------------------------------------------
ALTER TABLE public.flow_sessions ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE public.flow_sessions ADD COLUMN IF NOT EXISTS end_reason text;
ALTER TABLE public.flow_sessions ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.flow_sessions ADD COLUMN IF NOT EXISTS has_failed_step boolean NOT NULL DEFAULT false;
ALTER TABLE public.flow_sessions ADD COLUMN IF NOT EXISTS flow_version integer;

COMMENT ON COLUMN public.flow_sessions.finished_at IS
  'Cuando dejo de estar activa (lo pone un trigger, 00292). Null en lo que sigue corriendo y en lo que termino antes de esta migracion.';
COMMENT ON COLUMN public.flow_sessions.end_reason IS
  'Por que termino, como codigo (lib/flows/runs.ts lo traduce). Lo escribe noteSessionEnd; gana el primero.';
COMMENT ON COLUMN public.flow_sessions.error_message IS
  'El error que corto la ejecucion, saneado: sin emails ni URLs con parametros, hasta 300 caracteres.';
COMMENT ON COLUMN public.flow_sessions.has_failed_step IS
  'Algun paso fallo sin cortar la ejecucion (un mensaje rechazado, por ejemplo).';
COMMENT ON COLUMN public.flow_sessions.flow_version IS
  'La version publicada del flujo con la que arranco.';

-- ------------------------------------------------------------
-- 2. flow_session_steps
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flow_session_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Desempata dos pasos que empezaron en el mismo instante.
  seq          bigint GENERATED ALWAYS AS IDENTITY,
  session_id   uuid NOT NULL REFERENCES public.flow_sessions(id) ON DELETE CASCADE,
  flow_id      uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  node_id      text NOT NULL,
  node_type    text NOT NULL,
  -- Congelado: sobrevive si despues editan o borran el paso.
  node_label   text NOT NULL,
  status       text NOT NULL,
  -- Por donde siguio una condicion o un A/B. La etiqueta, nunca los valores comparados.
  exit_label   text,
  -- Sin datos personales y hasta 300 caracteres: lo garantiza sanitizeRunText.
  reason       text,
  -- Cuando se retoma un paso que quedo esperando o para despues.
  resumes_at   timestamptz,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.flow_session_steps IS
  'Una fila por paso corrido en una ejecucion de una automatizacion (00292). Escribe solo el servidor; se lee con la RLS. Se borra a los 12 meses; la fila de flow_sessions queda.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flow_session_steps_status_values') THEN
    ALTER TABLE public.flow_session_steps ADD CONSTRAINT flow_session_steps_status_values
      CHECK (status IN ('ok', 'failed', 'skipped', 'waiting', 'deferred'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_flow_session_steps_session
  ON public.flow_session_steps(session_id, started_at, seq);
-- La limpieza a los 12 meses.
CREATE INDEX IF NOT EXISTS idx_flow_session_steps_started
  ON public.flow_session_steps(started_at);
CREATE INDEX IF NOT EXISTS idx_flow_session_steps_flow
  ON public.flow_session_steps(flow_id);

-- ------------------------------------------------------------
-- 3. La hora de fin
-- ------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.flow_sessions_set_finished_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status <> 'active' AND NEW.finished_at IS NULL THEN
    NEW.finished_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.flow_sessions_set_finished_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS flow_sessions_set_finished_at ON public.flow_sessions;
CREATE TRIGGER flow_sessions_set_finished_at
  BEFORE UPDATE OF status ON public.flow_sessions
  FOR EACH ROW
  EXECUTE FUNCTION private.flow_sessions_set_finished_at();

-- ------------------------------------------------------------
-- 4. El indice de la lista
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_flow_sessions_flow_created
  ON public.flow_sessions(flow_id, created_at DESC);

-- ------------------------------------------------------------
-- 5. Quien ve que
-- ------------------------------------------------------------
-- Devuelve siempre true o false, nunca NULL.
CREATE OR REPLACE FUNCTION public.can_see_flow_session(p_flow_id uuid, p_contact_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace uuid;
  v_contact   public.contacts;
BEGIN
  SELECT f.workspace_id INTO v_workspace FROM public.flows f WHERE f.id = p_flow_id;
  IF v_workspace IS NULL THEN
    RETURN false;
  END IF;

  IF NOT COALESCE(public.has_permission(v_workspace, 'flows.view'), false) THEN
    RETURN false;
  END IF;

  IF p_contact_id IS NULL THEN
    RETURN true;
  END IF;

  -- Antes de mirar el contacto: uno borrado sigue contando para Owner y Admin.
  IF COALESCE(public.is_workspace_admin(v_workspace), false) THEN
    RETURN true;
  END IF;

  SELECT c.* INTO v_contact FROM public.contacts c WHERE c.id = p_contact_id;
  IF v_contact.id IS NULL THEN
    RETURN false;
  END IF;

  RETURN COALESCE(public.can_see_contact(v_contact), false);
END;
$$;

COMMENT ON FUNCTION public.can_see_flow_session(uuid, uuid) IS
  'Quien ve una ejecucion (00292): flows.view y, si tiene contacto, poder ver ese contacto. Owner y Admin, todo.';

REVOKE ALL ON FUNCTION public.can_see_flow_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_flow_session(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view flow sessions via flow" ON public.flow_sessions;
DROP POLICY IF EXISTS flow_sessions_select ON public.flow_sessions;
CREATE POLICY flow_sessions_select ON public.flow_sessions FOR SELECT
  USING (public.can_see_flow_session(flow_id, contact_id));

ALTER TABLE public.flow_session_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flow_session_steps_select ON public.flow_session_steps;
CREATE POLICY flow_session_steps_select ON public.flow_session_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.flow_sessions s
      WHERE s.id = flow_session_steps.session_id
    )
  );

-- Sin politicas de escritura: escribe solo el servidor.
REVOKE ALL ON TABLE public.flow_session_steps FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.flow_session_steps TO authenticated;
GRANT ALL ON TABLE public.flow_session_steps TO service_role;

-- ------------------------------------------------------------
-- 6. `variables` no se lee con la sesion
-- ------------------------------------------------------------
-- La lista es explicita: una columna nueva de flow_sessions que tenga que leer la
-- pantalla se suma aca.
REVOKE SELECT ON TABLE public.flow_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, flow_id, contact_id, channel_id, status, source_type, source_id,
  current_node_id, waiting_until, waiting_for_input, human_takeover_at,
  created_at, updated_at, finished_at, end_reason, error_message,
  has_failed_step, flow_version
) ON public.flow_sessions TO authenticated;
GRANT SELECT ON TABLE public.flow_sessions TO service_role;
