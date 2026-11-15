-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00388_portal_calendar_challenge_referrals  (Portal de estudiantes, Corrida B2 · P06 + P07)
-- ============================================================================
-- P06 · Calendario (F223 a F225):
--   portal_calendar(session, product_id, from, to)   las fechas de SU variante (sin el link de la reunión), con su
--                                                     asistencia, si hay grabación activa y si «Estoy acá» está abierto.
--   portal_live_enter(session, session_id, date)      registra el clic (y la asistencia, si la sesión lo cuenta) y
--                                                     devuelve la URL de la reunión SOLO para redirigir.
--   portal_attendance_mark(session, session_id, date, keyword)   «Estoy acá» dentro de la ventana (10 min antes a
--                                                     30 después), con la palabra clave si la sesión la pide.
--   portal_recording_url(session, session_id, date)   la grabación, si está activa en el portal.
-- P07 · Reto y referidos (F226, F227), sobre lo de A3 (00376):
--   portal_challenge(session, product_id)             la fase Reto (svc_challenge_view), el formulario del reporte y
--                                                     cada día con su estado y si se puede cargar (`svc_late_plan`).
--   portal_challenge_start(session, product_id, accepted)   acepta las reglas y empieza (svc_start_challenge_accepting).
--   portal_challenge_report_submit(session, item_id, answers)   el reporte de ese día: rechaza el futuro (SV035) y lo
--                                                     vencido fuera de la gracia (SV036); completa el día.
--   portal_referrals(session, product_id)             su código, los links que el programa muestra, sus referidos
--                                                     (nombre, tipo, vencimiento, si compró) y sus comisiones.
--
-- La vista previa no escribe (PO403). Aditiva.
--
-- Volver atrás: DROP FUNCTION de las 8 funciones de arriba y de app_servicio_portal.live_for(jsonb, uuid, date).
-- ============================================================================

-- Una fecha de una sesión en vivo de la variante de la persona (o error). Devuelve la sesión, la fecha y la ventana.
CREATE OR REPLACE FUNCTION app_servicio_portal.live_for(p_sess jsonb, p_session_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ls app_servicio.live_sessions;
  pf jsonb;
  o record;
BEGIN
  SELECT * INTO ls FROM app_servicio.live_sessions WHERE id = p_session_id AND archived_at IS NULL;
  IF ls.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Esta clase no existe'); END IF;
  pf := app_servicio_portal.require_section(p_sess, ls.product_id, 'calendar');
  IF ls.variant_ids IS NOT NULL AND cardinality(ls.variant_ids) > 0 AND NOT ((pf ->> 'variant_id')::uuid = ANY (ls.variant_ids)) THEN
    PERFORM app_servicio_portal.err('PO404', 'Esta clase no existe');
  END IF;
  SELECT * INTO o FROM app_servicio.live_session_occurrences(ls.product_id, p_date, p_date) x WHERE x.live_session_id = ls.id AND x.occurs_on = p_date;
  IF o.live_session_id IS NULL OR o.status = 'cancelled' THEN PERFORM app_servicio_portal.err('PO404', 'Esa fecha no tiene clase'); END IF;
  RETURN jsonb_build_object('session_id', ls.id, 'product_id', ls.product_id, 'title', ls.title, 'occurs_on', p_date, 'starts_at', o.starts_at, 'ends_at', o.ends_at,
    'meeting_url', ls.meeting_url, 'keyword', ls.keyword, 'click_counts', ls.click_counts_as_attendance, 'workspace_id', ls.workspace_id,
    'contact_id', pf ->> 'contact_id', 'in_window', app_servicio.live_attendance_window(o.starts_at, o.ends_at, now()));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_calendar(p_session text, p_product_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.require_section(sess, p_product_id, 'calendar');
  v_contact uuid := (pf ->> 'contact_id')::uuid;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 120 THEN PERFORM app_servicio_portal.err('PO400', 'El rango de fechas no es válido'); END IF;
  RETURN jsonb_build_object(
    'timezone', app_servicio.points_tz(v_contact, (pf ->> 'workspace_id')::uuid),
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'session_id', o.live_session_id, 'title', ls.title, 'kind', ls.kind, 'occurs_on', o.occurs_on, 'starts_at', o.starts_at, 'ends_at', o.ends_at,
               'status', o.status, 'keyword_required', NULLIF(ls.keyword, '') IS NOT NULL,
               'can_enter', o.ends_at > now() - interval '30 minutes' AND o.starts_at < now() + interval '10 minutes' AND NULLIF(ls.meeting_url, '') IS NOT NULL,
               'can_mark', app_servicio.live_attendance_window(o.starts_at, o.ends_at, now()),
               'attended', EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance a WHERE a.live_session_id = ls.id AND a.occurs_on = o.occurs_on
                                    AND a.contact_id = v_contact AND a.removed_at IS NULL),
               'recording', EXISTS (SELECT 1 FROM app_servicio.live_session_dates d WHERE d.live_session_id = ls.id AND d.occurs_on = o.occurs_on
                                     AND d.recording_active AND (NULLIF(d.recording_url, '') IS NOT NULL OR d.recording_call_id IS NOT NULL)))
             ORDER BY o.starts_at)
        FROM app_servicio.live_session_occurrences(p_product_id, p_from, p_to) o
        JOIN app_servicio.live_sessions ls ON ls.id = o.live_session_id
       WHERE ls.archived_at IS NULL
         AND (ls.variant_ids IS NULL OR cardinality(ls.variant_ids) = 0 OR (pf ->> 'variant_id')::uuid = ANY (ls.variant_ids))), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_live_enter(p_session text, p_session_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  x jsonb := app_servicio_portal.live_for(sess, p_session_id, p_date);
BEGIN
  IF NULLIF(x ->> 'meeting_url', '') IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Todavía no hay link para entrar'); END IF;
  IF (x ->> 'ends_at')::timestamptz < now() - interval '30 minutes' THEN PERFORM app_servicio_portal.err('PO410', 'Esta clase ya terminó'); END IF;
  IF sess ->> 'kind' = 'student' THEN
    INSERT INTO app_servicio.link_clicks (workspace_id, target_type, target_id, target_date, contact_id, portal_account_id, clicked_at, user_agent_kind, is_bot)
    VALUES ((x ->> 'workspace_id')::uuid, 'live_session', p_session_id, p_date, (x ->> 'contact_id')::uuid, (sess ->> 'account_id')::uuid, now(), 'portal', false);
    IF (x ->> 'click_counts')::boolean AND (x ->> 'in_window')::boolean
       AND NOT EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance a WHERE a.live_session_id = p_session_id AND a.occurs_on = p_date AND a.contact_id = (x ->> 'contact_id')::uuid AND a.removed_at IS NULL) THEN
      INSERT INTO app_servicio_portal.live_attendance (workspace_id, live_session_id, occurs_on, contact_id, source, marked_at)
      VALUES ((x ->> 'workspace_id')::uuid, p_session_id, p_date, (x ->> 'contact_id')::uuid, 'click', now());
    END IF;
  END IF;
  RETURN jsonb_build_object('url', x ->> 'meeting_url');
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_attendance_mark(p_session text, p_session_id uuid, p_date date, p_keyword text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  x jsonb := app_servicio_portal.live_for(sess, p_session_id, p_date);
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  IF NOT (x ->> 'in_window')::boolean THEN PERFORM app_servicio_portal.err('PO409', '«Estoy acá» se marca durante la clase'); END IF;
  IF NULLIF(x ->> 'keyword', '') IS NOT NULL AND lower(btrim(COALESCE(p_keyword, ''))) <> lower(btrim(x ->> 'keyword')) THEN
    PERFORM app_servicio_portal.err('PO400', 'La palabra clave no es esa');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-att:' || (x ->> 'contact_id') || ':' || p_session_id::text || ':' || p_date::text, 0));
  IF NOT EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance a WHERE a.live_session_id = p_session_id AND a.occurs_on = p_date AND a.contact_id = (x ->> 'contact_id')::uuid AND a.removed_at IS NULL) THEN
    INSERT INTO app_servicio_portal.live_attendance (workspace_id, live_session_id, occurs_on, contact_id, source, marked_at)
    VALUES ((x ->> 'workspace_id')::uuid, p_session_id, p_date, (x ->> 'contact_id')::uuid, 'self', now());
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_recording_url(p_session text, p_session_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  x jsonb := app_servicio_portal.live_for(sess, p_session_id, p_date);
  d app_servicio.live_session_dates;
BEGIN
  SELECT * INTO d FROM app_servicio.live_session_dates WHERE live_session_id = p_session_id AND occurs_on = p_date;
  IF d.id IS NULL OR NOT d.recording_active THEN PERFORM app_servicio_portal.err('PO404', 'Esta clase todavía no tiene grabación'); END IF;
  RETURN jsonb_build_object('title', x ->> 'title',
    'url', COALESCE(NULLIF(d.recording_url, ''), (SELECT c.share_url FROM public.calls c WHERE c.id = d.recording_call_id)),
    'fathom', d.recording_source = 'fathom' AND NULLIF(d.recording_url, '') IS NULL);
END;
$$;

-- ─── Reto ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_challenge(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.require_section(sess, p_product_id, 'challenge');
  v_service uuid := (pf ->> 'service_id')::uuid;
  v jsonb := app_servicio.svc_challenge_view(v_service);
  ph app_servicio.service_phases;
  v_form uuid;
  v_today date := app_servicio.today_in((pf ->> 'workspace_id')::uuid);
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = (v ->> 'phase_id')::uuid;
  SELECT NULLIF(t.ref ->> 'form_id', '')::uuid INTO v_form FROM app_servicio.service_items t
   WHERE t.phase_id = ph.id AND t.is_recurring_template AND t.kind IN ('form', 'survey') ORDER BY t.position LIMIT 1;
  RETURN v - 'accepted' || jsonb_build_object(
    'rules', ph.challenge -> 'acceptance',
    'accepted', ph.challenge -> 'accepted' IS NOT NULL AND ph.challenge -> 'accepted' <> 'null'::jsonb,
    'can_start', ph.status = 'pending' AND ph.awaiting_start AND COALESCE(ph.challenge ->> 'start', '') = 'student',
    'today', v_today,
    'report_fields', CASE WHEN v_form IS NOT NULL THEN app_servicio_portal.public_fields(
        (SELECT fv.definition FROM public.forms f JOIN public.form_versions fv ON fv.id = f.current_version_id WHERE f.id = v_form)) END,
    'days', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name, 'due_on', i.due_on, 'status', i.status, 'index', i.occurrence_index,
               'can_submit', i.status = 'pending' AND COALESCE((app_servicio.svc_late_plan(i.late, i.due_on, i.due_on, (now() AT TIME ZONE app_servicio.ws_tz(i.workspace_id))) ->> 'ok')::boolean, true),
               'why_not', CASE WHEN i.status = 'pending' THEN app_servicio.svc_late_plan(i.late, i.due_on, i.due_on, (now() AT TIME ZONE app_servicio.ws_tz(i.workspace_id))) ->> 'message' END)
             ORDER BY i.due_on, i.occurrence_index)
        FROM app_servicio.service_items i
       WHERE i.phase_id = ph.id AND i.parent_item_id IS NOT NULL AND i.visible_to_client), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_challenge_start(p_session text, p_product_id uuid, p_accepted integer[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  pf := app_servicio_portal.require_section(sess, p_product_id, 'challenge');
  PERFORM app_servicio.svc_start_challenge_accepting((pf ->> 'service_id')::uuid, COALESCE(p_accepted, ARRAY[]::integer[]), (pf ->> 'contact_id')::uuid);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- El reporte de un día: la respuesta queda unida a ese día y el paso se completa (con su regla de atraso).
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_challenge_report_submit(p_session text, p_item_id uuid, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  i app_servicio.service_items;
  t app_servicio.service_items;
  s app_servicio.services;
  f public.forms;
  d jsonb;
  lp jsonb;
  pf jsonb;
  v_new uuid;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  SELECT * INTO i FROM app_servicio.service_items WHERE id = p_item_id AND parent_item_id IS NOT NULL;
  SELECT * INTO s FROM app_servicio.services WHERE id = i.service_id;
  IF i.id IS NULL OR s.contact_id IS DISTINCT FROM (sess ->> 'contact_id')::uuid OR NOT i.visible_to_client THEN PERFORM app_servicio_portal.err('PO404', 'Este día no existe'); END IF;
  pf := app_servicio_portal.require_section(sess, s.product_id, 'challenge');
  IF i.status = 'completed' THEN PERFORM app_servicio_portal.err('PO409', 'Este día ya está cargado'); END IF;
  lp := app_servicio.svc_late_plan(i.late, i.due_on, i.due_on, (now() AT TIME ZONE app_servicio.ws_tz(i.workspace_id)));
  IF NOT COALESCE((lp ->> 'ok')::boolean, true) THEN PERFORM app_servicio_portal.err(COALESCE(lp ->> 'code', 'SV036'), COALESCE(lp ->> 'message', 'Ya pasó el plazo')); END IF;
  SELECT * INTO t FROM app_servicio.service_items WHERE id = i.parent_item_id;
  SELECT * INTO f FROM public.forms WHERE id = NULLIF(COALESCE(i.ref ->> 'form_id', t.ref ->> 'form_id'), '')::uuid;
  IF f.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'El reporte todavía no está listo'); END IF;
  SELECT definition INTO d FROM public.form_versions WHERE id = f.current_version_id;
  v_new := app_servicio_portal.portal_submit(sess, jsonb_build_object('workspace_id', s.workspace_id, 'form_id', f.id, 'version_id', f.current_version_id,
            'contact_id', s.contact_id, 'item_id', NULL, 'definition', d), p_answers);
  UPDATE public.form_submissions SET service_item_id = i.id, service_id = s.id WHERE id = v_new;
  PERFORM app_servicio.svc_mark_item(i.id, 'portal', 'client', NULL);
  RETURN jsonb_build_object('ok', true, 'late', COALESCE((lp ->> 'late')::boolean, false));
END;
$$;

-- ─── Mis referidos ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_referrals(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.require_section(sess, p_product_id, 'affiliates');
  v_contact uuid := (pf ->> 'contact_id')::uuid;
  v_ws uuid := (pf ->> 'workspace_id')::uuid;
  v_code text;
  v_keys jsonb;
BEGIN
  SELECT affiliate_code INTO v_code FROM public.contacts WHERE id = v_contact;
  IF v_code IS NULL AND sess ->> 'kind' = 'student' THEN v_code := public.affiliate_ensure_code(v_ws, 'contact', v_contact); END IF;
  SELECT COALESCE(portal_settings #> '{affiliates,visible_link_keys}', '[]'::jsonb) INTO v_keys FROM public.products WHERE id = p_product_id;
  RETURN jsonb_build_object(
    'code', v_code,
    'links', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', l ->> 'key', 'name', l ->> 'name', 'primary', l ->> 'primary', 'product', p.name) ORDER BY (l ->> 'primary') NULLS LAST, l ->> 'name')
                         FROM public.products p, jsonb_array_elements(COALESCE(p.links -> 'items', '[]'::jsonb)) l
                        WHERE p.id = p_product_id AND COALESCE((l ->> 'active')::boolean, true) AND v_keys ? (l ->> 'key')), '[]'::jsonb),
    'contacts', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', COALESCE(NULLIF(split_part(c.display_name, ' ', 1), ''), 'Sin nombre'),
                            'kind', c.affiliate_kind, 'since', c.affiliate_assigned_at, 'expires_at', c.affiliate_expires_at,
                            'bought', EXISTS (SELECT 1 FROM public.sales s WHERE s.affiliate_contact_id = v_contact AND s.contact_id = c.id AND s.status NOT IN ('cancelled', 'refunded', 'disputed')))
                            ORDER BY c.affiliate_assigned_at DESC NULLS LAST)
                          FROM public.contacts c WHERE c.workspace_id = v_ws AND c.affiliate_contact_id = v_contact AND c.deleted_at IS NULL), '[]'::jsonb),
    'commissions', jsonb_build_object(
      'total', COALESCE((SELECT sum(amount) FROM public.commissions WHERE contact_id = v_contact AND workspace_id = v_ws AND voided_at IS NULL), 0),
      'paid', COALESCE((SELECT sum(amount) FROM public.commissions WHERE contact_id = v_contact AND workspace_id = v_ws AND voided_at IS NULL AND paid_on IS NOT NULL), 0),
      'currency', (SELECT currency FROM public.commissions WHERE contact_id = v_contact AND workspace_id = v_ws LIMIT 1)));
END;
$$;

REVOKE ALL ON FUNCTION app_servicio_portal.live_for(jsonb, uuid, date), app_servicio_portal.portal_calendar(text, uuid, date, date),
  app_servicio_portal.portal_live_enter(text, uuid, date), app_servicio_portal.portal_attendance_mark(text, uuid, date, text),
  app_servicio_portal.portal_recording_url(text, uuid, date), app_servicio_portal.portal_challenge(text, uuid),
  app_servicio_portal.portal_challenge_start(text, uuid, integer[]), app_servicio_portal.portal_challenge_report_submit(text, uuid, jsonb),
  app_servicio_portal.portal_referrals(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_calendar(text, uuid, date, date), app_servicio_portal.portal_live_enter(text, uuid, date),
  app_servicio_portal.portal_attendance_mark(text, uuid, date, text), app_servicio_portal.portal_recording_url(text, uuid, date),
  app_servicio_portal.portal_challenge(text, uuid), app_servicio_portal.portal_challenge_start(text, uuid, integer[]),
  app_servicio_portal.portal_challenge_report_submit(text, uuid, jsonb), app_servicio_portal.portal_referrals(text, uuid)
TO portal_app, service_role;
