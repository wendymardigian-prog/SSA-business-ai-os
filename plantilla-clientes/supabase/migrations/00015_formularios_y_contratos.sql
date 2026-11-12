-- ============================================================================
-- Formularios, contratos y reporte de fin de dia
--
-- Formularios, encuestas y contratos: cada version publicada queda congelada, la
-- definicion publica sale solo por get_public_form (lista blanca) y cada respuesta crea o
-- vincula el contacto correcto con su atribucion. La firma de un contrato guarda la huella del
-- texto firmado y su evidencia no se puede cambiar. El reporte de fin de dia (eod_reports) es
-- un tipo de formulario del equipo: un reporte por persona y dia.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.forms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  slug text NOT NULL,
  draft_definition jsonb DEFAULT '{"fields": []}'::jsonb NOT NULL,
  current_version_id uuid,
  design jsonb DEFAULT '{}'::jsonb NOT NULL,
  success jsonb DEFAULT '{"mode": "message"}'::jsonb NOT NULL,
  contact_config jsonb DEFAULT '{"map": [], "mode": "create_or_link", "update": "fill_empty"}'::jsonb NOT NULL,
  survey_config jsonb,
  contract_config jsonb,
  tags_on_submit uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  notify_enabled boolean DEFAULT true NOT NULL,
  notify_user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  published_at timestamp with time zone,
  archived_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  eod_config jsonb,
  product_id uuid,
  CONSTRAINT forms_pkey PRIMARY KEY (id),
  CONSTRAINT forms_contract_config_required CHECK (((type <> 'contract'::text) OR (contract_config IS NOT NULL))),
  CONSTRAINT forms_eod_config_required CHECK (((type <> 'eod'::text) OR (eod_config IS NOT NULL))),
  CONSTRAINT forms_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120))),
  CONSTRAINT forms_portal_product_check CHECK (((type <> ALL (ARRAY['terms'::text, 'quiz'::text, 'activity'::text])) OR (product_id IS NOT NULL))),
  CONSTRAINT forms_slug_check CHECK ((slug ~ '^[a-z0-9-]{3,60}$'::text)),
  CONSTRAINT forms_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'paused'::text, 'archived'::text]))),
  CONSTRAINT forms_survey_config_required CHECK (((type <> 'survey'::text) OR (survey_config IS NOT NULL))),
  CONSTRAINT forms_type_check CHECK ((type = ANY (ARRAY['custom'::text, 'survey'::text, 'contract'::text, 'eod'::text, 'terms'::text, 'quiz'::text, 'activity'::text]))),
  CONSTRAINT forms_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT forms_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT forms_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT forms_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.forms IS 'Formularios (personalizado, encuesta, contrato). Se archivan, no se borran. Escribe solo el servidor; los lee quien pasa can_view_forms().';
COMMENT ON COLUMN public.forms.eod_config IS 'Solo un reporte de fin de dia (type = eod): variante, rol, audiencia, modo de reporte, dias hacia atras, avisos y recordatorio. La valida lib/eod/config.ts; la variante no cambia despues de crear.';
COMMENT ON COLUMN public.forms.product_id IS 'Servicios v12 (F52, F113): el programa de un formulario del portal (terms, quiz, activity). NULL en los demas.';
REVOKE ALL ON TABLE public.forms FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.forms FROM authenticated;

CREATE TABLE IF NOT EXISTS public.form_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  form_id uuid NOT NULL,
  version_number integer NOT NULL,
  definition jsonb NOT NULL,
  contract_text text,
  contract_text_sha256 text,
  published_by uuid,
  published_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT form_versions_pkey PRIMARY KEY (id),
  CONSTRAINT form_versions_unique_number UNIQUE (form_id, version_number),
  CONSTRAINT form_versions_sha_hex CHECK (((contract_text IS NULL) OR (contract_text_sha256 ~ '^[0-9a-f]{64}$'::text))),
  CONSTRAINT form_versions_version_number_check CHECK ((version_number >= 1)),
  CONSTRAINT form_versions_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.forms(id) ON DELETE CASCADE,
  CONSTRAINT form_versions_published_by_fkey FOREIGN KEY (published_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT form_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.form_versions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.form_versions IS 'Versiones publicadas de un formulario. Inmutables: sin policy de UPDATE; solo las crea publish_form_version().';
REVOKE ALL ON TABLE public.form_versions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.form_versions FROM authenticated;

CREATE TABLE IF NOT EXISTS public.eod_reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  form_id uuid NOT NULL,
  form_version_id uuid,
  user_id uuid NOT NULL,
  report_date date NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  answers jsonb DEFAULT '{}'::jsonb NOT NULL,
  channels jsonb DEFAULT '{}'::jsonb NOT NULL,
  metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
  pending_edit jsonb,
  rev integer DEFAULT 0 NOT NULL,
  saved_at timestamp with time zone,
  submitted_at timestamp with time zone,
  edited_at timestamp with time zone,
  edit_count integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT eod_reports_pkey PRIMARY KEY (id),
  CONSTRAINT eod_reports_edit_count_check CHECK ((edit_count >= 0)),
  CONSTRAINT eod_reports_rev_check CHECK ((rev >= 0)),
  CONSTRAINT eod_reports_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text]))),
  CONSTRAINT eod_reports_submitted_at CHECK (((status = 'draft'::text) OR (submitted_at IS NOT NULL))),
  CONSTRAINT eod_reports_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.forms(id) ON DELETE CASCADE,
  CONSTRAINT eod_reports_form_version_id_fkey FOREIGN KEY (form_version_id) REFERENCES public.form_versions(id) ON DELETE SET NULL,
  CONSTRAINT eod_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT eod_reports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.eod_reports ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.eod_reports IS 'Reportes de fin de dia (EOD): una fila por persona, formulario y dia. Escribe solo el servidor; nadie borra.';
REVOKE ALL ON TABLE public.eod_reports FROM anon, authenticated;
GRANT SELECT (id, workspace_id, form_id, form_version_id, user_id, report_date, status, answers, channels, metrics, rev, saved_at, submitted_at, edited_at, edit_count, created_at, updated_at) ON TABLE public.eod_reports TO authenticated;

CREATE TABLE IF NOT EXISTS public.form_submissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  form_id uuid NOT NULL,
  form_version_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  status text NOT NULL,
  answers jsonb NOT NULL,
  contact_id uuid,
  contact_created boolean DEFAULT false NOT NULL,
  dedupe jsonb DEFAULT '{}'::jsonb NOT NULL,
  score integer,
  nps_category text,
  once_key text,
  attribution jsonb DEFAULT '{}'::jsonb NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  upload_prefix text,
  linked_by uuid,
  linked_at timestamp with time zone,
  marked_spam_by uuid,
  marked_spam_at timestamp with time zone,
  sale_id uuid,
  service_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  service_item_id uuid,
  grade jsonb,
  attempt integer,
  review_status text,
  review_comment text,
  internal_note text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  context text,
  CONSTRAINT form_submissions_pkey PRIMARY KEY (id),
  CONSTRAINT form_submissions_idempotency UNIQUE (form_id, idempotency_key),
  CONSTRAINT form_submissions_context_check CHECK (((context IS NULL) OR (context = 'portal'::text))),
  CONSTRAINT form_submissions_nps_category_check CHECK ((nps_category = ANY (ARRAY['promoter'::text, 'passive'::text, 'detractor'::text]))),
  CONSTRAINT form_submissions_review_status_check CHECK (((review_status IS NULL) OR (review_status = ANY (ARRAY['pending'::text, 'graded'::text, 'reviewed'::text, 'needs_changes'::text])))),
  CONSTRAINT form_submissions_status_check CHECK ((status = ANY (ARRAY['received'::text, 'no_contact'::text, 'spam'::text]))),
  CONSTRAINT form_submissions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT form_submissions_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.forms(id),
  CONSTRAINT form_submissions_form_version_id_fkey FOREIGN KEY (form_version_id) REFERENCES public.form_versions(id),
  CONSTRAINT form_submissions_linked_by_fkey FOREIGN KEY (linked_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT form_submissions_marked_spam_by_fkey FOREIGN KEY (marked_spam_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT form_submissions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT form_submissions_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE SET NULL,
  CONSTRAINT form_submissions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.form_submissions IS 'Respuestas de formularios. Escribe solo el servidor (submit_form_response); las lee quien pasa can_see_form_submission(). Nunca se borran.';
COMMENT ON COLUMN public.form_submissions.service_item_id IS 'El paso del camino que completa esta respuesta (Servicios F17). Sin clave foranea: lo pone solo el trigger del modulo, despues de comprobar que el paso es del mismo negocio, servicio y contacto (00331/00335).';
COMMENT ON COLUMN public.form_submissions.internal_note IS 'Servicios v12 (F56): nota interna del equipo. Ninguna funcion del portal la devuelve.';
REVOKE ALL ON TABLE public.form_submissions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.form_submissions FROM authenticated;

CREATE TABLE IF NOT EXISTS public.contract_signatures (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  form_id uuid NOT NULL,
  form_version_id uuid NOT NULL,
  text_sha256 text NOT NULL,
  signer_name text DEFAULT ''::text NOT NULL,
  signer_email text NOT NULL,
  contact_id uuid,
  signature_path text,
  signed_at timestamp with time zone DEFAULT now() NOT NULL,
  legal jsonb NOT NULL,
  pdf_path text,
  pdf_status text DEFAULT 'pending'::text NOT NULL,
  pdf_attempts integer DEFAULT 0 NOT NULL,
  email_status text DEFAULT 'pending'::text NOT NULL,
  email_attempts integer DEFAULT 0 NOT NULL,
  email_next_retry_at timestamp with time zone,
  email_sent_at timestamp with time zone,
  email_last_error text,
  sale_id uuid,
  service_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  rendered_text text,
  rendered_sha256 text,
  business_signer jsonb,
  CONSTRAINT contract_signatures_pkey PRIMARY KEY (id),
  CONSTRAINT contract_signatures_one_per_submission UNIQUE (submission_id),
  CONSTRAINT contract_signatures_email_status_check CHECK ((email_status = ANY (ARRAY['pending'::text, 'sent'::text, 'retrying'::text, 'not_sent'::text]))),
  CONSTRAINT contract_signatures_pdf_status_check CHECK ((pdf_status = ANY (ARRAY['pending'::text, 'generated'::text, 'failed'::text]))),
  CONSTRAINT contract_signatures_rendered_pair CHECK (((rendered_text IS NULL) = (rendered_sha256 IS NULL))),
  CONSTRAINT contract_signatures_rendered_sha_hex CHECK (((rendered_sha256 IS NULL) OR (rendered_sha256 ~ '^[0-9a-f]{64}$'::text))),
  CONSTRAINT contract_signatures_signer_email_check CHECK ((btrim(signer_email) <> ''::text)),
  CONSTRAINT contract_signatures_text_sha256_check CHECK ((text_sha256 ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT contract_signatures_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT contract_signatures_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.forms(id),
  CONSTRAINT contract_signatures_form_version_id_fkey FOREIGN KEY (form_version_id) REFERENCES public.form_versions(id),
  CONSTRAINT contract_signatures_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id),
  CONSTRAINT contract_signatures_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.form_submissions(id),
  CONSTRAINT contract_signatures_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.contract_signatures ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.contract_signatures IS 'Una firma por respuesta de un contrato. Escribe solo el servidor (record_contract_signature); la ve quien ve la respuesta. La evidencia (huella, texto, firmante, hora y metadata legal) no se puede cambiar.';
COMMENT ON COLUMN public.contract_signatures.legal IS 'Metadata legal. La IP va en claro SOLO aca (es evidencia); en el resto del sistema va hasheada.';
COMMENT ON COLUMN public.contract_signatures.rendered_text IS 'Modo Contrato: el texto exacto que se firmo (la plantilla de la version con las variables completadas). NULL en Aceptacion de terminos.';
COMMENT ON COLUMN public.contract_signatures.rendered_sha256 IS 'Huella SHA-256 de rendered_text, calculada por la base al firmar.';
COMMENT ON COLUMN public.contract_signatures.business_signer IS 'Firma de ambas partes: la firma del negocio estampada (name, role, signature_path en el bucket contracts). NULL si no hubo.';
REVOKE ALL ON TABLE public.contract_signatures FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contract_signatures FROM authenticated;

-- ----------------------------------------------------------------------------
-- Claves foraneas hacia tablas de esta area
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE public.flows ADD CONSTRAINT flows_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.forms(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.forms ADD CONSTRAINT forms_current_version_fk FOREIGN KEY (current_version_id) REFERENCES public.form_versions(id) DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.enqueue_eod_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_form record;
  v_slot bigint := floor(extract(epoch FROM now()) / 900);
  v_enqueued integer := 0;
BEGIN
  FOR v_form IN
    SELECT f.id
    FROM public.forms f
    WHERE f.type = 'eod'
      AND f.status = 'published'
      AND f.current_version_id IS NOT NULL
      AND COALESCE((f.eod_config -> 'reminder' ->> 'enabled')::boolean, false)
  LOOP
    BEGIN
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES (
        'eod_reminder_sweep',
        jsonb_build_object('form_id', v_form.id),
        now(),
        'eod-reminder:' || v_form.id::text || ':' || v_slot::text
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_eod_reminders: no pude encolar el reporte %: %', v_form.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_enqueued;
END;
$function$;
REVOKE ALL ON FUNCTION private.enqueue_eod_reminders() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.can_view_eod_all(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN public.is_workspace_admin(p_workspace_id) THEN true
    ELSE COALESCE((
      SELECT COALESCE(r.permissions -> 'keys' @> to_jsonb(ARRAY['eod.view_all']), false)
      FROM public.workspace_members m
      JOIN public.workspace_roles r ON r.id = m.role_id
      WHERE m.workspace_id = p_workspace_id
        AND m.user_id = auth.uid()
        AND r.system_role IS NULL
    ), false)
  END;
$function$;
REVOKE ALL ON FUNCTION public.can_view_eod_all(p_workspace_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_view_forms(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN public.is_workspace_admin(p_workspace_id) THEN true
    ELSE COALESCE((
      SELECT
        -- Member sin rol asignado, o con el rol de sistema Member: tiene `forms.view`
        -- (su baseline vive en lib/auth/permissions.ts, no en el jsonb).
        m.role_id IS NULL
        OR r.system_role = 'member'
        -- Rol personalizado: solo si marco la clave.
        OR COALESCE(r.permissions -> 'keys' @> to_jsonb(ARRAY['forms.view']), false)
      FROM public.workspace_members m
      LEFT JOIN public.workspace_roles r ON r.id = m.role_id
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
    ), false)
  END;
$function$;
REVOKE ALL ON FUNCTION public.can_view_forms(p_workspace_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_see_form_submission(s public.form_submissions)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.is_workspace_admin(s.workspace_id)
     OR (
       public.can_view_forms(s.workspace_id)
       AND s.contact_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.contacts ct
         WHERE ct.id = s.contact_id AND public.can_see_contact(ct)
       )
     );
$function$;
REVOKE ALL ON FUNCTION public.can_see_form_submission(s public.form_submissions) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.contract_render_matches(p_template text, p_rendered text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.contract_render_matches(p_template text, p_rendered text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contract_signatures_protect_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.find_contact_for_form(p_workspace_id uuid, p_phone text, p_email text, p_social jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_social jsonb := CASE WHEN jsonb_typeof(p_social) = 'object' THEN p_social ELSE '{}'::jsonb END;
BEGIN
  RETURN private.contact_identity_lookup(
    p_workspace_id,
    private.contact_normalize_identity(jsonb_build_object(
      'phone',     p_phone,
      'email',     p_email,
      'instagram', v_social ->> 'instagram',
      'tiktok',    v_social ->> 'tiktok',
      'x',         v_social ->> 'x',
      'linkedin',  v_social ->> 'linkedin'
    ))
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.find_contact_for_form(p_workspace_id uuid, p_phone text, p_email text, p_social jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.form_metrics_daily(p_form_id uuid, p_from date, p_to date)
 RETURNS TABLE(day date, views integer, starts integer, submissions integer, spam integer, rejected integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.form_metrics_daily(p_form_id uuid, p_from date, p_to date) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.form_versions_protect_published()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.form_id IS DISTINCT FROM OLD.form_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.definition IS DISTINCT FROM OLD.definition
     OR NEW.contract_text IS DISTINCT FROM OLD.contract_text
     OR NEW.contract_text_sha256 IS DISTINCT FROM OLD.contract_text_sha256
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     -- Una persona a NULL es el ON DELETE SET NULL de la clave foranea: se deja pasar.
     OR (NEW.published_by IS DISTINCT FROM OLD.published_by AND NEW.published_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Una version publicada no se puede cambiar' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$function$;

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
REVOKE ALL ON FUNCTION public.get_public_form(p_slug text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.publish_form_version(p_form_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.publish_form_version(p_form_id uuid, p_actor uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_contract_signature(p_submission_id uuid, p_signature_path text, p_legal jsonb, p_signer_name text DEFAULT ''::text, p_signer_email text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.record_contract_signature(p_submission_id uuid, p_signature_path text, p_legal jsonb, p_signer_name text, p_signer_email text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_eod_draft(p_workspace_id uuid, p_form_id uuid, p_user_id uuid, p_report_date date, p_rev integer, p_answers jsonb, p_channels jsonb, p_report_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.eod_reports%ROWTYPE;
  v_id uuid;
  v_now timestamptz := now();
BEGIN
  IF p_report_mode NOT IN ('single', 'editable') THEN
    RAISE EXCEPTION 'save_eod_draft: modo invalido';
  END IF;

  INSERT INTO public.eod_reports (workspace_id, form_id, user_id, report_date, status)
  VALUES (p_workspace_id, p_form_id, p_user_id, p_report_date, 'draft')
  ON CONFLICT (form_id, user_id, report_date) DO NOTHING;

  SELECT * INTO v_row
  FROM public.eod_reports
  WHERE form_id = p_form_id AND user_id = p_user_id AND report_date = p_report_date;

  IF v_row.workspace_id <> p_workspace_id THEN
    RAISE EXCEPTION 'save_eod_draft: el reporte no es de este workspace';
  END IF;
  -- Un UPDATE ... RETURNING INTO que no encuentra fila deja v_row en NULL: el id va aparte.
  v_id := v_row.id;

  IF v_row.status = 'submitted' AND p_report_mode = 'single' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_submitted', 'report_id', v_row.id);
  END IF;

  IF v_row.status = 'submitted' THEN
    -- Corrigiendo un reporte enviado: lo enviado no cambia hasta el proximo "Enviar".
    UPDATE public.eod_reports
       SET pending_edit = jsonb_build_object('answers', COALESCE(p_answers, '{}'::jsonb), 'channels', COALESCE(p_channels, '{}'::jsonb)),
           rev = rev + 1,
           saved_at = v_now
     WHERE id = v_id AND rev = p_rev
     RETURNING * INTO v_row;
  ELSE
    UPDATE public.eod_reports
       SET answers = COALESCE(p_answers, '{}'::jsonb),
           channels = COALESCE(p_channels, '{}'::jsonb),
           rev = rev + 1,
           saved_at = v_now
     WHERE id = v_id AND rev = p_rev
     RETURNING * INTO v_row;
  END IF;

  IF NOT FOUND THEN
    -- Otra pestana o el celular guardaron en el medio: se devuelve lo vigente.
    SELECT * INTO v_row FROM public.eod_reports WHERE id = v_id;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'conflict',
      'report_id', v_row.id,
      'status', v_row.status,
      'rev', v_row.rev,
      'saved_at', v_row.saved_at,
      'answers', CASE WHEN v_row.status = 'submitted' THEN COALESCE(v_row.pending_edit -> 'answers', '{}'::jsonb) ELSE v_row.answers END,
      'channels', CASE WHEN v_row.status = 'submitted' THEN COALESCE(v_row.pending_edit -> 'channels', '{}'::jsonb) ELSE v_row.channels END
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'report_id', v_row.id, 'status', v_row.status, 'rev', v_row.rev, 'saved_at', v_row.saved_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.save_eod_draft(p_workspace_id uuid, p_form_id uuid, p_user_id uuid, p_report_date date, p_rev integer, p_answers jsonb, p_channels jsonb, p_report_mode text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_eod_report(p_workspace_id uuid, p_form_id uuid, p_user_id uuid, p_report_date date, p_rev integer, p_form_version_id uuid, p_answers jsonb, p_channels jsonb, p_metrics jsonb, p_report_mode text, p_audit_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.eod_reports%ROWTYPE;
  v_now timestamptz := now();
  v_first boolean;
BEGIN
  IF p_report_mode NOT IN ('single', 'editable') THEN
    RAISE EXCEPTION 'submit_eod_report: modo invalido';
  END IF;

  INSERT INTO public.eod_reports (workspace_id, form_id, user_id, report_date, status)
  VALUES (p_workspace_id, p_form_id, p_user_id, p_report_date, 'draft')
  ON CONFLICT (form_id, user_id, report_date) DO NOTHING;

  SELECT * INTO v_row
  FROM public.eod_reports
  WHERE form_id = p_form_id AND user_id = p_user_id AND report_date = p_report_date
  FOR UPDATE;

  IF v_row.workspace_id <> p_workspace_id THEN
    RAISE EXCEPTION 'submit_eod_report: el reporte no es de este workspace';
  END IF;

  IF v_row.status = 'submitted' AND p_report_mode = 'single' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_submitted', 'report_id', v_row.id);
  END IF;

  IF v_row.rev <> p_rev THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'report_id', v_row.id, 'status', v_row.status, 'rev', v_row.rev);
  END IF;

  v_first := v_row.status = 'draft';

  UPDATE public.eod_reports
     SET status = 'submitted',
         answers = COALESCE(p_answers, '{}'::jsonb),
         channels = COALESCE(p_channels, '{}'::jsonb),
         metrics = COALESCE(p_metrics, '{}'::jsonb),
         form_version_id = p_form_version_id,
         pending_edit = NULL,
         rev = rev + 1,
         saved_at = v_now,
         submitted_at = CASE WHEN v_first THEN v_now ELSE submitted_at END,
         edited_at = CASE WHEN v_first THEN edited_at ELSE v_now END,
         edit_count = CASE WHEN v_first THEN edit_count ELSE edit_count + 1 END
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  -- El evento de automatizacion, en la MISMA transaccion (E16). Sin contacto: es de una
  -- persona del equipo (00182). Solo escalares en el payload y nunca booking_id. La clave
  -- de idempotencia la arma el trigger con report_id y edit_count.
  INSERT INTO public.automation_events (workspace_id, event_type, contact_id, member_user_id, payload)
  VALUES (
    p_workspace_id,
    'eod_submitted',
    NULL,
    p_user_id,
    jsonb_build_object(
      'report_id', v_row.id,
      'form_id', p_form_id,
      'report_date', p_report_date,
      'edit_count', v_row.edit_count
    )
  );

  IF NOT v_first THEN
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
    VALUES (
      p_workspace_id, 'eod_report', v_row.id, 'eod.edited', p_audit_changes,
      jsonb_build_object('form_id', p_form_id, 'report_date', p_report_date, 'edit_count', v_row.edit_count),
      p_user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'report_id', v_row.id,
    'first', v_first,
    'edit_count', v_row.edit_count,
    'rev', v_row.rev,
    'submitted_at', v_row.submitted_at,
    'edited_at', v_row.edited_at
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_eod_report(p_workspace_id uuid, p_form_id uuid, p_user_id uuid, p_report_date date, p_rev integer, p_form_version_id uuid, p_answers jsonb, p_channels jsonb, p_metrics jsonb, p_report_mode text, p_audit_changes jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_form_response(p_form_id uuid, p_version_id uuid, p_idempotency_key uuid, p_answers jsonb, p_attribution jsonb, p_meta jsonb, p_contact_hint jsonb DEFAULT '{}'::jsonb, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_form      public.forms%ROWTYPE;
  v_id        uuid;
  v_existing  public.form_submissions%ROWTYPE;
  v_hint      jsonb := COALESCE(p_contact_hint, '{}'::jsonb);
  v_mode      text;
  v_overwrite boolean;
  v_name      text := nullif(btrim(v_hint ->> 'display_name'), '');
  v_email     text := public.normalize_email(v_hint ->> 'email');
  v_phone     text := public.normalize_phone(v_hint ->> 'phone');
  v_wa        text := public.normalize_phone(v_hint ->> 'whatsapp_phone');
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
  v_identity  jsonb;
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
  v_identity := jsonb_strip_nulls(jsonb_build_object(
    'phone', v_phone, 'whatsapp_phone', v_wa, 'email', v_email,
    'instagram', v_ig, 'tiktok', v_tt, 'x', v_x, 'linkedin', v_li));

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
    -- La regla central (C2, 00200): bloquea por cada dato con el que se puede identificar (siempre en el
    -- mismo orden, sin interbloqueo) y busca. Los bloqueos duran hasta el final de esta transaccion: la
    -- creacion del paso 3 ya los tiene. Orden de busqueda: telefono, WhatsApp, email, Instagram, TikTok,
    -- X, LinkedIn (antes el WhatsApp solo se miraba si no habia telefono y el email no habia coincidido).
    v_found := public.find_or_create_contact(v_form.workspace_id, v_identity, '{}'::jsonb, 'find_only');
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
      v_found := public.find_or_create_contact(
        v_form.workspace_id,
        v_identity,
        jsonb_strip_nulls(jsonb_build_object(
          -- Sin nombre y solo con un usuario de red social, el usuario hace de nombre ("@ana"): la app mostraria
          -- "Sin nombre" y la base lo marcaria como anonimo (is_anonymous solo mira Instagram, no TikTok/X/LinkedIn).
          'display_name', COALESCE(v_name, CASE WHEN v_email IS NULL AND v_phone IS NULL AND v_wa IS NULL
                                                THEN COALESCE('@' || v_ig, '@' || v_tt, '@' || v_x, public.linkedin_slug(v_li)) END),
          'country', v_country,
          'facebook_id', v_fb,
          'youtube_channel_id', v_yt,
          'attribution', jsonb_build_object('source', 'form', 'referrer', p_attribution ->> 'referrer_url'),
          'last_interaction_at', now()
        )),
        'create'
      );
      v_contact := (v_found ->> 'contact_id')::uuid;
      v_created := COALESCE((v_found ->> 'created')::boolean, false);
      IF NOT v_created AND v_contact IS NOT NULL THEN
        -- Otra respuesta creo a la misma persona en el medio (no pasa con los bloqueos del paso 1, pero la
        -- base manda): se trata como un contacto encontrado.
        v_matched := v_found ->> 'matched_by';
        v_conflict := (v_found ->> 'conflict_contact_id')::uuid;
        v_conflicts := COALESCE(v_found -> 'conflicts', '[]'::jsonb);
      END IF;
    END IF;
  END IF;

  IF v_contact IS NOT NULL AND NOT v_created THEN
    UPDATE public.contacts c
    SET display_name = CASE WHEN v_overwrite THEN COALESCE(v_name, c.display_name)
                            WHEN COALESCE(btrim(c.display_name), '') = '' THEN v_name ELSE c.display_name END,
        -- Un telefono o email que ya es de OTRO contacto no se escribe (dejaria dos contactos con el mismo dato).
        email        = CASE WHEN private.contact_value_taken(v_form.workspace_id, c.id, 'email', v_email) THEN c.email
                            WHEN v_overwrite THEN COALESCE(v_email, c.email)
                            WHEN COALESCE(btrim(c.email), '') = '' THEN v_email ELSE c.email END,
        phone        = CASE WHEN private.contact_value_taken(v_form.workspace_id, c.id, 'phone', v_phone) THEN c.phone
                            WHEN v_overwrite THEN COALESCE(v_phone, c.phone)
                            WHEN COALESCE(btrim(c.phone), '') = '' THEN v_phone ELSE c.phone END,
        whatsapp_phone = CASE WHEN private.contact_value_taken(v_form.workspace_id, c.id, 'phone', v_wa) THEN c.whatsapp_phone
                              WHEN v_overwrite THEN COALESCE(v_wa, c.whatsapp_phone)
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
$function$;
REVOKE ALL ON FUNCTION public.submit_form_response(p_form_id uuid, p_version_id uuid, p_idempotency_key uuid, p_answers jsonb, p_attribution jsonb, p_meta jsonb, p_contact_hint jsonb, p_extra jsonb) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS contract_signatures_sale_idx ON public.contract_signatures USING btree (sale_id) WHERE (sale_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS form_submissions_sale_idx ON public.form_submissions USING btree (sale_id) WHERE (sale_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contract_signatures_email_pending ON public.contract_signatures USING btree (email_status) WHERE (email_status = ANY (ARRAY['retrying'::text, 'not_sent'::text]));

CREATE INDEX IF NOT EXISTS idx_contract_signatures_form ON public.contract_signatures USING btree (form_id, signed_at DESC);

CREATE INDEX IF NOT EXISTS idx_contract_signatures_service ON public.contract_signatures USING btree (service_id) WHERE (service_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_eod_reports_form_date ON public.eod_reports USING btree (form_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_eod_reports_ws_user_date ON public.eod_reports USING btree (workspace_id, user_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_form_submissions_contact ON public.form_submissions USING btree (contact_id, created_at DESC) WHERE (contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON public.form_submissions USING btree (form_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_status ON public.form_submissions USING btree (form_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_submissions_review ON public.form_submissions USING btree (workspace_id, review_status) WHERE (review_status IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_form_submissions_service ON public.form_submissions USING btree (service_id) WHERE (service_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_form_submissions_service_item ON public.form_submissions USING btree (service_item_id) WHERE (service_item_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_form_submissions_workspace ON public.form_submissions USING btree (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_versions_form ON public.form_versions USING btree (form_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_forms_product ON public.forms USING btree (product_id) WHERE (product_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_forms_workspace_status ON public.forms USING btree (workspace_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_eod_reports_form_user_date ON public.eod_reports USING btree (form_id, user_id, report_date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_submissions_once ON public.form_submissions USING btree (form_id, once_key) WHERE ((once_key IS NOT NULL) AND (status <> 'spam'::text));

CREATE UNIQUE INDEX IF NOT EXISTS uq_forms_slug_lower ON public.forms USING btree (lower(slug));

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER contract_signatures_protect BEFORE UPDATE ON public.contract_signatures FOR EACH ROW EXECUTE FUNCTION public.contract_signatures_protect_evidence();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.contract_signatures FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.eod_reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.form_submissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER form_versions_protect BEFORE UPDATE ON public.form_versions FOR EACH ROW EXECUTE FUNCTION public.form_versions_protect_published();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.form_versions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.forms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY contract_signatures_select ON public.contract_signatures FOR SELECT TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM public.form_submissions s
  WHERE ((s.id = contract_signatures.submission_id) AND public.can_see_form_submission(s.*)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY eod_reports_select ON public.eod_reports FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND ((user_id = ( SELECT auth.uid() AS uid)) OR ((status = 'submitted'::text) AND public.can_view_eod_all(workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY form_submissions_select ON public.form_submissions FOR SELECT TO authenticated
    USING (public.can_see_form_submission(form_submissions.*));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY form_versions_select ON public.form_versions FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND public.can_view_forms(workspace_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY forms_select ON public.forms FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND public.can_view_forms(workspace_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
