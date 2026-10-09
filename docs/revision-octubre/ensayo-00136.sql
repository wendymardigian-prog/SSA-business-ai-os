BEGIN;

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


-- ============================================================
-- ENSAYO (no se confirma nunca): termina en un error a proposito, asi la
-- transaccion entera se deshace sola y la base queda igual que antes.
-- ============================================================
DO $t$
DECLARE
  w   uuid := gen_random_uuid();
  ua  uuid := gen_random_uuid();   -- el Member de prueba
  ub  uuid := gen_random_uuid();   -- el Admin de prueba
  c_free uuid; c_mine uuid; c_other uuid;
  r_unassigned uuid; r_all uuid; r_own uuid;
  n int;
  out text := '';
  cm text;
BEGIN
  -- Lo que le paso al rol real "Content Manager" (leads=all): tiene que seguir igual.
  SELECT permissions #>> '{scopes,leads}' INTO cm FROM public.workspace_roles WHERE name = 'Content Manager' LIMIT 1;
  out := out || 'content_manager_leads=' || coalesce(cm,'(no existe)') || E'\n';

  -- Datos de prueba
  INSERT INTO auth.users (id, email, aud, role) VALUES (ua, 'zz-ensayo-a@example.test', 'authenticated', 'authenticated'),
                                                         (ub, 'zz-ensayo-b@example.test', 'authenticated', 'authenticated');
  INSERT INTO public.workspaces (id, name, slug) VALUES (w, 'zz-ensayo-00136', 'zz-ensayo-00136-' || substr(w::text,1,8));
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (w, ua, 'member'), (w, ub, 'admin');

  INSERT INTO public.contacts (workspace_id, display_name) VALUES (w, 'libre') RETURNING id INTO c_free;
  INSERT INTO public.contacts (workspace_id, display_name, setter_id) VALUES (w, 'mio', ua) RETURNING id INTO c_mine;
  INSERT INTO public.contacts (workspace_id, display_name, setter_id) VALUES (w, 'ajeno', ub) RETURNING id INTO c_other;

  INSERT INTO public.workspace_roles (workspace_id, name, permissions) VALUES
    (w, 'zz-own',            '{"keys":[],"scopes":{"leads":"own","conversations":"own","bookings":"own"}}'),
    (w, 'zz-own-unassigned', '{"keys":[],"scopes":{"leads":"own_unassigned","conversations":"own","bookings":"own"}}'),
    (w, 'zz-all',            '{"keys":[],"scopes":{"leads":"all","conversations":"own","bookings":"own"}}');
  SELECT id INTO r_own        FROM public.workspace_roles WHERE workspace_id = w AND name = 'zz-own';
  SELECT id INTO r_unassigned FROM public.workspace_roles WHERE workspace_id = w AND name = 'zz-own-unassigned';
  SELECT id INTO r_all        FROM public.workspace_roles WHERE workspace_id = w AND name = 'zz-all';

  -- Como el Member: probar lo que ve segun su rol
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO n FROM public.contacts WHERE workspace_id = w;
  out := out || 'member_de_sistema_ve=' || n || ' (esperado 1: solo el suyo)' || E'\n';
  IF n <> 1 THEN RAISE EXCEPTION 'FALLA: el Member de sistema deberia ver 1, vio %', n; END IF;

  RESET ROLE;
  UPDATE public.workspace_members SET role_id = r_own WHERE workspace_id = w AND user_id = ua;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.contacts WHERE workspace_id = w;
  out := out || 'rol_own_ve=' || n || ' (esperado 1)' || E'\n';
  IF n <> 1 THEN RAISE EXCEPTION 'FALLA: rol own deberia ver 1, vio %', n; END IF;

  RESET ROLE;
  UPDATE public.workspace_members SET role_id = r_unassigned WHERE workspace_id = w AND user_id = ua;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.contacts WHERE workspace_id = w;
  out := out || 'rol_own_unassigned_ve=' || n || ' (esperado 2: el suyo + el libre, NO el de otro)' || E'\n';
  IF n <> 2 THEN RAISE EXCEPTION 'FALLA: own_unassigned deberia ver 2, vio %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.contacts WHERE id = c_other) THEN RAISE EXCEPTION 'FALLA: own_unassigned ve el lead de otro'; END IF;

  RESET ROLE;
  UPDATE public.workspace_members SET role_id = r_all WHERE workspace_id = w AND user_id = ua;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.contacts WHERE workspace_id = w;
  out := out || 'rol_all_ve=' || n || ' (esperado 3)' || E'\n';
  IF n <> 3 THEN RAISE EXCEPTION 'FALLA: rol all deberia ver 3, vio %', n; END IF;

  -- Los interruptores viejos ya no cuentan: con el rol own, prenderlos no abre nada.
  RESET ROLE;
  UPDATE public.workspace_members SET role_id = r_own WHERE workspace_id = w AND user_id = ua;
  UPDATE public.workspaces SET unassigned_leads_visible_to_members = true, lead_scope_enabled = false WHERE id = w;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.contacts WHERE workspace_id = w;
  out := out || 'rol_own_con_interruptores_prendidos_ve=' || n || ' (esperado 1: ya no cuentan)' || E'\n';
  IF n <> 1 THEN RAISE EXCEPTION 'FALLA: los interruptores viejos todavia cuentan (vio %)', n; END IF;

  -- Una conversacion del lead libre la ve el rol own_unassigned (las conversaciones siguen al lead)
  RESET ROLE;
  UPDATE public.workspace_members SET role_id = r_unassigned WHERE workspace_id = w AND user_id = ua;
  RAISE EXCEPTION E'ENSAYO OK (la transaccion se deshace sola)\n%', out;
END
$t$;
