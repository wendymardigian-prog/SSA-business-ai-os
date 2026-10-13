-- ============================================================================
-- 00186 — Webhooks entrantes: `webhook_endpoints` e `inbound_webhooks`  (M1 del Extra L)
-- ============================================================================
-- Un endpoint = una URL (`/api/hooks/{token}`) que recibe JSON o form-urlencoded. Cada
-- envio se guarda ANTES de procesarse (`inbound_webhooks`), se responde 200 y despues corren
-- los flujos que lo escuchan. Detalle en docs/webhooks.md.
--
-- - `webhook_endpoints.token` (22 caracteres URL-safe) es una credencial: se guarda en la
--   fila, pero `authenticated` NO puede leerla (privilegio por columna, mismo patron que los
--   costos de `agents` en la 00060 y `pending_edit` en la 00180). El token lo ve solo quien
--   puede editar webhooks, desde el servidor, despues de chequear el permiso en TypeScript.
-- - El secreto opcional del header NO vive en una columna: esta en Vault y aca solo queda su
--   nombre (`secret_vault_name`).
-- - Escribe solo el servidor (Server Actions y el receptor, con el cliente de servicio). Ni
--   `webhook_endpoints` ni `inbound_webhooks` tienen policies de INSERT, UPDATE ni DELETE.
-- - RLS de lectura con `has_permission` (Owner/Admin y roles personalizados con la clave). OJO:
--   `has_permission` devuelve false para el rol de sistema "Member" (sus claves viven en
--   lib/auth/permissions.ts), asi que la RLS es una SEGUNDA barrera mas estricta; las pantallas
--   leen con el cliente de servicio DESPUES de `getPermissionAction("flows.edit")`.
-- - `inbound_webhooks.payload` se vacia a los 90 dias y la fila se borra a los 12 meses (cron
--   diario, service role). El ejemplo del endpoint (`sample_payload`) no se vacia.
--
-- Como volver atras (nada depende de estas tablas todavia; M2 agrega una FK desde flow_sessions,
-- hay que deshacer M2 antes):
--   DROP TABLE IF EXISTS public.inbound_webhooks;
--   DROP TABLE IF EXISTS public.webhook_endpoints;
-- Riesgo: bajo (aditiva). El codigo viejo no la usa.
-- ============================================================================

SET search_path = '';

-- ------------------------------------------------------------
-- webhook_endpoints
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  -- 22 caracteres URL-safe (16 bytes aleatorios en base64url). Credencial: no se expone.
  token text NOT NULL CHECK (token ~ '^[A-Za-z0-9_-]{22}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  -- Reservado: 'hmac' llega con Ventas Fase 2 (Whop).
  auth_mode text NOT NULL DEFAULT 'token' CHECK (auth_mode IN ('token')),
  -- El nombre del secreto en Vault para el header `x-webhook-secret` (opcional).
  secret_vault_name text,
  -- Ruta del id unico del envio dentro del payload (idempotencia), ej. `event_id`.
  event_id_path text CHECK (event_id_path IS NULL OR char_length(event_id_path) <= 200),
  -- Modo "escuchar el proximo envio": vence a los 15 minutos.
  listen_until timestamptz,
  -- { payload, query, captured_at }: el ejemplo para armar el mapeo. No se vacia.
  sample_payload jsonb,
  -- Reservado (Ventas Fase 2): el manejador por proveedor.
  handler_key text,
  last_received_at timestamptz,
  -- El ultimo aviso de errores (una vez por hora por endpoint).
  last_error_alert_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE public.webhook_endpoints IS
  'Endpoints de webhooks entrantes (Extra L). Escribe solo el servidor; el token no se expone a authenticated.';

-- El token es la clave de busqueda del receptor: unico en todo el sistema.
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_endpoints_token
  ON public.webhook_endpoints (token);
-- El nombre es unico por workspace entre los no borrados.
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_endpoints_ws_name
  ON public.webhook_endpoints (workspace_id, lower(btrim(name)))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_ws
  ON public.webhook_endpoints (workspace_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.webhook_endpoints;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- inbound_webhooks
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inbound_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Copiado del endpoint: el workspace sale SIEMPRE del endpoint, nunca del payload.
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'error', 'ignored', 'captured', 'paused')),
  -- Se vacia a los 90 dias (retencion): null = ya vaciado.
  payload jsonb,
  query jsonb,
  content_type text,
  size_bytes integer CHECK (size_bytes IS NULL OR size_bytes >= 0),
  -- IPv4 /24, IPv6 /48: nunca la IP exacta.
  ip_prefix text,
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  external_event_id text,
  body_hash text,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- { flows: { <flow_id>: {...} }, summary }
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  reprocess_count integer NOT NULL DEFAULT 0 CHECK (reprocess_count >= 0),
  -- Cuando paso a 'processing': el reaper rescata los que quedaron colgados.
  processing_started_at timestamptz,
  processed_at timestamptz
);

COMMENT ON TABLE public.inbound_webhooks IS
  'Cada envio recibido por un endpoint, guardado antes de procesarse. Escribe solo el servidor; nadie borra (lo vacia el cron).';

-- Idempotencia: el mismo id de envio en el mismo endpoint se guarda una sola vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_webhooks_event
  ON public.inbound_webhooks (endpoint_id, external_event_id)
  WHERE external_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_webhooks_endpoint_received
  ON public.inbound_webhooks (endpoint_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_webhooks_body_hash
  ON public.inbound_webhooks (endpoint_id, body_hash, received_at)
  WHERE body_hash IS NOT NULL;
-- El reaper busca los 'received' (y los 'processing' colgados).
CREATE INDEX IF NOT EXISTS idx_inbound_webhooks_pending
  ON public.inbound_webhooks (received_at)
  WHERE status IN ('received', 'processing');
-- La retencion barre por fecha.
CREATE INDEX IF NOT EXISTS idx_inbound_webhooks_received
  ON public.inbound_webhooks (received_at);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_webhooks ENABLE ROW LEVEL SECURITY;

-- Endpoints: los ve quien edita flujos o administra integraciones.
DROP POLICY IF EXISTS webhook_endpoints_select ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_select ON public.webhook_endpoints
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND (
      public.has_permission(workspace_id, 'flows.edit')
      OR public.has_permission(workspace_id, 'integrations.manage')
    )
  );

-- Envios (con el payload, que tiene datos personales): solo quien edita flujos.
DROP POLICY IF EXISTS inbound_webhooks_select ON public.inbound_webhooks;
CREATE POLICY inbound_webhooks_select ON public.inbound_webhooks
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND public.has_permission(workspace_id, 'flows.edit')
  );

-- Sin policies de INSERT, UPDATE ni DELETE: escribe el servidor. Y sin grants de escritura.
REVOKE ALL ON public.webhook_endpoints FROM anon;
REVOKE ALL ON public.webhook_endpoints FROM authenticated;
-- Todas las columnas MENOS `token` (y `secret_vault_name`, que no se necesita en el navegador).
GRANT SELECT (
  id, workspace_id, name, description, status, auth_mode, event_id_path, listen_until,
  sample_payload, handler_key, last_received_at, last_error_alert_at, created_by,
  created_at, updated_at, deleted_at
) ON public.webhook_endpoints TO authenticated;
GRANT ALL ON public.webhook_endpoints TO service_role;

REVOKE ALL ON public.inbound_webhooks FROM anon;
REVOKE ALL ON public.inbound_webhooks FROM authenticated;
GRANT SELECT ON public.inbound_webhooks TO authenticated;
GRANT ALL ON public.inbound_webhooks TO service_role;
