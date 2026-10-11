-- ============================================================================
-- 00156 — Formularios: resolucion del contacto y envio v2
-- ============================================================================
-- Modulo Formularios, F16 (y la base de F17, F18, F19 y F22).
--
--   1. `find_contact_by_phone_or_email`: la regla de contacto de la Agenda.
--   2. `submit_form_response` v2: reescribe la funcion que creo la 00152 (v1).
--      Es UNA funcion de este mismo modulo; nada mas la usa.
--
-- NO toca `find_or_link_contact`, `create_booking` ni `record_contact_touch`.
--
-- Como volver atras (la v1 completa esta mas abajo, comentada):
--   CREATE OR REPLACE FUNCTION public.submit_form_response(...)  -- la v1 de la cabecera
--   DROP FUNCTION IF EXISTS public.find_contact_by_phone_or_email(uuid, text, text);
--
-- ---------------------------------------------------------------------------
-- LA v1 (00152), COMPLETA:
-- ---------------------------------------------------------------------------
-- -- 4. submit_form_response (v1: sin contacto)
-- -- ------------------------------------------------------------
-- -- Idempotente por (form_id, idempotency_key): un doble clic, un reintento de
-- -- red o dos pestañas devuelven la MISMA respuesta y no disparan nada dos veces.
-- -- La unica que decide es el indice unico, no un SELECT previo.
-- --
-- -- `p_extra` lleva lo propio de cada tipo (la carpeta de archivos hoy; la firma
-- -- del contrato mas adelante) para no tener que cambiar la firma de la funcion.
-- CREATE OR REPLACE FUNCTION public.submit_form_response(
--   p_form_id uuid,
--   p_version_id uuid,
--   p_idempotency_key uuid,
--   p_answers jsonb,
--   p_attribution jsonb,
--   p_meta jsonb,
--   p_contact_hint jsonb DEFAULT '{}'::jsonb,
--   p_extra jsonb DEFAULT '{}'::jsonb
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = ''
-- AS $$
-- DECLARE
--   v_form public.forms%ROWTYPE;
--   v_id uuid;
--   v_existing public.form_submissions%ROWTYPE;
-- BEGIN
--   SELECT * INTO v_form FROM public.forms WHERE id = p_form_id;
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'El formulario no existe' USING ERRCODE = 'no_data_found';
--   END IF;
--
--   IF NOT EXISTS (
--     SELECT 1 FROM public.form_versions v WHERE v.id = p_version_id AND v.form_id = p_form_id
--   ) THEN
--     RAISE EXCEPTION 'La version no es de este formulario' USING ERRCODE = 'foreign_key_violation';
--   END IF;
--
--   INSERT INTO public.form_submissions
--     (workspace_id, form_id, form_version_id, idempotency_key, status, answers,
--      attribution, meta, upload_prefix)
--   VALUES
--     (v_form.workspace_id, p_form_id, p_version_id, p_idempotency_key, 'no_contact', p_answers,
--      COALESCE(p_attribution, '{}'::jsonb), COALESCE(p_meta, '{}'::jsonb), p_extra ->> 'upload_prefix')
--   ON CONFLICT (form_id, idempotency_key) DO NOTHING
--   RETURNING id INTO v_id;
--
--   IF v_id IS NULL THEN
--     SELECT * INTO v_existing
--     FROM public.form_submissions
--     WHERE form_id = p_form_id AND idempotency_key = p_idempotency_key;
--
--     RETURN jsonb_build_object(
--       'ok', true,
--       'duplicate', true,
--       'submission_id', v_existing.id,
--       'status', v_existing.status,
--       'contact_id', v_existing.contact_id,
--       'contact_created', v_existing.contact_created
--     );
--   END IF;
--
--   RETURN jsonb_build_object(
--     'ok', true,
--     'duplicate', false,
--     'submission_id', v_id,
--     'status', 'no_contact',
--     'contact_id', NULL,
--     'contact_created', false
--   );
-- END;
-- $$;
--
-- REVOKE ALL ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;
-- ============================================================================

-- ------------------------------------------------------------
-- 1. find_contact_by_phone_or_email
-- ------------------------------------------------------------
-- La MISMA regla que `create_booking` (00129) y `find_or_link_contact`: telefono
-- exacto primero (contra `phone` o `whatsapp_phone`, el contacto mas antiguo); si
-- no, email normalizado (contra `email` o `secondary_email`, el mas antiguo);
-- nunca por nombre; solo contactos sin `deleted_at`. Se copia el criterio y no se
-- llama a `find_or_link_contact` porque esa funcion exige un canal (y escribe
-- `contact_channels`): un formulario no viene de ningun canal. NO se toca.
--
-- Si el telefono apunta a un contacto y el email a OTRO, gana el del telefono y
-- el otro sale en `conflict_contact_id` para que alguien lo revise.
CREATE OR REPLACE FUNCTION public.find_contact_by_phone_or_email(
  p_workspace_id uuid,
  p_phone text,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone    text := nullif(btrim(p_phone), '');
  v_email    text := public.normalize_email(p_email);
  v_by_phone uuid;
  v_by_email uuid;
  v_contact  uuid;
  v_matched  text;
  v_conflict uuid;
BEGIN
  IF v_phone IS NOT NULL THEN
    SELECT c.id INTO v_by_phone
    FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (c.phone = v_phone OR c.whatsapp_phone = v_phone)
    ORDER BY c.created_at ASC LIMIT 1;
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT c.id INTO v_by_email
    FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (public.normalize_email(c.email) = v_email OR public.normalize_email(c.secondary_email) = v_email)
    ORDER BY c.created_at ASC LIMIT 1;
  END IF;

  IF v_by_phone IS NOT NULL THEN
    v_contact := v_by_phone;
    v_matched := 'phone';
    IF v_by_email IS NOT NULL AND v_by_email <> v_by_phone THEN
      v_conflict := v_by_email;
    END IF;
  ELSIF v_by_email IS NOT NULL THEN
    v_contact := v_by_email;
    v_matched := 'email';
  END IF;

  RETURN jsonb_build_object('contact_id', v_contact, 'matched_by', v_matched, 'conflict_contact_id', v_conflict);
END;
$$;

REVOKE ALL ON FUNCTION public.find_contact_by_phone_or_email(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_contact_by_phone_or_email(uuid, text, text) TO service_role;

-- ------------------------------------------------------------
-- 2. submit_form_response v2: contacto, etiquetas, puntaje y evento
-- ------------------------------------------------------------
-- Lo nuevo respecto de la v1 (la v1 completa esta en la cabecera):
--   - serializa los pedidos con la MISMA clave de idempotencia (un lock sobre
--     form + clave) ANTES de tocar nada: un doble clic o dos pestañas no crean un
--     contacto huerfano;
--   - resuelve el contacto: el del link firmado (`signed_contact_id`) sin
--     deduplicar; si no, `find_contact_by_phone_or_email`. Un lock por
--     telefono/email evita dos contactos nuevos con el mismo dato a la vez;
--   - sin email ni telefono NO se crea contacto (decision 156): la respuesta queda
--     `no_contact` y NO dispara automatizaciones (`automation_events.contact_id`
--     es obligatorio);
--   - modo `create_or_link` o `link_only`; para el que ya existe, `fill_empty`
--     (solo lo vacio) u `overwrite` (con lo que vino, nunca con un vacio);
--   - campos personalizados y etiquetas (`ON CONFLICT DO NOTHING`);
--   - encuestas: `score`, `nps_category` y `once_key` ("una vez por contacto"; el
--     choque devuelve `already_answered` ANTES de tocar el contacto);
--   - un evento por respuesta segun el tipo (`form_submitted` | `survey_answered`;
--     el del contrato lo emite la 00157 al registrar la firma), con un payload de
--     SOLO escalares y sin `booking_id` (el cron trata como "reserva" cualquier
--     payload con `booking_id` y saltearia "no contactar");
--   - `audit_log` como sistema ("Formulario: <nombre>") cuando se crea o vincula;
--   - `service_id` y `sale_id` solo si vinieron de un link firmado valido.
--
-- El toque de atribucion lo anota TypeScript DESPUES del commit
-- (`record_contact_touch` no se toca).
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
  v_form      public.forms%ROWTYPE;
  v_id        uuid;
  v_existing  public.form_submissions%ROWTYPE;
  v_hint      jsonb := COALESCE(p_contact_hint, '{}'::jsonb);
  v_mode      text;
  v_overwrite boolean;
  v_name      text := nullif(btrim(v_hint ->> 'display_name'), '');
  v_email     text := public.normalize_email(v_hint ->> 'email');
  v_phone     text := nullif(btrim(v_hint ->> 'phone'), '');
  v_wa        text := nullif(btrim(v_hint ->> 'whatsapp_phone'), '');
  v_country   text := nullif(btrim(v_hint ->> 'country'), '');
  v_signed    uuid;
  v_service   uuid;
  v_sale      uuid;
  v_contact   uuid;
  v_created   boolean := false;
  v_matched   text;
  v_conflict  uuid;
  v_found     jsonb;
  v_status    text := 'no_contact';
  v_score     integer;
  v_nps       text;
  v_once      text;
  v_event     text;
  v_score_key text;
  v_field     record;
  v_first_touch jsonb;
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

  -- Mismo pedido a la vez (doble clic, reintento de red, dos pestañas): se hacen en fila.
  PERFORM pg_advisory_xact_lock(hashtextextended('form-submit:' || p_form_id::text || ':' || p_idempotency_key::text, 0));

  SELECT * INTO v_existing
  FROM public.form_submissions
  WHERE form_id = p_form_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'duplicate', true,
      'submission_id', v_existing.id, 'status', v_existing.status,
      'contact_id', v_existing.contact_id, 'contact_created', v_existing.contact_created
    );
  END IF;

  v_mode := COALESCE(v_form.contact_config ->> 'mode', 'create_or_link');
  v_overwrite := COALESCE(v_form.contact_config ->> 'update', 'fill_empty') = 'overwrite';

  -- Los ids del link firmado: solo se aceptan si el contacto existe en ESTE workspace.
  IF (v_hint ->> 'signed_contact_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT c.id INTO v_signed
    FROM public.contacts c
    WHERE c.id = (v_hint ->> 'signed_contact_id')::uuid
      AND c.workspace_id = v_form.workspace_id AND c.deleted_at IS NULL;
  END IF;
  IF v_signed IS NOT NULL THEN
    IF (v_hint ->> 'signed_service_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_service := (v_hint ->> 'signed_service_id')::uuid;
    END IF;
    IF (v_hint ->> 'signed_sale_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_sale := (v_hint ->> 'signed_sale_id')::uuid;
    END IF;
  END IF;

  -- 1. Resolver el contacto (todavia sin tocar nada).
  IF v_signed IS NOT NULL THEN
    v_contact := v_signed;
    v_matched := 'link';
  ELSIF v_phone IS NOT NULL OR v_wa IS NOT NULL OR v_email IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('form-contact:' || v_form.workspace_id::text || ':' || COALESCE(v_phone, v_wa, v_email), 0));
    v_found := public.find_contact_by_phone_or_email(v_form.workspace_id, COALESCE(v_phone, v_wa), v_email);
    IF v_found ->> 'contact_id' IS NULL AND v_phone IS NOT NULL AND v_wa IS NOT NULL AND v_wa <> v_phone THEN
      -- Tiene dos telefonos y el primero no estaba: se prueba con el de WhatsApp.
      v_found := public.find_contact_by_phone_or_email(v_form.workspace_id, v_wa, v_email);
    END IF;
    v_contact := (v_found ->> 'contact_id')::uuid;
    v_matched := v_found ->> 'matched_by';
    v_conflict := (v_found ->> 'conflict_contact_id')::uuid;
  END IF;

  -- 2. Encuesta: puntaje, categoria y "una vez por contacto".
  IF v_form.type = 'survey' THEN
    v_score_key := v_form.survey_config ->> 'scoreFieldKey';
    IF v_score_key IS NOT NULL AND jsonb_typeof(p_answers -> v_score_key -> 'value') = 'number' THEN
      v_score := round((p_answers -> v_score_key ->> 'value')::numeric)::integer;
      IF p_answers -> v_score_key ->> 'type' = 'nps' THEN
        v_nps := CASE WHEN v_score >= 9 THEN 'promoter' WHEN v_score >= 7 THEN 'passive' ELSE 'detractor' END;
      END IF;
    END IF;

    IF COALESCE((v_form.survey_config ->> 'oncePerContact')::boolean, false) THEN
      IF v_contact IS NOT NULL THEN
        v_once := 'contact:' || v_contact::text;
      ELSIF v_email IS NOT NULL THEN
        v_once := 'email:' || v_email;
      END IF;
      IF v_once IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.form_submissions s
        WHERE s.form_id = p_form_id AND s.once_key = v_once AND s.status <> 'spam'
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'already_answered');
      END IF;
    END IF;
  END IF;

  -- 3. Crear o completar el contacto.
  IF v_contact IS NULL THEN
    IF v_mode = 'create_or_link' AND (v_email IS NOT NULL OR v_phone IS NOT NULL OR v_wa IS NOT NULL) THEN
      INSERT INTO public.contacts
        (workspace_id, display_name, email, phone, whatsapp_phone, country, attribution, last_interaction_at)
      VALUES (
        v_form.workspace_id, v_name, v_email, v_phone, v_wa, v_country,
        jsonb_build_object('source', 'form', 'referrer', p_attribution ->> 'referrer_url'),
        now()
      )
      RETURNING id INTO v_contact;
      v_created := true;
      v_matched := NULL;
    END IF;
  ELSE
    UPDATE public.contacts c
    SET display_name = CASE WHEN v_overwrite THEN COALESCE(v_name, c.display_name)
                            WHEN COALESCE(btrim(c.display_name), '') = '' THEN v_name ELSE c.display_name END,
        email        = CASE WHEN v_overwrite THEN COALESCE(v_email, c.email)
                            WHEN COALESCE(btrim(c.email), '') = '' THEN v_email ELSE c.email END,
        phone        = CASE WHEN v_overwrite THEN COALESCE(v_phone, c.phone)
                            WHEN COALESCE(btrim(c.phone), '') = '' THEN v_phone ELSE c.phone END,
        whatsapp_phone = CASE WHEN v_overwrite THEN COALESCE(v_wa, c.whatsapp_phone)
                              WHEN COALESCE(btrim(c.whatsapp_phone), '') = '' THEN v_wa ELSE c.whatsapp_phone END,
        country      = CASE WHEN v_overwrite THEN COALESCE(v_country, c.country)
                            WHEN COALESCE(btrim(c.country), '') = '' THEN v_country ELSE c.country END,
        last_interaction_at = now()
    WHERE c.id = v_contact AND c.workspace_id = v_form.workspace_id;
  END IF;

  IF v_contact IS NOT NULL THEN
    v_status := 'received';
    IF v_once IS NULL AND v_form.type = 'survey' AND COALESCE((v_form.survey_config ->> 'oncePerContact')::boolean, false) THEN
      v_once := 'contact:' || v_contact::text;
    END IF;

    -- Campos personalizados (solo los que siguen existiendo en este workspace).
    IF jsonb_typeof(v_hint -> 'custom') = 'object' THEN
      FOR v_field IN
        SELECT d.id AS field_id, e.value AS value
        FROM jsonb_each_text(v_hint -> 'custom') e
        JOIN public.custom_field_definitions d
          ON d.id::text = e.key AND d.workspace_id = v_form.workspace_id AND d.deleted_at IS NULL
        WHERE btrim(e.value) <> ''
      LOOP
        INSERT INTO public.contact_custom_fields (contact_id, field_id, value)
        VALUES (v_contact, v_field.field_id, v_field.value)
        ON CONFLICT (contact_id, field_id) DO UPDATE
          SET value = EXCLUDED.value, updated_at = now()
          WHERE v_overwrite OR btrim(public.contact_custom_fields.value) = '';
      END LOOP;
    END IF;

    -- Etiquetas del formulario (las del workspace; las repetidas no hacen nada).
    IF COALESCE(array_length(v_form.tags_on_submit, 1), 0) > 0 THEN
      INSERT INTO public.contact_tags (contact_id, tag_id)
      SELECT v_contact, t.id FROM public.tags t
      WHERE t.workspace_id = v_form.workspace_id AND t.id = ANY (v_form.tags_on_submit)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- 4. La respuesta.
  BEGIN
    INSERT INTO public.form_submissions
      (workspace_id, form_id, form_version_id, idempotency_key, status, answers,
       contact_id, contact_created, dedupe, score, nps_category, once_key,
       attribution, meta, upload_prefix, sale_id, service_id)
    VALUES
      (v_form.workspace_id, p_form_id, p_version_id, p_idempotency_key, v_status, p_answers,
       v_contact, v_created,
       jsonb_build_object('matched_by', v_matched, 'conflict_contact_id', v_conflict),
       v_score, v_nps, v_once,
       COALESCE(p_attribution, '{}'::jsonb), COALESCE(p_meta, '{}'::jsonb), p_extra ->> 'upload_prefix',
       v_sale, v_service)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Carrera por "una vez por contacto": otra respuesta del mismo contacto se guardo en el medio.
    RETURN jsonb_build_object('ok', false, 'error', 'already_answered');
  END;

  -- 5. Historial, y el evento de automatizacion (solo con contacto).
  IF v_contact IS NOT NULL THEN
    IF v_created OR v_matched IS NOT NULL THEN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by, actor_type, actor_label)
      VALUES (
        v_form.workspace_id, 'contact', v_contact,
        CASE WHEN v_created THEN 'contact.created' ELSE 'contact.linked' END,
        jsonb_build_object('source', 'form', 'form_id', p_form_id, 'submission_id', v_id, 'matched_by', v_matched),
        NULL, 'system', 'Formulario: ' || v_form.name
      );
    END IF;

    v_event := CASE v_form.type WHEN 'custom' THEN 'form_submitted' WHEN 'survey' THEN 'survey_answered' ELSE NULL END;
    IF v_event IS NOT NULL THEN
      INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
      VALUES (
        v_form.workspace_id, v_event, v_contact,
        jsonb_strip_nulls(jsonb_build_object(
          'submission_id', v_id, 'form_id', p_form_id, 'form_type', v_form.type,
          'score', v_score, 'nps_category', v_nps
        ))
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'submission_id', v_id,
    'status', v_status,
    'contact_id', v_contact,
    'contact_created', v_created,
    'matched_by', v_matched,
    'conflict_contact_id', v_conflict
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;
