-- ============================================================================
-- 00196 — Tareas: la tabla `tasks`, quien ve cada una y la limpieza de personas
-- ============================================================================
-- Extra A (Sistema de Tareas), bloque T1, F1 y F6.
--
-- UNA sola tabla nueva: `tasks`. El proyecto (texto), los seguidores (uuid[]) y las
-- dependencias (jsonb) viven adentro; no hay tablas de proyectos, seguidores ni vinculos.
--
--   1. `tasks` con sus CHECK de longitud y cantidad, indices y el unico parcial de
--      idempotencia (una tarea abierta por origen automatico + referencia).
--   2. Quien ve y quien edita:
--        can_view_tasks(ws)   : Owner/Admin, el Member de sistema (su baseline vive en
--                               lib/auth/permissions.ts, no en el jsonb: `has_permission`
--                               es false para el) y un rol personalizado con `tasks.view`.
--        can_edit_tasks(ws)   : lo mismo con `tasks.edit`.
--        can_see_task(tasks) / can_see_task_id(uuid): copia del patron de `can_see_call`
--          (00145). La ve: Owner/Admin, o quien puede ver tareas Y es creador, responsable
--          o seguidor, o tiene un rol con alcance `all` en el modulo `tasks`.
--   3. RLS: SELECT por `can_see_task`; INSERT/UPDATE por `can_edit_tasks`. SIN DELETE:
--      se borra con `delete_task` (00197, borrado logico). Privilegios por columna: el
--      cliente no puede escribir `workspace_id`, `created_by` (solo al insertar), `source`,
--      `source_ref`, `blocked_by` ni `deleted_at` (los toca el servidor o las RPC).
--   4. Triggers: `updated_at`, `completed_at` coherente con `status`, normalizacion y
--      validacion (responsable y seguidores deben ser miembros del workspace, el
--      responsable no es tambien seguidor, contacto y conversacion del mismo workspace).
--   5. F6: cuando una persona deja de ser miembro (DELETE en `workspace_members`), se la
--      saca de las tareas: `owner_id` queda null y se quita de `follower_ids`.
--
-- NO se toca ninguna funcion ni policy existente. Aditiva e idempotente.
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS tasks_clean_member_refs ON public.workspace_members;
--   DROP FUNCTION IF EXISTS public.tasks_clean_member_refs();
--   DROP TABLE IF EXISTS public.tasks CASCADE;        -- se pierden las tareas (tabla nueva)
--   DROP FUNCTION IF EXISTS public.tasks_before_write();
--   DROP FUNCTION IF EXISTS public.can_see_task_id(uuid);
--   DROP FUNCTION IF EXISTS public.can_see_task(public.tasks);   -- (si la tabla ya no esta, ignorar)
--   DROP FUNCTION IF EXISTS public.can_edit_tasks(uuid);
--   DROP FUNCTION IF EXISTS public.can_view_tasks(uuid);
-- ============================================================================

SET search_path = '';

-- ------------------------------------------------------------
-- 1. La tabla
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  title text NOT NULL CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 200),
  description text CHECK (description IS NULL OR char_length(description) <= 5000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  -- Solo fecha, en la zona del workspace.
  start_date date,
  due_date date,
  completed_at timestamptz,

  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  follower_ids uuid[] NOT NULL DEFAULT '{}',

  -- Proyecto como texto: como lo escribio la primera vez y su clave normalizada.
  project text CHECK (project IS NULL OR char_length(project) <= 80),
  project_key text,

  -- [{ "task_id": uuid, "gap_days": int }]; lo escribe set_task_blockers (00197).
  blocked_by jsonb NOT NULL DEFAULT '[]'::jsonb,

  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,

  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'flow', 'agent', 'cx')),
  source_ref text,

  -- Orden dentro de la columna del tablero.
  position double precision NOT NULL DEFAULT 0,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  CONSTRAINT tasks_followers_max CHECK (cardinality(follower_ids) <= 20),
  CONSTRAINT tasks_blocked_by_shape CHECK (jsonb_typeof(blocked_by) = 'array' AND jsonb_array_length(blocked_by) <= 10),
  CONSTRAINT tasks_dates_order CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)
);

COMMENT ON TABLE public.tasks IS
  'Tareas del equipo (Extra A). Proyecto, seguidores y dependencias viven aca. Borrado logico via delete_task.';
COMMENT ON COLUMN public.tasks.blocked_by IS
  '[{task_id, gap_days}], maximo 10, sin ciclos. Solo lo escribe set_task_blockers.';
COMMENT ON COLUMN public.tasks.source_ref IS
  'flow: "<flow_id>:<run>:<nodo>"; agent: run_id del agente; cx: id del caso (reservado).';

CREATE INDEX IF NOT EXISTS idx_tasks_ws_status_due
  ON public.tasks (workspace_id, status, due_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_ws_owner
  ON public.tasks (workspace_id, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_followers
  ON public.tasks USING gin (follower_ids);
CREATE INDEX IF NOT EXISTS idx_tasks_ws_project_key
  ON public.tasks (workspace_id, project_key);
CREATE INDEX IF NOT EXISTS idx_tasks_contact
  ON public.tasks (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_blocked_by
  ON public.tasks USING gin (blocked_by jsonb_path_ops);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_auto_source_open
  ON public.tasks (workspace_id, source, source_ref)
  WHERE source IN ('flow', 'agent') AND source_ref IS NOT NULL AND status <> 'completed' AND deleted_at IS NULL;

-- ------------------------------------------------------------
-- 2. Quien ve y quien edita
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_tasks(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.is_workspace_admin(p_workspace_id) THEN true
    ELSE COALESCE((
      SELECT
        -- Member sin rol, o con el rol de sistema Member: su baseline incluye `tasks.view`
        -- (vive en lib/auth/permissions.ts, no en el jsonb).
        m.role_id IS NULL
        OR r.system_role = 'member'
        OR COALESCE(r.permissions -> 'keys' @> to_jsonb(ARRAY['tasks.view']), false)
      FROM public.workspace_members m
      LEFT JOIN public.workspace_roles r ON r.id = m.role_id
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
    ), false)
  END;
$$;

REVOKE ALL ON FUNCTION public.can_view_tasks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_tasks(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_edit_tasks(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.is_workspace_admin(p_workspace_id) THEN true
    ELSE COALESCE((
      SELECT
        m.role_id IS NULL
        OR r.system_role = 'member'
        OR COALESCE(r.permissions -> 'keys' @> to_jsonb(ARRAY['tasks.edit']), false)
      FROM public.workspace_members m
      LEFT JOIN public.workspace_roles r ON r.id = m.role_id
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
    ), false)
  END;
$$;

REVOKE ALL ON FUNCTION public.can_edit_tasks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_tasks(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_see_task(t public.tasks)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- COALESCE: con `owner_id` o `created_by` en NULL las comparaciones dan NULL, y un `NOT (NULL)`
  -- en quien llama dejaria pasar a alguien que no ve la tarea. Siempre true o false.
  SELECT COALESCE(
    public.is_workspace_member(t.workspace_id)
    AND (
      public.is_workspace_admin(t.workspace_id)
      OR (
        public.can_view_tasks(t.workspace_id)
        AND (
          t.created_by = auth.uid()
          OR t.owner_id = auth.uid()
          OR t.follower_ids @> ARRAY[auth.uid()]
          OR public.permission_scope(t.workspace_id, 'tasks') = 'all'
        )
      )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.can_see_task(public.tasks) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_task(public.tasks) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_see_task_id(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT public.can_see_task(t) FROM public.tasks t WHERE t.id = p_task_id),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.can_see_task_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_task_id(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Triggers de escritura: updated_at, completed_at, normalizacion y validacion
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tasks_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- completed_at sigue al estado: se pone al completar y se borra al reabrir.
  IF NEW.status = 'completed' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed' OR NEW.completed_at IS NULL THEN
      NEW.completed_at := COALESCE(NEW.completed_at, now());
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  -- El responsable no es ademas seguidor; sin duplicados, en el orden dado.
  IF NEW.follower_ids IS NOT NULL THEN
    NEW.follower_ids := COALESCE((
      SELECT array_agg(x.uid ORDER BY x.ord)
      FROM (
        SELECT u.uid, min(u.ord) AS ord
        FROM unnest(NEW.follower_ids) WITH ORDINALITY AS u(uid, ord)
        WHERE u.uid IS NOT NULL AND u.uid IS DISTINCT FROM NEW.owner_id
        GROUP BY u.uid
      ) x
    ), '{}'::uuid[]);
  END IF;

  -- Responsable y seguidores: solo miembros del workspace.
  IF NEW.owner_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.owner_id
    ) THEN
      RAISE EXCEPTION 'task_invalid_owner' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF cardinality(NEW.follower_ids) > 0
     AND (TG_OP = 'INSERT' OR NEW.follower_ids IS DISTINCT FROM OLD.follower_ids) THEN
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.follower_ids) AS f(uid)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.workspace_members m
        WHERE m.workspace_id = NEW.workspace_id AND m.user_id = f.uid
      )
    ) THEN
      RAISE EXCEPTION 'task_invalid_follower' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Contacto y conversacion: del mismo workspace.
  IF NEW.contact_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.contact_id IS DISTINCT FROM OLD.contact_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = NEW.contact_id AND c.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'task_invalid_contact' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.conversation_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.conversations v
      WHERE v.id = NEW.conversation_id AND v.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'task_invalid_conversation' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tasks_before_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasks_before_write ON public.tasks;
CREATE TRIGGER tasks_before_write
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_before_write();

-- ------------------------------------------------------------
-- 4. RLS y privilegios por columna
-- ------------------------------------------------------------
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.can_see_task(tasks));

DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_tasks(workspace_id) AND created_by = auth.uid());

-- WITH CHECK sin `can_see_task`: pasar mi tarea a otra persona me la saca de la vista y
-- eso no puede ser un error.
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND public.can_edit_tasks(workspace_id) AND public.can_see_task(tasks))
  WITH CHECK (public.can_edit_tasks(workspace_id));

-- Sin policy de DELETE: el borrado es `delete_task`.
REVOKE ALL ON public.tasks FROM anon, authenticated;
GRANT SELECT ON public.tasks TO authenticated;
GRANT INSERT (
  workspace_id, title, description, status, priority, start_date, due_date,
  owner_id, follower_ids, project, project_key, contact_id, conversation_id, position, created_by
) ON public.tasks TO authenticated;
GRANT UPDATE (
  title, description, status, priority, start_date, due_date,
  owner_id, follower_ids, project, project_key, contact_id, conversation_id, position
) ON public.tasks TO authenticated;

-- ------------------------------------------------------------
-- 5. F6: una persona que deja el workspace se saca de sus tareas
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tasks_clean_member_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.tasks t
     SET owner_id = CASE WHEN t.owner_id = OLD.user_id THEN NULL ELSE t.owner_id END,
         follower_ids = array_remove(t.follower_ids, OLD.user_id)
   WHERE t.workspace_id = OLD.workspace_id
     AND (t.owner_id = OLD.user_id OR t.follower_ids @> ARRAY[OLD.user_id]);
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.tasks_clean_member_refs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasks_clean_member_refs ON public.workspace_members;
CREATE TRIGGER tasks_clean_member_refs
  AFTER DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.tasks_clean_member_refs();
