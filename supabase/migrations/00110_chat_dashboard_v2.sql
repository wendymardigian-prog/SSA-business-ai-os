-- ============================================================================
-- 00110 — Dashboard de Chat, segunda vuelta (Bloques 2e y 3: F16, F17, F18)
-- ============================================================================
-- La 00078 dejo las metricas basicas. Esta completa lo que la pantalla necesita
-- y arregla tres cosas que estaban mal:
--
--   1. `chat_dashboard_team` calculaba "primera respuesta" y "respuesta" con la
--      MISMA consulta (00078:217-218), asi que las dos columnas mostraban
--      siempre el mismo numero. Ahora la primera respuesta de una persona se
--      cuenta desde que la conversacion le fue asignada o derivada (§11.4).
--   2. Flows, secuencias y broadcasts salian como tres filas distintas, y al
--      tocarlas se filtraba por `author=flow`, que `chat_author_match` no
--      reconoce: el dashboard quedaba en blanco. Ahora son UNA fila,
--      'automations', que es el valor que el filtro si entiende.
--   3. Las tendencias devolvian solo los dias con actividad. Un dia sin
--      mensajes faltaba en vez de valer cero, y el grafico mentia la forma.
--
-- Todas SECURITY INVOKER: se llaman con el cliente del usuario, asi la RLS de
-- messages/conversations aplica el scope de leads sin logica extra en la app.
-- Idempotente. Los DROP son necesarios: no se puede cambiar el tipo de retorno
-- de una funcion con CREATE OR REPLACE (42P13).
--
-- OJO con `agent_runs`: `authenticated` NO puede leer tokens ni `cost_usd`
-- (GRANT por columna de la 00060). Ninguna funcion de aca los toca; una que lo
-- hiciera fallaria con "permission denied" para cualquier persona real.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Grupo de autor: un color y una fila por grupo
-- ------------------------------------------------------------
-- 'team' agrupa a las personas cuando se las mira juntas; en la tabla "Quien
-- responde" cada persona tiene su propia fila (su uuid).
CREATE OR REPLACE FUNCTION public.chat_origin_group(p_origin text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_origin = 'agent' THEN 'agent'
    WHEN p_origin IN ('flow', 'sequence', 'broadcast') THEN 'automations'
    WHEN p_origin = 'user' THEN 'team'
    WHEN p_origin = 'external' THEN 'external'
  END;
$$;

COMMENT ON FUNCTION public.chat_origin_group(text) IS
  'Grupo de autor de un saliente: agent | team | automations | external. NULL para un origin desconocido (no se inventa un grupo).';

-- ------------------------------------------------------------
-- 2. Flags del agente por episodio (una sola definicion)
-- ------------------------------------------------------------
-- Sale a una funcion propia para que los tres numeros grandes y la mini linea
-- de 8 semanas no puedan discrepar: si se calcularan dos veces, un dia una
-- dice 86% y la otra 84% y nadie sabe cual creer.
CREATE OR REPLACE FUNCTION public.chat_agent_episode_flags(
  p_workspace_id uuid,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  conversation_id uuid,
  episode_no integer,
  episode_start timestamptz,
  acted boolean,
  took_first boolean,
  escalated boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_agent_episode_flags(uuid, text) IS
  'Por episodio: si el agente actuo, si tomo desde el primer mensaje y si derivo (§11.5). Fuente unica de los tres numeros y de la serie semanal.';

-- ------------------------------------------------------------
-- 3. Seccion del agente: los tres numeros
-- ------------------------------------------------------------
-- Misma firma que la 00078, asi que alcanza CREATE OR REPLACE. Lo que cambia es
-- que ahora sale de la funcion de flags.
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
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE acted),
    COUNT(*) FILTER (WHERE took_first),
    COUNT(*) FILTER (WHERE escalated)
  FROM public.chat_agent_episode_flags(p_workspace_id, p_channel)
  WHERE (p_from IS NULL OR episode_start >= p_from)
    AND (p_to IS NULL OR episode_start <= p_to);
$$;

-- ------------------------------------------------------------
-- 4. Las tres tasas del agente por semana (mini linea de 8 semanas)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_dashboard_agent_weekly(
  p_workspace_id uuid,
  p_channel text DEFAULT NULL,
  p_tz text DEFAULT 'America/Costa_Rica',
  p_weeks integer DEFAULT 8
)
RETURNS TABLE (
  week_start date,
  new_conversations bigint,
  acted bigint,
  took_first bigint,
  escalated bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_agent_weekly(uuid, text, text, integer) IS
  'Las tres tasas del agente por semana ISO (lunes), para la mini linea. Una semana sin episodios devuelve 0 y la app la dibuja como hueco, no como 0%.';

-- ------------------------------------------------------------
-- 5. Quien respondio primero (barra 100%)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_dashboard_first_responder(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (responder text, episodes bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_first_responder(uuid, timestamptz, timestamptz, text) IS
  'Episodios del periodo por quien respondio primero, incluido "unanswered" (§11.5). Cinco filas siempre.';

-- ------------------------------------------------------------
-- 6. Por que derivo
-- ------------------------------------------------------------
-- El motivo de una derivacion por herramienta lo escribe el modelo en texto
-- libre (`metadata.reason`), asi que se agrupa por el texto normalizado y se
-- muestra la ultima redaccion. Los de guardarrail si tienen clave estable.
CREATE OR REPLACE FUNCTION public.chat_dashboard_escalation_reasons(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_limit integer DEFAULT 6
)
RETURNS TABLE (
  reason_key text,
  reason_label text,
  origin text,
  escalations bigint,
  pct numeric,
  is_other boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_escalation_reasons(uuid, timestamptz, timestamptz, text, integer) IS
  'Derivaciones del agente por motivo (§11.5). El motivo de una derivacion por herramienta es texto libre del modelo: se agrupa normalizado y se muestra la ultima redaccion.';

-- ------------------------------------------------------------
-- 7. Acciones del agente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_dashboard_agent_actions(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (action text, actions bigint, reverted bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_agent_actions(uuid, timestamptz, timestamptz, text) IS
  'Lo que hizo el agente en el periodo, por tipo de accion, desde audit_log.performed_by_agent_id (§11.5). Incluye cuantas se revirtieron.';

-- ------------------------------------------------------------
-- 8. Resultados de las reglas de respuesta
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_dashboard_rule_results(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  rule_id text,
  rule_index integer,
  action text,
  runs bigint,
  degraded_to_draft bigint,
  is_default boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_rule_results(uuid, timestamptz, timestamptz, text) IS
  'Turnos por regla y accion (§11.5). rule_id NULL = ninguna regla coincidio y decidio la accion por defecto. La app traduce el id a "Regla N": el id nunca se muestra.';

-- ------------------------------------------------------------
-- 9. Aprobacion de respuestas (borradores)
-- ------------------------------------------------------------
-- Los cinco resultados de §11.6 son EXCLUYENTES y en este orden, para que la
-- barra de 100% sume exactamente el total. Se excluyen `superseded`,
-- `regenerated` y los descartes automaticos que no son una decision.
--
-- "Respondida a mano" se detecta por `discard_reason = 'auto:manual_reply'`, que
-- es lo que escribe el trigger de la 00077 cuando alguien contesta a mano. §11.6
-- lo describe como "descarte no automatico + saliente de una persona", pero en
-- la practica ese caso SIEMPRE llega marcado por el trigger.
CREATE OR REPLACE FUNCTION public.chat_dashboard_drafts(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_tz text DEFAULT 'America/Costa_Rica'
)
RETURNS TABLE (
  approved_unchanged bigint,
  corrected bigint,
  answered_manually bigint,
  discarded bigint,
  window_missed bigint,
  agent_median_s numeric,
  approval_median_s numeric,
  pending_now bigint,
  pending_under_6h bigint,
  missed_last_7d bigint,
  unedited_weekly jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
    -- de arriba del dashboard los usa (F17).
    (SELECT COUNT(*) FROM d WHERE status IN ('pending', 'failed')),
    (SELECT COUNT(*) FROM d WHERE status IN ('pending', 'failed')
       AND sendable_until IS NOT NULL AND sendable_until > now()
       AND sendable_until - now() < interval '6 hours'),
    (SELECT COUNT(*) FROM d WHERE window_missed_at >= now() - interval '7 days'),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'week_start', w, 'sent', sent, 'unedited', unedited,
              'pct', ROUND(100.0 * unedited / NULLIF(sent, 0), 1)
            ) ORDER BY w), '[]'::jsonb) FROM weekly);
$$;

COMMENT ON FUNCTION public.chat_dashboard_drafts(uuid, timestamptz, timestamptz, text, text) IS
  'Aprobacion de respuestas (§11.6): los cinco resultados excluyentes, las dos medianas, el estado de ahora (pendientes, por vencer, ventanas perdidas) y ocho semanas de aprobados sin cambios.';

-- ------------------------------------------------------------
-- 10. Tabla "Quien responde"
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.chat_dashboard_team(uuid, timestamptz, timestamptz, text);

CREATE FUNCTION public.chat_dashboard_team(
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
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
    -- desde ese entrante (§11.4).
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
    -- suya (§11.4). Para los grupos no hay asignacion y queda el primer
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_team(uuid, timestamptz, timestamptz, text) IS
  'Una fila por autor: el agente, "automations" (flows + secuencias + broadcasts, UNA fila), "external" y cada persona. La primera respuesta de una persona se cuenta desde que la conversacion le fue asignada o derivada (§11.4). Para un Member, las derivaciones recibidas pueden quedar cortas: la RLS de audit_log no le muestra las filas de otras personas.';

-- ------------------------------------------------------------
-- 11. Numeros principales: las conversaciones tambien respetan el autor
-- ------------------------------------------------------------
-- La tarjeta dice "En las que participo" cuando hay filtro de persona, pero el
-- numero contaba TODOS los episodios (00078:126-127). §11.2: las metricas por
-- conversacion se acotan a los episodios donde ese autor mando algo.
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
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

-- ------------------------------------------------------------
-- 12. Tendencias: serie densa, por autor y con la mediana diaria
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.chat_dashboard_trends(uuid, timestamptz, timestamptz, text, text, text);

CREATE FUNCTION public.chat_dashboard_trends(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL,
  p_tz text DEFAULT 'America/Costa_Rica'
)
RETURNS TABLE (
  day date,
  messages_in bigint,
  messages_out bigint,
  new_conversations bigint,
  sent_agent bigint,
  sent_team bigint,
  sent_automations bigint,
  sent_external bigint,
  first_response_median_seconds numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_trends(uuid, timestamptz, timestamptz, text, text, text) IS
  'Serie diaria densa (todos los dias del periodo) con recibidos, enviados, enviados por grupo de autor, conversaciones nuevas y la mediana diaria de primera respuesta. La app agrupa a semanal si el periodo pasa de 62 dias.';

-- ------------------------------------------------------------
-- 13. Permisos
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.chat_origin_group(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_agent_episode_flags(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_agent(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_agent_weekly(uuid, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_first_responder(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_escalation_reasons(uuid, timestamptz, timestamptz, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_agent_actions(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_rule_results(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_drafts(uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_team(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_numbers(uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_trends(uuid, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.chat_origin_group(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_agent_episode_flags(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_agent(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_agent_weekly(uuid, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_first_responder(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_escalation_reasons(uuid, timestamptz, timestamptz, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_agent_actions(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_rule_results(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_drafts(uuid, timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_team(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_numbers(uuid, timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_trends(uuid, timestamptz, timestamptz, text, text, text) TO authenticated, service_role;
