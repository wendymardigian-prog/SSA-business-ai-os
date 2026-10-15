-- ============================================================================
-- 00222 — Un paso no manda dos veces al mismo número en la misma sesión  (Tirón 2, D3)
-- ============================================================================
-- El paso «Enviar WhatsApp a un número» (a un número que puede no ser de ningún contacto) necesita una garantía que los
-- demás envíos tienen por la conversación: que un mismo paso, en la misma sesión, nunca mande dos veces al mismo número,
-- aunque el motor reintente el paso o dos procesos lo corran a la vez. Esta tabla es esa garantía:
--
--   public.flow_send_claims (session_id, node_id, target)   UNIQUE
--
-- El paso inserta su fila ANTES de mandar; si la fila ya existía (error 23505), no manda. Es una reserva, no un
-- historial: la fila se borra sola cuando se borra la sesión (ON DELETE CASCADE, y el barrido de webhooks borra las
-- sesiones viejas).
--
-- - Solo la escribe el servidor: RLS activada y SIN policies (service_role se salta la RLS; la app no la toca).
-- - `target` es el número ya normalizado ("+<dígitos>"); no se guarda el texto del mensaje.
--
-- Como volver atras: DROP TABLE IF EXISTS public.flow_send_claims;
-- Riesgo: bajo (aditiva: una tabla nueva y chica; nada la lee salvo el paso nuevo).
-- ============================================================================

SET search_path = '';

CREATE TABLE IF NOT EXISTS public.flow_send_claims (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id   uuid        NOT NULL REFERENCES public.flow_sessions(id) ON DELETE CASCADE,
  node_id      text        NOT NULL,
  target       text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_flow_send_claims UNIQUE (session_id, node_id, target)
);

CREATE INDEX IF NOT EXISTS idx_flow_send_claims_workspace ON public.flow_send_claims (workspace_id, created_at);

ALTER TABLE public.flow_send_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flow_send_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.flow_send_claims TO service_role;
