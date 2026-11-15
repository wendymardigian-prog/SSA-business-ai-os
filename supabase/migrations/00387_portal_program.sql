-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00387_portal_program  (Portal de estudiantes, Corrida B2 · P05)
-- ============================================================================
-- El contenido del portal (F218 a F222, F244, F211): módulos y clases según lo que la variante incluye y cómo abre
-- cada cosa para ESA persona (`program_item_unlocked`, Corrida A), marcar una clase, evaluaciones (sin las respuestas
-- correctas), actividades (con sus límites de entregas, 00375) y los términos al entrar.
--
--   require_section(sess, product, section)       ayudante: la sección tiene que estar abierta para la persona (PO403).
--   portal_program(session, product_id)           módulos visibles con cómo se ven (abierto · candado · pronto) y sus clases.
--   portal_module(session, item_id)               un módulo con sus clases.
--   portal_lesson(session, item_id)               la clase completa: video, página HTML, si hay PDF, recursos (los links;
--                                                  los archivos por id), anterior y siguiente. Inactiva → PO410.
--   portal_lesson_mark(session, item_id, seconds, complete)  vista (idempotente; el avance solo sube).
--   portal_quiz_get / portal_quiz_submit           preguntas SIN las correctas; la nota la calcula la base al guardar.
--   portal_activity_get / portal_activity_submit   el formulario, la escala, el historial (sin la nota interna) y si
--                                                  puede entregar (`submission_plan`); la base aplica los límites.
--   portal_terms_get / portal_terms_accept         el formulario de términos vigente y su aceptación (F113).
--   app_servicio.portal_file_grant(session, kind, item, ref)   SOLO el servidor de SSA: qué archivo puede ver o
--                                                  subir la persona (bucket y ruta). SSA arma el link de 5 minutos.
--
-- La vista previa lee y no escribe (PO403). Aditiva.
--
-- La nota nunca lleva las respuestas correctas; el «bien o mal» por pregunta, solo con `quiz.show_correct`.
--
-- Volver atrás: DROP FUNCTION de cada una (las de abajo).
-- ============================================================================

CREATE OR REPLACE FUNCTION app_servicio_portal.require_section(p_sess jsonb, p_product uuid, p_section text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pf jsonb := app_servicio_portal.program_for(p_sess, p_product);
  v jsonb;
BEGIN
  v := app_servicio_portal.ctx_section((pf ->> 'contact_id')::uuid, p_product, (pf ->> 'variant_id')::uuid, p_section, (pf ->> 'starts_on')::date);
  IF v IS NULL OR v ->> 'display' <> 'open' THEN
    PERFORM app_servicio_portal.err('PO403', COALESCE(v ->> 'reason', 'Esta sección no está abierta'));
  END IF;
  RETURN pf;
END;
$$;

-- Una clase o submódulo visible para la persona, con su apertura.
CREATE OR REPLACE FUNCTION app_servicio_portal.lesson_row(p_contact uuid, i app_servicio.program_items)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u jsonb := app_servicio.program_item_unlocked(p_contact, i.id);
  pp app_servicio_portal.program_progress;
BEGIN
  IF NOT COALESCE((u ->> 'visible')::boolean, false) THEN RETURN NULL; END IF;
  SELECT * INTO pp FROM app_servicio_portal.program_progress WHERE contact_id = p_contact AND program_item_id = i.id ORDER BY updated_at DESC LIMIT 1;
  RETURN jsonb_build_object('id', i.id, 'kind', i.kind, 'title', i.title, 'description', left(i.description, 280), 'lesson_type', i.lesson_type,
    'duration_seconds', i.duration_seconds, 'thumbnail_url', i.thumbnail_url, 'thumbnail_path', i.thumbnail_path, 'required', i.required,
    'unlocked', COALESCE((u ->> 'unlocked')::boolean, false), 'display', u ->> 'display', 'reason', u ->> 'reason', 'opens_on', u ->> 'opensOn',
    'viewed', pp.viewed_at IS NOT NULL, 'completed', pp.completed_at IS NOT NULL,
    'new', COALESCE(pp.unlocked_at, i.created_at) > now() - interval '7 days' AND pp.viewed_at IS NULL,
    'comments', (SELECT count(*) FROM app_servicio_portal.community_posts p WHERE p.program_item_id = i.id AND p.deleted_at IS NULL AND p.hidden_at IS NULL));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.module_row(p_contact uuid, m app_servicio.program_items)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u jsonb := app_servicio.program_item_unlocked(p_contact, m.id);
BEGIN
  IF NOT COALESCE((u ->> 'visible')::boolean, false) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', m.id, 'title', m.title, 'description', m.description, 'cover_path', m.cover_path, 'thumbnail_url', m.thumbnail_url,
    'unlocked', COALESCE((u ->> 'unlocked')::boolean, false), 'display', u ->> 'display', 'reason', u ->> 'reason', 'opens_on', u ->> 'opensOn',
    'items', CASE WHEN COALESCE((u ->> 'unlocked')::boolean, false) THEN COALESCE((
      SELECT jsonb_agg(r ORDER BY pos) FROM (
        SELECT app_servicio_portal.lesson_row(p_contact, c) r, c.position pos FROM app_servicio.program_items c
         WHERE c.parent_id = m.id AND c.status = 'active') x WHERE r IS NOT NULL), '[]'::jsonb) ELSE '[]'::jsonb END);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_program(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.require_section(sess, p_product_id, 'program');
BEGIN
  RETURN jsonb_build_object('modules', COALESCE((
    SELECT jsonb_agg(r ORDER BY pos) FROM (
      SELECT app_servicio_portal.module_row((pf ->> 'contact_id')::uuid, m) r, m.position pos FROM app_servicio.program_items m
       WHERE m.product_id = p_product_id AND m.kind = 'module' AND m.parent_id IS NULL AND m.status = 'active') x WHERE r IS NOT NULL), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_module(p_session text, p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  m app_servicio.program_items;
  pf jsonb;
  v jsonb;
BEGIN
  SELECT * INTO m FROM app_servicio.program_items WHERE id = p_item_id AND kind IN ('module', 'submodule');
  IF m.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Este módulo no existe'); END IF;
  pf := app_servicio_portal.require_section(sess, m.product_id, 'program');
  IF m.status <> 'active' THEN PERFORM app_servicio_portal.err('PO410', 'Este módulo ya no está disponible'); END IF;
  v := app_servicio_portal.module_row((pf ->> 'contact_id')::uuid, m);
  IF v IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Este módulo no existe'); END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_lesson(p_session text, p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  i app_servicio.program_items;
  m app_servicio.program_items;
  pf jsonb;
  u jsonb;
  v_contact uuid;
  v_sib uuid[];
  v_idx integer;
  pp app_servicio_portal.program_progress;
BEGIN
  SELECT * INTO i FROM app_servicio.program_items WHERE id = p_item_id AND kind = 'lesson';
  IF i.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Esta clase no existe'); END IF;
  pf := app_servicio_portal.require_section(sess, i.product_id, 'program');
  v_contact := (pf ->> 'contact_id')::uuid;
  IF i.status <> 'active' THEN PERFORM app_servicio_portal.err('PO410', 'Esta clase ya no está disponible'); END IF;
  u := app_servicio.program_item_unlocked(v_contact, i.id);
  IF NOT COALESCE((u ->> 'visible')::boolean, false) THEN PERFORM app_servicio_portal.err('PO404', 'Esta clase no existe'); END IF;
  IF NOT COALESCE((u ->> 'unlocked')::boolean, false) THEN PERFORM app_servicio_portal.err('PO403', COALESCE(u ->> 'reason', 'Esta clase todavía no está abierta')); END IF;
  SELECT * INTO m FROM app_servicio.program_items WHERE id = i.parent_id;
  SELECT array_agg(c.id ORDER BY c.position) INTO v_sib FROM app_servicio.program_items c WHERE c.parent_id = i.parent_id AND c.status = 'active' AND c.kind = 'lesson';
  v_idx := array_position(v_sib, i.id);
  SELECT * INTO pp FROM app_servicio_portal.program_progress WHERE contact_id = v_contact AND program_item_id = i.id ORDER BY updated_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'id', i.id, 'title', i.title, 'description', i.description, 'lesson_type', i.lesson_type, 'duration_seconds', i.duration_seconds,
    'module', jsonb_build_object('id', m.id, 'title', m.title),
    'video_embed_url', i.video_embed_url, 'video_url', i.video_url, 'thumbnail_url', i.thumbnail_url,
    'fathom', CASE WHEN i.source_call_id IS NOT NULL AND i.video_embed_url IS NULL THEN jsonb_build_object('url', (SELECT c.share_url FROM public.calls c WHERE c.id = i.source_call_id)) END,
    'html', CASE WHEN i.lesson_type = 'html' THEN i.html_content END,
    'has_document', i.document_path IS NOT NULL,
    'resources', COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', r ->> 'id', 'name', COALESCE(r ->> 'name', r ->> 'title'),
                     'kind', CASE WHEN r ? 'url' AND NOT r ? 'path' THEN 'link' ELSE 'file' END, 'url', CASE WHEN NOT r ? 'path' THEN r ->> 'url' END)))
                   FROM jsonb_array_elements(COALESCE(i.resources, '[]'::jsonb)) r), '[]'::jsonb),
    'comments_enabled', i.comments_enabled,
    'viewed', pp.viewed_at IS NOT NULL, 'completed', pp.completed_at IS NOT NULL, 'position_seconds', pp.last_position_seconds,
    'prev_id', CASE WHEN v_idx > 1 THEN v_sib[v_idx - 1] END, 'next_id', CASE WHEN v_idx < cardinality(v_sib) THEN v_sib[v_idx + 1] END);
END;
$$;

-- Vista (y completa con p_complete). El avance solo sube: nunca se borra una vista ni una completada.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_lesson_mark(p_session text, p_item_id uuid, p_seconds integer DEFAULT NULL, p_complete boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  i app_servicio.program_items;
  v_contact uuid := (sess ->> 'contact_id')::uuid;
  v_id uuid;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  SELECT * INTO i FROM app_servicio.program_items WHERE id = p_item_id AND kind = 'lesson' AND status = 'active';
  IF i.id IS NULL THEN PERFORM app_servicio_portal.err('PO410', 'Esta clase ya no está disponible'); END IF;
  PERFORM app_servicio_portal.require_section(sess, i.product_id, 'program');
  IF NOT COALESCE((app_servicio.program_item_unlocked(v_contact, i.id) ->> 'unlocked')::boolean, false) THEN
    PERFORM app_servicio_portal.err('PO403', 'Esta clase todavía no está abierta');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-progress:' || v_contact::text || ':' || i.id::text, 0));
  SELECT id INTO v_id FROM app_servicio_portal.program_progress WHERE contact_id = v_contact AND program_item_id = i.id ORDER BY created_at LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO app_servicio_portal.program_progress (workspace_id, contact_id, program_item_id, viewed_at, completed_at, last_position_seconds)
    VALUES (i.workspace_id, v_contact, i.id, now(), CASE WHEN p_complete THEN now() END, GREATEST(COALESCE(p_seconds, 0), 0));
  ELSE
    UPDATE app_servicio_portal.program_progress
       SET viewed_at = COALESCE(viewed_at, now()), completed_at = COALESCE(completed_at, CASE WHEN p_complete THEN now() END),
           last_position_seconds = GREATEST(COALESCE(last_position_seconds, 0), COALESCE(p_seconds, 0)), updated_at = now()
     WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─── Evaluaciones y actividades ─────────────────────────────────────────────
-- El formulario de una evaluación o actividad del programa, abierto para la persona. Nunca lleva las correctas.
CREATE OR REPLACE FUNCTION app_servicio_portal.form_item(p_sess jsonb, p_item_id uuid, p_type text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i app_servicio.program_items;
  pf jsonb;
  f public.forms;
  d jsonb;
BEGIN
  SELECT * INTO i FROM app_servicio.program_items WHERE id = p_item_id AND kind = 'lesson' AND lesson_type = p_type;
  IF i.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No existe'); END IF;
  pf := app_servicio_portal.require_section(p_sess, i.product_id, 'program');
  IF i.status <> 'active' THEN PERFORM app_servicio_portal.err('PO410', 'Ya no está disponible'); END IF;
  IF NOT COALESCE((app_servicio.program_item_unlocked((pf ->> 'contact_id')::uuid, i.id) ->> 'unlocked')::boolean, false) THEN
    PERFORM app_servicio_portal.err('PO403', 'Todavía no está abierta');
  END IF;
  SELECT * INTO f FROM public.forms WHERE id = i.form_id;
  IF f.id IS NULL OR f.current_version_id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Todavía no está lista'); END IF;
  SELECT definition INTO d FROM public.form_versions WHERE id = f.current_version_id;
  RETURN jsonb_build_object('item_id', i.id, 'title', i.title, 'description', i.description, 'form_id', f.id, 'version_id', f.current_version_id,
    'contact_id', pf ->> 'contact_id', 'workspace_id', pf ->> 'workspace_id', 'definition', d);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.public_fields(d jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', f ->> 'key', 'type', f ->> 'type', 'label', f ->> 'label', 'help', f ->> 'help',
           'required', COALESCE((f ->> 'required')::boolean, false), 'options', f -> 'options', 'points', d #> ARRAY['quiz', 'questions', f ->> 'key', 'points']))
           ORDER BY n), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(d -> 'fields', '[]'::jsonb)) WITH ORDINALITY t(f, n);
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_quiz_get(p_session text, p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  x jsonb := app_servicio_portal.form_item(sess, p_item_id, 'quiz');
  q jsonb := COALESCE(x #> '{definition,quiz}', '{}'::jsonb);
BEGIN
  RETURN jsonb_build_object('item_id', x -> 'item_id', 'title', x -> 'title', 'description', x -> 'description', 'intro', x #> '{definition,intro}',
    'fields', app_servicio_portal.public_fields(x -> 'definition'),
    'pass_pct', COALESCE((q ->> 'pass_pct')::numeric, 70), 'attempts', COALESCE((q ->> 'attempts')::integer, 1), 'show_grade', COALESCE((q ->> 'show_grade')::boolean, true),
    'tries', COALESCE((SELECT jsonb_agg(jsonb_build_object('attempt', fs.attempt, 'at', fs.created_at,
                 'grade', CASE WHEN COALESCE((q ->> 'show_grade')::boolean, true) THEN CASE WHEN COALESCE((q ->> 'show_correct')::boolean, false) THEN fs.grade ELSE fs.grade - 'per_question' END END) ORDER BY fs.created_at)
               FROM public.form_submissions fs WHERE fs.form_id = (x ->> 'form_id')::uuid AND fs.contact_id = (x ->> 'contact_id')::uuid AND fs.status = 'received'), '[]'::jsonb));
END;
$$;

-- Guarda la respuesta: la nota la calcula la base (portal_form_before_hook) y la devuelve al instante.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_submit(p_sess jsonb, p_x jsonb, p_answers jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN PERFORM app_servicio_portal.err('PO400', 'Faltan las respuestas'); END IF;
  -- Solo las claves del formulario.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_answers) k WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_x #> '{definition,fields}', '[]'::jsonb)) f WHERE f ->> 'key' = k)) THEN
    PERFORM app_servicio_portal.err('PO400', 'Hay respuestas que no son de este formulario');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_x #> '{definition,fields}', '[]'::jsonb)) f
              WHERE COALESCE((f ->> 'required')::boolean, false) AND NULLIF(btrim(COALESCE(p_answers ->> (f ->> 'key'), '')), '') IS NULL
                AND COALESCE(p_answers -> (f ->> 'key'), 'null'::jsonb) IN ('null'::jsonb, '[]'::jsonb, '""'::jsonb)) THEN
    PERFORM app_servicio_portal.err('PO400', 'Completá las preguntas obligatorias');
  END IF;
  INSERT INTO public.form_submissions (workspace_id, form_id, form_version_id, idempotency_key, status, answers, contact_id, meta)
  VALUES ((p_x ->> 'workspace_id')::uuid, (p_x ->> 'form_id')::uuid, (p_x ->> 'version_id')::uuid, gen_random_uuid(), 'received', p_answers,
          (p_x ->> 'contact_id')::uuid, jsonb_build_object('source', 'portal', 'program_item_id', p_x ->> 'item_id'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_quiz_submit(p_session text, p_item_id uuid, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  x jsonb := app_servicio_portal.form_item(sess, p_item_id, 'quiz');
  v_max integer := COALESCE((x #>> '{definition,quiz,attempts}')::integer, 1);
  v_used integer;
  fs public.form_submissions;
  v_new uuid;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-form:' || (x ->> 'contact_id') || ':' || (x ->> 'form_id'), 0));
  SELECT count(*) INTO v_used FROM public.form_submissions WHERE form_id = (x ->> 'form_id')::uuid AND contact_id = (x ->> 'contact_id')::uuid AND status = 'received';
  IF v_max > 0 AND v_used >= v_max THEN PERFORM app_servicio_portal.err('PO409', 'Ya usaste todos tus intentos'); END IF;
  v_new := app_servicio_portal.portal_submit(sess, x, p_answers);
  SELECT * INTO fs FROM public.form_submissions WHERE id = v_new;
  RETURN jsonb_build_object('ok', true, 'attempt', fs.attempt, 'attempts_left', GREATEST(v_max - v_used - 1, 0),
    'grade', CASE WHEN COALESCE((x #>> '{definition,quiz,show_grade}')::boolean, true)
                   THEN CASE WHEN COALESCE((x #>> '{definition,quiz,show_correct}')::boolean, false) THEN fs.grade ELSE fs.grade - 'per_question' END END);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_activity_get(p_session text, p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  x jsonb := app_servicio_portal.form_item(sess, p_item_id, 'activity');
  v_hist jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', fs.id, 'attempt', fs.attempt, 'at', fs.created_at, 'status', fs.review_status,
           'grade', fs.grade, 'comment', fs.review_comment, 'reviewed_at', fs.reviewed_at, 'answers', fs.answers) ORDER BY fs.attempt, fs.created_at), '[]'::jsonb)
    INTO v_hist FROM public.form_submissions fs
   WHERE fs.form_id = (x ->> 'form_id')::uuid AND fs.contact_id = (x ->> 'contact_id')::uuid AND fs.status = 'received';
  RETURN jsonb_build_object('item_id', x -> 'item_id', 'title', x -> 'title', 'description', x -> 'description', 'intro', x #> '{definition,intro}',
    'fields', app_servicio_portal.public_fields(x -> 'definition'),
    'grading', x #> '{definition,grading}', 'history', v_hist,
    'plan', app_servicio.submission_plan(jsonb_build_object('limits', x #> '{definition,submission}',
              'history', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', h ->> 'id', 'status', h ->> 'status')), '[]'::jsonb) FROM jsonb_array_elements(v_hist) h))));
END;
$$;

-- Los límites (EV003 a EV005) los aplica el enganche de la 00375 al guardar.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_activity_submit(p_session text, p_item_id uuid, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  x jsonb := app_servicio_portal.form_item(sess, p_item_id, 'activity');
  fs public.form_submissions;
  v_new uuid;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  v_new := app_servicio_portal.portal_submit(sess, x, p_answers);
  SELECT * INTO fs FROM public.form_submissions WHERE id = v_new;
  RETURN jsonb_build_object('ok', true, 'id', fs.id, 'attempt', fs.attempt, 'status', fs.review_status);
END;
$$;

-- ─── Términos al entrar (F211) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_terms_get(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  f public.forms;
  d jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_servicio_portal.ctx_programs((sess ->> 'workspace_id')::uuid, (sess ->> 'contact_id')::uuid) x WHERE x.product_id = p_product_id) THEN
    PERFORM app_servicio_portal.err('PO404', 'Esto no está en tus programas');
  END IF;
  SELECT fo.* INTO f FROM public.products p JOIN public.forms fo ON fo.id = NULLIF(p.portal_settings #>> '{terms,form_id}', '')::uuid WHERE p.id = p_product_id;
  IF f.id IS NULL THEN RETURN jsonb_build_object('pending', false); END IF;
  SELECT fv.definition INTO d FROM public.form_versions fv WHERE fv.form_id = f.id ORDER BY fv.version_number DESC LIMIT 1;
  RETURN jsonb_build_object('pending', app_servicio.portal_terms_pending((sess ->> 'contact_id')::uuid, p_product_id),
    'version_id', (SELECT fv.id FROM public.form_versions fv WHERE fv.form_id = f.id ORDER BY fv.version_number DESC LIMIT 1),
    'title', f.name, 'intro', d -> 'intro', 'fields', app_servicio_portal.public_fields(d));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_terms_accept(p_session text, p_product_id uuid, p_version_id uuid, p_checks jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  f public.forms;
  v_current uuid;
  d jsonb;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  IF NOT EXISTS (SELECT 1 FROM app_servicio_portal.ctx_programs((sess ->> 'workspace_id')::uuid, (sess ->> 'contact_id')::uuid) x WHERE x.product_id = p_product_id) THEN
    PERFORM app_servicio_portal.err('PO404', 'Esto no está en tus programas');
  END IF;
  IF NOT app_servicio.portal_terms_pending((sess ->> 'contact_id')::uuid, p_product_id) THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  SELECT fo.* INTO f FROM public.products p JOIN public.forms fo ON fo.id = NULLIF(p.portal_settings #>> '{terms,form_id}', '')::uuid WHERE p.id = p_product_id;
  SELECT fv.id, fv.definition INTO v_current, d FROM public.form_versions fv WHERE fv.form_id = f.id ORDER BY fv.version_number DESC LIMIT 1;
  IF v_current IS DISTINCT FROM p_version_id THEN PERFORM app_servicio_portal.err('PO409', 'Los términos cambiaron. Volvé a leerlos'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(d -> 'fields', '[]'::jsonb)) x
              WHERE x ->> 'type' = 'consent' AND COALESCE(p_checks -> (x ->> 'key'), 'false'::jsonb) <> 'true'::jsonb) THEN
    PERFORM app_servicio_portal.err('PO400', 'Tildá todos los compromisos');
  END IF;
  INSERT INTO public.form_submissions (workspace_id, form_id, form_version_id, idempotency_key, status, answers, contact_id, meta)
  VALUES ((sess ->> 'workspace_id')::uuid, f.id, v_current, gen_random_uuid(), 'received', p_checks, (sess ->> 'contact_id')::uuid,
          jsonb_build_object('source', 'portal', 'product_id', p_product_id));
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─── Archivos: SOLO el servidor de SSA (arma el link de 5 minutos) ──────────
-- kind: document (el PDF de una clase) · resource (un archivo de una clase, p_ref = su id) · avatar (la foto propia) ·
-- avatar_upload (subir la foto propia) · activity_upload (subir un archivo a una actividad, p_ref = la extensión).
CREATE OR REPLACE FUNCTION app_servicio.portal_file_grant(p_session text, p_kind text, p_item_id uuid DEFAULT NULL, p_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  i app_servicio.program_items;
  x jsonb;
  v_path text;
  v_ext text := lower(COALESCE(p_ref, ''));
BEGIN
  IF p_kind IN ('document', 'resource') THEN
    SELECT * INTO i FROM app_servicio.program_items WHERE id = p_item_id AND kind = 'lesson' AND status = 'active';
    IF i.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No existe'); END IF;
    PERFORM app_servicio_portal.require_section(sess, i.product_id, 'program');
    IF NOT COALESCE((app_servicio.program_item_unlocked((sess ->> 'contact_id')::uuid, i.id) ->> 'unlocked')::boolean, false) THEN
      PERFORM app_servicio_portal.err('PO403', 'Todavía no está abierta');
    END IF;
    IF p_kind = 'document' THEN v_path := i.document_path;
    ELSE SELECT r ->> 'path' INTO v_path FROM jsonb_array_elements(COALESCE(i.resources, '[]'::jsonb)) r WHERE r ->> 'id' = p_ref LIMIT 1;
    END IF;
    IF v_path IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No existe'); END IF;
    RETURN jsonb_build_object('bucket', 'program-resources', 'path', v_path, 'upload', false);
  ELSIF p_kind = 'avatar' THEN
    SELECT a.avatar_path INTO v_path FROM app_servicio_portal.portal_accounts a WHERE a.id = (sess ->> 'account_id')::uuid;
    IF v_path IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No hay foto'); END IF;
    RETURN jsonb_build_object('bucket', 'portal-avatars', 'path', v_path, 'upload', false);
  ELSIF p_kind = 'avatar_upload' THEN
    PERFORM app_servicio_portal.require_write(sess);
    IF v_ext NOT IN ('png', 'jpg', 'jpeg', 'webp') THEN PERFORM app_servicio_portal.err('PO400', 'La foto tiene que ser PNG, JPG o WEBP'); END IF;
    v_path := (sess ->> 'workspace_id') || '/' || (sess ->> 'account_id') || '/' || gen_random_uuid()::text || '.' || v_ext;
    RETURN jsonb_build_object('bucket', 'portal-avatars', 'path', v_path, 'upload', true);
  ELSIF p_kind = 'activity_upload' THEN
    PERFORM app_servicio_portal.require_write(sess);
    x := app_servicio_portal.form_item(sess, p_item_id, 'activity');
    IF v_ext !~ '^[a-z0-9]{1,8}$' THEN PERFORM app_servicio_portal.err('PO400', 'Ese archivo no se puede subir'); END IF;
    v_path := (x ->> 'workspace_id') || '/' || (x ->> 'form_id') || '/' || (x ->> 'contact_id') || '/' || gen_random_uuid()::text || '.' || v_ext;
    RETURN jsonb_build_object('bucket', 'form-uploads', 'path', v_path, 'upload', true);
  END IF;
  PERFORM app_servicio_portal.err('PO400', 'Pedido no válido');
END;
$$;

-- Guardar la foto ya subida (la ruta la dio portal_file_grant: es de esa cuenta).
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_avatar_set(p_session text, p_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  IF p_path IS NULL OR p_path NOT LIKE (sess ->> 'workspace_id') || '/' || (sess ->> 'account_id') || '/%' THEN
    PERFORM app_servicio_portal.err('PO400', 'La foto no es válida');
  END IF;
  UPDATE app_servicio_portal.portal_accounts SET avatar_path = p_path, updated_at = now() WHERE id = (sess ->> 'account_id')::uuid;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION app_servicio_portal.require_section(jsonb, uuid, text), app_servicio_portal.lesson_row(uuid, app_servicio.program_items),
  app_servicio_portal.module_row(uuid, app_servicio.program_items), app_servicio_portal.portal_program(text, uuid), app_servicio_portal.portal_module(text, uuid),
  app_servicio_portal.portal_lesson(text, uuid), app_servicio_portal.portal_lesson_mark(text, uuid, integer, boolean),
  app_servicio_portal.form_item(jsonb, uuid, text), app_servicio_portal.public_fields(jsonb), app_servicio_portal.portal_quiz_get(text, uuid),
  app_servicio_portal.portal_submit(jsonb, jsonb, jsonb), app_servicio_portal.portal_quiz_submit(text, uuid, jsonb),
  app_servicio_portal.portal_activity_get(text, uuid), app_servicio_portal.portal_activity_submit(text, uuid, jsonb),
  app_servicio_portal.portal_terms_get(text, uuid), app_servicio_portal.portal_terms_accept(text, uuid, uuid, jsonb),
  app_servicio.portal_file_grant(text, text, uuid, text), app_servicio_portal.portal_avatar_set(text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_program(text, uuid), app_servicio_portal.portal_module(text, uuid),
  app_servicio_portal.portal_lesson(text, uuid), app_servicio_portal.portal_lesson_mark(text, uuid, integer, boolean),
  app_servicio_portal.portal_quiz_get(text, uuid), app_servicio_portal.portal_quiz_submit(text, uuid, jsonb),
  app_servicio_portal.portal_activity_get(text, uuid), app_servicio_portal.portal_activity_submit(text, uuid, jsonb),
  app_servicio_portal.portal_terms_get(text, uuid), app_servicio_portal.portal_terms_accept(text, uuid, uuid, jsonb),
  app_servicio_portal.portal_avatar_set(text, text)
TO portal_app, service_role;
GRANT EXECUTE ON FUNCTION app_servicio.portal_file_grant(text, text, uuid, text) TO service_role;
