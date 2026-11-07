-- ============================================================================
-- 00320_designer_tables  (Diseñador IA, D2)
-- ============================================================================
-- Cinco tablas nuevas, todas con RLS de lectura y SIN políticas de escritura (escriben Server Actions y
-- jobs con el cliente de servicio, después de validar el permiso y el negocio):
--   - design_templates   plantillas (con variables, verificación solo en formatos impresos).
--   - designs            diseños propios (template_id NULL) y GENERACIONES (template_id con valor).
--   - design_versions    historial del documento (solo el `doc`, sin imágenes).
--   - ai_threads         conversaciones con una IA fuera de la bandeja (GENÉRICA de BAIOS: Diseñador IA,
--                        después el tutor del portal y el asistente).
--   - ai_messages        sus mensajes.
-- Además:
--   - `public.validate_design_doc(jsonb)`: gemela de estructura de `lib/designer/doc/schema.ts` (casos
--     compartidos en `lib/designer/doc/doc.cases.json`), por trigger en plantillas, diseños y versiones.
--   - `private.design_new_code()`: 12 caracteres Crockford base32 en tres grupos (K8F2-WQ4M-7TQA), único
--     global. Lo pone un trigger (un DEFAULT no puede llamar a `private`: corre con los permisos de quien
--     inserta).
--   - `public.design_public_get(code)`: lo único que ve el link público (`anon` puede ejecutarla a
--     propósito). Nunca devuelve el workspace, emails, teléfonos ni ids del sujeto.
--   - Fusión de contactos: `contacts_designs_on_merge` reapunta `designs.subject_contact_id` y
--     `ai_threads.contact_id` cuando `merge_contacts` borra el duplicado con `metadata.merged_into` (mismo
--     patrón que 00256, sin reescribir `merge_contacts`). Por eso las dos tablas van a
--     `CONTACT_MERGE_EXCLUSIONS` con ese motivo.
--   - Limpieza diaria: `private.enqueue_design_cleanup()` encola un `design_cleanup` por negocio y por día
--     SOLO si tiene algo para limpiar; `cron.schedule` diario por SQL directo (no toca `call_app_cron`).
--     Con las tablas vacías no encola nada: es segura antes del deploy.
--
-- Aditiva. Va ANTES de desplegar el código (lo lee).
--
-- Cómo volver atrás (con respaldo previo en docs/designer/respaldo-<tabla>.json si hay datos reales):
--   SELECT cron.unschedule('design-cleanup') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'design-cleanup');
--   DROP FUNCTION IF EXISTS private.enqueue_design_cleanup(timestamptz);
--   DROP TRIGGER IF EXISTS contacts_designs_on_merge ON public.contacts;
--   DROP FUNCTION IF EXISTS public.contacts_designs_on_merge();
--   DROP FUNCTION IF EXISTS public.design_public_get(text);
--   DROP TABLE IF EXISTS public.ai_messages, public.ai_threads, public.design_versions, public.designs, public.design_templates;
--   DROP FUNCTION IF EXISTS public.designs_set_code(), public.design_doc_check(), public.validate_design_doc(jsonb), private.design_new_code();
-- Riesgo: bajo.
-- ============================================================================

-- ─── Validador de estructura del documento ──────────────────────────────────
-- Estructura, conteos y tipos (la validación fina es la de Zod en el servidor). True o false, nunca NULL.

CREATE OR REPLACE FUNCTION public.validate_design_doc(p jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.validate_design_doc(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_design_doc(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.design_doc_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT public.validate_design_doc(NEW.doc) THEN
    RAISE EXCEPTION 'El documento del diseño no tiene la forma esperada' USING ERRCODE = '22023';
  END IF;
  IF TG_TABLE_NAME IN ('design_templates', 'designs') AND (NEW.doc ->> 'format') IS DISTINCT FROM NEW.format THEN
    RAISE EXCEPTION 'El formato del documento no coincide con el de la fila' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.design_doc_check() FROM PUBLIC, anon, authenticated;

-- ─── Códigos ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.design_new_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION private.design_new_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.design_new_code() TO service_role;

-- ─── design_templates ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.design_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  format text NOT NULL CHECK (format IN ('carta_v','carta_h','a4_v','a4_h','sq','v45','story','wide')),
  doc jsonb NOT NULL,
  rev integer NOT NULL DEFAULT 0,
  custom_vars jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(custom_vars) = 'array'),
  date_format text NOT NULL DEFAULT 'long' CHECK (date_format IN ('long','short','en')),
  verify boolean NOT NULL DEFAULT false,
  doc_type text NULL CHECK (doc_type IS NULL OR doc_type IN ('certificado','constancia','diploma','otro')),
  doc_type_label text NULL,
  allow_download boolean NOT NULL DEFAULT true,
  origin text NOT NULL CHECK (origin IN ('ai','image','html','blank')),
  style text NULL,
  archived_at timestamptz NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- V1/V2 (plano 1.2): la verificación solo en formatos impresos, con tipo de documento; el nombre solo con «otro».
  CONSTRAINT design_templates_verify_print CHECK (NOT verify OR format IN ('carta_v','carta_h','a4_v','a4_h')),
  CONSTRAINT design_templates_verify_type CHECK (NOT verify OR doc_type IS NOT NULL),
  CONSTRAINT design_templates_verify_other_label CHECK (NOT verify OR doc_type IS DISTINCT FROM 'otro' OR doc_type_label IS NOT NULL),
  CONSTRAINT design_templates_label_only_other CHECK (doc_type_label IS NULL OR (doc_type = 'otro' AND char_length(btrim(doc_type_label)) BETWEEN 1 AND 40))
);

CREATE INDEX IF NOT EXISTS idx_design_templates_workspace ON public.design_templates (workspace_id, updated_at DESC) WHERE archived_at IS NULL;

-- ─── designs (diseños propios y generaciones) ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  format text NOT NULL CHECK (format IN ('carta_v','carta_h','a4_v','a4_h','sq','v45','story','wide','web')),
  doc jsonb NOT NULL,
  rev integer NOT NULL DEFAULT 0,
  origin text NOT NULL CHECK (origin IN ('ai','image','html','blank','template')),
  style text NULL,
  code text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  allow_download boolean NOT NULL DEFAULT true,
  allow_indexing boolean NOT NULL DEFAULT false,
  published_at timestamptz NULL,
  -- NO ACTION a propósito: borrar un workspace entero no choca en el medio de la cascada.
  template_id uuid NULL REFERENCES public.design_templates(id),
  subject_contact_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
  subject_ref jsonb NULL,
  "values" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("values") = 'object'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','rendering','ready','failed','void')),
  error text NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NULL,
  source text NULL CHECK (source IS NULL OR source IN ('manual','bulk','automation','module')),
  source_ref jsonb NULL,
  email_status text NULL CHECK (email_status IS NULL OR email_status IN ('sent','failed','skipped')),
  void_reason text NULL,
  voided_at timestamptz NULL,
  voided_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  renders jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(renders) = 'object'),
  content_post_id uuid NULL REFERENCES public.content_posts(id) ON DELETE SET NULL,
  content_network text NULL,
  last_qa jsonb NULL,
  archived_at timestamptz NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designs_code_format CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  CONSTRAINT designs_void_reason CHECK (status <> 'void' OR (void_reason IS NOT NULL AND char_length(btrim(void_reason)) > 0)),
  CONSTRAINT designs_indexing_web CHECK (NOT allow_indexing OR format = 'web'),
  CONSTRAINT designs_generation_source CHECK (template_id IS NULL OR source IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_designs_code ON public.designs (code);
CREATE INDEX IF NOT EXISTS idx_designs_template ON public.designs (workspace_id, template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_designs_template_subject ON public.designs (template_id, subject_contact_id) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS idx_designs_content_post ON public.designs (content_post_id) WHERE content_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_designs_own ON public.designs (workspace_id, updated_at DESC) WHERE template_id IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_designs_subject ON public.designs (subject_contact_id) WHERE subject_contact_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.designs_set_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := private.design_new_code();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.designs_set_code() FROM PUBLIC, anon, authenticated;

-- El código se pone antes de los CHECK: `code` es NOT NULL pero el trigger BEFORE corre primero.
ALTER TABLE public.designs ALTER COLUMN code SET DEFAULT '';

DROP TRIGGER IF EXISTS designs_set_code ON public.designs;
CREATE TRIGGER designs_set_code BEFORE INSERT ON public.designs FOR EACH ROW EXECUTE FUNCTION public.designs_set_code();

-- ─── design_versions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.design_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  template_id uuid NULL REFERENCES public.design_templates(id) ON DELETE CASCADE,
  design_id uuid NULL REFERENCES public.designs(id) ON DELETE CASCADE,
  doc jsonb NOT NULL,
  reason text NOT NULL CHECK (reason IN ('ai','manual','publish','restore','generate','import')),
  author_kind text NOT NULL CHECK (author_kind IN ('user','ai')),
  author_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_versions_one_subject CHECK (num_nonnulls(template_id, design_id) = 1)
);

CREATE INDEX IF NOT EXISTS idx_design_versions_design ON public.design_versions (design_id, created_at DESC) WHERE design_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_design_versions_template ON public.design_versions (template_id, created_at DESC) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_design_versions_age ON public.design_versions (workspace_id, created_at);

-- ─── ai_threads / ai_messages (genéricas de BAIOS) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('designer','portal','assistant')),
  agent_id uuid NULL REFERENCES public.agents(id) ON DELETE SET NULL,
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
  subject_type text NULL CHECK (subject_type IS NULL OR subject_type IN ('design','design_template','product')),
  subject_id uuid NULL,
  title text NULL,
  last_message_at timestamptz NULL,
  archived_at timestamptz NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_threads_designer_subject CHECK (channel <> 'designer' OR (subject_type IN ('design','design_template') AND subject_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_ai_threads_channel ON public.ai_threads (workspace_id, channel, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_threads_contact ON public.ai_threads (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_threads_user ON public.ai_threads (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_threads_designer_subject ON public.ai_threads (subject_type, subject_id) WHERE channel = 'designer';

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.ai_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL CHECK (char_length(content) <= 20000),
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  result jsonb NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(citations) = 'array'),
  agent_run_id uuid NULL REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  feedback text NULL CHECK (feedback IS NULL OR feedback IN ('up','down')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_thread ON public.ai_messages (thread_id, created_at);

-- ─── Triggers comunes ───────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS design_templates_doc_check ON public.design_templates;
CREATE TRIGGER design_templates_doc_check BEFORE INSERT OR UPDATE OF doc, format ON public.design_templates FOR EACH ROW EXECUTE FUNCTION public.design_doc_check();
DROP TRIGGER IF EXISTS designs_doc_check ON public.designs;
CREATE TRIGGER designs_doc_check BEFORE INSERT OR UPDATE OF doc, format ON public.designs FOR EACH ROW EXECUTE FUNCTION public.design_doc_check();
DROP TRIGGER IF EXISTS design_versions_doc_check ON public.design_versions;
CREATE TRIGGER design_versions_doc_check BEFORE INSERT ON public.design_versions FOR EACH ROW EXECUTE FUNCTION public.design_doc_check();

DROP TRIGGER IF EXISTS update_design_templates_updated_at ON public.design_templates;
CREATE TRIGGER update_design_templates_updated_at BEFORE UPDATE ON public.design_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS update_designs_updated_at ON public.designs;
CREATE TRIGGER update_designs_updated_at BEFORE UPDATE ON public.designs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS update_ai_threads_updated_at ON public.ai_threads;
CREATE TRIGGER update_ai_threads_updated_at BEFORE UPDATE ON public.ai_threads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── RLS: solo lectura ─────────────────────────────────────────────────────

ALTER TABLE public.design_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS design_templates_select ON public.design_templates;
CREATE POLICY design_templates_select ON public.design_templates FOR SELECT TO authenticated
  USING ((SELECT public.is_workspace_member(workspace_id)) AND (SELECT public.has_permission(workspace_id, 'designer.view')));

DROP POLICY IF EXISTS designs_select ON public.designs;
CREATE POLICY designs_select ON public.designs FOR SELECT TO authenticated
  USING ((SELECT public.is_workspace_member(workspace_id)) AND (SELECT public.has_permission(workspace_id, 'designer.view')));

DROP POLICY IF EXISTS design_versions_select ON public.design_versions;
CREATE POLICY design_versions_select ON public.design_versions FOR SELECT TO authenticated
  USING ((SELECT public.is_workspace_member(workspace_id)) AND (SELECT public.has_permission(workspace_id, 'designer.view')));

-- Por canal: el Diseñador con `designer.view`; el asistente, solo la persona dueña del hilo y solo si es
-- miembro de ese negocio; el portal todavía sin política (la suma Servicios).
DROP POLICY IF EXISTS ai_threads_select ON public.ai_threads;
CREATE POLICY ai_threads_select ON public.ai_threads FOR SELECT TO authenticated
  USING (
    (channel = 'designer' AND (SELECT public.is_workspace_member(workspace_id)) AND (SELECT public.has_permission(workspace_id, 'designer.view')))
    OR (channel = 'assistant' AND user_id = (SELECT auth.uid()) AND (SELECT public.is_workspace_member(workspace_id)))
  );

DROP POLICY IF EXISTS ai_messages_select ON public.ai_messages;
CREATE POLICY ai_messages_select ON public.ai_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_threads t WHERE t.id = ai_messages.thread_id));

REVOKE ALL ON public.design_templates FROM anon, authenticated;
REVOKE ALL ON public.designs FROM anon, authenticated;
REVOKE ALL ON public.design_versions FROM anon, authenticated;
REVOKE ALL ON public.ai_threads FROM anon, authenticated;
REVOKE ALL ON public.ai_messages FROM anon, authenticated;
GRANT SELECT ON public.design_templates TO authenticated;
GRANT SELECT ON public.designs TO authenticated;
GRANT SELECT ON public.design_versions TO authenticated;
GRANT SELECT ON public.ai_threads TO authenticated;
GRANT SELECT ON public.ai_messages TO authenticated;
GRANT ALL ON public.design_templates TO service_role;
GRANT ALL ON public.designs TO service_role;
GRANT ALL ON public.design_versions TO service_role;
GRANT ALL ON public.ai_threads TO service_role;
GRANT ALL ON public.ai_messages TO service_role;

-- ─── Lectura pública del link /d/<código> ───────────────────────────────────
-- Devuelve SOLO lo que muestra el link: un diseño PUBLICADO o una generación de una plantilla con
-- verificación (para mostrar "válido" o "anulado"). Nunca el workspace, emails, teléfonos ni ids del
-- sujeto; el documento solo para una página web propia (no tiene datos de nadie). `anon` la puede
-- ejecutar a propósito (el link es público).

CREATE OR REPLACE FUNCTION public.design_public_get(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_d public.designs%ROWTYPE;
  v_t public.design_templates%ROWTYPE;
  v_ws public.workspaces%ROWTYPE;
  v_is_generation boolean;
  v_verify boolean := false;
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
    'page_count', jsonb_array_length(v_d.doc -> 'pages'),
    'rendered', (v_d.renders ? 'pages' OR v_d.renders ? 'pdf_path'),
    'rendered_version', v_d.renders -> 'version',
    'business_name', coalesce(nullif(btrim(v_ws.brand_name), ''), v_ws.name),
    'business_timezone', coalesce(v_ws.timezone, 'UTC'),
    'doc', CASE WHEN v_d.format = 'web' AND NOT v_is_generation THEN v_d.doc END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.design_public_get(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.design_public_get(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.design_public_get(text) IS
  'Lo único que ve el link público /d/<código> del Diseñador IA. anon puede ejecutarla a propósito: nunca devuelve workspace, emails, teléfonos ni ids del sujeto.';

-- ─── Fusión de contactos ────────────────────────────────────────────────────
-- `merge_contacts` (00247) borra el duplicado con `metadata.merged_into`. Al ver eso, lo que apuntaba al
-- duplicado pasa al principal. Nunca tumba la fusión: un error queda en un WARNING.

CREATE OR REPLACE FUNCTION public.contacts_designs_on_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.contacts_designs_on_merge() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contacts_designs_on_merge ON public.contacts;
CREATE TRIGGER contacts_designs_on_merge
  AFTER UPDATE OF deleted_at ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_designs_on_merge();

-- ─── Limpieza diaria (F48b) ─────────────────────────────────────────────────
-- Encola UN `design_cleanup` por negocio y por día, solo si tiene versiones de más de 30 días o
-- exportaciones sueltas de más de 7. Qué se borra lo decide `cleanupPlan` (lib/designer/cleanup.ts).

CREATE OR REPLACE FUNCTION private.enqueue_design_cleanup(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws uuid;
  v_key text;
  v_enqueued integer := 0;
BEGIN
  FOR v_ws IN
    SELECT DISTINCT v.workspace_id FROM public.design_versions v WHERE v.created_at < p_now - interval '30 days'
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
$$;

REVOKE ALL ON FUNCTION private.enqueue_design_cleanup(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.enqueue_design_cleanup(timestamptz) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'design-cleanup') THEN
    PERFORM cron.unschedule('design-cleanup');
  END IF;
END $$;

SELECT cron.schedule('design-cleanup', '23 4 * * *', $$SELECT private.enqueue_design_cleanup()$$);
