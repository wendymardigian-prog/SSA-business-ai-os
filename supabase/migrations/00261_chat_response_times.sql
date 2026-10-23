-- ============================================================================
-- 00261 — Tiempo de respuesta de las personas (reemplaza a "Primera respuesta")
-- ============================================================================
-- "Primera respuesta" (00078/00110) medía solo el primer mensaje de cada
-- episodio y contaba cualquier respuesta. El 23/10/2026 daba 3 segundos: 147 de
-- 185 "primeras respuestas" eran otra herramienta (ManyChat) contestando sola en
-- 2 segundos, no el equipo.
--
-- Ahora se mide TODA espera del lead, no solo la primera, y por defecto solo las
-- que respondió una persona:
--
--   - Una espera (turno) es una tanda de mensajes seguidos del lead; la cierra
--     el primer saliente que no falló, de quien sea.
--   - El tiempo va desde el PRIMER mensaje sin responder de la tanda.
--   - Quién respondió lo decide public.chat_reply_is_human, GEMELA de
--     isHumanReply (lib/messages/reply-time.ts, casos en reply-time.cases.json):
--     persona desde el sistema o borrador aprobado = humana; agente en envío
--     directo, flows, secuencias y broadcasts = automática; desde fuera del
--     sistema = humana salvo que salga en menos de 15 s.
--   - La bandeja muestra el mismo cálculo al lado de cada respuesta
--     (replyTimesByMessage): el número del chat y el del dashboard coinciden.
--
-- Funciones nuevas, todas SECURITY INVOKER (la RLS aplica el alcance de leads).
-- No toca chat_dashboard_numbers ni chat_dashboard_trends: la app deja de leer su
-- columna de primera respuesta y las dos quedan para volver atrás.
--
-- Idempotente y aditiva.
-- ============================================================================

-- 1. ¿La respondió una persona? ------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_reply_is_human(
  p_origin text,
  p_sent_by_user_id uuid,
  p_seconds_since_last_inbound numeric
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_origin = 'user' THEN true
    WHEN p_origin = 'agent' THEN p_sent_by_user_id IS NOT NULL
    WHEN p_origin IN ('flow', 'sequence', 'broadcast') THEN false
    ELSE COALESCE(p_seconds_since_last_inbound, 0) >= 15
  END;
$$;

COMMENT ON FUNCTION public.chat_reply_is_human(text, uuid, numeric) IS
  'Si una respuesta la dio una persona. Gemela de isHumanReply (lib/messages/reply-time.ts). Desde fuera del sistema, menos de 15 s despues del lead = automatica.';

REVOKE ALL ON FUNCTION public.chat_reply_is_human(text, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_reply_is_human(text, uuid, numeric) TO authenticated, service_role;

-- 2. Las esperas del lead --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_response_turns(
  p_workspace_id uuid,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  conversation_id uuid,
  started_at timestamptz,
  last_inbound_at timestamptz,
  replied_at timestamptz,
  reply_origin text,
  reply_user_id uuid,
  is_human boolean,
  response_seconds numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_response_turns(uuid, text) IS
  'Cada espera del lead (tanda de mensajes seguidos) con quien la cerro y cuanto tardo, desde el primer mensaje sin responder. Base del tiempo de respuesta (00261).';

-- 3. El número del dashboard -----------------------------------------------------
-- Por defecto, solo las esperas que cerró una persona. Con el filtro "Respondido
-- por" en el agente o las automatizaciones, las de ese autor; con una persona,
-- las suyas (incluye los borradores que aprobó).
CREATE OR REPLACE FUNCTION public.chat_dashboard_response_time(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL
)
RETURNS TABLE (avg_seconds numeric, median_seconds numeric, turns bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_response_time(uuid, timestamptz, timestamptz, text, text) IS
  'Tiempo de respuesta del periodo: promedio y mediana, en segundos, de las esperas que cerro una persona (o el autor filtrado). Las esperas se asignan al periodo por su primer mensaje.';

-- 4. La serie diaria de Tendencias ------------------------------------------------
-- Suma y cantidad, no el promedio: así la semana se arma bien (promediar
-- promedios diarios le daría el mismo peso a un día con una espera que a uno
-- con cien).
CREATE OR REPLACE FUNCTION public.chat_dashboard_response_time_daily(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL,
  p_tz text DEFAULT 'UTC'
)
RETURNS TABLE (day date, turns bigint, total_seconds numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_response_time_daily(uuid, timestamptz, timestamptz, text, text, text) IS
  'Por dia (en la zona pedida): cuantas esperas cerro una persona (o el autor filtrado) y la suma de sus tiempos. La app divide y agrupa por semana.';

-- 5. Permisos ----------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.chat_response_turns(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_response_time(uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_response_time_daily(uuid, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_response_turns(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_response_time(uuid, timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_response_time_daily(uuid, timestamptz, timestamptz, text, text, text) TO authenticated, service_role;
