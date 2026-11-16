-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00390_portal_points_fame_notifications  (Portal de estudiantes, Corrida B2 · P14 (lectura), P09 (fama), P15)
-- ============================================================================
--   portal_points(session, product_id, period)     su nivel y puntos, el ranking del período (7d · 30d · all) SIN quien
--                                                  eligió no aparecer (ella sí se ve a sí misma), el desglose por grupo,
--                                                  cuánta gente hay en cada nivel, sus últimos puntos y la configuración
--                                                  del programa para «Cómo sumar» (F248). Totales calculados en la base.
--   portal_fame(session, product_id, period)       la Sala de la fama: por ahora solo «Mostrar mi monto» y los puntos; la
--                                                  facturación llega con la Corrida C (`revenue: null`).
--   portal_fame_visibility(session, show_amount)   mostrar el monto o solo la posición.
--   portal_notifications(session, product_id)      «Para hoy» y «Novedades» (portal_notifications_view, 00377).
--   portal_notification_seen(session)              marca las novedades como vistas.
--   portal_notification_prefs_get / _save          qué recibe por email (portal_save_notification_prefs, 00377).
--
-- La vista previa lee y no escribe (PO403). Aditiva.
--
-- Volver atrás: DROP FUNCTION de las 7 de arriba.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_points(p_session text, p_product_id uuid, p_period text DEFAULT '30d')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.program_for(sess, p_product_id, true);
  v_me uuid := (pf ->> 'contact_id')::uuid;
  v_settings jsonb;
  v_today date := (now() AT TIME ZONE app_servicio.points_tz(v_me, (pf ->> 'workspace_id')::uuid))::date;
  v_from date := CASE p_period WHEN '7d' THEN v_today - 6 WHEN 'all' THEN DATE '1900-01-01' ELSE v_today - 29 END;
  v_total integer;
BEGIN
  SELECT portal_settings -> 'points' INTO v_settings FROM public.products WHERE id = p_product_id;
  IF v_settings -> 'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN jsonb_build_object('enabled', false); END IF;
  SELECT COALESCE(sum(points), 0)::integer INTO v_total FROM app_servicio_portal.points_ledger WHERE contact_id = v_me AND product_id = p_product_id;
  RETURN jsonb_build_object(
    'enabled', true, 'period', p_period, 'total', v_total, 'level', app_servicio.level_of(v_total, v_settings -> 'levels'),
    'ranking_visible', COALESCE((v_settings #>> '{ranking,visible}')::boolean, true),
    'ranking', CASE WHEN COALESCE((v_settings #>> '{ranking,visible}')::boolean, true) THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', app_servicio_portal.public_name(COALESCE(a.display_name, c.display_name)), 'me', r.contact_id = v_me,
               'period', r.period_points, 'total', r.total, 'level', (app_servicio.level_of(r.total, v_settings -> 'levels') ->> 'level')::integer,
               'by_group', r.by_group) ORDER BY r.period_points DESC, r.total DESC)
        FROM (SELECT l.contact_id,
                     sum(l.points) FILTER (WHERE l.local_day >= v_from)::integer AS period_points,
                     sum(l.points)::integer AS total,
                     (SELECT jsonb_object_agg(g.point_group, g.n) FROM (SELECT point_group, sum(points)::integer n FROM app_servicio_portal.points_ledger
                       WHERE contact_id = l.contact_id AND product_id = p_product_id AND local_day >= v_from GROUP BY point_group) g) AS by_group
                FROM app_servicio_portal.points_ledger l WHERE l.product_id = p_product_id GROUP BY l.contact_id
               ORDER BY 2 DESC NULLS LAST LIMIT 50) r
        JOIN public.contacts c ON c.id = r.contact_id
        LEFT JOIN app_servicio_portal.portal_accounts a ON a.contact_id = r.contact_id AND a.workspace_id = c.workspace_id
       WHERE r.contact_id = v_me OR COALESCE((a.notification_prefs ->> 'hide_from_ranking')::boolean, false) IS NOT TRUE), '[]'::jsonb) END,
    'my_place', (SELECT x.n FROM (SELECT contact_id, row_number() OVER (ORDER BY sum(points) FILTER (WHERE local_day >= v_from) DESC NULLS LAST) n
                                    FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id GROUP BY contact_id) x WHERE x.contact_id = v_me),
    'levels_count', (SELECT COALESCE(jsonb_object_agg(lv, n), '{}'::jsonb) FROM (
                       SELECT (app_servicio.level_of(t.total, v_settings -> 'levels') ->> 'level') lv, count(*) n
                         FROM (SELECT sum(points)::integer total FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id GROUP BY contact_id) t GROUP BY 1) q),
    'my_groups', (SELECT COALESCE(jsonb_object_agg(point_group, n), '{}'::jsonb) FROM (SELECT point_group, sum(points)::integer n FROM app_servicio_portal.points_ledger
                    WHERE contact_id = v_me AND product_id = p_product_id AND local_day >= v_from GROUP BY point_group) g),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('points', l.points, 'group', l.point_group, 'kind', split_part(l.source_key, ':', 1), 'reason', l.reason, 'day', l.local_day) ORDER BY l.created_at DESC)
                           FROM (SELECT * FROM app_servicio_portal.points_ledger WHERE contact_id = v_me AND product_id = p_product_id ORDER BY created_at DESC LIMIT 20) l), '[]'::jsonb),
    'settings', jsonb_build_object('values', v_settings -> 'values', 'caps', v_settings -> 'caps'));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_fame(p_session text, p_product_id uuid, p_period text DEFAULT 'all')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.program_for(sess, p_product_id, true);
BEGIN
  RETURN jsonb_build_object(
    'show_amount', COALESCE((SELECT a.show_amount_in_fame FROM app_servicio_portal.portal_accounts a WHERE a.id = (sess ->> 'account_id')::uuid), false),
    'points_enabled', (SELECT portal_settings #> '{points,enabled}' = 'true'::jsonb FROM public.products WHERE id = p_product_id),
    'revenue', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_fame_visibility(p_session text, p_show_amount boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  UPDATE app_servicio_portal.portal_accounts SET show_amount_in_fame = COALESCE(p_show_amount, false), updated_at = now() WHERE id = (sess ->> 'account_id')::uuid;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_notifications(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.program_for(sess, p_product_id, true);
  a app_servicio_portal.portal_accounts;
BEGIN
  SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE workspace_id = (pf ->> 'workspace_id')::uuid AND contact_id = (pf ->> 'contact_id')::uuid;
  IF a.id IS NULL THEN RETURN jsonb_build_object('today_items', '[]'::jsonb, 'news', '[]'::jsonb, 'unseen', 0); END IF;
  RETURN app_servicio.portal_notifications_view(a.id, p_product_id) - 'prefs'
    || jsonb_build_object('timezone', app_servicio.points_tz(a.contact_id, a.workspace_id), 'now', now());
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_notification_seen(p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  PERFORM app_servicio.portal_mark_notifications_seen((sess ->> 'account_id')::uuid);
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_notification_prefs_get(p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
BEGIN
  RETURN app_servicio.portal_notification_prefs((SELECT a.notification_prefs FROM app_servicio_portal.portal_accounts a WHERE a.id = (sess ->> 'account_id')::uuid));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_notification_prefs_save(p_session text, p_prefs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  RETURN app_servicio.portal_save_notification_prefs((sess ->> 'account_id')::uuid, p_prefs);
EXCEPTION WHEN SQLSTATE 'SV038' THEN
  PERFORM app_servicio_portal.err('PO400', 'Esas preferencias no son válidas');
END;
$$;

REVOKE ALL ON FUNCTION app_servicio_portal.portal_points(text, uuid, text), app_servicio_portal.portal_fame(text, uuid, text),
  app_servicio_portal.portal_fame_visibility(text, boolean), app_servicio_portal.portal_notifications(text, uuid),
  app_servicio_portal.portal_notification_seen(text), app_servicio_portal.portal_notification_prefs_get(text),
  app_servicio_portal.portal_notification_prefs_save(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_points(text, uuid, text), app_servicio_portal.portal_fame(text, uuid, text),
  app_servicio_portal.portal_fame_visibility(text, boolean), app_servicio_portal.portal_notifications(text, uuid),
  app_servicio_portal.portal_notification_seen(text), app_servicio_portal.portal_notification_prefs_get(text),
  app_servicio_portal.portal_notification_prefs_save(text, jsonb) TO portal_app, service_role;
