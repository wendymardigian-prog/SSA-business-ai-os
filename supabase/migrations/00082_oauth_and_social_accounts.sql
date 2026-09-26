-- ============================================================================
-- 00082 — Conexiones OAuth y cuentas sociales (Etapa 2, Bloque 2)
-- ============================================================================
-- Dos tablas nuevas y un cron.
--
--  1. oauth_connections: una fila por proveedor conectado (Google, LinkedIn,
--     Threads). Guarda QUE se conecto y en que estado esta, nunca el token: los
--     tokens viven en Vault, y aca queda solo el prefijo con el que se arma su
--     nombre (`vault_secret_prefix`).
--
--     No hay tabla de `oauth_states`: el `state` del flujo es un token firmado
--     con vencimiento (F9), asi que no hay nada que guardar ni que purgar.
--
--  2. social_accounts: una cuenta por red (Instagram, TikTok, YouTube,
--     LinkedIn, Threads), con los datos del perfil que se muestran en la
--     pagina Social y `publishers jsonb` con por donde se puede publicar en
--     esa red y si esta disponible. Es un jsonb y no una tabla: son dos o tres
--     filas por cuenta, siempre se leen juntas y se reescriben enteras.
--
--  3. Cron semanal social-token-refresh: renueva los tokens largos antes de
--     que venzan (Threads vence a los 60 dias).
--
-- Todo por workspace y con RLS. Las dos tablas las escribe solo el servidor:
-- conectar una cuenta pasa siempre por una Server Action o una ruta OAuth, que
-- ya verifican el rol.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. oauth_connections
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.oauth_connections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider             text NOT NULL,
  -- NULL = la conexion es del workspace (asi son todas en esta etapa).
  -- Con valor = es de una persona. Lo necesita Google Calendar en la etapa 4,
  -- donde cada uno conecta su propia agenda.
  user_id              uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  external_account_id  text,
  account_label        text,
  granted_scopes       text[] NOT NULL DEFAULT '{}',
  token_expires_at     timestamptz,
  refresh_expires_at   timestamptz,
  status               text NOT NULL DEFAULT 'active',
  last_error           text,
  last_refreshed_at    timestamptz,
  vault_secret_prefix  text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.oauth_connections IS
  'Una fila por proveedor OAuth conectado. Los tokens NO estan aca: viven en Vault, con el nombre que arma vault_secret_prefix.';
COMMENT ON COLUMN public.oauth_connections.user_id IS
  'NULL = la conexion es del workspace. Con valor = de esa persona (Google Calendar, etapa 4). El unico por workspace+proveedor lo contempla.';
COMMENT ON COLUMN public.oauth_connections.granted_scopes IS
  'Los permisos que el proveedor otorgo DE VERDAD, no los que se pidieron. Un permiso que la persona destildo se ve aca.';
COMMENT ON COLUMN public.oauth_connections.status IS
  'active: anda. attention: hay algo que resolver (vence pronto, falta un permiso). revoked: el proveedor corto el acceso. error: la ultima operacion fallo.';
COMMENT ON COLUMN public.oauth_connections.vault_secret_prefix IS
  'Prefijo del nombre de sus secretos en Vault: <prefijo>_access_token y <prefijo>_refresh_token.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_connections_provider_check') THEN
    ALTER TABLE public.oauth_connections ADD CONSTRAINT oauth_connections_provider_check
      CHECK (provider IN ('google', 'linkedin', 'threads'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_connections_status_check') THEN
    ALTER TABLE public.oauth_connections ADD CONSTRAINT oauth_connections_status_check
      CHECK (status IN ('active', 'attention', 'revoked', 'error'));
  END IF;
END $$;

-- Una conexion por proveedor y por persona. Un indice de expresion y no un
-- UNIQUE comun porque en SQL dos NULL no chocan entre si: sin el coalesce se
-- podrian crear dos conexiones del workspace para el mismo proveedor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_connections_ws_provider_user
  ON public.oauth_connections (
    workspace_id,
    provider,
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- El cron de renovacion busca lo que vence pronto.
CREATE INDEX IF NOT EXISTS idx_oauth_connections_expiring
  ON public.oauth_connections (token_expires_at)
  WHERE status IN ('active', 'attention');

DROP TRIGGER IF EXISTS set_updated_at ON public.oauth_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.oauth_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.oauth_connections ENABLE ROW LEVEL SECURITY;

-- Solo Owner/Admin la leen: dice con que cuenta esta conectado el negocio y
-- que permisos dio. Escribir es solo del servidor (service role): conectar
-- pasa por la ruta de OAuth, que verifica el rol antes de empezar.
DROP POLICY IF EXISTS "oauth_connections_select" ON public.oauth_connections;
CREATE POLICY "oauth_connections_select" ON public.oauth_connections
  FOR SELECT USING (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 2. social_accounts
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform          text NOT NULL,
  handle            text,
  username          text,
  display_name      text,
  avatar_url        text,
  bio               text,
  profile_url       text,
  website           text,
  external_id       text,
  -- Instagram entra por Zernio y ademas tiene bandeja: es la misma cuenta.
  channel_id        uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  default_publisher text,
  publishers        jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active         boolean NOT NULL DEFAULT true,
  profile_synced_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_accounts IS
  'Una cuenta por red social del workspace: por donde se publica y que se muestra en la pagina Social.';
COMMENT ON COLUMN public.social_accounts.publishers IS
  'Por donde se puede publicar en esta red: [{ publisher, account_ref, status, status_reason, verified_at, manually_enabled }]. Se valida con Zod al escribir.';
COMMENT ON COLUMN public.social_accounts.default_publisher IS
  'Cual se usa si no se elige otro. Si deja de estar disponible, el sistema pasa al siguiente y avisa.';
COMMENT ON COLUMN public.social_accounts.channel_id IS
  'El canal de la bandeja, cuando la misma cuenta ademas conversa (Instagram por Zernio).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_platform_check') THEN
    ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_platform_check
      CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'linkedin', 'threads'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_publishers_array') THEN
    ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_publishers_array
      CHECK (jsonb_typeof(publishers) = 'array');
  END IF;
END $$;

-- Una cuenta por red en esta etapa (varias cuentas de la misma red estan fuera
-- de alcance, §17).
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_accounts_ws_platform
  ON public.social_accounts (workspace_id, platform);

CREATE INDEX IF NOT EXISTS idx_social_accounts_ws_active
  ON public.social_accounts (workspace_id, is_active);

DROP TRIGGER IF EXISTS set_updated_at ON public.social_accounts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;

-- La leen todos los miembros: el editor de contenido necesita saber a que
-- redes se puede publicar. No hay nada sensible (usuario, foto, bio).
DROP POLICY IF EXISTS "social_accounts_select" ON public.social_accounts;
CREATE POLICY "social_accounts_select" ON public.social_accounts
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- Escribir es de Owner/Admin: cambia por donde publica todo el negocio.
DROP POLICY IF EXISTS "social_accounts_insert" ON public.social_accounts;
CREATE POLICY "social_accounts_insert" ON public.social_accounts
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "social_accounts_update" ON public.social_accounts;
CREATE POLICY "social_accounts_update" ON public.social_accounts
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "social_accounts_delete" ON public.social_accounts;
CREATE POLICY "social_accounts_delete" ON public.social_accounts
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 3. Cron semanal de renovacion de tokens
-- ------------------------------------------------------------
-- Cada cron nuevo redefine call_app_cron con la lista blanca ampliada: la
-- funcion solo acepta rutas de esa lista, para no ser un trampolin hacia
-- cualquier URL de la app con el secreto adjunto.

-- Se copia la definicion vigente (00080) tal cual y solo se suma la ruta: la
-- firma, el tipo de retorno y el comportamiento tienen que quedar iguales.
-- Cambiar el tipo de retorno directamente no se puede (hay que DROP primero),
-- y cambiar el aviso por una excepcion haria fallar todos los crons el dia que
-- falte una fila de configuracion.
CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_base text; v_secret text;
BEGIN
  IF p_path NOT IN (
    'jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events',
    'agent-bursts', 'drafts-refresh', 'bg-dispatch', 'bg-collect',
    'social-token-refresh'
  ) THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;
  SELECT value INTO v_base FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';
  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;
  RETURN net.http_get(
    url => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds => 60000
  );
END; $function$;

-- Lunes a las 4:40 UTC. Los tokens largos duran 60 dias y se renuevan cuando
-- quedan menos de 15: una vez por semana alcanza de sobra.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-social-token-refresh') THEN
    PERFORM cron.unschedule('ssa-cron-social-token-refresh');
  END IF;
  PERFORM cron.schedule(
    'ssa-cron-social-token-refresh',
    '40 4 * * 1',
    $cron$SELECT private.call_app_cron('social-token-refresh')$cron$
  );
END $$;
