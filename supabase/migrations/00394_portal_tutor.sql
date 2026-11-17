-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00394_portal_tutor  (Portal de estudiantes · el Asistente IA, F230)
-- ============================================================================
-- El tutor del programa (00352: agente `student_tutor`, créditos, material por estudiante) ya existe del lado del panel.
-- Esto es lo que le falta para hablar con el portal:
--
-- 1. Para el portal (rol `portal_app`):
--      portal_tutor_threads(session, product_id)  créditos del mes (nunca en dólares), sugerencias del programa y las
--                                                 conversaciones de ESA persona en ESE programa.
--      portal_tutor_thread(session, thread_id)    los mensajes de una conversación propia, con sus citas.
-- 2. Para el servidor de SSA (solo `service_role`), que es quien llama a la IA:
--      app_servicio.portal_tutor_begin(session, product_id, thread_id, question)
--          valida la sesión (estudiante, no vista previa), la sección «assistant» abierta, el tutor prendido, que le
--          queden créditos, un tope de 6 preguntas por minuto y una sola pregunta esperando respuesta por conversación;
--          crea la conversación si hace falta y guarda la pregunta. Devuelve los ids para correr el tutor.
--      app_servicio.portal_tutor_search(contact, product, embedding, n, min)
--          la búsqueda semántica SOLO en el material que ese estudiante tiene abierto (tutor_knowledge_ids, 00352), con
--          la clase y el segundo de cada fragmento para citar.
--      app_servicio.portal_tutor_finish(thread_id, run_id, answer, citations)
--          guarda la respuesta con sus citas y la corrida (que es la que descuenta los créditos, por su costo).
--
-- Ninguna tabla nueva: `ai_threads` (canal 'portal', subject 'product') y `ai_messages` (00320).
-- Volver atrás: DROP FUNCTION de las 6 funciones nuevas (abajo, en «Permisos»).
-- ============================================================================

-- El tutor del programa, si está prendido.
CREATE OR REPLACE FUNCTION app_servicio_portal.tutor_of(p_product uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id FROM public.products p JOIN public.agents a ON a.id = p.tutor_agent_id
   WHERE p.id = p_product AND a.is_enabled AND a.deleted_at IS NULL AND a.type = 'student_tutor';
$$;

-- ─── 1. Lo que lee el portal ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_tutor_threads(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.require_section(sess, p_product_id, 'assistant');
  v_contact uuid := (pf ->> 'contact_id')::uuid;
  v_ws uuid := (pf ->> 'workspace_id')::uuid;
  v_settings jsonb;
  v_detail jsonb;
  v_per numeric;
  v_tz text := app_servicio.ws_tz(v_ws);
BEGIN
  SELECT COALESCE(portal_settings -> 'assistant', '{}'::jsonb) INTO v_settings FROM public.products WHERE id = p_product_id;
  v_detail := app_servicio.assistant_credits_detail(v_contact, p_product_id);
  v_per := GREATEST(0, COALESCE((v_settings ->> 'credits_per_usd')::numeric, 100));
  RETURN jsonb_build_object(
    'available', app_servicio_portal.tutor_of(p_product_id) IS NOT NULL,
    'can_ask', sess ->> 'kind' = 'student',
    'credits_left', COALESCE((v_detail ->> 'credits')::bigint, 0),
    'credits_limit', floor(COALESCE((v_detail ->> 'limitUsd')::numeric, 0) * v_per + 0.000000001)::bigint,
    'reached', COALESCE((v_detail ->> 'reached')::boolean, false),
    'credits_name', COALESCE(NULLIF(btrim(v_settings ->> 'credits_name'), ''), 'créditos'),
    'month', to_char(now() AT TIME ZONE v_tz, 'YYYY-MM'),
    'renews_on', to_char((date_trunc('month', now() AT TIME ZONE v_tz) + interval '1 month')::date, 'YYYY-MM-DD'),
    'suggestions', COALESCE((SELECT jsonb_agg(left(s #>> '{}', 200)) FROM (
        SELECT s FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_settings -> 'suggestions') = 'array' THEN v_settings -> 'suggestions' ELSE '[]'::jsonb END) s
         WHERE jsonb_typeof(s) = 'string' AND btrim(s #>> '{}') <> '' LIMIT 6) x), '[]'::jsonb),
    'threads', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'title', COALESCE(t.title, 'Conversación'), 'last_message_at', t.last_message_at)
                                          ORDER BY t.last_message_at DESC NULLS LAST, t.created_at DESC)
      FROM (SELECT * FROM public.ai_threads t
             WHERE t.workspace_id = v_ws AND t.channel = 'portal' AND t.contact_id = v_contact AND t.subject_type = 'product'
               AND t.subject_id = p_product_id AND t.archived_at IS NULL
             ORDER BY t.last_message_at DESC NULLS LAST, t.created_at DESC LIMIT 30) t), '[]'::jsonb));
END;
$$;

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
                                                              'created_at', m.created_at) ORDER BY m.created_at, m.id)
      FROM (SELECT * FROM public.ai_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 100) m), '[]'::jsonb));
END;
$$;

-- ─── 2. Lo que usa el servidor de SSA ───────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.portal_tutor_begin(p_session text, p_product_id uuid, p_thread_id uuid, p_question text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb;
  v_contact uuid;
  v_ws uuid;
  v_agent uuid;
  v_q text := btrim(COALESCE(p_question, ''));
  v_thread uuid;
  v_msg uuid;
  v_last record;
  v_name text;
BEGIN
  IF sess ->> 'kind' <> 'student' THEN PERFORM app_servicio_portal.err('PO403', 'En la vista previa no se le puede preguntar al asistente'); END IF;
  pf := app_servicio_portal.require_section(sess, p_product_id, 'assistant');
  v_contact := (pf ->> 'contact_id')::uuid;
  v_ws := (pf ->> 'workspace_id')::uuid;
  v_agent := app_servicio_portal.tutor_of(p_product_id);
  IF v_agent IS NULL THEN PERFORM app_servicio_portal.err('PO403', 'El asistente de este programa no está disponible ahora'); END IF;
  IF char_length(v_q) NOT BETWEEN 1 AND 2000 THEN PERFORM app_servicio_portal.err('PO400', 'Escribí una pregunta de hasta 2000 caracteres'); END IF;
  IF public.bump_rate_limit('portal-tutor:' || v_contact::text, date_trunc('minute', now())) > 6 THEN
    PERFORM app_servicio_portal.err('PO429', 'Esperá un minuto y volvé a preguntar');
  END IF;
  IF COALESCE((app_servicio.assistant_credits_detail(v_contact, p_product_id) ->> 'credits')::bigint, 0) <= 0 THEN
    PERFORM app_servicio_portal.err('PO402', 'Llegaste a tu límite de este mes');
  END IF;
  IF p_thread_id IS NULL THEN
    INSERT INTO public.ai_threads (workspace_id, channel, agent_id, contact_id, subject_type, subject_id, title, last_message_at)
    VALUES (v_ws, 'portal', v_agent, v_contact, 'product', p_product_id, left(regexp_replace(v_q, '\s+', ' ', 'g'), 80), now())
    RETURNING id INTO v_thread;
  ELSE
    SELECT id INTO v_thread FROM public.ai_threads
     WHERE id = p_thread_id AND workspace_id = v_ws AND channel = 'portal' AND contact_id = v_contact
       AND subject_type = 'product' AND subject_id = p_product_id AND archived_at IS NULL
     FOR UPDATE;
    IF v_thread IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No encontramos esa conversación'); END IF;
    -- Una pregunta a la vez: la anterior todavía está esperando su respuesta (si falló, a los 2 minutos se puede seguir).
    SELECT m.role, m.created_at INTO v_last FROM public.ai_messages m WHERE m.thread_id = v_thread ORDER BY m.created_at DESC, m.id DESC LIMIT 1;
    IF v_last.role = 'user' AND v_last.created_at > now() - interval '2 minutes' THEN
      PERFORM app_servicio_portal.err('PO409', 'Esperá la respuesta anterior');
    END IF;
    UPDATE public.ai_threads SET last_message_at = now(), updated_at = now() WHERE id = v_thread;
  END IF;
  INSERT INTO public.ai_messages (workspace_id, thread_id, role, content, context)
  VALUES (v_ws, v_thread, 'user', v_q, jsonb_build_object('product_id', p_product_id))
  RETURNING id INTO v_msg;
  SELECT name INTO v_name FROM public.products WHERE id = p_product_id;
  RETURN jsonb_build_object('workspace_id', v_ws, 'contact_id', v_contact, 'agent_id', v_agent, 'product_id', p_product_id,
                            'program_name', v_name, 'thread_id', v_thread, 'message_id', v_msg);
END;
$$;

-- La búsqueda del tutor: solo en lo que ESE estudiante tiene abierto, con la clase y el segundo para citar.
CREATE OR REPLACE FUNCTION app_servicio.portal_tutor_search(p_contact_id uuid, p_product_id uuid, p_embedding extensions.vector,
                                                            p_match_count integer, p_min_similarity double precision)
RETURNS TABLE (chunk_id uuid, document_id uuid, document_title text, content text, similarity double precision,
               item_id uuid, item_title text, lesson_type text, start_second integer, fathom boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH ids AS (SELECT knowledge_id FROM app_servicio.tutor_knowledge_ids(p_contact_id, p_product_id))
  SELECT kc.id, kc.document_id, kb.title, kc.content,
         (1 - (kc.embedding OPERATOR(extensions.<=>) p_embedding))::double precision,
         i.id, i.title, i.lesson_type, kc.start_second, COALESCE(i.video_url ILIKE '%fathom.video%', false)
    FROM public.knowledge_chunks kc
    JOIN public.knowledge_base kb ON kb.id = kc.document_id
    LEFT JOIN app_servicio.program_items i ON i.id = kb.program_item_id
   WHERE kc.document_id IN (SELECT knowledge_id FROM ids)
     AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_embedding)) >= COALESCE(p_min_similarity, 0)
   ORDER BY kc.embedding OPERATOR(extensions.<=>) p_embedding
   LIMIT LEAST(GREATEST(COALESCE(p_match_count, 8), 1), 20);
$$;

-- Guarda la respuesta. Las citas: [{item_id, title, second, fathom}] de clases del mismo programa, hasta 6.
CREATE OR REPLACE FUNCTION app_servicio.portal_tutor_finish(p_thread_id uuid, p_run_id uuid, p_answer text, p_citations jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.ai_threads;
  v_cites jsonb;
  v_id uuid;
BEGIN
  SELECT * INTO t FROM public.ai_threads WHERE id = p_thread_id AND channel = 'portal' AND subject_type = 'product';
  IF t.id IS NULL THEN RAISE EXCEPTION 'No existe la conversación' USING ERRCODE = 'SV002'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id', i.id, 'title', i.title,
                                               'second', CASE WHEN jsonb_typeof(c -> 'second') = 'number' THEN GREATEST(0, (c ->> 'second')::numeric)::integer END,
                                               'fathom', COALESCE(i.video_url ILIKE '%fathom.video%', false))), '[]'::jsonb)
    INTO v_cites
    FROM (SELECT c FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_citations) = 'array' THEN p_citations ELSE '[]'::jsonb END) c LIMIT 6) x
    JOIN app_servicio.program_items i ON i.id::text = x.c ->> 'item_id' AND i.product_id = t.subject_id;
  INSERT INTO public.ai_messages (workspace_id, thread_id, role, content, citations, agent_run_id)
  VALUES (t.workspace_id, t.id, 'assistant', left(COALESCE(NULLIF(btrim(p_answer), ''), '…'), 20000), v_cites,
          (SELECT r.id FROM public.agent_runs r WHERE r.id = p_run_id AND r.workspace_id = t.workspace_id))
  RETURNING id INTO v_id;
  UPDATE public.ai_threads SET last_message_at = now(), updated_at = now() WHERE id = t.id;
  RETURN v_id;
END;
$$;

-- ─── Permisos ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION app_servicio_portal.tutor_of(uuid) FROM PUBLIC, anon, authenticated, portal_app;
REVOKE ALL ON FUNCTION app_servicio_portal.portal_tutor_threads(text, uuid), app_servicio_portal.portal_tutor_thread(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_tutor_threads(text, uuid), app_servicio_portal.portal_tutor_thread(text, uuid)
  TO portal_app, service_role;
REVOKE ALL ON FUNCTION app_servicio.portal_tutor_begin(text, uuid, uuid, text),
  app_servicio.portal_tutor_search(uuid, uuid, extensions.vector, integer, double precision),
  app_servicio.portal_tutor_finish(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, portal_app;
GRANT EXECUTE ON FUNCTION app_servicio.portal_tutor_begin(text, uuid, uuid, text),
  app_servicio.portal_tutor_search(uuid, uuid, extensions.vector, integer, double precision),
  app_servicio.portal_tutor_finish(uuid, uuid, text, jsonb)
  TO service_role;
