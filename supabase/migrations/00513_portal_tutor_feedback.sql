-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00513_portal_tutor_feedback  (Portal de estudiantes · el Asistente IA: «Me sirvió / No me sirvió» y Conversaciones)
-- ============================================================================
-- Aditiva: ninguna tabla ni columna nueva. `ai_messages.feedback` ('up' | 'down', 00320) ya existía y nadie la escribía.
--
-- 1. app_servicio_portal.portal_tutor_feedback(session, message_id, value)   (portal_app)
--      El estudiante marca una respuesta del tutor: 'up', 'down' o NULL (saca la marca). Solo una respuesta de una
--      conversación SUYA del portal, con la sección «assistant» abierta; la vista previa del equipo no puede (PO403).
--      Idempotente: marcar dos veces deja la misma marca.
-- 2. app_servicio_portal.portal_tutor_thread(session, thread_id)              (portal_app)
--      Cada mensaje suma `feedback`, para que el portal muestre lo que ya marcó. Lo demás, igual.
-- 3. app_servicio.tutor_conversations(product_id, filter, limit, before)      (authenticated, service_role)
--      Para la pantalla «Conversaciones» del panel: cada respuesta del tutor con su pregunta, el estudiante, las citas,
--      la marca, el resumen de la búsqueda (`ai_messages.result`: {fragments, cited}) y cómo terminó la corrida.
--      Mismo permiso que `assistant_usage` (00352): `services.view` o `tutor.manage` (SV004 si no).
--      Filtros: 'todas', 'abajo' (No me sirvió), 'arriba' (Me sirvió), 'sin-clases' (respondió sin citar ninguna clase).
--
-- Va ANTES de desplegar el portal (el botón llama a la 1) y SSA (la pantalla llama a la 3).
--
-- Volver atrás: DROP FUNCTION app_servicio_portal.portal_tutor_feedback(text, uuid, text) y
-- app_servicio.tutor_conversations(uuid, text, integer, timestamptz), y restaurar la definición vieja de
-- portal_tutor_thread (leída de la base el 24/11/2026):
--
--   CREATE OR REPLACE FUNCTION app_servicio_portal.portal_tutor_thread(p_session text, p_thread_id uuid)
--    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
--   AS $function$
--   DECLARE
--     sess jsonb := app_servicio_portal.session_resolve(p_session);
--     t public.ai_threads;
--   BEGIN
--     SELECT * INTO t FROM public.ai_threads
--      WHERE id = p_thread_id AND channel = 'portal' AND subject_type = 'product' AND archived_at IS NULL
--        AND workspace_id = (sess ->> 'workspace_id')::uuid AND contact_id = (sess ->> 'contact_id')::uuid;
--     IF t.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No encontramos esa conversación'); END IF;
--     PERFORM app_servicio_portal.require_section(sess, t.subject_id, 'assistant');
--     RETURN jsonb_build_object('id', t.id, 'title', COALESCE(t.title, 'Conversación'), 'product_id', t.subject_id,
--       'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content, 'citations', m.citations,
--                                                                 'created_at', m.created_at) ORDER BY m.created_at, m.id)
--         FROM (SELECT * FROM public.ai_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 100) m), '[]'::jsonb));
--   END;
--   $function$
-- ============================================================================

-- ─── 1. Marcar una respuesta ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_tutor_feedback(p_session text, p_message_id uuid, p_value text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  v_contact uuid := (sess ->> 'contact_id')::uuid;
  v_product uuid;
BEGIN
  IF sess ->> 'kind' <> 'student' THEN PERFORM app_servicio_portal.err('PO403', 'En la vista previa no se pueden marcar las respuestas'); END IF;
  IF p_value IS NOT NULL AND p_value NOT IN ('up', 'down') THEN PERFORM app_servicio_portal.err('PO400', 'Marca no válida'); END IF;
  SELECT t.subject_id INTO v_product
    FROM public.ai_messages m
    JOIN public.ai_threads t ON t.id = m.thread_id
   WHERE m.id = p_message_id AND m.role = 'assistant'
     AND t.channel = 'portal' AND t.subject_type = 'product' AND t.archived_at IS NULL
     AND t.workspace_id = (sess ->> 'workspace_id')::uuid AND t.contact_id = v_contact
   FOR UPDATE OF m;
  IF v_product IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No encontramos esa respuesta'); END IF;
  PERFORM app_servicio_portal.require_section(sess, v_product, 'assistant');
  IF public.bump_rate_limit('portal-tutor-feedback:' || v_contact::text, date_trunc('minute', now())) > 30 THEN
    PERFORM app_servicio_portal.err('PO429', 'Esperá un minuto y volvé a probar');
  END IF;
  UPDATE public.ai_messages SET feedback = p_value WHERE id = p_message_id AND feedback IS DISTINCT FROM p_value;
  RETURN jsonb_build_object('feedback', p_value);
END;
$$;

-- ─── 2. La conversación, con la marca ───────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_tutor_thread(p_session text, p_thread_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  t public.ai_threads;
BEGIN
  SELECT * INTO t FROM public.ai_threads
   WHERE id = p_thread_id AND channel = 'portal' AND subject_type = 'product' AND archived_at IS NULL
     AND workspace_id = (sess ->> 'workspace_id')::uuid AND contact_id = (sess ->> 'contact_id')::uuid;
  IF t.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No encontramos esa conversación'); END IF;
  PERFORM app_servicio_portal.require_section(sess, t.subject_id, 'assistant');
  RETURN jsonb_build_object('id', t.id, 'title', COALESCE(t.title, 'Conversación'), 'product_id', t.subject_id,
    'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content, 'citations', m.citations,
                                                              'feedback', m.feedback, 'created_at', m.created_at) ORDER BY m.created_at, m.id)
      FROM (SELECT * FROM public.ai_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 100) m), '[]'::jsonb));
END;
$$;

-- ─── 3. Las conversaciones, para el panel ───────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.tutor_conversations(p_product_id uuid, p_filter text DEFAULT 'todas',
                                                            p_limit integer DEFAULT 30, p_before timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pr record;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  v_filter text := COALESCE(NULLIF(btrim(p_filter), ''), 'todas');
  v_items jsonb;
BEGIN
  SELECT id, workspace_id INTO pr FROM public.products WHERE id = p_product_id;
  IF pr.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(pr.workspace_id)
       AND (public.has_permission(pr.workspace_id, 'services.view') OR public.has_permission(pr.workspace_id, 'tutor.manage'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF v_filter NOT IN ('todas', 'abajo', 'arriba', 'sin-clases') THEN v_filter := 'todas'; END IF;

  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb) INTO v_items
    FROM (
      SELECT a.id, a.created_at, jsonb_build_object(
               'id', a.id, 'thread_id', a.thread_id, 'created_at', a.created_at,
               'contact_id', c.id, 'student', c.display_name,
               'question', (SELECT u.content FROM public.ai_messages u
                             WHERE u.thread_id = a.thread_id AND u.role = 'user'
                               AND (u.created_at, u.id) < (a.created_at, a.id)
                             ORDER BY u.created_at DESC, u.id DESC LIMIT 1),
               'answer', a.content, 'citations', COALESCE(a.citations, '[]'::jsonb),
               'feedback', a.feedback, 'result', a.result, 'run_status', r.status) AS item
        FROM public.ai_messages a
        JOIN public.ai_threads t ON t.id = a.thread_id
        JOIN public.contacts c ON c.id = t.contact_id
        LEFT JOIN public.agent_runs r ON r.id = a.agent_run_id
       WHERE t.workspace_id = pr.workspace_id AND t.channel = 'portal' AND t.subject_type = 'product' AND t.subject_id = pr.id
         AND a.role = 'assistant'
         AND (p_before IS NULL OR a.created_at < p_before)
         AND CASE v_filter
               WHEN 'abajo' THEN a.feedback = 'down'
               WHEN 'arriba' THEN a.feedback = 'up'
               WHEN 'sin-clases' THEN COALESCE(r.status, '') = 'responded' AND jsonb_array_length(COALESCE(a.citations, '[]'::jsonb)) = 0
               ELSE true
             END
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT v_limit + 1
    ) x;

  RETURN jsonb_build_object(
    'items', (SELECT COALESCE(jsonb_agg(e ORDER BY n), '[]'::jsonb) FROM jsonb_array_elements(v_items) WITH ORDINALITY AS z(e, n) WHERE n <= v_limit),
    'has_more', jsonb_array_length(v_items) > v_limit);
END;
$$;

-- ─── Permisos ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION app_servicio_portal.portal_tutor_feedback(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_tutor_feedback(text, uuid, text) TO portal_app, service_role;
REVOKE ALL ON FUNCTION app_servicio_portal.portal_tutor_thread(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_tutor_thread(text, uuid) TO portal_app, service_role;
REVOKE ALL ON FUNCTION app_servicio.tutor_conversations(uuid, text, integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.tutor_conversations(uuid, text, integer, timestamptz) TO authenticated, service_role;
