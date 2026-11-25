-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00512_portal_activity_rating  (Encuestas en las actividades del programa)
-- ============================================================================
-- Las actividades del portal suman preguntas de estrellas (`rating`, 1 a 5: la misma convención que las encuestas de
-- Formularios) y el portal empieza a mandar las de selección única y múltiple como valores de verdad (antes las
-- dibujaba como un cuadro de texto).
--
--   1. app_servicio_portal.activity_answers_valid(fields, answers): una estrella es un número entero entre el `min`
--      y el `max` de la pregunta (1 y 5 si no los trae); una selección única, un texto que es una de las opciones (o
--      vacío); una múltiple, una lista de textos que son opciones. Sin opciones guardadas acepta cualquier texto.
--      Una respuesta ausente o null no se mira (lo obligatorio es otro chequeo). Gemela de
--      lib/program/activity-answers.ts con los casos de lib/program/activity-answers.cases.json (verify-program).
--   2. portal_submit: la misma de la 00392 con UN chequeo más, después del de «nunca un objeto».
--   3. public_fields: suma `min` y `max` de cada pregunta (solo agrega claves; jsonb_strip_nulls las saca si no
--      están), así el portal no fija la escala.
--
-- Mismas firmas: CREATE OR REPLACE. Aditiva: las entregas guardadas no se tocan (el chequeo es solo para envíos
-- nuevos). Puede ir antes o después del deploy del panel; el portal nuevo conviene que salga antes (ver docs).
--
-- Volver atrás: correr las dos definiciones de abajo (las de producción del 25/11/2026) y
-- DROP FUNCTION app_servicio_portal.activity_answers_valid(jsonb, jsonb).
--
-- portal_submit vieja (00392):
-- CREATE OR REPLACE FUNCTION app_servicio_portal.portal_submit(p_sess jsonb, p_x jsonb, p_answers jsonb)
--  RETURNS uuid
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v_id uuid;
--   v_fields jsonb := COALESCE(p_x #> '{definition,fields}', '[]'::jsonb);
--   v_prefix text := (p_x ->> 'workspace_id') || '/' || (p_x ->> 'form_id') || '/' || (p_x ->> 'contact_id');
-- BEGIN
--   IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN PERFORM app_servicio_portal.err('PO400', 'Faltan las respuestas'); END IF;
--   -- Solo las claves del formulario.
--   IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_answers) k WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f WHERE f ->> 'key' = k)) THEN
--     PERFORM app_servicio_portal.err('PO400', 'Hay respuestas que no son de este formulario');
--   END IF;
--   -- Una respuesta que no es de archivo nunca es un objeto.
--   IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f
--               WHERE f ->> 'type' IS DISTINCT FROM 'file' AND jsonb_typeof(p_answers -> (f ->> 'key')) = 'object') THEN
--     PERFORM app_servicio_portal.err('PO400', 'Hay respuestas que no son válidas');
--   END IF;
--   -- Los archivos: la lista del panel, dentro de la carpeta de la persona y subidos de verdad.
--   IF EXISTS (
--     SELECT 1 FROM jsonb_array_elements(v_fields) f
--      WHERE f ->> 'type' = 'file' AND p_answers ? (f ->> 'key') AND jsonb_typeof(p_answers -> (f ->> 'key')) <> 'null'
--        AND (jsonb_typeof(p_answers -> (f ->> 'key')) <> 'array'
--             OR jsonb_array_length(p_answers -> (f ->> 'key')) > 5
--             OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_answers -> (f ->> 'key')) a
--                         WHERE jsonb_typeof(a) <> 'object'
--                            OR jsonb_typeof(a -> 'path') <> 'string' OR jsonb_typeof(a -> 'name') <> 'string'
--                            OR jsonb_typeof(a -> 'size') <> 'number' OR jsonb_typeof(a -> 'mime') <> 'string'
--                            OR char_length(a ->> 'name') NOT BETWEEN 1 AND 200 OR (a ->> 'size')::numeric NOT BETWEEN 0 AND 10485760
--                            OR NOT starts_with(a ->> 'path', v_prefix || '/') OR strpos(a ->> 'path', '..') > 0
--                            OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'form-uploads' AND o.name = a ->> 'path')))
--   ) THEN
--     PERFORM app_servicio_portal.err('PO400', 'Algún archivo no se subió bien. Volvé a adjuntarlo');
--   END IF;
--   IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f
--               WHERE COALESCE((f ->> 'required')::boolean, false) AND NULLIF(btrim(COALESCE(p_answers ->> (f ->> 'key'), '')), '') IS NULL
--                 AND COALESCE(p_answers -> (f ->> 'key'), 'null'::jsonb) IN ('null'::jsonb, '[]'::jsonb, '""'::jsonb)) THEN
--     PERFORM app_servicio_portal.err('PO400', 'Completá las preguntas obligatorias');
--   END IF;
--   INSERT INTO public.form_submissions (workspace_id, form_id, form_version_id, idempotency_key, status, answers, contact_id, meta, upload_prefix)
--   VALUES ((p_x ->> 'workspace_id')::uuid, (p_x ->> 'form_id')::uuid, (p_x ->> 'version_id')::uuid, gen_random_uuid(), 'received', p_answers,
--           (p_x ->> 'contact_id')::uuid, jsonb_build_object('source', 'portal', 'program_item_id', p_x ->> 'item_id'), v_prefix)
--   RETURNING id INTO v_id;
--   RETURN v_id;
-- END;
-- $function$
--
-- public_fields vieja (00387):
-- CREATE OR REPLACE FUNCTION app_servicio_portal.public_fields(d jsonb)
--  RETURNS jsonb
--  LANGUAGE sql
--  IMMUTABLE
--  SET search_path TO ''
-- AS $function$
--   SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', f ->> 'key', 'type', f ->> 'type', 'label', f ->> 'label', 'help', f ->> 'help',
--            'required', COALESCE((f ->> 'required')::boolean, false), 'options', f -> 'options', 'points', d #> ARRAY['quiz', 'questions', f ->> 'key', 'points']))
--            ORDER BY n), '[]'::jsonb)
--     FROM jsonb_array_elements(COALESCE(d -> 'fields', '[]'::jsonb)) WITH ORDINALITY t(f, n);
-- $function$
-- ============================================================================

CREATE OR REPLACE FUNCTION app_servicio_portal.activity_answers_valid(p_fields jsonb, p_answers jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_fields) = 'array' THEN p_fields ELSE '[]'::jsonb END) f
     CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers -> (f ->> 'key') END AS v,
                                CASE WHEN jsonb_typeof(f -> 'options') = 'array' THEN f -> 'options' ELSE '[]'::jsonb END AS opts,
                                CASE WHEN jsonb_typeof(f -> 'min') = 'number' THEN (f ->> 'min')::numeric ELSE 1 END AS lo,
                                CASE WHEN jsonb_typeof(f -> 'max') = 'number' THEN (f ->> 'max')::numeric ELSE 5 END AS hi) x
     WHERE x.v IS NOT NULL AND jsonb_typeof(x.v) <> 'null'
       AND CASE f ->> 'type'
             WHEN 'rating' THEN
               CASE WHEN jsonb_typeof(x.v) <> 'number' THEN true
                    ELSE (x.v #>> '{}')::numeric <> trunc((x.v #>> '{}')::numeric)
                      OR (x.v #>> '{}')::numeric < x.lo OR (x.v #>> '{}')::numeric > x.hi END
             WHEN 'single_select' THEN
               CASE WHEN jsonb_typeof(x.v) <> 'string' THEN true
                    ELSE (x.v #>> '{}') <> '' AND jsonb_array_length(x.opts) > 0 AND NOT x.opts @> jsonb_build_array(x.v) END
             WHEN 'multi_select' THEN
               CASE WHEN jsonb_typeof(x.v) <> 'array' THEN true
                    ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(x.v) e
                                  WHERE jsonb_typeof(e) <> 'string' OR (jsonb_array_length(x.opts) > 0 AND NOT x.opts @> jsonb_build_array(e))) END
             ELSE false
           END
  );
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_submit(p_sess jsonb, p_x jsonb, p_answers jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
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
  -- Estrellas y opciones (00512): el valor tiene que ser de su pregunta (gemela de lib/program/activity-answers.ts).
  IF NOT app_servicio_portal.activity_answers_valid(v_fields, p_answers) THEN
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

CREATE OR REPLACE FUNCTION app_servicio_portal.public_fields(d jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', f ->> 'key', 'type', f ->> 'type', 'label', f ->> 'label', 'help', f ->> 'help',
           'required', COALESCE((f ->> 'required')::boolean, false), 'options', f -> 'options', 'min', f -> 'min', 'max', f -> 'max', 'points', d #> ARRAY['quiz', 'questions', f ->> 'key', 'points']))
           ORDER BY n), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(d -> 'fields', '[]'::jsonb)) WITH ORDINALITY t(f, n);
$$;

-- Internas, como en la 00387 y la 00392: solo las llaman las funciones del portal (SECURITY DEFINER), nadie de afuera.
REVOKE ALL ON FUNCTION app_servicio_portal.activity_answers_valid(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role, portal_app;
REVOKE ALL ON FUNCTION app_servicio_portal.portal_submit(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role, portal_app;
REVOKE ALL ON FUNCTION app_servicio_portal.public_fields(jsonb) FROM PUBLIC, anon, authenticated;
