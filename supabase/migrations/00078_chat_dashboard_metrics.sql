-- ============================================================================
-- 00078 — Funciones de métricas del dashboard de Chat (Bloque 3, F15)
-- ============================================================================
-- Todas SECURITY INVOKER: se llaman con el cliente del usuario, así la RLS de
-- messages/conversations aplica el scope de leads (un Member ve solo lo suyo).
-- Reciben los mismos filtros (p_from, p_to, p_channel, p_author) y cortan los
-- días en la zona del workspace. "Período anterior" se calcula del lado de la
-- app y se pasa como otro rango.
--
-- No crean tablas: los episodios se derivan con una función (§12.4).
-- Idempotente (CREATE OR REPLACE) y aditiva.
-- ============================================================================

-- Episodios (§11.3): un episodio arranca con un entrante que es el primero de
-- la conversación, o el primero tras una inactividad mayor que
-- close_after_inactive_hours. Termina con el siguiente arranque o el final.
CREATE OR REPLACE FUNCTION public.chat_episodes(
  p_workspace_id uuid,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  conversation_id uuid,
  contact_id uuid,
  channel_id uuid,
  episode_no integer,
  episode_start timestamptz,
  first_inbound_at timestamptz,
  first_outbound_at timestamptz,
  first_outbound_origin text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
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
$$;

-- Filtro "respondido por" aplicado a los salientes: 'all'/NULL = todos;
-- 'agent'/'user'/'flow'/'sequence'/'broadcast'/'external' = ese origin;
-- un uuid = ese sent_by_user_id. Devuelve true si el saliente entra.
CREATE OR REPLACE FUNCTION public.chat_author_match(p_author text, p_origin text, p_sent_by_user uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_author IS NULL OR p_author = 'all' THEN true
    WHEN p_author = 'automations' THEN p_origin IN ('flow', 'sequence', 'broadcast')
    WHEN p_author IN ('agent', 'user', 'external') THEN p_origin = p_author
    WHEN p_author ~ '^[0-9a-f-]{36}$' THEN p_sent_by_user::text = p_author
    ELSE false
  END;
$$;

-- Números principales (§11.1, §11.4). Un rango; la app llama dos veces para el
-- período anterior. Devuelve una fila.
CREATE OR REPLACE FUNCTION public.chat_dashboard_numbers(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL
)
RETURNS TABLE (
  new_conversations bigint,
  messages_in bigint,
  messages_out bigint,
  first_response_median_seconds numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH ep AS (
    SELECT * FROM public.chat_episodes(p_workspace_id, p_channel)
  ),
  msgs AS (
    SELECT m.direction, m.origin, m.sent_by_user_id, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
  )
  SELECT
    (SELECT COUNT(*) FROM ep
       WHERE (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to)),
    (SELECT COUNT(*) FROM msgs WHERE direction = 'inbound'),
    (SELECT COUNT(*) FROM msgs WHERE direction = 'outbound'
       AND public.chat_author_match(p_author, origin, sent_by_user_id)),
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_outbound_at - first_inbound_at)))
       FROM ep
       WHERE first_inbound_at IS NOT NULL AND first_outbound_at IS NOT NULL
         AND first_outbound_at >= first_inbound_at
         AND (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to));
$$;

-- Esperando respuesta ahora (§11.9): conversaciones abiertas, no borradas, sin
-- do_not_contact ni agent_disabled_by_tag_id, con último mensaje entrante de
-- hace más de 1 hora.
CREATE OR REPLACE FUNCTION public.chat_waiting_now(
  p_workspace_id uuid,
  p_channel text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
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
$$;

-- Tabla "Quién responde" (§11.4, §15.2). Una fila por autor (agente + cada
-- persona). Tiempos en segundos (mediana). RLS aplica el scope.
CREATE OR REPLACE FUNCTION public.chat_dashboard_team(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  author text,
  messages_out bigint,
  first_response_median_seconds numeric,
  reply_median_seconds numeric,
  replies_under_1h_pct numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH outs AS (
    SELECT
      CASE WHEN m.origin = 'user' THEN m.sent_by_user_id::text ELSE m.origin END AS author,
      m.conversation_id, m.created_at,
      LAG(m.direction) OVER (PARTITION BY m.conversation_id ORDER BY m.created_at) AS prev_dir,
      LAG(m.created_at) OVER (PARTITION BY m.conversation_id ORDER BY m.created_at) AS prev_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  replies AS (
    SELECT author, EXTRACT(EPOCH FROM (created_at - prev_at)) AS secs
    FROM outs
    WHERE prev_dir = 'inbound' AND author IS NOT NULL
      AND (p_from IS NULL OR created_at >= p_from) AND (p_to IS NULL OR created_at <= p_to)
  ),
  sent AS (
    SELECT author, COUNT(*) AS n
    FROM outs
    WHERE author IS NOT NULL
      AND (p_from IS NULL OR created_at >= p_from) AND (p_to IS NULL OR created_at <= p_to)
    GROUP BY author
  )
  SELECT s.author, s.n,
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs) FROM replies r0 WHERE r0.author = s.author) AS first_resp,
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs) FROM replies r1 WHERE r1.author = s.author) AS reply_med,
    (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE secs < 3600) / NULLIF(COUNT(*), 0), 1) FROM replies r2 WHERE r2.author = s.author) AS under1h
  FROM sent s;
$$;

-- Sección del agente (§11.5): actuó, tomó desde el primer mensaje, derivó.
-- Sobre las conversaciones nuevas (episodios) del período.
CREATE OR REPLACE FUNCTION public.chat_dashboard_agent(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  new_conversations bigint,
  agent_acted bigint,
  agent_took_first bigint,
  agent_escalated bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH ep AS (
    SELECT * FROM public.chat_episodes(p_workspace_id, p_channel)
    WHERE (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to)
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE first_outbound_origin = 'agent'
      OR EXISTS (SELECT 1 FROM public.agent_drafts d WHERE d.conversation_id = ep.conversation_id)
      OR EXISTS (SELECT 1 FROM public.audit_log al WHERE al.entity_id = ep.conversation_id AND al.performed_by_agent_id IS NOT NULL)),
    COUNT(*) FILTER (WHERE first_outbound_origin = 'agent'),
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.agent_runs r WHERE r.conversation_id = ep.conversation_id AND r.status = 'escalated'))
  FROM ep;
$$;

REVOKE ALL ON FUNCTION public.chat_episodes(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_author_match(text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_numbers(uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_waiting_now(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_team(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_agent(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_episodes(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_author_match(text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_numbers(uuid, timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_waiting_now(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_team(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_agent(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;

-- Series de tendencias por día (F16). La app agrupa a semanal si el período
-- supera 62 días. Corta los días en la zona que se pasa.
CREATE OR REPLACE FUNCTION public.chat_dashboard_trends(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL,
  p_tz text DEFAULT 'America/Costa_Rica'
)
RETURNS TABLE (day date, messages_in bigint, messages_out bigint, new_conversations bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH msgs AS (
    SELECT (m.created_at AT TIME ZONE p_tz)::date AS d, m.direction, m.origin, m.sent_by_user_id
    FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      AND (p_from IS NULL OR m.created_at >= p_from) AND (p_to IS NULL OR m.created_at <= p_to)
  ),
  eps AS (
    SELECT (episode_start AT TIME ZONE p_tz)::date AS d
    FROM public.chat_episodes(p_workspace_id, p_channel)
    WHERE (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to)
  ),
  days AS (
    SELECT d FROM msgs UNION SELECT d FROM eps
  )
  SELECT d,
    (SELECT COUNT(*) FROM msgs WHERE msgs.d = days.d AND direction = 'inbound'),
    (SELECT COUNT(*) FROM msgs WHERE msgs.d = days.d AND direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id)),
    (SELECT COUNT(*) FROM eps WHERE eps.d = days.d)
  FROM days ORDER BY d;
$$;

REVOKE ALL ON FUNCTION public.chat_dashboard_trends(uuid, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_trends(uuid, timestamptz, timestamptz, text, text, text) TO authenticated, service_role;
