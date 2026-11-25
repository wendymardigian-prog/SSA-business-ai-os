-- 00515_flow_step_audit.sql
--
-- Automatizaciones auditables (traído de RER-BAIOS #102 el 25/11/2026, sin el paso de empresa). Aditiva e idempotente:
-- puede ir ANTES o DESPUÉS del deploy (el motor anota los pasos sin las columnas nuevas si todavía no existen).
--
-- 1. `flow_session_steps.input` / `.output`: con qué datos corrió cada paso y qué dejó (lib/flow-engine/step-io.ts).
--    Tienen datos personales, así que la sesión del navegador NO las puede leer: el GRANT SELECT de la tabla (00292)
--    pasa a ser por columnas, sin estas dos. Las lee el servidor después de comprobar `flows.edit`
--    (lib/flows/run-audit.ts) y el barrido de 90 días las vacía (lib/webhooks/sweep.ts).
-- 2. `inbound_webhooks.headers`: las cabeceras del envío, ya saneadas (sin secreto, credenciales ni IP;
--    lib/webhooks/headers.ts). Mismo acceso que el payload; se vacían con él a los 90 días.
--
-- La política de lectura de `flow_session_steps` (00292, `can_see_flow_session`) no cambia. `flow_node_stats` (00317,
-- SECURITY INVOKER) solo lee columnas de la lista de abajo.
--
-- Para volver atrás (lo que dejaba la 00292):
--   REVOKE SELECT ON TABLE public.flow_session_steps FROM authenticated;
--   GRANT SELECT ON TABLE public.flow_session_steps TO authenticated;
--   DROP INDEX IF EXISTS public.idx_flow_session_steps_audit_retention;
--   ALTER TABLE public.flow_session_steps DROP COLUMN IF EXISTS input, DROP COLUMN IF EXISTS output;
--   ALTER TABLE public.inbound_webhooks DROP COLUMN IF EXISTS headers;

-- ─── 1. Lo que usó y dejó cada paso ────────────────────────────────────────
ALTER TABLE public.flow_session_steps ADD COLUMN IF NOT EXISTS input jsonb NULL;
ALTER TABLE public.flow_session_steps ADD COLUMN IF NOT EXISTS output jsonb NULL;

COMMENT ON COLUMN public.flow_session_steps.input IS 'Con qué datos corrió el paso (su configuración con las variables reemplazadas). Datos personales: no lo lee la sesión; se vacía a los 90 días. 00515.';
COMMENT ON COLUMN public.flow_session_steps.output IS 'Qué dejó el paso (lo que creó, las variables que cambió, el contacto). Datos personales: no lo lee la sesión; se vacía a los 90 días. 00515.';

-- La sesión lee todas las columnas MENOS input y output. La lista es explícita: una columna nueva que tenga que leer la
-- pantalla se suma acá (lib/flows/run-audit.test.ts compara esta lista con las columnas que pide la pantalla).
REVOKE SELECT ON TABLE public.flow_session_steps FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, seq, session_id, flow_id, node_id, node_type, node_label, status, exit_label, reason,
  resumes_at, started_at, finished_at, error_kind, exit_handle
) ON public.flow_session_steps TO authenticated;
GRANT ALL ON TABLE public.flow_session_steps TO service_role;

CREATE INDEX IF NOT EXISTS idx_flow_session_steps_audit_retention ON public.flow_session_steps (finished_at)
  WHERE input IS NOT NULL OR output IS NOT NULL;

-- ─── 2. Las cabeceras del envío ────────────────────────────────────────────
ALTER TABLE public.inbound_webhooks ADD COLUMN IF NOT EXISTS headers jsonb NULL;
COMMENT ON COLUMN public.inbound_webhooks.headers IS 'Las cabeceras del envío, saneadas (sin secreto, credenciales ni IP). Se vacían con el payload a los 90 días. 00515.';
