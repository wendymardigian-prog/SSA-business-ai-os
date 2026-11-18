-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00403_portal_rate_limit_per_page  (Portal de estudiantes: el tope cuenta pantallas, no llamadas)
-- ============================================================================
-- El tope de 60 pedidos por minuto por sesión (§4.7) lo sumaba session_resolve en CADA función portal_*. Una
-- pantalla del portal hace entre 6 y 10 llamadas (portal_context, portal_notifications y portal_challenge siempre,
-- más las suyas; la Sala de la fama, 5 más), así que navegando ~7 pantallas por minuto un estudiante chocaba con PO429
-- (logs de Railway del 18/11: 13 pantallas en 45 s).
--
-- 1. session_resolve: deja de sumar el tope. Sigue validando todo lo demás igual (token, vencida, revocada, módulo
--    apagado PO401, suspendida PO402) y sigue renovando la sesión, anotando el uso y el día activo.
--    Mismo cuerpo que la 00393 sin las tres líneas del tope.
-- 2. portal_context: suma el tope (la misma clave `portal-s:<sesión>`, el mismo minuto, el mismo 60). El portal la
--    llama UNA vez por pantalla, así que «60 por minuto» pasa a ser 60 pantallas por minuto. Valida la sesión antes
--    (session_resolve sin tocarla): una sesión vencida o suspendida sigue dando PO401/PO402, no PO429. Mismo cuerpo
--    que la 00397 con ese cambio al principio (y sin la segunda lectura de la sesión, que ahora viene de arriba).
-- 3. portal_points: cada fila de `ranking` suma `week` (7 días) y `month` (30 días), y el resultado suma `my_places`
--    ({"7d", "30d", "all"}), para que el portal pueda pedir el ranking UNA vez en lugar de tres. Nada de lo que ya
--    devolvía cambia (solo se agregan claves). Ojo: `ranking` sigue siendo el top 50 del período pedido; con más de
--    50 personas en la comunidad, reordenar por `week` las filas de `all` no es el top de la semana.
--
-- No cambian: el tope por IP (vive en el servidor del portal), los topes de entrar (5 códigos por hora por email,
-- 5 intentos por código, 10 contraseñas por hora), ni los topes propios del Asistente, los proyectos y el análisis.
-- Las funciones portal_* que no son portal_context ya no tienen tope por sesión en la base: solo las llama el
-- servidor del portal (`portal_app_login`), que es el que tiene el tope por IP.
--
-- Aditiva: misma firma en las tres, CREATE OR REPLACE conserva los permisos. Puede ir antes o después del portal.
--
-- Volver atrás: volver a correr las definiciones de session_resolve (00393), portal_context (00397, «Envoltorios»)
-- y portal_points (00402, sección 5), tal cual están en esos archivos.
-- ============================================================================

-- ─── 1. session_resolve: sin el tope ────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.session_resolve(p_session text, p_touch boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio_portal.portal_sessions;
  a app_servicio_portal.portal_accounts;
  v_contact uuid;
  v_ttl interval;
BEGIN
  IF p_session IS NULL OR p_session !~ '^[0-9a-f]{64}$' THEN PERFORM app_servicio_portal.err('PO401', 'Tu sesión venció. Volvé a entrar'); END IF;
  SELECT * INTO s FROM app_servicio_portal.portal_sessions WHERE token_hash = app_servicio.portal_token_hash(p_session);
  IF s.id IS NULL OR s.revoked_at IS NOT NULL OR s.expires_at <= now() OR s.kind NOT IN ('student', 'preview') THEN
    PERFORM app_servicio_portal.err('PO401', 'Tu sesión venció. Volvé a entrar');
  END IF;
  IF NOT app_servicio.module_on(s.workspace_id) THEN PERFORM app_servicio_portal.err('PO401', 'Tu sesión venció. Volvé a entrar'); END IF;
  IF s.kind = 'student' THEN
    SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE id = s.account_id;
    IF a.id IS NULL THEN PERFORM app_servicio_portal.err('PO401', 'Tu sesión venció. Volvé a entrar'); END IF;
    IF a.status = 'suspended' THEN PERFORM app_servicio_portal.err('PO402', 'Tu cuenta está suspendida. Escribinos'); END IF;
    v_contact := a.contact_id;
  ELSE
    v_contact := s.preview_contact_id;
  END IF;
  IF p_touch THEN
    -- 00403: el tope de 60 por minuto ya no se suma acá (cada llamada); lo suma portal_context (cada pantalla).
    IF s.kind = 'student' THEN
      -- Se renueva sola si se usa en sus últimos 7 días (solo las largas, «Recordarme»).
      v_ttl := s.expires_at - s.created_at;
      IF v_ttl >= interval '7 days' AND s.expires_at - now() < interval '7 days' THEN
        UPDATE app_servicio_portal.portal_sessions SET expires_at = now() + v_ttl WHERE id = s.id;
        s.expires_at := now() + v_ttl;
      END IF;
      -- Cada 2 minutos de uso: alcanza para «en línea» (últimos 5 minutos) sin escribir en cada pedido.
      IF s.last_seen_at IS NULL OR s.last_seen_at < now() - interval '2 minutes' THEN
        UPDATE app_servicio_portal.portal_sessions SET last_seen_at = now() WHERE id = s.id;
      END IF;
      BEGIN
        PERFORM app_servicio.portal_touch_active_day(a.id);
      EXCEPTION WHEN OTHERS THEN
        PERFORM app_servicio.hook_failed(s.workspace_id, 'portal_active_day', SQLSTATE || ' ' || SQLERRM, NULL);
      END;
    END IF;
  END IF;
  RETURN jsonb_build_object('session_id', s.id, 'workspace_id', s.workspace_id, 'account_id', s.account_id, 'contact_id', v_contact,
                            'kind', s.kind, 'expires_at', s.expires_at);
END;
$$;

-- ─── 2. portal_context: el tope, una vez por pantalla ───────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_context(p_session text, p_host text, p_product_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  -- 00403: primero la sesión sin tocarla (PO401 y PO402 antes que el tope, como antes) y el tope por pantalla.
  sess jsonb := app_servicio_portal.session_resolve(p_session, false);
  r jsonb;
  pr record;
  v_extra jsonb := '[]'::jsonb;
  v_excl jsonb := '[]'::jsonb;
  v_st jsonb;
  k record;
  v_sections jsonb;
BEGIN
  IF public.bump_rate_limit('portal-s:' || (sess ->> 'session_id'), date_trunc('minute', now())) > 60 THEN
    PERFORM app_servicio_portal.err('PO429', 'Esperá unos minutos y volvé a probar');
  END IF;
  r := app_servicio_portal.ctx_context_base(p_session, p_host, p_product_id);
  IF r -> 'program' IS NULL OR jsonb_typeof(r -> 'program') <> 'object' THEN RETURN r; END IF;
  IF NOT app_servicio_proyectos.enabled((sess ->> 'workspace_id')::uuid) THEN RETURN r; END IF;
  SELECT * INTO pr FROM app_servicio_portal.ctx_programs((sess ->> 'workspace_id')::uuid, (sess ->> 'contact_id')::uuid) x
   WHERE x.product_id = (r #>> '{program,id}')::uuid LIMIT 1;
  IF pr.product_id IS NULL THEN RETURN r; END IF;
  FOR k IN SELECT * FROM (VALUES (1, 'proyectos', 'projects'), (2, 'fama', 'fame')) t(pos, key, section) ORDER BY pos LOOP
    v_st := app_servicio_portal.ctx_section((sess ->> 'contact_id')::uuid, pr.product_id, pr.variant_id, k.section, pr.starts_on);
    IF v_st IS NULL THEN
      v_excl := v_excl || to_jsonb(k.key);
    ELSE
      v_extra := v_extra || (jsonb_build_object('key', k.key) || v_st);
    END IF;
  END LOOP;
  -- Antes de «referidos» (o al final, antes de «perfil»).
  SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::jsonb) INTO v_sections FROM (
    SELECT e, (o * 10) AS o FROM jsonb_array_elements(COALESCE(r -> 'sections', '[]'::jsonb)) WITH ORDINALITY x(e, o)
    UNION ALL
    SELECT e, (COALESCE((SELECT o2 FROM jsonb_array_elements(COALESCE(r -> 'sections', '[]'::jsonb)) WITH ORDINALITY y(e2, o2)
                          WHERE e2 ->> 'key' IN ('referidos', 'asistente', 'perfil') ORDER BY o2 LIMIT 1), 1000) * 10 - 5 + oe) AS o
      FROM jsonb_array_elements(v_extra) WITH ORDINALITY z(e, oe)) q;
  RETURN jsonb_set(jsonb_set(r, '{sections}', v_sections), '{excluded}', COALESCE(r -> 'excluded', '[]'::jsonb) || v_excl);
END;
$$;

-- ─── 3. portal_points: semana y mes en cada fila del ranking ────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_points(p_session text, p_product_id uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.program_for(sess, p_product_id, true);
  v_me uuid := (pf ->> 'contact_id')::uuid;
  v_settings jsonb;
  v_today date := (now() AT TIME ZONE app_servicio.points_tz(v_me, (pf ->> 'workspace_id')::uuid))::date;
  v_from date := CASE p_period WHEN '7d' THEN v_today - 6 WHEN 'all' THEN DATE '1900-01-01' ELSE v_today - 29 END;
  v_total integer;
  v_comm text := app_servicio.contact_current_community(v_me, p_product_id);
  v_members uuid[];
BEGIN
  SELECT portal_settings -> 'points' INTO v_settings FROM public.products WHERE id = p_product_id;
  IF v_settings -> 'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN jsonb_build_object('enabled', false); END IF;
  SELECT COALESCE(sum(points), 0)::integer INTO v_total FROM app_servicio_portal.points_ledger WHERE contact_id = v_me AND product_id = p_product_id;
  SELECT COALESCE(array_agg(d.c), '{}'::uuid[]) INTO v_members
    FROM (SELECT DISTINCT contact_id AS c FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id) d
   WHERE app_servicio.community_member(d.c, p_product_id, v_comm);
  RETURN jsonb_build_object(
    'enabled', true, 'period', p_period, 'total', v_total, 'level', app_servicio.level_of(v_total, v_settings -> 'levels'),
    'ranking_visible', COALESCE((v_settings #>> '{ranking,visible}')::boolean, true),
    'ranking', CASE WHEN COALESCE((v_settings #>> '{ranking,visible}')::boolean, true) THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', app_servicio_portal.public_name(COALESCE(a.display_name, c.display_name)), 'me', r.contact_id = v_me,
               'period', r.period_points, 'total', r.total, 'level', (app_servicio.level_of(r.total, v_settings -> 'levels') ->> 'level')::integer,
               'by_group', r.by_group, 'week', r.week_points, 'month', r.month_points) ORDER BY r.period_points DESC, r.total DESC)
        FROM (SELECT l.contact_id,
                     sum(l.points) FILTER (WHERE l.local_day >= v_from)::integer AS period_points,
                     sum(l.points)::integer AS total,
                     COALESCE(sum(l.points) FILTER (WHERE l.local_day >= v_today - 6), 0)::integer AS week_points,
                     COALESCE(sum(l.points) FILTER (WHERE l.local_day >= v_today - 29), 0)::integer AS month_points,
                     (SELECT jsonb_object_agg(g.point_group, g.n) FROM (SELECT point_group, sum(points)::integer n FROM app_servicio_portal.points_ledger
                       WHERE contact_id = l.contact_id AND product_id = p_product_id AND local_day >= v_from GROUP BY point_group) g) AS by_group
                FROM app_servicio_portal.points_ledger l WHERE l.product_id = p_product_id AND l.contact_id = ANY (v_members) GROUP BY l.contact_id
               ORDER BY 2 DESC NULLS LAST LIMIT 50) r
        JOIN public.contacts c ON c.id = r.contact_id
        LEFT JOIN app_servicio_portal.portal_accounts a ON a.contact_id = r.contact_id AND a.workspace_id = c.workspace_id
       WHERE r.contact_id = v_me OR COALESCE((a.notification_prefs ->> 'hide_from_ranking')::boolean, false) IS NOT TRUE), '[]'::jsonb) END,
    'my_place', (SELECT x.n FROM (SELECT contact_id, row_number() OVER (ORDER BY sum(points) FILTER (WHERE local_day >= v_from) DESC NULLS LAST) n
                                    FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id AND contact_id = ANY (v_members) GROUP BY contact_id) x WHERE x.contact_id = v_me),
    'my_places', (SELECT jsonb_build_object('7d', max(x.n7) FILTER (WHERE x.contact_id = v_me), '30d', max(x.n30) FILTER (WHERE x.contact_id = v_me),
                                            'all', max(x.nall) FILTER (WHERE x.contact_id = v_me))
                    FROM (SELECT contact_id,
                                 row_number() OVER (ORDER BY sum(points) FILTER (WHERE local_day >= v_today - 6) DESC NULLS LAST) n7,
                                 row_number() OVER (ORDER BY sum(points) FILTER (WHERE local_day >= v_today - 29) DESC NULLS LAST) n30,
                                 row_number() OVER (ORDER BY sum(points) DESC NULLS LAST) nall
                            FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id AND contact_id = ANY (v_members) GROUP BY contact_id) x),
    'levels_count', (SELECT COALESCE(jsonb_object_agg(lv, n), '{}'::jsonb) FROM (
                       SELECT (app_servicio.level_of(t.total, v_settings -> 'levels') ->> 'level') lv, count(*) n
                         FROM (SELECT sum(points)::integer total FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id AND contact_id = ANY (v_members) GROUP BY contact_id) t GROUP BY 1) q),
    'my_groups', (SELECT COALESCE(jsonb_object_agg(point_group, n), '{}'::jsonb) FROM (SELECT point_group, sum(points)::integer n FROM app_servicio_portal.points_ledger
                    WHERE contact_id = v_me AND product_id = p_product_id AND local_day >= v_from GROUP BY point_group) g),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('points', l.points, 'group', l.point_group, 'kind', split_part(l.source_key, ':', 1), 'reason', l.reason, 'day', l.local_day) ORDER BY l.created_at DESC)
                           FROM (SELECT * FROM app_servicio_portal.points_ledger WHERE contact_id = v_me AND product_id = p_product_id ORDER BY created_at DESC LIMIT 20) l), '[]'::jsonb),
    'settings', jsonb_build_object('values', v_settings -> 'values', 'caps', v_settings -> 'caps'));
END;
$function$;
