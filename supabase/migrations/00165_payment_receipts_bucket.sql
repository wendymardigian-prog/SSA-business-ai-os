-- ============================================================================
-- 00165 — Ventas (B4, F27): bucket privado para los comprobantes de pago
-- ============================================================================
-- Un bucket PRIVADO y SIN policies para clientes:
--
--   payment-receipts   {workspace_id}/{sale_id}/{payment_id}/{uuid}.{ext}
--
-- Tipos: JPEG, PNG, WebP y PDF. Tope: 10 MB. Sube y firma SOLO el servidor (service
-- role) DESPUES de comprobar la venta con la sesion de quien pide (`can_see_sale`):
-- la lectura es un link firmado de 60 segundos. Que sea privado es una condicion de
-- seguridad: si ya existia (creado a mano), se le fuerza.
--
-- El primer segmento del path es el workspace, como en `chat-media` y `contracts`.
-- Aditiva e idempotente.
--
-- Como volver atras (solo si esta vacio):
--   select count(*) from storage.objects where bucket_id = 'payment-receipts';  -- 0
--   DELETE FROM storage.buckets WHERE id = 'payment-receipts';
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-receipts',
  'payment-receipts',
  false,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
