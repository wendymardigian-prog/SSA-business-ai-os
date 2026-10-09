-- ============================================================
-- 00136_lead_scope_by_role.sql
--
-- La visibilidad de los leads sale del ROL, no de dos interruptores del
-- workspace.
--
-- Hasta ahora `can_see_contact` miraba dos columnas de `workspaces`
-- (`lead_scope_enabled` y `unassigned_leads_visible_to_members`), que
-- Ajustes -> General exponia como dos checkboxes. Eso dejaba a la persona que
-- arma los equipos eligiendo en dos lugares distintos (Roles y Ajustes) una
-- sola cosa: que ve cada quien.
--
-- Ahora el alcance de `leads` de cada rol tiene TRES valores:
--   - 'own'            solo los asignados a la persona (setter, vendedor o una
--                      conversacion suya).
--   - 'own_unassigned' los asignados + los que no tienen a nadie asignado.
--   - 'all'            todos (como siempre; Owner y Admin siempre ven todo).
-- Las conversaciones siguen a los contactos (`can_see_conversation` delega en
-- `can_see_contact`) y Agenda no cambia.
--
-- QUE HACE ESTA MIGRACION
--   1. Pasa lo que hay hoy al modelo nuevo SIN ganar ni perder accesos por
--      accidente: en un workspace con "sin asignar visibles" prendido, un rol
--      PERSONALIZADO con alcance 'own' pasa a 'own_unassigned'; en uno con el
--      alcance de leads APAGADO (todos veian todo), pasa a 'all'. Se hace una
--      sola vez: una segunda corrida lo reconoce por el COMENTARIO de la
--      funcion y no toca nada (si no, pisaria un alcance 'own' que alguien
--      puso a proposito despues).
--   2. Reescribe `can_see_contact`. Es la copia de la 00089 con dos cambios:
--      deja de leer los dos interruptores y suma el valor 'own_unassigned'.
--      La firma, los GRANT y las policies que la llaman no cambian.
--
-- LO QUE SI CAMBIA, A PROPOSITO
--   El rol de sistema Member vive en el codigo con alcance 'own'. Donde hoy
--   estaba prendido "sin asignar visibles", los Members dejan de ver los leads
--   sin asignar. Es lo que se eligio ("Member por defecto ve solo los
--   asignados"). Para otro comportamiento se crea un rol con "Asignados + sin
--   asignar".
--
-- LAS DOS COLUMNAS QUEDAN, SIN USO. Borrarlas es una migracion aparte, mas
-- adelante (docs/PENDIENTE.md): una migracion que borra se aplica despues del
-- codigo desplegado.
--
-- ORDEN DE APLICACION: despues del merge y del deploy. Con el codigo nuevo y
-- la funcion vieja, 'own_unassigned' se comporta como 'own' (la funcion vieja
-- solo pregunta por 'all'): no abre nada de mas.
--
-- PARA VOLVER ATRAS: la definicion anterior de `can_see_contact`, completa
-- (la de la 00089), esta aca abajo. Se pega, y los roles que pasaron a
-- 'own_unassigned' vuelven a 'own' con:
--   UPDATE public.workspace_roles
--      SET permissions = jsonb_set(permissions, '{scopes,leads}', '"own"')
--    WHERE permissions #>> '{scopes,leads}' = 'own_unassigned';
--
-- CREATE OR REPLACE FUNCTION public.can_see_contact(c public.contacts)
-- RETURNS boolean
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- STABLE
-- SET search_path = ''
-- AS $$
-- DECLARE
--   v_scoped              boolean;
--   v_unassigned_visible  boolean;
--   v_has_assignee        boolean;
-- BEGIN
--   IF NOT public.is_workspace_member(c.workspace_id) THEN
--     RETURN false;
--   END IF;
--
--   IF public.is_workspace_admin(c.workspace_id) THEN
--     RETURN true;
--   END IF;
--
--   -- LO NUEVO (00089): un rol personalizado con alcance `all` en leads ve
--   -- todo, igual que un Admin. Es el unico agregado de esta migracion.
--   IF public.permission_scope(c.workspace_id, 'leads') = 'all' THEN
--     RETURN true;
--   END IF;
--
--   SELECT w.lead_scope_enabled, w.unassigned_leads_visible_to_members
--     INTO v_scoped, v_unassigned_visible
--   FROM public.workspaces w
--   WHERE w.id = c.workspace_id;
--
--   IF NOT COALESCE(v_scoped, false) THEN
--     RETURN true;
--   END IF;
--
--   -- Asignado a mi, por cualquiera de las tres vias.
--   IF c.setter_id = auth.uid() OR c.vendedor_id = auth.uid() THEN
--     RETURN true;
--   END IF;
--
--   IF EXISTS (
--     SELECT 1 FROM public.conversations conv
--     WHERE conv.contact_id = c.id AND conv.assigned_to = auth.uid()
--   ) THEN
--     RETURN true;
--   END IF;
--
--   -- Sin asignar: lo decide el flag del workspace. "Asignado" incluye tener
--   -- setter o vendedor, aunque ninguna conversacion tenga agente.
--   v_has_assignee := c.setter_id IS NOT NULL OR c.vendedor_id IS NOT NULL;
--
--   IF NOT v_has_assignee THEN
--     SELECT EXISTS (
--       SELECT 1 FROM public.conversations conv
--       WHERE conv.contact_id = c.id AND conv.assigned_to IS NOT NULL
--     ) INTO v_has_assignee;
--   END IF;
--
--   IF NOT v_has_assignee THEN
--     RETURN COALESCE(v_unassigned_visible, false);
--   END IF;
--
--   RETURN false;
-- END;
-- $$;
-- ============================================================

-- ------------------------------------------------------------
-- 1. Pasar lo que hay al modelo nuevo (una sola vez)
-- ------------------------------------------------------------

DO $$
DECLARE
  v_already boolean;
BEGIN
  SELECT COALESCE(obj_description('public.can_see_contact(public.contacts)'::regprocedure, 'pg_proc') LIKE '%00136%', false)
    INTO v_already;

  IF NOT v_already THEN
    -- Alcance de leads APAGADO: todos veian todo. Un rol personalizado en 'own'
    -- seguiria viendo todo, asi que pasa a 'all'.
    UPDATE public.workspace_roles r
       SET permissions = jsonb_set(r.permissions, '{scopes,leads}', '"all"')
      FROM public.workspaces w
     WHERE w.id = r.workspace_id
       AND r.system_role IS NULL
       AND NOT w.lead_scope_enabled
       AND r.permissions #>> '{scopes,leads}' = 'own';

    -- "Sin asignar visibles" prendido: un rol personalizado en 'own' veia los
    -- sin asignar, asi que pasa a 'own_unassigned'.
    UPDATE public.workspace_roles r
       SET permissions = jsonb_set(r.permissions, '{scopes,leads}', '"own_unassigned"')
      FROM public.workspaces w
     WHERE w.id = r.workspace_id
       AND r.system_role IS NULL
       AND w.lead_scope_enabled
       AND w.unassigned_leads_visible_to_members
       AND r.permissions #>> '{scopes,leads}' = 'own';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. can_see_contact
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_see_contact(c public.contacts)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_scope         text;
  v_has_assignee  boolean;
BEGIN
  IF NOT public.is_workspace_member(c.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(c.workspace_id) THEN
    RETURN true;
  END IF;

  -- El alcance de leads de MI rol. Un valor que no conoce se trata como 'own':
  -- ante la duda, lo mas angosto.
  v_scope := public.permission_scope(c.workspace_id, 'leads');

  IF v_scope = 'all' THEN
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

  -- Sin asignar: lo decide el rol. "Asignado" incluye tener setter o vendedor,
  -- aunque ninguna conversacion tenga agente.
  IF v_scope = 'own_unassigned' THEN
    v_has_assignee := c.setter_id IS NOT NULL OR c.vendedor_id IS NOT NULL;

    IF NOT v_has_assignee THEN
      SELECT EXISTS (
        SELECT 1 FROM public.conversations conv
        WHERE conv.contact_id = c.id AND conv.assigned_to IS NOT NULL
      ) INTO v_has_assignee;
    END IF;

    IF NOT v_has_assignee THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.can_see_contact(public.contacts) IS
  'Se ve un contacto si es del workspace y: sos Admin, o tu rol tiene alcance leads=all, o es tuyo (setter, vendedor o conversacion asignada), o tu rol tiene leads=own_unassigned y nadie lo tiene asignado. Sale del ROL, ya no de los interruptores del workspace (00136).';

REVOKE ALL ON FUNCTION public.can_see_contact(public.contacts) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_contact(public.contacts) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Las dos columnas quedan sin uso
-- ------------------------------------------------------------

COMMENT ON COLUMN public.workspaces.lead_scope_enabled IS
  'SIN USO desde la 00136: el alcance de leads sale del rol (workspace_roles.permissions.scopes.leads). Se borra en una migracion aparte.';
COMMENT ON COLUMN public.workspaces.unassigned_leads_visible_to_members IS
  'SIN USO desde la 00136: lo reemplaza el alcance leads=own_unassigned del rol. Se borra en una migracion aparte.';
