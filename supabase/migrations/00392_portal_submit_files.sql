-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00392_portal_submit_files  (Portal de estudiantes, Corrida B2 · P06, entregas con archivo)
-- ============================================================================
-- portal_submit (00387) guardaba las respuestas tal cual. Para las preguntas de tipo archivo eso no alcanza:
--   1. La respuesta de un campo «file» tiene que ser la lista que usa el panel (lib/forms/files.ts):
--      [{ path, name, size, mime }], hasta 5, cada una dentro de la carpeta de ESTA persona en ESTE formulario
--      (`<workspace>/<form>/<contact>/…`, la misma que da portal_file_grant('activity_upload')), sin «..», y el archivo
--      tiene que estar subido de verdad en `form-uploads` (así nadie entrega la ruta de un archivo ajeno).
--   2. Una respuesta que no es de archivo no puede ser un objeto.
--   3. Guarda `upload_prefix` en la entrega: el panel solo abre archivos que están dentro de esa carpeta
--      (isFileOfSubmission), así la revisión puede mostrar el link.
--
-- Mismo contrato y misma firma: CREATE OR REPLACE. La definición vieja queda en docs/servicios/definiciones-viejas-a3.sql.
-- Volver atrás: volver a correr la definición de portal_submit de la 00387.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_submit(p_sess jsonb, p_x jsonb, p_answers jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_fields jsonb := COALESCE(p_x #> '{definition,fields}', '[]'::jsonb);
  v_prefix text := (p_x ->> 'workspace_id') || '/' || (p_x ->> 'form_id') || '/' || (p_x ->> 'contact_id');
BEGIN
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN PERFORM app_servicio_portal.err('PO400', 'Faltan las respuestas'); END IF;
  -- Solo las claves del formulario.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_answers) k WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f WHERE f ->> 'key' = k)) THEN
    PERFORM app_servicio_portal.err('PO400', 'Hay respuestas que no son de este formulario');
  END IF;
  -- Una respuesta que no es de archivo nunca es un objeto.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f
              WHERE f ->> 'type' IS DISTINCT FROM 'file' AND jsonb_typeof(p_answers -> (f ->> 'key')) = 'object') THEN
    PERFORM app_servicio_portal.err('PO400', 'Hay respuestas que no son válidas');
  END IF;
  -- Los archivos: la lista del panel, dentro de la carpeta de la persona y subidos de verdad.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_fields) f
     WHERE f ->> 'type' = 'file' AND p_answers ? (f ->> 'key') AND jsonb_typeof(p_answers -> (f ->> 'key')) <> 'null'
       AND (jsonb_typeof(p_answers -> (f ->> 'key')) <> 'array'
            OR jsonb_array_length(p_answers -> (f ->> 'key')) > 5
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_answers -> (f ->> 'key')) a
                        WHERE jsonb_typeof(a) <> 'object'
                           OR jsonb_typeof(a -> 'path') <> 'string' OR jsonb_typeof(a -> 'name') <> 'string'
                           OR jsonb_typeof(a -> 'size') <> 'number' OR jsonb_typeof(a -> 'mime') <> 'string'
                           OR char_length(a ->> 'name') NOT BETWEEN 1 AND 200 OR (a ->> 'size')::numeric NOT BETWEEN 0 AND 10485760
                           OR NOT starts_with(a ->> 'path', v_prefix || '/') OR strpos(a ->> 'path', '..') > 0
                           OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'form-uploads' AND o.name = a ->> 'path')))
  ) THEN
    PERFORM app_servicio_portal.err('PO400', 'Algún archivo no se subió bien. Volvé a adjuntarlo');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f
              WHERE COALESCE((f ->> 'required')::boolean, false) AND NULLIF(btrim(COALESCE(p_answers ->> (f ->> 'key'), '')), '') IS NULL
                AND COALESCE(p_answers -> (f ->> 'key'), 'null'::jsonb) IN ('null'::jsonb, '[]'::jsonb, '""'::jsonb)) THEN
    PERFORM app_servicio_portal.err('PO400', 'Completá las preguntas obligatorias');
  END IF;
  INSERT INTO public.form_submissions (workspace_id, form_id, form_version_id, idempotency_key, status, answers, contact_id, meta, upload_prefix)
  VALUES ((p_x ->> 'workspace_id')::uuid, (p_x ->> 'form_id')::uuid, (p_x ->> 'version_id')::uuid, gen_random_uuid(), 'received', p_answers,
          (p_x ->> 'contact_id')::uuid, jsonb_build_object('source', 'portal', 'program_item_id', p_x ->> 'item_id'), v_prefix)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Interna, como en la 00387: solo la llaman las funciones del portal (SECURITY DEFINER), nadie de afuera.
REVOKE ALL ON FUNCTION app_servicio_portal.portal_submit(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role, portal_app;
