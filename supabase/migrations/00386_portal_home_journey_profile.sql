-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00386_portal_home_journey_profile  (Portal de estudiantes, Corrida B2 · P04)
-- ============================================================================
-- El contrato del Inicio, Mi camino, el perfil y el certificado (§5 del plano del portal; F214 a F217). Todas
-- reciben la sesión: el contacto y el negocio salen de ahí. Devuelven los datos; el portal los acomoda a su pantalla
-- (fechas en la zona del estudiante, textos).
--
--   program_for(sess, product)              ayudante: el programa tiene que ser de la persona (PO404), sin términos
--                                            pendientes (PO451) y sin pausa que corte el acceso (PO423).
--   portal_home(session, product_id)        avance, línea de fases, próxima clase en vivo, lo pendiente más cercano,
--                                            dónde seguir en el contenido, el reto, el certificado, las cifras y los
--                                            puntos de la semana.
--   portal_journey(session, product_id)     fases y pasos VISIBLES para el estudiante (`visible_to_client`), con su
--                                            plazo, quién lo hace, si está bloqueado, el botón (si el equipo lo prendió)
--                                            y si puede ver su respuesta. Las repeticiones de un paso vienen contadas.
--   portal_step_response(session, item_id)  sus respuestas a ese paso, de solo lectura, si `ref.show_response` no es
--                                            false. Nunca la nota interna ni la de otro.
--   portal_profile_get / portal_profile_save  nombre, zona horaria, tema, «No aparecer en el ranking»; el email es
--                                            de solo lectura. La vista previa no guarda (PO403).
--   portal_certificate(session, product_id) el certificado vigente (o anulado) del servicio: código y estado. El
--                                            link público y el PDF los arma el portal con la base de links del negocio.
--
-- Solo lectura salvo `portal_profile_save`. Aditiva.
--
-- Volver atrás: DROP FUNCTION IF EXISTS app_servicio_portal.program_for(jsonb, uuid, boolean), app_servicio_portal.portal_home(text, uuid),
--   app_servicio_portal.portal_journey(text, uuid), app_servicio_portal.portal_step_response(text, uuid),
--   app_servicio_portal.portal_profile_get(text), app_servicio_portal.portal_profile_save(text, jsonb),
--   app_servicio_portal.portal_certificate(text, uuid);
-- ============================================================================

-- El programa de la persona, con las guardas de F211 y F212. p_allow_paused: el Inicio y el perfil se ven en pausa.
CREATE OR REPLACE FUNCTION app_servicio_portal.program_for(p_sess jsonb, p_product uuid, p_allow_paused boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pr record;
BEGIN
  SELECT * INTO pr FROM app_servicio_portal.ctx_programs((p_sess ->> 'workspace_id')::uuid, (p_sess ->> 'contact_id')::uuid) x WHERE x.product_id = p_product;
  IF pr.product_id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Esto no está en tus programas'); END IF;
  IF app_servicio.portal_terms_pending((p_sess ->> 'contact_id')::uuid, p_product) THEN
    PERFORM app_servicio_portal.err('PO451', 'Antes de seguir, aceptá los términos del programa');
  END IF;
  IF NOT p_allow_paused AND pr.status = 'paused' AND pr.pause_cut_access THEN
    PERFORM app_servicio_portal.err('PO423', 'Tu programa está en pausa' || COALESCE(' · se reanuda el ' || to_char(pr.pause_resume_on, 'DD/MM/YYYY'), ''));
  END IF;
  RETURN jsonb_build_object('product_id', pr.product_id, 'service_id', pr.service_id, 'variant_id', pr.variant_id, 'status', pr.status,
                            'starts_on', pr.starts_on, 'contact_id', p_sess ->> 'contact_id', 'workspace_id', p_sess ->> 'workspace_id');
END;
$$;

-- ─── Mi camino ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_journey(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.program_for(sess, p_product_id);
  v_service uuid := (pf ->> 'service_id')::uuid;
BEGIN
  RETURN jsonb_build_object(
    'service_id', v_service,
    'timezone', app_servicio.points_tz((pf ->> 'contact_id')::uuid, (pf ->> 'workspace_id')::uuid),
    'phases', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', ph.id, 'name', ph.name, 'status', ph.status, 'position', ph.position, 'duration_days', ph.duration_days,
               'started_at', ph.started_at, 'completed_at', ph.completed_at, 'challenge', COALESCE(ph.challenge -> 'enabled' = 'true'::jsonb, false),
               'awaiting_start', ph.awaiting_start,
               'items', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', i.id, 'name', i.name, 'description', i.description, 'kind', i.kind, 'status', i.status,
                          'required', i.required, 'who', CASE WHEN i.assignee = 'student' THEN 'student' ELSE 'team' END,
                          'due_on', i.due_on, 'due_at', i.due_at, 'completed_at', i.completed_at,
                          'lock', CASE WHEN jsonb_typeof(i.ref -> 'lock') = 'object' AND i.status = 'pending' THEN app_servicio.svc_item_lock_state(i.id) END,
                          'portal_button', i.portal_button,
                          'button', CASE WHEN i.portal_button THEN jsonb_strip_nulls(jsonb_build_object(
                                      'label', i.ref #>> '{button,label}',
                                      'url', CASE WHEN i.kind IN ('team_task', 'student_task', 'checkbox') THEN i.ref #>> '{button,url}' END,
                                      'complete_on', i.ref ->> 'complete_on')) END,
                          'show_response', i.kind IN ('form', 'survey', 'activity', 'quiz', 'contract') AND COALESCE(i.ref -> 'show_response' <> 'false'::jsonb, true),
                          'repeats', i.is_recurring_template,
                          'occurrences', CASE WHEN i.is_recurring_template THEN (
                             SELECT jsonb_build_object('done', count(*) FILTER (WHERE o.status = 'completed'), 'total', count(*),
                                                       'due_today', count(*) FILTER (WHERE o.status = 'pending' AND o.due_on = app_servicio.today_in(i.workspace_id)))
                               FROM app_servicio.service_items o WHERE o.parent_item_id = i.id) END)
                        ORDER BY i.position, i.created_at)
                   FROM app_servicio.service_items i
                  WHERE i.phase_id = ph.id AND i.visible_to_client AND i.parent_item_id IS NULL), '[]'::jsonb))
             ORDER BY ph.position)
        FROM app_servicio.service_phases ph WHERE ph.service_id = v_service), '[]'::jsonb));
END;
$$;

-- ─── La respuesta de un paso (solo lectura) ─────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_step_response(p_session text, p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  i app_servicio.service_items;
  s app_servicio.services;
  fs public.form_submissions;
  v_fields jsonb;
BEGIN
  SELECT * INTO i FROM app_servicio.service_items WHERE id = p_item_id;
  SELECT * INTO s FROM app_servicio.services WHERE id = i.service_id;
  IF i.id IS NULL OR s.contact_id IS DISTINCT FROM (sess ->> 'contact_id')::uuid OR NOT i.visible_to_client
     OR i.kind NOT IN ('form', 'survey', 'activity', 'quiz', 'contract') OR i.ref -> 'show_response' = 'false'::jsonb THEN
    PERFORM app_servicio_portal.err('PO404', 'No hay una respuesta para mostrar');
  END IF;
  PERFORM app_servicio_portal.program_for(sess, s.product_id);
  SELECT * INTO fs FROM public.form_submissions f
   WHERE f.contact_id = s.contact_id AND f.form_id::text = i.ref ->> 'form_id' AND COALESCE(f.review_status, '') <> 'superseded'
   ORDER BY (f.service_item_id = i.id) DESC NULLS LAST, f.created_at DESC LIMIT 1;
  IF fs.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Todavía no hay una respuesta'); END IF;
  SELECT v.definition -> 'fields' INTO v_fields FROM public.form_versions v WHERE v.id = fs.form_version_id;
  RETURN jsonb_build_object('kind', i.kind, 'title', i.name, 'sent_at', fs.created_at,
    'answers', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', COALESCE(f ->> 'label', f ->> 'key'), 'value', fs.answers -> (f ->> 'key')) ORDER BY n)
                           FROM jsonb_array_elements(COALESCE(v_fields, '[]'::jsonb)) WITH ORDINALITY t(f, n)
                          WHERE fs.answers ? (f ->> 'key') AND f ->> 'type' NOT IN ('hidden', 'section', 'text_block')), '[]'::jsonb));
END;
$$;

-- ─── Inicio ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_home(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.program_for(sess, p_product_id, true);
  v_service uuid := (pf ->> 'service_id')::uuid;
  v_contact uuid := (pf ->> 'contact_id')::uuid;
  v_ws uuid := (pf ->> 'workspace_id')::uuid;
  s app_servicio.services;
  v_today date;
  v_tz text;
  v_live jsonb; v_pending jsonb; v_continue jsonb; v_first jsonb; v_cert jsonb; v_lessons jsonb; v_week integer; v_place integer;
  v_ch jsonb;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = v_service;
  v_tz := app_servicio.points_tz(v_contact, v_ws);
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- La próxima clase en vivo de SU variante (sin el link de la reunión: ese sale solo al «Entrar», F223).
  SELECT jsonb_build_object('session_id', o.live_session_id, 'title', ls.title, 'occurs_on', o.occurs_on, 'starts_at', o.starts_at, 'ends_at', o.ends_at)
    INTO v_live
    FROM app_servicio.live_session_occurrences(p_product_id, v_today, v_today + 45) o
    JOIN app_servicio.live_sessions ls ON ls.id = o.live_session_id
   WHERE o.ends_at > now() AND COALESCE(o.status, 'scheduled') <> 'cancelled'
     AND (ls.variant_ids IS NULL OR cardinality(ls.variant_ids) = 0 OR s.product_variant_id = ANY (ls.variant_ids))
   ORDER BY o.starts_at LIMIT 1;

  -- Lo pendiente más cercano que hace la persona.
  SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'due_at' NULLS LAST, x ->> 'due_on' NULLS LAST), '[]'::jsonb) INTO v_pending FROM (
    SELECT jsonb_build_object('item_id', i.id, 'title', i.name, 'kind', i.kind, 'due_on', i.due_on, 'due_at', i.due_at,
                              'overdue', i.due_on IS NOT NULL AND i.due_on < v_today) x
      FROM app_servicio.service_items i
     WHERE i.service_id = v_service AND i.visible_to_client AND i.status = 'pending' AND NOT i.is_recurring_template AND i.assignee = 'student'
       AND (i.due_on IS NULL OR i.due_on <= v_today + 14)
     ORDER BY i.due_on NULLS LAST, i.due_at NULLS LAST, i.position LIMIT 3) t;

  -- Dónde seguir: la última clase empezada y sin terminar; si no, la primera clase del programa.
  SELECT jsonb_build_object('item_id', it.id, 'title', it.title, 'module_id', it.parent_id, 'module_title', m.title, 'seconds', pp.last_position_seconds)
    INTO v_continue
    FROM app_servicio_portal.program_progress pp
    JOIN app_servicio.program_items it ON it.id = pp.program_item_id AND it.product_id = p_product_id AND it.kind = 'lesson' AND it.status = 'active'
    LEFT JOIN app_servicio.program_items m ON m.id = it.parent_id
   WHERE pp.contact_id = v_contact AND pp.viewed_at IS NOT NULL AND pp.completed_at IS NULL
   ORDER BY pp.updated_at DESC LIMIT 1;
  SELECT jsonb_build_object('item_id', it.id, 'title', it.title, 'module_id', it.parent_id, 'module_title', m.title)
    INTO v_first
    FROM app_servicio.program_items it LEFT JOIN app_servicio.program_items m ON m.id = it.parent_id
   WHERE it.product_id = p_product_id AND it.kind = 'lesson' AND it.status = 'active'
   ORDER BY m.position NULLS FIRST, it.position LIMIT 1;

  -- El certificado (el vigente primero).
  SELECT jsonb_build_object('code', d.code, 'valid', d.status <> 'void' AND d.voided_at IS NULL, 'issued_at', d.created_at)
    INTO v_cert
    FROM public.designs d JOIN public.design_templates t ON t.id = d.template_id AND t.doc_type = 'certificado'
   WHERE d.workspace_id = v_ws AND d.subject_ref ->> 'module' = 'service' AND d.subject_ref ->> 'id' = v_service::text
   ORDER BY (d.voided_at IS NULL) DESC, d.created_at DESC LIMIT 1;

  v_lessons := app_servicio.service_classroom(v_service);
  IF EXISTS (SELECT 1 FROM app_servicio.service_phases ph WHERE ph.service_id = v_service AND ph.challenge -> 'enabled' = 'true'::jsonb) THEN
    v_ch := app_servicio.svc_challenge_view(v_service);
  END IF;
  SELECT COALESCE(sum(points), 0)::integer INTO v_week FROM app_servicio_portal.points_ledger
   WHERE contact_id = v_contact AND product_id = p_product_id AND local_day > v_today - 7;
  SELECT r.n INTO v_place FROM (
    SELECT contact_id, row_number() OVER (ORDER BY sum(points) DESC) n FROM app_servicio_portal.points_ledger
     WHERE product_id = p_product_id AND local_day > v_today - 30 GROUP BY contact_id) r WHERE r.contact_id = v_contact;

  RETURN jsonb_build_object(
    'service_id', v_service, 'today', v_today, 'timezone', v_tz,
    'progress_pct', COALESCE(s.progress_pct, 0),
    'starts_on', s.starts_on, 'ends_on', s.ends_on, 'status', s.status,
    'phases', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', ph.name, 'status', ph.status, 'started_at', ph.started_at, 'completed_at', ph.completed_at,
                                                            'duration_days', ph.duration_days) ORDER BY ph.position)
                          FROM app_servicio.service_phases ph WHERE ph.service_id = v_service), '[]'::jsonb),
    'live', v_live,
    'pending', v_pending,
    'continue', v_continue,
    'first_lesson', v_first,
    'challenge', v_ch,
    'certificate', v_cert,
    'numbers', jsonb_build_object(
      'lessons_viewed', (SELECT count(*) FROM jsonb_array_elements(COALESCE(v_lessons -> 'items', '[]'::jsonb)) e WHERE e ->> 'kind' = 'lesson' AND (e ->> 'viewed_at') IS NOT NULL),
      'lessons_total', (SELECT count(*) FROM jsonb_array_elements(COALESCE(v_lessons -> 'items', '[]'::jsonb)) e WHERE e ->> 'kind' = 'lesson'),
      'activities_sent', (SELECT count(DISTINCT f.form_id) FROM public.form_submissions f
                           JOIN app_servicio.program_items it ON it.form_id = f.form_id AND it.product_id = p_product_id AND it.lesson_type = 'activity'
                           WHERE f.contact_id = v_contact),
      'activities_total', (SELECT count(*) FROM app_servicio.program_items it WHERE it.product_id = p_product_id AND it.lesson_type = 'activity' AND it.status = 'active')),
    'points', CASE WHEN (SELECT portal_settings #> '{points,enabled}' FROM public.products WHERE id = p_product_id) = 'true'::jsonb
                   THEN jsonb_build_object('week', v_week, 'place30', v_place) END);
END;
$$;

-- ─── Perfil ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_profile_get(p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  a app_servicio_portal.portal_accounts;
  c public.contacts;
BEGIN
  SELECT * INTO c FROM public.contacts WHERE id = (sess ->> 'contact_id')::uuid;
  SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE workspace_id = (sess ->> 'workspace_id')::uuid AND contact_id = c.id;
  RETURN jsonb_build_object(
    'name', COALESCE(a.display_name, c.display_name, ''), 'email', COALESCE(a.email, c.email), 'country', c.country,
    'timezone', COALESCE(NULLIF(a.timezone, ''), NULLIF(c.timezone, ''), app_servicio.ws_tz(c.workspace_id)),
    'avatar_path', a.avatar_path, 'theme', COALESCE(a.notification_prefs ->> 'theme', 'dark'),
    'hide_from_ranking', COALESCE((a.notification_prefs ->> 'hide_from_ranking')::boolean, false),
    'show_amount_in_fame', COALESCE(a.show_amount_in_fame, false),
    'has_password', a.password_hash IS NOT NULL,
    'notifications', app_servicio.portal_notification_prefs(a.notification_prefs),
    'sessions', (SELECT count(*) FROM app_servicio_portal.portal_sessions s WHERE s.account_id = a.id AND s.kind = 'student' AND s.revoked_at IS NULL AND s.expires_at > now()));
END;
$$;

-- Guarda solo lo que viene: name, timezone, theme (dark · light), hide_from_ranking, show_amount_in_fame. El email no.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_profile_save(p_session text, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  v_prefs jsonb;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN PERFORM app_servicio_portal.err('PO400', 'El cambio no es válido'); END IF;
  IF p_patch ? 'name' AND (jsonb_typeof(p_patch -> 'name') <> 'string' OR btrim(p_patch ->> 'name') = '' OR char_length(p_patch ->> 'name') > 80) THEN
    PERFORM app_servicio_portal.err('PO400', 'Escribí tu nombre (hasta 80 caracteres)');
  END IF;
  IF p_patch ? 'timezone' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_patch ->> 'timezone') THEN
    PERFORM app_servicio_portal.err('PO400', 'Elegí una zona horaria de la lista');
  END IF;
  IF p_patch ? 'theme' AND NOT COALESCE(p_patch ->> 'theme' IN ('dark', 'light'), false) THEN PERFORM app_servicio_portal.err('PO400', 'El tema no es válido'); END IF;
  IF (p_patch ? 'hide_from_ranking' AND jsonb_typeof(p_patch -> 'hide_from_ranking') <> 'boolean')
     OR (p_patch ? 'show_amount_in_fame' AND jsonb_typeof(p_patch -> 'show_amount_in_fame') <> 'boolean') THEN
    PERFORM app_servicio_portal.err('PO400', 'El cambio no es válido');
  END IF;
  SELECT COALESCE(notification_prefs, '{}'::jsonb) INTO v_prefs FROM app_servicio_portal.portal_accounts WHERE id = (sess ->> 'account_id')::uuid;
  IF p_patch ? 'theme' THEN v_prefs := v_prefs || jsonb_build_object('theme', p_patch ->> 'theme'); END IF;
  IF p_patch ? 'hide_from_ranking' THEN v_prefs := v_prefs || jsonb_build_object('hide_from_ranking', p_patch -> 'hide_from_ranking'); END IF;
  UPDATE app_servicio_portal.portal_accounts
     SET display_name = CASE WHEN p_patch ? 'name' THEN btrim(p_patch ->> 'name') ELSE display_name END,
         timezone = CASE WHEN p_patch ? 'timezone' THEN p_patch ->> 'timezone' ELSE timezone END,
         show_amount_in_fame = CASE WHEN p_patch ? 'show_amount_in_fame' THEN (p_patch ->> 'show_amount_in_fame')::boolean ELSE show_amount_in_fame END,
         notification_prefs = v_prefs, updated_at = now()
   WHERE id = (sess ->> 'account_id')::uuid;
  RETURN app_servicio_portal.portal_profile_get(p_session);
END;
$$;

-- ─── Certificado ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_certificate(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.program_for(sess, p_product_id, true);
  v jsonb;
BEGIN
  SELECT jsonb_build_object('code', d.code, 'status', CASE WHEN d.voided_at IS NOT NULL OR d.status = 'void' THEN 'void' WHEN d.status = 'ready' THEN 'valid' ELSE 'pending' END,
                            'issued_at', d.created_at, 'voided_at', d.voided_at, 'allow_download', COALESCE(d.allow_download, true), 'name', d.name)
    INTO v
    FROM public.designs d JOIN public.design_templates t ON t.id = d.template_id AND t.doc_type = 'certificado'
   WHERE d.workspace_id = (pf ->> 'workspace_id')::uuid AND d.subject_ref ->> 'module' = 'service' AND d.subject_ref ->> 'id' = pf ->> 'service_id'
   ORDER BY (d.voided_at IS NULL) DESC, d.created_at DESC LIMIT 1;
  RETURN COALESCE(v, jsonb_build_object('status', 'none'));
END;
$$;

REVOKE ALL ON FUNCTION app_servicio_portal.program_for(jsonb, uuid, boolean), app_servicio_portal.portal_home(text, uuid),
  app_servicio_portal.portal_journey(text, uuid), app_servicio_portal.portal_step_response(text, uuid),
  app_servicio_portal.portal_profile_get(text), app_servicio_portal.portal_profile_save(text, jsonb),
  app_servicio_portal.portal_certificate(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_home(text, uuid), app_servicio_portal.portal_journey(text, uuid),
  app_servicio_portal.portal_step_response(text, uuid), app_servicio_portal.portal_profile_get(text), app_servicio_portal.portal_profile_save(text, jsonb),
  app_servicio_portal.portal_certificate(text, uuid) TO portal_app, service_role;
