-- ============================================================================
-- 00050 — Bucket privado para los documentos de la base de conocimiento (F16)
-- ============================================================================
-- Primer bucket del proyecto. Los documentos de la KB pueden tener info
-- sensible del negocio (precios, procesos, contratos), asi que el bucket es
-- privado y se baja siempre por signed URL de vida corta.
--
-- SIN POLICIES sobre storage.objects, a proposito. Es el mismo criterio
-- deny-all que scheduled_jobs: nadie toca el bucket directo. Subir, bajar y
-- borrar pasa por Server Actions que verifican Owner/Admin y despues usan el
-- service role. Una policy sobre storage.objects que dejara entrar a
-- 'authenticated' abriria el bucket a cualquier miembro con la anon key en la
-- mano, salteando esa verificacion.
--
-- El limite de tamano y la lista de MIME que van aca son la ultima linea, no la
-- primera: la validacion de verdad (tipo real por magic bytes, no por
-- extension) corre en el servidor antes de subir. Esto atrapa lo que se le
-- escape a esa validacion.
--
-- Idempotente.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'knowledge',
  'knowledge',
  false,
  26214400,  -- 25 MB
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Si el bucket ya existia (creado a mano desde el panel, por ejemplo), se
-- fuerzan las tres cosas que no son negociables. Sin esto, una migracion que
-- "corrio bien" podria estar dejando un bucket publico.
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
WHERE id = 'knowledge';

-- Por si una version anterior de esta migracion, o alguien a mano, dejo
-- policies abiertas sobre el bucket.
DROP POLICY IF EXISTS "knowledge_objects_select" ON storage.objects;
DROP POLICY IF EXISTS "knowledge_objects_insert" ON storage.objects;
DROP POLICY IF EXISTS "knowledge_objects_update" ON storage.objects;
DROP POLICY IF EXISTS "knowledge_objects_delete" ON storage.objects;
