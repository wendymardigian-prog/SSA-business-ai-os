-- ============================================================================
-- 00049 — Base de conocimiento con busqueda semantica (F16)
-- ============================================================================
-- Documentos del negocio (PDF/DOCX/TXT/MD) convertidos a markdown, troceados y
-- indexados con embeddings, para que el agente de la Fase 3 responda con
-- informacion real y no inventada.
--
-- Dos tablas y no una: el documento es lo que la usuaria ve y edita; el chunk
-- es una unidad de recuperacion que solo existe para la busqueda. Mezclarlos
-- obligaria a reescribir la fila del documento en cada reindexado.
--
-- workspace_id desnormalizado en knowledge_chunks: se deriva del documento,
-- pero tenerlo directo evita un JOIN en la busqueda semantica, que es lo unico
-- sensible a performance de todo esto, y hace la RLS de una sola condicion.
--
-- DIMENSION DEL EMBEDDING — leer antes de tocar:
-- La columna esta anclada a vector(1024) porque el modelo es Voyage AI
-- 'voyage-4-lite' con output_dimension 1024 (su default). voyage-4-lite tambien
-- soporta 256/512/2048, pero una columna vector(N) admite UN solo N: mezclar
-- embeddings de dimensiones distintas no funciona, y comparar embeddings de
-- modelos distintos aunque coincida la dimension da resultados sin sentido.
-- Si algun dia se cambia de modelo o de dimension hay que: cambiar el tipo de
-- la columna, recrear el indice, y REINDEXAR TODOS los documentos.
--
-- Indice HNSW y no IVFFlat: IVFFlat necesita datos para entrenar sus listas y
-- aca el indice se crea con la tabla vacia (quedaria mal calibrado para siempre
-- salvo que alguien se acuerde de recrearlo). HNSW se construye incremental.
-- Distancia coseno, que es la que recomienda Voyage para sus embeddings.
--
-- Idempotente.
-- ============================================================================

-- pgvector va al esquema 'extensions', que es donde Supabase pone las suyas
-- (pgcrypto, uuid-ossp, pg_stat_statements). public queda solo con lo nuestro.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 1. knowledge_base — el documento
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  -- Ruta dentro del bucket privado 'knowledge' (migracion 00050).
  source_file_path text,
  source_mime text,
  source_size_bytes bigint,
  source_filename text,
  content_md text,
  status text NOT NULL DEFAULT 'processing',
  error_detail text,
  chunk_count integer NOT NULL DEFAULT 0,
  -- Que modelo genero los embeddings de este documento. Si se cambia de modelo,
  -- esto dice cuales hay que reindexar.
  embedding_model text,
  indexed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_base_status_check'
  ) THEN
    ALTER TABLE public.knowledge_base
      ADD CONSTRAINT knowledge_base_status_check
      CHECK (status IN ('processing', 'ready', 'error'));
  END IF;
END $$;

COMMENT ON TABLE public.knowledge_base IS
  'Documentos de la base de conocimiento. El archivo original vive en el bucket privado "knowledge"; content_md es su conversion a markdown. Soft delete con deleted_at (retencion 30 dias, purga por el cron de Fase 1).';

COMMENT ON COLUMN public.knowledge_base.status IS
  'processing = el job async todavia corre; ready = indexado; error = fallo, el motivo esta en error_detail.';

COMMENT ON COLUMN public.knowledge_base.embedding_model IS
  'Modelo que genero los embeddings de este documento (ej: voyage-4-lite). Si se cambia de modelo, identifica que hay que reindexar.';

-- El listado de la pantalla: los del workspace, sin borrar, mas nuevos primero.
CREATE INDEX IF NOT EXISTS idx_knowledge_base_ws_created
  ON public.knowledge_base(workspace_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Lo que mira el cron de purga de soft-deleted.
CREATE INDEX IF NOT EXISTS idx_knowledge_base_deleted
  ON public.knowledge_base(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Filtro por etiqueta.
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tags
  ON public.knowledge_base USING gin(tags);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_knowledge_base') THEN
    CREATE TRIGGER set_updated_at_knowledge_base
      BEFORE UPDATE ON public.knowledge_base
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. knowledge_chunks — los fragmentos indexados
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.knowledge_base(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  -- Estimacion, no cuenta real: sirve para no pasarse del limite de tokens por
  -- request de Voyage al armar los lotes.
  token_estimate integer,
  embedding extensions.vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.knowledge_chunks IS
  'Fragmentos indexados de un documento. Se borran en cascada con su documento. Los escribe solo el service role, desde el job de indexacion.';

COMMENT ON COLUMN public.knowledge_chunks.embedding IS
  'Embedding de Voyage AI voyage-4-lite, 1024 dimensiones (su default). Ver la cabecera de esta migracion antes de cambiar la dimension: obliga a reindexar todo.';

COMMENT ON COLUMN public.knowledge_chunks.workspace_id IS
  'Desnormalizado del documento a proposito: evita un JOIN en la busqueda semantica y hace la RLS de una sola condicion.';

-- Un reindexado borra e inserta de nuevo; el unique atrapa un job duplicado que
-- intente escribir dos veces el mismo fragmento.
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_chunks_doc_index
  ON public.knowledge_chunks(document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_ws
  ON public.knowledge_chunks(workspace_id);

-- El indice de la busqueda semantica. La opclass va calificada con el esquema
-- para que resuelva sin depender del search_path con el que corra la migracion.
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON public.knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------
-- La KB no lleva scope de leads: es conocimiento del negocio, no de un lead.
-- Todo el equipo la lee; solo Owner/Admin la gestiona (F17).
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knowledge_base_select" ON public.knowledge_base;
CREATE POLICY "knowledge_base_select" ON public.knowledge_base
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "knowledge_base_insert" ON public.knowledge_base;
CREATE POLICY "knowledge_base_insert" ON public.knowledge_base
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "knowledge_base_update" ON public.knowledge_base;
CREATE POLICY "knowledge_base_update" ON public.knowledge_base
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- El borrado real lo hace el cron de purga (service role) 30 dias despues; esta
-- policy existe por si un admin necesita borrar de verdad.
DROP POLICY IF EXISTS "knowledge_base_delete" ON public.knowledge_base;
CREATE POLICY "knowledge_base_delete" ON public.knowledge_base
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knowledge_chunks_select" ON public.knowledge_chunks;
CREATE POLICY "knowledge_chunks_select" ON public.knowledge_chunks
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- Sin policies de INSERT/UPDATE/DELETE a proposito: los fragmentos los escribe
-- solo el job de indexacion, con el service role, y se borran en cascada con su
-- documento. Un usuario no tiene por que poder escribir un embedding a mano.
DROP POLICY IF EXISTS "knowledge_chunks_insert" ON public.knowledge_chunks;
DROP POLICY IF EXISTS "knowledge_chunks_update" ON public.knowledge_chunks;
DROP POLICY IF EXISTS "knowledge_chunks_delete" ON public.knowledge_chunks;

-- ----------------------------------------------------------------------------
-- 4. Busqueda semantica
-- ----------------------------------------------------------------------------
-- Es SECURITY DEFINER para poder ordenar por el indice HNSW sin que la RLS de
-- knowledge_chunks se meta en el plan, asi que la pertenencia al workspace se
-- chequea a mano adentro. Sin ese chequeo, cualquiera leeria la KB de cualquier
-- workspace pasando otro id.
--
-- El operador de distancia va calificado —OPERATOR(extensions.<=>)— porque con
-- search_path = '' no hay forma de resolverlo por nombre. Escrito asi el
-- planner igual lo reconoce y usa el indice HNSW.
--
-- 1 - distancia_coseno = similitud, para que el numero que vuelve se lea como
-- "cuanto se parece" (1 = identico) y no al reves.
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  p_workspace_id uuid,
  p_query_embedding extensions.vector(1024),
  p_match_count integer DEFAULT 8,
  p_min_similarity double precision DEFAULT 0.0
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  chunk_index integer,
  content text,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;

  -- coalesce y no auth.role() pelado: una conexion sin JWT devuelve NULL, y
  -- "NULL <> 'service_role' AND ..." evalua a NULL, con lo cual el IF no entra
  -- y el chequeo de permiso se saltea solo. Con coalesce, sin rol conocido se
  -- exige pertenencia al workspace, que es el lado seguro.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this workspace';
  END IF;

  RETURN QUERY
  SELECT
    kc.id,
    kc.document_id,
    kb.title,
    kc.chunk_index,
    kc.content,
    (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding))::double precision
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_base kb ON kb.id = kc.document_id
  WHERE kc.workspace_id = p_workspace_id
    AND kb.deleted_at IS NULL
    AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= p_min_similarity
  ORDER BY kc.embedding OPERATOR(extensions.<=>) p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
END;
$$;

COMMENT ON FUNCTION public.match_knowledge_chunks(uuid, extensions.vector, integer, double precision) IS
  'Busqueda semantica sobre la base de conocimiento. Recibe el embedding de la consulta (Voyage voyage-4-lite, 1024 dim, input_type=query) y devuelve los fragmentos mas parecidos. La consumira el agente en la Fase 3.';

REVOKE ALL ON FUNCTION public.match_knowledge_chunks(uuid, extensions.vector, integer, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, extensions.vector, integer, double precision) TO authenticated, service_role;
