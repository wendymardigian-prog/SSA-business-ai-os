-- ============================================================================
-- 00176 — submit_form_response v5: modo "none" y usuarios de redes sociales (Formularios, R3 + R5d)
-- ============================================================================
-- Parte de la definicion VIVA (v4 de Ventas, 00164; md5 bbaaaa563adedf837337d95a8691515d al escribir esta migracion) y cambia SOLO:
--   R3. `contact_config.mode = 'none'`: la respuesta no resuelve, no crea ni actualiza ningun contacto, tampoco
--       con un link firmado (los datos del hint se descartan en la base). Queda `no_contact`.
--   R5. Usa `find_contact_for_form` (00175) con los usuarios de Instagram, TikTok, X y LinkedIn del
--       `p_contact_hint.social`, ya normalizados por el servidor (y vueltos a validar aca).
--       - El lock de concurrencia toma un lock por cada identificador, en orden fijo (dos respuestas con el mismo
--         @ nuevo dejan UN contacto).
--       - Crear: inserta tambien las columnas de redes; sin nombre y solo con un @, el @ hace de nombre.
--       - Completar o pisar: las redes siguen fill_empty / overwrite. `instagram_username` NUNCA se pisa si el
--         contacto tiene un canal de Instagram vinculado. Un usuario que ya es de otro contacto no se escribe.
--       - `dedupe.conflicts`: [{ by, contact_id }] ademas de `conflict_contact_id` (el primero distinto).
-- Todo lo demas (validacion del sale_id, huella y firma del contrato, evento, audit_log, "una vez por
-- contacto") queda igual: lib/forms/submit-form-response-diff.test.ts lo comprueba linea por linea.
-- La firma es la misma: submit_form_response(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb).
-- Riesgo: ALTO (la funcion mas cara del modulo). Compatible hacia atras: el codigo viejo manda un
-- `p_contact_hint` sin redes y un `mode` que ya existia, y todo sigue igual. Se aplica ANTES de desplegar.
--
-- Como volver atras: pegar la definicion de abajo (CREATE OR REPLACE) y nada mas.
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
--     v_sale_reason text;
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
--     -- 3b. La venta del link firmado (Ventas, 00164): el 'signed_sale_id' solo vale si la venta existe,
--     -- es de ESTE workspace y es del MISMO contacto de la respuesta. Si no, se descarta (queda null) y
--     -- se anota en meta; la respuesta y la firma se guardan igual.
--     IF v_sale IS NOT NULL THEN
--       IF v_contact IS NULL THEN v_sale_reason := 'no_contact';
--       ELSIF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.id = v_sale AND s.workspace_id = v_form.workspace_id) THEN v_sale_reason := 'not_found';
--       ELSIF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.id = v_sale AND s.contact_id = v_contact) THEN v_sale_reason := 'other_contact';
--       END IF;
--       IF v_sale_reason IS NOT NULL THEN
--         v_sale := NULL;
--         p_meta := COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('sale_id_discarded', true, 'sale_id_discard_reason', v_sale_reason);
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
--             'score', v_score, 'nps_category', v_nps, 'sale_id', v_sale
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
-- ============================================================================

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
  -- R5: usuarios de redes sociales. El servidor ya los normalizo; aca se vuelven a validar (la base manda).
  v_ig        text := CASE WHEN lower(btrim(regexp_replace(COALESCE(v_hint #>> '{social,instagram}', ''), '^@+', ''))) ~ '^[a-z0-9._]{1,30}$'
                           THEN lower(btrim(regexp_replace(v_hint #>> '{social,instagram}', '^@+', ''))) END;
  v_tt        text := CASE WHEN lower(btrim(regexp_replace(COALESCE(v_hint #>> '{social,tiktok}', ''), '^@+', ''))) ~ '^[a-z0-9._]{2,24}$'
                           THEN lower(btrim(regexp_replace(v_hint #>> '{social,tiktok}', '^@+', ''))) END;
  v_x         text := CASE WHEN lower(btrim(regexp_replace(COALESCE(v_hint #>> '{social,x}', ''), '^@+', ''))) ~ '^[a-z0-9_]{1,15}$'
                           THEN lower(btrim(regexp_replace(v_hint #>> '{social,x}', '^@+', ''))) END;
  v_li        text := CASE WHEN public.linkedin_slug(v_hint #>> '{social,linkedin}') IS NOT NULL
                           THEN 'https://www.linkedin.com/in/' || public.linkedin_slug(v_hint #>> '{social,linkedin}') END;
  v_fb        text := CASE WHEN length(regexp_replace(COALESCE(v_hint #>> '{social,facebook}', ''), '[\s@]', '', 'g')) BETWEEN 1 AND 200
                           THEN regexp_replace(v_hint #>> '{social,facebook}', '[\s@]', '', 'g') END;
  v_yt        text := CASE WHEN length(regexp_replace(COALESCE(v_hint #>> '{social,youtube}', ''), '[\s@]', '', 'g')) BETWEEN 1 AND 200
                           THEN regexp_replace(v_hint #>> '{social,youtube}', '[\s@]', '', 'g') END;
  v_social    jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_lock_key  text;
  v_has_ident boolean;
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

  -- R3: con el interruptor "Vincular las respuestas con contactos" apagado la respuesta no resuelve, no crea ni
  -- actualiza ningun contacto, tampoco con un link firmado. Lo que haya llegado en el hint se descarta aca,
  -- aunque el servidor ya no lo mande: la base es la que hace cumplir la regla.
  IF v_mode = 'none' THEN
    v_name := NULL; v_email := NULL; v_phone := NULL; v_wa := NULL; v_country := NULL;
    v_ig := NULL; v_tt := NULL; v_x := NULL; v_li := NULL; v_fb := NULL; v_yt := NULL;
    v_hint := '{}'::jsonb;
  END IF;
  v_has_ident := v_email IS NOT NULL OR v_phone IS NOT NULL OR v_wa IS NOT NULL
                 OR v_ig IS NOT NULL OR v_tt IS NOT NULL OR v_x IS NOT NULL OR v_li IS NOT NULL;
  v_social := jsonb_strip_nulls(jsonb_build_object('instagram', v_ig, 'tiktok', v_tt, 'x', v_x, 'linkedin', v_li));

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
  ELSIF v_has_ident THEN
    -- Un lock por cada dato con el que se puede identificar, SIEMPRE en el mismo orden (por clave): dos
    -- respuestas simultaneas con el mismo dato nuevo comparten al menos un lock, la segunda espera y ya ve el
    -- contacto de la primera. El orden fijo evita el interbloqueo.
    FOR v_lock_key IN
      SELECT k FROM unnest(ARRAY[
        'phone:' || v_phone, 'phone:' || v_wa, 'email:' || v_email,
        'instagram:' || v_ig, 'tiktok:' || v_tt, 'x:' || v_x, 'linkedin:' || v_li
      ]) AS k WHERE k IS NOT NULL ORDER BY k
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('form-contact:' || v_form.workspace_id::text || ':' || v_lock_key, 0));
    END LOOP;
    v_found := public.find_contact_for_form(v_form.workspace_id, COALESCE(v_phone, v_wa), v_email, v_social);
    IF v_found ->> 'contact_id' IS NULL AND v_phone IS NOT NULL AND v_wa IS NOT NULL AND v_wa <> v_phone THEN
      -- Tiene dos telefonos y el primero no estaba: se prueba con el de WhatsApp.
      v_found := public.find_contact_for_form(v_form.workspace_id, v_wa, v_email, v_social);
    END IF;
    v_contact := (v_found ->> 'contact_id')::uuid;
    v_matched := v_found ->> 'matched_by';
    v_conflict := (v_found ->> 'conflict_contact_id')::uuid;
    v_conflicts := COALESCE(v_found -> 'conflicts', '[]'::jsonb);
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
    IF v_mode = 'create_or_link' AND v_has_ident THEN
      INSERT INTO public.contacts
        (workspace_id, display_name, email, phone, whatsapp_phone, country,
         instagram_username, tiktok_username, twitter_username, linkedin_profile_url, facebook_id, youtube_channel_id,
         attribution, last_interaction_at)
      VALUES (
        v_form.workspace_id,
        -- Sin nombre y solo con un usuario de red social, el usuario hace de nombre ("@ana"): la app mostraria
        -- "Sin nombre" y la base lo marcaria como anonimo (is_anonymous solo mira Instagram, no TikTok/X/LinkedIn).
        COALESCE(v_name, CASE WHEN v_email IS NULL AND v_phone IS NULL AND v_wa IS NULL
                              THEN COALESCE('@' || v_ig, '@' || v_tt, '@' || v_x, public.linkedin_slug(v_li)) END),
        v_email, v_phone, v_wa, v_country,
        v_ig, v_tt, v_x, v_li, v_fb, v_yt,
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
        -- Redes sociales (R5): la misma regla fill_empty / overwrite. Un usuario que ya es de OTRO contacto
        -- (esta en `conflicts`) no se escribe: dejaria dos contactos con el mismo identificador.
        instagram_username = CASE
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_conflicts) k WHERE k ->> 'by' = 'instagram') THEN c.instagram_username
          -- Excepcion: el @ de un contacto con un canal de Instagram vinculado lo mantiene la conversacion real
          -- y un formulario no puede cambiarlo (ni siquiera con overwrite).
          WHEN EXISTS (SELECT 1 FROM public.contact_channels cc JOIN public.channels ch ON ch.id = cc.channel_id
                       WHERE cc.contact_id = c.id AND ch.platform = 'instagram') THEN c.instagram_username
          WHEN v_overwrite THEN COALESCE(v_ig, c.instagram_username)
          WHEN COALESCE(btrim(c.instagram_username), '') = '' THEN v_ig ELSE c.instagram_username END,
        tiktok_username = CASE
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_conflicts) k WHERE k ->> 'by' = 'tiktok') THEN c.tiktok_username
          WHEN v_overwrite THEN COALESCE(v_tt, c.tiktok_username)
          WHEN COALESCE(btrim(c.tiktok_username), '') = '' THEN v_tt ELSE c.tiktok_username END,
        twitter_username = CASE
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_conflicts) k WHERE k ->> 'by' = 'x') THEN c.twitter_username
          WHEN v_overwrite THEN COALESCE(v_x, c.twitter_username)
          WHEN COALESCE(btrim(c.twitter_username), '') = '' THEN v_x ELSE c.twitter_username END,
        linkedin_profile_url = CASE
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_conflicts) k WHERE k ->> 'by' = 'linkedin') THEN c.linkedin_profile_url
          WHEN v_overwrite THEN COALESCE(v_li, c.linkedin_profile_url)
          WHEN COALESCE(btrim(c.linkedin_profile_url), '') = '' THEN v_li ELSE c.linkedin_profile_url END,
        facebook_id  = CASE WHEN v_overwrite THEN COALESCE(v_fb, c.facebook_id)
                            WHEN COALESCE(btrim(c.facebook_id), '') = '' THEN v_fb ELSE c.facebook_id END,
        youtube_channel_id = CASE WHEN v_overwrite THEN COALESCE(v_yt, c.youtube_channel_id)
                                  WHEN COALESCE(btrim(c.youtube_channel_id), '') = '' THEN v_yt ELSE c.youtube_channel_id END,
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
       jsonb_build_object('matched_by', v_matched, 'conflict_contact_id', v_conflict)
         || CASE WHEN jsonb_array_length(v_conflicts) > 0 THEN jsonb_build_object('conflicts', v_conflicts) ELSE '{}'::jsonb END,
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
    'conflicts', v_conflicts,
    'signature_id', v_sig
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;
