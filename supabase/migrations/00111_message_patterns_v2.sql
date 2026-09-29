-- ============================================================================
-- 00111 — Patrones de mensajes, segunda vuelta (Bloque 4: F21, F22; Bloque 5: F25)
-- ============================================================================
-- La 00079 dejo la agrupacion y una funcion que la pantalla no alcanza a usar:
--
--   1. No recibia canal ni autor, asi que la seccion Patrones ignoraba los dos
--      filtros de arriba: el dashboard decia "filtrado por Sofia" y los patrones
--      mostraban los de todos.
--   2. No devolvia el `text_id` de cada variante, y sin el id no se puede mover
--      un texto de categoria: "Mover a…" no se podia conectar.
--   3. No habia forma de saber que le responden a cada categoria (§11.7).
--
-- Se reemplaza la funcion con el MISMO nombre y se borra la firma vieja: dos
-- sobrecargas que solo difieren en parametros con default dejan a PostgREST sin
-- poder elegir ("Could not choose the best candidate function").
--
-- Todas SECURITY INVOKER: la RLS de messages acota a un Member a su scope.
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Lo que mas se envia / lo que mas responden
-- ------------------------------------------------------------
-- Se borra por NOMBRE y no por firma, y ademas se borran TODAS las sobrecargas:
-- dos versiones que solo difieren en parametros con default dejan a PostgREST
-- sin poder elegir ("Could not choose the best candidate function").
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'chat_dashboard_patterns'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE FUNCTION public.chat_dashboard_patterns(
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
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_patterns(uuid, text, timestamptz, timestamptz, text, text) IS
  'Categorias con su volumen de MENSAJES (no de textos distintos), autor principal, % que obtuvo respuesta (§11.7) y hasta 5 variantes con su text_id (para "Mover a…"). Respeta los filtros de canal y autor.';

-- ------------------------------------------------------------
-- 2. Que le responden a una categoria (§11.7)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_dashboard_replies(
  p_workspace_id uuid,
  p_category_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  reply_category_id uuid,
  reply_category_name text,
  reply_is_fallback boolean,
  replies bigint,
  pct_of_replies numeric,
  outbound_total bigint,
  outbound_with_reply bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.chat_dashboard_replies(uuid, uuid, timestamptz, timestamptz, text) IS
  'Que le responden a una categoria de salientes (§11.7): el primer entrante dentro de 24 h, agrupado por su categoria. outbound_total y outbound_with_reply van en cada fila para calcular el "% no respondio" exacto.';

-- ------------------------------------------------------------
-- 3. Textos con su volumen (entrada de la calidad de la clasificacion)
-- ------------------------------------------------------------
-- `lib/patterns/quality.ts` necesita el volumen de MENSAJES de cada texto: "sin
-- categoria" se mide sobre cuantos mensajes quedaron afuera, no sobre cuantos
-- textos distintos (§13.3). Dos textos raros no son lo mismo que doscientos
-- mensajes sin clasificar.
CREATE OR REPLACE FUNCTION public.message_text_volumes(
  p_workspace_id uuid,
  p_direction text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  text_id uuid,
  direction text,
  category_id uuid,
  source text,
  confidence numeric,
  review_result text,
  is_button boolean,
  prompt_version integer,
  classified_at timestamptz,
  reviewed_at timestamptz,
  sample_text text,
  message_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.message_text_volumes(uuid, text, timestamptz, timestamptz) IS
  'Cada texto distinto con su volumen de mensajes en el periodo. Es la entrada de qualityReport(): "sin categoria" se mide sobre mensajes, no sobre textos.';

-- ------------------------------------------------------------
-- 4. Estado de la clasificacion (la linea de calidad y la pantalla de Tareas)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.message_classification_status(
  p_workspace_id uuid,
  p_tz text DEFAULT 'America/Costa_Rica'
)
RETURNS TABLE (
  last_run_at timestamptz,
  last_run_status text,
  last_run_detail text,
  texts_classified_today bigint,
  unclassified_pending bigint,
  active_prompt_version integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.message_classification_status(uuid, text) IS
  'Ultima corrida del clasificador, textos clasificados hoy y cuantos quedan sin clasificar. Un Member ve la corrida en NULL: la RLS de agent_runs le muestra solo runs con conversacion, y el clasificador no tiene ninguna.';

-- ------------------------------------------------------------
-- 5. Permisos
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.chat_dashboard_patterns(uuid, text, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_replies(uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.message_text_volumes(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.message_classification_status(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.chat_dashboard_patterns(uuid, text, timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_replies(uuid, uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.message_text_volumes(uuid, text, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.message_classification_status(uuid, text) TO authenticated, service_role;
