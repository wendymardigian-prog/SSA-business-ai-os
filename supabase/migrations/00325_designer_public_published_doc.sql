-- 00325_designer_public_published_doc
--
-- Diseñador IA (auditoría de la Ola 2): el link público de una página WEB mostraba el documento que se está editando.
-- Con eso, guardar un cambio (`designer.edit`, que tiene un Member) cambiaba lo que ve el público sin pasar por
-- «Publicar» (`designer.publish`, que el Member no tiene). Ahora `design_public_get` devuelve el documento de la última
-- versión `publish` (la guarda `publishDesign`; la limpieza diaria nunca la borra, F48b) y, si no hubiera ninguna, el
-- vigente. Lo mismo para `page_count`. Las piezas que no son web ya mostraban los archivos del último render de
-- publicar. Misma firma, mismos permisos (`anon` la puede ejecutar a propósito: el link es público).
--
-- Huella antes de esta migración: md5(pg_get_functiondef) = 946a7bca14473cfd8592737eb3c59570.
--
-- Cómo volver atrás: volver a correr el bloque `CREATE OR REPLACE FUNCTION public.design_public_get` de la 00320
-- (definición completa abajo, comentada).
--
-- Definición anterior (00320):
-- CREATE OR REPLACE FUNCTION public.design_public_get(p_code text)
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- STABLE
-- SECURITY DEFINER
-- SET search_path = ''
-- AS $$
-- DECLARE
--   v_code text := upper(btrim(coalesce(p_code, '')));
--   v_d public.designs%ROWTYPE;
--   v_t public.design_templates%ROWTYPE;
--   v_ws public.workspaces%ROWTYPE;
--   v_is_generation boolean;
--   v_verify boolean := false;
-- BEGIN
--   IF v_code !~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' THEN
--     RETURN NULL;
--   END IF;
--   SELECT * INTO v_d FROM public.designs WHERE code = v_code;
--   IF NOT FOUND THEN
--     RETURN NULL;
--   END IF;
--   v_is_generation := v_d.template_id IS NOT NULL;
--   IF v_is_generation THEN
--     SELECT * INTO v_t FROM public.design_templates WHERE id = v_d.template_id;
--     v_verify := coalesce(v_t.verify, false);
--   END IF;
--   IF NOT (v_d.published OR (v_is_generation AND v_verify)) THEN
--     RETURN NULL;
--   END IF;
--   IF v_d.archived_at IS NOT NULL AND NOT v_is_generation THEN
--     RETURN NULL;
--   END IF;
--   SELECT * INTO v_ws FROM public.workspaces WHERE id = v_d.workspace_id;
--
--   RETURN jsonb_build_object(
--     'code', v_d.code,
--     'name', v_d.name,
--     'format', v_d.format,
--     'kind', CASE WHEN v_is_generation THEN 'generation' ELSE 'design' END,
--     'status', v_d.status,
--     'published', v_d.published,
--     'allow_download', CASE WHEN v_is_generation THEN coalesce(v_t.allow_download, true) AND v_d.allow_download ELSE v_d.allow_download END,
--     'allow_indexing', v_d.allow_indexing AND v_d.format = 'web',
--     'published_at', v_d.published_at,
--     'issued_at', v_d.created_at,
--     'verify', v_verify,
--     'doc_type', CASE WHEN v_verify THEN v_t.doc_type END,
--     'doc_type_label', CASE WHEN v_verify THEN v_t.doc_type_label END,
--     'void_reason', CASE WHEN v_d.status = 'void' THEN v_d.void_reason END,
--     'voided_at', v_d.voided_at,
--     'page_count', jsonb_array_length(v_d.doc -> 'pages'),
--     'rendered', (v_d.renders ? 'pages' OR v_d.renders ? 'pdf_path'),
--     'rendered_version', v_d.renders -> 'version',
--     'business_name', coalesce(nullif(btrim(v_ws.brand_name), ''), v_ws.name),
--     'business_timezone', coalesce(v_ws.timezone, 'UTC'),
--     'doc', CASE WHEN v_d.format = 'web' AND NOT v_is_generation THEN v_d.doc END
--   );
-- END;
-- $$;

CREATE OR REPLACE FUNCTION public.design_public_get(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_d public.designs%ROWTYPE;
  v_t public.design_templates%ROWTYPE;
  v_ws public.workspaces%ROWTYPE;
  v_is_generation boolean;
  v_verify boolean := false;
  -- 00325: el documento PUBLICADO (la última versión `publish`), no el que se está editando.
  v_pub_doc jsonb;
BEGIN
  IF v_code !~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_d FROM public.designs WHERE code = v_code;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_is_generation := v_d.template_id IS NOT NULL;
  IF v_is_generation THEN
    SELECT * INTO v_t FROM public.design_templates WHERE id = v_d.template_id;
    v_verify := coalesce(v_t.verify, false);
  END IF;
  IF NOT (v_d.published OR (v_is_generation AND v_verify)) THEN
    RETURN NULL;
  END IF;
  IF v_d.archived_at IS NOT NULL AND NOT v_is_generation THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_ws FROM public.workspaces WHERE id = v_d.workspace_id;
  -- Un diseño propio publicado muestra lo que se publicó: un cambio guardado después (con `designer.edit`) recién se ve
  -- al «Publicar cambios» (con `designer.publish`). Una generación es una copia congelada: su documento es el suyo.
  IF NOT v_is_generation THEN
    SELECT v.doc INTO v_pub_doc
      FROM public.design_versions v
     WHERE v.design_id = v_d.id AND v.reason = 'publish'
     ORDER BY v.created_at DESC
     LIMIT 1;
  END IF;
  v_pub_doc := coalesce(v_pub_doc, v_d.doc);

  RETURN jsonb_build_object(
    'code', v_d.code,
    'name', v_d.name,
    'format', v_d.format,
    'kind', CASE WHEN v_is_generation THEN 'generation' ELSE 'design' END,
    'status', v_d.status,
    'published', v_d.published,
    'allow_download', CASE WHEN v_is_generation THEN coalesce(v_t.allow_download, true) AND v_d.allow_download ELSE v_d.allow_download END,
    'allow_indexing', v_d.allow_indexing AND v_d.format = 'web',
    'published_at', v_d.published_at,
    'issued_at', v_d.created_at,
    'verify', v_verify,
    'doc_type', CASE WHEN v_verify THEN v_t.doc_type END,
    'doc_type_label', CASE WHEN v_verify THEN v_t.doc_type_label END,
    'void_reason', CASE WHEN v_d.status = 'void' THEN v_d.void_reason END,
    'voided_at', v_d.voided_at,
    'page_count', jsonb_array_length(v_pub_doc -> 'pages'),
    'rendered', (v_d.renders ? 'pages' OR v_d.renders ? 'pdf_path'),
    'rendered_version', v_d.renders -> 'version',
    'business_name', coalesce(nullif(btrim(v_ws.brand_name), ''), v_ws.name),
    'business_timezone', coalesce(v_ws.timezone, 'UTC'),
    'doc', CASE WHEN v_d.format = 'web' AND NOT v_is_generation THEN v_pub_doc END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.design_public_get(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.design_public_get(text) TO anon, authenticated, service_role;
