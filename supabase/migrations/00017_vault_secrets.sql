-- ============================================================
-- MIGRACION 00017 — SUPABASE VAULT
-- ============================================================
-- Base para guardar API keys de terceros (Zernio, Evolution, Resend,
-- proveedores de IA) encriptadas con AES-256 en vez de en texto plano.
--
-- Aislamiento por workspace: el nombre real del secret en Vault es
-- 'ws:<workspace_id>:<nombre>'. Dos workspaces no pueden pisarse ni leerse
-- entre si porque el prefijo lo pone la funcion, no el llamador.
--
-- Acceso: solo Owner/Admin del workspace, mas service_role (el server usa la
-- service key en webhooks y cron jobs, donde no hay usuario logueado).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ------------------------------------------------------------
-- Helper de rol: complementa is_workspace_member (migracion 00002).
-- Se usa en estas funciones y en las policies de RLS del bloque siguiente.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

COMMENT ON FUNCTION public.is_workspace_admin(uuid) IS
  'True si el usuario actual es owner o admin del workspace. Para policies y RPCs privilegiadas.';

-- ------------------------------------------------------------
-- Helpers internos
-- ------------------------------------------------------------

-- Nombre namespaceado. Rechaza nombres que puedan escapar del prefijo.
CREATE OR REPLACE FUNCTION public.vault_secret_key(ws_id uuid, plain_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF plain_name IS NULL OR plain_name !~ '^[A-Za-z0-9_.-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid secret name: only letters, digits, dot, dash and underscore (max 100)';
  END IF;
  IF ws_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;
  RETURN 'ws:' || ws_id::text || ':' || plain_name;
END;
$$;

-- Autorizacion comun a las 4 RPCs.
CREATE OR REPLACE FUNCTION public.assert_can_manage_secrets(ws_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
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
$$;

-- ------------------------------------------------------------
-- store_secret — crea o actualiza. Devuelve el id del secret en Vault.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_secret(
  secret_name text,
  secret_value text,
  workspace_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- ------------------------------------------------------------
-- read_secret — devuelve el valor desencriptado, o NULL si no existe.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.read_secret(
  secret_name text,
  workspace_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
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
$$;

-- ------------------------------------------------------------
-- delete_secret — true si borro algo, false si no existia.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_secret(
  secret_name text,
  workspace_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- ------------------------------------------------------------
-- list_secret_names — que hay configurado, sin exponer valores.
-- La pantalla de integraciones (Bloque 2) la usa para pintar estados.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_secret_names(workspace_id uuid)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
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
$$;

-- ------------------------------------------------------------
-- Permisos: nadie anonimo, nadie sin loguear.
-- ------------------------------------------------------------
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.store_secret(text, text, uuid)',
    'public.read_secret(text, uuid)',
    'public.delete_secret(text, uuid)',
    'public.list_secret_names(uuid)',
    'public.assert_can_manage_secrets(uuid)',
    'public.vault_secret_key(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
  END LOOP;

  FOREACH fn IN ARRAY ARRAY[
    'public.store_secret(text, text, uuid)',
    'public.read_secret(text, uuid)',
    'public.delete_secret(text, uuid)',
    'public.list_secret_names(uuid)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.is_workspace_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid) TO authenticated, service_role;
