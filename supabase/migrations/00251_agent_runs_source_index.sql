-- ============================================================
-- 00251 — Indice de agent_runs por origen
-- ============================================================
-- Tres lecturas de Agentes IA y del dashboard de Chat filtran agent_runs por
-- workspace Y origen (`source`), y el unico indice era (workspace_id,
-- created_at): con un workspace con muchas corridas, cada una recorria todo el
-- historial del negocio hasta encontrar una del origen pedido.
--
--   - "el agente actuo alguna vez" (source = 'agent', limit 1): decide si el
--     dashboard de Chat muestra la seccion "El agente" (lib/agent/usage.ts);
--   - la ultima corrida de cada tarea de IA (lib/ai-tasks/task-run-summary.ts);
--   - que origenes tienen corridas, para el filtro de Corridas
--     (lib/agent/runs-query.ts, una consulta limit 1 por origen).
--
-- Aditiva: solo suma un indice. Para volver atras:
--   DROP INDEX IF EXISTS public.idx_agent_runs_workspace_source_created;

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_source_created
  ON public.agent_runs (workspace_id, source, created_at DESC);
