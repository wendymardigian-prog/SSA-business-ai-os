-- ============================================================================
-- 00164 — Ventas (B3, F26b): submit_form_response valida el sale_id del link firmado (v4)
-- ============================================================================
-- Hasta ahora la funcion guardaba el 'signed_sale_id' del link firmado SIN validarlo (la 00150
-- dejo la columna a la espera de Ventas). Ahora, partiendo de la definicion VIGENTE (v3 de la
-- 00157 con la correccion de la 00158; md5 9d28625fbbe3faabd5e438a26d445788 al escribir esta
-- migracion), suma tres cosas y NADA mas:
--   1. Valida que la venta exista, sea de este workspace y sea del MISMO contacto de la respuesta.
--      Si no se cumple, el sale_id se DESCARTA (queda null) y se anota meta.sale_id_discarded = true
--      con meta.sale_id_discard_reason ('no_contact' | 'not_found' | 'other_contact'). La respuesta
--      y la firma se guardan igual.
--   2. El sale_id validado queda en form_submissions.sale_id; record_contract_signature (que NO
--      cambia) lo copia a contract_signatures.sale_id.
--   3. El payload de form_submitted, survey_answered y contract_signed suma 'sale_id' (solo
--      escalares; si es null, jsonb_strip_nulls lo saca, como los demas).
-- La firma es la misma: submit_form_response(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb).
-- lib/sales/submit-form-response-diff.test.ts comprueba que el diff contra la 00158 se limita a
-- lineas del sale_id.
--
-- Como volver atras: pegar la definicion de la cabecera (CREATE OR REPLACE) y nada mas.
--
-- ---- definicion vigente de submit_form_response (pg_get_functiondef), para volver atras ----
--   CREATE OR REPLACE FUNCTION public.submit_form_response(p_form_id uuid, p_version_id uuid, p_idempotency_key uuid, p_answers jsonb, p_attribution jsonb, p_meta jsonb, p_contact_hint jsonb DEFAULT '{}'::jsonb, p_extra jsonb DEFAULT '{}'::jsonb)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_form      public.forms%ROWTYPE;
--     v_id        uuid;
--     v_existing  public.form_submissions%ROWTYPE;
--     v_hint      jsonb := COALESCE(p_contact_hint, '{}'::jsonb);
--     v_mode      text;
--     v_overwrite boolean;
--     v_name      text := nullif(btrim(v_hint ->> 'display_name'), '');
--     v_email     text := public.normalize_email(v_hint ->> 'email');
--     v_phone     text := nullif(btrim(v_hint ->> 'phone'), '');
--     v_wa        text := nullif(btrim(v_hint ->> 'whatsapp_phone'), '');
--     v_country   text := nullif(btrim(v_hint ->> 'country'), '');
--     v_signed    uuid;
--     v_service   uuid;
--     v_sale      uuid;
--     v_contact   uuid;
--     v_created   boolean := false;
--     v_matched   text;
--     v_conflict  uuid;
--     v_found     jsonb;
--     v_status    text := 'no_contact';
--     v_score     integer;
--     v_nps       text;
--     v_once      text;
--     v_event     text;
--     v_score_key text;
--     v_field     record;
--     v_first_touch jsonb;
--     v_version   public.form_versions%ROWTYPE;
--     v_sig       uuid;
--   BEGIN
--     SELECT * INTO v_form FROM public.forms WHERE id = p_form_id;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'El formulario no existe' USING ERRCODE = 'no_data_found';
--     END IF;
--
--     IF NOT EXISTS (
--       SELECT 1 FROM public.form_versions v WHERE v.id = p_version_id AND v.form_id = p_form_id
--     ) THEN
--       RAISE EXCEPTION 'La version no es de este formulario' USING ERRCODE = 'foreign_key_violation';
--     END IF;
--
--     -- Contrato: la huella de la version se vuelve a calcular AHORA, sobre el texto guardado. Si no
--     -- coincide con la que se guardo al publicar, algo se corrompio: la firma falla y la excepcion
--     -- deshace TODO (ni la respuesta, ni el contacto, ni el job). Nada de lo que manda el navegador
--     -- entra en la huella: el pedido ni siquiera trae el texto.
--     IF v_form.type = 'contract' THEN
--       SELECT * INTO v_version FROM public.form_versions WHERE id = p_version_id;
--       IF v_version.contract_text IS NULL
--          OR v_version.contract_text_sha256 IS NULL
--          OR encode(sha256(convert_to(v_version.contract_text, 'UTF8')), 'hex') <> v_version.contract_text_sha256 THEN
--         RAISE EXCEPTION 'La huella del contrato no coincide con su texto' USING ERRCODE = 'data_exception';
--       END IF;
--     END IF;
--
--     -- Mismo pedido a la vez (doble clic, reintento de red, dos pestañas): se hacen en fila.
--     PERFORM pg_advisory_xact_lock(hashtextextended('form-submit:' || p_form_id::text || ':' || p_idempotency_key::text, 0));
--
--     SELECT * INTO v_existing
--     FROM public.form_submissions
--     WHERE form_id = p_form_id AND idempotency_key = p_idempotency_key;
--     IF FOUND THEN
--       RETURN jsonb_build_object(
--         'ok', true, 'duplicate', true,
--         'submission_id', v_existing.id, 'status', v_existing.status,
--         'contact_id', v_existing.contact_id, 'contact_created', v_existing.contact_created
--       );
--     END IF;
--
--     v_mode := COALESCE(v_form.contact_config ->> 'mode', 'create_or_link');
--     v_overwrite := COALESCE(v_form.contact_config ->> 'update', 'fill_empty') = 'overwrite';
--
--     -- Los ids del link firmado: solo se aceptan si el contacto existe en ESTE workspace.
--     IF (v_hint ->> 'signed_contact_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
--       SELECT c.id INTO v_signed
--       FROM public.contacts c
--       WHERE c.id = (v_hint ->> 'signed_contact_id')::uuid
--         AND c.workspace_id = v_form.workspace_id AND c.deleted_at IS NULL;
--     END IF;
--     IF v_signed IS NOT NULL THEN
--       IF (v_hint ->> 'signed_service_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
--         v_service := (v_hint ->> 'signed_service_id')::uuid;
--       END IF;
--       IF (v_hint ->> 'signed_sale_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
--         v_sale := (v_hint ->> 'signed_sale_id')::uuid;
--       END IF;
--     END IF;
--
--     -- 1. Resolver el contacto (todavia sin tocar nada).
--     IF v_signed IS NOT NULL THEN
--       v_contact := v_signed;
--       v_matched := 'link';
--     ELSIF v_phone IS NOT NULL OR v_wa IS NOT NULL OR v_email IS NOT NULL THEN
--       PERFORM pg_advisory_xact_lock(hashtextextended('form-contact:' || v_form.workspace_id::text || ':' || COALESCE(v_phone, v_wa, v_email), 0));
--       v_found := public.find_contact_by_phone_or_email(v_form.workspace_id, COALESCE(v_phone, v_wa), v_email);
--       IF v_found ->> 'contact_id' IS NULL AND v_phone IS NOT NULL AND v_wa IS NOT NULL AND v_wa <> v_phone THEN
--         -- Tiene dos telefonos y el primero no estaba: se prueba con el de WhatsApp.
--         v_found := public.find_contact_by_phone_or_email(v_form.workspace_id, v_wa, v_email);
--       END IF;
--       v_contact := (v_found ->> 'contact_id')::uuid;
--       v_matched := v_found ->> 'matched_by';
--       v_conflict := (v_found ->> 'conflict_contact_id')::uuid;
--     END IF;
--
--     -- 2. Encuesta: puntaje, categoria y "una vez por contacto".
--     IF v_form.type = 'survey' THEN
--       v_score_key := v_form.survey_config ->> 'scoreFieldKey';
--       IF v_score_key IS NOT NULL AND jsonb_typeof(p_answers -> v_score_key -> 'value') = 'number' THEN
--         v_score := round((p_answers -> v_score_key ->> 'value')::numeric)::integer;
--         IF p_answers -> v_score_key ->> 'type' = 'nps' THEN
--           v_nps := CASE WHEN v_score >= 9 THEN 'promoter' WHEN v_score >= 7 THEN 'passive' ELSE 'detractor' END;
--         END IF;
--       END IF;
--
--       IF COALESCE((v_form.survey_config ->> 'oncePerContact')::boolean, false) THEN
--         IF v_contact IS NOT NULL THEN
--           v_once := 'contact:' || v_contact::text;
--         ELSIF v_email IS NOT NULL THEN
--           v_once := 'email:' || v_email;
--         END IF;
--         -- Se miran las DOS claves: una respuesta anterior pudo guardarse con el email (el contacto
--         -- todavia no existia) o con el contacto. Con una sola, la segunda respuesta de alguien que
--         -- se creo con la primera no se detectaba.
--         IF EXISTS (
--           SELECT 1 FROM public.form_submissions s
--           WHERE s.form_id = p_form_id AND s.status <> 'spam'
--             AND s.once_key = ANY (array_remove(ARRAY[
--               CASE WHEN v_contact IS NOT NULL THEN 'contact:' || v_contact::text END,
--               CASE WHEN v_email IS NOT NULL THEN 'email:' || v_email END
--             ], NULL))
--         ) THEN
--           RETURN jsonb_build_object('ok', false, 'error', 'already_answered');
--         END IF;
--       END IF;
--     END IF;
--
--     -- 3. Crear o completar el contacto.
--     IF v_contact IS NULL THEN
--       IF v_mode = 'create_or_link' AND (v_email IS NOT NULL OR v_phone IS NOT NULL OR v_wa IS NOT NULL) THEN
--         INSERT INTO public.contacts
--           (workspace_id, display_name, email, phone, whatsapp_phone, country, attribution, last_interaction_at)
--         VALUES (
--           v_form.workspace_id, v_name, v_email, v_phone, v_wa, v_country,
--           jsonb_build_object('source', 'form', 'referrer', p_attribution ->> 'referrer_url'),
--           now()
--         )
--         RETURNING id INTO v_contact;
--         v_created := true;
--         v_matched := NULL;
--       END IF;
--     ELSE
--       UPDATE public.contacts c
--       SET display_name = CASE WHEN v_overwrite THEN COALESCE(v_name, c.display_name)
--                               WHEN COALESCE(btrim(c.display_name), '') = '' THEN v_name ELSE c.display_name END,
--           email        = CASE WHEN v_overwrite THEN COALESCE(v_email, c.email)
--                               WHEN COALESCE(btrim(c.email), '') = '' THEN v_email ELSE c.email END,
--           phone        = CASE WHEN v_overwrite THEN COALESCE(v_phone, c.phone)
--                               WHEN COALESCE(btrim(c.phone), '') = '' THEN v_phone ELSE c.phone END,
--           whatsapp_phone = CASE WHEN v_overwrite THEN COALESCE(v_wa, c.whatsapp_phone)
--                                 WHEN COALESCE(btrim(c.whatsapp_phone), '') = '' THEN v_wa ELSE c.whatsapp_phone END,
--           country      = CASE WHEN v_overwrite THEN COALESCE(v_country, c.country)
--                               WHEN COALESCE(btrim(c.country), '') = '' THEN v_country ELSE c.country END,
--           last_interaction_at = now()
--       WHERE c.id = v_contact AND c.workspace_id = v_form.workspace_id;
--     END IF;
--
--     IF v_contact IS NOT NULL THEN
--       v_status := 'received';
--       -- Con contacto (existente o recien creado), la clave es SIEMPRE la del contacto: la del email
--       -- solo vale para quien responde sin que se pueda identificar un contacto.
--       IF v_form.type = 'survey' AND COALESCE((v_form.survey_config ->> 'oncePerContact')::boolean, false) THEN
--         v_once := 'contact:' || v_contact::text;
--       END IF;
--
--       -- Campos personalizados (solo los que siguen existiendo en este workspace).
--       IF jsonb_typeof(v_hint -> 'custom') = 'object' THEN
--         FOR v_field IN
--           SELECT d.id AS field_id, e.value AS value
--           FROM jsonb_each_text(v_hint -> 'custom') e
--           JOIN public.custom_field_definitions d
--             ON d.id::text = e.key AND d.workspace_id = v_form.workspace_id AND d.deleted_at IS NULL
--           WHERE btrim(e.value) <> ''
--         LOOP
--           INSERT INTO public.contact_custom_fields (contact_id, field_id, value)
--           VALUES (v_contact, v_field.field_id, v_field.value)
--           ON CONFLICT (contact_id, field_id) DO UPDATE
--             SET value = EXCLUDED.value, updated_at = now()
--             WHERE v_overwrite OR btrim(public.contact_custom_fields.value) = '';
--         END LOOP;
--       END IF;
--
--       -- Etiquetas del formulario (las del workspace; las repetidas no hacen nada).
--       IF COALESCE(array_length(v_form.tags_on_submit, 1), 0) > 0 THEN
--         INSERT INTO public.contact_tags (contact_id, tag_id)
--         SELECT v_contact, t.id FROM public.tags t
--         WHERE t.workspace_id = v_form.workspace_id AND t.id = ANY (v_form.tags_on_submit)
--         ON CONFLICT DO NOTHING;
--       END IF;
--     END IF;
--
--     -- 4. La respuesta.
--     BEGIN
--       INSERT INTO public.form_submissions
--         (workspace_id, form_id, form_version_id, idempotency_key, status, answers,
--          contact_id, contact_created, dedupe, score, nps_category, once_key,
--          attribution, meta, upload_prefix, sale_id, service_id)
--       VALUES
--         (v_form.workspace_id, p_form_id, p_version_id, p_idempotency_key, v_status, p_answers,
--          v_contact, v_created,
--          jsonb_build_object('matched_by', v_matched, 'conflict_contact_id', v_conflict),
--          v_score, v_nps, v_once,
--          COALESCE(p_attribution, '{}'::jsonb), COALESCE(p_meta, '{}'::jsonb), p_extra ->> 'upload_prefix',
--          v_sale, v_service)
--       RETURNING id INTO v_id;
--     EXCEPTION WHEN unique_violation THEN
--       -- Carrera por "una vez por contacto": otra respuesta del mismo contacto se guardo en el medio.
--       RETURN jsonb_build_object('ok', false, 'error', 'already_answered');
--     END;
--
--     -- 4b. Contrato: la firma, en la MISMA transaccion que la respuesta. `record_contract_signature`
--     -- guarda la huella, la metadata legal y encola el PDF; si algo falla, no queda nada.
--     IF v_form.type = 'contract' THEN
--       v_sig := public.record_contract_signature(
--         v_id,
--         nullif(p_extra ->> 'signature_path', ''),
--         COALESCE(p_extra -> 'legal', '{}'::jsonb),
--         COALESCE(p_extra ->> 'signer_name', ''),
--         p_extra ->> 'signer_email'
--       );
--     END IF;
--
--     -- 5. Historial, y el evento de automatizacion (solo con contacto).
--     IF v_contact IS NOT NULL THEN
--       IF v_created OR v_matched IS NOT NULL THEN
--         INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by, actor_type, actor_label)
--         VALUES (
--           v_form.workspace_id, 'contact', v_contact,
--           CASE WHEN v_created THEN 'contact.created' ELSE 'contact.linked' END,
--           jsonb_build_object('source', 'form', 'form_id', p_form_id, 'submission_id', v_id, 'matched_by', v_matched),
--           NULL, 'system', 'Formulario: ' || v_form.name
--         );
--       END IF;
--
--       v_event := CASE v_form.type WHEN 'custom' THEN 'form_submitted' WHEN 'survey' THEN 'survey_answered' WHEN 'contract' THEN 'contract_signed' ELSE NULL END;
--       IF v_event IS NOT NULL THEN
--         INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
--         VALUES (
--           v_form.workspace_id, v_event, v_contact,
--           jsonb_strip_nulls(jsonb_build_object(
--             'submission_id', v_id, 'form_id', p_form_id, 'form_type', v_form.type,
--             'score', v_score, 'nps_category', v_nps
--           ))
--         );
--       END IF;
--     END IF;
--
--     RETURN jsonb_build_object(
--       'ok', true,
--       'duplicate', false,
--       'submission_id', v_id,
--       'status', v_status,
--       'contact_id', v_contact,
--       'contact_created', v_created,
--       'matched_by', v_matched,
--       'conflict_contact_id', v_conflict,
--       'signature_id', v_sig
--     );
--   END;
--   $function$
-- ---- fin de la definicion anterior ------------------------------------------

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
  v_version   public.form_versions%ROWTYPE;
  v_sig       uuid;
  v_sale_reason text;
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

  -- Contrato: la huella de la version se vuelve a calcular AHORA, sobre el texto guardado. Si no
  -- coincide con la que se guardo al publicar, algo se corrompio: la firma falla y la excepcion
  -- deshace TODO (ni la respuesta, ni el contacto, ni el job). Nada de lo que manda el navegador
  -- entra en la huella: el pedido ni siquiera trae el texto.
  IF v_form.type = 'contract' THEN
    SELECT * INTO v_version FROM public.form_versions WHERE id = p_version_id;
    IF v_version.contract_text IS NULL
       OR v_version.contract_text_sha256 IS NULL
       OR encode(sha256(convert_to(v_version.contract_text, 'UTF8')), 'hex') <> v_version.contract_text_sha256 THEN
      RAISE EXCEPTION 'La huella del contrato no coincide con su texto' USING ERRCODE = 'data_exception';
    END IF;
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
      -- Se miran las DOS claves: una respuesta anterior pudo guardarse con el email (el contacto
      -- todavia no existia) o con el contacto. Con una sola, la segunda respuesta de alguien que
      -- se creo con la primera no se detectaba.
      IF EXISTS (
        SELECT 1 FROM public.form_submissions s
        WHERE s.form_id = p_form_id AND s.status <> 'spam'
          AND s.once_key = ANY (array_remove(ARRAY[
            CASE WHEN v_contact IS NOT NULL THEN 'contact:' || v_contact::text END,
            CASE WHEN v_email IS NOT NULL THEN 'email:' || v_email END
          ], NULL))
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
    -- Con contacto (existente o recien creado), la clave es SIEMPRE la del contacto: la del email
    -- solo vale para quien responde sin que se pueda identificar un contacto.
    IF v_form.type = 'survey' AND COALESCE((v_form.survey_config ->> 'oncePerContact')::boolean, false) THEN
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

  -- 3b. La venta del link firmado (Ventas, 00164): el 'signed_sale_id' solo vale si la venta existe,
  -- es de ESTE workspace y es del MISMO contacto de la respuesta. Si no, se descarta (queda null) y
  -- se anota en meta; la respuesta y la firma se guardan igual.
  IF v_sale IS NOT NULL THEN
    IF v_contact IS NULL THEN v_sale_reason := 'no_contact';
    ELSIF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.id = v_sale AND s.workspace_id = v_form.workspace_id) THEN v_sale_reason := 'not_found';
    ELSIF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.id = v_sale AND s.contact_id = v_contact) THEN v_sale_reason := 'other_contact';
    END IF;
    IF v_sale_reason IS NOT NULL THEN
      v_sale := NULL;
      p_meta := COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('sale_id_discarded', true, 'sale_id_discard_reason', v_sale_reason);
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

  -- 4b. Contrato: la firma, en la MISMA transaccion que la respuesta. `record_contract_signature`
  -- guarda la huella, la metadata legal y encola el PDF; si algo falla, no queda nada.
  IF v_form.type = 'contract' THEN
    v_sig := public.record_contract_signature(
      v_id,
      nullif(p_extra ->> 'signature_path', ''),
      COALESCE(p_extra -> 'legal', '{}'::jsonb),
      COALESCE(p_extra ->> 'signer_name', ''),
      p_extra ->> 'signer_email'
    );
  END IF;

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

    v_event := CASE v_form.type WHEN 'custom' THEN 'form_submitted' WHEN 'survey' THEN 'survey_answered' WHEN 'contract' THEN 'contract_signed' ELSE NULL END;
    IF v_event IS NOT NULL THEN
      INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
      VALUES (
        v_form.workspace_id, v_event, v_contact,
        jsonb_strip_nulls(jsonb_build_object(
          'submission_id', v_id, 'form_id', p_form_id, 'form_type', v_form.type,
          'score', v_score, 'nps_category', v_nps, 'sale_id', v_sale
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
    'conflict_contact_id', v_conflict,
    'signature_id', v_sig
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;
