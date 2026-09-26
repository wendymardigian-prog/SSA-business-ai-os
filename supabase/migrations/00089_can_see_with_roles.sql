-- ============================================================
-- 00089: el alcance de leads sale del rol (F69, bloque 9)
-- ============================================================
--
-- Se reescribe SOLO EL CUERPO de `can_see_contact` y `can_see_conversation`.
-- La firma, los GRANT y las cuarenta policies que las llaman no cambian:
-- por eso esta migracion puede correr sin tocar nada mas, y por eso el
-- `verify-rls.mjs` de antes vale como prueba de que no se rompio nada.
--
-- Lo que cambia es UNA linea de logica: donde antes decia "si es Admin, ve
-- todo", ahora dice "si es Admin O su rol tiene alcance `all`, ve todo". El
-- resto —el flag del workspace, las tres vias de asignacion, los leads sin
-- asignar— queda igual.
--
-- Se aplica DESPUES de ver la 00088 en verde, y `verify-rls` se vuelve a
-- correr despues. El orden importa: si algo sale mal, se sabe cual de las
-- dos lo rompio.

-- ------------------------------------------------------------
-- 1. can_see_contact
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

  -- LO NUEVO (00089): un rol personalizado con alcance `all` en leads ve
  -- todo, igual que un Admin. Es el unico agregado de esta migracion.
  IF public.permission_scope(c.workspace_id, 'leads') = 'all' THEN
    RETURN true;
  END IF;

  SELECT w.lead_scope_enabled, w.unassigned_leads_visible_to_members
    INTO v_scoped, v_unassigned_visible
  FROM public.workspaces w
  WHERE w.id = c.workspace_id;

  IF NOT COALESCE(v_scoped, false) THEN
    RETURN true;
  END IF;

  -- Asignado a mi, por cualquiera de las tres vias.
  IF c.setter_id = auth.uid() OR c.vendedor_id = auth.uid() THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.conversations conv
    WHERE conv.contact_id = c.id AND conv.assigned_to = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  -- Sin asignar: lo decide el flag del workspace. "Asignado" incluye tener
  -- setter o vendedor, aunque ninguna conversacion tenga agente.
  v_has_assignee := c.setter_id IS NOT NULL OR c.vendedor_id IS NOT NULL;

  IF NOT v_has_assignee THEN
    SELECT EXISTS (
      SELECT 1 FROM public.conversations conv
      WHERE conv.contact_id = c.id AND conv.assigned_to IS NOT NULL
    ) INTO v_has_assignee;
  END IF;

  IF NOT v_has_assignee THEN
    RETURN COALESCE(v_unassigned_visible, false);
  END IF;

  RETURN false;
END;
$$;

-- ------------------------------------------------------------
-- 2. can_see_conversation
-- ------------------------------------------------------------
--
-- Sigue DELEGANDO en `can_see_contact`, como la dejo la 00028: las dos
-- reglas no pueden separarse, y el contacto borrado tambien esconde sus
-- conversaciones. Lo unico que se suma es el alcance propio de
-- conversaciones, ANTES de delegar: solo ensancha, nunca angosta.
--
-- (El primer intento de esta migracion copio la logica de leads aca en vez
-- de delegar, y con eso deshizo lo de la 00028. Lo encontro verify-rls.)

CREATE OR REPLACE FUNCTION public.can_see_conversation(conv public.conversations)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_workspace_member(conv.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(conv.workspace_id) THEN
    RETURN true;
  END IF;

  -- Un rol con alcance `all` en conversaciones las ve todas. Es un permiso
  -- aparte del de leads: se puede querer que alguien atienda cualquier
  -- conversacion sin darle la ficha de todos los contactos.
  IF public.permission_scope(conv.workspace_id, 'conversations') = 'all' THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE c.id = conv.contact_id
      AND c.deleted_at IS NULL
      AND public.can_see_contact(c)
  );
END;
$$;

COMMENT ON FUNCTION public.can_see_conversation(public.conversations) IS
  'Se ve la conversacion de un lead que se puede ver, o cualquiera si el rol tiene alcance `all` en conversaciones. Delega en can_see_contact para que las dos reglas no puedan separarse (00028, 00089).';

-- Los GRANT sobreviven al CREATE OR REPLACE, pero se repiten por si esta
-- migracion corre sobre una base donde alguna anterior quedo parcial.
REVOKE ALL ON FUNCTION public.can_see_contact(public.contacts) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_conversation(public.conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_contact(public.contacts) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_conversation(public.conversations) TO authenticated, service_role;
