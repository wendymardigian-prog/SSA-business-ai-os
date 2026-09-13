-- ============================================================================
-- 00064 — Suma del gasto de IA, en la base
-- ============================================================================
-- Fase 3, Bloque 2a (F25/F29). Los topes de gasto se evaluan ANTES de cada
-- llamada al modelo, sumando cost_usd sobre agent_runs desde el inicio del dia
-- o del mes en la zona del negocio.
--
-- La suma va en SQL y no en la app por un motivo concreto: PostgREST devuelve
-- como maximo 1.000 filas por consulta. Un mes con mas runs que eso sumado del
-- lado de la app da un total por debajo del real, y un tope que subestima el
-- gasto no protege nada. Con sum() el total es exacto y sale del indice
-- (workspace_id, created_at) o (agent_id, created_at) de la 00059.
--
-- Los runs con cost_usd NULL (modelo sin precio cargado) suman 0: no hay un
-- numero mejor, y la pantalla ya avisa que falta el precio.
--
-- Solo service role: el gasto es informacion de Owner/Admin y la evalua el
-- motor del agente, que corre sin usuario.
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sum_ai_spend(
  p_workspace_id uuid,
  p_since        timestamptz,
  p_agent_id     uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(r.cost_usd), 0)
  FROM public.agent_runs r
  WHERE r.workspace_id = p_workspace_id
    AND r.created_at >= p_since
    AND (p_agent_id IS NULL OR r.agent_id = p_agent_id);
$$;

COMMENT ON FUNCTION public.sum_ai_spend(uuid, timestamptz, uuid) IS
  'Gasto de IA en USD desde un instante: de todo el workspace o de un agente. Lo usan los topes de gasto antes de cada llamada. Solo service role.';

REVOKE ALL ON FUNCTION public.sum_ai_spend(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sum_ai_spend(uuid, timestamptz, uuid) TO service_role;
