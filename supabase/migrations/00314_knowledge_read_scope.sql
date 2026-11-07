-- ============================================================================
-- 00314 — Conocimiento: quien lee la base y lo interno
-- ============================================================================
-- Seguridad (lote 3). `knowledge_base_select` y `knowledge_chunks_select` (00049) solo pedian ser
-- miembro del workspace: cualquier Member leia todos los documentos, tambien los `internal_only`
-- (que incluyen lo que sale de las llamadas de ventas, lib/calls/knowledge-run.ts), y se salteaba el
-- permiso `knowledge.view`. Ademas `match_knowledge_chunks_filtered` dejaba que cualquier miembro
-- pidiera `p_include_internal = true`, y `match_knowledge_chunks` devolvia lo interno sin filtro.
--
-- La regla nueva, en UNA funcion (`public.can_read_knowledge`):
--   - un documento interno: solo quien tiene `knowledge.edit` (Owner y Admin lo tienen siempre);
--   - uno que no es interno: `knowledge.view`, `knowledge.edit` o `agents.view`.
--
-- Por que `agents.view` tambien: el Member de sistema NO tiene `knowledge.view`
-- (`private.member_permission_keys()`, `MEMBER_PERMISSION_KEYS`), pero si `agents.view`, y hoy ve en
-- pantalla los titulos de los fragmentos que leyo el agente (Corridas, `lib/agent/runs-query.ts`) y
-- los documentos en la configuracion del agente (`/dashboard/agents/[agentId]`). Lo no interno es lo
-- que el agente ya le cuenta a los leads: quien puede ver al agente puede ver lo que lee. Asi a nadie
-- se le quita lo que usa en pantalla salvo lo interno. Las pantallas de Conocimiento siguen pidiendo
-- `knowledge.view` (requirePermission), como antes.
--
-- Las busquedas semanticas: `p_include_internal = true` solo para el servidor (service_role); con la
-- sesion de una persona se rechaza. Y con la sesion, las dos funciones devuelven solo lo que esa
-- persona puede leer. El agente y el copywriter leen con el cliente de servicio (el runner, el job
-- de copy) y no cambian: el agente nunca pide lo interno (`lib/agent/knowledge.ts`) y el copywriter
-- lo filtra en su consulta (`lib/agent/copywriter.ts`).
--
-- Aditiva e idempotente: puede ir antes o despues del deploy (el codigo no cambia por esto).
--
-- LO VIEJO, letra por letra (leido de la base el 7/11/2026), para volver atras:
--
--   DROP POLICY IF EXISTS "knowledge_base_select" ON public.knowledge_base;
--   CREATE POLICY "knowledge_base_select" ON public.knowledge_base
--     FOR SELECT USING (public.is_workspace_member(workspace_id));
--
--   DROP POLICY IF EXISTS "knowledge_chunks_select" ON public.knowledge_chunks;
--   CREATE POLICY "knowledge_chunks_select" ON public.knowledge_chunks
--     FOR SELECT USING (public.is_workspace_member(workspace_id));
--
--   CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(p_workspace_id uuid, p_query_embedding vector, p_match_count integer DEFAULT 8, p_min_similarity double precision DEFAULT 0.0)
--    RETURNS TABLE(chunk_id uuid, document_id uuid, document_title text, chunk_index integer, content text, similarity double precision)
--    LANGUAGE plpgsql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   BEGIN
--     IF p_workspace_id IS NULL THEN
--       RAISE EXCEPTION 'workspace_id is required';
--     END IF;
--
--     -- coalesce y no auth.role() pelado: una conexion sin JWT devuelve NULL, y
--     -- "NULL <> 'service_role' AND ..." evalua a NULL, con lo cual el IF no entra
--     -- y el chequeo de permiso se saltea solo.
--     IF COALESCE(auth.role(), '') <> 'service_role'
--        AND NOT public.is_workspace_member(p_workspace_id) THEN
--       RAISE EXCEPTION 'forbidden: not a member of this workspace';
--     END IF;
--
--     RETURN QUERY
--     SELECT
--       kc.id,
--       kc.document_id,
--       kb.title,
--       kc.chunk_index,
--       kc.content,
--       (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding))::double precision
--     FROM public.knowledge_chunks kc
--     JOIN public.knowledge_base kb ON kb.id = kc.document_id
--     WHERE kc.workspace_id = p_workspace_id
--       AND kb.deleted_at IS NULL
--       AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= p_min_similarity
--     ORDER BY kc.embedding OPERATOR(extensions.<=>) p_query_embedding
--     LIMIT GREATEST(p_match_count, 1);
--   END;
--   $function$
--
--   CREATE OR REPLACE FUNCTION public.match_knowledge_chunks_filtered(p_workspace_id uuid, p_query_embedding vector, p_match_count integer, p_min_similarity double precision, p_tags text[], p_include_internal boolean)
--    RETURNS TABLE(chunk_id uuid, document_id uuid, document_title text, chunk_index integer, content text, similarity double precision)
--    LANGUAGE plpgsql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   BEGIN
--     IF p_workspace_id IS NULL THEN
--       RAISE EXCEPTION 'workspace_id is required';
--     END IF;
--
--     IF COALESCE(auth.role(), '') <> 'service_role'
--        AND NOT public.is_workspace_member(p_workspace_id) THEN
--       RAISE EXCEPTION 'forbidden: not a member of this workspace';
--     END IF;
--
--     RETURN QUERY
--     SELECT
--       kc.id,
--       kc.document_id,
--       kb.title,
--       kc.chunk_index,
--       kc.content,
--       (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding))::double precision
--     FROM public.knowledge_chunks kc
--     JOIN public.knowledge_base kb ON kb.id = kc.document_id
--     WHERE kc.workspace_id = p_workspace_id
--       AND kb.deleted_at IS NULL
--       AND (COALESCE(p_include_internal, false) OR kb.internal_only = false)
--       AND (p_tags IS NULL OR cardinality(p_tags) = 0 OR kb.tags && p_tags)
--       AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= COALESCE(p_min_similarity, 0)
--     ORDER BY kc.embedding OPERATOR(extensions.<=>) p_query_embedding
--     LIMIT GREATEST(COALESCE(p_match_count, 8), 1);
--   END;
--   $function$
--
--   DROP FUNCTION IF EXISTS public.can_read_knowledge(uuid, boolean);
--
-- Como probarla (sesion de cada persona):
--   - un Member de sistema: en Corridas sigue viendo el titulo de lo que leyo el agente; no ve ningun
--     documento interno (ni en la configuracion del agente);
--   - un rol con `knowledge.view` y sin `knowledge.edit`: Conocimiento lista lo no interno;
--   - Owner/Admin: todo, como antes;
--   - `rpc('match_knowledge_chunks_filtered', { ..., p_include_internal: true })` con la sesion: error.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. La regla
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_read_knowledge(p_workspace_id uuid, p_internal_only boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN COALESCE(p_internal_only, false) THEN COALESCE(public.has_permission(p_workspace_id, 'knowledge.edit'), false)
    ELSE COALESCE(
      public.has_permission(p_workspace_id, 'knowledge.view')
        OR public.has_permission(p_workspace_id, 'knowledge.edit')
        OR public.has_permission(p_workspace_id, 'agents.view'),
      false
    )
  END;
$$;

COMMENT ON FUNCTION public.can_read_knowledge(uuid, boolean) IS
  'Quien lee un documento de Conocimiento (00314): uno interno, solo knowledge.edit (Owner/Admin siempre); uno que no es interno, knowledge.view, knowledge.edit o agents.view. Nunca NULL.';

REVOKE ALL ON FUNCTION public.can_read_knowledge(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_knowledge(uuid, boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Las politicas de lectura
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "knowledge_base_select" ON public.knowledge_base;
CREATE POLICY "knowledge_base_select" ON public.knowledge_base
  FOR SELECT TO authenticated
  USING (public.can_read_knowledge(workspace_id, internal_only));

DROP POLICY IF EXISTS "knowledge_chunks_select" ON public.knowledge_chunks;
CREATE POLICY "knowledge_chunks_select" ON public.knowledge_chunks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.knowledge_base kb
      WHERE kb.id = knowledge_chunks.document_id
        AND kb.workspace_id = knowledge_chunks.workspace_id
        AND public.can_read_knowledge(kb.workspace_id, kb.internal_only)
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Las busquedas semanticas
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(p_workspace_id uuid, p_query_embedding extensions.vector, p_match_count integer DEFAULT 8, p_min_similarity double precision DEFAULT 0.0)
RETURNS TABLE(chunk_id uuid, document_id uuid, document_title text, chunk_index integer, content text, similarity double precision)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- coalesce y no auth.role() pelado: una conexion sin JWT devuelve NULL, y
  -- "NULL <> 'service_role' AND ..." evalua a NULL, con lo cual el IF no entra
  -- y el chequeo de permiso se saltea solo.
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;

  IF NOT v_service AND NOT public.is_workspace_member(p_workspace_id) THEN
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
    -- Con la sesion de una persona, solo lo que esa persona puede leer (00314).
    AND (v_service OR public.can_read_knowledge(p_workspace_id, kb.internal_only))
    AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= p_min_similarity
  ORDER BY kc.embedding OPERATOR(extensions.<=>) p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.match_knowledge_chunks(uuid, extensions.vector, integer, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, extensions.vector, integer, double precision) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks_filtered(p_workspace_id uuid, p_query_embedding extensions.vector, p_match_count integer, p_min_similarity double precision, p_tags text[], p_include_internal boolean)
RETURNS TABLE(chunk_id uuid, document_id uuid, document_title text, chunk_index integer, content text, similarity double precision)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;

  IF NOT v_service AND NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this workspace';
  END IF;

  -- Lo interno (lo que sale de las llamadas, por ejemplo) solo lo pide el servidor.
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
  WHERE kc.workspace_id = p_workspace_id
    AND kb.deleted_at IS NULL
    AND (COALESCE(p_include_internal, false) OR kb.internal_only = false)
    -- Con la sesion de una persona, solo lo que esa persona puede leer (00314).
    AND (v_service OR public.can_read_knowledge(p_workspace_id, kb.internal_only))
    AND (p_tags IS NULL OR cardinality(p_tags) = 0 OR kb.tags && p_tags)
    AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= COALESCE(p_min_similarity, 0)
  ORDER BY kc.embedding OPERATOR(extensions.<=>) p_query_embedding
  LIMIT GREATEST(COALESCE(p_match_count, 8), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.match_knowledge_chunks_filtered(uuid, extensions.vector, integer, double precision, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks_filtered(uuid, extensions.vector, integer, double precision, text[], boolean) TO authenticated, service_role;
