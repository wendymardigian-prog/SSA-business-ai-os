-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00500_security_portal_invite_recordings_password  (Auditoría de seguridad del 19/11/2026, parte 1)
-- ============================================================================
-- Tres arreglos del módulo de Servicios / portal. Todos copiados de `pg_get_functiondef` de producción el
-- 19/11/2026 (idénticos a sus migraciones de origen).
--
-- 1. La invitación al portal ya no le da el token al navegador del equipo.
--    `app_servicio.portal_admin_invite` (00341) devolvía el token de la invitación a quien la llamara con su
--    sesión. Un miembro con `portal.accounts` podía pedirla por la API, quedarse con el link sin que saliera el
--    email y entrar al portal COMO el estudiante (y fijarle una contraseña). Ahora:
--      - `portal_admin_invite` deja de estar habilitada para `authenticated` (queda solo para el servidor);
--      - la app chequea el permiso y el alcance con la sesión y llama a `portal_admin_invite_issue` (nueva, solo
--        `service_role`), que hace lo mismo que la vieja y anota en el historial a la persona que invitó.
--    El token sigue viajando una sola vez: de la base al email.
--
-- 2. `app_servicio.program_live_recordings` (00346) no miraba permisos y estaba habilitada para `authenticated`:
--    cualquier usuario logueado, de cualquier negocio, sacaba los links de grabación de un programa ajeno con el
--    id del producto. Ningún código la usa con la sesión: queda solo para `service_role`.
--
-- 3. `app_servicio_portal.portal_login_password` (00384): una contraseña equivocada terminaba en RAISE, que
--    deshacía también el `bump_rate_limit` del intento. El tope de 10 por hora nunca se alcanzaba. Ahora un intento
--    fallido se DEVUELVE (`{ok:false, code:'PO401', message}`), igual que `portal_login_verify`, y queda contado.
--    El portal ya entiende esa forma (`passwordLogin` mira `r.ok` y `r.message`). El mensaje es el mismo exista o
--    no la cuenta.
--
-- Aditiva en datos (no toca filas). Puede ir antes o después del deploy, pero la app que invita al portal llama a
-- `portal_admin_invite_issue`: aplicar ANTES de desplegar el código, o invitar falla hasta aplicarla.
--
-- Volver atrás:
--   GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_invite(uuid, uuid) TO authenticated;
--   GRANT EXECUTE ON FUNCTION app_servicio.program_live_recordings(uuid) TO authenticated;
--   y la definición vieja de portal_login_password (00384, líneas 205-229), copiada abajo en el comentario final.
-- ============================================================================

-- ─── 1. Invitación al portal ────────────────────────────────────────────────
REVOKE ALL ON FUNCTION app_servicio.portal_admin_invite(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_invite(uuid, uuid) TO service_role;

-- Igual que portal_admin_invite (00341) sin el chequeo de permiso (lo hace la app con la sesión antes de llamar)
-- y con quien invitó en el historial.
CREATE OR REPLACE FUNCTION app_servicio.portal_admin_invite_issue(p_workspace_id uuid, p_contact_id uuid, p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  acc record;
  v_id uuid;
  v_token text;
  v_today date;
  v_count integer;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p_workspace_id AND m.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'No existe el contacto' USING ERRCODE = 'AC003';
  END IF;
  v_id := app_servicio.svc_ensure_portal_account(p_workspace_id, p_contact_id);
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('status', CASE WHEN EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND NULLIF(btrim(c.email), '') IS NOT NULL)
                                              THEN 'email_conflict' ELSE 'no_email' END);
  END IF;
  SELECT * INTO acc FROM app_servicio_portal.portal_accounts WHERE id = v_id FOR UPDATE;
  IF acc.status = 'suspended' THEN RETURN jsonb_build_object('status', 'suspended'); END IF;
  v_today := app_servicio.today_in(p_workspace_id);
  IF acc.invite_sent_at IS NOT NULL AND acc.invite_sent_at > now() - interval '1 minute' THEN
    RETURN jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', GREATEST(1, ceil(extract(epoch FROM acc.invite_sent_at + interval '1 minute' - now()))::integer));
  END IF;
  v_count := CASE WHEN acc.invite_sent_at IS NOT NULL AND app_servicio.local_date(acc.invite_sent_at, p_workspace_id) = v_today THEN acc.invite_sent_count_day ELSE 0 END;
  IF v_count >= 5 THEN RETURN jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', 86400); END IF;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE app_servicio_portal.portal_accounts
     SET invite_token_hash = app_servicio.portal_token_hash(v_token), invite_expires_at = now() + interval '7 days',
         invite_sent_at = now(), invite_sent_count_day = v_count + 1, updated_at = now()
   WHERE id = v_id;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (p_workspace_id, 'contact', p_contact_id, 'portal.invited', jsonb_build_object('account_id', v_id, 'count_today', v_count + 1), p_actor_user_id, 'user');
  RETURN jsonb_build_object('status', 'ok', 'token', v_token, 'account_id', v_id, 'email', acc.email, 'expires_at', now() + interval '7 days');
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.portal_admin_invite_issue(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.portal_admin_invite_issue(uuid, uuid, uuid) TO service_role;

-- ─── 2. Grabaciones de las clases en vivo ───────────────────────────────────
REVOKE ALL ON FUNCTION app_servicio.program_live_recordings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.program_live_recordings(uuid) TO service_role;

-- ─── 3. Entrar al portal con contraseña: el intento fallido cuenta ──────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_login_password(p_host text, p_email text, p_password text, p_remember boolean, p_ua_hash text, p_ip_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid := app_servicio_portal.ws_by_host(p_host);
  v_email text := lower(btrim(COALESCE(p_email, '')));
  a app_servicio_portal.portal_accounts;
  v_ttl interval := CASE WHEN p_remember IS NOT FALSE THEN interval '30 days' ELSE interval '12 hours' END;
BEGIN
  IF v_ws IS NULL OR NOT app_servicio.module_on(v_ws) THEN PERFORM app_servicio_portal.err('PO401', 'El email o la contraseña no son correctos'); END IF;
  IF (SELECT portal_settings #> '{login,password_allowed}' FROM public.workspaces WHERE id = v_ws) IS DISTINCT FROM 'true'::jsonb THEN
    PERFORM app_servicio_portal.err('PO401', 'Entrá con el código que te mandamos por email');
  END IF;
  IF public.bump_rate_limit('portal-pw:' || v_ws::text || ':' || v_email, date_trunc('hour', now())) > 10 THEN
    PERFORM app_servicio_portal.err('PO429', 'Esperá unos minutos y volvé a probar');
  END IF;
  SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE workspace_id = v_ws AND email = v_email;
  IF a.id IS NULL OR a.password_hash IS NULL OR extensions.crypt(COALESCE(p_password, ''), a.password_hash) IS DISTINCT FROM a.password_hash THEN
    -- 00500: se devuelve, no se lanza, para que el intento quede contado en el tope de arriba.
    RETURN jsonb_build_object('ok', false, 'code', 'PO401', 'message', 'El email o la contraseña no son correctos');
  END IF;
  IF a.status = 'suspended' THEN PERFORM app_servicio_portal.err('PO402', 'Tu cuenta está suspendida. Escribinos'); END IF;
  UPDATE app_servicio_portal.portal_accounts SET last_login_at = now(), status = CASE WHEN status = 'invited' THEN 'active' ELSE status END, updated_at = now() WHERE id = a.id;
  RETURN jsonb_build_object('ok', true, 'token', app_servicio_portal.session_new(v_ws, a.id, 'student', v_ttl, p_ua_hash, p_ip_hash), 'expires_at', now() + v_ttl);
END;
$$;
-- Los permisos de la función no cambian (CREATE OR REPLACE los conserva): postgres, portal_app y service_role.

-- Definición anterior de portal_login_password (00384), para volver atrás: igual a la de arriba salvo que la
-- contraseña equivocada hacía
--     PERFORM app_servicio_portal.err('PO401', 'El email o la contraseña no son correctos');
-- en lugar del RETURN marcado «00500».
