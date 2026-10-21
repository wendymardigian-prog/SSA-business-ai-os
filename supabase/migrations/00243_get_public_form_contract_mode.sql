-- ============================================================
-- 00243_get_public_form_contract_mode
-- ============================================================
-- La pagina publica de un contrato necesita saber su MODO (Aceptacion de terminos o
-- Contrato, 21/10/2026) y, con la firma de ambas partes, la firma del negocio para
-- mostrarla abajo del texto. Sale por `get_public_form` (la lista blanca de siempre):
-- se suman dos claves dentro de `contract` y nada mas cambia.
--
-- Definicion anterior (00179, leida de la base el 21/10/2026), para volver atras:
--
--   CREATE OR REPLACE FUNCTION public.get_public_form(p_slug text)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_form    public.forms%ROWTYPE;
--     v_version public.form_versions%ROWTYPE;
--     v_fields  jsonb;
--   BEGIN
--     IF p_slug IS NULL OR p_slug = '' THEN
--       RETURN jsonb_build_object('status', 'unavailable');
--     END IF;
--
--     SELECT * INTO v_form
--     FROM public.forms f
--     WHERE lower(f.slug) = lower(p_slug)
--       AND f.status = 'published'
--       AND f.current_version_id IS NOT NULL
--       -- Un reporte de fin de dia no tiene pagina publica (00179): se completa con la sesion iniciada.
--       AND f.type <> 'eod';
--
--     IF NOT FOUND THEN
--       RETURN jsonb_build_object('status', 'unavailable');
--     END IF;
--
--     SELECT * INTO v_version FROM public.form_versions WHERE id = v_form.current_version_id;
--     IF NOT FOUND THEN
--       RETURN jsonb_build_object('status', 'unavailable');
--     END IF;
--
--     -- Los campos, uno por uno, con lista blanca. Un oculto `fixed` no sale.
--     SELECT COALESCE(jsonb_agg(x.pf ORDER BY x.ord), '[]'::jsonb) INTO v_fields
--     FROM (
--       SELECT
--         t.ord,
--         CASE
--           WHEN t.field ->> 'type' = 'hidden' THEN
--             CASE
--               WHEN t.field -> 'hidden' ->> 'source' IN ('url_param', 'attribution') THEN
--                 jsonb_build_object(
--                   'key', t.field -> 'key',
--                   'type', 'hidden',
--                   'hidden', jsonb_strip_nulls(jsonb_build_object(
--                     'source', t.field -> 'hidden' -> 'source',
--                     'param', t.field -> 'hidden' -> 'param'
--                   ))
--                 )
--               ELSE NULL
--             END
--           ELSE
--             jsonb_strip_nulls(jsonb_build_object(
--               'key', t.field -> 'key',
--               'type', t.field -> 'type',
--               'label', t.field -> 'label',
--               'help', t.field -> 'help',
--               'placeholder', t.field -> 'placeholder',
--               'required', t.field -> 'required',
--               'options', t.field -> 'options',
--               'min', t.field -> 'min',
--               'max', t.field -> 'max',
--               'file', t.field -> 'file',
--               'consentText', t.field -> 'consentText',
--               'visibility', t.field -> 'visibility',
--               'prefill', t.field -> 'prefill',
--               'social', t.field -> 'social'
--             ))
--         END AS pf
--       FROM jsonb_array_elements(COALESCE(v_version.definition -> 'fields', '[]'::jsonb))
--            WITH ORDINALITY AS t(field, ord)
--     ) x
--     WHERE x.pf IS NOT NULL;
--
--     RETURN jsonb_build_object(
--       'status', 'available',
--       'slug', v_form.slug,
--       'type', v_form.type,
--       'version_id', v_version.id,
--       'design', jsonb_strip_nulls(jsonb_build_object(
--         'title', v_form.design -> 'title',
--         'intro', v_form.design -> 'intro',
--         'submitLabel', v_form.design -> 'submitLabel',
--         'showLogo', v_form.design -> 'showLogo'
--       )),
--       'fields', v_fields,
--       'contract', CASE
--         WHEN v_form.type = 'contract' THEN jsonb_build_object(
--           'text', v_version.contract_text,
--           'version_number', v_version.version_number,
--           'title', v_form.contract_config -> 'title',
--           'accept_label', v_form.contract_config -> 'acceptLabel'
--         )
--         ELSE NULL
--       END,
--       'signature_required', CASE
--         WHEN v_form.type = 'contract' THEN COALESCE((v_form.contract_config ->> 'signatureRequired')::boolean, true)
--         ELSE false
--       END,
--       'survey', CASE
--         WHEN v_form.type = 'survey' THEN jsonb_build_object('scoreFieldKey', v_form.survey_config -> 'scoreFieldKey')
--         ELSE NULL
--       END
--     );
--   END;
--   $function$
--
-- Idempotente: CREATE OR REPLACE con la misma firma (conserva los permisos).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_public_form(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_form    public.forms%ROWTYPE;
  v_version public.form_versions%ROWTYPE;
  v_fields  jsonb;
BEGIN
  IF p_slug IS NULL OR p_slug = '' THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  SELECT * INTO v_form
  FROM public.forms f
  WHERE lower(f.slug) = lower(p_slug)
    AND f.status = 'published'
    AND f.current_version_id IS NOT NULL
    -- Un reporte de fin de dia no tiene pagina publica (00179): se completa con la sesion iniciada.
    AND f.type <> 'eod';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  SELECT * INTO v_version FROM public.form_versions WHERE id = v_form.current_version_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  -- Los campos, uno por uno, con lista blanca. Un oculto `fixed` no sale.
  SELECT COALESCE(jsonb_agg(x.pf ORDER BY x.ord), '[]'::jsonb) INTO v_fields
  FROM (
    SELECT
      t.ord,
      CASE
        WHEN t.field ->> 'type' = 'hidden' THEN
          CASE
            WHEN t.field -> 'hidden' ->> 'source' IN ('url_param', 'attribution') THEN
              jsonb_build_object(
                'key', t.field -> 'key',
                'type', 'hidden',
                'hidden', jsonb_strip_nulls(jsonb_build_object(
                  'source', t.field -> 'hidden' -> 'source',
                  'param', t.field -> 'hidden' -> 'param'
                ))
              )
            ELSE NULL
          END
        ELSE
          jsonb_strip_nulls(jsonb_build_object(
            'key', t.field -> 'key',
            'type', t.field -> 'type',
            'label', t.field -> 'label',
            'help', t.field -> 'help',
            'placeholder', t.field -> 'placeholder',
            'required', t.field -> 'required',
            'options', t.field -> 'options',
            'min', t.field -> 'min',
            'max', t.field -> 'max',
            'file', t.field -> 'file',
            'consentText', t.field -> 'consentText',
            'visibility', t.field -> 'visibility',
            'prefill', t.field -> 'prefill',
            'social', t.field -> 'social'
          ))
      END AS pf
    FROM jsonb_array_elements(COALESCE(v_version.definition -> 'fields', '[]'::jsonb))
         WITH ORDINALITY AS t(field, ord)
  ) x
  WHERE x.pf IS NOT NULL;

  RETURN jsonb_build_object(
    'status', 'available',
    'slug', v_form.slug,
    'type', v_form.type,
    'version_id', v_version.id,
    'design', jsonb_strip_nulls(jsonb_build_object(
      'title', v_form.design -> 'title',
      'intro', v_form.design -> 'intro',
      'submitLabel', v_form.design -> 'submitLabel',
      'showLogo', v_form.design -> 'showLogo'
    )),
    'fields', v_fields,
    'contract', CASE
      WHEN v_form.type = 'contract' THEN jsonb_build_object(
        'text', v_version.contract_text,
        'version_number', v_version.version_number,
        'title', v_form.contract_config -> 'title',
        'accept_label', v_form.contract_config -> 'acceptLabel',
        -- 00243: el modo ('terms' | 'contract') y, en modo Contrato con la firma de ambas
        -- partes prendida, la firma del negocio (nombre, cargo y la ruta de su imagen en el
        -- bucket privado: la pagina la firma con un link temporal, nunca la expone tal cual).
        'mode', CASE WHEN v_form.contract_config ->> 'mode' = 'contract' THEN 'contract' ELSE 'terms' END,
        'business_signer', CASE
          WHEN v_form.contract_config ->> 'mode' = 'contract'
               AND v_form.contract_config -> 'businessSigner' -> 'enabled' = 'true'::jsonb
               AND COALESCE(v_form.contract_config -> 'businessSigner' ->> 'signaturePath', '') <> ''
          THEN jsonb_build_object(
            'name', v_form.contract_config -> 'businessSigner' -> 'name',
            'role', v_form.contract_config -> 'businessSigner' -> 'role',
            'signature_path', v_form.contract_config -> 'businessSigner' -> 'signaturePath'
          )
          ELSE NULL
        END
      )
      ELSE NULL
    END,
    'signature_required', CASE
      WHEN v_form.type = 'contract' THEN COALESCE((v_form.contract_config ->> 'signatureRequired')::boolean, true)
      ELSE false
    END,
    'survey', CASE
      WHEN v_form.type = 'survey' THEN jsonb_build_object('scoreFieldKey', v_form.survey_config -> 'scoreFieldKey')
      ELSE NULL
    END
  );
END;
$function$;
