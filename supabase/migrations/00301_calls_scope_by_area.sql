-- 00301_calls_scope_by_area (6/11/2026)
--
-- Un rol puede ver "las grabaciones de ciertas areas", ademas de "las suyas" y "todas".
--
--   permissions.scopes.calls = 'areas'
--   permissions.call_areas   = ["<id de area>", ...]
--
-- Quien tiene ese alcance ve las grabaciones de esas areas, las que grabo y las de los contactos que
-- ve. Una grabacion Sin clasificar no entra por el area: podria ser de cualquiera.
--
-- Seguridad: `private.scope_rank` trataba un valor desconocido como el mas bajo, asi que alguien con
-- "solo las suyas" habria podido dar 'areas'. Ahora va entre 'own_unassigned' y 'all'. Y como dos
-- listas de areas no se comparan con un numero, `can_grant_call_areas` mira area por area: no se da
-- un area que no se tiene. Lo aplica el trigger al editar, la politica al crear y `can_give_role` al
-- invitar o asignar. Gemelas de `lib/auth/call-areas.ts`, con los casos de
-- `lib/auth/call-areas.cases.json` (corren en vitest y en verify-roles --despues-de-00301).
--
-- Aditiva: va ANTES de desplegar el codigo. Ningun rol tiene 'areas' hasta que alguien lo elija.
-- Idempotente: CREATE OR REPLACE + DROP POLICY IF EXISTS.
--
-- ----------------------------------------------------------------------------
-- COMO VOLVER ATRAS: primero pasar a 'own' cualquier rol con scopes.calls = 'areas', y despues ejecutar,
-- sin el prefijo "--   ", las definiciones vigentes antes de esta migracion:
--
--   CREATE OR REPLACE FUNCTION private.scope_rank(p_scope text)
--   RETURNS integer
--   LANGUAGE sql
--   IMMUTABLE
--   SET search_path = ''
--   AS $$
--     SELECT CASE p_scope WHEN 'all' THEN 2 WHEN 'own_unassigned' THEN 1 ELSE 0 END
--   $$;
--
--   CREATE OR REPLACE FUNCTION public.can_see_call(c public.calls)
--   RETURNS boolean
--   LANGUAGE sql
--   STABLE
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $$
--     SELECT public.is_workspace_member(c.workspace_id)
--        AND (
--          public.is_workspace_admin(c.workspace_id)
--          OR c.recorded_by_user_id = auth.uid()
--          OR (
--            c.contact_id IS NOT NULL
--            AND EXISTS (
--              SELECT 1 FROM public.contacts ct
--              WHERE ct.id = c.contact_id AND public.can_see_contact(ct)
--            )
--          )
--          OR (
--            public.has_permission(c.workspace_id, 'calls.view')
--            AND public.permission_scope(c.workspace_id, 'calls') = 'all'
--          )
--        );
--   $$;
--
--   CREATE OR REPLACE FUNCTION public.workspace_roles_grant_check()
--   RETURNS trigger
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_added  jsonb;
--     v_raised jsonb;
--   BEGIN
--     -- El service role (migraciones, el servidor) no pasa por la regla de "quien da".
--     IF auth.uid() IS NULL THEN
--       RETURN NEW;
--     END IF;
--   
--     SELECT COALESCE(jsonb_agg(k.key), '[]'::jsonb) INTO v_added
--     FROM jsonb_array_elements_text(COALESCE(NEW.permissions -> 'keys', '[]'::jsonb)) AS k(key)
--     WHERE NOT (COALESCE(OLD.permissions -> 'keys', '[]'::jsonb) ? k.key);
--   
--     SELECT COALESCE(jsonb_object_agg(s.module, s.value), '{}'::jsonb) INTO v_raised
--     FROM jsonb_each_text(COALESCE(NEW.permissions -> 'scopes', '{}'::jsonb)) AS s(module, value)
--     WHERE private.scope_rank(s.value) > private.scope_rank(COALESCE(OLD.permissions -> 'scopes' ->> s.module, 'own'));
--   
--     IF NOT public.can_grant_permissions(NEW.workspace_id, v_added, v_raised) THEN
--       RAISE EXCEPTION 'No podés dar permisos que no tenés' USING ERRCODE = '42501';
--     END IF;
--   
--     IF (NEW.permissions -> 'channels') IS DISTINCT FROM (OLD.permissions -> 'channels')
--        AND NOT public.can_grant_channels(NEW.workspace_id, NEW.permissions -> 'channels', OLD.permissions -> 'channels') THEN
--       RAISE EXCEPTION 'No podés dar permisos que no tenés' USING ERRCODE = '42501';
--     END IF;
--     RETURN NEW;
--   END;
--   $function$;
--
--   CREATE OR REPLACE FUNCTION public.can_give_role(p_workspace_id uuid, p_role_id uuid, p_base_role text)
--   RETURNS boolean
--   LANGUAGE plpgsql
--   STABLE
--   SECURITY DEFINER
--   SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_actor       text;
--     v_system_role text;
--     v_permissions jsonb;
--     v_role_ws     uuid;
--   BEGIN
--     SELECT m.role INTO v_actor
--     FROM public.workspace_members m
--     WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();
--   
--     IF v_actor IS NULL THEN
--       RETURN false;
--     END IF;
--   
--     -- El rol Admin solo lo da un Owner o un Admin, aunque la invitacion apunte a un rol personalizado.
--     IF p_base_role = 'admin' AND v_actor NOT IN ('owner', 'admin') THEN
--       RETURN false;
--     END IF;
--   
--     IF p_role_id IS NULL THEN
--       IF p_base_role = 'admin' THEN
--         RETURN v_actor IN ('owner', 'admin');
--       END IF;
--       RETURN public.can_grant_permissions(p_workspace_id, to_jsonb(private.member_permission_keys()), '{}'::jsonb)
--          AND public.can_grant_channels(p_workspace_id, private.member_channels(), NULL);
--     END IF;
--   
--     SELECT r.system_role, COALESCE(r.permissions, '{}'::jsonb), r.workspace_id
--       INTO v_system_role, v_permissions, v_role_ws
--     FROM public.workspace_roles r
--     WHERE r.id = p_role_id;
--   
--     IF NOT FOUND OR v_role_ws <> p_workspace_id THEN
--       RETURN false;
--     END IF;
--   
--     -- El Owner no se da: es unico y se transfiere.
--     IF v_system_role = 'owner' THEN
--       RETURN false;
--     END IF;
--     IF v_system_role = 'admin' THEN
--       RETURN v_actor IN ('owner', 'admin');
--     END IF;
--     IF v_system_role = 'member' THEN
--       RETURN public.can_grant_permissions(p_workspace_id, to_jsonb(private.member_permission_keys()), '{}'::jsonb)
--          AND public.can_grant_channels(p_workspace_id, private.member_channels(), NULL);
--     END IF;
--   
--     RETURN public.can_grant_permissions(p_workspace_id, COALESCE(v_permissions -> 'keys', '[]'::jsonb), COALESCE(v_permissions -> 'scopes', '{}'::jsonb))
--        AND public.can_grant_channels(p_workspace_id, v_permissions -> 'channels', NULL);
--   END;
--   $function$;
--
--   DROP POLICY IF EXISTS workspace_roles_insert ON public.workspace_roles;
--   CREATE POLICY workspace_roles_insert ON public.workspace_roles FOR INSERT
--     WITH CHECK (
--       (select public.has_permission(workspace_id, 'roles.manage'))
--       AND system_role IS NULL
--       AND public.can_grant_permissions(workspace_id, COALESCE(permissions -> 'keys', '[]'::jsonb), COALESCE(permissions -> 'scopes', '{}'::jsonb))
--       AND public.can_grant_channels(workspace_id, permissions -> 'channels', NULL)
--     );
--
--   DROP FUNCTION IF EXISTS public.can_grant_call_areas(uuid, jsonb, jsonb);
--   DROP FUNCTION IF EXISTS private.my_call_permissions(uuid);
--   DROP FUNCTION IF EXISTS private.role_sees_call_area(jsonb, uuid);
--   DROP FUNCTION IF EXISTS private.call_areas_exceed(jsonb, jsonb, jsonb);
--   DROP FUNCTION IF EXISTS private.call_areas_of(jsonb);
-- ----------------------------------------------------------------------------

-- Las areas que da un rol. Solo cuentan con el alcance 'areas'. Gemela de `callAreasOf`.
CREATE OR REPLACE FUNCTION private.call_areas_of(p_permissions jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_permissions #>> '{scopes,calls}' = 'areas' AND jsonb_typeof(p_permissions -> 'call_areas') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_permissions -> 'call_areas'))
    ELSE ARRAY[]::text[]
  END
$$;

-- Ese rol ve las grabaciones de esa area? Gemela de `roleSeesCallArea`. Nunca devuelve NULL.
CREATE OR REPLACE FUNCTION private.role_sees_call_area(p_permissions jsonb, p_area_id uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_permissions #>> '{scopes,calls}' = 'all'
    OR (p_area_id IS NOT NULL AND p_area_id::text = ANY (private.call_areas_of(p_permissions))),
    false
  )
$$;

-- `wanted` agrega, sobre `before`, un area que `actor` no tiene? Gemela de `callAreasExceed`.
CREATE OR REPLACE FUNCTION private.call_areas_exceed(p_wanted jsonb, p_before jsonb, p_actor jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_wanted #>> '{scopes,calls}' IS DISTINCT FROM 'areas' THEN false
    WHEN p_actor #>> '{scopes,calls}' = 'all' THEN false
    WHEN p_before #>> '{scopes,calls}' = 'all' THEN false
    ELSE EXISTS (
      SELECT 1 FROM unnest(private.call_areas_of(p_wanted)) AS a(area_id)
      WHERE NOT (a.area_id = ANY (private.call_areas_of(p_before)))
        AND NOT (a.area_id = ANY (private.call_areas_of(p_actor)))
    )
  END
$$;

-- Lo que puede quien llama con las grabaciones: su alcance y sus areas.
CREATE OR REPLACE FUNCTION private.my_call_permissions(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role        text;
  v_role_id     uuid;
  v_system_role text;
  v_permissions jsonb;
BEGIN
  SELECT m.role, m.role_id, r.system_role, COALESCE(r.permissions, '{}'::jsonb)
    INTO v_role, v_role_id, v_system_role, v_permissions
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_role IN ('owner', 'admin') THEN
    RETURN '{"scopes":{"calls":"all"}}'::jsonb;
  END IF;
  IF v_role_id IS NULL OR v_system_role = 'member' THEN
    RETURN '{"scopes":{"calls":"own"}}'::jsonb;
  END IF;
  RETURN v_permissions;
END;
$$;

REVOKE ALL ON FUNCTION private.call_areas_of(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.role_sees_call_area(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.call_areas_exceed(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.my_call_permissions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.call_areas_of(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.role_sees_call_area(jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.call_areas_exceed(jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.my_call_permissions(uuid) TO service_role;

-- Quien llama puede dar estas areas? Owner y Admin, siempre.
CREATE OR REPLACE FUNCTION public.can_grant_call_areas(p_workspace_id uuid, p_wanted jsonb, p_before jsonb DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor jsonb;
BEGIN
  v_actor := private.my_call_permissions(p_workspace_id);
  IF v_actor IS NULL THEN
    RETURN false;
  END IF;
  RETURN NOT private.call_areas_exceed(p_wanted, p_before, v_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.can_grant_call_areas(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_grant_call_areas(uuid, jsonb, jsonb) TO authenticated, service_role;

-- El orden de los alcances: 'areas' va entre 'own_unassigned' y 'all'.
CREATE OR REPLACE FUNCTION private.scope_rank(p_scope text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_scope WHEN 'all' THEN 3 WHEN 'areas' THEN 2 WHEN 'own_unassigned' THEN 1 ELSE 0 END
$$;

-- Quien ve una grabacion: lo de siempre + las areas de su rol.
CREATE OR REPLACE FUNCTION public.can_see_call(c public.calls)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_workspace_member(c.workspace_id)
     AND (
       public.is_workspace_admin(c.workspace_id)
       OR c.recorded_by_user_id = auth.uid()
       OR (
         c.contact_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.contacts ct
           WHERE ct.id = c.contact_id AND public.can_see_contact(ct)
         )
       )
       OR (
         public.has_permission(c.workspace_id, 'calls.view')
         AND public.permission_scope(c.workspace_id, 'calls') = 'all'
       )
       OR (
         public.permission_scope(c.workspace_id, 'calls') = 'areas'
         AND public.has_permission(c.workspace_id, 'calls.view')
         AND private.role_sees_call_area(private.my_call_permissions(c.workspace_id), c.area_id)
       )
     );
$$;

-- Editar un rol: lo de la 00249 + las areas que se agregan.
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

  IF (NEW.permissions -> 'channels') IS DISTINCT FROM (OLD.permissions -> 'channels')
     AND NOT public.can_grant_channels(NEW.workspace_id, NEW.permissions -> 'channels', OLD.permissions -> 'channels') THEN
    RAISE EXCEPTION 'No podés dar permisos que no tenés' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_grant_call_areas(NEW.workspace_id, NEW.permissions, OLD.permissions) THEN
    RAISE EXCEPTION 'No podés dar permisos que no tenés' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- Invitar con / asignar un rol: lo de la 00249 + sus areas.
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
    RETURN public.can_grant_permissions(p_workspace_id, to_jsonb(private.member_permission_keys()), '{}'::jsonb)
       AND public.can_grant_channels(p_workspace_id, private.member_channels(), NULL);
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
    RETURN public.can_grant_permissions(p_workspace_id, to_jsonb(private.member_permission_keys()), '{}'::jsonb)
       AND public.can_grant_channels(p_workspace_id, private.member_channels(), NULL);
  END IF;

  RETURN public.can_grant_permissions(p_workspace_id, COALESCE(v_permissions -> 'keys', '[]'::jsonb), COALESCE(v_permissions -> 'scopes', '{}'::jsonb))
     AND public.can_grant_channels(p_workspace_id, v_permissions -> 'channels', NULL)
     AND public.can_grant_call_areas(p_workspace_id, v_permissions, NULL);
END;
$function$;

-- Crear un rol: lo de la 00249 + sus areas.
DROP POLICY IF EXISTS workspace_roles_insert ON public.workspace_roles;
CREATE POLICY workspace_roles_insert ON public.workspace_roles FOR INSERT
  WITH CHECK (
    (select public.has_permission(workspace_id, 'roles.manage'))
    AND system_role IS NULL
    AND public.can_grant_permissions(workspace_id, COALESCE(permissions -> 'keys', '[]'::jsonb), COALESCE(permissions -> 'scopes', '{}'::jsonb))
    AND public.can_grant_channels(workspace_id, permissions -> 'channels', NULL)
    AND public.can_grant_call_areas(workspace_id, permissions, NULL)
  );
