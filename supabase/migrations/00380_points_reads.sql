-- @plantilla-quitar(servicios)
-- 00380 · Corrida A3 · F129 y F130: las LECTURAS de los puntos y del reto (solo lectura, condición de Wendy 14/11).
--
--   * `svc_points_daily(service, days)`: el gráfico «Actividad en el portal» de las fichas (F130.4). Una fila por día
--     (14, 30 o 90) en la zona del estudiante, con los puntos positivos por grupo, los ajustes negativos aparte y si
--     ese día entró al portal (`portal_accounts.active_days`, decisión 475). Arriba: total, nivel y última entrada.
--   * `svc_points_history(service, limit)`: el plegable «Historial de puntos» de la ficha del servicio.
--   * `points_ranking(product, limit)`: el ranking de la pestaña Puntos del programa.
--   * `svc_points_minibars(service_ids)`: la mini barra de 30 días de la tabla de Clientes.
--   * `svc_challenge_late_starts(workspace)`: el filtro «No empezó el Reto a tiempo» de Clientes (F127.6): una fase de
--     reto con fecha límite para empezar que todavía no empezó y ya se pasó, o que empezó después.
--
-- Ninguna escribe: todas son STABLE. Cada una mira el permiso de quien llama (las fichas: poder ver el servicio; el
-- ranking: `portal.points` o `portal.view`). Los servicios de prueba no tienen puntos (no suman en `award_points`).
--
-- Volver atrás:
--   DROP FUNCTION IF EXISTS app_servicio.svc_points_daily(uuid, integer), app_servicio.svc_points_history(uuid, integer),
--     app_servicio.points_ranking(uuid, integer), app_servicio.svc_points_minibars(uuid[]),
--     app_servicio.svc_challenge_late_starts(uuid);

-- ─── 1. El gráfico de una ficha ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_points_daily(p_service_id uuid, p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_days integer := CASE WHEN p_days IN (14, 30, 90) THEN p_days ELSE 30 END;
  v_tz text; v_today date; v_settings jsonb; v_total integer;
  v_active date[]; v_last_login timestamptz; v_rows jsonb;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT app_servicio.can_see_service_row(s) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF s.product_id IS NULL THEN RETURN NULL; END IF;
  v_tz := app_servicio.points_tz(s.contact_id, s.workspace_id);
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT portal_settings -> 'points' INTO v_settings FROM public.products WHERE id = s.product_id;
  SELECT COALESCE(sum(points), 0)::integer INTO v_total FROM app_servicio_portal.points_ledger
   WHERE contact_id = s.contact_id AND product_id = s.product_id;
  SELECT a.active_days, a.last_login_at INTO v_active, v_last_login FROM app_servicio_portal.portal_accounts a
   WHERE a.contact_id = s.contact_id AND a.workspace_id = s.workspace_id ORDER BY a.last_login_at DESC NULLS LAST LIMIT 1;
  v_active := COALESCE(v_active, '{}'::date[]);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', to_char(d.day, 'YYYY-MM-DD'),
           'active', d.day = ANY (v_active),
           'groups', COALESCE(g.groups, '{}'::jsonb),
           'negative', COALESCE(g.negative, 0)) ORDER BY d.day), '[]'::jsonb)
    INTO v_rows
    FROM generate_series(v_today - (v_days - 1), v_today, interval '1 day') AS d0(ts)
    CROSS JOIN LATERAL (SELECT d0.ts::date AS day) d
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(x.point_group, x.pts) FILTER (WHERE x.pts > 0) AS groups,
             COALESCE(sum(x.neg), 0)::integer AS negative
        FROM (SELECT l.point_group,
                     sum(l.points) FILTER (WHERE l.points > 0)::integer AS pts,
                     sum(l.points) FILTER (WHERE l.points < 0)::integer AS neg
                FROM app_servicio_portal.points_ledger l
               WHERE l.contact_id = s.contact_id AND l.product_id = s.product_id AND l.local_day = d.day
               GROUP BY l.point_group) x
    ) g ON true;

  RETURN jsonb_build_object(
    'enabled', COALESCE(v_settings -> 'enabled' = 'true'::jsonb, false),
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'timezone', v_tz,
    'days_n', v_days,
    'total', v_total,
    'level', app_servicio.level_of(v_total, v_settings -> 'levels'),
    'last_active', (SELECT to_char(max(x), 'YYYY-MM-DD') FROM unnest(v_active) x),
    'last_login_at', v_last_login,
    'days', v_rows);
END;
$$;

-- ─── 2. El historial de una ficha ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_points_history(p_service_id uuid, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT app_servicio.can_see_service_row(s) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF s.product_id IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', l.id, 'at', l.created_at, 'day', to_char(l.local_day, 'YYYY-MM-DD'), 'group', l.point_group,
             'points', l.points, 'reason', l.reason, 'kind', split_part(l.source_key, ':', 1), 'by', l.created_by)
           ORDER BY l.created_at DESC, l.id)
      FROM (SELECT * FROM app_servicio_portal.points_ledger
             WHERE contact_id = s.contact_id AND product_id = s.product_id
             ORDER BY created_at DESC, id LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)) l), '[]'::jsonb);
END;
$$;

-- ─── 3. El ranking del programa ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.points_ranking(p_product_id uuid, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid; v_settings jsonb;
BEGIN
  SELECT workspace_id, portal_settings -> 'points' INTO v_ws, v_settings FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(v_ws, 'portal.points') OR public.has_permission(v_ws, 'portal.view')) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN jsonb_build_object(
    'students', (SELECT count(DISTINCT contact_id) FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'contact_id', r.contact_id, 'name', COALESCE(c.display_name, c.email, 'Sin nombre'), 'total', r.total,
               'level', app_servicio.level_of(r.total, v_settings -> 'levels'),
               'service_id', (SELECT sv.id FROM app_servicio.services sv
                               WHERE sv.contact_id = r.contact_id AND sv.product_id = p_product_id AND NOT sv.is_test
                               ORDER BY (sv.status IN ('active', 'paused')) DESC, sv.created_at DESC LIMIT 1))
             ORDER BY r.total DESC, c.display_name)
        FROM (SELECT contact_id, sum(points)::integer AS total FROM app_servicio_portal.points_ledger
               WHERE product_id = p_product_id GROUP BY contact_id
               ORDER BY 2 DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) r
        JOIN public.contacts c ON c.id = r.contact_id), '[]'::jsonb));
END;
$$;

-- ─── 4. Las mini barras de Clientes ──────────────────────────────────────────
-- Solo los servicios que quien llama puede ver; un servicio sin producto, o de prueba, no aparece.
CREATE OR REPLACE FUNCTION app_servicio.svc_points_minibars(p_service_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_service_ids IS NULL OR cardinality(p_service_ids) = 0 THEN RETURN '{}'::jsonb; END IF;
  IF cardinality(p_service_ids) > 500 THEN RAISE EXCEPTION 'Demasiados servicios' USING ERRCODE = 'SV001'; END IF;
  RETURN COALESCE((
    SELECT jsonb_object_agg(s.id, jsonb_build_object(
             'total', (SELECT COALESCE(sum(points), 0)::integer FROM app_servicio_portal.points_ledger
                        WHERE contact_id = s.contact_id AND product_id = s.product_id),
             'bars', (SELECT jsonb_agg(COALESCE((SELECT sum(l.points) FILTER (WHERE l.points > 0)
                                                   FROM app_servicio_portal.points_ledger l
                                                  WHERE l.contact_id = s.contact_id AND l.product_id = s.product_id AND l.local_day = d.day), 0)::integer
                                       ORDER BY d.day)
                        FROM (SELECT (t.today - k) AS day FROM generate_series(0, 29) k) d)))
      FROM app_servicio.services s
      CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE app_servicio.points_tz(s.contact_id, s.workspace_id))::date AS today) t
     WHERE s.id = ANY (p_service_ids) AND s.product_id IS NOT NULL AND NOT s.is_test
       AND (app_servicio.is_system() OR app_servicio.can_see_service_row(s))), '{}'::jsonb);
END;
$$;

-- ─── 5. «No empezó el Reto a tiempo» ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_challenge_late_starts(p_workspace_id uuid)
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT app_servicio.is_system() AND NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN QUERY
    SELECT DISTINCT s.id
      FROM app_servicio.services s
      JOIN app_servicio.service_phases ph ON ph.service_id = s.id
      CROSS JOIN LATERAL (SELECT app_servicio.svc_challenge_start_by(ph.challenge -> 'start_by', s.starts_on,
                                   app_servicio.local_date(s.created_at, s.workspace_id)) AS by) b
     WHERE s.workspace_id = p_workspace_id AND s.status IN ('active', 'paused') AND NOT s.is_test
       AND jsonb_typeof(ph.challenge -> 'start_by') = 'object' AND b.by IS NOT NULL
       AND ((ph.status = 'pending' AND ph.awaiting_start AND b.by < app_servicio.today_in(s.workspace_id))
         OR (ph.started_at IS NOT NULL AND app_servicio.local_date(ph.started_at, s.workspace_id) > b.by))
       AND (app_servicio.is_system() OR app_servicio.can_see_service_row(s));
END;
$$;

-- ─── Permisos ────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION app_servicio.svc_points_daily(uuid, integer), app_servicio.svc_points_history(uuid, integer),
  app_servicio.points_ranking(uuid, integer), app_servicio.svc_points_minibars(uuid[]),
  app_servicio.svc_challenge_late_starts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.svc_points_daily(uuid, integer), app_servicio.svc_points_history(uuid, integer),
  app_servicio.points_ranking(uuid, integer), app_servicio.svc_points_minibars(uuid[]),
  app_servicio.svc_challenge_late_starts(uuid) TO authenticated, service_role;
