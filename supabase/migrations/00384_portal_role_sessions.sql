-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00384_portal_role_sessions  (Portal de estudiantes, Corrida B2 · P01 + P02 + P16)
-- ============================================================================
-- P01 · El rol del portal: `portal_app` (NOLOGIN) y `portal_app_login` (LOGIN, hereda de portal_app). Nace SIN
--       contraseña: la genera y la carga Leonardo (decisión 15/11). `USAGE` solo en `app_servicio_portal` y
--       `EXECUTE` solo en las funciones `portal_*` de ese esquema. Ninguna tabla: un SELECT directo falla.
-- P02 · La entrada y la sesión (§5 del plano del portal). Todas reciben la dirección (`host`) o el token de sesión:
--       el negocio y el contacto salen de ahí, nunca de un parámetro.
--         app_servicio.portal_login_code_issue   SOLO servidor de SSA (por eso en app_servicio, que la API ve): emite el código de 6 dígitos (10 min) y lo devuelve una
--                                    vez para que SSA lo mande con el Resend del negocio. Tope 5 por hora por email.
--         portal_login_verify        el código → sesión (30 días con «Recordarme», 12 h sin). 5 intentos.
--         portal_login_password      con contraseña, si el negocio la permite (`login.password_allowed`).
--         portal_set_password        define o cambia la contraseña (10 a 200 caracteres; bcrypt).
--         portal_invite_check        si el link de invitación sigue sirviendo, SIN gastarlo (lección de Outlook).
--         portal_invite_redeem       lo canjea (recién al tocar el botón) y crea la sesión.
--         portal_preview_redeem      el pase de 60 s del equipo → sesión `preview` de 30 min (solo lectura).
--         portal_session_get         valida la sesión (y la renueva si se usa en sus últimos 7 días).
--         portal_logout, portal_logout_all
-- P16 · Días activos: cada sesión válida de un estudiante suma el día de hoy (`portal_touch_active_day`, 00377,
--       una escritura por día) y `last_seen_at` como mucho una vez por hora.
-- Topes (§4.7): 5 códigos por hora por email; 5 intentos por código; 60 pedidos por minuto por sesión.
-- Errores: PO401 (sin sesión, código o contraseña mal), PO402 (cuenta suspendida), PO403 (vista previa: solo
-- lectura), PO410 (link vencido), PO429 (tope).
--
-- Aditiva: nada de lo que existe cambia. Sin la contraseña del rol, nadie se puede conectar como el portal.
--
-- Volver atrás:
--   DROP FUNCTION IF EXISTS app_servicio.portal_login_code_issue(text, text), app_servicio_portal.portal_login_verify(text, text, text, boolean, text, text),
--     app_servicio_portal.portal_login_password(text, text, text, boolean, text, text), app_servicio_portal.portal_set_password(text, text),
--     app_servicio_portal.portal_invite_check(text, text), app_servicio_portal.portal_invite_redeem(text, text, text, text),
--     app_servicio_portal.portal_preview_redeem(text, text, text, text), app_servicio_portal.portal_session_get(text),
--     app_servicio_portal.portal_logout(text), app_servicio_portal.portal_logout_all(text),
--     app_servicio_portal.ws_by_host(text), app_servicio_portal.session_new(uuid, uuid, text, interval, text, text, uuid, uuid),
--     app_servicio_portal.session_resolve(text, boolean), app_servicio_portal.require_write(jsonb), app_servicio_portal.err(text, text);
--   REVOKE USAGE ON SCHEMA app_servicio_portal FROM portal_app; DROP ROLE IF EXISTS portal_app_login; DROP ROLE IF EXISTS portal_app;
-- ============================================================================

-- ─── P01 · Los roles ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    CREATE ROLE portal_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app_login') THEN
    CREATE ROLE portal_app_login LOGIN INHERIT CONNECTION LIMIT 30 IN ROLE portal_app;
  END IF;
END $$;
ALTER ROLE portal_app_login SET statement_timeout = '15s';
ALTER ROLE portal_app_login SET search_path = '';
GRANT USAGE ON SCHEMA app_servicio_portal TO portal_app;
-- Sin tablas, sin otros esquemas: por si alguien sumó algo por defecto.
REVOKE ALL ON ALL TABLES IN SCHEMA app_servicio_portal FROM portal_app;
REVOKE ALL ON SCHEMA public FROM portal_app;

-- ─── Ayudantes internos (sin EXECUTE para el portal) ────────────────────────
-- Un error del contrato: código POxxx y el texto para mostrar.
CREATE OR REPLACE FUNCTION app_servicio_portal.err(p_code text, p_message text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION '%', p_message USING ERRCODE = p_code;
END;
$$;

-- La dirección → el negocio (índice único `uq_workspaces_portal_host`). Desconocida: NULL.
CREATE OR REPLACE FUNCTION app_servicio_portal.ws_by_host(p_host text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT w.id FROM public.workspaces w
   WHERE lower(w.portal_settings ->> 'host') = lower(btrim(split_part(COALESCE(p_host, ''), ':', 1)))
     AND NULLIF(w.portal_settings ->> 'host', '') IS NOT NULL
   LIMIT 1;
$$;

-- Crea una sesión y devuelve el token en claro UNA vez (en la base queda solo su huella).
CREATE OR REPLACE FUNCTION app_servicio_portal.session_new(p_ws uuid, p_account uuid, p_kind text, p_ttl interval, p_ua_hash text, p_ip_hash text,
                                                           p_preview_contact uuid DEFAULT NULL, p_preview_user uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
  INSERT INTO app_servicio_portal.portal_sessions (workspace_id, account_id, kind, token_hash, expires_at, preview_user_id, preview_contact_id,
                                                   user_agent_hash, ip_hash, last_seen_at)
  VALUES (p_ws, p_account, p_kind, app_servicio.portal_token_hash(v_token), now() + p_ttl, p_preview_user, p_preview_contact,
          left(p_ua_hash, 64), left(p_ip_hash, 64), now());
  RETURN v_token;
END;
$$;

-- Valida el token y devuelve {session_id, workspace_id, account_id, contact_id, kind, expires_at}. Con p_touch:
-- tope de pedidos, renovación, `last_seen_at` por hora y el día activo (P16).
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
      IF s.last_seen_at IS NULL OR s.last_seen_at < now() - interval '1 hour' THEN
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

-- Toda función que escribe empieza con esto: la vista previa del equipo es de solo lectura (§4.5).
CREATE OR REPLACE FUNCTION app_servicio_portal.require_write(p_sess jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_sess ->> 'kind' <> 'student' THEN PERFORM app_servicio_portal.err('PO403', 'Solo lectura'); END IF;
END;
$$;

-- ─── P02 · Entrar ───────────────────────────────────────────────────────────
-- SOLO el servidor de SSA (service_role): devuelve el código en claro para mandarlo por email. Responde
-- {send:false} si la dirección o el email no existen (SSA contesta igual en los dos casos) o {send:false,
-- reason:'rate_limited'} desde el sexto pedido en la hora (se cuenta exista o no el email).
CREATE OR REPLACE FUNCTION app_servicio.portal_login_code_issue(p_host text, p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid := app_servicio_portal.ws_by_host(p_host);
  v_email text := lower(btrim(COALESCE(p_email, '')));
  a app_servicio_portal.portal_accounts;
  v_code text;
BEGIN
  IF v_ws IS NULL OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR NOT app_servicio.module_on(v_ws) THEN
    RETURN jsonb_build_object('send', false);
  END IF;
  IF public.bump_rate_limit('portal-code:' || v_ws::text || ':' || v_email, date_trunc('hour', now())) > 5 THEN
    RETURN jsonb_build_object('send', false, 'reason', 'rate_limited');
  END IF;
  SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE workspace_id = v_ws AND email = v_email FOR UPDATE;
  IF a.id IS NULL THEN RETURN jsonb_build_object('send', false); END IF;
  v_code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  UPDATE app_servicio_portal.portal_accounts
     SET login_code_hash = app_servicio.portal_token_hash(a.id::text || ':' || v_code), login_code_expires_at = now() + interval '10 minutes',
         login_code_attempts = 0, updated_at = now()
   WHERE id = a.id;
  RETURN jsonb_build_object('send', true, 'workspace_id', v_ws, 'account_id', a.id, 'contact_id', a.contact_id, 'email', a.email,
                            'display_name', a.display_name, 'code', v_code, 'expires_at', now() + interval '10 minutes');
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_login_verify(p_host text, p_email text, p_code text, p_remember boolean, p_ua_hash text, p_ip_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid := app_servicio_portal.ws_by_host(p_host);
  a app_servicio_portal.portal_accounts;
  v_ttl interval := CASE WHEN p_remember IS NOT FALSE THEN interval '30 days' ELSE interval '12 hours' END;
  v_token text;
BEGIN
  IF v_ws IS NULL OR NOT app_servicio.module_on(v_ws) THEN PERFORM app_servicio_portal.err('PO401', 'El código no es válido o venció. Pedí otro'); END IF;
  SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE workspace_id = v_ws AND email = lower(btrim(COALESCE(p_email, ''))) FOR UPDATE;
  IF a.id IS NULL OR a.login_code_hash IS NULL OR a.login_code_expires_at <= now() OR a.login_code_attempts >= 5 THEN
    PERFORM app_servicio_portal.err('PO401', 'El código no es válido o venció. Pedí otro');
  END IF;
  IF a.login_code_hash IS DISTINCT FROM app_servicio.portal_token_hash(a.id::text || ':' || btrim(COALESCE(p_code, ''))) THEN
    UPDATE app_servicio_portal.portal_accounts SET login_code_attempts = login_code_attempts + 1 WHERE id = a.id;
    -- El intento fallido tiene que quedar aunque la llamada termine en error: se devuelve, no se lanza.
    RETURN jsonb_build_object('ok', false, 'code', 'PO401', 'message',
      CASE WHEN a.login_code_attempts + 1 >= 5 THEN 'Ese código ya no sirve. Pedí otro' ELSE 'El código no es correcto' END);
  END IF;
  IF a.status = 'suspended' THEN PERFORM app_servicio_portal.err('PO402', 'Tu cuenta está suspendida. Escribinos'); END IF;
  UPDATE app_servicio_portal.portal_accounts
     SET login_code_hash = NULL, login_code_expires_at = NULL, login_code_attempts = 0, last_login_at = now(),
         status = CASE WHEN status = 'invited' THEN 'active' ELSE status END, updated_at = now()
   WHERE id = a.id;
  v_token := app_servicio_portal.session_new(v_ws, a.id, 'student', v_ttl, p_ua_hash, p_ip_hash);
  RETURN jsonb_build_object('ok', true, 'token', v_token, 'expires_at', now() + v_ttl);
END;
$$;

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
    PERFORM app_servicio_portal.err('PO401', 'El email o la contraseña no son correctos');
  END IF;
  IF a.status = 'suspended' THEN PERFORM app_servicio_portal.err('PO402', 'Tu cuenta está suspendida. Escribinos'); END IF;
  UPDATE app_servicio_portal.portal_accounts SET last_login_at = now(), status = CASE WHEN status = 'invited' THEN 'active' ELSE status END, updated_at = now() WHERE id = a.id;
  RETURN jsonb_build_object('ok', true, 'token', app_servicio_portal.session_new(v_ws, a.id, 'student', v_ttl, p_ua_hash, p_ip_hash), 'expires_at', now() + v_ttl);
END;
$$;

-- La revisión contra contraseñas filtradas la hace el servidor del portal antes de llamar (k-anonimato).
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_set_password(p_session text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  IF p_password IS NULL OR char_length(p_password) < 10 OR char_length(p_password) > 200 THEN
    PERFORM app_servicio_portal.err('PO400', 'La contraseña tiene que tener al menos 10 caracteres');
  END IF;
  UPDATE app_servicio_portal.portal_accounts SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
   WHERE id = (sess ->> 'account_id')::uuid;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─── P02 · Invitación y vista previa ────────────────────────────────────────
-- Ver si el link sirve NO lo gasta: el GET de la página llama a esta; el botón, a portal_invite_redeem.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_invite_check(p_host text, p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('valid', EXISTS (
    SELECT 1 FROM app_servicio_portal.portal_accounts a
     WHERE a.workspace_id = app_servicio_portal.ws_by_host(p_host) AND p_token ~ '^[0-9a-f]{64}$'
       AND a.invite_token_hash = app_servicio.portal_token_hash(p_token) AND a.invite_expires_at > now() AND a.status <> 'suspended'));
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_invite_redeem(p_host text, p_token text, p_ua_hash text, p_ip_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid := app_servicio_portal.ws_by_host(p_host);
  a app_servicio_portal.portal_accounts;
BEGIN
  IF v_ws IS NULL OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' OR NOT app_servicio.module_on(v_ws) THEN
    PERFORM app_servicio_portal.err('PO410', 'Este link venció. Pedí uno nuevo');
  END IF;
  SELECT * INTO a FROM app_servicio_portal.portal_accounts
   WHERE workspace_id = v_ws AND invite_token_hash = app_servicio.portal_token_hash(p_token) FOR UPDATE;
  IF a.id IS NULL OR a.invite_expires_at <= now() THEN PERFORM app_servicio_portal.err('PO410', 'Este link venció. Pedí uno nuevo'); END IF;
  IF a.status = 'suspended' THEN PERFORM app_servicio_portal.err('PO402', 'Tu cuenta está suspendida. Escribinos'); END IF;
  UPDATE app_servicio_portal.portal_accounts
     SET invite_token_hash = NULL, invite_expires_at = NULL, status = 'active', last_login_at = now(), updated_at = now()
   WHERE id = a.id;
  RETURN jsonb_build_object('ok', true, 'token', app_servicio_portal.session_new(v_ws, a.id, 'student', interval '30 days', p_ua_hash, p_ip_hash),
                            'expires_at', now() + interval '30 days', 'has_password', a.password_hash IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_preview_redeem(p_host text, p_token text, p_ua_hash text, p_ip_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid := app_servicio_portal.ws_by_host(p_host);
  s app_servicio_portal.portal_sessions;
BEGIN
  IF v_ws IS NULL OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN PERFORM app_servicio_portal.err('PO410', 'Este link venció. Volvé a abrirlo desde SSA'); END IF;
  SELECT * INTO s FROM app_servicio_portal.portal_sessions
   WHERE token_hash = app_servicio.portal_token_hash(p_token) AND workspace_id = v_ws AND kind = 'preview_pass' FOR UPDATE;
  IF s.id IS NULL OR s.revoked_at IS NOT NULL OR s.expires_at <= now() THEN
    PERFORM app_servicio_portal.err('PO410', 'Este link venció. Volvé a abrirlo desde SSA');
  END IF;
  UPDATE app_servicio_portal.portal_sessions SET revoked_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('ok', true, 'expires_at', now() + interval '30 minutes',
    'token', app_servicio_portal.session_new(v_ws, s.account_id, 'preview', interval '30 minutes', p_ua_hash, p_ip_hash, s.preview_contact_id, s.preview_user_id));
END;
$$;

-- ─── P02 · La sesión ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_session_get(p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
BEGIN
  RETURN jsonb_build_object('kind', sess ->> 'kind', 'expires_at', sess -> 'expires_at',
    'preview_name', CASE WHEN sess ->> 'kind' = 'preview' THEN (SELECT c.display_name FROM public.contacts c WHERE c.id = (sess ->> 'contact_id')::uuid) END);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_logout(p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_session ~ '^[0-9a-f]{64}$' THEN
    UPDATE app_servicio_portal.portal_sessions SET revoked_at = now()
     WHERE token_hash = app_servicio.portal_token_hash(p_session) AND revoked_at IS NULL;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Cerrar en todos lados: todas las sesiones de la cuenta (también esta). Rige en el próximo pedido de cada una.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_logout_all(p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session, false);
  n integer;
BEGIN
  PERFORM app_servicio_portal.require_write(sess);
  UPDATE app_servicio_portal.portal_sessions SET revoked_at = now()
   WHERE account_id = (sess ->> 'account_id')::uuid AND kind = 'student' AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'closed', n);
END;
$$;

-- ─── Permisos ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio_portal.err(text, text), app_servicio_portal.ws_by_host(text),
  app_servicio_portal.session_new(uuid, uuid, text, interval, text, text, uuid, uuid), app_servicio_portal.session_resolve(text, boolean),
  app_servicio_portal.require_write(jsonb), app_servicio.portal_login_code_issue(text, text),
  app_servicio_portal.portal_login_verify(text, text, text, boolean, text, text), app_servicio_portal.portal_login_password(text, text, text, boolean, text, text),
  app_servicio_portal.portal_set_password(text, text), app_servicio_portal.portal_invite_check(text, text),
  app_servicio_portal.portal_invite_redeem(text, text, text, text), app_servicio_portal.portal_preview_redeem(text, text, text, text),
  app_servicio_portal.portal_session_get(text), app_servicio_portal.portal_logout(text), app_servicio_portal.portal_logout_all(text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.portal_login_code_issue(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION
  app_servicio_portal.portal_login_verify(text, text, text, boolean, text, text), app_servicio_portal.portal_login_password(text, text, text, boolean, text, text),
  app_servicio_portal.portal_set_password(text, text), app_servicio_portal.portal_invite_check(text, text),
  app_servicio_portal.portal_invite_redeem(text, text, text, text), app_servicio_portal.portal_preview_redeem(text, text, text, text),
  app_servicio_portal.portal_session_get(text), app_servicio_portal.portal_logout(text), app_servicio_portal.portal_logout_all(text)
TO portal_app, service_role;
