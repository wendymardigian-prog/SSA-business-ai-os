-- ============================================================================
-- 00062 — Busqueda semantica con el filtro de acceso adentro de la consulta
-- ============================================================================
-- Fase 3, Bloque 2a (F27). El agente accede a la base de conocimiento solo por
-- los tags que tenga habilitados, y nunca a un documento marcado internal_only.
--
-- El filtro va DENTRO del SQL y no despues de traer los fragmentos. Si se
-- filtrara en el codigo que consume la busqueda, el contenido prohibido ya
-- habria viajado hasta el proceso de la app: un bug, un log de mas o un cambio
-- de orden y termina en el prompt. Con el filtro en el WHERE, esas filas no
-- salen de la base.
--
-- Es una funcion NUEVA y no un cambio a match_knowledge_chunks (00049), que
-- queda intacta: la usan scripts/verify-knowledge.mjs y verify-rls.mjs. Los dos
-- parametros nuevos van SIN default a proposito: con defaults, una llamada de
-- cuatro argumentos quedaria ambigua entre las dos firmas si alguna vez se
-- unificaran los nombres.
--
-- Semantica de p_tags:
--   - NULL o vacio: toda la base de conocimiento (salvo lo interno).
--   - Con valores: documentos que tengan AL MENOS UNO de esos tags.
-- p_include_internal existe para el agente de gestion de la Etapa 3 (que opera
-- para el dueno y si puede leer lo interno). El agente de leads siempre pasa
-- false. Un Member que llame la funcion con true no gana nada: ya puede leer
-- knowledge_chunks por RLS (00049).
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks_filtered(
  p_workspace_id     uuid,
  p_query_embedding  extensions.vector(1024),
  p_match_count      integer,
  p_min_similarity   double precision,
  p_tags             text[],
  p_include_internal boolean
)
RETURNS TABLE (
  chunk_id       uuid,
  document_id    uuid,
  document_title text,
  chunk_index    integer,
  content        text,
  similarity     double precision
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

  -- Mismo chequeo que match_knowledge_chunks (ver el comentario de la 00049
  -- sobre por que va el coalesce).
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
    AND (COALESCE(p_include_internal, false) OR kb.internal_only = false)
    AND (p_tags IS NULL OR cardinality(p_tags) = 0 OR kb.tags && p_tags)
    AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= COALESCE(p_min_similarity, 0)
  ORDER BY kc.embedding OPERATOR(extensions.<=>) p_query_embedding
  LIMIT GREATEST(COALESCE(p_match_count, 8), 1);
END;
$$;

COMMENT ON FUNCTION public.match_knowledge_chunks_filtered(uuid, extensions.vector, integer, double precision, text[], boolean) IS
  'Busqueda semantica con el filtro de acceso del agente adentro de la consulta: tags permitidos (vacio = todos) y exclusion de documentos internal_only. El contenido excluido nunca sale de la base.';

REVOKE ALL ON FUNCTION public.match_knowledge_chunks_filtered(uuid, extensions.vector, integer, double precision, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks_filtered(uuid, extensions.vector, integer, double precision, text[], boolean) TO authenticated, service_role;
