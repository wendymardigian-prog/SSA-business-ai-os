-- ============================================================================
-- 00172 — get_public_form sin turnstile_site_key (Formularios, correccion R1)
-- ============================================================================
-- Se saca Cloudflare Turnstile: publicar un formulario no puede depender de un captcha.
-- La definicion publica deja de devolver la site key. La lista blanca no cambia en nada mas.
-- Riesgo: bajo (CREATE OR REPLACE). Se aplica junto con el despliegue del codigo nuevo: el codigo
-- viejo leia `turnstile_site_key` y, sin la clave, simplemente no mostraba el widget.
-- Documento para retomarlo: docs/pendientes/turnstile-captcha.md.
--
-- Como volver atras: recrear la funcion con esta definicion anterior (viva el 12/10/2026, copiada de pg_get_functiondef):
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
--     v_site_key text;
--   BEGIN
--     IF p_slug IS NULL OR p_slug = '' THEN
--       RETURN jsonb_build_object('status', 'unavailable');
--     END IF;
--
--     SELECT * INTO v_form
--     FROM public.forms f
--     WHERE lower(f.slug) = lower(p_slug)
--       AND f.status = 'published'
--       AND f.current_version_id IS NOT NULL;
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
--               'prefill', t.field -> 'prefill'
--             ))
--         END AS pf
--       FROM jsonb_array_elements(COALESCE(v_version.definition -> 'fields', '[]'::jsonb))
--            WITH ORDINALITY AS t(field, ord)
--     ) x
--     WHERE x.pf IS NOT NULL;
--
--     -- La clave PUBLICA de Turnstile (la secreta vive en Vault y nunca sale).
--     SELECT ic.config ->> 'site_key' INTO v_site_key
--     FROM public.integration_configs ic
--     WHERE ic.workspace_id = v_form.workspace_id
--       AND ic.type = 'captcha'
--       AND ic.is_active
--     ORDER BY ic.created_at
--     LIMIT 1;
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
--       END,
--       'turnstile_site_key', v_site_key
--     );
--   END;
--   $function$
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_form(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
    AND f.current_version_id IS NOT NULL;

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
            'prefill', t.field -> 'prefill'
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
        'accept_label', v_form.contract_config -> 'acceptLabel'
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
