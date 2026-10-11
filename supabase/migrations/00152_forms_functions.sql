-- ============================================================================
-- 00152 — Formularios: definicion publica, publicar, metricas y envio (v1)
-- ============================================================================
-- Modulo Formularios, F8, F9, F12 y F14. Cuatro funciones nuevas:
--
--   1. get_public_form(slug)        la definicion que ve la pagina publica.
--      LISTA BLANCA: nunca devuelve el id ni el workspace del formulario, el
--      mapeo a contacto, las etiquetas, los avisos, el borrador, la pantalla de
--      exito, ni el valor de un campo oculto `fixed`. Un formulario que no esta
--      publicado devuelve lo mismo que uno que no existe (no se puede
--      enumerar). Ejecutable por `anon`: es la unica puerta publica.
--   2. publish_form_version(form, actor)   publica en UNA transaccion: inserta la
--      version (copia congelada), calcula la huella SHA-256 del texto del
--      contrato, apunta `current_version_id`, deja el audit_log. Sin cambios
--      respecto de la version vigente, no crea otra. Solo `service_role`: la
--      Server Action verifica `forms.manage` antes.
--   3. form_metrics_daily(form, desde, hasta)   vistas, inicios, envios, spam y
--      rechazados por dia, en la zona del workspace. Exige `can_view_forms`.
--   4. submit_form_response(...)    v1: guarda la respuesta, idempotente por
--      (form_id, idempotency_key). En FO1 no resuelve contacto (queda
--      `no_contact`); la 00156 (v2) y la 00157 (v3) la reescriben.
--
-- Todas con `SET search_path = ''` y referencias calificadas.
--
-- Aditiva e idempotente (CREATE OR REPLACE).
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb);
--   DROP FUNCTION IF EXISTS public.form_metrics_daily(uuid, date, date);
--   DROP FUNCTION IF EXISTS public.publish_form_version(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.get_public_form(text);
-- ============================================================================

-- ------------------------------------------------------------
-- 1. get_public_form
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_form(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_form    public.forms%ROWTYPE;
  v_version public.form_versions%ROWTYPE;
  v_fields  jsonb;
  v_site_key text;
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

  -- La clave PUBLICA de Turnstile (la secreta vive en Vault y nunca sale).
  SELECT ic.config ->> 'site_key' INTO v_site_key
  FROM public.integration_configs ic
  WHERE ic.workspace_id = v_form.workspace_id
    AND ic.type = 'captcha'
    AND ic.is_active
  ORDER BY ic.created_at
  LIMIT 1;

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
    END,
    'turnstile_site_key', v_site_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_form(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_form(text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 2. publish_form_version
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_form_version(p_form_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_form     public.forms%ROWTYPE;
  v_current  public.form_versions%ROWTYPE;
  v_def      jsonb;
  v_text     text;
  v_sha      text;
  v_number   integer;
  v_version_id uuid;
BEGIN
  SELECT * INTO v_form FROM public.forms WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El formulario no existe' USING ERRCODE = 'no_data_found';
  END IF;

  -- Lo que se congela: la definicion sin el texto del contrato (que va en su columna).
  v_def := v_form.draft_definition - 'contractText';
  IF v_form.type = 'contract' THEN
    v_text := v_form.draft_definition ->> 'contractText';
    IF v_text IS NULL OR btrim(v_text) = '' THEN
      RAISE EXCEPTION 'El contrato no tiene texto' USING ERRCODE = 'check_violation';
    END IF;
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
  END IF;

  IF v_form.current_version_id IS NOT NULL THEN
    SELECT * INTO v_current FROM public.form_versions WHERE id = v_form.current_version_id;
    IF FOUND AND v_current.definition = v_def AND v_current.contract_text IS NOT DISTINCT FROM v_text THEN
      -- Sin cambios: no hay version nueva. Si estaba pausado o en borrador, vuelve a publicarse.
      IF v_form.status <> 'published' THEN
        UPDATE public.forms
           SET status = 'published', published_at = now(), updated_by = p_actor
         WHERE id = p_form_id;
      END IF;
      RETURN jsonb_build_object(
        'changed', false,
        'version_id', v_current.id,
        'version_number', v_current.version_number
      );
    END IF;
  END IF;

  SELECT COALESCE(max(version_number), 0) + 1 INTO v_number
  FROM public.form_versions WHERE form_id = p_form_id;

  INSERT INTO public.form_versions
    (workspace_id, form_id, version_number, definition, contract_text, contract_text_sha256, published_by)
  VALUES
    (v_form.workspace_id, p_form_id, v_number, v_def, v_text, v_sha, p_actor)
  RETURNING id INTO v_version_id;

  UPDATE public.forms
     SET current_version_id = v_version_id,
         status = 'published',
         published_at = now(),
         updated_by = p_actor
   WHERE id = p_form_id;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by, actor_type)
  VALUES (
    v_form.workspace_id, 'form', p_form_id, 'form.published',
    jsonb_build_object('version_number', v_number, 'version_id', v_version_id),
    p_actor,
    'user'
  );

  RETURN jsonb_build_object('changed', true, 'version_id', v_version_id, 'version_number', v_number);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_form_version(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_form_version(uuid, uuid) TO service_role;

-- ------------------------------------------------------------
-- 3. form_metrics_daily
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.form_metrics_daily(p_form_id uuid, p_from date, p_to date)
RETURNS TABLE (day date, views integer, starts integer, submissions integer, spam integer, rejected integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_ws uuid;
  v_tz text;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RETURN;
  END IF;
  IF (p_to - p_from) + 1 > 366 THEN
    RAISE EXCEPTION 'El rango no puede pasar de 366 dias' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT f.workspace_id, COALESCE(NULLIF(w.timezone, ''), 'UTC')
    INTO v_ws, v_tz
  FROM public.forms f
  JOIN public.workspaces w ON w.id = f.workspace_id
  WHERE f.id = p_form_id;

  IF v_ws IS NULL THEN
    RETURN;
  END IF;

  -- Quien no puede ver formularios no recibe filas (ni siquiera ceros).
  IF NOT public.can_view_forms(v_ws) THEN
    RETURN;
  END IF;

  v_from_ts := p_from::timestamp AT TIME ZONE v_tz;
  v_to_ts := (p_to + 1)::timestamp AT TIME ZONE v_tz;

  RETURN QUERY
  WITH days AS (
    SELECT d::date AS day FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') AS d
  ),
  ev AS (
    SELECT (e.created_at AT TIME ZONE v_tz)::date AS day, e.event_type, count(*)::integer AS n
    FROM public.analytics_events e
    WHERE e.workspace_id = v_ws
      AND e.metadata ->> 'form_id' = p_form_id::text
      AND e.event_type LIKE 'form\_%'
      AND e.event_type IN ('form_view', 'form_start', 'form_rejected')
      AND e.created_at >= v_from_ts
      AND e.created_at < v_to_ts
    GROUP BY 1, 2
  ),
  sub AS (
    SELECT (s.created_at AT TIME ZONE v_tz)::date AS day,
           count(*) FILTER (WHERE s.status IN ('received', 'no_contact'))::integer AS submissions,
           count(*) FILTER (WHERE s.status = 'spam')::integer AS spam
    FROM public.form_submissions s
    WHERE s.form_id = p_form_id
      AND s.created_at >= v_from_ts
      AND s.created_at < v_to_ts
    GROUP BY 1
  )
  SELECT
    d.day,
    COALESCE((SELECT ev.n FROM ev WHERE ev.day = d.day AND ev.event_type = 'form_view'), 0),
    COALESCE((SELECT ev.n FROM ev WHERE ev.day = d.day AND ev.event_type = 'form_start'), 0),
    COALESCE(sub.submissions, 0),
    COALESCE(sub.spam, 0),
    COALESCE((SELECT ev.n FROM ev WHERE ev.day = d.day AND ev.event_type = 'form_rejected'), 0)
  FROM days d
  LEFT JOIN sub ON sub.day = d.day
  ORDER BY d.day;
END;
$$;

REVOKE ALL ON FUNCTION public.form_metrics_daily(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.form_metrics_daily(uuid, date, date) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. submit_form_response (v1: sin contacto)
-- ------------------------------------------------------------
-- Idempotente por (form_id, idempotency_key): un doble clic, un reintento de
-- red o dos pestañas devuelven la MISMA respuesta y no disparan nada dos veces.
-- La unica que decide es el indice unico, no un SELECT previo.
--
-- `p_extra` lleva lo propio de cada tipo (la carpeta de archivos hoy; la firma
-- del contrato mas adelante) para no tener que cambiar la firma de la funcion.
CREATE OR REPLACE FUNCTION public.submit_form_response(
  p_form_id uuid,
  p_version_id uuid,
  p_idempotency_key uuid,
  p_answers jsonb,
  p_attribution jsonb,
  p_meta jsonb,
  p_contact_hint jsonb DEFAULT '{}'::jsonb,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_form public.forms%ROWTYPE;
  v_id uuid;
  v_existing public.form_submissions%ROWTYPE;
BEGIN
  SELECT * INTO v_form FROM public.forms WHERE id = p_form_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El formulario no existe' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.form_versions v WHERE v.id = p_version_id AND v.form_id = p_form_id
  ) THEN
    RAISE EXCEPTION 'La version no es de este formulario' USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO public.form_submissions
    (workspace_id, form_id, form_version_id, idempotency_key, status, answers,
     attribution, meta, upload_prefix)
  VALUES
    (v_form.workspace_id, p_form_id, p_version_id, p_idempotency_key, 'no_contact', p_answers,
     COALESCE(p_attribution, '{}'::jsonb), COALESCE(p_meta, '{}'::jsonb), p_extra ->> 'upload_prefix')
  ON CONFLICT (form_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.form_submissions
    WHERE form_id = p_form_id AND idempotency_key = p_idempotency_key;

    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'submission_id', v_existing.id,
      'status', v_existing.status,
      'contact_id', v_existing.contact_id,
      'contact_created', v_existing.contact_created
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'submission_id', v_id,
    'status', 'no_contact',
    'contact_id', NULL,
    'contact_created', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;
