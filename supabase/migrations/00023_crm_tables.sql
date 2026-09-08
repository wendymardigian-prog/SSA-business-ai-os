-- ============================================================
-- MIGRACION 00023 — NOTAS, AUDIT LOG Y BORRADO LOGICO (F13 + F15)
-- ============================================================
-- Tres tablas nuevas y una columna:
--
-- 1. contact_notes. Las notas viven en el CONTACTO, no en la conversacion:
--    un lead que escribe por Instagram y por WhatsApp tiene dos
--    conversaciones pero una sola historia.
-- 2. audit_log. Registro central de que cambio, quien lo cambio y cuando.
--    Lo necesitan ya las asignaciones (F11), las vinculaciones cross-canal
--    (F12) y el borrado logico (F15). Nunca se borra: no tiene deleted_at.
-- 3. response_templates. Su CRUD y su UI son del Bloque 4, pero F15 exige que
--    tenga deleted_at y que la purga la cubra, asi que la tabla se crea aca,
--    vacia. La migracion del Bloque 4 es CREATE TABLE IF NOT EXISTS: la va a
--    encontrar hecha y no rompe nada.
-- 4. conversations.deleted_at, la cuarta tabla con soft delete de F15.
--
-- Sobre la RLS de contact_notes: la policy consulta contacts en vez de
-- llamar a can_see_contact. Una subconsulta dentro de una policy tambien pasa
-- por la RLS de la tabla que consulta, asi que las notas heredan el scope de
-- leads solas y no hay que volver a tocarlas cuando el scope cambie. Es el
-- mismo mecanismo que documenta la migracion 00018 para contact_channels y
-- contact_tags.
-- ============================================================

-- ------------------------------------------------------------
-- 1. contact_notes (F13)
-- ------------------------------------------------------------
-- workspace_id esta desnormalizado a proposito: se podria derivar del
-- contacto, pero tenerlo directo evita un JOIN en cada policy.

CREATE TABLE IF NOT EXISTS public.contact_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  content text NOT NULL,

  -- Quien la escribio. ON DELETE SET NULL: si el usuario se va, la nota queda.
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contact_notes_content_not_blank'
  ) THEN
    ALTER TABLE public.contact_notes ADD CONSTRAINT contact_notes_content_not_blank
      CHECK (length(btrim(content)) > 0);
  END IF;
END;
$$;

-- La ficha lista las notas vivas de un contacto, mas nuevas primero.
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact
  ON public.contact_notes(contact_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_notes_deleted_at
  ON public.contact_notes(deleted_at) WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.contact_notes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contact_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.contact_notes IS
  'Notas del contacto (no de la conversacion). Cualquier miembro crea; solo el autor o un Admin/Owner edita o borra.';

-- ------------------------------------------------------------
-- 2. audit_log (F20, adelantado porque el Bloque 3 ya escribe en el)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- 'contact', 'contact_note', 'conversation', 'channel', 'workspace', ...
  -- Texto libre: cada funcionalidad nueva suma su tipo sin migrar.
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,

  -- 'create', 'update', 'delete', 'restore', 'assign', 'link', 'import', ...
  action text NOT NULL,

  -- { campo: { old: valor, new: valor } } para los updates.
  changes jsonb,

  -- Datos extra del evento (motivo de una vinculacion, filas de un import).
  metadata jsonb,

  -- Null = lo hizo el sistema (webhook, cron).
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_workspace
  ON public.audit_log(workspace_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON public.audit_log(entity_type, entity_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_performer
  ON public.audit_log(workspace_id, performed_by, performed_at DESC);

COMMENT ON TABLE public.audit_log IS
  'Historial de cambios significativos. Inmutable y sin soft delete: no se edita ni se borra nunca.';

-- ------------------------------------------------------------
-- 3. response_templates — solo la estructura (F15; el CRUD es del Bloque 4)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.response_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  name text NOT NULL,
  content text NOT NULL,

  -- Atajo para buscarlo rapido en la bandeja, ej "/precio".
  shortcut text,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_response_templates_workspace
  ON public.response_templates(workspace_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_response_templates_deleted_at
  ON public.response_templates(deleted_at) WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.response_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.response_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.response_templates IS
  'Respuestas rapidas con variables {{...}}. La tabla se crea en el Bloque 3 porque el soft delete de F15 la incluye; el CRUD y la UI son del Bloque 4.';

-- ------------------------------------------------------------
-- 4. Soft delete en conversations (F15)
-- ------------------------------------------------------------

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.conversations.deleted_at IS
  'Borrado logico. Retencion de 30 dias, despues lo purga /api/cron/purge-deleted.';

CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at
  ON public.conversations(deleted_at) WHERE deleted_at IS NOT NULL;

-- ------------------------------------------------------------
-- 5. RLS
-- ------------------------------------------------------------

-- contact_notes: leer y crear lo puede cualquier miembro que VEA el contacto
-- (de ahi la subconsulta, que hereda el scope de leads). Editar y borrar,
-- solo el autor o un Admin/Owner.
ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_notes_select" ON public.contact_notes;
CREATE POLICY "contact_notes_select" ON public.contact_notes
  FOR SELECT USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_notes.contact_id
    )
  );

DROP POLICY IF EXISTS "contact_notes_insert" ON public.contact_notes;
CREATE POLICY "contact_notes_insert" ON public.contact_notes
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_notes.contact_id
        AND c.workspace_id = contact_notes.workspace_id
    )
  );

-- El borrado es logico, o sea un UPDATE: por eso el USING no exige que la
-- nota este viva (si no, no se podria restaurar) pero si exige autoria o rol.
DROP POLICY IF EXISTS "contact_notes_update" ON public.contact_notes;
CREATE POLICY "contact_notes_update" ON public.contact_notes
  FOR UPDATE USING (
    (created_by = auth.uid() OR public.is_workspace_admin(workspace_id))
    AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_notes.contact_id)
  )
  WITH CHECK (
    created_by = auth.uid() OR public.is_workspace_admin(workspace_id)
  );

DROP POLICY IF EXISTS "contact_notes_delete" ON public.contact_notes;
CREATE POLICY "contact_notes_delete" ON public.contact_notes
  FOR DELETE USING (
    created_by = auth.uid() OR public.is_workspace_admin(workspace_id)
  );

-- audit_log: un Member ve solo lo que hizo el; Owner y Admin ven todo.
-- El INSERT exige performed_by = auth.uid(): nadie puede inventar una entrada
-- a nombre de otro. Los procesos del sistema escriben con la service key, que
-- saltea RLS, y ahi performed_by queda en null.
-- Sin policies de UPDATE ni DELETE: el registro es inmutable.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT USING (
    public.is_workspace_admin(workspace_id)
    OR (public.is_workspace_member(workspace_id) AND performed_by = auth.uid())
  );

DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
CREATE POLICY "audit_log_insert" ON public.audit_log
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id) AND performed_by = auth.uid()
  );

-- response_templates: las ve cualquier miembro (las usa en la bandeja), las
-- gestionan Owner y Admin.
ALTER TABLE public.response_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "response_templates_select" ON public.response_templates;
CREATE POLICY "response_templates_select" ON public.response_templates
  FOR SELECT USING (deleted_at IS NULL AND public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "response_templates_insert" ON public.response_templates;
CREATE POLICY "response_templates_insert" ON public.response_templates
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "response_templates_update" ON public.response_templates;
CREATE POLICY "response_templates_update" ON public.response_templates
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "response_templates_delete" ON public.response_templates;
CREATE POLICY "response_templates_delete" ON public.response_templates
  FOR DELETE USING (public.is_workspace_admin(workspace_id));
