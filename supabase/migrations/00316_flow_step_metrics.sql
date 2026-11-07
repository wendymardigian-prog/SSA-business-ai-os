-- ============================================================
-- 00316_flow_step_metrics
-- ============================================================
-- Metricas por paso en el lienzo, el motivo de cada fallo y el lienzo como unico
-- lugar donde se arman las automatizaciones de comentarios (noviembre 2026).
--
-- Esta migracion:
--   1. Suma a `flow_session_steps` la clave del motivo de un fallo
--      (`error_kind`, por ejemplo `already_replied`) y el handle crudo por el que
--      siguio el paso (`exit_handle`), para contar por camino.
--   2. Indices para las metricas: los pasos de un flujo por nodo, y los mensajes
--      que mando cada paso.
--   3. `flow_link_clicks`: cada clic en un link con seguimiento que salio de un
--      paso (botones de «Responder por privado» y de «Enviar mensaje»). Sin
--      `contact_id` a proposito: la persona sale de la ejecucion, y asi
--      `merge_contacts` y su guardia no cambian.
--   4. `flow_node_stats`: las cuentas de cada paso para el lienzo. SECURITY
--      INVOKER: la RLS de quien mira decide que cuenta (como `ads_crm_metrics`).
--   5. Las reglas de comentario de la pestana Growth pasan al disparador del
--      lienzo cuando se puede (una regla por flujo y el disparador del lienzo es
--      de comentario). Lo que no encaja queda como esta y sigue funcionando: la
--      pestana Comentarios lo muestra como «regla vieja».
--
-- Aditiva. Va ANTES de desplegar el codigo: el motor escribe las columnas nuevas
-- (y si no estan, anota el paso sin ellas) y el lienzo llama a la funcion.
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.flow_node_stats(uuid, timestamptz, timestamptz);
--   DROP TABLE IF EXISTS public.flow_link_clicks;
--   DROP INDEX IF EXISTS public.idx_flow_session_steps_flow_node;
--   DROP INDEX IF EXISTS public.idx_messages_sent_by_flow_node;
--   ALTER TABLE public.flow_session_steps DROP COLUMN IF EXISTS error_kind,
--     DROP COLUMN IF EXISTS exit_handle;
--   (El paso 5 mueve datos de una fila de `triggers` al nodo del lienzo; volver
--   atras es borrar `channelId` del nodo y recrear la fila con canal. En
--   produccion no habia ninguna regla con canal al escribirla.)
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. El motivo y la salida de cada paso
-- ------------------------------------------------------------
ALTER TABLE public.flow_session_steps
  ADD COLUMN IF NOT EXISTS error_kind text,
  ADD COLUMN IF NOT EXISTS exit_handle text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flow_session_steps_error_kind_shape') THEN
    ALTER TABLE public.flow_session_steps ADD CONSTRAINT flow_session_steps_error_kind_shape
      CHECK (error_kind IS NULL OR error_kind ~ '^[a-z][a-z0-9_]{0,39}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flow_session_steps_exit_handle_length') THEN
    ALTER TABLE public.flow_session_steps ADD CONSTRAINT flow_session_steps_exit_handle_length
      CHECK (exit_handle IS NULL OR char_length(exit_handle) <= 64);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Indices
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_flow_session_steps_flow_node
  ON public.flow_session_steps(flow_id, node_id, started_at);

CREATE INDEX IF NOT EXISTS idx_messages_sent_by_flow_node
  ON public.messages(sent_by_flow_id, sent_by_node_id, created_at)
  WHERE sent_by_flow_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Los clics de cada paso
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flow_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  node_id text NOT NULL CHECK (char_length(node_id) BETWEEN 1 AND 64),
  -- Cual link del paso: `t` (el texto), `b0`, `b1`... (botones), `m1-b0` (segundo mensaje).
  button_key text CHECK (button_key IS NULL OR char_length(button_key) BETWEEN 1 AND 64),
  session_id uuid REFERENCES public.flow_sessions(id) ON DELETE SET NULL,
  clicked_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.flow_link_clicks IS
  'Cada clic en un link con seguimiento que salio de un paso de una automatizacion (00316). La persona sale de la ejecucion (session_id): sin contact_id a proposito.';

CREATE INDEX IF NOT EXISTS idx_flow_link_clicks_flow_node
  ON public.flow_link_clicks(flow_id, node_id, clicked_at);
CREATE INDEX IF NOT EXISTS idx_flow_link_clicks_clicked
  ON public.flow_link_clicks(clicked_at);

ALTER TABLE public.flow_link_clicks ENABLE ROW LEVEL SECURITY;

-- Lo ve quien ve la automatizacion; un clic de una ejecucion, solo si ve esa ejecucion (la RLS de flow_sessions).
DROP POLICY IF EXISTS flow_link_clicks_select ON public.flow_link_clicks;
CREATE POLICY flow_link_clicks_select ON public.flow_link_clicks FOR SELECT
  USING (
    COALESCE(public.has_permission(workspace_id, 'flows.view'), false)
    AND (
      session_id IS NULL
      OR EXISTS (SELECT 1 FROM public.flow_sessions s WHERE s.id = flow_link_clicks.session_id)
    )
  );

-- Sin politicas de escritura: escribe solo el servidor (la ruta /l/<token>).
REVOKE ALL ON TABLE public.flow_link_clicks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.flow_link_clicks TO authenticated;
GRANT ALL ON TABLE public.flow_link_clicks TO service_role;

-- ------------------------------------------------------------
-- 4. Las cuentas de cada paso
-- ------------------------------------------------------------
-- Formato largo: una fila por (paso, metrica, clave). El lienzo las arma.
--   passed        personas (ejecuciones) que pasaron por el paso
--   status        por estado final (la ultima fila de cada ejecucion en el paso:
--                 un paso que quedo para despues y despues salio cuenta una vez)
--   failed_kind   fallos por clave de motivo
--   failed_reason fallos por motivo (el texto ya saneado)
--   exit          por que salida siguio (handle crudo)
--   sent          conversaciones a las que el paso les mando un mensaje
--   replied       de esas, las que contestaron dentro de las 24 horas
--   clicks        clics por link (clave), clickers: ejecuciones distintas
--   clickers_any  ejecuciones distintas con al menos un clic en el paso
--   email_sent, email_opened, email_clicked: emails del paso (email_log)
CREATE OR REPLACE FUNCTION public.flow_node_stats(p_flow_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (node_id text, metric text, key text, value bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH steps AS (
    SELECT st.session_id, st.node_id, st.status, st.error_kind, st.reason, st.exit_handle
    FROM public.flow_session_steps st
    WHERE st.flow_id = p_flow_id
      AND st.started_at >= p_from
      AND st.started_at < p_to
  ),
  last_per_session AS (
    SELECT DISTINCT ON (st.session_id, st.node_id)
      st.session_id, st.node_id, st.status, st.error_kind, st.reason, st.exit_handle
    FROM public.flow_session_steps st
    WHERE st.flow_id = p_flow_id
      AND st.started_at >= p_from
      AND st.started_at < p_to
    ORDER BY st.session_id, st.node_id, st.started_at DESC, st.seq DESC
  ),
  sent AS (
    SELECT m.sent_by_node_id AS node_id, m.conversation_id, min(m.created_at) AS first_sent
    FROM public.messages m
    WHERE m.sent_by_flow_id = p_flow_id
      AND m.sent_by_node_id IS NOT NULL
      AND m.direction = 'outbound'
      AND m.status NOT IN ('failed', 'pending')
      AND m.created_at >= p_from
      AND m.created_at < p_to
    GROUP BY m.sent_by_node_id, m.conversation_id
  ),
  clicks AS (
    SELECT c.node_id, c.button_key, c.session_id
    FROM public.flow_link_clicks c
    WHERE c.flow_id = p_flow_id
      AND c.clicked_at >= p_from
      AND c.clicked_at < p_to
  ),
  emails AS (
    SELECT e.flow_node_id AS node_id, e.opened_at, e.clicked_at
    FROM public.email_log e
    WHERE e.related_entity_type = 'flow'
      AND e.related_entity_id = p_flow_id
      AND e.flow_node_id IS NOT NULL
      AND e.status = 'sent'
      AND e.created_at >= p_from
      AND e.created_at < p_to
  )
  SELECT s.node_id, 'passed', NULL::text, count(DISTINCT s.session_id) FROM steps s GROUP BY s.node_id
  UNION ALL
  SELECT l.node_id, 'status', l.status, count(*) FROM last_per_session l GROUP BY l.node_id, l.status
  UNION ALL
  SELECT l.node_id, 'failed_kind', COALESCE(l.error_kind, 'unknown'), count(*)
    FROM last_per_session l WHERE l.status = 'failed' GROUP BY l.node_id, COALESCE(l.error_kind, 'unknown')
  UNION ALL
  SELECT l.node_id, 'failed_reason', COALESCE(l.reason, ''), count(*)
    FROM last_per_session l WHERE l.status = 'failed' GROUP BY l.node_id, COALESCE(l.reason, '')
  UNION ALL
  SELECT l.node_id, 'exit', l.exit_handle, count(*)
    FROM last_per_session l WHERE l.exit_handle IS NOT NULL GROUP BY l.node_id, l.exit_handle
  UNION ALL
  SELECT x.node_id, 'sent', NULL::text, count(*) FROM sent x GROUP BY x.node_id
  UNION ALL
  SELECT x.node_id, 'replied', NULL::text, count(*)
    FROM sent x
    WHERE EXISTS (
      SELECT 1 FROM public.messages r
      WHERE r.conversation_id = x.conversation_id
        AND r.direction = 'inbound'
        AND r.created_at > x.first_sent
        AND r.created_at <= x.first_sent + interval '24 hours'
    )
    GROUP BY x.node_id
  UNION ALL
  SELECT c.node_id, 'clicks', COALESCE(c.button_key, ''), count(*) FROM clicks c GROUP BY c.node_id, COALESCE(c.button_key, '')
  UNION ALL
  SELECT c.node_id, 'clickers', COALESCE(c.button_key, ''), count(DISTINCT c.session_id)
    FROM clicks c GROUP BY c.node_id, COALESCE(c.button_key, '')
  UNION ALL
  SELECT c.node_id, 'clickers_any', NULL::text, count(DISTINCT c.session_id) FROM clicks c GROUP BY c.node_id
  UNION ALL
  SELECT e.node_id, 'email_sent', NULL::text, count(*) FROM emails e GROUP BY e.node_id
  UNION ALL
  SELECT e.node_id, 'email_opened', NULL::text, count(*) FILTER (WHERE e.opened_at IS NOT NULL) FROM emails e GROUP BY e.node_id
  UNION ALL
  SELECT e.node_id, 'email_clicked', NULL::text, count(*) FILTER (WHERE e.clicked_at IS NOT NULL) FROM emails e GROUP BY e.node_id;
$$;

COMMENT ON FUNCTION public.flow_node_stats(uuid, timestamptz, timestamptz) IS
  'Las cuentas de cada paso de una automatizacion para el lienzo (00316). SECURITY INVOKER: la RLS de quien mira decide que cuenta.';

REVOKE ALL ON FUNCTION public.flow_node_stats(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flow_node_stats(uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. Las reglas de Growth pasan al lienzo
-- ------------------------------------------------------------
-- Una regla con canal se copia al disparador del lienzo cuando: el flujo tiene UNA
-- sola regla de comentario con canal, su disparador es «Palabra clave en un
-- comentario» y todavia no eligio cuenta. Se copian la cuenta, las publicaciones,
-- la respuesta publica y (si el disparador no tenia) las palabras. La fila queda
-- marcada como del lienzo y se borran las filas sin canal del mismo flujo: la
-- proxima publicacion las vuelve a armar desde el nodo.
DO $$
DECLARE
  r record;
  v_patch jsonb;
  v_nodes jsonb;
  v_draft jsonb;
BEGIN
  FOR r IN
    SELECT t.id AS trigger_id, t.flow_id, t.channel_id, t.config, f.nodes, f.draft_nodes
    FROM public.triggers t
    JOIN public.flows f ON f.id = t.flow_id
    WHERE t.type = 'comment_keyword'
      AND t.channel_id IS NOT NULL
      AND COALESCE(t.config->>'origin', '') <> 'canvas'
      AND (
        SELECT count(*) FROM public.triggers t2
        WHERE t2.flow_id = t.flow_id AND t2.type = 'comment_keyword' AND t2.channel_id IS NOT NULL
          AND COALESCE(t2.config->>'origin', '') <> 'canvas'
      ) = 1
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(f.nodes, '[]'::jsonb)) n
        WHERE n->>'type' = 'trigger'
          AND n->'data'->>'triggerType' = 'comment_keyword'
          AND COALESCE(n->'data'->>'channelId', '') = ''
      )
  LOOP
    v_patch := jsonb_build_object('channelId', r.channel_id::text);
    IF jsonb_typeof(r.config->'postIds') = 'array' AND jsonb_array_length(r.config->'postIds') > 0 THEN
      v_patch := v_patch || jsonb_build_object('postIds', r.config->'postIds');
    END IF;
    IF COALESCE(r.config->>'replyText', '') <> '' THEN
      v_patch := v_patch || jsonb_build_object('replyText', r.config->>'replyText');
    END IF;

    SELECT jsonb_agg(
      CASE
        WHEN n->>'type' = 'trigger' AND n->'data'->>'triggerType' = 'comment_keyword' THEN
          jsonb_set(
            n,
            '{data}',
            (n->'data')
              || v_patch
              || CASE
                   WHEN jsonb_array_length(COALESCE(n->'data'->'keywords', '[]'::jsonb)) = 0
                     THEN jsonb_build_object('keywords', COALESCE(r.config->'keywords', '[]'::jsonb))
                   ELSE '{}'::jsonb
                 END
          )
        ELSE n
      END
      ORDER BY ord
    )
    INTO v_nodes
    FROM jsonb_array_elements(r.nodes) WITH ORDINALITY AS e(n, ord);

    v_draft := NULL;
    IF r.draft_nodes IS NOT NULL AND jsonb_typeof(r.draft_nodes) = 'array' THEN
      SELECT jsonb_agg(
        CASE
          WHEN n->>'type' = 'trigger' AND n->'data'->>'triggerType' = 'comment_keyword'
               AND COALESCE(n->'data'->>'channelId', '') = ''
            THEN jsonb_set(n, '{data}', (n->'data') || v_patch)
          ELSE n
        END
        ORDER BY ord
      )
      INTO v_draft
      FROM jsonb_array_elements(r.draft_nodes) WITH ORDINALITY AS e(n, ord);
    END IF;

    UPDATE public.flows
       SET nodes = v_nodes,
           draft_nodes = COALESCE(v_draft, draft_nodes)
     WHERE id = r.flow_id;

    UPDATE public.triggers
       SET config = config || jsonb_build_object('origin', 'canvas')
     WHERE id = r.trigger_id;

    -- Solo la de comentario: la de «tambien por DM» (tipo keyword) sigue hasta la proxima publicacion.
    DELETE FROM public.triggers
     WHERE flow_id = r.flow_id
       AND type = 'comment_keyword'
       AND channel_id IS NULL;

    RAISE NOTICE '00316: la regla % del flujo % paso al disparador del lienzo', r.trigger_id, r.flow_id;
  END LOOP;
END $$;
