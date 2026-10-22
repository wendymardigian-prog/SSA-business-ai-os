-- ============================================================================
-- 00249_inbox_channel_access
-- ============================================================================
-- La bandeja por CUENTA conectada.
--
-- Hasta aca un rol daba la bandeja por red (`inbox.<red>.view` / `.reply`) con un solo alcance de
-- conversaciones, y la base ni siquiera miraba la red: `can_see_conversation` delegaba en el alcance de
-- contactos, y la red la filtraba solo la pantalla de la bandeja (el dashboard de chat, la ficha o la
-- pagina de borradores mostraban conversaciones de redes que el rol no tenia). Con dos Instagram
-- conectados no se podia dar uno sin el otro.
--
-- Ahora cada rol personalizado guarda en `workspace_roles.permissions.channels`:
--   {"mode":"all","all":{"scope":"own_unassigned","reply":true}}            todas las cuentas, tambien las futuras
--   {"mode":"custom","byChannel":{"<channel_id>":{"scope":"all","reply":false}}}   cuenta por cuenta
-- `scope`: own (asignadas), own_unassigned (asignadas + sin asignar) o all. Una cuenta que no figura no se
-- ve. Owner y Admin: todo. Member de sistema: todas las cuentas, `own`, responde (lo de siempre).
--
-- Que hace:
--   1. Funciones puras (`private.role_channel_grant`, `channel_grant_exceeds`, ...): gemelas de
--      lib/auth/channel-permissions.ts, con los casos de channel-permissions.cases.json.
--   2. `private.my_channels(ws)`: la bandeja de quien llama.
--   3. BACKFILL: cada rol personalizado sin `channels` recibe el equivalente EXACTO de lo que veia en la
--      bandeja (`private.channels_from_legacy`). Un trigger (`workspace_roles_channels_default`) hace lo mismo
--      con un rol que se guarda sin `channels` (codigo anterior, scripts) y conserva el que ya tenia.
--   4. `can_see_conversation` decide por la CUENTA (ya no por el alcance de contactos).
--   5. `can_see_contact` suma: ver un chat deja ver la ficha de ese contacto.
--   6. `public.can_grant_channels` y la regla de "no podes dar lo que no tenes" para las cuentas, en el
--      trigger de edicion, en `can_give_role` y en la politica de alta de un rol.
--
-- Es ADITIVA: las claves `inbox.*` y `scopes.conversations` siguen en el jsonb (las borra la 00250, despues
-- de desplegar el codigo). El codigo anterior sigue funcionando con esta migracion aplicada: filtra por sus
-- claves y la base filtra por `channels`, que dicen lo mismo. ORDEN: esta migracion ANTES de desplegar el
-- codigo nuevo (que ya lee `channels`); la 00250 despues.
--
-- Consultas de control (antes y despues dan lo mismo para cada rol existente; ver docs/roles.md):
--   select name, permissions -> 'channels' from public.workspace_roles where system_role is null;
--
-- Como volver atras: recrear las cinco definiciones de abajo, y
--   DROP TRIGGER IF EXISTS workspace_roles_channels_default ON public.workspace_roles;
--   DROP FUNCTION IF EXISTS private.workspace_roles_channels_default(), public.can_grant_channels(uuid, jsonb, jsonb),
--     private.contact_is_mine(public.contacts), private.contact_is_unassigned(public.contacts),
--     private.channels_from_legacy(uuid, jsonb), private.my_channels(uuid), private.member_channels(),
--     private.channel_grant_exceeds(jsonb, jsonb, jsonb), private.role_channel_grant(jsonb, text),
--     private.normalize_channel_grant(jsonb), private.channel_scope_rank(text);
--   (la clave `channels` que quede en el jsonb no molesta: nadie la lee).
--
-- Definiciones vigentes ANTES de esta migracion, copiadas letra por letra:
--
-- public.can_see_contact (00136):
--
--   CREATE OR REPLACE FUNCTION public.can_see_contact(c public.contacts)
--   RETURNS boolean
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   STABLE
--   SET search_path = ''
--   AS $$
--   DECLARE
--     v_scope         text;
--     v_has_assignee  boolean;
--   BEGIN
--     IF NOT public.is_workspace_member(c.workspace_id) THEN
--       RETURN false;
--     END IF;
--
--     IF public.is_workspace_admin(c.workspace_id) THEN
--       RETURN true;
--     END IF;
--
--     -- El alcance de leads de MI rol. Un valor que no conoce se trata como 'own':
--     -- ante la duda, lo mas angosto.
--     v_scope := public.permission_scope(c.workspace_id, 'leads');
--
--     IF v_scope = 'all' THEN
--       RETURN true;
--     END IF;
--
--     -- Asignado a mi, por cualquiera de las tres vias.
--     IF c.setter_id = auth.uid() OR c.vendedor_id = auth.uid() THEN
--       RETURN true;
--     END IF;
--
--     IF EXISTS (
--       SELECT 1 FROM public.conversations conv
--       WHERE conv.contact_id = c.id AND conv.assigned_to = auth.uid()
--     ) THEN
--       RETURN true;
--     END IF;
--
--     -- Sin asignar: lo decide el rol. "Asignado" incluye tener setter o vendedor,
--     -- aunque ninguna conversacion tenga agente.
--     IF v_scope = 'own_unassigned' THEN
--       v_has_assignee := c.setter_id IS NOT NULL OR c.vendedor_id IS NOT NULL;
--
--       IF NOT v_has_assignee THEN
--         SELECT EXISTS (
--           SELECT 1 FROM public.conversations conv
--           WHERE conv.contact_id = c.id AND conv.assigned_to IS NOT NULL
--         ) INTO v_has_assignee;
--       END IF;
--
--       IF NOT v_has_assignee THEN
--         RETURN true;
--       END IF;
--     END IF;
--
--     RETURN false;
--   END;
--   $$;
--
-- public.can_see_conversation (00089):
--
--   CREATE OR REPLACE FUNCTION public.can_see_conversation(conv public.conversations)
--   RETURNS boolean
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   STABLE
--   SET search_path = ''
--   AS $$
--   BEGIN
--     IF NOT public.is_workspace_member(conv.workspace_id) THEN
--       RETURN false;
--     END IF;
--
--     IF public.is_workspace_admin(conv.workspace_id) THEN
--       RETURN true;
--     END IF;
--
--     -- Un rol con alcance `all` en conversaciones las ve todas. Es un permiso
--     -- aparte del de leads: se puede querer que alguien atienda cualquier
--     -- conversacion sin darle la ficha de todos los contactos.
--     IF public.permission_scope(conv.workspace_id, 'conversations') = 'all' THEN
--       RETURN true;
--     END IF;
--
--     RETURN EXISTS (
--       SELECT 1
--       FROM public.contacts c
--       WHERE c.id = conv.contact_id
--         AND c.deleted_at IS NULL
--         AND public.can_see_contact(c)
--     );
--   END;
--   $$;
--
-- public.can_give_role (00212):
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
--       RETURN public.can_grant_permissions(p_workspace_id, to_jsonb(private.member_permission_keys()), '{}'::jsonb);
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
--       RETURN public.can_grant_permissions(p_workspace_id, to_jsonb(private.member_permission_keys()), '{}'::jsonb);
--     END IF;
--
--     RETURN public.can_grant_permissions(p_workspace_id, COALESCE(v_permissions -> 'keys', '[]'::jsonb), COALESCE(v_permissions -> 'scopes', '{}'::jsonb));
--   END;
--   $function$;
--
-- public.workspace_roles_grant_check (00212):
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
--     RETURN NEW;
--   END;
--   $function$;
--
-- la politica workspace_roles_insert (00212):
--
--   DROP POLICY IF EXISTS workspace_roles_insert ON public.workspace_roles;
--   CREATE POLICY workspace_roles_insert ON public.workspace_roles FOR INSERT
--     WITH CHECK (
--       (select public.has_permission(workspace_id, 'roles.manage'))
--       AND system_role IS NULL
--       AND public.can_grant_permissions(workspace_id, COALESCE(permissions -> 'keys', '[]'::jsonb), COALESCE(permissions -> 'scopes', '{}'::jsonb))
--     );
-- ============================================================================

SET search_path = '';

-- ----------------------------------------------------------------------------
-- 1. Las piezas puras: rango, normalizar un permiso de cuenta, el permiso de una cuenta
--    Gemelas de lib/auth/channel-permissions.ts (casos en channel-permissions.cases.json).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.channel_scope_rank(p_scope text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_scope WHEN 'all' THEN 3 WHEN 'own_unassigned' THEN 2 WHEN 'own' THEN 1 ELSE 0 END
$$;

-- Un permiso de cuenta guardado, validado: {scope, reply}. Lo que no se entiende es NULL (sin acceso).
CREATE OR REPLACE FUNCTION private.normalize_channel_grant(p_grant jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_grant IS NULL OR jsonb_typeof(p_grant) <> 'object' THEN NULL
    WHEN (p_grant ->> 'scope') IN ('own', 'own_unassigned', 'all') THEN
      jsonb_build_object('scope', p_grant ->> 'scope', 'reply', COALESCE((p_grant -> 'reply') = 'true'::jsonb, false))
    ELSE NULL
  END
$$;

-- Lo que una configuracion de bandeja da en una cuenta (NULL = no la ve). Gemela de `grantFor`.
CREATE OR REPLACE FUNCTION private.role_channel_grant(p_channels jsonb, p_channel_id text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_channels IS NULL OR jsonb_typeof(p_channels) <> 'object' THEN NULL
    WHEN p_channels ->> 'mode' = 'all' THEN private.normalize_channel_grant(p_channels -> 'all')
    WHEN p_channels ->> 'mode' = 'custom' AND p_channel_id IS NOT NULL AND jsonb_typeof(p_channels -> 'byChannel') = 'object'
      THEN private.normalize_channel_grant(p_channels -> 'byChannel' -> p_channel_id)
    ELSE NULL
  END
$$;

-- `wanted` da, sobre `before`, algo que `actor` no tiene? Alcance y "responder" se miran por separado.
-- Gemela de `grantExceeds`.
CREATE OR REPLACE FUNCTION private.channel_grant_exceeds(p_wanted jsonb, p_before jsonb, p_actor jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_wanted IS NULL THEN false
    WHEN private.channel_scope_rank(p_wanted ->> 'scope') > private.channel_scope_rank(p_before ->> 'scope')
     AND private.channel_scope_rank(p_wanted ->> 'scope') > private.channel_scope_rank(p_actor ->> 'scope') THEN true
    ELSE COALESCE((p_wanted -> 'reply') = 'true'::jsonb, false)
     AND NOT COALESCE((p_before -> 'reply') = 'true'::jsonb, false)
     AND NOT COALESCE((p_actor -> 'reply') = 'true'::jsonb, false)
  END
$$;

-- La bandeja del Member de sistema: todas las cuentas, solo lo asignado, responde. COPIA de MEMBER_CHANNELS
-- (lib/auth/channel-permissions.ts; member-sql-parity.test.ts la compara).
CREATE OR REPLACE FUNCTION private.member_channels()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '{"mode":"all","all":{"scope":"own","reply":true}}'::jsonb
$$;

REVOKE ALL ON FUNCTION private.channel_scope_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.normalize_channel_grant(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.role_channel_grant(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.channel_grant_exceeds(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.member_channels() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.channel_scope_rank(text) TO service_role;
GRANT EXECUTE ON FUNCTION private.normalize_channel_grant(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.role_channel_grant(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION private.channel_grant_exceeds(jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.member_channels() TO service_role;

-- ----------------------------------------------------------------------------
-- 2. La bandeja de quien llama
-- ----------------------------------------------------------------------------

-- Owner y Admin: todo. Member de sistema (o sin rol): `member_channels()`. Rol personalizado: su
-- `permissions.channels` (sin eso, ninguna cuenta). Quien no es miembro: NULL.
CREATE OR REPLACE FUNCTION private.my_channels(p_workspace_id uuid)
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
    RETURN '{"mode":"all","all":{"scope":"all","reply":true}}'::jsonb;
  END IF;
  IF v_role_id IS NULL OR v_system_role = 'member' THEN
    RETURN private.member_channels();
  END IF;
  RETURN COALESCE(v_permissions -> 'channels', '{"mode":"custom","byChannel":{}}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION private.my_channels(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.my_channels(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Los roles de antes: de `inbox.<red>.view/.reply` + alcances a `channels`
--
-- Conserva lo que cada rol ve HOY en la bandeja: las cuentas de las redes que tenia, con el alcance que
-- tenia (conversaciones `all` o leads `all` = todas; leads `own_unassigned` = asignadas + sin asignar; si no,
-- solo asignadas) y "responder" donde tenia `.reply`. Con las tres redes y el mismo "responder" en las tres
-- pasa a "todas las cuentas": hoy ya veria una cuenta nueva de cualquiera de esas redes. Una red sin clave
-- propia (telegram, por ejemplo) la veia quien veia alguna red: se conserva.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.channels_from_legacy(p_workspace_id uuid, p_permissions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_keys   jsonb := COALESCE(p_permissions -> 'keys', '[]'::jsonb);
  v_scopes jsonb := COALESCE(p_permissions -> 'scopes', '{}'::jsonb);
  v_scope  text;
  v_ig_v   boolean; v_wa_v boolean; v_em_v boolean;
  v_ig_r   boolean; v_wa_r boolean; v_em_r boolean;
  v_by     jsonb;
BEGIN
  IF jsonb_typeof(v_keys) <> 'array' THEN v_keys := '[]'::jsonb; END IF;
  IF jsonb_typeof(v_scopes) <> 'object' THEN v_scopes := '{}'::jsonb; END IF;

  v_ig_v := v_keys ? 'inbox.instagram.view'; v_ig_r := v_keys ? 'inbox.instagram.reply';
  v_wa_v := v_keys ? 'inbox.whatsapp.view';  v_wa_r := v_keys ? 'inbox.whatsapp.reply';
  v_em_v := v_keys ? 'inbox.email.view';     v_em_r := v_keys ? 'inbox.email.reply';
  -- "Responder" sin "ver" no existia (la pantalla agregaba ver): se cuenta como ver.
  v_ig_v := v_ig_v OR v_ig_r; v_wa_v := v_wa_v OR v_wa_r; v_em_v := v_em_v OR v_em_r;

  IF NOT (v_ig_v OR v_wa_v OR v_em_v) THEN
    RETURN '{"mode":"custom","byChannel":{}}'::jsonb;
  END IF;

  v_scope := CASE
    WHEN v_scopes ->> 'conversations' = 'all' OR v_scopes ->> 'leads' = 'all' THEN 'all'
    WHEN v_scopes ->> 'leads' = 'own_unassigned' THEN 'own_unassigned'
    ELSE 'own'
  END;

  IF v_ig_v AND v_wa_v AND v_em_v AND v_ig_r = v_wa_r AND v_wa_r = v_em_r THEN
    RETURN jsonb_build_object('mode', 'all', 'all', jsonb_build_object('scope', v_scope, 'reply', v_ig_r));
  END IF;

  SELECT COALESCE(jsonb_object_agg(ch.id::text, jsonb_build_object('scope', v_scope, 'reply',
           CASE ch.platform
             WHEN 'instagram' THEN v_ig_r
             WHEN 'whatsapp' THEN v_wa_r
             WHEN 'email' THEN v_em_r
             ELSE (v_ig_r OR v_wa_r OR v_em_r)
           END)), '{}'::jsonb)
    INTO v_by
  FROM public.channels ch
  WHERE ch.workspace_id = p_workspace_id
    AND CASE ch.platform
          WHEN 'instagram' THEN v_ig_v
          WHEN 'whatsapp' THEN v_wa_v
          WHEN 'email' THEN v_em_v
          ELSE true
        END;

  RETURN jsonb_build_object('mode', 'custom', 'byChannel', v_by);
END;
$$;
REVOKE ALL ON FUNCTION private.channels_from_legacy(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.channels_from_legacy(uuid, jsonb) TO service_role;

-- Un rol personalizado que se guarda sin `channels` (codigo anterior a esta migracion, un script) no pierde
-- la bandeja: en un UPDATE se conserva la que tenia; en un INSERT se arma desde sus claves viejas (sin
-- claves de bandeja, ninguna cuenta). Corre ANTES de `workspace_roles_grant_check` (orden alfabetico).
CREATE OR REPLACE FUNCTION private.workspace_roles_channels_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.system_role IS NOT NULL OR (COALESCE(NEW.permissions, '{}'::jsonb) ? 'channels') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (COALESCE(OLD.permissions, '{}'::jsonb) ? 'channels') THEN
    NEW.permissions := COALESCE(NEW.permissions, '{}'::jsonb) || jsonb_build_object('channels', OLD.permissions -> 'channels');
  ELSE
    NEW.permissions := COALESCE(NEW.permissions, '{}'::jsonb)
      || jsonb_build_object('channels', private.channels_from_legacy(NEW.workspace_id, NEW.permissions));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.workspace_roles_channels_default() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS workspace_roles_channels_default ON public.workspace_roles;
CREATE TRIGGER workspace_roles_channels_default
  BEFORE INSERT OR UPDATE ON public.workspace_roles
  FOR EACH ROW
  EXECUTE FUNCTION private.workspace_roles_channels_default();

-- El backfill (idempotente: no toca un rol que ya tiene `channels`). Corre sin sesion, asi que
-- `workspace_roles_grant_check` lo deja pasar.
UPDATE public.workspace_roles r
SET permissions = COALESCE(r.permissions, '{}'::jsonb)
  || jsonb_build_object('channels', private.channels_from_legacy(r.workspace_id, r.permissions))
WHERE r.system_role IS NULL
  AND NOT (COALESCE(r.permissions, '{}'::jsonb) ? 'channels');

-- ----------------------------------------------------------------------------
-- 4. Quien es "suyo" y "sin asignar": las dos reglas de siempre, en un solo lugar
-- ----------------------------------------------------------------------------

-- Es mio: soy su setter o su vendedor, o tengo asignada alguna de sus conversaciones.
CREATE OR REPLACE FUNCTION private.contact_is_mine(c public.contacts)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.setter_id = auth.uid()
      OR c.vendedor_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.conversations conv WHERE conv.contact_id = c.id AND conv.assigned_to = auth.uid())
$$;

-- Sin asignar: sin setter, sin vendedor y ninguna conversacion con alguien a cargo.
CREATE OR REPLACE FUNCTION private.contact_is_unassigned(c public.contacts)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.setter_id IS NULL
     AND c.vendedor_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.conversations conv WHERE conv.contact_id = c.id AND conv.assigned_to IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION private.contact_is_mine(public.contacts) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.contact_is_unassigned(public.contacts) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.contact_is_mine(public.contacts) TO service_role;
GRANT EXECUTE ON FUNCTION private.contact_is_unassigned(public.contacts) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. can_see_conversation: decide la CUENTA, no el alcance de contactos
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_see_conversation(conv public.conversations)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_scope text;
  c       public.contacts;
BEGIN
  IF NOT public.is_workspace_member(conv.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(conv.workspace_id) THEN
    RETURN true;
  END IF;

  -- Lo que mi rol tiene en ESA cuenta. Sin acceso, no se ve, aunque el contacto sea mio.
  v_scope := private.role_channel_grant(private.my_channels(conv.workspace_id), conv.channel_id::text) ->> 'scope';
  IF v_scope IS NULL THEN
    RETURN false;
  END IF;
  IF v_scope = 'all' THEN
    RETURN true;
  END IF;

  SELECT * INTO c FROM public.contacts ct WHERE ct.id = conv.contact_id AND ct.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF private.contact_is_mine(c) THEN
    RETURN true;
  END IF;

  RETURN v_scope = 'own_unassigned' AND private.contact_is_unassigned(c);
END;
$$;

COMMENT ON FUNCTION public.can_see_conversation(public.conversations) IS
  'Se ve la conversacion si sos Admin, o si tu rol tiene acceso a esa CUENTA (permissions.channels, 00249): todas, las asignadas (setter, vendedor o conversacion a cargo) o las asignadas + las que nadie tiene. Ya no depende del alcance de contactos.';

REVOKE ALL ON FUNCTION public.can_see_conversation(public.conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_conversation(public.conversations) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. can_see_contact: lo de la 00136 + "ver un chat deja ver la ficha"
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_see_contact(c public.contacts)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_scope    text;
  v_channels jsonb;
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
  IF private.contact_is_mine(c) THEN
    RETURN true;
  END IF;

  -- Sin asignar: lo decide el rol. "Asignado" incluye tener setter o vendedor,
  -- aunque ninguna conversacion tenga agente.
  IF v_scope = 'own_unassigned' AND private.contact_is_unassigned(c) THEN
    RETURN true;
  END IF;

  -- Ver un chat deja ver la ficha (00249): si el contacto tiene una conversacion en una cuenta donde mi rol
  -- ve "todas", o "asignadas + sin asignar" y el contacto no es de nadie. (Lo "suyo" ya paso arriba.)
  v_channels := private.my_channels(c.workspace_id);
  IF v_channels ->> 'mode' = 'all' THEN
    IF (private.role_channel_grant(v_channels, NULL) ->> 'scope') = 'all'
       OR ((private.role_channel_grant(v_channels, NULL) ->> 'scope') = 'own_unassigned' AND private.contact_is_unassigned(c)) THEN
      RETURN EXISTS (SELECT 1 FROM public.conversations conv WHERE conv.contact_id = c.id AND conv.deleted_at IS NULL);
    END IF;
  ELSIF v_channels ->> 'mode' = 'custom' THEN
    IF EXISTS (
      SELECT 1 FROM public.conversations conv
      WHERE conv.contact_id = c.id
        AND conv.deleted_at IS NULL
        AND (
          (private.role_channel_grant(v_channels, conv.channel_id::text) ->> 'scope') = 'all'
          OR ((private.role_channel_grant(v_channels, conv.channel_id::text) ->> 'scope') = 'own_unassigned'
              AND private.contact_is_unassigned(c))
        )
    ) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.can_see_contact(public.contacts) IS
  'Se ve un contacto si es del workspace y: sos Admin, o tu rol tiene alcance leads=all, o es tuyo (setter, vendedor o conversacion asignada), o tu rol tiene leads=own_unassigned y nadie lo tiene asignado, o (00249) tiene una conversacion que ves por su cuenta con "todas" o con "asignadas + sin asignar" y nadie lo tiene.';

REVOKE ALL ON FUNCTION public.can_see_contact(public.contacts) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_contact(public.contacts) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. "No podes dar lo que no tenes", para las cuentas (gemela de canGrantChannels)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_grant_channels(p_workspace_id uuid, p_wanted jsonb, p_before jsonb DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role  text;
  v_actor jsonb;
BEGIN
  SELECT m.role INTO v_role
  FROM public.workspace_members m
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF v_role IN ('owner', 'admin') THEN
    RETURN true;
  END IF;
  IF p_wanted IS NULL OR jsonb_typeof(p_wanted) <> 'object' THEN
    RETURN true;
  END IF;

  v_actor := private.my_channels(p_workspace_id);

  -- "Todas las cuentas" (tambien las futuras) solo la da quien la tiene, con un alcance igual o mayor.
  IF p_wanted ->> 'mode' = 'all' THEN
    RETURN NOT private.channel_grant_exceeds(
      private.normalize_channel_grant(p_wanted -> 'all'),
      CASE WHEN p_before ->> 'mode' = 'all' THEN private.normalize_channel_grant(p_before -> 'all') END,
      CASE WHEN v_actor ->> 'mode' = 'all' THEN private.normalize_channel_grant(v_actor -> 'all') END
    );
  END IF;

  IF p_wanted ->> 'mode' = 'custom' AND jsonb_typeof(p_wanted -> 'byChannel') = 'object' THEN
    RETURN NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_wanted -> 'byChannel') AS e(channel_id, grant_value)
      WHERE private.channel_grant_exceeds(
        private.normalize_channel_grant(e.grant_value),
        private.role_channel_grant(p_before, e.channel_id),
        private.role_channel_grant(v_actor, e.channel_id)
      )
    );
  END IF;

  -- Una forma que no se entiende no da ninguna cuenta.
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.can_grant_channels(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_grant_channels(uuid, jsonb, jsonb) TO authenticated, service_role;

-- Editar un rol: lo de la 00212 (claves y alcances que se agregan) + las cuentas que se agregan o amplian.
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
  RETURN NEW;
END;
$function$;

-- Invitar con / asignar un rol: lo de la 00212 + su bandeja.
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
     AND public.can_grant_channels(p_workspace_id, v_permissions -> 'channels', NULL);
END;
$function$;

-- Crear un rol: lo de la 00212 + su bandeja (el trigger de arriba ya le puso `channels` si no traia).
DROP POLICY IF EXISTS workspace_roles_insert ON public.workspace_roles;
CREATE POLICY workspace_roles_insert ON public.workspace_roles FOR INSERT
  WITH CHECK (
    (select public.has_permission(workspace_id, 'roles.manage'))
    AND system_role IS NULL
    AND public.can_grant_permissions(workspace_id, COALESCE(permissions -> 'keys', '[]'::jsonb), COALESCE(permissions -> 'scopes', '{}'::jsonb))
    AND public.can_grant_channels(workspace_id, permissions -> 'channels', NULL)
  );
