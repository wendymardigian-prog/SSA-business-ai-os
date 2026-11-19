-- 00443 · Conocimiento: carpetas, enlaces, acceso del agente por documento o carpeta, la página de cada trozo del PDF
-- y «Citar la fuente» (traído de RER: 00412 y 00414).
--
-- Aditiva e idempotente. Nada se borra ni cambia de tipo. Va ANTES de desplegar el código: la búsqueda del agente
-- pasa a `match_knowledge_chunks_scoped` y la pantalla de Conocimiento lee las columnas nuevas.
--
-- 1. `knowledge_folders`: carpetas de la base (una sola altura). RLS activa:
--    leer, quien puede leer la base; escribir, solo el servidor.
--    Borrado blando (`deleted_at`).
-- 2. `knowledge_base.folder_id`, `source_kind` ('file' | 'link' | 'text') y
--    `source_url`: un enlace es un documento más, con su dirección.
-- 3. `agents.knowledge_document_ids` y `knowledge_folder_ids`: a qué documentos
--    y carpetas llega cada agente. Con las etiquetas que ya existían: si las tres
--    listas están vacías, el agente llega a todo; si alguna tiene algo, solo a lo
--    que coincida con alguna.
-- 4. `match_knowledge_chunks_scoped`: la búsqueda del agente con ese alcance y
--    solo sobre documentos `ready` (un documento que se está
--    reindexando o que falló nunca se cita: reemplazar un documento no deja trozos viejos a la vista). La función
--    anterior (`match_knowledge_chunks_filtered`) queda igual para quien la use.
-- 5. `knowledge_chunks.page`: la página del PDF donde empieza cada trozo (sale de las marcas `<!-- pagina N -->` de
--    la extracción). Un texto, un Word o un enlace no tienen páginas: NULL («sin dato», nunca 0). Los trozos que ya
--    existían quedan en NULL hasta que se reindexe el documento.
-- 6. `agents.cite_sources` (APAGADO de serie, decisión de producto del 18/11/2026): si está prendido y el agente usó
--    Conocimiento, la respuesta cierra con «Fuente: «Documento», pág. N». Apagado, el lead no ve nada nuevo.
--
-- Para volver atrás:
--   ALTER TABLE public.agents DROP COLUMN IF EXISTS cite_sources, DROP COLUMN IF EXISTS knowledge_document_ids,
--     DROP COLUMN IF EXISTS knowledge_folder_ids;
--   ALTER TABLE public.knowledge_chunks DROP COLUMN IF EXISTS page;
--   DROP FUNCTION IF EXISTS public.match_knowledge_chunks_scoped(uuid, extensions.vector, integer, double precision, text[], uuid[], uuid[], boolean);
--   ALTER TABLE public.knowledge_base DROP COLUMN IF EXISTS folder_id, DROP COLUMN IF EXISTS source_kind,
--     DROP COLUMN IF EXISTS source_url;
--   DROP TABLE IF EXISTS public.knowledge_folders;

-- 1. Carpetas ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.knowledge_folders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.knowledge_folders'::regclass AND conname = 'knowledge_folders_name_check') THEN
    ALTER TABLE public.knowledge_folders ADD CONSTRAINT knowledge_folders_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 80);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_folders_name
  ON public.knowledge_folders (workspace_id, lower(btrim(name)))
  WHERE deleted_at IS NULL;

ALTER TABLE public.knowledge_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_folders_select ON public.knowledge_folders;
CREATE POLICY knowledge_folders_select ON public.knowledge_folders
  FOR SELECT TO authenticated
  USING (public.can_read_knowledge(workspace_id, false));
-- Sin políticas de INSERT, UPDATE ni DELETE: solo escribe el servidor.

REVOKE ALL ON public.knowledge_folders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.knowledge_folders TO authenticated;
GRANT ALL ON public.knowledge_folders TO service_role;

DROP TRIGGER IF EXISTS knowledge_folders_updated_at ON public.knowledge_folders;
CREATE TRIGGER knowledge_folders_updated_at
  BEFORE UPDATE ON public.knowledge_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. Documentos: carpeta, tipo de fuente y enlace -----------------------------

ALTER TABLE public.knowledge_base ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.knowledge_folders(id) ON DELETE SET NULL;
ALTER TABLE public.knowledge_base ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'file';
ALTER TABLE public.knowledge_base ADD COLUMN IF NOT EXISTS source_url text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.knowledge_base'::regclass AND conname = 'knowledge_base_source_kind_check') THEN
    ALTER TABLE public.knowledge_base ADD CONSTRAINT knowledge_base_source_kind_check
      CHECK (source_kind IN ('file', 'link', 'text'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.knowledge_base'::regclass AND conname = 'knowledge_base_link_url_check') THEN
    ALTER TABLE public.knowledge_base ADD CONSTRAINT knowledge_base_link_url_check
      CHECK (source_kind <> 'link' OR (source_url IS NOT NULL AND source_url ~* '^https?://' AND char_length(source_url) <= 2000));
  END IF;
END $$;

-- Lo que ya existía sin archivo (transcripciones de llamadas y de programas) es texto.
UPDATE public.knowledge_base
   SET source_kind = 'text'
 WHERE source_kind = 'file' AND source_file_path IS NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_base_folder
  ON public.knowledge_base (folder_id) WHERE folder_id IS NOT NULL AND deleted_at IS NULL;

-- 3. Alcance de cada agente ----------------------------------------------------

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS knowledge_document_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS knowledge_folder_ids uuid[] NOT NULL DEFAULT '{}';

-- La pantalla del agente las lee con el cliente de la persona (00060).
GRANT SELECT (knowledge_document_ids, knowledge_folder_ids) ON public.agents TO authenticated;

COMMENT ON COLUMN public.agents.knowledge_document_ids IS
  'Documentos a los que llega el agente. Vacío con carpetas y etiquetas vacías = toda la base.';
COMMENT ON COLUMN public.agents.knowledge_folder_ids IS
  'Carpetas a las que llega el agente (todos sus documentos, también los que se sumen después).';

-- 4. Búsqueda con alcance y solo sobre lo listo --------------------------------

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks_scoped(
  p_workspace_id uuid,
  p_query_embedding extensions.vector,
  p_match_count integer,
  p_min_similarity double precision,
  p_tags text[],
  p_document_ids uuid[],
  p_folder_ids uuid[],
  p_include_internal boolean
)
RETURNS TABLE(chunk_id uuid, document_id uuid, document_title text, chunk_index integer, content text, similarity double precision)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_all boolean := COALESCE(cardinality(p_tags), 0) = 0
                   AND COALESCE(cardinality(p_document_ids), 0) = 0
                   AND COALESCE(cardinality(p_folder_ids), 0) = 0;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;

  IF NOT v_service AND NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this workspace';
  END IF;

  IF COALESCE(p_include_internal, false) AND NOT v_service THEN
    RAISE EXCEPTION 'forbidden: p_include_internal is only for the server';
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
  LEFT JOIN public.knowledge_folders kf ON kf.id = kb.folder_id AND kf.deleted_at IS NULL
  WHERE kc.workspace_id = p_workspace_id
    AND kb.deleted_at IS NULL
    -- Lo que se está reindexando, lo pendiente o lo que falló no se cita.
    AND kb.status = 'ready'
    AND (COALESCE(p_include_internal, false) OR kb.internal_only = false)
    AND (v_service OR public.can_read_knowledge(p_workspace_id, kb.internal_only))
    AND (
      v_all
      OR (COALESCE(cardinality(p_tags), 0) > 0 AND kb.tags && p_tags)
      OR (COALESCE(cardinality(p_document_ids), 0) > 0 AND kb.id = ANY (p_document_ids))
      OR (COALESCE(cardinality(p_folder_ids), 0) > 0 AND kf.id = ANY (p_folder_ids))
    )
    AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= COALESCE(p_min_similarity, 0)
  ORDER BY kc.embedding OPERATOR(extensions.<=>) p_query_embedding
  LIMIT GREATEST(COALESCE(p_match_count, 8), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.match_knowledge_chunks_scoped(uuid, extensions.vector, integer, double precision, text[], uuid[], uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks_scoped(uuid, extensions.vector, integer, double precision, text[], uuid[], uuid[], boolean) TO authenticated, service_role;

-- 5. La página de cada trozo -----------------------------------------------------

ALTER TABLE public.knowledge_chunks ADD COLUMN IF NOT EXISTS page integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_chunks_page_check') THEN
    ALTER TABLE public.knowledge_chunks ADD CONSTRAINT knowledge_chunks_page_check CHECK (page IS NULL OR page > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.knowledge_chunks.page IS
  'Página del PDF donde empieza el trozo. NULL si el documento no tiene páginas o se indexó antes de la 00443.';

-- 6. Citar la fuente -----------------------------------------------------------

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS cite_sources boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.agents.cite_sources IS
  'Si el agente usó Conocimiento, la respuesta cierra con «Fuente: «Documento», pág. N». Apagado de serie.';

GRANT SELECT (cite_sources) ON public.agents TO authenticated;
