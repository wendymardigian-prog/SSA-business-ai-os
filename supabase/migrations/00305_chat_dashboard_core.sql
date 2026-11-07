-- ============================================================================
-- 00305: el dashboard de Chat, rapido
--
-- Por que. Cada bloque era una funcion SECURITY INVOKER que leia `messages` con la
-- RLS del usuario, y esa RLS chequea permisos por CADA mensaje (`messages_select`
-- vuelve a mirar la conversacion, y esa vuelve a correr `can_see_conversation`).
-- Ademas cada bloque repasaba toda la historia por su cuenta. Una carga sumaba
-- varios segundos de trabajo y se cortaba en el `statement_timeout` de 8 s.
--
-- Que cambia:
--   - El permiso se decide una vez por consulta (admin) o una vez por conversacion
--     (el resto), con LA MISMA regla: `can_see_conversation`.
--   - `chat_dashboard_core` calcula de una sola pasada lo que antes pedian las
--     cifras, las tendencias y la seccion del agente.
--
-- Por que SECURITY DEFINER. Para no pasar por la RLS de cada mensaje hay que leer
-- sin ella, y aplicar la regla a mano. Toda lectura sale de `vis` (solo
-- conversaciones que la persona puede ver) y `me.member` corta todo para quien no
-- es miembro: el workspace que llega como parametro no se le cree a nadie.
-- `scripts/verify-chat-core.mjs` compara cada numero contra las funciones viejas
-- como Owner, Member y no miembro.
--
-- Las funciones viejas NO se tocan: quedan para volver atras y como referencia de
-- esa comparacion.
--
-- Aditiva e idempotente. Va ANTES de desplegar el codigo que la usa.
-- ============================================================================

-- 1. Los mensajes que la persona puede ver, sin pasar por la RLS de cada uno -------
-- Sin columnas de texto. La usa `chat_dashboard_team_v2`, que sigue siendo INVOKER
-- porque lo que lee de `audit_log` cambia segun el rol.
CREATE OR REPLACE FUNCTION public.chat_visible_messages(
  p_workspace_id uuid,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  contact_id uuid,
  channel_id uuid,
  direction text,
  origin text,
  sent_by_user_id uuid,
  status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS MATERIALIZED (
    SELECT public.is_workspace_member(p_workspace_id) AS member,
           public.is_workspace_admin(p_workspace_id) AS admin
  ),
  vis AS MATERIALIZED (
    SELECT c.id, c.contact_id, c.channel_id
    FROM public.conversations c
    WHERE (SELECT me.member FROM me)
      AND c.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      -- CASE y no OR: garantiza que para un admin no corra por cada conversacion.
      AND CASE WHEN (SELECT me.admin FROM me) THEN true ELSE public.can_see_conversation(c) END
  )
  SELECT m.id, m.conversation_id, v.contact_id, v.channel_id, m.direction, m.origin,
         m.sent_by_user_id, m.status, m.created_at
  FROM public.messages m
  JOIN vis v ON v.id = m.conversation_id
  WHERE m.workspace_id = p_workspace_id;
$$;

COMMENT ON FUNCTION public.chat_visible_messages(uuid, text) IS
  'Los mensajes de las conversaciones que la persona puede ver, sin texto. El permiso se decide una vez por conversacion, con can_see_conversation (00305).';

REVOKE ALL ON FUNCTION public.chat_visible_messages(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_visible_messages(uuid, text) TO authenticated, service_role;

-- 2. Cifras, tendencias y agente, de una sola pasada --------------------------------
-- La logica es la de chat_episodes y chat_agent_episode_flags (00078, 00110),
-- chat_response_turns (00261) y las funciones de cada bloque. Lo que hay que respetar
-- para que den lo mismo:
--   - Episodios y esperas salen de TODA la historia y se asignan al periodo por su
--     inicio: un mensaje de hoy puede ser parte de un episodio que empezo ayer.
--   - Los episodios cuentan los envios fallidos; las esperas no (un envio que fallo
--     no le llego al lead y no cierra la espera).
--   - `p_prev_from` null es "no comparar" (Historico). `p_from` null es "sin limite".
--   - El autor filtra cifras y tiempo de respuesta. Las conversaciones nuevas de
--     Tendencias, el agente y "quien respondio primero" lo ignoran.
--   - Quien no es miembro recibe la misma forma: ceros, cinco filas y ocho semanas.
CREATE OR REPLACE FUNCTION public.chat_dashboard_core(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_prev_from timestamptz,
  p_prev_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL,
  p_tz text DEFAULT 'UTC',
  p_include_agent boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS MATERIALIZED (
    SELECT public.is_workspace_member(p_workspace_id) AS member,
           public.is_workspace_admin(p_workspace_id) AS admin
  ),
  vis AS MATERIALIZED (
    SELECT c.id
    FROM public.conversations c
    WHERE (SELECT me.member FROM me)
      AND c.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      AND CASE WHEN (SELECT me.admin FROM me) THEN true ELSE public.can_see_conversation(c) END
  ),
  gap AS MATERIALIZED (
    SELECT COALESCE(MIN(a.close_after_inactive_hours), 12) AS hours
    FROM public.agents a
    WHERE a.workspace_id = p_workspace_id AND a.deleted_at IS NULL
  ),
  msgs AS MATERIALIZED (
    SELECT m.id, m.conversation_id, m.direction, m.origin, m.sent_by_user_id, m.status, m.created_at,
           (m.created_at AT TIME ZONE p_tz)::date AS d,
           ((p_from IS NULL OR m.created_at >= p_from) AND (p_to IS NULL OR m.created_at <= p_to)) AS in_cur,
           (p_prev_from IS NOT NULL AND m.created_at >= p_prev_from AND (p_prev_to IS NULL OR m.created_at <= p_prev_to)) AS in_prev,
           (m.direction = 'outbound' AND public.chat_author_match(p_author, m.origin, m.sent_by_user_id)) AS out_match
    FROM public.messages m
    JOIN vis v ON v.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id
  ),

  -- Episodios -----------------------------------------------------------------
  ep_ordered AS (
    SELECT msgs.*, LAG(msgs.created_at) OVER (PARTITION BY msgs.conversation_id ORDER BY msgs.created_at) AS prev_at
    FROM msgs
  ),
  ep_starts AS (
    SELECT o.*,
      CASE WHEN o.direction = 'inbound'
             AND (o.prev_at IS NULL OR o.created_at - o.prev_at > ((SELECT gap.hours FROM gap) || ' hours')::interval)
           THEN 1 ELSE 0 END AS is_start
    FROM ep_ordered o
  ),
  ep_numbered AS (
    SELECT s.*, SUM(s.is_start) OVER (PARTITION BY s.conversation_id ORDER BY s.created_at ROWS UNBOUNDED PRECEDING) AS episode_no
    FROM ep_starts s
  ),
  episodes AS MATERIALIZED (
    SELECT g.*,
           LEAD(g.episode_start) OVER (PARTITION BY g.conversation_id ORDER BY g.episode_no) AS next_start,
           ((p_from IS NULL OR g.episode_start >= p_from) AND (p_to IS NULL OR g.episode_start <= p_to)) AS in_cur,
           (p_prev_from IS NOT NULL AND g.episode_start >= p_prev_from AND (p_prev_to IS NULL OR g.episode_start <= p_prev_to)) AS in_prev
    FROM (
      SELECT n.conversation_id,
             n.episode_no::integer AS episode_no,
             MIN(n.created_at) AS episode_start,
             (ARRAY_AGG(n.origin ORDER BY n.created_at) FILTER (WHERE n.direction = 'outbound'))[1] AS first_outbound_origin,
             -- "En las que participo": el autor mando algo en el episodio, dentro del periodo.
             COALESCE(BOOL_OR(n.out_match AND n.in_cur), false) AS touched_cur,
             COALESCE(BOOL_OR(n.out_match AND n.in_prev), false) AS touched_prev
      FROM ep_numbered n
      WHERE n.episode_no >= 1
      GROUP BY n.conversation_id, n.episode_no
    ) g
  ),

  -- Cifras ----------------------------------------------------------------------
  msg_totals AS (
    SELECT
      COUNT(*) FILTER (WHERE direction = 'inbound' AND in_cur) AS in_cur,
      COUNT(*) FILTER (WHERE out_match AND in_cur) AS out_cur,
      COUNT(*) FILTER (WHERE direction = 'inbound' AND in_prev) AS in_prev,
      COUNT(*) FILTER (WHERE out_match AND in_prev) AS out_prev
    FROM msgs
  ),
  ep_totals AS (
    SELECT
      COUNT(*) FILTER (WHERE in_cur AND (p_author IS NULL OR p_author = 'all' OR touched_cur)) AS cur,
      COUNT(*) FILTER (WHERE in_prev AND (p_author IS NULL OR p_author = 'all' OR touched_prev)) AS prev
    FROM episodes
  ),

  -- Esperas del lead ---------------------------------------------------------------
  turn_marked AS (
    SELECT m.id, m.conversation_id, m.direction, m.origin, m.sent_by_user_id, m.created_at,
      CASE WHEN m.direction = 'inbound'
                AND LAG(m.direction) OVER (PARTITION BY m.conversation_id ORDER BY m.created_at, m.id) IS DISTINCT FROM 'inbound'
           THEN 1 ELSE 0 END AS is_start
    FROM msgs m
    WHERE NOT (m.direction = 'outbound' AND m.status IS NOT DISTINCT FROM 'failed')
  ),
  turn_grouped AS (
    SELECT t.*, SUM(t.is_start) OVER (PARTITION BY t.conversation_id ORDER BY t.created_at, t.id ROWS UNBOUNDED PRECEDING) AS turn_no
    FROM turn_marked t
  ),
  turn_raw AS (
    SELECT g.conversation_id,
      MIN(g.created_at) FILTER (WHERE g.direction = 'inbound') AS started_at,
      MAX(g.created_at) FILTER (WHERE g.direction = 'inbound') AS last_inbound_at,
      MIN(g.created_at) FILTER (WHERE g.direction = 'outbound') AS replied_at,
      (ARRAY_AGG(g.origin ORDER BY g.created_at, g.id) FILTER (WHERE g.direction = 'outbound'))[1] AS reply_origin,
      (ARRAY_AGG(g.sent_by_user_id ORDER BY g.created_at, g.id) FILTER (WHERE g.direction = 'outbound'))[1] AS reply_user_id
    FROM turn_grouped g
    WHERE g.turn_no >= 1
    GROUP BY g.conversation_id, g.turn_no
  ),
  turns AS MATERIALIZED (
    SELECT t.started_at,
      EXTRACT(EPOCH FROM (t.replied_at - t.started_at)) AS response_seconds,
      ((p_from IS NULL OR t.started_at >= p_from) AND (p_to IS NULL OR t.started_at <= p_to)) AS in_cur,
      (p_prev_from IS NOT NULL AND t.started_at >= p_prev_from AND (p_prev_to IS NULL OR t.started_at <= p_prev_to)) AS in_prev
    FROM turn_raw t
    WHERE t.replied_at IS NOT NULL
      AND CASE
        WHEN p_author IS NULL OR p_author = 'all'
          THEN public.chat_reply_is_human(t.reply_origin, t.reply_user_id, EXTRACT(EPOCH FROM (t.replied_at - t.last_inbound_at)))
        WHEN p_author IN ('agent', 'automations')
          THEN public.chat_author_match(p_author, t.reply_origin, t.reply_user_id)
        ELSE public.chat_reply_is_human(t.reply_origin, t.reply_user_id, EXTRACT(EPOCH FROM (t.replied_at - t.last_inbound_at)))
             AND public.chat_author_match(p_author, t.reply_origin, t.reply_user_id)
      END
  ),
  response AS (
    SELECT
      AVG(response_seconds) FILTER (WHERE in_cur) AS avg_cur,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_seconds) FILTER (WHERE in_cur) AS med_cur,
      COUNT(*) FILTER (WHERE in_cur) AS n_cur,
      AVG(response_seconds) FILTER (WHERE in_prev) AS avg_prev,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_seconds) FILTER (WHERE in_prev) AS med_prev,
      COUNT(*) FILTER (WHERE in_prev) AS n_prev
    FROM turns
  ),
  response_daily AS (
    SELECT (started_at AT TIME ZONE p_tz)::date AS day, COUNT(*) AS turns, SUM(response_seconds) AS total_seconds
    FROM turns
    WHERE in_cur
    GROUP BY 1
  ),

  -- Tendencias ----------------------------------------------------------------------
  bounds AS (
    SELECT
      COALESCE((p_from AT TIME ZONE p_tz)::date, (SELECT MIN(msgs.d) FROM msgs)) AS d0,
      LEAST(COALESCE((p_to AT TIME ZONE p_tz)::date, (now() AT TIME ZONE p_tz)::date), (now() AT TIME ZONE p_tz)::date) AS d1
  ),
  days AS (
    -- Todos los dias del periodo: un dia sin mensajes vale cero y el grafico tiene
    -- que mostrar ese hueco en su lugar.
    SELECT generate_series(b.d0::timestamp, b.d1::timestamp, interval '1 day')::date AS d
    FROM bounds b
    WHERE b.d0 IS NOT NULL AND b.d1 >= b.d0
  ),
  per_day AS (
    SELECT m.d,
      COUNT(*) FILTER (WHERE m.direction = 'inbound') AS m_in,
      COUNT(*) FILTER (WHERE m.out_match) AS m_out,
      COUNT(*) FILTER (WHERE m.out_match AND public.chat_origin_group(m.origin) = 'agent') AS s_agent,
      COUNT(*) FILTER (WHERE m.out_match AND public.chat_origin_group(m.origin) = 'team') AS s_team,
      COUNT(*) FILTER (WHERE m.out_match AND public.chat_origin_group(m.origin) = 'automations') AS s_auto,
      COUNT(*) FILTER (WHERE m.out_match AND public.chat_origin_group(m.origin) = 'external') AS s_ext
    FROM msgs m
    WHERE m.in_cur
    GROUP BY m.d
  ),
  eps_day AS (
    SELECT (e.episode_start AT TIME ZONE p_tz)::date AS d, COUNT(*) AS n
    FROM episodes e
    WHERE e.in_cur
    GROUP BY 1
  ),

  -- El agente -----------------------------------------------------------------------
  weeks AS (
    SELECT generate_series(
             date_trunc('week', (now() AT TIME ZONE p_tz)) - interval '7 weeks',
             date_trunc('week', (now() AT TIME ZONE p_tz)),
             interval '1 week'
           )::date AS w
  ),
  flags AS MATERIALIZED (
    SELECT e.episode_start, e.in_cur, e.in_prev,
      (
        e.first_outbound_origin = 'agent'
        OR EXISTS (
          SELECT 1 FROM public.agent_drafts d
          WHERE d.conversation_id = e.conversation_id
            AND d.created_at >= e.episode_start
            AND (e.next_start IS NULL OR d.created_at < e.next_start)
        )
        OR EXISTS (
          SELECT 1 FROM public.audit_log al
          WHERE al.entity_id = e.conversation_id
            AND al.performed_by_agent_id IS NOT NULL
            AND al.performed_at >= e.episode_start
            AND (e.next_start IS NULL OR al.performed_at < e.next_start)
        )
      ) AS acted,
      (e.first_outbound_origin = 'agent') AS took_first,
      (
        EXISTS (
          SELECT 1 FROM public.agent_runs r
          WHERE r.conversation_id = e.conversation_id
            AND r.status = 'escalated'
            AND r.created_at >= e.episode_start
            AND (e.next_start IS NULL OR r.created_at < e.next_start)
        )
        OR EXISTS (
          SELECT 1 FROM public.audit_log al2
          WHERE al2.entity_id = e.conversation_id
            AND al2.action = 'human_takeover'
            AND al2.performed_by_agent_id IS NOT NULL
            AND al2.performed_at >= e.episode_start
            AND (e.next_start IS NULL OR al2.performed_at < e.next_start)
        )
      ) AS escalated
    FROM episodes e
    WHERE p_include_agent
      -- Solo lo que se va a mostrar: el periodo, el anterior y las ocho semanas.
      AND (p_from IS NULL OR e.episode_start >= LEAST(p_from, p_prev_from, (SELECT MIN(weeks.w) FROM weeks)))
  ),
  agent_totals AS (
    SELECT
      COUNT(*) FILTER (WHERE in_cur) AS n_cur,
      COUNT(*) FILTER (WHERE in_cur AND acted) AS acted_cur,
      COUNT(*) FILTER (WHERE in_cur AND took_first) AS first_cur,
      COUNT(*) FILTER (WHERE in_cur AND escalated) AS esc_cur,
      COUNT(*) FILTER (WHERE in_prev) AS n_prev,
      COUNT(*) FILTER (WHERE in_prev AND acted) AS acted_prev,
      COUNT(*) FILTER (WHERE in_prev AND took_first) AS first_prev,
      COUNT(*) FILTER (WHERE in_prev AND escalated) AS esc_prev
    FROM flags
  ),
  agent_weeks AS (
    SELECT weeks.w,
      COUNT(f.w) AS new_conversations,
      COUNT(*) FILTER (WHERE f.acted) AS acted,
      COUNT(*) FILTER (WHERE f.took_first) AS took_first,
      COUNT(*) FILTER (WHERE f.escalated) AS escalated
    FROM weeks
    LEFT JOIN (
      SELECT date_trunc('week', (flags.episode_start AT TIME ZONE p_tz))::date AS w, flags.acted, flags.took_first, flags.escalated
      FROM flags
      WHERE flags.episode_start >= (SELECT MIN(weeks.w) FROM weeks)
    ) f ON f.w = weeks.w
    GROUP BY weeks.w
  ),
  responder_keys AS (
    SELECT * FROM (VALUES ('agent'), ('automations'), ('team'), ('external'), ('unanswered')) AS k(responder)
  ),
  responders AS (
    -- Siempre las cinco filas, incluso en cero: la barra necesita saber que ese
    -- pedazo existe y vale cero, que no es lo mismo que no saberlo.
    SELECT k.responder, COUNT(e.responder) AS episodes
    FROM responder_keys k
    LEFT JOIN (
      SELECT COALESCE(public.chat_origin_group(episodes.first_outbound_origin), 'unanswered') AS responder
      FROM episodes
      WHERE episodes.in_cur
    ) e ON e.responder = k.responder
    GROUP BY k.responder
  )
  SELECT jsonb_build_object(
    'numbers', jsonb_build_object('new_conversations', et.cur, 'messages_in', mt.in_cur, 'messages_out', mt.out_cur),
    'numbers_prev', CASE WHEN p_prev_from IS NULL THEN NULL
      ELSE jsonb_build_object('new_conversations', et.prev, 'messages_in', mt.in_prev, 'messages_out', mt.out_prev) END,
    'response', jsonb_build_object('avg_seconds', r.avg_cur, 'median_seconds', r.med_cur, 'turns', r.n_cur),
    'response_prev', CASE WHEN p_prev_from IS NULL THEN NULL
      ELSE jsonb_build_object('avg_seconds', r.avg_prev, 'median_seconds', r.med_prev, 'turns', r.n_prev) END,
    'trends', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'day', days.d,
        'messages_in', COALESCE(p.m_in, 0),
        'messages_out', COALESCE(p.m_out, 0),
        'new_conversations', COALESCE(e.n, 0),
        'sent_agent', COALESCE(p.s_agent, 0),
        'sent_team', COALESCE(p.s_team, 0),
        'sent_automations', COALESCE(p.s_auto, 0),
        'sent_external', COALESCE(p.s_ext, 0)
      ) ORDER BY days.d)
      FROM days
      LEFT JOIN per_day p ON p.d = days.d
      LEFT JOIN eps_day e ON e.d = days.d
    ), '[]'::jsonb),
    'response_daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', rd.day, 'turns', rd.turns, 'total_seconds', rd.total_seconds) ORDER BY rd.day)
      FROM response_daily rd
    ), '[]'::jsonb),
    'first_responder', CASE WHEN p_include_agent THEN (
      SELECT jsonb_agg(jsonb_build_object('responder', rs.responder, 'episodes', rs.episodes)) FROM responders rs
    ) END,
    'agent', CASE WHEN p_include_agent THEN jsonb_build_object(
      'new_conversations', a.n_cur, 'agent_acted', a.acted_cur, 'agent_took_first', a.first_cur, 'agent_escalated', a.esc_cur
    ) END,
    'agent_prev', CASE WHEN p_include_agent AND p_prev_from IS NOT NULL THEN jsonb_build_object(
      'new_conversations', a.n_prev, 'agent_acted', a.acted_prev, 'agent_took_first', a.first_prev, 'agent_escalated', a.esc_prev
    ) END,
    'agent_weekly', CASE WHEN p_include_agent THEN (
      SELECT jsonb_agg(jsonb_build_object(
        'week_start', w.w, 'new_conversations', w.new_conversations, 'acted', w.acted, 'took_first', w.took_first, 'escalated', w.escalated
      ) ORDER BY w.w) FROM agent_weeks w
    ) END
  )
  FROM ep_totals et, msg_totals mt, response r, agent_totals a;
$$;

COMMENT ON FUNCTION public.chat_dashboard_core(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text, text, text, boolean) IS
  'Cifras, tendencias y seccion del agente del dashboard de Chat, de una sola pasada. Misma logica que las funciones de cada bloque (00078, 00110, 00261); el permiso se decide una vez por conversacion con can_see_conversation.';

REVOKE ALL ON FUNCTION public.chat_dashboard_core(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_core(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text, text, text, boolean) TO authenticated, service_role;

-- 3. "Quien responde" ----------------------------------------------------------------
-- Misma logica que chat_dashboard_team (00110), leyendo los mensajes por
-- chat_visible_messages y numerando los episodios sobre esa misma lectura. Sigue
-- INVOKER: `handoff` y `esc` leen `audit_log`, y lo que ve cada rol ahi depende de
-- `audit.view`.
CREATE OR REPLACE FUNCTION public.chat_dashboard_team_v2(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  author text,
  conversations bigint,
  messages_out bigint,
  first_response_median_seconds numeric,
  reply_median_seconds numeric,
  replies_under_1h_pct numeric,
  escalations_received bigint,
  drafts_approved bigint,
  drafts_approved_unedited_pct numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH base AS MATERIALIZED (
    SELECT * FROM public.chat_visible_messages(p_workspace_id, p_channel)
  ),
  gap AS MATERIALIZED (
    SELECT COALESCE(MIN(a.close_after_inactive_hours), 12) AS hours
    FROM public.agents a WHERE a.workspace_id = p_workspace_id AND a.deleted_at IS NULL
  ),
  ep_ordered AS (
    SELECT b.*,
           LAG(b.direction) OVER w AS prev_dir,
           LAG(b.created_at) OVER w AS prev_at
    FROM base b
    WINDOW w AS (PARTITION BY b.conversation_id ORDER BY b.created_at)
  ),
  ep_starts AS (
    SELECT o.*,
      CASE WHEN o.direction = 'inbound'
             AND (o.prev_at IS NULL OR o.created_at - o.prev_at > ((SELECT gap.hours FROM gap) || ' hours')::interval)
           THEN 1 ELSE 0 END AS is_start
    FROM ep_ordered o
  ),
  ep_numbered AS (
    SELECT s.*, SUM(s.is_start) OVER (PARTITION BY s.conversation_id ORDER BY s.created_at ROWS UNBOUNDED PRECEDING) AS episode_no
    FROM ep_starts s
  ),
  -- Cada mensaje ya sabe de que episodio es, sin unir mensajes con episodios por rango:
  -- esa union crecia al cuadrado y se cortaba por tiempo con unas miles de conversaciones.
  numbered AS MATERIALIZED (
    SELECT n.*,
      MIN(n.created_at) OVER e AS episode_start,
      MIN(n.created_at) FILTER (WHERE n.direction = 'inbound') OVER e AS first_inbound_at,
      CASE
        WHEN n.origin = 'user' THEN COALESCE(n.sent_by_user_id::text, 'user')
        ELSE public.chat_origin_group(n.origin)
      END AS author
    FROM ep_numbered n
    WINDOW e AS (PARTITION BY n.conversation_id, n.episode_no)
  ),
  outs AS MATERIALIZED (
    SELECT * FROM numbered n WHERE n.direction = 'outbound' AND n.author IS NOT NULL
  ),
  outs_p AS (
    SELECT * FROM outs
    WHERE (p_from IS NULL OR outs.created_at >= p_from) AND (p_to IS NULL OR outs.created_at <= p_to)
  ),
  sent AS (
    SELECT outs_p.author, COUNT(*) AS n FROM outs_p GROUP BY outs_p.author
  ),
  replies AS (
    -- "Respuesta": cada saliente cuyo mensaje anterior es del lead, contado
    -- desde ese entrante (§11.4).
    SELECT outs_p.author,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (outs_p.created_at - outs_p.prev_at))) AS reply_med,
           ROUND(100.0 * COUNT(*) FILTER (WHERE outs_p.created_at - outs_p.prev_at < interval '1 hour') / NULLIF(COUNT(*), 0), 1) AS under1h
    FROM outs_p WHERE outs_p.prev_dir = 'inbound'
    GROUP BY outs_p.author
  ),
  author_ep AS MATERIALIZED (
    -- El primer saliente de cada autor en cada episodio. Un saliente anterior al
    -- primer entrante no es de ningun episodio.
    SELECT o.author, o.conversation_id, o.episode_no, o.episode_start, o.first_inbound_at, o.contact_id,
           MIN(o.created_at) AS author_first_out,
           BOOL_OR((p_from IS NULL OR o.created_at >= p_from) AND (p_to IS NULL OR o.created_at <= p_to)) AS in_period
    FROM outs o
    WHERE o.episode_no >= 1
    GROUP BY o.author, o.conversation_id, o.episode_no, o.episode_start, o.first_inbound_at, o.contact_id
  ),
  handoff_events AS MATERIALIZED (
    -- Una sola lectura de `audit_log`, con lo que este rol puede ver ahi.
    SELECT al.entity_type, al.entity_id, al.action, al.performed_at, al.changes
    FROM public.audit_log al
    WHERE al.workspace_id = p_workspace_id
      AND al.action IN ('assign', 'human_takeover')
      AND al.entity_type IN ('conversation', 'contact')
  ),
  handoff AS (
    -- Para una PERSONA, su tiempo se cuenta desde que la conversacion le fue
    -- asignada o derivada, no desde que escribio el lead: antes de eso no era
    -- suya (§11.4). Para los grupos no hay asignacion y queda el primer
    -- entrante del episodio.
    SELECT h.author, h.conversation_id, h.episode_no, MAX(h.performed_at) AS assigned_at
    FROM (
      SELECT ae.author, ae.conversation_id, ae.episode_no, ev.performed_at
      FROM author_ep ae
      JOIN handoff_events ev ON ev.entity_type = 'conversation' AND ev.entity_id = ae.conversation_id
      WHERE ae.author ~ '^[0-9a-f-]{36}$'
        AND ev.performed_at >= ae.episode_start
        AND ev.performed_at < ae.author_first_out
        AND ((ev.action = 'assign' AND ev.changes->'assigned_to'->>'new' = ae.author) OR ev.action = 'human_takeover')
      UNION ALL
      SELECT ae.author, ae.conversation_id, ae.episode_no, ev.performed_at
      FROM author_ep ae
      JOIN handoff_events ev ON ev.entity_type = 'contact' AND ev.entity_id = ae.contact_id
      WHERE ae.author ~ '^[0-9a-f-]{36}$'
        AND ev.performed_at >= ae.episode_start
        AND ev.performed_at < ae.author_first_out
        AND ev.action = 'assign'
        AND (ev.changes->'setter_id'->>'new' = ae.author OR ev.changes->'vendedor_id'->>'new' = ae.author)
    ) h
    GROUP BY h.author, h.conversation_id, h.episode_no
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
    SELECT sent.author FROM sent
    UNION SELECT esc.author FROM esc
    UNION SELECT drafts.author FROM drafts
  )
  SELECT
    a.author,
    COALESCE(fr.conversations, 0),
    COALESCE(s.n, 0),
    fr.first_med::numeric,
    rp.reply_med::numeric,
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_team_v2(uuid, timestamptz, timestamptz, text) IS
  'La tabla de quien responde: misma logica que chat_dashboard_team, leyendo los mensajes de una sola pasada por chat_visible_messages (00305).';

REVOKE ALL ON FUNCTION public.chat_dashboard_team_v2(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_team_v2(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;

-- 4. Patrones -------------------------------------------------------------------------
-- Copia de chat_dashboard_patterns (00111). Es la unica lectura con el texto de los
-- mensajes, y por eso no hay ninguna funcion publica que devuelva texto por filas.
-- `me.member` corta tambien `message_texts` y `message_categories`: vaciar los
-- mensajes no alcanza, un no miembro veria los nombres de las categorias en cero.
-- El EXISTS de "obtuvo respuesta" lee `messages` sin chequeo extra: es la misma
-- conversacion, que ya es visible, y solo devuelve si hubo o no.
CREATE OR REPLACE FUNCTION public.chat_dashboard_patterns_v2(
  p_workspace_id uuid,
  p_direction text,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL
)
RETURNS TABLE (
  category_id uuid,
  category_name text,
  description text,
  is_fallback boolean,
  message_count bigint,
  text_count bigint,
  top_author text,
  reply_rate numeric,
  rank integer,
  top_variants jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS MATERIALIZED (
    SELECT public.is_workspace_member(p_workspace_id) AS member,
           public.is_workspace_admin(p_workspace_id) AS admin
  ),
  vis AS MATERIALIZED (
    SELECT c.id
    FROM public.conversations c
    WHERE (SELECT me.member FROM me)
      AND c.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      AND CASE WHEN (SELECT me.admin FROM me) THEN true ELSE public.can_see_conversation(c) END
  ),
  msgs AS MATERIALIZED (
    SELECT
      m.id, m.text, m.text_norm, m.conversation_id, m.created_at,
      CASE
        WHEN m.origin = 'user' THEN COALESCE(m.sent_by_user_id::text, 'user')
        ELSE public.chat_origin_group(m.origin)
      END AS author
    FROM public.messages m
    JOIN vis v ON v.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id
      AND m.direction = p_direction
      AND m.text_norm IS NOT NULL
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
      -- El filtro de autor solo tiene sentido sobre los salientes: un mensaje
      -- del lead no lo "respondio" nadie.
      AND (p_direction <> 'outbound' OR public.chat_author_match(p_author, m.origin, m.sent_by_user_id))
  ),
  replied AS (
    -- §11.7: un saliente "obtuvo respuesta" si el lead escribio algo en las 24 h
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
  texts AS MATERIALIZED (
    SELECT t.id, t.category_id, t.normalized_text, t.sample_text, t.confidence, t.source, t.is_button,
           COALESCE(r.n, 0) AS msg_n,
           COALESCE(r.n_replied, 0) AS msg_replied
    FROM public.message_texts t
    LEFT JOIN replied r ON r.text_norm = t.normalized_text
    WHERE (SELECT me.member FROM me)
      AND t.workspace_id = p_workspace_id AND t.direction = p_direction
  ),
  spellings AS MATERIALIZED (
    -- Una sola vez, para no repasar todos los mensajes por cada variante.
    SELECT m.text_norm, m.text AS txt, COUNT(*) AS n
    FROM msgs m
    -- Un mensaje sin texto (solo un adjunto) comparte el normalizado vacio con otros:
    -- sin esto, "También: …" salia con un null y una cadena vacia adentro.
    WHERE m.text IS NOT NULL AND btrim(m.text) <> ''
    GROUP BY m.text_norm, m.text
  ),
  cat_author AS (
    -- El autor principal de la categoria: quien manda mas mensajes de ese grupo.
    SELECT x.category_id, x.author, x.n,
           ROW_NUMBER() OVER (PARTITION BY x.category_id ORDER BY x.n DESC, x.author) AS rn
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
    (ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(t.msg_n), 0) DESC, c.name))::integer AS rank,
    COALESCE((
      SELECT jsonb_agg(top.v ORDER BY top.n DESC) FROM (
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
                   -- Con desempate: dos escrituras igual de frecuentes no pueden
                   -- cambiar de lugar entre una carga y la siguiente.
                   SELECT jsonb_agg(sp.txt ORDER BY sp.n DESC, sp.txt) FROM (
                     SELECT s.txt, s.n
                     FROM spellings s
                     WHERE s.text_norm = t2.normalized_text
                       AND s.txt IS DISTINCT FROM t2.sample_text
                     ORDER BY s.n DESC, s.txt
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
  WHERE (SELECT me.member FROM me)
    AND c.workspace_id = p_workspace_id AND c.direction = p_direction AND c.archived_at IS NULL
  GROUP BY c.id, c.name, c.description, c.is_fallback
  ORDER BY COALESCE(SUM(t.msg_n), 0) DESC, c.name;
$$;

COMMENT ON FUNCTION public.chat_dashboard_patterns_v2(uuid, text, timestamptz, timestamptz, text, text) IS
  'Patrones de mensajes: misma logica que chat_dashboard_patterns, con el permiso decidido una vez por conversacion (00305).';

REVOKE ALL ON FUNCTION public.chat_dashboard_patterns_v2(uuid, text, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_patterns_v2(uuid, text, timestamptz, timestamptz, text, text) TO authenticated, service_role;

-- 5. Para saber rapido que hizo el agente en una conversacion -------------------------
-- Ningun indice de audit_log empieza por entity_id, y los flags lo buscan por cada
-- episodio.
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_agent
  ON public.audit_log (entity_id, performed_at DESC)
  WHERE performed_by_agent_id IS NOT NULL;
