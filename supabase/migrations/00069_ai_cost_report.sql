-- ============================================================================
-- 00069 — Agregados de costo de IA para la pestana Costos (F29)
-- ============================================================================
-- Fase 3, Bloque 2b. Totales, promedios, desglose por fuente / agente / modelo
-- y top 10 de conversaciones mas caras de un periodo, en UNA consulta.
--
-- Va en SQL y no en la app por el mismo motivo que sum_ai_spend (00064):
-- PostgREST devuelve como maximo 1.000 filas y un mes con mas runs sumado del
-- lado de la app da un total por debajo del real. Y porque GROUP BY con
-- PostgREST no existe: sin esto serian seis consultas y un LIMIT por
-- conversacion imposible de expresar.
--
-- Solo service role: los costos son de Owner/Admin y se leen del servidor
-- detras de requireWorkspaceAdmin(), como quedo en la 00060.
--
-- Los runs con cost_usd NULL (modelo sin precio) suman 0 y se cuentan aparte
-- en missing_pricing para que la pantalla lo avise. Los runs `running` no
-- entran: no tienen costo todavia.
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ai_cost_report(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH r AS (
    SELECT *
    FROM public.agent_runs
    WHERE workspace_id = p_workspace_id
      AND created_at >= p_from
      AND created_at < p_to
      AND status <> 'running'
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'runs',             count(*),
        'cost_usd',         COALESCE(sum(cost_usd), 0),
        'conversations',    count(DISTINCT conversation_id),
        'escalations',      count(*) FILTER (WHERE status = 'escalated'),
        'responded',        count(*) FILTER (WHERE status = 'responded'),
        'missing_pricing',  count(*) FILTER (WHERE cost_usd IS NULL AND (COALESCE(input_tokens, 0) > 0 OR COALESCE(embedding_tokens, 0) > 0)),
        'input_tokens',     COALESCE(sum(input_tokens), 0),
        'output_tokens',    COALESCE(sum(output_tokens), 0),
        'cached_tokens',    COALESCE(sum(cached_tokens), 0),
        'embedding_tokens', COALESCE(sum(embedding_tokens), 0)
      )
      FROM r
    ),
    'by_source', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('source', source, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (SELECT source, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c FROM r GROUP BY source) s
    ),
    'by_agent', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('agent_id', agent_id, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (SELECT agent_id, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c FROM r GROUP BY agent_id) a
    ),
    'by_model', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'provider', provider, 'model', model, 'runs', n, 'cost_usd', c,
        'input_tokens', i, 'output_tokens', o, 'missing_pricing', m
      ) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (
        SELECT provider, model, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c,
               COALESCE(sum(input_tokens), 0) AS i, COALESCE(sum(output_tokens), 0) AS o,
               count(*) FILTER (WHERE cost_usd IS NULL AND COALESCE(input_tokens, 0) > 0) AS m
        FROM r
        WHERE model IS NOT NULL
        GROUP BY provider, model
      ) mo
    ),
    'top_conversations', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('conversation_id', conversation_id, 'contact_id', contact_id, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (
        SELECT conversation_id, max(contact_id::text)::uuid AS contact_id, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c
        FROM r
        WHERE conversation_id IS NOT NULL
        GROUP BY conversation_id
        ORDER BY c DESC, n DESC
        LIMIT 10
      ) t
    )
  );
$$;

COMMENT ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) IS
  'Agregados de costo de IA de un periodo para la pestana Costos: totales, por fuente, por agente, por modelo y top 10 de conversaciones. Solo service role.';

REVOKE ALL ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) TO service_role;
