-- ============================================================
-- 00242_contract_rendered_text
-- ============================================================
-- Contratos en modo "Contrato" (21/10/2026): primero los datos, despues el texto
-- con esos datos, y la firma de ambas partes. Ver docs/formularios.md.
--
-- Lo que agrega:
--   1. `contract_signatures`: `rendered_text` (el texto EXACTO que firmo la persona,
--      con las variables ya completadas), `rendered_sha256` (su huella, la calcula
--      la base) y `business_signer` (la firma del negocio que se estampo: nombre,
--      cargo y la ruta de la imagen en el bucket privado `contracts`). Las tres son
--      evidencia: el trigger de proteccion las suma.
--   2. `public.contract_render_matches(template, rendered)`: true si `rendered` es
--      la plantilla con SOLO los huecos (`{{variable}}`) completados. Los pedazos
--      de texto fijo tienen que estar todos, en orden, sin cambios. Gemela de
--      `renderMatchesTemplate` (lib/forms/contract/variables.ts); los casos de
--      `render-match.cases.json` corren contra las dos.
--   3. `record_contract_signature` v2 (MISMA firma, asi `submit_form_response` no se
--      toca): si la respuesta trae `meta.contract_render.text` (lo arma el SERVIDOR
--      con la plantilla congelada y las respuestas ya validadas, nunca el navegador),
--      comprueba que corresponda a la plantilla, calcula su huella y lo guarda junto
--      con la firma del negocio. Una plantilla con variables SIN texto armado se
--      rechaza. Sin variables y sin texto armado, hace exactamente lo de antes.
--
-- La huella de la PLANTILLA (`text_sha256`, la de `form_versions`) sigue igual y se
-- sigue verificando: publicar una version nueva no toca firmas anteriores.
--
-- Definicion anterior de `record_contract_signature` (00157, leida de la base el
-- 21/10/2026), para volver atras:
--
--   CREATE OR REPLACE FUNCTION public.record_contract_signature(p_submission_id uuid, p_signature_path text, p_legal jsonb, p_signer_name text DEFAULT ''::text, p_signer_email text DEFAULT NULL::text)
--    RETURNS uuid
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_sub     public.form_submissions%ROWTYPE;
--     v_form    public.forms%ROWTYPE;
--     v_version public.form_versions%ROWTYPE;
--     v_id      uuid;
--     v_email   text := lower(btrim(COALESCE(p_signer_email, '')));
--   BEGIN
--     SELECT * INTO v_sub FROM public.form_submissions WHERE id = p_submission_id;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'La respuesta no existe' USING ERRCODE = 'no_data_found';
--     END IF;
--
--     SELECT * INTO v_form FROM public.forms WHERE id = v_sub.form_id;
--     IF v_form.type <> 'contract' THEN
--       RAISE EXCEPTION 'La respuesta no es de un contrato' USING ERRCODE = 'check_violation';
--     END IF;
--
--     -- Una firma por respuesta: repetir la llamada devuelve la misma.
--     SELECT id INTO v_id FROM public.contract_signatures WHERE submission_id = p_submission_id;
--     IF FOUND THEN
--       RETURN v_id;
--     END IF;
--
--     IF v_email = '' THEN
--       RAISE EXCEPTION 'Falta el email del firmante' USING ERRCODE = 'not_null_violation';
--     END IF;
--
--     -- La huella es la de la version CON LA QUE SE GUARDO la respuesta, y se verifica de nuevo ahora.
--     SELECT * INTO v_version FROM public.form_versions WHERE id = v_sub.form_version_id;
--     IF v_version.contract_text IS NULL
--        OR v_version.contract_text_sha256 IS NULL
--        OR encode(sha256(convert_to(v_version.contract_text, 'UTF8')), 'hex') <> v_version.contract_text_sha256 THEN
--       RAISE EXCEPTION 'La huella del contrato no coincide con su texto' USING ERRCODE = 'data_exception';
--     END IF;
--
--     INSERT INTO public.contract_signatures
--       (workspace_id, submission_id, form_id, form_version_id, text_sha256, signer_name, signer_email,
--        contact_id, signature_path, signed_at, legal, sale_id, service_id)
--     VALUES
--       (v_sub.workspace_id, v_sub.id, v_sub.form_id, v_sub.form_version_id, v_version.contract_text_sha256,
--        left(btrim(COALESCE(p_signer_name, '')), 200), v_email,
--        v_sub.contact_id, nullif(p_signature_path, ''), now(), COALESCE(p_legal, '{}'::jsonb),
--        v_sub.sale_id, v_sub.service_id)
--     RETURNING id INTO v_id;
--
--     -- El PDF se genera en un job. Va en esta misma transaccion: sin firma no hay job, y al reves.
--     INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
--     VALUES ('contract_pdf', jsonb_build_object('signatureId', v_id), now(), 'contract_pdf:' || v_id::text)
--     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
--
--     RETURN v_id;
--   END;
--   $function$
--
-- Definicion anterior de `contract_signatures_protect_evidence` (00157, leida de la
-- base el 21/10/2026):
--
--   CREATE OR REPLACE FUNCTION public.contract_signatures_protect_evidence()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   BEGIN
--     IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
--        OR NEW.submission_id IS DISTINCT FROM OLD.submission_id
--        OR NEW.form_id IS DISTINCT FROM OLD.form_id
--        OR NEW.form_version_id IS DISTINCT FROM OLD.form_version_id
--        OR NEW.text_sha256 IS DISTINCT FROM OLD.text_sha256
--        OR NEW.signer_name IS DISTINCT FROM OLD.signer_name
--        OR NEW.signer_email IS DISTINCT FROM OLD.signer_email
--        OR NEW.signature_path IS DISTINCT FROM OLD.signature_path
--        OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
--        OR NEW.legal IS DISTINCT FROM OLD.legal
--        OR NEW.sale_id IS DISTINCT FROM OLD.sale_id
--        OR NEW.service_id IS DISTINCT FROM OLD.service_id THEN
--       RAISE EXCEPTION 'La evidencia de una firma no se puede cambiar' USING ERRCODE = 'restrict_violation';
--     END IF;
--     RETURN NEW;
--   END;
--   $function$
--
-- Volver atras: reponer las dos definiciones de arriba y
--   DROP FUNCTION IF EXISTS public.contract_render_matches(text, text);
--   ALTER TABLE public.contract_signatures DROP COLUMN IF EXISTS rendered_text,
--     DROP COLUMN IF EXISTS rendered_sha256, DROP COLUMN IF EXISTS business_signer;
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, constraints con chequeo previo y CREATE OR REPLACE.
-- ============================================================

-- 1. Columnas nuevas (todas nullable: una firma de "Aceptacion de terminos" no las usa).
ALTER TABLE public.contract_signatures ADD COLUMN IF NOT EXISTS rendered_text text;
ALTER TABLE public.contract_signatures ADD COLUMN IF NOT EXISTS rendered_sha256 text;
ALTER TABLE public.contract_signatures ADD COLUMN IF NOT EXISTS business_signer jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_signatures_rendered_sha_hex') THEN
    ALTER TABLE public.contract_signatures ADD CONSTRAINT contract_signatures_rendered_sha_hex
      CHECK (rendered_sha256 IS NULL OR rendered_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_signatures_rendered_pair') THEN
    ALTER TABLE public.contract_signatures ADD CONSTRAINT contract_signatures_rendered_pair
      CHECK ((rendered_text IS NULL) = (rendered_sha256 IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.contract_signatures.rendered_text IS
  'Modo Contrato: el texto exacto que se firmo (la plantilla de la version con las variables completadas). NULL en Aceptacion de terminos.';
COMMENT ON COLUMN public.contract_signatures.rendered_sha256 IS
  'Huella SHA-256 de rendered_text, calculada por la base al firmar.';
COMMENT ON COLUMN public.contract_signatures.business_signer IS
  'Firma de ambas partes: la firma del negocio estampada (name, role, signature_path en el bucket contracts). NULL si no hubo.';

-- 2. La evidencia nueva tampoco se puede cambiar (ni con el service role).
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
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.rendered_text IS DISTINCT FROM OLD.rendered_text
     OR NEW.rendered_sha256 IS DISTINCT FROM OLD.rendered_sha256
     OR NEW.business_signer IS DISTINCT FROM OLD.business_signer THEN
    RAISE EXCEPTION 'La evidencia de una firma no se puede cambiar' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. ¿El texto armado es la plantilla con solo los huecos completados?
--    Los pedazos fijos (lo que queda entre variables) tienen que aparecer en orden:
--    el primero al principio, el ultimo al final, y cada uno despues del anterior.
--    Buscar cada pedazo en su primera aparicion posible es correcto: deja el mayor
--    lugar para los que siguen.
CREATE OR REPLACE FUNCTION public.contract_render_matches(p_template text, p_rendered text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_parts text[];
  v_count int;
  v_pos   int := 1;
  v_idx   int;
  v_part  text;
  v_last  text;
BEGIN
  IF p_template IS NULL OR p_rendered IS NULL THEN
    RETURN false;
  END IF;
  v_parts := regexp_split_to_array(p_template, '\{\{\s*[a-zA-Z][A-Za-z0-9_.]*\s*\}\}');
  v_count := array_length(v_parts, 1);
  IF v_count = 1 THEN
    RETURN p_template = p_rendered;
  END IF;

  -- El primero, al principio.
  IF left(p_rendered, length(v_parts[1])) <> v_parts[1] THEN
    RETURN false;
  END IF;
  v_pos := length(v_parts[1]) + 1;

  -- Los del medio, en orden.
  FOR i IN 2 .. v_count - 1 LOOP
    v_part := v_parts[i];
    IF v_part = '' THEN
      CONTINUE;
    END IF;
    v_idx := strpos(substr(p_rendered, v_pos), v_part);
    IF v_idx = 0 THEN
      RETURN false;
    END IF;
    v_pos := v_pos + v_idx - 1 + length(v_part);
  END LOOP;

  -- El ultimo, al final y sin pisar lo anterior.
  v_last := v_parts[v_count];
  RETURN right(p_rendered, length(v_last)) = v_last AND length(p_rendered) - length(v_last) + 1 >= v_pos;
END;
$$;

REVOKE ALL ON FUNCTION public.contract_render_matches(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_render_matches(text, text) TO service_role;

-- 4. record_contract_signature v2 (misma firma).
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
  v_sub          public.form_submissions%ROWTYPE;
  v_form         public.forms%ROWTYPE;
  v_version      public.form_versions%ROWTYPE;
  v_id           uuid;
  v_email        text := lower(btrim(COALESCE(p_signer_email, '')));
  v_render       jsonb;
  v_rendered     text;
  v_rendered_sha text;
  v_signer_in    jsonb;
  v_signer       jsonb;
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

  -- Modo Contrato: el texto armado por el servidor tiene que ser ESTA plantilla con los huecos completados.
  v_render := v_sub.meta -> 'contract_render';
  IF jsonb_typeof(v_render) = 'object' AND jsonb_typeof(v_render -> 'text') = 'string' THEN
    v_rendered := v_render ->> 'text';
    IF length(v_rendered) > 200000 OR NOT public.contract_render_matches(v_version.contract_text, v_rendered) THEN
      RAISE EXCEPTION 'El texto firmado no corresponde al contrato' USING ERRCODE = 'data_exception';
    END IF;
    v_rendered_sha := encode(sha256(convert_to(v_rendered, 'UTF8')), 'hex');

    -- La firma del negocio: solo una imagen de ESTE workspace en el bucket de contratos.
    v_signer_in := v_render -> 'business_signer';
    IF jsonb_typeof(v_signer_in) = 'object'
       AND (v_signer_in ->> 'signature_path') LIKE v_sub.workspace_id::text || '/%'
       AND btrim(COALESCE(v_signer_in ->> 'name', '')) <> '' THEN
      v_signer := jsonb_build_object(
        'name', left(btrim(v_signer_in ->> 'name'), 120),
        'role', left(btrim(COALESCE(v_signer_in ->> 'role', '')), 120),
        'signature_path', left(v_signer_in ->> 'signature_path', 500)
      );
    END IF;
  ELSIF v_version.contract_text ~ '\{\{\s*[a-zA-Z][A-Za-z0-9_.]*\s*\}\}' THEN
    RAISE EXCEPTION 'Un contrato con variables necesita el texto armado' USING ERRCODE = 'data_exception';
  END IF;

  INSERT INTO public.contract_signatures
    (workspace_id, submission_id, form_id, form_version_id, text_sha256, signer_name, signer_email,
     contact_id, signature_path, signed_at, legal, sale_id, service_id,
     rendered_text, rendered_sha256, business_signer)
  VALUES
    (v_sub.workspace_id, v_sub.id, v_sub.form_id, v_sub.form_version_id, v_version.contract_text_sha256,
     left(btrim(COALESCE(p_signer_name, '')), 200), v_email,
     v_sub.contact_id, nullif(p_signature_path, ''), now(), COALESCE(p_legal, '{}'::jsonb),
     v_sub.sale_id, v_sub.service_id,
     v_rendered, v_rendered_sha, v_signer)
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
