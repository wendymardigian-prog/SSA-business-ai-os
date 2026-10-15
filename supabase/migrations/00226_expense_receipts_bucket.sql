-- ============================================================================
-- 00226 — Gastos (G1, GF8): bucket privado para los comprobantes
-- ============================================================================
-- Un bucket PRIVADO:
--
--   expense-receipts   {workspace_id}/{expense_id}/{uuid}.{ext}
--
-- Tipos: JPEG, PNG, WebP, HEIC y PDF. Tope: 10 MB. SUBE y FIRMA solo el servidor (service role) DESPUES de
-- comprobar el permiso con la sesion de quien pide; la lectura es un link firmado de 60 segundos. Como segunda
-- barrera hay una politica de SELECT por carpeta (el primer segmento del path es el workspace) que pide
-- `expenses.view`. Insertar, actualizar y borrar son del servidor: no hay politica para usuarios.
-- Reemplazar un comprobante NO borra el anterior.
--
-- Aditiva e idempotente. Que sea privado es una condicion de seguridad: si ya existia, se le fuerza.
--
-- Como volver atras (solo si esta vacio):
--   DROP POLICY IF EXISTS expense_receipts_select ON storage.objects;
--   select count(*) from storage.objects where bucket_id = 'expense-receipts';  -- 0
--   DELETE FROM storage.buckets WHERE id = 'expense-receipts';
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  false,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS expense_receipts_select ON storage.objects;
CREATE POLICY expense_receipts_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (select public.has_permission(((storage.foldername(name))[1])::uuid, 'expenses.view'))
  );
