-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00340_app_servicio_portal_accounts  (Servicios v12, Corrida A1 · S08 · bloque AC)
-- ============================================================================
-- 1. Esquema `app_servicio_portal` (lo del estudiante), CERRADO: sin USAGE para anon ni authenticated y
--    NO se expone por la API (F34). Las pantallas de SSA leen y escriben lo del estudiante SOLO con
--    funciones de `app_servicio` (svc_* / portal_admin_*), que validan permiso y negocio. El rol del portal
--    (portal_app) lo crea la Parte 2.
-- 2. `portal_accounts` (§8.2 #8, F41): una cuenta por contacto y negocio, email unico por negocio. Los
--    secretos se guardan solo como huella (*_hash).
-- 3. `portal_sessions` (§8.2 #9, F44): sesiones del estudiante y pases de "Ver como estudiante". Solo la
--    huella del token (unica). `account_id` es obligatorio salvo en los pases de vista previa (el contacto
--    puede no tener cuenta): CHECK.
-- 4. Bucket privado `portal-avatars` (sin politicas: sube y lee el servidor).
--
-- Aditiva. Puede ir antes o despues del codigo: hasta AC nadie la usa. Con el modulo apagado no cambia nada.
-- Numero: la 00338 y la 00339 las ocupan otras ramas (ver docs/PROGRESS-servicios.md).
--
-- Cómo volver atrás:
--   DROP SCHEMA IF EXISTS app_servicio_portal CASCADE;          -- (vacio: el modulo nace apagado)
--   DELETE FROM storage.buckets WHERE id = 'portal-avatars';     -- (vaciarlo antes)
--
-- Riesgo: bajo (todo nuevo, nada de lo que existe cambia).
-- ============================================================================

-- ─── 1. Esquema cerrado ─────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS app_servicio_portal;
REVOKE ALL ON SCHEMA app_servicio_portal FROM public, anon, authenticated;
GRANT USAGE ON SCHEMA app_servicio_portal TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_servicio_portal REVOKE EXECUTE ON FUNCTIONS FROM public;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_servicio_portal REVOKE ALL ON TABLES FROM public, anon, authenticated;

-- ─── 2. Cuentas del portal (F41) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio_portal.portal_accounts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id              uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  email                   text NOT NULL,
  status                  text NOT NULL DEFAULT 'invited',
  password_hash           text NULL,
  login_code_hash         text NULL,
  login_code_expires_at   timestamptz NULL,
  login_code_attempts     integer NOT NULL DEFAULT 0,
  invite_token_hash       text NULL,
  invite_expires_at       timestamptz NULL,
  invite_sent_at          timestamptz NULL,
  invite_sent_count_day   integer NOT NULL DEFAULT 0,
  last_login_at           timestamptz NULL,
  display_name            text NULL,
  avatar_path             text NULL,
  timezone                text NULL,
  show_amount_in_fame     boolean NOT NULL DEFAULT false,
  suspended_at            timestamptz NULL,
  suspended_reason        text NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_accounts_status_check CHECK (status IN ('invited', 'active', 'suspended')),
  CONSTRAINT portal_accounts_email_lower CHECK (email = lower(btrim(email)) AND email <> ''),
  CONSTRAINT portal_accounts_attempts_check CHECK (login_code_attempts >= 0 AND invite_sent_count_day >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_accounts_contact ON app_servicio_portal.portal_accounts (workspace_id, contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_accounts_email ON app_servicio_portal.portal_accounts (workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_portal_accounts_invite ON app_servicio_portal.portal_accounts (invite_token_hash) WHERE invite_token_hash IS NOT NULL;
COMMENT ON TABLE app_servicio_portal.portal_accounts IS
  'Servicios v12 (F41): la cuenta del portal de un contacto. Una por contacto y negocio; email unico por negocio. Solo huellas de los secretos. La escriben las funciones del modulo (00341).';

-- ─── 3. Sesiones del portal (F44) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio_portal.portal_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id          uuid NULL REFERENCES app_servicio_portal.portal_accounts(id) ON DELETE CASCADE,
  kind                text NOT NULL,
  token_hash          text NOT NULL,
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz NULL,
  preview_user_id     uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  preview_contact_id  uuid NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_agent_hash     text NULL,
  ip_hash             text NULL,
  last_seen_at        timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_sessions_kind_check CHECK (kind IN ('student', 'preview_pass', 'preview')),
  CONSTRAINT portal_sessions_account_check CHECK (kind <> 'student' OR account_id IS NOT NULL),
  CONSTRAINT portal_sessions_preview_check CHECK (kind = 'student' OR preview_contact_id IS NOT NULL),
  CONSTRAINT portal_sessions_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_sessions_token ON app_servicio_portal.portal_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_account ON app_servicio_portal.portal_sessions (account_id) WHERE revoked_at IS NULL;
COMMENT ON TABLE app_servicio_portal.portal_sessions IS
  'Servicios v12 (F44): sesiones del portal y pases de "Ver como estudiante". Solo la huella del token. La crea y la revoca SSA; el login la usa en la Parte 2.';

-- ─── 4. Permisos y RLS (cerradas: solo service_role) ────────────────────────
ALTER TABLE app_servicio_portal.portal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_servicio_portal.portal_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_servicio_portal.portal_accounts FROM public, anon, authenticated;
REVOKE ALL ON app_servicio_portal.portal_sessions FROM public, anon, authenticated;
GRANT ALL ON app_servicio_portal.portal_accounts TO service_role;
GRANT ALL ON app_servicio_portal.portal_sessions TO service_role;

-- ─── 5. Bucket privado de las fotos del portal ──────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('portal-avatars', 'portal-avatars', false, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
