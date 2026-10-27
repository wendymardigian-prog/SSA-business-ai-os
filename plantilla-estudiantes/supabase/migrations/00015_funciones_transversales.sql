-- ============================================================================
-- Funciones transversales
--
-- Funciones que cruzan varias areas: fusionar dos contactos (en una sola
-- transaccion: mueve conversaciones, etiquetas, campos, secuencias, atribucion, reuniones
-- y el resto de lo que cuelga del contacto) y los tableros del chat y de costos de IA,
-- que leen conversaciones, mensajes, corridas del agente e historial a la vez.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_cost_report(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH r AS (
    SELECT *
    FROM public.agent_runs
    WHERE workspace_id = p_workspace_id
      AND created_at >= p_from
      AND created_at < p_to
      AND status <> 'running'
  ),
  rd AS (
    SELECT r.id, r.cost_usd, d.status AS draft_status, d.body, d.sent_body
    FROM r
    JOIN public.agent_drafts d ON d.run_id = r.id
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'runs',             count(*),
        'cost_usd',         COALESCE(sum(cost_usd), 0),
        'conversations',    count(DISTINCT conversation_id),
        'escalations',      count(*) FILTER (WHERE status = 'escalated'),
        'responded',        count(*) FILTER (WHERE status = 'responded'),
        'drafted',          count(*) FILTER (WHERE status = 'drafted'),
        'missing_pricing',  count(*) FILTER (WHERE cost_usd IS NULL AND (COALESCE(input_tokens, 0) > 0 OR COALESCE(embedding_tokens, 0) > 0)),
        'input_tokens',     COALESCE(sum(input_tokens), 0),
        'output_tokens',    COALESCE(sum(output_tokens), 0),
        'cached_tokens',    COALESCE(sum(cached_tokens), 0),
        'embedding_tokens', COALESCE(sum(embedding_tokens), 0)
      )
      FROM r
    ),
    'drafts', (
      SELECT jsonb_build_object(
        'discarded',          count(*) FILTER (WHERE draft_status = 'discarded'),
        'discarded_cost_usd', COALESCE(sum(cost_usd) FILTER (WHERE draft_status = 'discarded'), 0),
        'sent',               count(*) FILTER (WHERE draft_status = 'sent'),
        'sent_unedited',      count(*) FILTER (WHERE draft_status = 'sent' AND sent_body = body)
      )
      FROM rd
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
$function$;
COMMENT ON FUNCTION public.ai_cost_report(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) IS 'Agregados de costo de IA de un periodo para la pestana Costos: totales, borradores (descartados y su gasto, enviados sin editar), por fuente, por agente, por modelo y top 10 de conversaciones. Solo service role.';
REVOKE ALL ON FUNCTION public.ai_cost_report(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_runs_scatter(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
COMMENT ON FUNCTION public.ai_runs_scatter(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer) IS 'Corridas de IA de un rango [p_from, p_to) para la dispersion costo/tiempo. Con mas de p_limit, conserva todas las de error y escaladas y muestrea las demas, parejo en el tiempo y de forma deterministica. Solo service role.';
REVOKE ALL ON FUNCTION public.ai_runs_scatter(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_spend_by_day(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_tz text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
COMMENT ON FUNCTION public.ai_spend_by_day(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_tz text) IS 'Serie densa de gasto de IA por dia (en la zona p_tz) y origen, con los dias sin corridas en cero. Rango [p_from, p_to), sin corridas running. Solo service role.';
REVOKE ALL ON FUNCTION public.ai_spend_by_day(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_tz text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chat_author_match(p_author text, p_origin text, p_sent_by_user uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_author IS NULL OR p_author = 'all' THEN true
    WHEN p_author = 'automations' THEN p_origin IN ('flow', 'sequence', 'broadcast')
    WHEN p_author IN ('agent', 'user', 'external') THEN p_origin = p_author
    WHEN p_author ~ '^[0-9a-f-]{36}$' THEN p_sent_by_user::text = p_author
    ELSE false
  END;
$function$;
REVOKE ALL ON FUNCTION public.chat_author_match(p_author text, p_origin text, p_sent_by_user uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_agent_actions(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(action text, actions bigint, reverted bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT al.action, COUNT(*), COUNT(*) FILTER (WHERE al.reverted_at IS NOT NULL)
  FROM public.audit_log al
  LEFT JOIN public.conversations cv
    ON al.entity_type = 'conversation' AND cv.id = al.entity_id
  WHERE al.workspace_id = p_workspace_id
    AND al.performed_by_agent_id IS NOT NULL
    AND al.entity_type IN ('conversation', 'contact')
    AND (p_from IS NULL OR al.performed_at >= p_from)
    AND (p_to IS NULL OR al.performed_at <= p_to)
    AND (
      (al.entity_type = 'conversation'
        AND cv.id IS NOT NULL AND cv.deleted_at IS NULL
        AND (p_channel IS NULL OR cv.channel_id::text = p_channel OR cv.platform = p_channel))
      OR (al.entity_type = 'contact'
        AND (p_channel IS NULL OR EXISTS (
          SELECT 1 FROM public.conversations c2
          WHERE c2.contact_id = al.entity_id AND c2.deleted_at IS NULL
            AND (c2.channel_id::text = p_channel OR c2.platform = p_channel)
        )))
    )
  GROUP BY al.action
  ORDER BY COUNT(*) DESC;
$function$;
COMMENT ON FUNCTION public.chat_dashboard_agent_actions(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text) IS 'Lo que hizo el agente en el periodo, por tipo de accion, desde audit_log.performed_by_agent_id. Incluye cuantas se revirtieron.';
REVOKE ALL ON FUNCTION public.chat_dashboard_agent_actions(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_drafts(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text, p_tz text DEFAULT 'America/Costa_Rica'::text)
 RETURNS TABLE(approved_unchanged bigint, corrected bigint, answered_manually bigint, discarded bigint, window_missed bigint, agent_median_s numeric, approval_median_s numeric, pending_now bigint, pending_under_6h bigint, missed_last_7d bigint, unedited_weekly jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH d AS (
    SELECT dr.*
    FROM public.agent_drafts dr
    JOIN public.conversations c ON c.id = dr.conversation_id
    WHERE dr.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND dr.status NOT IN ('superseded', 'regenerated')
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  outcome AS (
    SELECT
      CASE
        WHEN status = 'sent' AND sent_body IS NOT DISTINCT FROM body THEN 'approved_unchanged'
        WHEN status = 'sent' THEN 'corrected'
        WHEN window_missed_at IS NOT NULL THEN 'window_missed'
        WHEN status = 'discarded' AND discard_reason = 'auto:manual_reply' THEN 'answered_manually'
        WHEN status = 'discarded' AND COALESCE(discard_reason, '') NOT LIKE 'auto:%' THEN 'discarded'
      END AS kind,
      COALESCE(window_missed_at, decided_at) AS at
    FROM d
  ),
  counted AS (
    SELECT kind, COUNT(*) AS n
    FROM outcome
    WHERE kind IS NOT NULL
      AND (p_from IS NULL OR at >= p_from)
      AND (p_to IS NULL OR at <= p_to)
    GROUP BY kind
  ),
  runs AS (
    SELECT ar.completed_at, ar.inbound_at, ar.responded_at, ar.id
    FROM public.agent_runs ar
    WHERE ar.workspace_id = p_workspace_id
      AND ar.source = 'agent'
      AND ar.inbound_at IS NOT NULL
      AND (p_channel IS NULL OR ar.channel_id::text = p_channel OR EXISTS (
        SELECT 1 FROM public.channels ch WHERE ch.id = ar.channel_id AND ch.platform = p_channel
      ))
  ),
  weeks AS (
    SELECT generate_series(
             date_trunc('week', (now() AT TIME ZONE p_tz)) - interval '7 weeks',
             date_trunc('week', (now() AT TIME ZONE p_tz)),
             interval '1 week'
           )::date AS w
  ),
  weekly AS (
    SELECT weeks.w,
           COUNT(s.id) AS sent,
           COUNT(s.id) FILTER (WHERE s.sent_body IS NOT DISTINCT FROM s.body) AS unedited
    FROM weeks
    LEFT JOIN (
      SELECT id, body, sent_body, date_trunc('week', (decided_at AT TIME ZONE p_tz))::date AS w
      FROM d WHERE status = 'sent' AND decided_at IS NOT NULL
    ) s ON s.w = weeks.w
    GROUP BY weeks.w
  )
  SELECT
    COALESCE((SELECT n FROM counted WHERE kind = 'approved_unchanged'), 0),
    COALESCE((SELECT n FROM counted WHERE kind = 'corrected'), 0),
    COALESCE((SELECT n FROM counted WHERE kind = 'answered_manually'), 0),
    COALESCE((SELECT n FROM counted WHERE kind = 'discarded'), 0),
    COALESCE((SELECT n FROM counted WHERE kind = 'window_missed'), 0),
    -- Lo que tarda el agente: incluye la espera de la rafaga, no es la
    -- velocidad del modelo.
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - inbound_at)))
       FROM runs WHERE completed_at IS NOT NULL
         AND (p_from IS NULL OR completed_at >= p_from) AND (p_to IS NULL OR completed_at <= p_to)),
    -- Lo que tarda la aprobacion: SOLO sobre borradores enviados. Con los de
    -- envio directo adentro (~0 s) la mediana no diria nada.
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.responded_at - r.completed_at)))
       FROM d JOIN runs r ON r.id = d.run_id
       WHERE d.status = 'sent' AND r.responded_at IS NOT NULL AND r.completed_at IS NOT NULL
         AND (p_from IS NULL OR d.decided_at >= p_from) AND (p_to IS NULL OR d.decided_at <= p_to)),
    -- Los tres que NO dependen del periodo: son el estado de ahora, y el aviso
    -- de arriba del dashboard los usa.
    (SELECT COUNT(*) FROM d WHERE status IN ('pending', 'failed')),
    (SELECT COUNT(*) FROM d WHERE status IN ('pending', 'failed')
       AND sendable_until IS NOT NULL AND sendable_until > now()
       AND sendable_until - now() < interval '6 hours'),
    (SELECT COUNT(*) FROM d WHERE window_missed_at >= now() - interval '7 days'),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'week_start', w, 'sent', sent, 'unedited', unedited,
              'pct', ROUND(100.0 * unedited / NULLIF(sent, 0), 1)
            ) ORDER BY w), '[]'::jsonb) FROM weekly);
$function$;
COMMENT ON FUNCTION public.chat_dashboard_drafts(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_tz text) IS 'Aprobacion de respuestas: los cinco resultados excluyentes, las dos medianas, el estado de ahora (pendientes, por vencer, ventanas perdidas) y ocho semanas de aprobados sin cambios.';
REVOKE ALL ON FUNCTION public.chat_dashboard_drafts(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_tz text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_escalation_reasons(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text, p_limit integer DEFAULT 6)
 RETURNS TABLE(reason_key text, reason_label text, origin text, escalations bigint, pct numeric, is_other boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH rows AS (
    SELECT
      COALESCE(al.metadata->>'origin', 'tool') AS origin,
      NULLIF(btrim(COALESCE(al.metadata->>'reason', '')), '') AS reason,
      al.performed_at
    FROM public.audit_log al
    JOIN public.conversations c ON c.id = al.entity_id
    WHERE al.workspace_id = p_workspace_id
      AND al.entity_type = 'conversation'
      AND al.action = 'human_takeover'
      AND al.performed_by_agent_id IS NOT NULL
      AND c.deleted_at IS NULL
      AND (p_from IS NULL OR al.performed_at >= p_from)
      AND (p_to IS NULL OR al.performed_at <= p_to)
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  grouped AS (
    SELECT
      COALESCE(NULLIF(public.normalize_for_grouping(reason), ''), 'sin_motivo') AS reason_key,
      -- La ultima redaccion real: las variantes de escritura ya se juntaron por
      -- la clave normalizada.
      COALESCE((ARRAY_AGG(reason ORDER BY performed_at DESC))[1], 'Sin motivo anotado') AS reason_label,
      (ARRAY_AGG(origin ORDER BY performed_at DESC))[1] AS origin,
      COUNT(*) AS n
    FROM rows
    GROUP BY 1
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY n DESC, reason_key) AS rn, SUM(n) OVER () AS total
    FROM grouped
  )
  SELECT reason_key, reason_label, origin, n,
         ROUND(100.0 * n / NULLIF(total, 0), 1), false
  FROM ranked WHERE rn <= GREATEST(p_limit, 1)
  UNION ALL
  -- Lo que no entra en el top se junta en una fila: veinte motivos de uno no
  -- son informacion, son ruido.
  SELECT 'otros', 'Otros motivos', NULL, SUM(n),
         ROUND(100.0 * SUM(n) / NULLIF(MAX(total), 0), 1), true
  FROM ranked WHERE rn > GREATEST(p_limit, 1)
  HAVING SUM(n) > 0;
$function$;
COMMENT ON FUNCTION public.chat_dashboard_escalation_reasons(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_limit integer) IS 'Derivaciones del agente por motivo. El motivo de una derivacion por herramienta es texto libre del modelo: se agrupa normalizado y se muestra la ultima redaccion.';
REVOKE ALL ON FUNCTION public.chat_dashboard_escalation_reasons(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_limit integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_replies(p_workspace_id uuid, p_category_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(reply_category_id uuid, reply_category_name text, reply_is_fallback boolean, replies bigint, pct_of_replies numeric, outbound_total bigint, outbound_with_reply bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH cat_texts AS (
    SELECT normalized_text FROM public.message_texts
    WHERE workspace_id = p_workspace_id AND direction = 'outbound' AND category_id = p_category_id
  ),
  outs AS (
    SELECT m.id, m.conversation_id, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND m.direction = 'outbound'
      AND c.deleted_at IS NULL
      AND m.text_norm IN (SELECT normalized_text FROM cat_texts)
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  first_in AS (
    -- El PRIMER entrante despues de cada saliente, dentro de 24 h.
    SELECT o.id, fi.text_norm
    FROM outs o
    LEFT JOIN LATERAL (
      SELECT i.text_norm
      FROM public.messages i
      WHERE i.conversation_id = o.conversation_id
        AND i.direction = 'inbound'
        AND i.created_at > o.created_at
        AND i.created_at <= o.created_at + interval '24 hours'
      ORDER BY i.created_at
      LIMIT 1
    ) fi ON true
  ),
  totals AS (
    SELECT COUNT(*) AS total, COUNT(text_norm) AS with_reply FROM first_in
  ),
  grouped AS (
    SELECT it.category_id, COUNT(*) AS n
    FROM first_in f
    LEFT JOIN public.message_texts it
      ON it.workspace_id = p_workspace_id AND it.direction = 'inbound' AND it.normalized_text = f.text_norm
    WHERE f.text_norm IS NOT NULL
    GROUP BY it.category_id
  )
  SELECT
    g.category_id,
    -- Sin categoria todavia: se dice, no se esconde ni se cuenta como otra cosa.
    COALESCE(c.name, 'Sin clasificar todavía'),
    COALESCE(c.is_fallback, false),
    g.n,
    ROUND(100.0 * g.n / NULLIF((SELECT with_reply FROM totals), 0), 1),
    (SELECT total FROM totals),
    (SELECT with_reply FROM totals)
  FROM grouped g
  LEFT JOIN public.message_categories c ON c.id = g.category_id
  ORDER BY g.n DESC;
$function$;
COMMENT ON FUNCTION public.chat_dashboard_replies(p_workspace_id uuid, p_category_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text) IS 'Que le responden a una categoria de salientes: el primer entrante dentro de 24 h, agrupado por su categoria. outbound_total y outbound_with_reply van en cada fila para calcular el "% no respondio" exacto.';
REVOKE ALL ON FUNCTION public.chat_dashboard_replies(p_workspace_id uuid, p_category_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_rule_results(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(rule_id text, rule_index integer, action text, runs bigint, degraded_to_draft bigint, is_default boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH r AS (
    SELECT
      ar.routing->>'rule_id' AS rule_id,
      NULLIF(ar.routing->>'rule_index', '')::integer AS rule_index,
      ar.routing->>'action' AS action,
      ar.routing->>'refresh' AS refresh
    FROM public.agent_runs ar
    WHERE ar.workspace_id = p_workspace_id
      AND ar.source = 'agent'
      AND ar.routing->>'mode' = 'rules'
      AND ar.routing->>'action' IN ('send', 'draft', 'skip')
      AND (p_from IS NULL OR ar.created_at >= p_from)
      AND (p_to IS NULL OR ar.created_at <= p_to)
      AND (p_channel IS NULL OR ar.channel_id::text = p_channel OR EXISTS (
        SELECT 1 FROM public.channels ch WHERE ch.id = ar.channel_id AND ch.platform = p_channel
      ))
  )
  SELECT rule_id, MIN(rule_index)::integer, action, COUNT(*),
         -- Un "enviar directo" que se degrado a borrador porque el refresco
         -- contra Zernio fallo: la regla decidio una cosa y paso otra.
         COUNT(*) FILTER (WHERE action = 'send' AND refresh = 'failed'),
         rule_id IS NULL
  FROM r
  GROUP BY rule_id, action
  ORDER BY MIN(rule_index) NULLS LAST, action;
$function$;
COMMENT ON FUNCTION public.chat_dashboard_rule_results(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text) IS 'Turnos por regla y accion. rule_id NULL = ninguna regla coincidio y decidio la accion por defecto. La app traduce el id a "Regla N": el id nunca se muestra.';
REVOKE ALL ON FUNCTION public.chat_dashboard_rule_results(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_episodes(p_workspace_id uuid, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(conversation_id uuid, contact_id uuid, channel_id uuid, episode_no integer, episode_start timestamp with time zone, first_inbound_at timestamp with time zone, first_outbound_at timestamp with time zone, first_outbound_origin text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH gap AS (
    SELECT COALESCE(MIN(close_after_inactive_hours), 12) AS hours
    FROM public.agents WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
  ),
  msgs AS (
    SELECT m.conversation_id, m.direction, m.origin, m.created_at,
           c.contact_id AS c_contact, c.channel_id AS c_channel
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  ordered AS (
    SELECT *, LAG(created_at) OVER (PARTITION BY conversation_id ORDER BY created_at) AS prev_at
    FROM msgs
  ),
  starts AS (
    SELECT *,
      CASE WHEN direction = 'inbound'
             AND (prev_at IS NULL OR created_at - prev_at > ((SELECT hours FROM gap) || ' hours')::interval)
           THEN 1 ELSE 0 END AS is_start
    FROM ordered
  ),
  numbered AS (
    SELECT *, SUM(is_start) OVER (PARTITION BY conversation_id ORDER BY created_at ROWS UNBOUNDED PRECEDING) AS episode_no
    FROM starts
  )
  SELECT conversation_id,
         c_contact AS contact_id,
         c_channel AS channel_id,
         episode_no::integer,
         MIN(created_at) AS episode_start,
         MIN(created_at) FILTER (WHERE direction = 'inbound') AS first_inbound_at,
         MIN(created_at) FILTER (WHERE direction = 'outbound') AS first_outbound_at,
         (ARRAY_AGG(origin ORDER BY created_at) FILTER (WHERE direction = 'outbound'))[1] AS first_outbound_origin
  FROM numbered
  WHERE episode_no >= 1
  GROUP BY conversation_id, episode_no, c_contact, c_channel;
$function$;
REVOKE ALL ON FUNCTION public.chat_episodes(p_workspace_id uuid, p_channel text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_agent_episode_flags(p_workspace_id uuid, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(conversation_id uuid, episode_no integer, episode_start timestamp with time zone, acted boolean, took_first boolean, escalated boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH ep AS (
    -- El fin del episodio es el arranque del siguiente: sin eso, una accion de
    -- la semana que viene contaria para el episodio de hoy.
    SELECT e.*,
           LEAD(e.episode_start) OVER (PARTITION BY e.conversation_id ORDER BY e.episode_no) AS next_start
    FROM public.chat_episodes(p_workspace_id, p_channel) e
  )
  SELECT
    ep.conversation_id,
    ep.episode_no,
    ep.episode_start,
    (
      ep.first_outbound_origin = 'agent'
      OR EXISTS (
        SELECT 1 FROM public.agent_drafts d
        WHERE d.conversation_id = ep.conversation_id
          AND d.created_at >= ep.episode_start
          AND (ep.next_start IS NULL OR d.created_at < ep.next_start)
      )
      OR EXISTS (
        SELECT 1 FROM public.audit_log al
        WHERE al.entity_id = ep.conversation_id
          AND al.performed_by_agent_id IS NOT NULL
          AND al.performed_at >= ep.episode_start
          AND (ep.next_start IS NULL OR al.performed_at < ep.next_start)
      )
    ) AS acted,
    (ep.first_outbound_origin = 'agent') AS took_first,
    (
      EXISTS (
        SELECT 1 FROM public.agent_runs r
        WHERE r.conversation_id = ep.conversation_id
          AND r.status = 'escalated'
          AND r.created_at >= ep.episode_start
          AND (ep.next_start IS NULL OR r.created_at < ep.next_start)
      )
      OR EXISTS (
        SELECT 1 FROM public.audit_log al2
        WHERE al2.entity_id = ep.conversation_id
          AND al2.action = 'human_takeover'
          AND al2.performed_by_agent_id IS NOT NULL
          AND al2.performed_at >= ep.episode_start
          AND (ep.next_start IS NULL OR al2.performed_at < ep.next_start)
      )
    ) AS escalated
  FROM ep;
$function$;
COMMENT ON FUNCTION public.chat_agent_episode_flags(p_workspace_id uuid, p_channel text) IS 'Por episodio: si el agente actuo, si tomo desde el primer mensaje y si derivo. Fuente unica de los tres numeros y de la serie semanal.';
REVOKE ALL ON FUNCTION public.chat_agent_episode_flags(p_workspace_id uuid, p_channel text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_agent_weekly(p_workspace_id uuid, p_channel text DEFAULT NULL::text, p_tz text DEFAULT 'America/Costa_Rica'::text, p_weeks integer DEFAULT 8)
 RETURNS TABLE(week_start date, new_conversations bigint, acted bigint, took_first bigint, escalated bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH weeks AS (
    SELECT generate_series(
             date_trunc('week', (now() AT TIME ZONE p_tz)) - ((GREATEST(p_weeks, 1) - 1) || ' weeks')::interval,
             date_trunc('week', (now() AT TIME ZONE p_tz)),
             interval '1 week'
           )::date AS w
  ),
  flags AS (
    SELECT date_trunc('week', (episode_start AT TIME ZONE p_tz))::date AS w, acted, took_first, escalated
    FROM public.chat_agent_episode_flags(p_workspace_id, p_channel)
    WHERE episode_start >= (SELECT MIN(w) FROM weeks)
  )
  SELECT
    weeks.w,
    COUNT(f.w),
    COUNT(*) FILTER (WHERE f.acted),
    COUNT(*) FILTER (WHERE f.took_first),
    COUNT(*) FILTER (WHERE f.escalated)
  FROM weeks
  LEFT JOIN flags f ON f.w = weeks.w
  GROUP BY weeks.w
  ORDER BY weeks.w;
$function$;
COMMENT ON FUNCTION public.chat_dashboard_agent_weekly(p_workspace_id uuid, p_channel text, p_tz text, p_weeks integer) IS 'Las tres tasas del agente por semana ISO (lunes), para la mini linea. Una semana sin episodios devuelve 0 y la app la dibuja como hueco, no como 0%.';
REVOKE ALL ON FUNCTION public.chat_dashboard_agent_weekly(p_workspace_id uuid, p_channel text, p_tz text, p_weeks integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_agent(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(new_conversations bigint, agent_acted bigint, agent_took_first bigint, agent_escalated bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE acted),
    COUNT(*) FILTER (WHERE took_first),
    COUNT(*) FILTER (WHERE escalated)
  FROM public.chat_agent_episode_flags(p_workspace_id, p_channel)
  WHERE (p_from IS NULL OR episode_start >= p_from)
    AND (p_to IS NULL OR episode_start <= p_to);
$function$;
REVOKE ALL ON FUNCTION public.chat_dashboard_agent(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_numbers(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text, p_author text DEFAULT NULL::text)
 RETURNS TABLE(new_conversations bigint, messages_in bigint, messages_out bigint, first_response_median_seconds numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH ep AS (
    SELECT e.*,
           LEAD(e.episode_start) OVER (PARTITION BY e.conversation_id ORDER BY e.episode_no) AS next_start
    FROM public.chat_episodes(p_workspace_id, p_channel) e
  ),
  ep_period AS (
    SELECT * FROM ep
    WHERE (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to)
  ),
  msgs AS (
    SELECT m.direction, m.origin, m.sent_by_user_id, m.created_at, m.conversation_id
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
  ),
  ep_touched AS (
    SELECT e.*
    FROM ep_period e
    WHERE p_author IS NULL OR p_author = 'all' OR EXISTS (
      SELECT 1 FROM msgs m
      WHERE m.conversation_id = e.conversation_id
        AND m.direction = 'outbound'
        AND m.created_at >= e.episode_start
        AND (e.next_start IS NULL OR m.created_at < e.next_start)
        AND public.chat_author_match(p_author, m.origin, m.sent_by_user_id)
    )
  )
  SELECT
    (SELECT COUNT(*) FROM ep_touched),
    (SELECT COUNT(*) FROM msgs WHERE direction = 'inbound'),
    (SELECT COUNT(*) FROM msgs WHERE direction = 'outbound'
       AND public.chat_author_match(p_author, origin, sent_by_user_id)),
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_outbound_at - first_inbound_at)))
       FROM ep_touched
       WHERE first_inbound_at IS NOT NULL AND first_outbound_at IS NOT NULL
         AND first_outbound_at >= first_inbound_at);
$function$;
REVOKE ALL ON FUNCTION public.chat_dashboard_numbers(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_author text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_origin_group(p_origin text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_origin = 'agent' THEN 'agent'
    WHEN p_origin IN ('flow', 'sequence', 'broadcast') THEN 'automations'
    WHEN p_origin = 'user' THEN 'team'
    WHEN p_origin = 'external' THEN 'external'
  END;
$function$;
COMMENT ON FUNCTION public.chat_origin_group(p_origin text) IS 'Grupo de autor de un saliente: agent | team | automations | external. NULL para un origin desconocido (no se inventa un grupo).';
REVOKE ALL ON FUNCTION public.chat_origin_group(p_origin text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_first_responder(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(responder text, episodes bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH ep AS (
    SELECT COALESCE(public.chat_origin_group(first_outbound_origin), 'unanswered') AS responder
    FROM public.chat_episodes(p_workspace_id, p_channel)
    WHERE (p_from IS NULL OR episode_start >= p_from)
      AND (p_to IS NULL OR episode_start <= p_to)
  ),
  keys AS (
    SELECT * FROM (VALUES ('agent'), ('automations'), ('team'), ('external'), ('unanswered')) AS k(responder)
  )
  -- Siempre las cinco filas, incluso en cero: la barra necesita saber que ese
  -- pedazo existe y vale cero, que no es lo mismo que no saberlo.
  SELECT keys.responder, COUNT(ep.responder)
  FROM keys
  LEFT JOIN ep ON ep.responder = keys.responder
  GROUP BY keys.responder;
$function$;
COMMENT ON FUNCTION public.chat_dashboard_first_responder(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text) IS 'Episodios del periodo por quien respondio primero, incluido "unanswered". Cinco filas siempre.';
REVOKE ALL ON FUNCTION public.chat_dashboard_first_responder(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_patterns(p_workspace_id uuid, p_direction text, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text, p_author text DEFAULT NULL::text)
 RETURNS TABLE(category_id uuid, category_name text, description text, is_fallback boolean, message_count bigint, text_count bigint, top_author text, reply_rate numeric, rank integer, top_variants jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH msgs AS (
    SELECT
      m.id, m.text, m.text_norm, m.conversation_id, m.created_at,
      CASE
        WHEN m.origin = 'user' THEN COALESCE(m.sent_by_user_id::text, 'user')
        ELSE public.chat_origin_group(m.origin)
      END AS author
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id
      AND m.direction = p_direction
      AND m.text_norm IS NOT NULL
      AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
      -- El filtro de autor solo tiene sentido sobre los salientes: un mensaje
      -- del lead no lo "respondio" nadie.
      AND (p_direction <> 'outbound' OR public.chat_author_match(p_author, m.origin, m.sent_by_user_id))
  ),
  replied AS (
    -- Un saliente "obtuvo respuesta" si el lead escribio algo en las 24 h
    -- siguientes, en la misma conversacion.
    SELECT o.text_norm,
           COUNT(*) AS n,
           COUNT(*) FILTER (WHERE p_direction = 'outbound' AND EXISTS (
             SELECT 1 FROM public.messages i
             WHERE i.conversation_id = o.conversation_id
               AND i.direction = 'inbound'
               AND i.created_at > o.created_at
               AND i.created_at <= o.created_at + interval '24 hours'
           )) AS n_replied
    FROM msgs o
    GROUP BY o.text_norm
  ),
  texts AS (
    SELECT t.id, t.category_id, t.normalized_text, t.sample_text, t.confidence, t.source, t.is_button,
           COALESCE(r.n, 0) AS msg_n,
           COALESCE(r.n_replied, 0) AS msg_replied
    FROM public.message_texts t
    LEFT JOIN replied r ON r.text_norm = t.normalized_text
    WHERE t.workspace_id = p_workspace_id AND t.direction = p_direction
  ),
  cat_author AS (
    -- El autor principal de la categoria: quien manda mas mensajes de ese grupo.
    SELECT category_id, author, n,
           ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY n DESC, author) AS rn
    FROM (
      SELECT t.category_id, m.author, COUNT(*) AS n
      FROM msgs m
      JOIN texts t ON t.normalized_text = m.text_norm
      WHERE m.author IS NOT NULL
      GROUP BY t.category_id, m.author
    ) x
  )
  SELECT
    c.id, c.name, c.description, c.is_fallback,
    COALESCE(SUM(t.msg_n), 0)::bigint AS message_count,
    -- Variantes CON volumen en el periodo: contar las que no aparecieron seria
    -- decir "8 variantes" de algo que este mes se escribio de dos formas.
    COUNT(t.id) FILTER (WHERE t.msg_n > 0)::bigint AS text_count,
    (SELECT ca.author FROM cat_author ca WHERE ca.category_id = c.id AND ca.rn = 1) AS top_author,
    CASE WHEN p_direction = 'outbound'
      THEN ROUND(100.0 * SUM(t.msg_replied) / NULLIF(SUM(t.msg_n), 0), 1)
    END AS reply_rate,
    ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(t.msg_n), 0) DESC, c.name)::integer AS rank,
    COALESCE((
      SELECT jsonb_agg(v ORDER BY n DESC) FROM (
        SELECT jsonb_build_object(
                 'text_id', t2.id,
                 'text', t2.sample_text,
                 'count', t2.msg_n,
                 'confidence', t2.confidence,
                 'source', t2.source,
                 'is_button', t2.is_button,
                 'reply_rate', CASE WHEN p_direction = 'outbound'
                   THEN ROUND(100.0 * t2.msg_replied / NULLIF(t2.msg_n, 0), 1) END,
                 -- "Tambien: …": otras escrituras que la normalizacion junto en
                 -- esta misma fila. Sin esto parece que se escribio siempre igual.
                 'also_spellings', COALESCE((
                   SELECT jsonb_agg(sp.txt ORDER BY sp.n DESC) FROM (
                     SELECT m2.text AS txt, COUNT(*) AS n
                     FROM msgs m2
                     WHERE m2.text_norm = t2.normalized_text
                       AND m2.text IS DISTINCT FROM t2.sample_text
                       -- Un mensaje sin texto (solo un adjunto) comparte el
                       -- normalizado vacio con otros: sin esto, "También: …"
                       -- salia con un null y una cadena vacia adentro.
                       AND m2.text IS NOT NULL
                       AND btrim(m2.text) <> ''
                     GROUP BY m2.text
                     ORDER BY COUNT(*) DESC
                     LIMIT 3
                   ) sp
                 ), '[]'::jsonb)
               ) AS v,
               t2.msg_n AS n
        FROM texts t2
        WHERE t2.category_id IS NOT DISTINCT FROM c.id AND t2.msg_n > 0
        ORDER BY t2.msg_n DESC
        LIMIT 5
      ) top
    ), '[]'::jsonb) AS top_variants
  FROM public.message_categories c
  LEFT JOIN texts t ON t.category_id = c.id
  WHERE c.workspace_id = p_workspace_id AND c.direction = p_direction AND c.archived_at IS NULL
  GROUP BY c.id, c.name, c.description, c.is_fallback
  ORDER BY COALESCE(SUM(t.msg_n), 0) DESC, c.name;
$function$;
COMMENT ON FUNCTION public.chat_dashboard_patterns(p_workspace_id uuid, p_direction text, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_author text) IS 'Categorias con su volumen de MENSAJES (no de textos distintos), autor principal, % que obtuvo respuesta y hasta 5 variantes con su text_id (para "Mover a…"). Respeta los filtros de canal y autor.';
REVOKE ALL ON FUNCTION public.chat_dashboard_patterns(p_workspace_id uuid, p_direction text, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_author text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_team(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(author text, conversations bigint, messages_out bigint, first_response_median_seconds numeric, reply_median_seconds numeric, replies_under_1h_pct numeric, escalations_received bigint, drafts_approved bigint, drafts_approved_unedited_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH ep AS (
    SELECT e.*,
           LEAD(e.episode_start) OVER (PARTITION BY e.conversation_id ORDER BY e.episode_no) AS next_start
    FROM public.chat_episodes(p_workspace_id, p_channel) e
  ),
  msgs AS (
    SELECT
      CASE
        WHEN m.origin = 'user' THEN COALESCE(m.sent_by_user_id::text, 'user')
        ELSE public.chat_origin_group(m.origin)
      END AS author,
      m.conversation_id, m.created_at, m.direction,
      LAG(m.direction) OVER w AS prev_dir,
      LAG(m.created_at) OVER w AS prev_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
    WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.created_at)
  ),
  outs AS (
    SELECT * FROM msgs WHERE direction = 'outbound' AND author IS NOT NULL
  ),
  outs_p AS (
    SELECT * FROM outs
    WHERE (p_from IS NULL OR created_at >= p_from) AND (p_to IS NULL OR created_at <= p_to)
  ),
  sent AS (
    SELECT author, COUNT(*) AS n FROM outs_p GROUP BY author
  ),
  replies AS (
    -- "Respuesta": cada saliente cuyo mensaje anterior es del lead, contado
    -- desde ese entrante.
    SELECT author,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (created_at - prev_at))) AS reply_med,
           ROUND(100.0 * COUNT(*) FILTER (WHERE created_at - prev_at < interval '1 hour') / NULLIF(COUNT(*), 0), 1) AS under1h
    FROM outs_p WHERE prev_dir = 'inbound'
    GROUP BY author
  ),
  author_ep AS (
    -- El primer saliente de cada autor en cada episodio.
    SELECT o.author, o.conversation_id, ep.episode_no, ep.episode_start, ep.first_inbound_at, ep.contact_id,
           MIN(o.created_at) AS author_first_out,
           BOOL_OR((p_from IS NULL OR o.created_at >= p_from) AND (p_to IS NULL OR o.created_at <= p_to)) AS in_period
    FROM outs o
    JOIN ep ON ep.conversation_id = o.conversation_id
      AND o.created_at >= ep.episode_start
      AND (ep.next_start IS NULL OR o.created_at < ep.next_start)
    GROUP BY o.author, o.conversation_id, ep.episode_no, ep.episode_start, ep.first_inbound_at, ep.contact_id
  ),
  handoff AS (
    -- Para una PERSONA, su tiempo se cuenta desde que la conversacion le fue
    -- asignada o derivada, no desde que escribio el lead: antes de eso no era
    -- suya. Para los grupos no hay asignacion y queda el primer
    -- entrante del episodio.
    SELECT ae.author, ae.conversation_id, ae.episode_no,
           MAX(al.performed_at) AS assigned_at
    FROM author_ep ae
    JOIN public.audit_log al
      ON al.workspace_id = p_workspace_id
     AND al.performed_at >= ae.episode_start
     AND al.performed_at < ae.author_first_out
     AND (
       (al.entity_type = 'conversation' AND al.entity_id = ae.conversation_id
         AND al.action = 'assign' AND al.changes->'assigned_to'->>'new' = ae.author)
       OR (al.entity_type = 'contact' AND al.entity_id = ae.contact_id
         AND al.action = 'assign'
         AND (al.changes->'setter_id'->>'new' = ae.author OR al.changes->'vendedor_id'->>'new' = ae.author))
       OR (al.entity_type = 'conversation' AND al.entity_id = ae.conversation_id
         AND al.action = 'human_takeover')
     )
    WHERE ae.author ~ '^[0-9a-f-]{36}$'
    GROUP BY ae.author, ae.conversation_id, ae.episode_no
  ),
  first_resp AS (
    SELECT ae.author,
           COUNT(*) AS conversations,
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (ae.author_first_out - GREATEST(ae.first_inbound_at, COALESCE(h.assigned_at, ae.first_inbound_at))))
           ) FILTER (WHERE ae.author_first_out >= ae.first_inbound_at) AS first_med
    FROM author_ep ae
    LEFT JOIN handoff h ON h.author = ae.author AND h.conversation_id = ae.conversation_id AND h.episode_no = ae.episode_no
    WHERE ae.in_period
    GROUP BY ae.author
  ),
  esc AS (
    -- Derivaciones RECIBIDAS por una persona: a quien quedo la conversacion.
    SELECT target AS author, COUNT(*) AS n FROM (
      SELECT CASE
               WHEN al.action = 'assign' AND al.entity_type = 'conversation' THEN al.changes->'assigned_to'->>'new'
               WHEN al.action = 'assign' AND al.entity_type = 'contact'
                 THEN COALESCE(al.changes->'setter_id'->>'new', al.changes->'vendedor_id'->>'new')
               WHEN al.action = 'human_takeover'
                 THEN COALESCE(al.metadata->>'assigned_to', cv.assigned_to::text, ct.setter_id::text, ct.vendedor_id::text)
             END AS target
      FROM public.audit_log al
      LEFT JOIN public.conversations cv ON al.entity_type = 'conversation' AND cv.id = al.entity_id
      LEFT JOIN public.contacts ct ON ct.id = COALESCE(cv.contact_id, CASE WHEN al.entity_type = 'contact' THEN al.entity_id END)
      WHERE al.workspace_id = p_workspace_id
        AND al.action IN ('assign', 'human_takeover')
        AND (p_from IS NULL OR al.performed_at >= p_from)
        AND (p_to IS NULL OR al.performed_at <= p_to)
        AND (p_channel IS NULL
             OR (cv.id IS NOT NULL AND (cv.channel_id::text = p_channel OR cv.platform = p_channel))
             OR (al.entity_type = 'contact' AND EXISTS (
                   SELECT 1 FROM public.conversations c3
                   WHERE c3.contact_id = al.entity_id AND c3.deleted_at IS NULL
                     AND (c3.channel_id::text = p_channel OR c3.platform = p_channel))))
    ) t
    WHERE target ~ '^[0-9a-f-]{36}$'
    GROUP BY target
  ),
  drafts AS (
    -- Borradores que aprobo cada persona. Salen con origin 'agent', asi que no
    -- aparecen en sus mensajes enviados: es una columna propia.
    SELECT dr.decided_by::text AS author, COUNT(*) AS n,
           ROUND(100.0 * COUNT(*) FILTER (WHERE dr.sent_body IS NOT DISTINCT FROM dr.body) / NULLIF(COUNT(*), 0), 1) AS unedited_pct
    FROM public.agent_drafts dr
    JOIN public.conversations c ON c.id = dr.conversation_id
    WHERE dr.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND dr.status = 'sent' AND dr.decided_by IS NOT NULL
      AND (p_from IS NULL OR dr.decided_at >= p_from) AND (p_to IS NULL OR dr.decided_at <= p_to)
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
    GROUP BY dr.decided_by
  ),
  authors AS (
    SELECT author FROM sent
    UNION SELECT author FROM esc
    UNION SELECT author FROM drafts
  )
  SELECT
    a.author,
    COALESCE(fr.conversations, 0),
    COALESCE(s.n, 0),
    fr.first_med,
    rp.reply_med,
    rp.under1h,
    CASE WHEN a.author ~ '^[0-9a-f-]{36}$' THEN COALESCE(e.n, 0) END,
    CASE WHEN a.author ~ '^[0-9a-f-]{36}$' THEN COALESCE(dp.n, 0) END,
    dp.unedited_pct
  FROM authors a
  LEFT JOIN sent s ON s.author = a.author
  LEFT JOIN replies rp ON rp.author = a.author
  LEFT JOIN first_resp fr ON fr.author = a.author
  LEFT JOIN esc e ON e.author = a.author
  LEFT JOIN drafts dp ON dp.author = a.author;
$function$;
COMMENT ON FUNCTION public.chat_dashboard_team(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text) IS 'Una fila por autor: el agente, "automations" (flows + secuencias + broadcasts, UNA fila), "external" y cada persona. La primera respuesta de una persona se cuenta desde que la conversacion le fue asignada o derivada. Para un Member, las derivaciones recibidas pueden quedar cortas: la RLS de audit_log no le muestra las filas de otras personas.';
REVOKE ALL ON FUNCTION public.chat_dashboard_team(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_trends(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text, p_author text DEFAULT NULL::text, p_tz text DEFAULT 'America/Costa_Rica'::text)
 RETURNS TABLE(day date, messages_in bigint, messages_out bigint, new_conversations bigint, sent_agent bigint, sent_team bigint, sent_automations bigint, sent_external bigint, first_response_median_seconds numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH all_msgs AS (
    SELECT (m.created_at AT TIME ZONE p_tz)::date AS d, m.direction, m.origin, m.sent_by_user_id, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  bounds AS (
    SELECT
      COALESCE((p_from AT TIME ZONE p_tz)::date, (SELECT MIN(d) FROM all_msgs)) AS d0,
      LEAST(COALESCE((p_to AT TIME ZONE p_tz)::date, (now() AT TIME ZONE p_tz)::date),
            (now() AT TIME ZONE p_tz)::date) AS d1
  ),
  days AS (
    -- Todos los dias del periodo, tengan o no actividad: un dia sin mensajes
    -- vale cero y el grafico tiene que mostrar ese hueco en su lugar.
    SELECT generate_series(d0::timestamp, d1::timestamp, interval '1 day')::date AS d
    FROM bounds WHERE d0 IS NOT NULL AND d1 >= d0
  ),
  msgs AS (
    SELECT * FROM all_msgs
    WHERE (p_from IS NULL OR created_at >= p_from) AND (p_to IS NULL OR created_at <= p_to)
  ),
  per_day AS (
    SELECT d,
      COUNT(*) FILTER (WHERE direction = 'inbound') AS m_in,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id)) AS m_out,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id) AND public.chat_origin_group(origin) = 'agent') AS s_agent,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id) AND public.chat_origin_group(origin) = 'team') AS s_team,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id) AND public.chat_origin_group(origin) = 'automations') AS s_auto,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id) AND public.chat_origin_group(origin) = 'external') AS s_ext
    FROM msgs GROUP BY d
  ),
  eps AS (
    SELECT (episode_start AT TIME ZONE p_tz)::date AS d, first_inbound_at, first_outbound_at
    FROM public.chat_episodes(p_workspace_id, p_channel)
    WHERE (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to)
  ),
  eps_day AS (
    SELECT d, COUNT(*) AS n,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_outbound_at - first_inbound_at)))
        FILTER (WHERE first_outbound_at IS NOT NULL AND first_outbound_at >= first_inbound_at) AS med
    FROM eps GROUP BY d
  )
  SELECT days.d,
    COALESCE(p.m_in, 0), COALESCE(p.m_out, 0), COALESCE(e.n, 0),
    COALESCE(p.s_agent, 0), COALESCE(p.s_team, 0), COALESCE(p.s_auto, 0), COALESCE(p.s_ext, 0),
    -- Sin episodios ese dia la mediana es NULL, no 0: "no sabemos" y "cero
    -- segundos" son afirmaciones distintas.
    e.med
  FROM days
  LEFT JOIN per_day p ON p.d = days.d
  LEFT JOIN eps_day e ON e.d = days.d
  ORDER BY days.d;
$function$;
COMMENT ON FUNCTION public.chat_dashboard_trends(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_author text, p_tz text) IS 'Serie diaria densa (todos los dias del periodo) con recibidos, enviados, enviados por grupo de autor, conversaciones nuevas y la mediana diaria de primera respuesta. La app agrupa a semanal si el periodo pasa de 62 dias.';
REVOKE ALL ON FUNCTION public.chat_dashboard_trends(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_author text, p_tz text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_reply_is_human(p_origin text, p_sent_by_user_id uuid, p_seconds_since_last_inbound numeric)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_origin = 'user' THEN true
    WHEN p_origin = 'agent' THEN p_sent_by_user_id IS NOT NULL
    WHEN p_origin IN ('flow', 'sequence', 'broadcast') THEN false
    ELSE COALESCE(p_seconds_since_last_inbound, 0) >= 15
  END;
$function$;
COMMENT ON FUNCTION public.chat_reply_is_human(p_origin text, p_sent_by_user_id uuid, p_seconds_since_last_inbound numeric) IS 'Si una respuesta la dio una persona. Gemela de isHumanReply (lib/messages/reply-time.ts). Desde fuera del sistema, menos de 15 s despues del lead = automatica.';
REVOKE ALL ON FUNCTION public.chat_reply_is_human(p_origin text, p_sent_by_user_id uuid, p_seconds_since_last_inbound numeric) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_response_turns(p_workspace_id uuid, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(conversation_id uuid, started_at timestamp with time zone, last_inbound_at timestamp with time zone, replied_at timestamp with time zone, reply_origin text, reply_user_id uuid, is_human boolean, response_seconds numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH msgs AS (
    SELECT m.id, m.conversation_id, m.direction, m.origin, m.sent_by_user_id, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      -- Un envío que falló no le llegó al lead: no cierra la espera.
      AND NOT (m.direction = 'outbound' AND m.status IS NOT DISTINCT FROM 'failed')
  ),
  marked AS (
    SELECT msgs.*,
      CASE WHEN direction = 'inbound'
                AND LAG(direction) OVER (PARTITION BY conversation_id ORDER BY created_at, id) IS DISTINCT FROM 'inbound'
           THEN 1 ELSE 0 END AS is_start
    FROM msgs
  ),
  grouped AS (
    SELECT marked.*,
      SUM(is_start) OVER (PARTITION BY conversation_id ORDER BY created_at, id ROWS UNBOUNDED PRECEDING) AS turn_no
    FROM marked
  ),
  turns AS (
    SELECT g.conversation_id,
      MIN(g.created_at) FILTER (WHERE g.direction = 'inbound') AS started_at,
      MAX(g.created_at) FILTER (WHERE g.direction = 'inbound') AS last_inbound_at,
      MIN(g.created_at) FILTER (WHERE g.direction = 'outbound') AS replied_at,
      (ARRAY_AGG(g.origin ORDER BY g.created_at, g.id) FILTER (WHERE g.direction = 'outbound'))[1] AS reply_origin,
      (ARRAY_AGG(g.sent_by_user_id ORDER BY g.created_at, g.id) FILTER (WHERE g.direction = 'outbound'))[1] AS reply_user_id
    FROM grouped g
    WHERE g.turn_no >= 1
    GROUP BY g.conversation_id, g.turn_no
  )
  SELECT t.conversation_id, t.started_at, t.last_inbound_at, t.replied_at, t.reply_origin, t.reply_user_id,
    CASE WHEN t.replied_at IS NULL THEN NULL
         ELSE public.chat_reply_is_human(t.reply_origin, t.reply_user_id, EXTRACT(EPOCH FROM (t.replied_at - t.last_inbound_at)))
    END,
    EXTRACT(EPOCH FROM (t.replied_at - t.started_at))
  FROM turns t;
$function$;
COMMENT ON FUNCTION public.chat_response_turns(p_workspace_id uuid, p_channel text) IS 'Cada espera del lead (tanda de mensajes seguidos) con quien la cerro y cuanto tardo, desde el primer mensaje sin responder. Base del tiempo de respuesta.';
REVOKE ALL ON FUNCTION public.chat_response_turns(p_workspace_id uuid, p_channel text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_response_time_daily(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text, p_author text DEFAULT NULL::text, p_tz text DEFAULT 'UTC'::text)
 RETURNS TABLE(day date, turns bigint, total_seconds numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT (t.started_at AT TIME ZONE p_tz)::date, COUNT(*), SUM(t.response_seconds)
  FROM public.chat_response_turns(p_workspace_id, p_channel) t
  WHERE t.replied_at IS NOT NULL
    AND (p_from IS NULL OR t.started_at >= p_from)
    AND (p_to IS NULL OR t.started_at <= p_to)
    AND CASE
      WHEN p_author IS NULL OR p_author = 'all' THEN t.is_human
      WHEN p_author IN ('agent', 'automations') THEN public.chat_author_match(p_author, t.reply_origin, t.reply_user_id)
      ELSE t.is_human AND public.chat_author_match(p_author, t.reply_origin, t.reply_user_id)
    END
  GROUP BY 1
  ORDER BY 1;
$function$;
COMMENT ON FUNCTION public.chat_dashboard_response_time_daily(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_author text, p_tz text) IS 'Por dia (en la zona pedida): cuantas esperas cerro una persona (o el autor filtrado) y la suma de sus tiempos. La app divide y agrupa por semana.';
REVOKE ALL ON FUNCTION public.chat_dashboard_response_time_daily(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_author text, p_tz text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_dashboard_response_time(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text, p_author text DEFAULT NULL::text)
 RETURNS TABLE(avg_seconds numeric, median_seconds numeric, turns bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT
    AVG(t.response_seconds),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.response_seconds),
    COUNT(*)
  FROM public.chat_response_turns(p_workspace_id, p_channel) t
  WHERE t.replied_at IS NOT NULL
    AND (p_from IS NULL OR t.started_at >= p_from)
    AND (p_to IS NULL OR t.started_at <= p_to)
    AND CASE
      WHEN p_author IS NULL OR p_author = 'all' THEN t.is_human
      WHEN p_author IN ('agent', 'automations') THEN public.chat_author_match(p_author, t.reply_origin, t.reply_user_id)
      ELSE t.is_human AND public.chat_author_match(p_author, t.reply_origin, t.reply_user_id)
    END;
$function$;
COMMENT ON FUNCTION public.chat_dashboard_response_time(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_author text) IS 'Tiempo de respuesta del periodo: promedio y mediana, en segundos, de las esperas que cerro una persona (o el autor filtrado). Las esperas se asignan al periodo por su primer mensaje.';
REVOKE ALL ON FUNCTION public.chat_dashboard_response_time(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_channel text, p_author text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_waiting_now_v2(p_workspace_id uuid, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(can_reply bigint, window_closed bigint, no_reply_needed bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH w AS (
    SELECT c.reply_window_until, c.no_reply_needed_at
    FROM public.conversations c
    JOIN public.contacts ct ON ct.id = c.contact_id
    WHERE c.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND c.status = 'open'
      AND c.agent_disabled_by_tag_id IS NULL
      AND COALESCE(ct.do_not_contact, false) = false
      AND c.awaiting_last_inbound_at IS NOT NULL
      AND c.awaiting_last_inbound_at < now() - interval '1 hour'
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  )
  SELECT
    COUNT(*) FILTER (WHERE no_reply_needed_at IS NULL AND (reply_window_until IS NULL OR reply_window_until > now())),
    COUNT(*) FILTER (WHERE no_reply_needed_at IS NULL AND reply_window_until <= now()),
    COUNT(*) FILTER (WHERE no_reply_needed_at IS NOT NULL)
  FROM w;
$function$;
COMMENT ON FUNCTION public.chat_waiting_now_v2(p_workspace_id uuid, p_channel text) IS 'Esperando respuesta ahora, en tres: se puede responder desde el sistema, la ventana ya cerro, y no necesita respuesta. Lee las columnas que mantiene el trigger de messages.';
REVOKE ALL ON FUNCTION public.chat_waiting_now_v2(p_workspace_id uuid, p_channel text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_waiting_now(p_workspace_id uuid, p_channel text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH last_msg AS (
    SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.direction, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id
    ORDER BY m.conversation_id, m.created_at DESC
  )
  SELECT COUNT(*)
  FROM public.conversations c
  JOIN public.contacts ct ON ct.id = c.contact_id
  JOIN last_msg lm ON lm.conversation_id = c.id
  WHERE c.workspace_id = p_workspace_id
    AND c.deleted_at IS NULL
    AND c.status = 'open'
    AND c.agent_disabled_by_tag_id IS NULL
    AND COALESCE(ct.do_not_contact, false) = false
    AND lm.direction = 'inbound'
    AND lm.created_at < now() - interval '1 hour'
    AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel);
$function$;
REVOKE ALL ON FUNCTION public.chat_waiting_now(p_workspace_id uuid, p_channel text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.draft_queue_metrics_by_person(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;
  IF NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: only workspace owners and admins';
  END IF;

  WITH decided AS (
    SELECT d.decided_by AS user_id, d.status, d.body, d.sent_body, d.discard_reason,
           r.completed_at, r.responded_at
    FROM public.agent_drafts d
    LEFT JOIN public.agent_runs r ON r.id = d.run_id
    WHERE d.workspace_id = p_workspace_id
      AND d.decided_by IS NOT NULL
      AND d.decided_at >= p_from AND d.decided_at < p_to
  ),
  per_decider AS (
    SELECT user_id,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM responded_at - completed_at))
        FILTER (WHERE status = 'sent' AND responded_at IS NOT NULL AND completed_at IS NOT NULL) AS approval_median_s,
      count(*) FILTER (WHERE status = 'sent') AS sent,
      count(*) FILTER (WHERE status = 'sent' AND sent_body = body) AS sent_unedited,
      count(*) FILTER (WHERE status = 'discarded' AND COALESCE(discard_reason, '') NOT LIKE 'auto:%') AS discarded
    FROM decided
    GROUP BY user_id
  ),
  per_missed AS (
    SELECT d.missed_while_assigned_to AS user_id, count(*) AS windows_missed
    FROM public.agent_drafts d
    WHERE d.workspace_id = p_workspace_id
      AND d.window_missed_at >= p_from AND d.window_missed_at < p_to
    GROUP BY d.missed_while_assigned_to
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',           u.user_id,
    'approval_median_s', pd.approval_median_s,
    'sent',              COALESCE(pd.sent, 0),
    'sent_unedited',     COALESCE(pd.sent_unedited, 0),
    'discarded',         COALESCE(pd.discarded, 0),
    'windows_missed',    COALESCE(pm.windows_missed, 0)
  ) ORDER BY u.user_id NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT user_id FROM per_decider
    UNION
    SELECT user_id FROM per_missed
  ) u
  LEFT JOIN per_decider pd ON pd.user_id IS NOT DISTINCT FROM u.user_id
  LEFT JOIN per_missed pm ON pm.user_id IS NOT DISTINCT FROM u.user_id;

  RETURN v_result;
END;
$function$;
COMMENT ON FUNCTION public.draft_queue_metrics_by_person(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) IS 'Desglose por persona de la cola de borradores (mediana de aprobacion, enviados, sin editar, descartados, ventanas perdidas). Solo Owner/Admin, chequeado adentro.';
REVOKE ALL ON FUNCTION public.draft_queue_metrics_by_person(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.draft_queue_metrics(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid;
  v_result jsonb;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;
  IF NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this workspace';
  END IF;

  IF public.is_workspace_admin(p_workspace_id) THEN
    v_user := p_user_id;
  ELSE
    v_user := auth.uid();
  END IF;

  WITH runs AS (
    SELECT r.id, r.status, r.inbound_at, r.completed_at, r.responded_at
    FROM public.agent_runs r
    LEFT JOIN public.contacts c ON c.id = r.contact_id
    WHERE r.workspace_id = p_workspace_id
      AND r.source = 'agent'
      AND r.inbound_at IS NOT NULL
      AND (v_user IS NULL OR COALESCE(c.setter_id, c.vendedor_id) = v_user)
  ),
  decided AS (
    SELECT d.*, r.completed_at AS run_completed_at, r.responded_at AS run_responded_at
    FROM public.agent_drafts d
    LEFT JOIN public.agent_runs r ON r.id = d.run_id
    WHERE d.workspace_id = p_workspace_id
      AND d.decided_at >= p_from AND d.decided_at < p_to
      AND (v_user IS NULL OR d.decided_by = v_user)
  )
  SELECT jsonb_build_object(
    'response_median_s', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM responded_at - inbound_at))
      FROM runs
      WHERE responded_at >= p_from AND responded_at < p_to
    ),
    'agent_median_s', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - inbound_at))
      FROM runs
      WHERE status IN ('responded', 'drafted')
        AND completed_at >= p_from AND completed_at < p_to
    ),
    -- Solo borradores enviados: sobre todos los runs, los de envio directo
    -- (~0 s) hundirian la mediana.
    'approval_median_s', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM run_responded_at - run_completed_at))
      FROM decided
      WHERE status = 'sent' AND run_responded_at IS NOT NULL AND run_completed_at IS NOT NULL
    ),
    'sent',          (SELECT count(*) FROM decided WHERE status = 'sent'),
    'sent_unedited', (SELECT count(*) FROM decided WHERE status = 'sent' AND sent_body = body),
    -- Descartar a proposito es una decision; los descartes automaticos (una
    -- respuesta a mano, un cierre) llevan el prefijo auto: y no cuentan.
    'discarded',     (SELECT count(*) FROM decided WHERE status = 'discarded' AND COALESCE(discard_reason, '') NOT LIKE 'auto:%'),
    'windows_missed', (
      SELECT count(*)
      FROM public.agent_drafts d
      WHERE d.workspace_id = p_workspace_id
        AND d.window_missed_at >= p_from AND d.window_missed_at < p_to
        AND (v_user IS NULL OR d.missed_while_assigned_to = v_user)
    ),
    'scope', CASE WHEN v_user IS NULL THEN 'team' ELSE 'person' END
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;
COMMENT ON FUNCTION public.draft_queue_metrics(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_user_id uuid) IS 'Franja de la cola de borradores: medianas de respuesta, del agente y de aprobacion, enviados, sin editar, descartados y ventanas perdidas de un periodo. Se defiende sola: exige ser miembro, y a un Member le devuelve siempre sus numeros.';
REVOKE ALL ON FUNCTION public.draft_queue_metrics(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_user_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.merge_contacts(p_workspace_id uuid, p_main uuid, p_duplicate uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_main public.contacts%ROWTYPE;
  v_dup public.contacts%ROWTYPE;
  v_moved jsonb := '{}'::jsonb;
  v_n integer;
  v_conv record;
  v_merged_convs uuid[] := '{}';
  v_convs_merged integer := 0;
  v_msgs_moved integer := 0;
  v_msgs_left integer := 0;
  v_notes text;
  v_table text;
  -- El estado de cada rol despues de fusionar, y el ultimo.
  v_setter text;
  v_setter_at timestamptz;
  v_setter_by_agent boolean;
  v_closer text;
  v_closer_at timestamptz;
  v_last_role text;
  v_last text;
  v_last_at timestamptz;
BEGIN
  IF p_workspace_id IS NULL OR p_main IS NULL OR p_duplicate IS NULL THEN
    RAISE EXCEPTION 'merge_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_main = p_duplicate THEN
    RAISE EXCEPTION 'merge_same_contact' USING ERRCODE = '22023';
  END IF;

  -- Las dos filas, bloqueadas en un orden fijo (sin interbloqueos entre dos fusiones).
  PERFORM 1 FROM public.contacts WHERE id IN (p_main, p_duplicate) ORDER BY id FOR UPDATE;
  SELECT * INTO v_main FROM public.contacts WHERE id = p_main;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_dup FROM public.contacts WHERE id = p_duplicate;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_main.workspace_id <> p_workspace_id OR v_dup.workspace_id <> p_workspace_id THEN
    RAISE EXCEPTION 'merge_workspace_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_main.deleted_at IS NOT NULL OR v_dup.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'merge_deleted' USING ERRCODE = '22023';
  END IF;

  -- El duplicado sale de circulacion PRIMERO: asi, si hay indices unicos por telefono o email sobre los contactos vivos,
  -- rellenar los datos vacios del principal no choca con el duplicado.
  UPDATE public.contacts
     SET deleted_at = now(),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('merged_into', p_main)
   WHERE id = p_duplicate;

  -- Canales vinculados (unico por canal + remitente: los remitentes son distintos, no choca).
  UPDATE public.contact_channels SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_channels', v_n);

  -- Conversaciones: UNA por canal y contacto. Si el principal ya tiene una en ese canal, los mensajes de la del
  -- duplicado pasan a la del principal (los que repiten el id del mensaje de la plataforma se quedan donde estan y se
  -- cuentan), se recalcula su resumen y la del duplicado queda vacia y con borrado logico.
  FOR v_conv IN
    SELECT d.id AS dup_conv, m.id AS main_conv
      FROM public.conversations d
      JOIN public.conversations m ON m.channel_id = d.channel_id AND m.contact_id = p_main
     WHERE d.contact_id = p_duplicate
     ORDER BY d.id
  LOOP
    -- Un solo borrador abierto por conversacion: si el principal ya tiene uno, el del duplicado se descarta.
    IF EXISTS (SELECT 1 FROM public.agent_drafts WHERE conversation_id = v_conv.main_conv AND status IN ('pending', 'sending', 'failed')) THEN
      UPDATE public.agent_drafts SET status = 'discarded'
       WHERE conversation_id = v_conv.dup_conv AND status IN ('pending', 'sending', 'failed');
    END IF;
    UPDATE public.agent_drafts SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;

    UPDATE public.messages msg SET conversation_id = v_conv.main_conv
     WHERE msg.conversation_id = v_conv.dup_conv
       AND (msg.platform_message_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.messages o
              WHERE o.conversation_id = v_conv.main_conv AND o.platform_message_id = msg.platform_message_id));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_msgs_moved := v_msgs_moved + v_n;
    SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_conv.dup_conv;
    v_msgs_left := v_msgs_left + v_n;

    UPDATE public.conversations m SET
      last_message_preview = CASE WHEN d.last_message_at IS NOT NULL AND (m.last_message_at IS NULL OR d.last_message_at > m.last_message_at)
                                  THEN d.last_message_preview ELSE m.last_message_preview END,
      last_message_at = GREATEST(m.last_message_at, d.last_message_at),
      unread_count = COALESCE(m.unread_count, 0) + COALESCE(d.unread_count, 0),
      status = CASE WHEN m.status = 'open' OR d.status = 'open' THEN 'open' ELSE m.status END,
      assigned_to = COALESCE(m.assigned_to, d.assigned_to),
      needs_human_reason = CASE WHEN NOT COALESCE(m.needs_human, false) AND COALESCE(d.needs_human, false) THEN d.needs_human_reason ELSE m.needs_human_reason END,
      needs_human_at = CASE WHEN NOT COALESCE(m.needs_human, false) AND COALESCE(d.needs_human, false) THEN d.needs_human_at ELSE m.needs_human_at END,
      needs_human = COALESCE(m.needs_human, false) OR COALESCE(d.needs_human, false),
      deleted_at = CASE WHEN m.deleted_at IS NOT NULL AND d.deleted_at IS NULL THEN NULL ELSE m.deleted_at END
     FROM public.conversations d
    WHERE m.id = v_conv.main_conv AND d.id = v_conv.dup_conv;

    UPDATE public.agent_runs SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;
    UPDATE public.conversations SET deleted_at = COALESCE(deleted_at, now()), unread_count = 0 WHERE id = v_conv.dup_conv;

    v_merged_convs := v_merged_convs || v_conv.dup_conv;
    v_convs_merged := v_convs_merged + 1;
  END LOOP;

  -- Las demas conversaciones se mueven enteras.
  UPDATE public.conversations SET contact_id = p_main
   WHERE contact_id = p_duplicate AND NOT (id = ANY (v_merged_convs));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('conversations', v_n, 'conversations_merged', v_convs_merged, 'messages_moved', v_msgs_moved, 'messages_left', v_msgs_left);

  -- Etiquetas: se mueven las que el principal no tiene (PK contact_id + tag_id).
  UPDATE public.contact_tags SET contact_id = p_main
   WHERE contact_id = p_duplicate
     AND NOT EXISTS (SELECT 1 FROM public.contact_tags o WHERE o.contact_id = p_main AND o.tag_id = public.contact_tags.tag_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_tags', v_n);

  -- Campos personalizados: en uno que ambos tienen, gana el del principal.
  UPDATE public.contact_custom_fields SET contact_id = p_main
   WHERE contact_id = p_duplicate
     AND NOT EXISTS (SELECT 1 FROM public.contact_custom_fields o WHERE o.contact_id = p_main AND o.field_id = public.contact_custom_fields.field_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_custom_fields', v_n);

  -- Secuencias: una inscripcion viva por secuencia. Si el principal ya esta activo o pausado en esa secuencia, la viva del
  -- duplicado se cancela (con el motivo); el resto se mueve.
  UPDATE public.sequence_enrollments d SET status = 'cancelled', paused_reason = 'fusion de contactos', next_step_at = NULL, locked_at = NULL
   WHERE d.contact_id = p_duplicate AND d.status IN ('active', 'paused')
     AND EXISTS (SELECT 1 FROM public.sequence_enrollments m WHERE m.contact_id = p_main AND m.sequence_id = d.sequence_id AND m.status IN ('active', 'paused'));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sequence_enrollments_cancelled', v_n);
  UPDATE public.sequence_enrollments SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sequence_enrollments', v_n);

  -- Sesiones de flujo: las activas del duplicado se mueven, salvo que el principal ya tenga una activa del mismo flujo (la
  -- del duplicado se cancela). El historial se mueve siempre.
  UPDATE public.flow_sessions d SET status = 'cancelled'
   WHERE d.contact_id = p_duplicate AND d.status = 'active'
     AND EXISTS (SELECT 1 FROM public.flow_sessions m WHERE m.contact_id = p_main AND m.status = 'active' AND m.flow_id = d.flow_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('flow_sessions_cancelled', v_n);
  UPDATE public.flow_sessions SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('flow_sessions', v_n);

  -- Eventos de automatizacion: los pendientes del duplicado NO se mueven (podrian disparar otra vez un flujo para el
  -- principal): se marcan como cancelados. Los ya procesados (historial) se mueven.
  UPDATE public.automation_events SET processed_at = now(), error = 'fusion de contactos'
   WHERE contact_id = p_duplicate AND processed_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('automation_events_cancelled', v_n);
  UPDATE public.automation_events SET contact_id = p_main
   WHERE contact_id = p_duplicate AND processed_at IS NOT NULL AND error IS DISTINCT FROM 'fusion de contactos';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('automation_events', v_n);

  -- Toques de atribucion: se mueven todos y la atribucion del principal se recalcula con TODOS (primer y ultimo toque).
  UPDATE public.contact_touches SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_touches', v_n);
  IF v_n > 0 THEN PERFORM private.refresh_contact_attribution(p_main); END IF;

  -- El historial de estados del duplicado pasa al principal (los cambios siguen siendo de quien los hizo).
  UPDATE public.contact_status_changes SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_status_changes', v_n);

  -- Lo que solo cambia de dueno (sin indices unicos que dependan del contacto). Las agendas no cambian de estado.
  FOREACH v_table IN ARRAY ARRAY[
    'agent_drafts', 'agent_runs', 'analytics_events', 'bookings', 'broadcast_recipients', 'contact_notes',
    'email_log', 'social_post_comments', 'trigger_fires'
  ] LOOP
    EXECUTE format('UPDATE public.%I SET contact_id = $1 WHERE contact_id = $2', v_table) USING p_main, p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_moved := v_moved || jsonb_build_object(v_table, v_n);
  END LOOP;

  -- Los contactos que el duplicado habia referido pasan a ser referidos por el principal.
  UPDATE public.contacts SET referred_by_contact_id = NULL WHERE id = p_main AND referred_by_contact_id = p_duplicate;
  UPDATE public.contacts SET referred_by_contact_id = p_main WHERE referred_by_contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('referred_contacts', v_n);

  -- Los datos de identidad que el principal tiene vacios se completan con los del duplicado (nunca al reves), mas la fecha
  -- del proximo seguimiento.
  UPDATE public.contacts SET
    display_name = CASE WHEN NULLIF(btrim(COALESCE(display_name, '')), '') IS NULL THEN COALESCE(v_dup.display_name, display_name) ELSE display_name END,
    email = CASE WHEN NULLIF(btrim(COALESCE(email, '')), '') IS NULL THEN COALESCE(v_dup.email, email) ELSE email END,
    secondary_email = CASE WHEN NULLIF(btrim(COALESCE(secondary_email, '')), '') IS NULL THEN COALESCE(v_dup.secondary_email, secondary_email) ELSE secondary_email END,
    phone = CASE WHEN NULLIF(btrim(COALESCE(phone, '')), '') IS NULL THEN COALESCE(v_dup.phone, phone) ELSE phone END,
    whatsapp_phone = CASE WHEN NULLIF(btrim(COALESCE(whatsapp_phone, '')), '') IS NULL THEN COALESCE(v_dup.whatsapp_phone, whatsapp_phone) ELSE whatsapp_phone END,
    country = CASE WHEN NULLIF(btrim(COALESCE(country, '')), '') IS NULL THEN COALESCE(v_dup.country, country) ELSE country END,
    instagram_username = CASE WHEN NULLIF(btrim(COALESCE(instagram_username, '')), '') IS NULL THEN COALESCE(v_dup.instagram_username, instagram_username) ELSE instagram_username END,
    tiktok_username = CASE WHEN NULLIF(btrim(COALESCE(tiktok_username, '')), '') IS NULL THEN COALESCE(v_dup.tiktok_username, tiktok_username) ELSE tiktok_username END,
    twitter_username = CASE WHEN NULLIF(btrim(COALESCE(twitter_username, '')), '') IS NULL THEN COALESCE(v_dup.twitter_username, twitter_username) ELSE twitter_username END,
    facebook_id = CASE WHEN NULLIF(btrim(COALESCE(facebook_id, '')), '') IS NULL THEN COALESCE(v_dup.facebook_id, facebook_id) ELSE facebook_id END,
    youtube_channel_id = CASE WHEN NULLIF(btrim(COALESCE(youtube_channel_id, '')), '') IS NULL THEN COALESCE(v_dup.youtube_channel_id, youtube_channel_id) ELSE youtube_channel_id END,
    linkedin_profile_url = CASE WHEN NULLIF(btrim(COALESCE(linkedin_profile_url, '')), '') IS NULL THEN COALESCE(v_dup.linkedin_profile_url, linkedin_profile_url) ELSE linkedin_profile_url END,
    setter_id = COALESCE(setter_id, v_dup.setter_id),
    vendedor_id = COALESCE(vendedor_id, v_dup.vendedor_id),
    next_followup_date = COALESCE(next_followup_date, v_dup.next_followup_date),
    -- Producto de interes: gana el del principal; si no tiene, el del duplicado con SU variante.
    interest_variant_id = CASE WHEN interest_product_id IS NULL THEN v_dup.interest_variant_id ELSE interest_variant_id END,
    interest_product_id = COALESCE(interest_product_id, v_dup.interest_product_id)
   WHERE id = p_main;

  -- El estado de cada rol es el del principal; si no tiene, el del duplicado. El ultimo se recalcula con la misma regla
  -- que `set_contact_status` (el mas reciente; empatados, el del vendedor). Las columnas de estado solo se escriben con
  -- la marca de transaccion (`contacts_status_guard`).
  IF v_main.setter_status IS NOT NULL THEN
    v_setter := v_main.setter_status; v_setter_at := v_main.setter_status_at; v_setter_by_agent := v_main.setter_status_by_agent;
  ELSE
    v_setter := v_dup.setter_status; v_setter_at := v_dup.setter_status_at; v_setter_by_agent := COALESCE(v_dup.setter_status_by_agent, false);
  END IF;
  IF v_main.closer_status IS NOT NULL THEN
    v_closer := v_main.closer_status; v_closer_at := v_main.closer_status_at;
  ELSE
    v_closer := v_dup.closer_status; v_closer_at := v_dup.closer_status_at;
  END IF;
  IF v_closer IS NOT NULL AND (v_setter IS NULL OR v_closer_at >= v_setter_at) THEN
    v_last_role := 'closer'; v_last := v_closer; v_last_at := v_closer_at;
  ELSIF v_setter IS NOT NULL THEN
    v_last_role := 'setter'; v_last := v_setter; v_last_at := v_setter_at;
  ELSE
    v_last_role := NULL; v_last := NULL; v_last_at := NULL;
  END IF;
  IF v_setter IS DISTINCT FROM v_main.setter_status OR v_closer IS DISTINCT FROM v_main.closer_status THEN
    PERFORM set_config('app.contact_status_internal', 'on', true);
    UPDATE public.contacts SET
      setter_status = v_setter, setter_status_at = v_setter_at, setter_status_by_agent = COALESCE(v_setter_by_agent, false),
      closer_status = v_closer, closer_status_at = v_closer_at,
      last_status_role = v_last_role, last_status = v_last, last_status_at = v_last_at
     WHERE id = p_main;
    PERFORM set_config('app.contact_status_internal', 'off', true);
  END IF;

  -- Las notas de los dos se juntan (dos textos de personas distintas sobre el mismo lead: quedarse con uno tira el otro).
  v_notes := concat_ws(E'\n\n---\n\n', NULLIF(btrim(COALESCE(v_main.notes, '')), ''), NULLIF(btrim(COALESCE(v_dup.notes, '')), ''));
  IF v_notes <> '' AND v_notes IS DISTINCT FROM btrim(COALESCE(v_main.notes, '')) THEN
    UPDATE public.contacts SET notes = v_notes WHERE id = p_main;
  END IF;

  -- La sugerencia de vinculacion ya no corresponde.
  UPDATE public.contacts SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb), '{link_suggestions}',
      COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(metadata -> 'link_suggestions') s WHERE s ->> 'contact_id' IS DISTINCT FROM p_duplicate::text), '[]'::jsonb))
   WHERE id = p_main AND jsonb_typeof(metadata -> 'link_suggestions') = 'array';

  -- El historial del contacto principal, en la misma transaccion (sin datos sensibles: solo cuentas).
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (p_workspace_id, 'contact', p_main, 'link', NULL,
          jsonb_build_object('merged_from', p_duplicate, 'automatic', false, 'moved', v_moved), p_actor);

  RETURN jsonb_build_object('ok', true, 'main', p_main, 'duplicate', p_duplicate, 'moved', v_moved);
END;
$function$;
REVOKE ALL ON FUNCTION public.merge_contacts(p_workspace_id uuid, p_main uuid, p_duplicate uuid, p_actor uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.message_classification_status(p_workspace_id uuid, p_tz text DEFAULT 'America/Costa_Rica'::text)
 RETURNS TABLE(last_run_at timestamp with time zone, last_run_status text, last_run_detail text, texts_classified_today bigint, unclassified_pending bigint, active_prompt_version integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT
    r.completed_at,
    r.status,
    r.status_detail,
    (SELECT COUNT(*) FROM public.message_texts t
      WHERE t.workspace_id = p_workspace_id
        AND t.classified_at >= (date_trunc('day', (now() AT TIME ZONE p_tz)) AT TIME ZONE p_tz)),
    -- La misma condicion que usa el clasificador para elegir pendientes
    -- (lib/patterns/classifier.ts): si esta cambia, se pisa trabajo humano.
    (SELECT COUNT(*) FROM public.message_texts t
      WHERE t.workspace_id = p_workspace_id AND t.category_id IS NULL AND t.source IS NULL),
    (SELECT MAX(t.prompt_version) FROM public.message_texts t
      WHERE t.workspace_id = p_workspace_id AND t.source = 'model')
  FROM (
    SELECT completed_at, status, status_detail
    FROM public.agent_runs
    WHERE workspace_id = p_workspace_id AND source = 'message_classification'
    ORDER BY created_at DESC
    LIMIT 1
  ) r
  RIGHT JOIN (SELECT 1) one ON true;
$function$;
COMMENT ON FUNCTION public.message_classification_status(p_workspace_id uuid, p_tz text) IS 'Ultima corrida del clasificador, textos clasificados hoy y cuantos quedan sin clasificar. Un Member ve la corrida en NULL: la RLS de agent_runs le muestra solo runs con conversacion, y el clasificador no tiene ninguna.';
REVOKE ALL ON FUNCTION public.message_classification_status(p_workspace_id uuid, p_tz text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.message_text_volumes(p_workspace_id uuid, p_direction text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(text_id uuid, direction text, category_id uuid, source text, confidence numeric, review_result text, is_button boolean, prompt_version integer, classified_at timestamp with time zone, reviewed_at timestamp with time zone, sample_text text, message_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH counts AS (
    SELECT m.text_norm, m.direction, COUNT(*) AS n
    FROM public.messages m
    WHERE m.workspace_id = p_workspace_id
      AND m.text_norm IS NOT NULL
      AND (p_direction IS NULL OR m.direction = p_direction)
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
    GROUP BY m.text_norm, m.direction
  )
  SELECT t.id, t.direction, t.category_id, t.source, t.confidence, t.review_result,
         t.is_button, t.prompt_version, t.classified_at, t.reviewed_at, t.sample_text,
         COALESCE(c.n, 0)::bigint
  FROM public.message_texts t
  LEFT JOIN counts c ON c.text_norm = t.normalized_text AND c.direction = t.direction
  WHERE t.workspace_id = p_workspace_id
    AND (p_direction IS NULL OR t.direction = p_direction);
$function$;
COMMENT ON FUNCTION public.message_text_volumes(p_workspace_id uuid, p_direction text, p_from timestamp with time zone, p_to timestamp with time zone) IS 'Cada texto distinto con su volumen de mensajes en el periodo. Es la entrada de qualityReport(): "sin categoria" se mide sobre mensajes, no sobre textos.';
REVOKE ALL ON FUNCTION public.message_text_volumes(p_workspace_id uuid, p_direction text, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC, anon;
