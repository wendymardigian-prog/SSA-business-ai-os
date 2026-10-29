-- ============================================================================
-- Secretos e integraciones
--
-- Las claves de los proveedores (IA, Zernio, Resend, Google...) viven cifradas en
-- Supabase Vault: estas funciones las guardan, las leen (solo el servidor) y las borran.
-- De una clave guardada la pantalla solo sabe que existe.
--
-- Ademas: la configuracion de cada integracion, las conexiones OAuth (por negocio o por
-- persona) y los canales de mensajeria conectados (Instagram, WhatsApp, email).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.channels (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  platform text NOT NULL,
  late_account_id text NOT NULL,
  username text,
  display_name text,
  profile_picture text,
  webhook_id text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  last_comment_cursor text,
  comment_rules jsonb DEFAULT '[]'::jsonb,
  provider text DEFAULT 'zernio'::text NOT NULL,
  evolution_instance text,
  connection_status text DEFAULT 'unknown'::text NOT NULL,
  last_connected_at timestamp with time zone,
  last_error text,
  disconnected_notified_at timestamp with time zone,
  messaging_window_hours integer,
  email_address text,
  inbox_import jsonb,
  CONSTRAINT channels_pkey PRIMARY KEY (id),
  CONSTRAINT channels_workspace_id_late_account_id_key UNIQUE (workspace_id, late_account_id),
  CONSTRAINT channels_connection_status_check CHECK ((connection_status = ANY (ARRAY['connected'::text, 'disconnected'::text, 'connecting'::text, 'error'::text, 'unknown'::text]))),
  CONSTRAINT channels_messaging_window_range CHECK (((messaging_window_hours IS NULL) OR ((messaging_window_hours >= 0) AND (messaging_window_hours <= 168)))),
  CONSTRAINT channels_platform_check CHECK ((platform = ANY (ARRAY['facebook'::text, 'instagram'::text, 'twitter'::text, 'telegram'::text, 'bluesky'::text, 'reddit'::text, 'whatsapp'::text, 'email'::text]))),
  CONSTRAINT channels_provider_check CHECK ((provider = ANY (ARRAY['zernio'::text, 'evolution'::text, 'resend'::text]))),
  CONSTRAINT channels_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.channels.provider IS 'De donde sale la conexion: zernio (Instagram, Facebook, ...) o evolution (WhatsApp por Baileys).';
COMMENT ON COLUMN public.channels.connection_status IS 'Estado en vivo. Solo lo mantienen los canales de Evolution; los de Zernio quedan en unknown.';
COMMENT ON COLUMN public.channels.messaging_window_hours IS 'Horas desde el ultimo mensaje del lead en las que la plataforma deja responder. NULL = default por plataforma (Instagram y Facebook: 24, lo que documenta Meta; el resto: sin ventana). 0 = sin ventana (WhatsApp por Evolution).';
COMMENT ON COLUMN public.channels.email_address IS 'La direccion que recibe y desde la que se responde. Solo en canales de email.';
COMMENT ON COLUMN public.channels.inbox_import IS 'Avance de la importacion de conversaciones desde Zernio: run_id, status, pass, phase, cursor, step, scanned, imported. NULL = nunca se importo.';

CREATE TABLE IF NOT EXISTS public.integration_configs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  type text NOT NULL,
  provider text NOT NULL,
  display_name text,
  vault_secret_name text,
  oauth_data jsonb,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_active boolean DEFAULT false NOT NULL,
  connected_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT integration_configs_pkey PRIMARY KEY (id),
  CONSTRAINT integration_configs_type_check CHECK ((type = ANY (ARRAY['channel'::text, 'ai_provider'::text, 'email_provider'::text, 'social_network'::text, 'publishing_service'::text, 'google'::text, 'meta'::text]))),
  CONSTRAINT integration_configs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.integration_configs ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.integration_configs IS 'Integraciones del workspace (canales, IA, email). Las API keys viven en Vault; aca solo el nombre del secret.';
COMMENT ON COLUMN public.integration_configs.vault_secret_name IS 'Nombre limpio del secret en Vault (sin el prefijo ws:<id>:). Null si la integracion no usa API key.';

CREATE TABLE IF NOT EXISTS public.oauth_connections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  provider text NOT NULL,
  user_id uuid,
  external_account_id text,
  account_label text,
  granted_scopes text[] DEFAULT '{}'::text[] NOT NULL,
  token_expires_at timestamp with time zone,
  refresh_expires_at timestamp with time zone,
  status text DEFAULT 'active'::text NOT NULL,
  last_error text,
  last_refreshed_at timestamp with time zone,
  vault_secret_prefix text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT oauth_connections_pkey PRIMARY KEY (id),
  CONSTRAINT oauth_connections_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'linkedin'::text, 'threads'::text, 'google_calendar'::text]))),
  CONSTRAINT oauth_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'attention'::text, 'revoked'::text, 'error'::text]))),
  CONSTRAINT oauth_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT oauth_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.oauth_connections ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.oauth_connections IS 'Una fila por proveedor OAuth conectado. Los tokens NO estan aca: viven en Vault, con el nombre que arma vault_secret_prefix.';
COMMENT ON COLUMN public.oauth_connections.user_id IS 'NULL = la conexion es del workspace (una por proveedor). Con valor = de esa persona (google_calendar): una fila por cuenta externa.';
COMMENT ON COLUMN public.oauth_connections.granted_scopes IS 'Los permisos que el proveedor otorgo DE VERDAD, no los que se pidieron. Un permiso que la persona destildo se ve aca.';
COMMENT ON COLUMN public.oauth_connections.status IS 'active: anda. attention: hay algo que resolver (vence pronto, falta un permiso). revoked: el proveedor corto el acceso. error: la ultima operacion fallo.';
COMMENT ON COLUMN public.oauth_connections.vault_secret_prefix IS 'Prefijo del nombre de sus secretos en Vault: <prefijo>_access_token y <prefijo>_refresh_token.';

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.my_channels(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role        text;
  v_role_id     uuid;
  v_system_role text;
  v_permissions jsonb;
BEGIN
  SELECT m.role, m.role_id, r.system_role, COALESCE(r.permissions, '{}'::jsonb)
    INTO v_role, v_role_id, v_system_role, v_permissions
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_role IN ('owner', 'admin') THEN
    RETURN '{"mode":"all","all":{"scope":"all","reply":true}}'::jsonb;
  END IF;
  IF v_role_id IS NULL OR v_system_role = 'member' THEN
    RETURN private.member_channels();
  END IF;
  RETURN COALESCE(v_permissions -> 'channels', '{"mode":"custom","byChannel":{}}'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION private.my_channels(p_workspace_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.my_channels(p_workspace_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.set_system_secret(p_name text, p_value text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_value text := btrim(coalesce(p_value, ''));
  v_key   text;
  v_host  text;
  v_id    uuid;
BEGIN
  IF p_name IS NULL OR p_name NOT IN ('app_url', 'cron_secret') THEN
    RAISE EXCEPTION 'nombre invalido: solo se aceptan ''app_url'' o ''cron_secret''';
  END IF;

  IF v_value = '' THEN
    RAISE EXCEPTION 'el valor de % no puede quedar vacio', p_name;
  END IF;

  -- La URL tiene que ser la publica de la app. Una local no falla: los
  -- cron simplemente le pegarian a la nada (misma regla que isLocalUrl en
  -- lib/webhook-url.ts).
  IF p_name = 'app_url' THEN
    IF v_value !~* '^https://' THEN
      RAISE EXCEPTION 'app_url tiene que empezar con https:// (es la direccion publica de la app, por ejemplo la de Railway)';
    END IF;
    v_value := rtrim(v_value, '/');
    v_host := lower(split_part(split_part(substring(v_value from 9), '/', 1), ':', 1));
    IF v_host = '' OR v_host IN ('localhost', '127.0.0.1', '0.0.0.0', '[')
       OR v_host LIKE '%.localhost' OR v_host LIKE '%.local' THEN
      RAISE EXCEPTION 'app_url no puede ser una direccion local: tiene que ser la publica de produccion';
    END IF;
  END IF;

  v_key := 'system:' || p_name;

  SELECT s.id INTO v_id FROM vault.secrets s WHERE s.name = v_key;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(v_value, v_key, 'secreto del sistema (lo lee pg_cron)');
  ELSE
    PERFORM vault.update_secret(v_id, v_value, v_key, 'secreto del sistema (lo lee pg_cron)');
  END IF;

  RETURN 'listo: ' || p_name || ' guardado en Vault';
END;
$function$;
COMMENT ON FUNCTION private.set_system_secret(p_name text, p_value text) IS 'Carga o cambia app_url / cron_secret en Vault (system:*). Lo lee private.call_app_cron. El cron_secret tiene que ser igual al CRON_SECRET de Railway.';
REVOKE ALL ON FUNCTION private.set_system_secret(p_name text, p_value text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.system_secrets_status()
 RETURNS TABLE(app_url text, cron_secret_set boolean, calls_ok_15m bigint, calls_401_15m bigint, calls_other_15m bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'system:app_url'),
    EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'system:cron_secret'),
    (SELECT count(*) FROM net._http_response r
      WHERE r.created > now() - interval '15 minutes' AND r.status_code BETWEEN 200 AND 299),
    (SELECT count(*) FROM net._http_response r
      WHERE r.created > now() - interval '15 minutes' AND r.status_code = 401),
    (SELECT count(*) FROM net._http_response r
      WHERE r.created > now() - interval '15 minutes'
        AND (r.status_code IS NULL OR (r.status_code NOT BETWEEN 200 AND 299 AND r.status_code <> 401)));
$function$;
COMMENT ON FUNCTION private.system_secrets_status() IS 'Si app_url y cron_secret estan en Vault, y como respondio la app a los cron en los ultimos 15 minutos. Nunca devuelve el cron_secret.';
REVOKE ALL ON FUNCTION private.system_secrets_status() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.assert_can_manage_secrets(ws_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- service_role: el server (webhooks, cron) no tiene usuario logueado y
  -- necesita leer las keys para operar. Es una clave server-side, nunca
  -- llega al browser.
  IF auth.role() = 'service_role' THEN
    RETURN;
  END IF;
  IF NOT public.is_workspace_admin(ws_id) THEN
    RAISE EXCEPTION 'forbidden: only workspace owners and admins can manage secrets';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.assert_can_manage_secrets(ws_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.delete_secret(secret_name text, workspace_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws      uuid := workspace_id;
  v_key     text;
  v_deleted integer;
BEGIN
  PERFORM public.assert_can_manage_secrets(v_ws);
  v_key := public.vault_secret_key(v_ws, secret_name);

  DELETE FROM vault.secrets s WHERE s.name = v_key;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted > 0;
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_secret(secret_name text, workspace_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.list_secret_names(workspace_id uuid)
 RETURNS SETOF text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws     uuid := workspace_id;
  v_prefix text;
BEGIN
  PERFORM public.assert_can_manage_secrets(v_ws);
  v_prefix := 'ws:' || v_ws::text || ':';

  RETURN QUERY
    SELECT substring(s.name from length(v_prefix) + 1)
    FROM vault.secrets s
    WHERE s.name LIKE v_prefix || '%'
    ORDER BY 1;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_secret_names(workspace_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.messaging_window_hours(p_platform text, p_configured integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_configured IS NOT NULL THEN p_configured
    WHEN p_platform IN ('instagram', 'facebook') THEN 24
    ELSE 0
  END;
$function$;
COMMENT ON FUNCTION public.messaging_window_hours(p_platform text, p_configured integer) IS 'Ventana de mensajeria de un canal en horas: la configurada, o 24 para Instagram/Facebook, o 0 (sin ventana). Espejo de lib/messaging-window.ts.';
REVOKE ALL ON FUNCTION public.messaging_window_hours(p_platform text, p_configured integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.read_secret(secret_name text, workspace_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws    uuid := workspace_id;
  v_key   text;
  v_value text;
BEGIN
  PERFORM public.assert_can_manage_secrets(v_ws);
  v_key := public.vault_secret_key(v_ws, secret_name);

  SELECT s.decrypted_secret INTO v_value
  FROM vault.decrypted_secrets s
  WHERE s.name = v_key;

  RETURN v_value;
END;
$function$;
COMMENT ON FUNCTION public.read_secret(secret_name text, workspace_id uuid) IS 'Devuelve el valor desencriptado de un secret del workspace. Solo service_role: el servidor lee con createServiceClient(); ningun usuario, tampoco el Owner, puede leer una clave desde el navegador.';
REVOKE ALL ON FUNCTION public.read_secret(secret_name text, workspace_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.store_secret(secret_name text, secret_value text, workspace_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws  uuid := workspace_id;
  v_key text;
  v_id  uuid;
BEGIN
  PERFORM public.assert_can_manage_secrets(v_ws);

  IF secret_value IS NULL OR length(secret_value) = 0 THEN
    RAISE EXCEPTION 'secret value cannot be empty';
  END IF;

  v_key := public.vault_secret_key(v_ws, secret_name);

  SELECT s.id INTO v_id FROM vault.secrets s WHERE s.name = v_key;

  IF v_id IS NULL THEN
    v_id := vault.create_secret(secret_value, v_key, 'workspace secret');
  ELSE
    PERFORM vault.update_secret(v_id, secret_value, v_key, 'workspace secret');
  END IF;

  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.store_secret(secret_name text, secret_value text, workspace_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.vault_secret_key(ws_id uuid, plain_name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
BEGIN
  IF plain_name IS NULL OR plain_name !~ '^[A-Za-z0-9_.-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid secret name: only letters, digits, dot, dash and underscore (max 100)';
  END IF;
  IF ws_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;
  RETURN 'ws:' || ws_id::text || ':' || plain_name;
END;
$function$;
REVOKE ALL ON FUNCTION public.vault_secret_key(ws_id uuid, plain_name text) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_evolution_instance ON public.channels USING btree (evolution_instance) WHERE (evolution_instance IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_channels_workspace ON public.channels USING btree (workspace_id);

CREATE INDEX IF NOT EXISTS idx_integration_configs_ws_type ON public.integration_configs USING btree (workspace_id, type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_configs_ws_type_provider ON public.integration_configs USING btree (workspace_id, type, provider);

CREATE INDEX IF NOT EXISTS idx_oauth_connections_expiring ON public.oauth_connections USING btree (token_expires_at) WHERE (status = ANY (ARRAY['active'::text, 'attention'::text]));

CREATE INDEX IF NOT EXISTS idx_oauth_connections_user ON public.oauth_connections USING btree (workspace_id, user_id, provider) WHERE (user_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_channels_email_per_workspace ON public.channels USING btree (workspace_id) WHERE (platform = 'email'::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_connections_user_account ON public.oauth_connections USING btree (workspace_id, provider, user_id, external_account_id) WHERE (user_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_connections_workspace_provider ON public.oauth_connections USING btree (workspace_id, provider) WHERE (user_id IS NULL);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.channels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_integration_configs BEFORE UPDATE ON public.integration_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.oauth_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY channels_delete ON public.channels FOR DELETE TO public
    USING (( SELECT public.has_permission(channels.workspace_id, 'channels.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY channels_insert ON public.channels FOR INSERT TO public
    WITH CHECK (( SELECT public.has_permission(channels.workspace_id, 'channels.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY channels_update ON public.channels FOR UPDATE TO public
    USING (( SELECT public.has_permission(channels.workspace_id, 'channels.manage'::text) AS has_permission))
    WITH CHECK (( SELECT public.has_permission(channels.workspace_id, 'channels.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view channels in their workspaces" ON public.channels FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY integration_configs_delete ON public.integration_configs FOR DELETE TO public
    USING ((( SELECT public.has_permission(integration_configs.workspace_id, 'integrations.manage'::text) AS has_permission) OR (((type = 'channel'::text) OR (provider = 'resend_inbound'::text)) AND ( SELECT public.has_permission(integration_configs.workspace_id, 'channels.manage'::text) AS has_permission))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY integration_configs_insert ON public.integration_configs FOR INSERT TO public
    WITH CHECK ((( SELECT public.has_permission(integration_configs.workspace_id, 'integrations.manage'::text) AS has_permission) OR (((type = 'channel'::text) OR (provider = 'resend_inbound'::text)) AND ( SELECT public.has_permission(integration_configs.workspace_id, 'channels.manage'::text) AS has_permission))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY integration_configs_select ON public.integration_configs FOR SELECT TO public
    USING ((( SELECT public.has_permission(integration_configs.workspace_id, 'integrations.view'::text) AS has_permission) OR ( SELECT public.has_permission(integration_configs.workspace_id, 'integrations.manage'::text) AS has_permission) OR (((type = 'channel'::text) OR (provider = 'resend_inbound'::text)) AND ( SELECT public.has_permission(integration_configs.workspace_id, 'channels.manage'::text) AS has_permission))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY integration_configs_update ON public.integration_configs FOR UPDATE TO public
    USING ((( SELECT public.has_permission(integration_configs.workspace_id, 'integrations.manage'::text) AS has_permission) OR (((type = 'channel'::text) OR (provider = 'resend_inbound'::text)) AND ( SELECT public.has_permission(integration_configs.workspace_id, 'channels.manage'::text) AS has_permission))))
    WITH CHECK ((( SELECT public.has_permission(integration_configs.workspace_id, 'integrations.manage'::text) AS has_permission) OR (((type = 'channel'::text) OR (provider = 'resend_inbound'::text)) AND ( SELECT public.has_permission(integration_configs.workspace_id, 'channels.manage'::text) AS has_permission))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY oauth_connections_select ON public.oauth_connections FOR SELECT TO public
    USING (public.is_workspace_admin(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY oauth_connections_select_own ON public.oauth_connections FOR SELECT TO public
    USING (((user_id = auth.uid()) AND public.is_workspace_member(workspace_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
