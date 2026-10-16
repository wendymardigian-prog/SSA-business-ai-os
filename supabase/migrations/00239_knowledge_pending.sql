-- ============================================================
-- 00239 — Documentos "pendientes de indexar" (F1)
-- ============================================================
-- Subir un documento tiene que seguir siendo posible aunque Voyage AI (lo que
-- indexa la base de conocimiento) todavia no este conectado. Hasta ahora ese
-- documento terminaba en 'error' para siempre, con un boton "Reprocesar" que
-- tampoco servia hasta conectar Voyage, y nada lo retomaba solo al conectarlo.
--
-- Un estado nuevo, 'pending': el archivo y su texto estan guardados y solo falta
-- indexar. Se retoma solo cuando se conecta Voyage (o con "Indexar pendientes").
-- No es un error: no hay nada roto, falta una conexion.
--
-- Tambien pasa a 'pending' lo que HOY esta en 'error' por esa misma causa (se
-- reconoce por el texto del motivo): es lo mismo, solo estaba mal clasificado.
-- No se toca ningun otro error.
--
-- Estados: processing (el job corre) | pending (falta Voyage) | ready | error.
--
-- La restriccion vieja, para volver atras:
--   CHECK (status IN ('processing', 'ready', 'error'))
-- (antes de volver, pasar los 'pending' a 'error' o 'processing').

ALTER TABLE public.knowledge_base DROP CONSTRAINT IF EXISTS knowledge_base_status_check;
ALTER TABLE public.knowledge_base
  ADD CONSTRAINT knowledge_base_status_check
  CHECK (status IN ('processing', 'ready', 'error', 'pending'));

UPDATE public.knowledge_base
SET status = 'pending', error_detail = NULL
WHERE status = 'error'
  AND deleted_at IS NULL
  AND source_file_path IS NOT NULL
  AND error_detail ILIKE 'Voyage AI no esta conectado%';

COMMENT ON COLUMN public.knowledge_base.status IS
  'processing = el job async todavia corre; pending = guardado, falta conectar Voyage para indexarlo (se retoma solo al conectarlo); ready = indexado; error = fallo, el motivo esta en error_detail.';
