-- ============================================================================
-- 00208 — Equipo y roles (B1, F3): `has_permission` v2 y paridad con TypeScript
-- ============================================================================
-- Hoy `has_permission(ws, key)` le responde "no" a TODA clave si quien pregunta es un Member de
-- sistema, porque los permisos de ese rol viven solo en `lib/auth/permissions.ts` (su fila de
-- `workspace_roles` los tiene vacios a proposito). Por eso casi ninguna politica puede usarla y la
-- RLS quedo en "solo Admin".
--
-- Esta version le ensena a la base:
--   - al Member de sistema (con `role_id` del rol de sistema Member, o SIN `role_id`): su lista de
--     claves, copiada en `private.member_permission_keys()`;
--   - a las claves solo-Owner (`private.owner_only_keys()`): el Admin NO las tiene;
--   - nunca devuelve NULL (un NULL deja pasar un `NOT (...)` en plpgsql).
-- Para el Owner, el Admin (salvo las dos claves solo-Owner, que ninguna politica usa) y los roles
-- personalizados responde IGUAL que hoy.
--
-- `lib/auth/member-sql-parity.test.ts` lee la ULTIMA definicion de las dos funciones de abajo en
-- supabase/migrations/ y falla si difieren de `lib/auth/permissions.ts`: las dos copias no se
-- pueden separar sin que un test lo diga. Para cambiar la lista del Member: nueva migracion que
-- redefine `member_permission_keys()` + el cambio en TypeScript.
--
-- Efecto sobre el Member de sistema (revisado politica por politica contra la base viva): ninguna
-- politica ni funcion cambia para el, salvo las dos de webhooks, que pedian `flows.edit` (que el
-- Member tiene en TypeScript) y se pasan a `webhooks.manage` aca mismo para que NO ganen lectura
-- de payloads de webhooks (decision del 13/10/2026). El resto pide claves que el Member no tiene
-- (`dashboards.ads.view`, `social.view`, `templates.manage`, `scheduling.manage_*`,
-- `settings.manage`...) o `*.view` + alcance `all` (`can_see_booking`, `can_see_call`,
-- `can_see_sale`: el Member es `own`).
--
-- Idempotente: CREATE OR REPLACE y DROP POLICY IF EXISTS.
--
-- ----------------------------------------------------------------------------
-- COMO VOLVER ATRAS (definiciones vigentes ANTES de esta migracion, leidas de la base viva)
-- ----------------------------------------------------------------------------
--   DROP FUNCTION IF EXISTS private.member_permission_keys();
--   DROP FUNCTION IF EXISTS private.owner_only_keys();
-- y volver a ejecutar, sin el prefijo "--   ", lo siguiente:
--
--   CREATE OR REPLACE FUNCTION public.has_permission(p_workspace_id uuid, p_key text)
--    RETURNS boolean
--    LANGUAGE plpgsql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_role        text;
--     v_permissions jsonb;
--   BEGIN
--     SELECT m.role, COALESCE(r.permissions, '{}'::jsonb)
--       INTO v_role, v_permissions
--     FROM public.workspace_members m
--     LEFT JOIN public.workspace_roles r ON r.id = m.role_id
--     WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();
--   
--     IF v_role IS NULL THEN
--       RETURN false;
--     END IF;
--   
--     IF v_role IN ('owner', 'admin') THEN
--       RETURN true;
--     END IF;
--   
--     -- OJO: los permisos del rol de sistema "Member" NO estan en el jsonb (su
--     -- fila los tiene vacios a proposito: la fuente es lib/auth/permissions.ts).
--     -- Esta funcion responde por los roles PERSONALIZADOS y por owner/admin.
--     -- Ninguna policy la usa hoy; el alcance de leads lo resuelve
--     -- permission_scope, que si contempla los tres casos.
--     RETURN COALESCE(v_permissions -> 'keys' @> to_jsonb(ARRAY[p_key]), false);
--   END;
--   $function$
--
--   CREATE POLICY inbound_webhooks_select ON public.inbound_webhooks AS PERMISSIVE FOR SELECT TO authenticated
--     USING ((is_workspace_member(workspace_id) AND has_permission(workspace_id, 'flows.edit'::text)));
--
--   CREATE POLICY webhook_endpoints_select ON public.webhook_endpoints AS PERMISSIVE FOR SELECT TO authenticated
--     USING ((is_workspace_member(workspace_id) AND (has_permission(workspace_id, 'flows.edit'::text) OR has_permission(workspace_id, 'integrations.manage'::text))));
-- ============================================================================

-- Las claves del Member de sistema. COPIA de MEMBER_KEYS en lib/auth/permissions.ts (27 claves).
CREATE OR REPLACE FUNCTION private.member_permission_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'dashboards.chat.view',
    'inbox.instagram.view',
    'inbox.instagram.reply',
    'inbox.whatsapp.view',
    'inbox.whatsapp.reply',
    'inbox.email.view',
    'inbox.email.reply',
    'contacts.view',
    'contacts.edit',
    'contacts.assign',
    'flows.view',
    'flows.edit',
    'flows.publish',
    'sequences.view',
    'agents.view',
    'content.view',
    'content.create',
    'scheduling.use',
    'bookings.view',
    'bookings.manage',
    'calls.view',
    'forms.view',
    'sales.view',
    'sales.manage',
    'payments.manage',
    'tasks.view',
    'tasks.edit'
  ]::text[]
$$;

-- Las claves que solo tiene el Owner. COPIA de las claves `ownerOnly` de lib/auth/permissions.ts.
CREATE OR REPLACE FUNCTION private.owner_only_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'team.remove',
    'workspace.transfer'
  ]::text[]
$$;

REVOKE ALL ON FUNCTION private.member_permission_keys() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.owner_only_keys() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.has_permission(p_workspace_id uuid, p_key text)
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
BEGIN
  SELECT m.role, m.role_id, r.system_role, COALESCE(r.permissions, '{}'::jsonb)
    INTO v_role, v_role_id, v_system_role, v_permissions
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL OR p_key IS NULL THEN
    RETURN false;
  END IF;

  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  -- El Admin tiene todo menos lo solo-Owner.
  IF v_role = 'admin' THEN
    RETURN NOT (p_key = ANY (private.owner_only_keys()));
  END IF;

  -- El Member de sistema (sin rol asignado, o con la fila del rol de sistema Member): su lista vive
  -- en TypeScript y se copia en private.member_permission_keys(). Su fila de workspace_roles tiene
  -- los permisos vacios a proposito.
  IF v_role_id IS NULL OR v_system_role = 'member' THEN
    RETURN COALESCE(p_key = ANY (private.member_permission_keys()), false);
  END IF;

  -- Un rol personalizado: lo que tiene tildado.
  RETURN COALESCE(v_permissions -> 'keys' @> to_jsonb(ARRAY[p_key]), false);
END;
$function$;

-- Webhooks: se leen con `webhooks.manage` (o administrando integraciones, los endpoints). Con
-- `has_permission` v2 el Member de sistema habria ganado la lectura por tener `flows.edit`.
DROP POLICY IF EXISTS inbound_webhooks_select ON public.inbound_webhooks;
CREATE POLICY inbound_webhooks_select ON public.inbound_webhooks
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND public.has_permission(workspace_id, 'webhooks.manage')
  );

DROP POLICY IF EXISTS webhook_endpoints_select ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_select ON public.webhook_endpoints
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND (
      public.has_permission(workspace_id, 'webhooks.manage')
      OR public.has_permission(workspace_id, 'integrations.manage')
    )
  );
