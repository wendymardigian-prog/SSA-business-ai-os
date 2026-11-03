-- ============================================================================
-- 00279 — Resend en una sola tarjeta: "ultimo aviso" y la recepcion pasa a la
--         configuracion de Resend
-- ============================================================================
-- Conexion de Resend en un clic (rama feat/resend-conexion, 2/11/2026).
--
-- Hasta aca Resend eran dos tarjetas: "Resend" (API key + remitentes) y "Resend
-- (email entrante)" (`provider = 'resend_inbound'`: el secreto del webhook y una
-- direccion fija). Ahora es una sola: la recepcion, el webhook y su estado viven
-- en el `config` de la fila `resend`. Esta migracion hace dos cosas, las dos
-- aditivas:
--
-- 1. `integration_configs.last_event_at`: cuando llego el ultimo aviso valido
--    (firma verificada) del proveedor. Lo escribe el receptor de Resend con el
--    cliente de servicio, a lo sumo una vez por minuto, y lo lee la tarjeta
--    ("ultimo aviso recibido hace X"). `webhook_events` no sirve para eso: no
--    tiene workspace y se purga a las 48 h. La tabla no tiene GRANT por columna:
--    la columna nueva hereda el acceso de la tabla y las politicas de la 00213.
--
-- 2. Copia de datos para las instalaciones que YA usaban `resend_inbound` (es una
--    plantilla que se copia a clientes): su direccion pasa a la fila `resend` del
--    mismo negocio como `receiving_enabled = 'true'`, `receiving_local` (lo de
--    antes del @) y `receiving_domain` (lo de despues), mas `daily_quota` si lo
--    tenia. Si el negocio no tiene fila `resend`, se crea INACTIVA solo con eso
--    (sin API key no manda nada; la tarjeta pide la key). Nunca pisa una clave que
--    ya exista en el `config` de `resend` (lo existente gana) y no borra ni
--    desactiva la fila `resend_inbound`. El secreto del webhook no se mueve: en
--    Vault sigue llamandose `resend_inbound_webhook_secret` y la tarjeta nueva lo
--    lee con ese nombre. El canal de email no se toca: su direccion ya es la
--    principal.
--
--    En produccion (2/11/2026) no hay ninguna fila `resend_inbound`: la copia no
--    hace nada.
--
-- Idempotente: la columna con IF NOT EXISTS; la copia solo escribe donde la fila
-- `resend` todavia no tiene las tres claves de la recepcion.
--
-- Como volver atras:
--   ALTER TABLE public.integration_configs DROP COLUMN IF EXISTS last_event_at;
--   UPDATE public.integration_configs
--      SET config = config - 'receiving_enabled' - 'receiving_local' - 'receiving_domain'
--    WHERE type = 'email_provider' AND provider = 'resend'
--      AND workspace_id IN (SELECT workspace_id FROM public.integration_configs
--                            WHERE type = 'email_provider' AND provider = 'resend_inbound');
--   -- (y borrar las filas `resend` inactivas que esta migracion haya creado, si las hubo:
--   --  las que tienen `vault_secret_name = 'resend_api_key'`, `is_active = false` y solo esas claves).
-- ============================================================================

ALTER TABLE public.integration_configs
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

COMMENT ON COLUMN public.integration_configs.last_event_at IS
  'Ultimo aviso valido (firma verificada) recibido del proveedor. Lo escribe el receptor del webhook (Resend: a lo sumo una vez por minuto).';

WITH inbound AS (
  SELECT
    workspace_id,
    lower(btrim(config->>'inbound_address')) AS address,
    config->'daily_quota' AS daily_quota
  FROM public.integration_configs
  WHERE type = 'email_provider'
    AND provider = 'resend_inbound'
    AND lower(btrim(coalesce(config->>'inbound_address', ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
),
payload AS (
  SELECT
    workspace_id,
    jsonb_strip_nulls(jsonb_build_object(
      'receiving_enabled', 'true',
      'receiving_local',   split_part(address, '@', 1),
      'receiving_domain',  split_part(address, '@', 2),
      'daily_quota',       daily_quota
    )) AS extra
  FROM inbound
)
INSERT INTO public.integration_configs (workspace_id, type, provider, display_name, vault_secret_name, config, is_active)
SELECT workspace_id, 'email_provider', 'resend', 'Resend', 'resend_api_key', extra, false
FROM payload
ON CONFLICT (workspace_id, type, provider) DO UPDATE
  SET config = EXCLUDED.config || public.integration_configs.config
  WHERE NOT (public.integration_configs.config ?& ARRAY['receiving_enabled', 'receiving_local', 'receiving_domain']);
