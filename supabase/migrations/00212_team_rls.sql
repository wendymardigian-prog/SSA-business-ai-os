-- ============================================================================
-- 00212 — Equipo y roles (B2, F6-F11): invitar, asignar roles y editar roles por permiso
-- ============================================================================
-- Hoy invitar, cambiar roles, quitar personas y editar roles piden "ser Admin" (u Owner) en la base. Esta
-- migracion los pasa a pedir el permiso de lo que son, y suma la regla de seguridad que el plano pide:
-- "no podes dar lo que no tenes".
--
--   workspace_invites   INSERT / UPDATE / DELETE   team.invite  (y, al insertar o cambiar el rol, `can_give_role`)
--   workspace_members   UPDATE                     el Owner todo; team.manage sobre quien no es Owner, solo con roles que puede dar
--                       DELETE                     team.remove Y ser Owner (quitar personas es solo del Owner, como hoy)
--   workspace_roles     INSERT / UPDATE / DELETE   roles.manage (system_role IS NULL se mantiene; el trigger de roles de sistema tambien)
--
-- Tres funciones nuevas en `public` (gemelas SQL de lib/team/grant.ts; los casos compartidos viven en
-- lib/team/grant.cases.json y los corre `verify-roles.mjs` contra la base):
--   can_grant_permissions(ws, keys, scopes)  quien llama puede dar esas claves y esos alcances.
--   can_give_role(ws, role_id, base_role)    quien llama puede invitar con / asignar ese rol.
--   is_own_role(ws, role_id)                 es el rol que tiene asignado quien llama.
-- Y un trigger en workspace_roles (`workspace_roles_grant_check`): en un UPDATE solo hay que poder dar lo que se
-- AGREGA (claves nuevas y alcances que suben); sacar permisos nunca es una escalada. El service role no pasa por ahi.
--
-- Cierra ademas un agujero: la politica de UPDATE de workspace_invites dejaba que la persona INVITADA (cualquiera con
-- ese email) editara su propia invitacion — cambiarse el rol a admin, alargar el vencimiento o mover la invitacion a otro
-- workspace — porque no tenia WITH CHECK. Aceptar una invitacion no usa esa rama (lo hace el servidor con el cliente de
-- servicio), asi que nadie legitimo la necesita: sale.
--
-- Owner y Admin (todas las claves menos las dos solo-Owner) dan exactamente lo mismo que antes, salvo quitar personas,
-- que ya era solo del Owner. Se aplica DESPUES de desplegar el codigo del bloque B2.
--
-- Idempotente: CREATE OR REPLACE + DROP POLICY/TRIGGER IF EXISTS.
--
-- ----------------------------------------------------------------------------
-- COMO VOLVER ATRAS: ejecutar, sin el prefijo "--   ", lo siguiente (definiciones vigentes ANTES de esta migracion,
-- leidas de la base viva) y despues:
--   DROP TRIGGER IF EXISTS workspace_roles_grant_check ON public.workspace_roles;
--   DROP FUNCTION IF EXISTS public.workspace_roles_grant_check();
--   DROP FUNCTION IF EXISTS public.can_give_role(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.can_grant_permissions(uuid, jsonb, jsonb);
--   DROP FUNCTION IF EXISTS public.is_own_role(uuid, uuid);
--   DROP FUNCTION IF EXISTS private.ungrantable_keys();
--   DROP FUNCTION IF EXISTS private.scope_rank(text);
-- ----------------------------------------------------------------------------
--   DROP POLICY IF EXISTS workspace_invites_insert ON public.workspace_invites;
--   CREATE POLICY workspace_invites_insert ON public.workspace_invites AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS workspace_invites_update ON public.workspace_invites;
--   CREATE POLICY workspace_invites_update ON public.workspace_invites AS PERMISSIVE FOR UPDATE TO public
--     USING ((is_workspace_admin(workspace_id) OR (email = (( SELECT u.email
--      FROM auth.users u
--     WHERE (u.id = auth.uid())))::text)));
--
--   DROP POLICY IF EXISTS workspace_invites_delete ON public.workspace_invites;
--   CREATE POLICY workspace_invites_delete ON public.workspace_invites AS PERMISSIVE FOR DELETE TO public
--     USING (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS Owners can delete members ON public.workspace_members;
--   CREATE POLICY Owners can delete members ON public.workspace_members AS PERMISSIVE FOR DELETE TO public
--     USING ((EXISTS ( SELECT 1
--      FROM workspace_members wm
--     WHERE ((wm.workspace_id = workspace_members.workspace_id) AND (wm.user_id = auth.uid()) AND (wm.role = 'owner'::text)))));
--
--   DROP POLICY IF EXISTS workspace_members_update ON public.workspace_members;
--   CREATE POLICY workspace_members_update ON public.workspace_members AS PERMISSIVE FOR UPDATE TO public
--     USING ((is_workspace_owner(workspace_id) OR (is_workspace_admin(workspace_id) AND (role <> 'owner'::text))))
--     WITH CHECK ((is_workspace_owner(workspace_id) OR (is_workspace_admin(workspace_id) AND (role <> 'owner'::text))));
--
--   DROP POLICY IF EXISTS workspace_roles_insert ON public.workspace_roles;
--   CREATE POLICY workspace_roles_insert ON public.workspace_roles AS PERMISSIVE FOR INSERT TO authenticated
--     WITH CHECK ((is_workspace_admin(workspace_id) AND (system_role IS NULL)));
--
--   DROP POLICY IF EXISTS workspace_roles_update ON public.workspace_roles;
--   CREATE POLICY workspace_roles_update ON public.workspace_roles AS PERMISSIVE FOR UPDATE TO authenticated
--     USING (is_workspace_admin(workspace_id))
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS workspace_roles_delete ON public.workspace_roles;
--   CREATE POLICY workspace_roles_delete ON public.workspace_roles AS PERMISSIVE FOR DELETE TO authenticated
--     USING ((is_workspace_admin(workspace_id) AND (system_role IS NULL)));
--
-- ============================================================================

-- Las claves que ningun rol puede llevar: las solo-Owner y las reservadas. COPIA de lib/auth/permissions.ts
-- (member-sql-parity.test.ts la compara).
CREATE OR REPLACE FUNCTION private.ungrantable_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'scheduling.team_events',
    'team.remove',
    'workspace.transfer'
  ]::text[]
$$;
REVOKE ALL ON FUNCTION private.ungrantable_keys() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.scope_rank(p_scope text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_scope WHEN 'all' THEN 2 WHEN 'own_unassigned' THEN 1 ELSE 0 END
$$;
REVOKE ALL ON FUNCTION private.scope_rank(text) FROM PUBLIC, anon, authenticated;

-- Quien llama puede dar estas claves y estos alcances? (gemela de assertCanGrant)
CREATE OR REPLACE FUNCTION public.can_grant_permissions(p_workspace_id uuid, p_keys jsonb, p_scopes jsonb DEFAULT '{}'::jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role        text;
  v_role_id     uuid;
  v_system_role text;
  v_permissions jsonb;
  v_actor_keys  jsonb;
  v_actor_scopes jsonb;
BEGIN
  SELECT m.role, m.role_id, r.system_role, COALESCE(r.permissions, '{}'::jsonb)
    INTO v_role, v_role_id, v_system_role, v_permissions
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  -- Una clave solo-Owner o reservada no viaja en un rol: ni el Owner la da.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_keys, '[]'::jsonb)) AS k(key)
    WHERE k.key = ANY (private.ungrantable_keys())
  ) THEN
    RETURN false;
  END IF;

  IF v_role IN ('owner', 'admin') THEN
    RETURN true;
  END IF;

  IF v_role_id IS NULL OR v_system_role = 'member' THEN
    v_actor_keys := to_jsonb(private.member_permission_keys());
    v_actor_scopes := '{}'::jsonb;
  ELSE
    v_actor_keys := COALESCE(v_permissions -> 'keys', '[]'::jsonb);
    v_actor_scopes := COALESCE(v_permissions -> 'scopes', '{}'::jsonb);
  END IF;

  -- Cada clave que se da tiene que estar en poder de quien la da.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_keys, '[]'::jsonb)) AS k(key)
    WHERE NOT (v_actor_keys ? k.key)
  ) THEN
    RETURN false;
  END IF;

  -- Y ningun alcance puede ser mas ancho que el suyo.
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(COALESCE(p_scopes, '{}'::jsonb)) AS s(module, value)
    WHERE private.scope_rank(s.value) > private.scope_rank(COALESCE(v_actor_scopes ->> s.module, 'own'))
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

-- Quien llama puede invitar con / asignar este rol? (gemela de assertCanAssignRole, sin el chequeo de "uno mismo"
-- ni de "es el Owner", que son de la pantalla y de la accion)
CREATE OR REPLACE FUNCTION public.can_give_role(p_workspace_id uuid, p_role_id uuid, p_base_role text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor       text;
  v_system_role text;
  v_permissions jsonb;
  v_role_ws     uuid;
BEGIN
  SELECT m.role INTO v_actor
  FROM public.workspace_members m
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_actor IS NULL THEN
    RETURN false;
  END IF;

  -- El rol Admin solo lo da un Owner o un Admin, aunque la invitacion apunte a un rol personalizado.
  IF p_base_role = 'admin' AND v_actor NOT IN ('owner', 'admin') THEN
    RETURN false;
  END IF;

  IF p_role_id IS NULL THEN
    IF p_base_role = 'admin' THEN
      RETURN v_actor IN ('owner', 'admin');
    END IF;
    RETURN public.can_grant_permissions(p_workspace_id, to_jsonb(private.member_permission_keys()), '{}'::jsonb);
  END IF;

  SELECT r.system_role, COALESCE(r.permissions, '{}'::jsonb), r.workspace_id
    INTO v_system_role, v_permissions, v_role_ws
  FROM public.workspace_roles r
  WHERE r.id = p_role_id;

  IF NOT FOUND OR v_role_ws <> p_workspace_id THEN
    RETURN false;
  END IF;

  -- El Owner no se da: es unico y se transfiere.
  IF v_system_role = 'owner' THEN
    RETURN false;
  END IF;
  IF v_system_role = 'admin' THEN
    RETURN v_actor IN ('owner', 'admin');
  END IF;
  IF v_system_role = 'member' THEN
    RETURN public.can_grant_permissions(p_workspace_id, to_jsonb(private.member_permission_keys()), '{}'::jsonb);
  END IF;

  RETURN public.can_grant_permissions(p_workspace_id, COALESCE(v_permissions -> 'keys', '[]'::jsonb), COALESCE(v_permissions -> 'scopes', '{}'::jsonb));
END;
$function$;

-- Es el rol que tiene asignado quien llama?
CREATE OR REPLACE FUNCTION public.is_own_role(p_workspace_id uuid, p_role_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid() AND m.role_id = p_role_id
  )
$$;

-- En un UPDATE de un rol, solo hay que poder dar lo que se AGREGA. Es SECURITY DEFINER porque llama a las auxiliares de
-- `private` (a las que `authenticated` no tiene acceso); `auth.uid()` sigue siendo quien edita.
CREATE OR REPLACE FUNCTION public.workspace_roles_grant_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_added  jsonb;
  v_raised jsonb;
BEGIN
  -- El service role (migraciones, el servidor) no pasa por la regla de "quien da".
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(jsonb_agg(k.key), '[]'::jsonb) INTO v_added
  FROM jsonb_array_elements_text(COALESCE(NEW.permissions -> 'keys', '[]'::jsonb)) AS k(key)
  WHERE NOT (COALESCE(OLD.permissions -> 'keys', '[]'::jsonb) ? k.key);

  SELECT COALESCE(jsonb_object_agg(s.module, s.value), '{}'::jsonb) INTO v_raised
  FROM jsonb_each_text(COALESCE(NEW.permissions -> 'scopes', '{}'::jsonb)) AS s(module, value)
  WHERE private.scope_rank(s.value) > private.scope_rank(COALESCE(OLD.permissions -> 'scopes' ->> s.module, 'own'));

  IF NOT public.can_grant_permissions(NEW.workspace_id, v_added, v_raised) THEN
    RAISE EXCEPTION 'No podés dar permisos que no tenés' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS workspace_roles_grant_check ON public.workspace_roles;
CREATE TRIGGER workspace_roles_grant_check
  BEFORE UPDATE ON public.workspace_roles
  FOR EACH ROW
  WHEN (OLD.permissions IS DISTINCT FROM NEW.permissions)
  EXECUTE FUNCTION public.workspace_roles_grant_check();

-- ----------------------------------------------------------------------------
-- Invitaciones
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS workspace_invites_insert ON public.workspace_invites;
CREATE POLICY workspace_invites_insert ON public.workspace_invites FOR INSERT
  WITH CHECK (
    (select public.has_permission(workspace_id, 'team.invite'))
    AND public.can_give_role(workspace_id, role_id, role)
  );

-- Sin la rama de "el invitado": ver la cabecera.
DROP POLICY IF EXISTS workspace_invites_update ON public.workspace_invites;
CREATE POLICY workspace_invites_update ON public.workspace_invites FOR UPDATE
  USING ((select public.has_permission(workspace_id, 'team.invite')))
  WITH CHECK (
    (select public.has_permission(workspace_id, 'team.invite'))
    AND public.can_give_role(workspace_id, role_id, role)
  );

DROP POLICY IF EXISTS workspace_invites_delete ON public.workspace_invites;
CREATE POLICY workspace_invites_delete ON public.workspace_invites FOR DELETE
  USING ((select public.has_permission(workspace_id, 'team.invite')));

-- ----------------------------------------------------------------------------
-- Miembros
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS workspace_members_update ON public.workspace_members;
CREATE POLICY workspace_members_update ON public.workspace_members FOR UPDATE
  USING (
    public.is_workspace_owner(workspace_id)
    OR ((select public.has_permission(workspace_id, 'team.manage')) AND role <> 'owner')
  )
  WITH CHECK (
    public.is_workspace_owner(workspace_id)
    OR (
      (select public.has_permission(workspace_id, 'team.manage'))
      AND role <> 'owner'
      AND public.can_give_role(workspace_id, role_id, role)
    )
  );

-- Quitar personas: solo el Owner (`team.remove` es una clave solo-Owner; el chequeo del cargo es el cinturon de seguridad).
DROP POLICY IF EXISTS "Owners can delete members" ON public.workspace_members;
CREATE POLICY "Owners can delete members" ON public.workspace_members FOR DELETE
  USING (
    public.is_workspace_owner(workspace_id)
    AND (select public.has_permission(workspace_id, 'team.remove'))
  );

-- ----------------------------------------------------------------------------
-- Roles
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS workspace_roles_insert ON public.workspace_roles;
CREATE POLICY workspace_roles_insert ON public.workspace_roles FOR INSERT
  WITH CHECK (
    (select public.has_permission(workspace_id, 'roles.manage'))
    AND system_role IS NULL
    AND public.can_grant_permissions(workspace_id, COALESCE(permissions -> 'keys', '[]'::jsonb), COALESCE(permissions -> 'scopes', '{}'::jsonb))
  );

DROP POLICY IF EXISTS workspace_roles_update ON public.workspace_roles;
CREATE POLICY workspace_roles_update ON public.workspace_roles FOR UPDATE
  USING (
    (select public.has_permission(workspace_id, 'roles.manage'))
    AND (public.is_workspace_admin(workspace_id) OR NOT public.is_own_role(workspace_id, id))
  )
  WITH CHECK ((select public.has_permission(workspace_id, 'roles.manage')));

DROP POLICY IF EXISTS workspace_roles_delete ON public.workspace_roles;
CREATE POLICY workspace_roles_delete ON public.workspace_roles FOR DELETE
  USING (
    (select public.has_permission(workspace_id, 'roles.manage'))
    AND system_role IS NULL
    AND (public.is_workspace_admin(workspace_id) OR NOT public.is_own_role(workspace_id, id))
  );
