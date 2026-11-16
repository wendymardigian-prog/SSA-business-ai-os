-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00393_portal_community_info  (Portal de estudiantes, Corrida B2 · P08, la cabecera de la comunidad)
-- ============================================================================
-- 1. portal_community_info(session, product_id): lo que muestra la cabecera de la comunidad (F228):
--      members  cuántas personas tienen hoy acceso a la comunidad de ese programa;
--      online   cuántas de ellas usaron el portal en los últimos 5 minutos;
--      faces    hasta 5 nombres públicos («Ana P.») de las últimas que lo usaron;
--      levels   el nivel de cada persona con puntos, por `contact_ref` (la misma huella que trae post_row), sin quien
--               eligió no aparecer en el ranking. Vacío si el programa no tiene puntos.
--    Nunca un id ni un email.
-- 2. session_resolve: `last_seen_at` se anota cada 2 minutos de uso (antes, cada hora), para que «en línea» sea real.
--    Mismo cuerpo que la 00384 con ese único cambio; la definición vieja queda en docs/servicios/definiciones-viejas-a3.sql.
--
-- Volver atrás: DROP FUNCTION app_servicio_portal.portal_community_info(text, uuid) y la session_resolve de la 00384.
-- ============================================================================

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
    IF public.bump_rate_limit('portal-s:' || s.id::text, date_trunc('minute', now())) > 60 THEN
      PERFORM app_servicio_portal.err('PO429', 'Esperá unos minutos y volvé a probar');
    END IF;
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

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_community_info(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.require_section(sess, p_product_id, 'community');
  v_ws uuid := (pf ->> 'workspace_id')::uuid;
  v_settings jsonb;
  v_out jsonb;
BEGIN
  SELECT portal_settings -> 'points' INTO v_settings FROM public.products WHERE id = p_product_id;
  WITH m AS (
    SELECT DISTINCT a.contact_id FROM app_servicio_portal.portal_access a
     WHERE a.product_id = p_product_id AND a.section = 'community' AND a.revoked_at IS NULL
       AND app_servicio.portal_access_effective(a.contact_id, p_product_id, 'community') IS NOT NULL
  ), seen AS (
    SELECT acc.contact_id, max(s.last_seen_at) AS last_seen
      FROM app_servicio_portal.portal_sessions s
      JOIN app_servicio_portal.portal_accounts acc ON acc.id = s.account_id
     WHERE s.kind = 'student' AND s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at IS NOT NULL
       AND acc.workspace_id = v_ws AND acc.status <> 'suspended' AND acc.contact_id IN (SELECT contact_id FROM m)
     GROUP BY acc.contact_id
  )
  SELECT jsonb_build_object(
    'members', (SELECT count(*) FROM m),
    'online', (SELECT count(*) FROM seen WHERE seen.last_seen > now() - interval '5 minutes'),
    'faces', COALESCE((SELECT jsonb_agg(f.n ORDER BY f.last_seen DESC) FROM (
                SELECT app_servicio_portal.public_name(COALESCE(acc.display_name, c.display_name)) AS n, seen.last_seen
                  FROM seen JOIN public.contacts c ON c.id = seen.contact_id
                  LEFT JOIN app_servicio_portal.portal_accounts acc ON acc.contact_id = c.id AND acc.workspace_id = v_ws
                 ORDER BY seen.last_seen DESC LIMIT 5) f), '[]'::jsonb),
    'levels', CASE WHEN v_settings -> 'enabled' = 'true'::jsonb THEN COALESCE((
                SELECT jsonb_object_agg(md5(t.contact_id::text), (app_servicio.level_of(t.total, v_settings -> 'levels') ->> 'level')::integer)
                  FROM (SELECT l.contact_id, sum(l.points)::integer AS total FROM app_servicio_portal.points_ledger l
                         WHERE l.product_id = p_product_id GROUP BY l.contact_id) t
                  LEFT JOIN app_servicio_portal.portal_accounts acc ON acc.contact_id = t.contact_id AND acc.workspace_id = v_ws
                 WHERE COALESCE((acc.notification_prefs ->> 'hide_from_ranking')::boolean, false) IS NOT TRUE), '{}'::jsonb)
              ELSE '{}'::jsonb END)
  INTO v_out;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION app_servicio_portal.portal_community_info(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_community_info(text, uuid) TO portal_app, service_role;
