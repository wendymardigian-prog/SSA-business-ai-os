-- ============================================================================
-- 00112 — Gasto de IA por dia y dispersion de corridas (Bloque A, A1)
-- ============================================================================
-- Las dos consultas que le faltan al mini dashboard de Agentes. Todo lo demas
-- ya existe: agent_runs, agent_run_steps y model_pricing (00059), los
-- privilegios de columna (00060), sum_ai_spend (00064) y ai_cost_report
-- (00069, redefinida en la 00071). ai_cost_report da totales y desgloses por
-- dimension, pero ni una serie temporal: no habia NINGUNA funcion que agrupara
-- cost_usd por fecha.
--
-- Van en SQL y no en la app por los dos motivos de siempre:
--   - PostgREST devuelve como maximo 1.000 filas, y una serie armada del lado
--     de la app con mas corridas que eso da un gasto por debajo del real.
--   - cost_usd y los tokens NO son legibles por `authenticated` (00060): ni un
--     Owner los puede leer con su propio cliente. Solo service role, detras de
--     un guard en TypeScript, igual que sum_ai_spend y ai_cost_report.
--
-- 1. ai_spend_by_day: serie DENSA por dia y origen. Un dia sin corridas vale
--    cero y aparece en su lugar: si faltara, el grafico mentiria la forma (el
--    mismo problema que resolvio la 00110 para las tendencias del Chat). Los
--    origenes salen de los DATOS del rango, no de la lista del CHECK: hay un
--    valor (message_classification_eval) que nadie escribe y apareceria
--    siempre vacio.
--
-- 2. ai_runs_scatter: filas, no agregados, para la dispersion costo/tiempo.
--    Con mas de p_limit corridas se muestrea, pero las de error y las
--    escaladas se conservan TODAS: una dispersion que esconde los errores no
--    sirve para nada. El muestreo es deterministico (una de cada N, pareja en
--    el tiempo): recargar la pantalla no cambia el grafico.
--
-- Las dos, como ai_cost_report:
--   - rango semiabierto [p_from, p_to): la suma de las barras coincide con el
--     total del periodo que da ai_cost_report con el mismo rango;
--   - p_from NULL = desde la primera corrida (el atajo "historico"); p_to
--     NULL = sin techo;
--   - las corridas `running` no entran: todavia no tienen costo;
--   - cost_usd NULL (modelo sin precio) suma 0 y la corrida se cuenta igual.
--     ai_spend_by_day la cuenta ademas en missing_pricing, con la misma
--     definicion que ai_cost_report, para que la pantalla lo avise.
--
-- No altera ninguna tabla ni agrega ningun GRANT de columna: solo funciones.
-- Volver atras:
--   DROP FUNCTION IF EXISTS public.ai_spend_by_day(uuid, timestamptz, timestamptz, text);
--   DROP FUNCTION IF EXISTS public.ai_runs_scatter(uuid, timestamptz, timestamptz, integer);
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. ai_spend_by_day
-- ------------------------------------------------------------
-- Devuelve [{ day: 'YYYY-MM-DD', source, runs, cost_usd, input_tokens,
-- output_tokens, missing_pricing }], un elemento por dia del rango y por cada
-- origen con al menos una corrida en el rango, ordenado por dia y origen.
-- Si el rango no tiene ninguna corrida, devuelve un elemento por dia con
-- source = null y todo en cero: los dias siguen ahi.
CREATE OR REPLACE FUNCTION public.ai_spend_by_day(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_tz           text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH r AS (
    SELECT
      (created_at AT TIME ZONE p_tz)::date AS d,
      source,
      cost_usd,
      input_tokens,
      output_tokens,
      embedding_tokens
    FROM public.agent_runs
    WHERE workspace_id = p_workspace_id
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
      AND status <> 'running'
  ),
  bounds AS (
    SELECT
      COALESCE((p_from AT TIME ZONE p_tz)::date, (SELECT min(d) FROM r)) AS d0,
      -- No hay corridas en el futuro: el ultimo dia es hoy aunque el rango
      -- siga ("este mes" no dibuja los dias que faltan). p_to es abierto: el
      -- ultimo dia es el del instante anterior, asi un p_to justo a la
      -- medianoche no agrega un dia de largo cero al final.
      LEAST(
        COALESCE(((p_to - interval '1 microsecond') AT TIME ZONE p_tz)::date, (now() AT TIME ZONE p_tz)::date),
        (now() AT TIME ZONE p_tz)::date
      ) AS d1
  ),
  days AS (
    -- Todos los dias del periodo, tengan o no corridas.
    SELECT generate_series(d0::timestamp, d1::timestamp, interval '1 day')::date AS d
    FROM bounds
    WHERE d0 IS NOT NULL AND d1 >= d0
  ),
  sources AS (
    SELECT DISTINCT source FROM r
    UNION ALL
    SELECT NULL::text WHERE NOT EXISTS (SELECT 1 FROM r)
  ),
  agg AS (
    SELECT
      d,
      source,
      count(*) AS runs,
      COALESCE(sum(cost_usd), 0) AS cost_usd,
      COALESCE(sum(input_tokens), 0) AS input_tokens,
      COALESCE(sum(output_tokens), 0) AS output_tokens,
      count(*) FILTER (
        WHERE cost_usd IS NULL
          AND (COALESCE(input_tokens, 0) > 0 OR COALESCE(embedding_tokens, 0) > 0)
      ) AS missing_pricing
    FROM r
    GROUP BY d, source
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'day',             to_char(days.d, 'YYYY-MM-DD'),
        'source',          s.source,
        'runs',            COALESCE(a.runs, 0),
        'cost_usd',        COALESCE(a.cost_usd, 0),
        'input_tokens',    COALESCE(a.input_tokens, 0),
        'output_tokens',   COALESCE(a.output_tokens, 0),
        'missing_pricing', COALESCE(a.missing_pricing, 0)
      )
      ORDER BY days.d, s.source
    ),
    '[]'::jsonb
  )
  FROM days
  CROSS JOIN sources s
  LEFT JOIN agg a ON a.d = days.d AND a.source IS NOT DISTINCT FROM s.source;
$$;

COMMENT ON FUNCTION public.ai_spend_by_day(uuid, timestamptz, timestamptz, text) IS
  'Serie densa de gasto de IA por dia (en la zona p_tz) y origen, con los dias sin corridas en cero. Rango [p_from, p_to), sin corridas running. Solo service role.';

-- ------------------------------------------------------------
-- 2. ai_runs_scatter
-- ------------------------------------------------------------
-- Devuelve [{ id, created_at, source, status, cost_usd, latency_ms,
-- input_tokens, total_tokens, conversation_id }] ordenado por created_at.
-- total_tokens suma entrada, salida, cache y embeddings: es el radio del
-- punto, y una corrida de embeddings solo tiene embedding_tokens.
-- Cuantas corridas habia en total lo sabe la pantalla por ai_cost_report
-- (totals.runs, mismo rango): si es mas que el largo de esto, hubo muestreo.
CREATE OR REPLACE FUNCTION public.ai_runs_scatter(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_limit        integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH r AS (
    SELECT
      id, created_at, source, status, cost_usd, latency_ms, input_tokens,
      COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
        + COALESCE(cached_tokens, 0) + COALESCE(embedding_tokens, 0) AS total_tokens,
      conversation_id,
      status IN ('error', 'escalated') AS keep
    FROM public.agent_runs
    WHERE workspace_id = p_workspace_id
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
      AND status <> 'running'
  ),
  quota AS (
    -- Lugar que queda para las que salieron bien despues de conservar todas
    -- las de error y escaladas. Si esas solas pasan p_limit, van igual.
    SELECT
      GREATEST(GREATEST(COALESCE(p_limit, 500), 0) - count(*) FILTER (WHERE keep), 0) AS slots,
      count(*) FILTER (WHERE NOT keep) AS n_ok
    FROM r
  ),
  ok AS (
    SELECT r.*, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM r
    WHERE NOT keep
  ),
  picked AS (
    SELECT id, created_at, source, status, cost_usd, latency_ms, input_tokens, total_tokens, conversation_id
    FROM r
    WHERE keep
    UNION ALL
    -- Una de cada ceil(n_ok / slots), en orden de tiempo: a lo sumo `slots`
    -- filas, repartidas parejo sobre el periodo.
    SELECT ok.id, ok.created_at, ok.source, ok.status, ok.cost_usd, ok.latency_ms,
           ok.input_tokens, ok.total_tokens, ok.conversation_id
    FROM ok, quota q
    WHERE q.n_ok <= q.slots
       OR (q.slots > 0 AND (ok.rn - 1) % ceil(q.n_ok::numeric / q.slots)::bigint = 0)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',              id,
        'created_at',      created_at,
        'source',          source,
        'status',          status,
        'cost_usd',        cost_usd,
        'latency_ms',      latency_ms,
        'input_tokens',    input_tokens,
        'total_tokens',    total_tokens,
        'conversation_id', conversation_id
      )
      ORDER BY created_at, id
    ),
    '[]'::jsonb
  )
  FROM picked;
$$;

COMMENT ON FUNCTION public.ai_runs_scatter(uuid, timestamptz, timestamptz, integer) IS
  'Corridas de IA de un rango [p_from, p_to) para la dispersion costo/tiempo. Con mas de p_limit, conserva todas las de error y escaladas y muestrea las demas, parejo en el tiempo y de forma deterministica. Solo service role.';

-- ------------------------------------------------------------
-- 3. Permisos: solo service role, como sum_ai_spend y ai_cost_report
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ai_spend_by_day(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_spend_by_day(uuid, timestamptz, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.ai_runs_scatter(uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_runs_scatter(uuid, timestamptz, timestamptz, integer) TO service_role;
