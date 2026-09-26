-- ============================================================
-- 00088: roles personalizados (F69, bloque 9)
-- ============================================================
--
-- Hasta acá un permiso era `role IN ('owner','admin')`. Eso alcanza con tres
-- personas; deja de alcanzar cuando hay alguien que tiene que ver los
-- dashboards pero no tocar las integraciones.
--
-- Dos decisiones que sostienen la migracion:
--
-- 1. **`workspace_members.role` NO se toca.** Sigue siendo owner, admin o
--    member, y sigue siendo lo que leen `is_workspace_admin` y las
--    cuarenta policies que ya existen. `role_id` se suma al lado y apunta al
--    rol con los permisos finos. Un rol personalizado es siempre un `member`
--    con permisos de mas: asi ninguna policy vieja cambia de comportamiento.
-- 2. **Los tres roles de sistema existen como filas.** Se crean por
--    workspace con un backfill. Tenerlos como filas es lo que permite que la
--    pantalla los muestre al lado de los personalizados y que `role_id`
--    nunca sea null.
--
-- Esta migracion NO cambia `can_see_contact` ni `can_see_conversation`: eso
-- es la 00089, que se aplica despues de ver esta en verde.

-- ------------------------------------------------------------
-- 1. La tabla
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workspace_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  -- El rol de sistema al que equivale, o NULL si es personalizado. Es lo que
  -- impide editarlos y lo que permite encontrarlos en el backfill.
  system_role  text,
  -- { keys: [...], scopes: { leads, conversations } }. Se valida en
  -- TypeScript (lib/auth/permissions.ts): un CHECK con la lista de claves
  -- obligaria a una migracion por cada permiso nuevo.
  permissions  jsonb NOT NULL DEFAULT '{"keys": [], "scopes": {"leads": "own", "conversations": "own"}}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.workspace_roles IS
  'Los roles de un workspace: los tres de sistema (system_role no nulo, no editables) y los personalizados.';
COMMENT ON COLUMN public.workspace_roles.permissions IS
  'Las claves de permiso y los alcances. El catalogo vive en lib/auth/permissions.ts.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_roles_system_check') THEN
    ALTER TABLE public.workspace_roles ADD CONSTRAINT workspace_roles_system_check
      CHECK (system_role IS NULL OR system_role IN ('owner', 'admin', 'member'));
  END IF;
END $$;

-- Un nombre no se repite dentro del workspace: dos roles "Setter" serian
-- imposibles de distinguir en el selector del equipo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_roles_name
  ON public.workspace_roles (workspace_id, lower(name));

-- Un solo rol de sistema de cada tipo por workspace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_roles_system
  ON public.workspace_roles (workspace_id, system_role)
  WHERE system_role IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Los tres roles de sistema, en cada workspace
-- ------------------------------------------------------------
--
-- Los permisos van vacios a proposito: los de sistema los resuelve
-- TypeScript desde `SYSTEM_ROLE_PERMISSIONS`, que es la fuente. Guardar una
-- copia en la base daria dos fuentes que se pueden separar, y la que manda
-- seria la que alguien mire primero.

INSERT INTO public.workspace_roles (workspace_id, name, description, system_role)
SELECT w.id, r.name, r.description, r.system_role
FROM public.workspaces w
CROSS JOIN (VALUES
  ('Owner',  'Puede todo, incluida la propiedad del negocio.', 'owner'),
  ('Admin',  'Puede todo menos transferir la propiedad.',      'admin'),
  ('Member', 'Ve y atiende los leads que tiene asignados.',    'member')
) AS r(name, description, system_role)
ON CONFLICT DO NOTHING;

-- Un workspace nuevo también los necesita: el trigger que lo crea no sabe de
-- roles, así que se agregan acá.
CREATE OR REPLACE FUNCTION public.seed_workspace_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.workspace_roles (workspace_id, name, description, system_role)
  VALUES
    (NEW.id, 'Owner',  'Puede todo, incluida la propiedad del negocio.', 'owner'),
    (NEW.id, 'Admin',  'Puede todo menos transferir la propiedad.',      'admin'),
    (NEW.id, 'Member', 'Ve y atiende los leads que tiene asignados.',    'member')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_roles_on_workspace ON public.workspaces;
CREATE TRIGGER seed_roles_on_workspace
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.seed_workspace_roles();

-- ------------------------------------------------------------
-- 3. El rol de cada persona
-- ------------------------------------------------------------

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.workspace_roles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.workspace_members.role_id IS
  'El rol con los permisos finos. `role` sigue siendo owner/admin/member y es lo que leen las policies viejas.';

-- Backfill: cada persona queda con el rol de sistema que ya tenia.
UPDATE public.workspace_members m
SET role_id = r.id
FROM public.workspace_roles r
WHERE r.workspace_id = m.workspace_id
  AND r.system_role = m.role
  AND m.role_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_members_role
  ON public.workspace_members (role_id)
  WHERE role_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. Los roles de sistema no se editan
-- ------------------------------------------------------------
--
-- Un trigger y no una policy: la policy puede saltarse con el service role,
-- y "el Owner puede todo" tiene que valer también para el Owner. Si alguien
-- le saca un permiso al rol Admin, la mitad del sistema deja de andar sin
-- que quede claro por qué.

CREATE OR REPLACE FUNCTION public.protect_system_roles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Borrar un rol de sistema A MANO no se permite; que se vaya con su
    -- workspace, si. Sin esta distincion el trigger frena el borrado en
    -- cascada y no se puede borrar un workspace (lo encontro la limpieza de
    -- verify-rls, que es justo para lo que esta).
    IF OLD.system_role IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN
      RAISE EXCEPTION 'los roles de sistema no se pueden borrar';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.system_role IS NOT NULL THEN
    -- Se deja cambiar la descripcion: es texto y no afecta a nadie.
    IF NEW.system_role IS DISTINCT FROM OLD.system_role
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.permissions IS DISTINCT FROM OLD.permissions THEN
      RAISE EXCEPTION 'los roles de sistema no se pueden editar';
    END IF;
  END IF;

  -- Un rol personalizado no puede convertirse en uno de sistema.
  IF OLD.system_role IS NULL AND NEW.system_role IS NOT NULL THEN
    RAISE EXCEPTION 'un rol personalizado no puede volverse de sistema';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_system_roles ON public.workspace_roles;
CREATE TRIGGER protect_system_roles
  BEFORE UPDATE OR DELETE ON public.workspace_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_roles();

-- ------------------------------------------------------------
-- 5. Preguntar por un permiso desde la base
-- ------------------------------------------------------------
--
-- `SECURITY DEFINER` porque tiene que leer `workspace_members` y
-- `workspace_roles` sin que la RLS de esas tablas la frene, igual que
-- `is_workspace_admin`.
--
-- Owner y Admin devuelven true sin mirar el jsonb: sus permisos los define
-- TypeScript, y duplicar esa lista en SQL daria dos fuentes.

CREATE OR REPLACE FUNCTION public.has_permission(p_workspace_id uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_role       text;
  v_permissions jsonb;
BEGIN
  SELECT m.role, COALESCE(r.permissions, '{}'::jsonb)
    INTO v_role, v_permissions
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  IF v_role IN ('owner', 'admin') THEN
    RETURN true;
  END IF;

  RETURN v_permissions -> 'keys' @> to_jsonb(ARRAY[p_key]);
END;
$$;

REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;

-- El alcance de un modulo: `own` o `all`.
--
-- Owner y Admin siempre `all`. Un member sin rol asignado, `own`: el mas
-- restrictivo, que es lo que corresponde cuando falta el dato.
CREATE OR REPLACE FUNCTION public.permission_scope(p_workspace_id uuid, p_module text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_role  text;
  v_scope text;
BEGIN
  SELECT m.role, r.permissions #>> ARRAY['scopes', p_module]
    INTO v_role, v_scope
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN 'own';
  END IF;

  IF v_role IN ('owner', 'admin') THEN
    RETURN 'all';
  END IF;

  RETURN COALESCE(v_scope, 'own');
END;
$$;

REVOKE ALL ON FUNCTION public.permission_scope(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.permission_scope(uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------
--
-- Los roles los ve cualquier miembro: el selector del equipo los necesita, y
-- saber que roles existen no es informacion sensible. Escribirlos es de
-- Owner/Admin, igual que invitar gente.

ALTER TABLE public.workspace_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_roles_select" ON public.workspace_roles;
CREATE POLICY "workspace_roles_select" ON public.workspace_roles
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "workspace_roles_insert" ON public.workspace_roles;
CREATE POLICY "workspace_roles_insert" ON public.workspace_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_admin(workspace_id) AND system_role IS NULL);

DROP POLICY IF EXISTS "workspace_roles_update" ON public.workspace_roles;
CREATE POLICY "workspace_roles_update" ON public.workspace_roles
  FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "workspace_roles_delete" ON public.workspace_roles;
CREATE POLICY "workspace_roles_delete" ON public.workspace_roles
  FOR DELETE TO authenticated
  USING (public.is_workspace_admin(workspace_id) AND system_role IS NULL);

-- updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_workspace_roles') THEN
    CREATE TRIGGER set_updated_at_workspace_roles
      BEFORE UPDATE ON public.workspace_roles
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;
