-- ============================================================================
-- 00150 — Formularios: formularios, versiones y respuestas, y quien las ve
-- ============================================================================
-- Modulo Formularios (personalizado, encuesta/NPS y contrato), F1.
--
-- Tres tablas nuevas, dos funciones de visibilidad y la RLS:
--
--   1. `forms`            el formulario y su copia de trabajo (`draft_definition`).
--   2. `form_versions`    lo que se publico, INMUTABLE (sin policy de UPDATE; la
--                         escribe solo `publish_form_version`, 00152).
--   3. `form_submissions` las respuestas. Escribe solo el servidor (las RPC).
--   4. `can_view_forms(ws)`: ver formularios y metricas. NO usa `has_permission`
--      sola, porque esa funcion devuelve false para el Member de sistema (su fila
--      de rol tiene los permisos vacios a proposito: la fuente es
--      lib/auth/permissions.ts). Contempla los tres casos: Owner/Admin, Member de
--      sistema (que tiene `forms.view`) y rol personalizado con la clave.
--   5. `can_see_form_submission(s)`: Owner/Admin ven todas; el resto, solo las de
--      contactos que `can_see_contact` le deja ver. Una respuesta sin contacto la
--      ve solo un Admin.
--
-- Sin DELETE para nadie: los formularios se archivan, las versiones son
-- permanentes y las respuestas se marcan spam. Sin policy para `anon`: lo
-- publico sale solo por `get_public_form` (00152).
--
-- `sale_id` y `service_id` (en `form_submissions`) son para Ventas y CX: uuid
-- sin FK porque `sales` y `services` todavia no existen. Los suman con su FK
-- esos modulos.
--
-- NO toca ninguna funcion ni policy existente. Aditiva e idempotente.
--
-- Como volver atras (solo tiene sentido si todavia no hay respuestas reales):
--   DROP POLICY IF EXISTS form_submissions_select ON public.form_submissions;
--   DROP POLICY IF EXISTS form_versions_select ON public.form_versions;
--   DROP POLICY IF EXISTS forms_select ON public.forms;
--   ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_current_version_fk;
--   DROP TABLE IF EXISTS public.form_submissions;
--   DROP TABLE IF EXISTS public.form_versions;
--   DROP TABLE IF EXISTS public.forms;
--   DROP FUNCTION IF EXISTS public.can_see_form_submission(public.form_submissions);
--   DROP FUNCTION IF EXISTS public.can_view_forms(uuid);
-- ============================================================================

-- ------------------------------------------------------------
-- 1. forms
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  type text NOT NULL CHECK (type IN ('custom', 'survey', 'contract')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'archived')),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,60}$'),

  draft_definition jsonb NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  current_version_id uuid,
  design jsonb NOT NULL DEFAULT '{}'::jsonb,
  success jsonb NOT NULL DEFAULT '{"mode":"message"}'::jsonb,
  contact_config jsonb NOT NULL DEFAULT '{"mode":"create_or_link","update":"fill_empty","map":[]}'::jsonb,
  survey_config jsonb,
  contract_config jsonb,
  tags_on_submit uuid[] NOT NULL DEFAULT '{}',
  notify_enabled boolean NOT NULL DEFAULT true,
  notify_user_ids uuid[] NOT NULL DEFAULT '{}',

  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT forms_survey_config_required CHECK (type <> 'survey' OR survey_config IS NOT NULL),
  CONSTRAINT forms_contract_config_required CHECK (type <> 'contract' OR contract_config IS NOT NULL)
);

COMMENT ON TABLE public.forms IS
  'Formularios (personalizado, encuesta, contrato). Se archivan, no se borran. Escribe solo el servidor; los lee quien pasa can_view_forms().';

-- La URL publica no lleva workspace: el slug es unico en todo el sistema.
CREATE UNIQUE INDEX IF NOT EXISTS uq_forms_slug_lower ON public.forms (lower(slug));
CREATE INDEX IF NOT EXISTS idx_forms_workspace_status ON public.forms (workspace_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.forms;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.forms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 2. form_versions (inmutable)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.form_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number >= 1),
  definition jsonb NOT NULL,
  contract_text text,
  contract_text_sha256 text,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT form_versions_unique_number UNIQUE (form_id, version_number),
  CONSTRAINT form_versions_sha_hex CHECK (contract_text IS NULL OR contract_text_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE public.form_versions IS
  'Versiones publicadas de un formulario. Inmutables: sin policy de UPDATE; solo las crea publish_form_version().';

CREATE INDEX IF NOT EXISTS idx_form_versions_form ON public.form_versions (form_id, version_number DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.form_versions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.form_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- La FK de la version vigente se agrega aca (la tabla de versiones no existia
-- cuando se creo `forms`). DEFERRABLE: publicar escribe las dos cosas juntas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'forms_current_version_fk'
  ) THEN
    ALTER TABLE public.forms
      ADD CONSTRAINT forms_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES public.form_versions(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. form_submissions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.forms(id),
  form_version_id uuid NOT NULL REFERENCES public.form_versions(id),

  idempotency_key uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('received', 'no_contact', 'spam')),
  answers jsonb NOT NULL,

  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  contact_created boolean NOT NULL DEFAULT false,
  dedupe jsonb NOT NULL DEFAULT '{}'::jsonb,

  score integer,
  nps_category text CHECK (nps_category IN ('promoter', 'passive', 'detractor')),
  once_key text,

  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  upload_prefix text,

  linked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at timestamptz,
  marked_spam_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_spam_at timestamptz,

  -- Para Ventas y CX: sin FK (sales y services todavia no existen).
  sale_id uuid,
  service_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT form_submissions_idempotency UNIQUE (form_id, idempotency_key)
);

COMMENT ON TABLE public.form_submissions IS
  'Respuestas de formularios. Escribe solo el servidor (submit_form_response); las lee quien pasa can_see_form_submission(). Nunca se borran.';

-- "Una vez por contacto": el unico ignora las respuestas marcadas spam.
CREATE UNIQUE INDEX IF NOT EXISTS uq_form_submissions_once
  ON public.form_submissions (form_id, once_key)
  WHERE once_key IS NOT NULL AND status <> 'spam';

CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON public.form_submissions (form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_workspace ON public.form_submissions (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_contact ON public.form_submissions (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_form_submissions_form_status ON public.form_submissions (form_id, status, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.form_submissions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 4. Quien ve formularios y respuestas
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_forms(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.can_view_forms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_forms(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_see_form_submission(s public.form_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_workspace_admin(s.workspace_id)
     OR (
       public.can_view_forms(s.workspace_id)
       AND s.contact_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.contacts ct
         WHERE ct.id = s.contact_id AND public.can_see_contact(ct)
       )
     );
$$;

REVOKE ALL ON FUNCTION public.can_see_form_submission(public.form_submissions) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_form_submission(public.form_submissions) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. RLS: solo lectura para los usuarios; sin DELETE; sin policy para anon
-- ------------------------------------------------------------
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forms_select ON public.forms;
CREATE POLICY forms_select ON public.forms
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id) AND public.can_view_forms(workspace_id));

DROP POLICY IF EXISTS form_versions_select ON public.form_versions;
CREATE POLICY form_versions_select ON public.form_versions
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id) AND public.can_view_forms(workspace_id));

DROP POLICY IF EXISTS form_submissions_select ON public.form_submissions;
CREATE POLICY form_submissions_select ON public.form_submissions
  FOR SELECT TO authenticated
  USING (public.can_see_form_submission(form_submissions));

REVOKE ALL ON public.forms FROM anon;
REVOKE ALL ON public.form_versions FROM anon;
REVOKE ALL ON public.form_submissions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.forms FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.form_versions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.form_submissions FROM authenticated;
