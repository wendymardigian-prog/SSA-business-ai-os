-- ============================================================================
-- 00157 — Formularios: contratos firmados (tabla, funcion y submit_form_response v3)
-- ============================================================================
-- Modulo Formularios, F26. Aditiva + reescribe `submit_form_response` (propia de este modulo).
--
--   1. `contract_signatures`: una firma por respuesta de un contrato. Guarda la huella
--      SHA-256 del texto que se firmo, quien firmo, la imagen de la firma, la metadata legal
--      (la IP va en claro SOLO aca: es evidencia) y el estado del PDF y del email con la copia.
--      Lo que es evidencia (huella, texto, firmante, hora, metadata legal) NO se puede cambiar
--      despues: un trigger lo impide, tambien para el service role. El servidor solo actualiza
--      `pdf_*` y `email_*`.
--   2. `record_contract_signature(...)`: solo `service_role`. Vuelve a verificar la huella contra
--      `form_versions`, guarda la firma y ENCOLA el job `contract_pdf` (`contract_pdf:<firma>`).
--   3. `submit_form_response` v3: para un contrato verifica la huella ANTES de tocar nada y
--      llama a `record_contract_signature` en la misma transaccion que la respuesta; emite
--      `contract_signed` (no espera al PDF). Para los otros tipos es identica a la v2.
--
-- Decision (D-23): `record_contract_signature` recibe ademas `p_signer_name` y `p_signer_email`
-- (el plano solo nombraba tres parametros). Los calcula el SERVIDOR desde las respuestas ya
-- validadas; hacerlo en SQL obligaria a repetir la regla de "cual es el campo del firmante".
--
-- Como volver atras:
--   (antes) la v2 completa esta mas abajo, en esta cabecera: pegarla.
--   DROP FUNCTION IF EXISTS public.record_contract_signature(uuid, text, jsonb, text, text);
--   DROP TABLE IF EXISTS public.contract_signatures;
--   (sin firmas guardadas todavia, nada de lo anterior pierde datos)
--
-- ---- v2 de submit_form_response (00156), para volver atras ----------------
--   CREATE OR REPLACE FUNCTION public.submit_form_response(
--     p_form_id uuid,
--     p_version_id uuid,
--     p_idempotency_key uuid,
--     p_answers jsonb,
--     p_attribution jsonb,
--     p_meta jsonb,
--     p_contact_hint jsonb DEFAULT '{}'::jsonb,
--     p_extra jsonb DEFAULT '{}'::jsonb
--   )
--   RETURNS jsonb
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $$
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
--         IF v_once IS NOT NULL AND EXISTS (
--           SELECT 1 FROM public.form_submissions s
--           WHERE s.form_id = p_form_id AND s.once_key = v_once AND s.status <> 'spam'
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
--       IF v_once IS NULL AND v_form.type = 'survey' AND COALESCE((v_form.survey_config ->> 'oncePerContact')::boolean, false) THEN
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
--       v_event := CASE v_form.type WHEN 'custom' THEN 'form_submitted' WHEN 'survey' THEN 'survey_answered' ELSE NULL END;
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
--       'conflict_contact_id', v_conflict
--     );
--   END;
--   $$;
--
--   REVOKE ALL ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;
-- ---------------------------------------------------------------------------
-- ============================================================================

-- ------------------------------------------------------------
-- 1. contract_signatures
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contract_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES public.form_submissions(id),
  form_id uuid NOT NULL REFERENCES public.forms(id),
  form_version_id uuid NOT NULL REFERENCES public.form_versions(id),

  text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  signer_name text NOT NULL DEFAULT '',
  signer_email text NOT NULL CHECK (btrim(signer_email) <> ''),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  signature_path text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  legal jsonb NOT NULL,

  pdf_path text,
  pdf_status text NOT NULL DEFAULT 'pending' CHECK (pdf_status IN ('pending', 'generated', 'failed')),
  pdf_attempts integer NOT NULL DEFAULT 0,
  email_status text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'retrying', 'not_sent')),
  email_attempts integer NOT NULL DEFAULT 0,
  email_next_retry_at timestamptz,
  email_sent_at timestamptz,
  email_last_error text,

  -- Para Ventas y CX: sin FK (sales y services todavia no existen). Copiados de la respuesta.
  sale_id uuid,
  service_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contract_signatures_one_per_submission UNIQUE (submission_id)
);

COMMENT ON TABLE public.contract_signatures IS
  'Una firma por respuesta de un contrato. Escribe solo el servidor (record_contract_signature); la ve quien ve la respuesta. La evidencia (huella, texto, firmante, hora y metadata legal) no se puede cambiar.';
COMMENT ON COLUMN public.contract_signatures.legal IS
  'Metadata legal. La IP va en claro SOLO aca (es evidencia); en el resto del sistema va hasheada.';

CREATE INDEX IF NOT EXISTS idx_contract_signatures_form ON public.contract_signatures (form_id, signed_at DESC);
CREATE INDEX IF NOT EXISTS idx_contract_signatures_email_pending ON public.contract_signatures (email_status)
  WHERE email_status IN ('retrying', 'not_sent');

DROP TRIGGER IF EXISTS set_updated_at ON public.contract_signatures;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contract_signatures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- La evidencia no se toca despues de firmar (ni con el service role): solo cambian pdf_* y email_*.
CREATE OR REPLACE FUNCTION public.contract_signatures_protect_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.submission_id IS DISTINCT FROM OLD.submission_id
     OR NEW.form_id IS DISTINCT FROM OLD.form_id
     OR NEW.form_version_id IS DISTINCT FROM OLD.form_version_id
     OR NEW.text_sha256 IS DISTINCT FROM OLD.text_sha256
     OR NEW.signer_name IS DISTINCT FROM OLD.signer_name
     OR NEW.signer_email IS DISTINCT FROM OLD.signer_email
     OR NEW.signature_path IS DISTINCT FROM OLD.signature_path
     OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
     OR NEW.legal IS DISTINCT FROM OLD.legal
     OR NEW.sale_id IS DISTINCT FROM OLD.sale_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id THEN
    RAISE EXCEPTION 'La evidencia de una firma no se puede cambiar' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contract_signatures_protect ON public.contract_signatures;
CREATE TRIGGER contract_signatures_protect BEFORE UPDATE ON public.contract_signatures
  FOR EACH ROW EXECUTE FUNCTION public.contract_signatures_protect_evidence();

ALTER TABLE public.contract_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_signatures_select ON public.contract_signatures;
CREATE POLICY contract_signatures_select ON public.contract_signatures
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.form_submissions s
      WHERE s.id = contract_signatures.submission_id AND public.can_see_form_submission(s)
    )
  );

REVOKE ALL ON public.contract_signatures FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.contract_signatures FROM authenticated;

-- ------------------------------------------------------------
-- 2. record_contract_signature
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_contract_signature(
  p_submission_id uuid,
  p_signature_path text,
  p_legal jsonb,
  p_signer_name text DEFAULT '',
  p_signer_email text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sub     public.form_submissions%ROWTYPE;
  v_form    public.forms%ROWTYPE;
  v_version public.form_versions%ROWTYPE;
  v_id      uuid;
  v_email   text := lower(btrim(COALESCE(p_signer_email, '')));
BEGIN
  SELECT * INTO v_sub FROM public.form_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La respuesta no existe' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_form FROM public.forms WHERE id = v_sub.form_id;
  IF v_form.type <> 'contract' THEN
    RAISE EXCEPTION 'La respuesta no es de un contrato' USING ERRCODE = 'check_violation';
  END IF;

  -- Una firma por respuesta: repetir la llamada devuelve la misma.
  SELECT id INTO v_id FROM public.contract_signatures WHERE submission_id = p_submission_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  IF v_email = '' THEN
    RAISE EXCEPTION 'Falta el email del firmante' USING ERRCODE = 'not_null_violation';
  END IF;

  -- La huella es la de la version CON LA QUE SE GUARDO la respuesta, y se verifica de nuevo ahora.
  SELECT * INTO v_version FROM public.form_versions WHERE id = v_sub.form_version_id;
  IF v_version.contract_text IS NULL
     OR v_version.contract_text_sha256 IS NULL
     OR encode(sha256(convert_to(v_version.contract_text, 'UTF8')), 'hex') <> v_version.contract_text_sha256 THEN
    RAISE EXCEPTION 'La huella del contrato no coincide con su texto' USING ERRCODE = 'data_exception';
  END IF;

  INSERT INTO public.contract_signatures
    (workspace_id, submission_id, form_id, form_version_id, text_sha256, signer_name, signer_email,
     contact_id, signature_path, signed_at, legal, sale_id, service_id)
  VALUES
    (v_sub.workspace_id, v_sub.id, v_sub.form_id, v_sub.form_version_id, v_version.contract_text_sha256,
     left(btrim(COALESCE(p_signer_name, '')), 200), v_email,
     v_sub.contact_id, nullif(p_signature_path, ''), now(), COALESCE(p_legal, '{}'::jsonb),
     v_sub.sale_id, v_sub.service_id)
  RETURNING id INTO v_id;

  -- El PDF se genera en un job. Va en esta misma transaccion: sin firma no hay job, y al reves.
  INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
  VALUES ('contract_pdf', jsonb_build_object('signatureId', v_id), now(), 'contract_pdf:' || v_id::text)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_contract_signature(uuid, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_contract_signature(uuid, text, jsonb, text, text) TO service_role;

-- ------------------------------------------------------------
-- 3. submit_form_response v3
-- ------------------------------------------------------------
-- Lo nuevo respecto de la v2 (la v2 completa esta en la cabecera):
--   - contrato: verifica la huella de la version ANTES de tocar nada;
--   - contrato: llama a `record_contract_signature` en la misma transaccion y devuelve `signature_id`;
--   - contrato: emite `contract_signed` (si hay contacto), con el mismo payload de solo escalares.
-- Para custom y survey no cambia nada.
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
    'conflict_contact_id', v_conflict,
    'signature_id', v_sig
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_form_response(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;
