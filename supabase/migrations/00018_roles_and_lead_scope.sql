-- ============================================================
-- MIGRACION 00018 — ROLES Y SCOPE DE LEADS
-- ============================================================
-- Dos cosas:
--
-- 1. Roles. ZernFlow guarda el rol como texto libre y varias policies asumen
--    owner-only. El alcance de Etapa 1 pide Owner/Admin/Member con Admin
--    pudiendo invitar y cambiar roles, y Member sin acceso a configuracion.
--
-- 2. Scope de leads. Un Member solo tiene que ver los contactos y
--    conversaciones donde esta asignado. Los campos setter_id/vendedor_id
--    llegan en el Bloque 3, asi que aca dejamos las funciones y las policies
--    enganchadas: el Bloque 3 solo edita el cuerpo de can_see_contact y
--    can_see_conversation, sin volver a tocar una sola policy.
--
--    El scope arranca APAGADO (workspaces.lead_scope_enabled = false), asi que
--    esta migracion no cambia lo que ve nadie hoy.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Roles validos
-- ------------------------------------------------------------

-- Normalizar antes de restringir: cualquier valor fuera de los tres pasa a
-- 'member', el mas restrictivo.
UPDATE public.workspace_members
SET role = 'member'
WHERE role IS NULL OR role NOT IN ('owner', 'admin', 'member');

ALTER TABLE public.workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_check;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner', 'admin', 'member'));

-- Las invitaciones solo pueden ofrecer admin o member: a owner se llega
-- creando el workspace, no por invitacion.
UPDATE public.workspace_invites
SET role = 'member'
WHERE role IS NULL OR role NOT IN ('admin', 'member');

ALTER TABLE public.workspace_invites DROP CONSTRAINT IF EXISTS workspace_invites_role_check;
ALTER TABLE public.workspace_invites ADD CONSTRAINT workspace_invites_role_check
  CHECK (role IN ('admin', 'member'));

-- is_workspace_member (migracion 00002) es SECURITY DEFINER pero no fija su
-- search_path y nombra la tabla sin schema. Eso funciona mientras la llame
-- una policy con el search_path de sesion, pero revienta con
-- 'relation "workspace_members" does not exist' apenas la llama una funcion
-- que sí fija search_path = '' — que es lo que hacen las funciones de scope
-- de esta migracion. Se rehace calificando el schema y fijando el search_path,
-- que ademas es la forma correcta para una SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$$;

-- Helper de owner (is_workspace_admin ya existe, migracion 00017).
CREATE OR REPLACE FUNCTION public.is_workspace_owner(ws_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid() AND role = 'owner'
  );
$$;

REVOKE ALL ON FUNCTION public.is_workspace_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. Flags de scope, a nivel workspace
-- ------------------------------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS lead_scope_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS unassigned_leads_visible_to_members boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workspaces.lead_scope_enabled IS
  'Cuando esta en true, un Member solo ve contactos y conversaciones donde esta asignado. Se prende en el Bloque 3, cuando existan setter_id y vendedor_id.';
COMMENT ON COLUMN public.workspaces.unassigned_leads_visible_to_members IS
  'Con el scope prendido: si un lead no tiene a nadie asignado, lo ven todos los Members (true) o solo Owner/Admin (false, default).';

-- ------------------------------------------------------------
-- 3. Funciones de scope — el unico lugar que el Bloque 3 tiene que tocar
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_see_contact(c public.contacts)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_scoped              boolean;
  v_unassigned_visible  boolean;
  v_has_assignee        boolean;
BEGIN
  IF NOT public.is_workspace_member(c.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(c.workspace_id) THEN
    RETURN true;
  END IF;

  SELECT w.lead_scope_enabled, w.unassigned_leads_visible_to_members
    INTO v_scoped, v_unassigned_visible
  FROM public.workspaces w
  WHERE w.id = c.workspace_id;

  IF NOT COALESCE(v_scoped, false) THEN
    RETURN true;
  END IF;

  -- Asignado a mi. BLOQUE 3: sumar aca
  --   OR c.setter_id = auth.uid() OR c.vendedor_id = auth.uid()
  IF EXISTS (
    SELECT 1 FROM public.conversations conv
    WHERE conv.contact_id = c.id AND conv.assigned_to = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  -- Sin asignar: lo decide el flag del workspace.
  -- BLOQUE 3: sumar c.setter_id IS NOT NULL OR c.vendedor_id IS NOT NULL
  SELECT EXISTS (
    SELECT 1 FROM public.conversations conv
    WHERE conv.contact_id = c.id AND conv.assigned_to IS NOT NULL
  ) INTO v_has_assignee;

  IF NOT v_has_assignee THEN
    RETURN COALESCE(v_unassigned_visible, false);
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_see_conversation(conv public.conversations)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_scoped              boolean;
  v_unassigned_visible  boolean;
BEGIN
  IF NOT public.is_workspace_member(conv.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(conv.workspace_id) THEN
    RETURN true;
  END IF;

  SELECT w.lead_scope_enabled, w.unassigned_leads_visible_to_members
    INTO v_scoped, v_unassigned_visible
  FROM public.workspaces w
  WHERE w.id = conv.workspace_id;

  IF NOT COALESCE(v_scoped, false) THEN
    RETURN true;
  END IF;

  IF conv.assigned_to = auth.uid() THEN
    RETURN true;
  END IF;

  -- BLOQUE 3: si el contacto tiene a este usuario como setter o vendedor,
  -- tambien ve la conversacion aunque no sea el agente asignado.
  IF conv.assigned_to IS NULL THEN
    RETURN COALESCE(v_unassigned_visible, false);
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_see_contact(public.contacts) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_conversation(public.conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_contact(public.contacts) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_conversation(public.conversations) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Policies de contacts y conversations
-- ------------------------------------------------------------
-- contact_channels, contact_tags y contact_custom_fields NO hace falta
-- tocarlas: sus policies consultan contacts, y una subconsulta dentro de una
-- policy tambien pasa por la RLS de la tabla que consulta. Heredan el scope
-- solas. Lo mismo messages via conversations.

DROP POLICY IF EXISTS "Users can view contacts in their workspaces" ON public.contacts;
DROP POLICY IF EXISTS "Users can manage contacts in their workspaces" ON public.contacts;

DROP POLICY IF EXISTS "contacts_select" ON public.contacts;
CREATE POLICY "contacts_select" ON public.contacts
  FOR SELECT USING (public.can_see_contact(contacts));

DROP POLICY IF EXISTS "contacts_insert" ON public.contacts;
CREATE POLICY "contacts_insert" ON public.contacts
  FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "contacts_update" ON public.contacts;
CREATE POLICY "contacts_update" ON public.contacts
  FOR UPDATE USING (public.can_see_contact(contacts))
  WITH CHECK (public.can_see_contact(contacts));

-- Borrar contactos queda para Owner/Admin (alcance 10.2). El borrado logico
-- del Bloque 3 es un UPDATE, asi que va a seguir la policy de update.
DROP POLICY IF EXISTS "contacts_delete" ON public.contacts;
CREATE POLICY "contacts_delete" ON public.contacts
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "Users can view conversations in their workspaces" ON public.conversations;
DROP POLICY IF EXISTS "Users can manage conversations in their workspaces" ON public.conversations;

DROP POLICY IF EXISTS "conversations_select" ON public.conversations;
CREATE POLICY "conversations_select" ON public.conversations
  FOR SELECT USING (public.can_see_conversation(conversations));

DROP POLICY IF EXISTS "conversations_insert" ON public.conversations;
CREATE POLICY "conversations_insert" ON public.conversations
  FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "conversations_update" ON public.conversations;
CREATE POLICY "conversations_update" ON public.conversations
  FOR UPDATE USING (public.can_see_conversation(conversations))
  WITH CHECK (public.can_see_conversation(conversations));

DROP POLICY IF EXISTS "conversations_delete" ON public.conversations;
CREATE POLICY "conversations_delete" ON public.conversations
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 5. Configuracion del workspace: fuera del alcance de un Member
-- ------------------------------------------------------------
-- Sin esto, un Member podia editar el workspace y apagar lead_scope_enabled
-- para verlo todo.

DROP POLICY IF EXISTS "Users can update their workspaces" ON public.workspaces;

DROP POLICY IF EXISTS "workspaces_update" ON public.workspaces;
CREATE POLICY "workspaces_update" ON public.workspaces
  FOR UPDATE USING (public.is_workspace_admin(id))
  WITH CHECK (public.is_workspace_admin(id));

-- Canales: un Member los ve (los necesita en la bandeja) pero no los gestiona.
DROP POLICY IF EXISTS "Users can manage channels in their workspaces" ON public.channels;

DROP POLICY IF EXISTS "channels_insert" ON public.channels;
CREATE POLICY "channels_insert" ON public.channels
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "channels_update" ON public.channels;
CREATE POLICY "channels_update" ON public.channels
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "channels_delete" ON public.channels;
CREATE POLICY "channels_delete" ON public.channels
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 6. Equipo: Admin puede invitar y cambiar roles; remover queda en Owner
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "workspace_invites_insert" ON public.workspace_invites;
DROP POLICY IF EXISTS "workspace_invites_update" ON public.workspace_invites;
DROP POLICY IF EXISTS "workspace_invites_delete" ON public.workspace_invites;

DROP POLICY IF EXISTS "workspace_invites_insert" ON public.workspace_invites;
CREATE POLICY "workspace_invites_insert" ON public.workspace_invites
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "workspace_invites_update" ON public.workspace_invites;
CREATE POLICY "workspace_invites_update" ON public.workspace_invites
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    -- el invitado acepta su propia invitacion
    OR email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid())
  );

DROP POLICY IF EXISTS "workspace_invites_delete" ON public.workspace_invites;
CREATE POLICY "workspace_invites_delete" ON public.workspace_invites
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- Cambio de rol: Owner puede con cualquiera; Admin solo con filas que no sean
-- de un owner, y sin poder crear owners nuevos (el WITH CHECK mira la fila ya
-- modificada).
DROP POLICY IF EXISTS "Owners can update members" ON public.workspace_members;

DROP POLICY IF EXISTS "workspace_members_update" ON public.workspace_members;
CREATE POLICY "workspace_members_update" ON public.workspace_members
  FOR UPDATE USING (
    public.is_workspace_owner(workspace_id)
    OR (public.is_workspace_admin(workspace_id) AND role <> 'owner')
  )
  WITH CHECK (
    public.is_workspace_owner(workspace_id)
    OR (public.is_workspace_admin(workspace_id) AND role <> 'owner')
  );

-- Remover miembros sigue siendo solo del Owner (criterio de F3): la policy
-- "Owners can delete members" de la migracion 00002 queda como esta.

-- La policy de SELECT de workspace_members era 'user_id = auth.uid()': cada uno
-- veia solo su propia fila. Con eso un Admin no puede cambiarle el rol a nadie,
-- porque el UPDATE no llega a leer la fila del otro. Ademas el Bloque 3 necesita
-- listar los miembros para los desplegables de setter y vendedor.
-- No hay recursion: is_workspace_member es SECURITY DEFINER y corre como dueño
-- de la tabla, asi que la consulta de adentro no vuelve a pasar por RLS.
DROP POLICY IF EXISTS "Members can view their workspace memberships" ON public.workspace_members;

DROP POLICY IF EXISTS "workspace_members_select" ON public.workspace_members;
CREATE POLICY "workspace_members_select" ON public.workspace_members
  FOR SELECT USING (public.is_workspace_member(workspace_id));
