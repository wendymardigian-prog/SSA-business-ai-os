-- ============================================================================
-- Diseñador IA
--
-- Diseños, plantillas y sus versiones, y las conversaciones con la IA (ai_threads y
-- ai_messages, genericas). El link publico de un diseño sale solo por design_public_get y
-- muestra la ultima version publicada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_threads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  channel text NOT NULL,
  agent_id uuid,
  user_id uuid,
  contact_id uuid,
  subject_type text,
  subject_id uuid,
  title text,
  last_message_at timestamp with time zone,
  archived_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ai_threads_pkey PRIMARY KEY (id),
  CONSTRAINT ai_threads_channel_check CHECK ((channel = ANY (ARRAY['designer'::text, 'portal'::text, 'assistant'::text]))),
  CONSTRAINT ai_threads_designer_subject CHECK (((channel <> 'designer'::text) OR ((subject_type = ANY (ARRAY['design'::text, 'design_template'::text])) AND (subject_id IS NOT NULL)))),
  CONSTRAINT ai_threads_subject_type_check CHECK (((subject_type IS NULL) OR (subject_type = ANY (ARRAY['design'::text, 'design_template'::text, 'product'::text])))),
  CONSTRAINT ai_threads_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL,
  CONSTRAINT ai_threads_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT ai_threads_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT ai_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT ai_threads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.ai_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_threads FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ai_threads FROM authenticated;

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
  context jsonb DEFAULT '{}'::jsonb NOT NULL,
  result jsonb,
  citations jsonb DEFAULT '[]'::jsonb NOT NULL,
  agent_run_id uuid,
  feedback text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ai_messages_pkey PRIMARY KEY (id),
  CONSTRAINT ai_messages_attachments_check CHECK ((jsonb_typeof(attachments) = 'array'::text)),
  CONSTRAINT ai_messages_citations_check CHECK ((jsonb_typeof(citations) = 'array'::text)),
  CONSTRAINT ai_messages_content_check CHECK ((char_length(content) <= 20000)),
  CONSTRAINT ai_messages_context_check CHECK ((jsonb_typeof(context) = 'object'::text)),
  CONSTRAINT ai_messages_feedback_check CHECK (((feedback IS NULL) OR (feedback = ANY (ARRAY['up'::text, 'down'::text])))),
  CONSTRAINT ai_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text]))),
  CONSTRAINT ai_messages_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  CONSTRAINT ai_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.ai_threads(id) ON DELETE CASCADE,
  CONSTRAINT ai_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.ai_messages FROM authenticated;

CREATE TABLE IF NOT EXISTS public.design_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  format text NOT NULL,
  doc jsonb NOT NULL,
  rev integer DEFAULT 0 NOT NULL,
  custom_vars jsonb DEFAULT '[]'::jsonb NOT NULL,
  date_format text DEFAULT 'long'::text NOT NULL,
  verify boolean DEFAULT false NOT NULL,
  doc_type text,
  doc_type_label text,
  allow_download boolean DEFAULT true NOT NULL,
  origin text NOT NULL,
  style text,
  archived_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT design_templates_pkey PRIMARY KEY (id),
  CONSTRAINT design_templates_custom_vars_check CHECK ((jsonb_typeof(custom_vars) = 'array'::text)),
  CONSTRAINT design_templates_date_format_check CHECK ((date_format = ANY (ARRAY['long'::text, 'short'::text, 'en'::text]))),
  CONSTRAINT design_templates_doc_type_check CHECK (((doc_type IS NULL) OR (doc_type = ANY (ARRAY['certificado'::text, 'constancia'::text, 'diploma'::text, 'otro'::text])))),
  CONSTRAINT design_templates_format_check CHECK ((format = ANY (ARRAY['carta_v'::text, 'carta_h'::text, 'a4_v'::text, 'a4_h'::text, 'sq'::text, 'v45'::text, 'story'::text, 'wide'::text]))),
  CONSTRAINT design_templates_label_only_other CHECK (((doc_type_label IS NULL) OR ((doc_type = 'otro'::text) AND ((char_length(btrim(doc_type_label)) >= 1) AND (char_length(btrim(doc_type_label)) <= 40))))),
  CONSTRAINT design_templates_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
  CONSTRAINT design_templates_origin_check CHECK ((origin = ANY (ARRAY['ai'::text, 'image'::text, 'html'::text, 'blank'::text]))),
  CONSTRAINT design_templates_verify_other_label CHECK (((NOT verify) OR (doc_type IS DISTINCT FROM 'otro'::text) OR (doc_type_label IS NOT NULL))),
  CONSTRAINT design_templates_verify_print CHECK (((NOT verify) OR (format = ANY (ARRAY['carta_v'::text, 'carta_h'::text, 'a4_v'::text, 'a4_h'::text])))),
  CONSTRAINT design_templates_verify_type CHECK (((NOT verify) OR (doc_type IS NOT NULL))),
  CONSTRAINT design_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT design_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.design_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.design_templates FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.design_templates FROM authenticated;

CREATE TABLE IF NOT EXISTS public.designs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  format text NOT NULL,
  doc jsonb NOT NULL,
  rev integer DEFAULT 0 NOT NULL,
  origin text NOT NULL,
  style text,
  code text DEFAULT ''::text NOT NULL,
  published boolean DEFAULT false NOT NULL,
  allow_download boolean DEFAULT true NOT NULL,
  allow_indexing boolean DEFAULT false NOT NULL,
  published_at timestamp with time zone,
  template_id uuid,
  subject_contact_id uuid,
  subject_ref jsonb,
  "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  error text,
  attempts integer DEFAULT 0 NOT NULL,
  next_attempt_at timestamp with time zone,
  source text,
  source_ref jsonb,
  email_status text,
  void_reason text,
  voided_at timestamp with time zone,
  voided_by uuid,
  renders jsonb DEFAULT '{}'::jsonb NOT NULL,
  content_post_id uuid,
  content_network text,
  last_qa jsonb,
  archived_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT designs_pkey PRIMARY KEY (id),
  CONSTRAINT designs_code_format CHECK ((code ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'::text)),
  CONSTRAINT designs_email_status_check CHECK (((email_status IS NULL) OR (email_status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped'::text])))),
  CONSTRAINT designs_format_check CHECK ((format = ANY (ARRAY['carta_v'::text, 'carta_h'::text, 'a4_v'::text, 'a4_h'::text, 'sq'::text, 'v45'::text, 'story'::text, 'wide'::text, 'web'::text]))),
  CONSTRAINT designs_generation_source CHECK (((template_id IS NULL) OR (source IS NOT NULL))),
  CONSTRAINT designs_indexing_web CHECK (((NOT allow_indexing) OR (format = 'web'::text))),
  CONSTRAINT designs_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 200))),
  CONSTRAINT designs_origin_check CHECK ((origin = ANY (ARRAY['ai'::text, 'image'::text, 'html'::text, 'blank'::text, 'template'::text]))),
  CONSTRAINT designs_renders_check CHECK ((jsonb_typeof(renders) = 'object'::text)),
  CONSTRAINT designs_source_check CHECK (((source IS NULL) OR (source = ANY (ARRAY['manual'::text, 'bulk'::text, 'automation'::text, 'module'::text])))),
  CONSTRAINT designs_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'queued'::text, 'rendering'::text, 'ready'::text, 'failed'::text, 'void'::text]))),
  CONSTRAINT designs_values_check CHECK ((jsonb_typeof("values") = 'object'::text)),
  CONSTRAINT designs_void_reason CHECK (((status <> 'void'::text) OR ((void_reason IS NOT NULL) AND (char_length(btrim(void_reason)) > 0)))),
  CONSTRAINT designs_content_post_id_fkey FOREIGN KEY (content_post_id) REFERENCES public.content_posts(id) ON DELETE SET NULL,
  CONSTRAINT designs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT designs_subject_contact_id_fkey FOREIGN KEY (subject_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT designs_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.design_templates(id),
  CONSTRAINT designs_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT designs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.designs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.designs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.designs FROM authenticated;

CREATE TABLE IF NOT EXISTS public.design_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  template_id uuid,
  design_id uuid,
  doc jsonb NOT NULL,
  reason text NOT NULL,
  author_kind text NOT NULL,
  author_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT design_versions_pkey PRIMARY KEY (id),
  CONSTRAINT design_versions_author_kind_check CHECK ((author_kind = ANY (ARRAY['user'::text, 'ai'::text]))),
  CONSTRAINT design_versions_one_subject CHECK ((num_nonnulls(template_id, design_id) = 1)),
  CONSTRAINT design_versions_reason_check CHECK ((reason = ANY (ARRAY['ai'::text, 'manual'::text, 'publish'::text, 'restore'::text, 'generate'::text, 'import'::text]))),
  CONSTRAINT design_versions_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT design_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT design_versions_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE,
  CONSTRAINT design_versions_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.design_templates(id) ON DELETE CASCADE,
  CONSTRAINT design_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.design_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.design_versions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.design_versions FROM authenticated;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.design_new_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_raw text;
  v_code text;
  v_try int := 0;
BEGIN
  LOOP
    v_bytes := extensions.gen_random_bytes(12);
    v_raw := '';
    FOR i IN 0..11 LOOP
      v_raw := v_raw || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    v_code := substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.designs d WHERE d.code = v_code);
    v_try := v_try + 1;
    IF v_try > 20 THEN
      RAISE EXCEPTION 'No se pudo generar un código único';
    END IF;
  END LOOP;
  RETURN v_code;
END;
$function$;
REVOKE ALL ON FUNCTION private.design_new_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.design_new_code() TO service_role;

CREATE OR REPLACE FUNCTION private.enqueue_design_cleanup(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_key text;
  v_enqueued integer := 0;
BEGIN
  FOR v_ws IN
    -- Una versión vieja que NO es la actual de su pieza (hay otra más nueva).
    SELECT DISTINCT v.workspace_id
    FROM public.design_versions v
    WHERE v.created_at < p_now - interval '30 days'
      AND EXISTS (
        SELECT 1 FROM public.design_versions n
        WHERE n.workspace_id = v.workspace_id
          AND n.created_at > v.created_at
          AND ((v.design_id IS NOT NULL AND n.design_id = v.design_id) OR (v.template_id IS NOT NULL AND n.template_id = v.template_id))
      )
    UNION
    SELECT DISTINCT ((storage.foldername(o.name))[1])::uuid
    FROM storage.objects o
    WHERE o.bucket_id = 'design-renders'
      AND o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/exports/'
      AND o.created_at < p_now - interval '7 days'
  LOOP
    BEGIN
      v_key := 'design_cleanup:' || v_ws::text || ':' || (p_now AT TIME ZONE 'UTC')::date::text;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.scheduled_jobs j WHERE j.dedupe_key = v_key);
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES ('design_cleanup', jsonb_build_object('workspace_id', v_ws), p_now, v_key)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_design_cleanup: no pude encolar el workspace %: %', v_ws, SQLERRM;
    END;
  END LOOP;
  RETURN v_enqueued;
END;
$function$;
REVOKE ALL ON FUNCTION private.enqueue_design_cleanup(p_now timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.enqueue_design_cleanup(p_now timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION public.contacts_designs_on_merge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_main uuid;
BEGIN
  IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT (coalesce(NEW.metadata, '{}'::jsonb) ? 'merged_into') THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_main := (NEW.metadata ->> 'merged_into')::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  BEGIN
    UPDATE public.designs SET subject_contact_id = v_main WHERE subject_contact_id = OLD.id AND workspace_id = NEW.workspace_id;
    UPDATE public.ai_threads SET contact_id = v_main WHERE contact_id = OLD.id AND workspace_id = NEW.workspace_id;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'contacts_designs_on_merge: no pude mover los diseños del contacto %: %', OLD.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.contacts_designs_on_merge() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.design_doc_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.validate_design_doc(NEW.doc) THEN
    RAISE EXCEPTION 'El documento del diseño no tiene la forma esperada' USING ERRCODE = '22023';
  END IF;
  -- Solo plantillas y diseños tienen `format` (las versiones no): la comparación va aparte.
  IF TG_TABLE_NAME IN ('design_templates', 'designs') THEN
    IF (NEW.doc ->> 'format') IS DISTINCT FROM to_jsonb(NEW) ->> 'format' THEN
      RAISE EXCEPTION 'El formato del documento no coincide con el de la fila' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.design_doc_check() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.design_public_get(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_d public.designs%ROWTYPE;
  v_t public.design_templates%ROWTYPE;
  v_ws public.workspaces%ROWTYPE;
  v_is_generation boolean;
  v_verify boolean := false;
  -- 00325: el documento PUBLICADO (la última versión `publish`), no el que se está editando.
  v_pub_doc jsonb;
BEGIN
  IF v_code !~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_d FROM public.designs WHERE code = v_code;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_is_generation := v_d.template_id IS NOT NULL;
  IF v_is_generation THEN
    SELECT * INTO v_t FROM public.design_templates WHERE id = v_d.template_id;
    v_verify := coalesce(v_t.verify, false);
  END IF;
  IF NOT (v_d.published OR (v_is_generation AND v_verify)) THEN
    RETURN NULL;
  END IF;
  IF v_d.archived_at IS NOT NULL AND NOT v_is_generation THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_ws FROM public.workspaces WHERE id = v_d.workspace_id;
  -- Un diseño propio publicado muestra lo que se publicó: un cambio guardado después (con `designer.edit`) recién se ve
  -- al «Publicar cambios» (con `designer.publish`). Una generación es una copia congelada: su documento es el suyo.
  IF NOT v_is_generation THEN
    SELECT v.doc INTO v_pub_doc
      FROM public.design_versions v
     WHERE v.design_id = v_d.id AND v.reason = 'publish'
     ORDER BY v.created_at DESC
     LIMIT 1;
  END IF;
  v_pub_doc := coalesce(v_pub_doc, v_d.doc);

  RETURN jsonb_build_object(
    'code', v_d.code,
    'name', v_d.name,
    'format', v_d.format,
    'kind', CASE WHEN v_is_generation THEN 'generation' ELSE 'design' END,
    'status', v_d.status,
    'published', v_d.published,
    'allow_download', CASE WHEN v_is_generation THEN coalesce(v_t.allow_download, true) AND v_d.allow_download ELSE v_d.allow_download END,
    'allow_indexing', v_d.allow_indexing AND v_d.format = 'web',
    'published_at', v_d.published_at,
    'issued_at', v_d.created_at,
    'verify', v_verify,
    'doc_type', CASE WHEN v_verify THEN v_t.doc_type END,
    'doc_type_label', CASE WHEN v_verify THEN v_t.doc_type_label END,
    'void_reason', CASE WHEN v_d.status = 'void' THEN v_d.void_reason END,
    'voided_at', v_d.voided_at,
    'page_count', jsonb_array_length(v_pub_doc -> 'pages'),
    'rendered', (v_d.renders ? 'pages' OR v_d.renders ? 'pdf_path'),
    'rendered_version', v_d.renders -> 'version',
    'business_name', coalesce(nullif(btrim(v_ws.brand_name), ''), v_ws.name),
    'business_timezone', coalesce(v_ws.timezone, 'UTC'),
    'doc', CASE WHEN v_d.format = 'web' AND NOT v_is_generation THEN v_pub_doc END
  );
END;
$function$;
COMMENT ON FUNCTION public.design_public_get(p_code text) IS 'Lo único que ve el link público /d/<código> del Diseñador IA. anon puede ejecutarla a propósito: nunca devuelve workspace, emails, teléfonos ni ids del sujeto.';
REVOKE ALL ON FUNCTION public.design_public_get(p_code text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.designs_set_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := private.design_new_code();
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.designs_set_code() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_design_doc(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_pages jsonb;
  v_page jsonb;
  v_el jsonb;
  v_n int;
  v_num numeric;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  IF p -> 'v' IS DISTINCT FROM '1'::jsonb THEN RETURN false; END IF;
  IF (p ->> 'format') IS NULL OR (p ->> 'format') NOT IN ('carta_v','carta_h','a4_v','a4_h','sq','v45','story','wide','web') THEN RETURN false; END IF;
  v_pages := p -> 'pages';
  IF v_pages IS NULL OR jsonb_typeof(v_pages) <> 'array' THEN RETURN false; END IF;
  v_n := jsonb_array_length(v_pages);
  IF v_n < 1 OR v_n > 20 THEN RETURN false; END IF;
  IF (p ->> 'format') = 'web' AND v_n <> 1 THEN RETURN false; END IF;

  FOR v_page IN SELECT * FROM jsonb_array_elements(v_pages) LOOP
    IF jsonb_typeof(v_page) <> 'object' OR jsonb_typeof(v_page -> 'id') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF jsonb_typeof(v_page -> 'background') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF (v_page -> 'background' ->> 'type') IS NULL OR (v_page -> 'background' ->> 'type') NOT IN ('color','gradient','image') THEN RETURN false; END IF;
    IF jsonb_typeof(v_page -> 'elements') IS DISTINCT FROM 'array' OR jsonb_array_length(v_page -> 'elements') > 200 THEN RETURN false; END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(v_page -> 'elements') LOOP
      IF jsonb_typeof(v_el) <> 'object' OR jsonb_typeof(v_el -> 'id') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      IF (v_el ->> 'type') IS NULL OR (v_el ->> 'type') NOT IN ('text','image','shape','html') THEN RETURN false; END IF;
      IF jsonb_typeof(v_el -> 'x') IS DISTINCT FROM 'number' OR jsonb_typeof(v_el -> 'y') IS DISTINCT FROM 'number' OR jsonb_typeof(v_el -> 'w') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
      v_num := (v_el ->> 'x')::numeric; IF v_num < 0 OR v_num > 100 THEN RETURN false; END IF;
      v_num := (v_el ->> 'y')::numeric; IF v_num < 0 OR v_num > 100 THEN RETURN false; END IF;
      v_num := (v_el ->> 'w')::numeric; IF v_num <= 0 OR v_num > 100 THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION public.validate_design_doc(p jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.validate_design_settings(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_item jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN false;
  END IF;
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN
    RETURN false;
  END IF;
  IF p ? 'palette' THEN
    IF jsonb_typeof(p -> 'palette') <> 'array' OR jsonb_array_length(p -> 'palette') > 24 THEN
      RETURN false;
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p -> 'palette') LOOP
      IF jsonb_typeof(v_item) <> 'string' OR (v_item #>> '{}') !~ '^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$' THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;
  IF p ? 'fonts' THEN
    IF jsonb_typeof(p -> 'fonts') <> 'object' THEN
      RETURN false;
    END IF;
    IF (p -> 'fonts') ? 'google' THEN
      IF jsonb_typeof(p -> 'fonts' -> 'google') <> 'array' THEN
        RETURN false;
      END IF;
      FOR v_item IN SELECT * FROM jsonb_array_elements(p -> 'fonts' -> 'google') LOOP
        IF jsonb_typeof(v_item) <> 'string' THEN
          RETURN false;
        END IF;
      END LOOP;
    END IF;
    IF (p -> 'fonts') ? 'uploaded' THEN
      IF jsonb_typeof(p -> 'fonts' -> 'uploaded') <> 'array' THEN
        RETURN false;
      END IF;
      FOR v_item IN SELECT * FROM jsonb_array_elements(p -> 'fonts' -> 'uploaded') LOOP
        IF jsonb_typeof(v_item) <> 'object'
           OR jsonb_typeof(v_item -> 'family') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_item -> 'path') IS DISTINCT FROM 'string' THEN
          RETURN false;
        END IF;
      END LOOP;
    END IF;
  END IF;
  IF p ? 'styles' THEN
    IF jsonb_typeof(p -> 'styles') <> 'array' THEN
      RETURN false;
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p -> 'styles') LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR jsonb_typeof(v_item -> 'key') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_item -> 'name') IS DISTINCT FROM 'string' THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.validate_design_settings(p jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.workspaces_design_settings_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.validate_design_settings(NEW.design_settings) THEN
    RAISE EXCEPTION 'Los ajustes del Diseñador IA no tienen la forma esperada' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.workspaces_design_settings_check() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_ai_messages_thread ON public.ai_messages USING btree (thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_threads_channel ON public.ai_threads USING btree (workspace_id, channel, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_threads_contact ON public.ai_threads USING btree (contact_id) WHERE (contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ai_threads_user ON public.ai_threads USING btree (user_id) WHERE (user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_design_templates_workspace ON public.design_templates USING btree (workspace_id, updated_at DESC) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_design_versions_age ON public.design_versions USING btree (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_design_versions_design ON public.design_versions USING btree (design_id, created_at DESC) WHERE (design_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_design_versions_template ON public.design_versions USING btree (template_id, created_at DESC) WHERE (template_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_designs_content_post ON public.designs USING btree (content_post_id) WHERE (content_post_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_designs_own ON public.designs USING btree (workspace_id, updated_at DESC) WHERE ((template_id IS NULL) AND (archived_at IS NULL));

CREATE INDEX IF NOT EXISTS idx_designs_subject ON public.designs USING btree (subject_contact_id) WHERE (subject_contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_designs_template ON public.designs USING btree (workspace_id, template_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_designs_template_subject ON public.designs USING btree (template_id, subject_contact_id) WHERE (status <> 'void'::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_threads_designer_subject ON public.ai_threads USING btree (subject_type, subject_id) WHERE (channel = 'designer'::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_designs_code ON public.designs USING btree (code);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER update_ai_threads_updated_at BEFORE UPDATE ON public.ai_threads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER contacts_designs_on_merge AFTER UPDATE OF deleted_at ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contacts_designs_on_merge();

CREATE OR REPLACE TRIGGER design_templates_doc_check BEFORE INSERT OR UPDATE OF doc, format ON public.design_templates FOR EACH ROW EXECUTE FUNCTION public.design_doc_check();

CREATE OR REPLACE TRIGGER update_design_templates_updated_at BEFORE UPDATE ON public.design_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER design_versions_doc_check BEFORE INSERT ON public.design_versions FOR EACH ROW EXECUTE FUNCTION public.design_doc_check();

CREATE OR REPLACE TRIGGER designs_doc_check BEFORE INSERT OR UPDATE OF doc, format ON public.designs FOR EACH ROW EXECUTE FUNCTION public.design_doc_check();

CREATE OR REPLACE TRIGGER designs_set_code BEFORE INSERT ON public.designs FOR EACH ROW EXECUTE FUNCTION public.designs_set_code();

CREATE OR REPLACE TRIGGER update_designs_updated_at BEFORE UPDATE ON public.designs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER workspaces_design_settings_check BEFORE INSERT OR UPDATE OF design_settings ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.workspaces_design_settings_check();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY ai_messages_select ON public.ai_messages FOR SELECT TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM public.ai_threads t
  WHERE (t.id = ai_messages.thread_id))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_threads_select ON public.ai_threads FOR SELECT TO authenticated
    USING ((((channel = 'designer'::text) AND ( SELECT public.is_workspace_member(ai_threads.workspace_id) AS is_workspace_member) AND ( SELECT public.has_permission(ai_threads.workspace_id, 'designer.view'::text) AS has_permission)) OR ((channel = 'assistant'::text) AND (user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT public.is_workspace_member(ai_threads.workspace_id) AS is_workspace_member))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_threads_select_portal ON public.ai_threads FOR SELECT TO authenticated
    USING (((channel = 'portal'::text) AND ( SELECT public.is_workspace_member(ai_threads.workspace_id) AS is_workspace_member) AND (contact_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = ai_threads.contact_id) AND public.can_see_contact(c.*))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY design_templates_select ON public.design_templates FOR SELECT TO authenticated
    USING ((( SELECT public.is_workspace_member(design_templates.workspace_id) AS is_workspace_member) AND ( SELECT public.has_permission(design_templates.workspace_id, 'designer.view'::text) AS has_permission)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY design_versions_select ON public.design_versions FOR SELECT TO authenticated
    USING ((( SELECT public.is_workspace_member(design_versions.workspace_id) AS is_workspace_member) AND ( SELECT public.has_permission(design_versions.workspace_id, 'designer.view'::text) AS has_permission)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY designs_select ON public.designs FOR SELECT TO authenticated
    USING ((( SELECT public.is_workspace_member(designs.workspace_id) AS is_workspace_member) AND ( SELECT public.has_permission(designs.workspace_id, 'designer.view'::text) AS has_permission)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
