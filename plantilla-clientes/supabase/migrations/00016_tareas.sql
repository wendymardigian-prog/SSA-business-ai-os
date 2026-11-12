-- ============================================================================
-- Tareas
--
-- Las tareas del equipo: responsable, seguidores, proyecto (texto), fechas y
-- dependencias. Completar una tarea corre las fechas de las que dependen de ella (solo para
-- atras) en una transaccion. Se borran con borrado logico; el barrido de vencimientos avisa
-- una vez por tarea y fecha.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  status text DEFAULT 'pending'::text NOT NULL,
  priority text DEFAULT 'normal'::text NOT NULL,
  start_date date,
  due_date date,
  completed_at timestamp with time zone,
  owner_id uuid,
  follower_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  project text,
  project_key text,
  blocked_by jsonb DEFAULT '[]'::jsonb NOT NULL,
  contact_id uuid,
  conversation_id uuid,
  source text DEFAULT 'manual'::text NOT NULL,
  source_ref text,
  "position" double precision DEFAULT 0 NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  due_time time without time zone,
  duration_minutes integer,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_blocked_by_shape CHECK (((jsonb_typeof(blocked_by) = 'array'::text) AND (jsonb_array_length(blocked_by) <= 10))),
  CONSTRAINT tasks_dates_order CHECK (((start_date IS NULL) OR (due_date IS NULL) OR (start_date <= due_date))),
  CONSTRAINT tasks_description_check CHECK (((description IS NULL) OR (char_length(description) <= 5000))),
  CONSTRAINT tasks_due_time_needs_date CHECK (((due_time IS NULL) OR (due_date IS NOT NULL))),
  CONSTRAINT tasks_duration_range CHECK (((duration_minutes IS NULL) OR ((duration_minutes >= 5) AND (duration_minutes <= 1440)))),
  CONSTRAINT tasks_followers_max CHECK ((cardinality(follower_ids) <= 20)),
  CONSTRAINT tasks_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
  CONSTRAINT tasks_project_check CHECK (((project IS NULL) OR (char_length(project) <= 80))),
  CONSTRAINT tasks_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'flow'::text, 'agent'::text, 'cx'::text]))),
  CONSTRAINT tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text]))),
  CONSTRAINT tasks_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(title) <= 200))),
  CONSTRAINT tasks_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT tasks_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL,
  CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT tasks_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tasks IS 'Tareas del equipo (Extra A). Proyecto, seguidores y dependencias viven aca. Borrado logico via delete_task.';
COMMENT ON COLUMN public.tasks.blocked_by IS '[{task_id, gap_days}], maximo 10, sin ciclos. Solo lo escribe set_task_blockers.';
COMMENT ON COLUMN public.tasks.source_ref IS 'flow: "<flow_id>:<run>:<nodo>"; agent: run_id del agente; cx: id del caso (reservado).';
REVOKE ALL ON TABLE public.tasks FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tasks FROM authenticated;
GRANT INSERT (workspace_id, title, description, status, priority, start_date, due_date, owner_id, follower_ids, project, project_key, contact_id, conversation_id, "position", created_by, due_time, duration_minutes) ON TABLE public.tasks TO authenticated;
GRANT UPDATE (title, description, status, priority, start_date, due_date, owner_id, follower_ids, project, project_key, contact_id, conversation_id, "position", due_time, duration_minutes) ON TABLE public.tasks TO authenticated;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.enqueue_tasks_due_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws record;
  v_local timestamp;
  v_day date;
  v_enqueued integer := 0;
BEGIN
  FOR v_ws IN
    SELECT w.id, COALESCE(w.timezone, 'UTC') AS tz
    FROM public.workspaces w
  LOOP
    BEGIN
      v_local := now() AT TIME ZONE v_ws.tz;
      v_day := v_local::date;
      CONTINUE WHEN extract(hour FROM v_local) < 8;

      CONTINUE WHEN NOT EXISTS (
        SELECT 1
        FROM public.tasks t
        WHERE t.workspace_id = v_ws.id
          AND t.deleted_at IS NULL
          AND t.status <> 'completed'
          AND t.due_date IS NOT NULL
          AND t.due_date <= v_day
          AND (t.owner_id IS NOT NULL OR cardinality(t.follower_ids) > 0)
          AND NOT EXISTS (
            SELECT 1
            FROM public.notifications n
            WHERE n.entity_id = t.id
              AND n.metadata ->> 'due_date' = t.due_date::text
              AND n.type = CASE WHEN t.due_date = v_day THEN 'task_due_today' ELSE 'task_overdue' END
          )
      );

      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES (
        'tasks_due_sweep',
        jsonb_build_object('workspace_id', v_ws.id, 'local_date', v_day::text),
        now(),
        'tasks-due:' || v_ws.id::text || ':' || v_day::text
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;

      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_tasks_due_sweep: no pude encolar el workspace %: %', v_ws.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_enqueued;
END;
$function$;
REVOKE ALL ON FUNCTION private.enqueue_tasks_due_sweep() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.can_delete_tasks(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN public.is_workspace_admin(p_workspace_id) THEN true
    ELSE COALESCE((
      SELECT COALESCE(r.permissions -> 'keys' @> to_jsonb(ARRAY['tasks.delete']), false)
      FROM public.workspace_members m
      LEFT JOIN public.workspace_roles r ON r.id = m.role_id
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
    ), false)
  END;
$function$;
REVOKE ALL ON FUNCTION public.can_delete_tasks(p_workspace_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_edit_tasks(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.can_edit_tasks(p_workspace_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_view_tasks(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.can_view_tasks(p_workspace_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_see_task(t public.tasks)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.can_see_task(t public.tasks) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_see_task_id(p_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (SELECT public.can_see_task(t) FROM public.tasks t WHERE t.id = p_task_id),
    false
  );
$function$;
REVOKE ALL ON FUNCTION public.can_see_task_id(p_task_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.complete_task_with_shifts(p_task_id uuid, p_shifts jsonb DEFAULT '[]'::jsonb, p_expected jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_ids uuid[];
  v_tree uuid[];
  v_shift jsonb;
  v_target public.tasks%ROWTYPE;
  v_new_due date;
  v_new_start date;
  v_exp jsonb;
  v_seen uuid[] := '{}';
  v_applied jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    IF p_shifts IS NULL OR jsonb_typeof(p_shifts) <> 'array' OR p_expected IS NULL OR jsonb_typeof(p_expected) <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
    END IF;

    -- Las tareas involucradas, bloqueadas en un orden fijo (sin interbloqueos).
    SELECT COALESCE(array_agg(DISTINCT x.id ORDER BY x.id), '{}')
      INTO v_ids
      FROM (
        SELECT p_task_id AS id
        UNION
        SELECT NULLIF(e ->> 'task_id', '')::uuid FROM jsonb_array_elements(p_shifts) e
      ) x
     WHERE x.id IS NOT NULL;

    PERFORM 1 FROM public.tasks WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
    IF NOT FOUND OR NOT public.is_workspace_member(v_task.workspace_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    -- Quien completa necesita poder editar y ver ESE bloqueante. Nada mas se abre.
    IF NOT COALESCE(public.can_edit_tasks(v_task.workspace_id) AND public.can_see_task(v_task), false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    IF v_task.status = 'completed' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_completed');
    END IF;

    -- La tarea que se completa no cambio desde que se armo el plan.
    SELECT e INTO v_exp FROM jsonb_array_elements(p_expected) e WHERE e ->> 'task_id' = p_task_id::text LIMIT 1;
    IF v_exp IS NULL OR (v_exp ->> 'updated_at')::timestamptz IS DISTINCT FROM v_task.updated_at THEN
      RETURN jsonb_build_object('ok', false, 'error', 'stale', 'task_id', p_task_id);
    END IF;

    -- El arbol de dependientes (transitivas) del bloqueante: lo unico que la regla de fechas puede mover.
    WITH RECURSIVE tree(id) AS (
      SELECT t.id
        FROM public.tasks t
       WHERE t.workspace_id = v_task.workspace_id AND t.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.blocked_by) b WHERE b ->> 'task_id' = p_task_id::text)
      UNION
      SELECT t.id
        FROM public.tasks t
        JOIN tree ON EXISTS (SELECT 1 FROM jsonb_array_elements(t.blocked_by) b WHERE b ->> 'task_id' = tree.id::text)
       WHERE t.workspace_id = v_task.workspace_id AND t.deleted_at IS NULL
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_tree FROM tree;

    -- Validar TODOS los corrimientos antes de escribir cualquiera.
    FOR v_shift IN SELECT e FROM jsonb_array_elements(p_shifts) e LOOP
      IF jsonb_typeof(v_shift) <> 'object' OR NULLIF(v_shift ->> 'task_id', '') IS NULL OR NULLIF(v_shift ->> 'due_date', '') IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
      END IF;

      BEGIN
        v_new_due := (v_shift ->> 'due_date')::date;
        v_new_start := NULLIF(v_shift ->> 'start_date', '')::date;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
      END;

      IF (v_shift ->> 'task_id')::uuid = ANY (v_seen) OR (v_shift ->> 'task_id')::uuid = p_task_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_shift ->> 'task_id');
      END IF;
      v_seen := v_seen || (v_shift ->> 'task_id')::uuid;

      -- Solo dependientes de esta tarea. Inexistente, de otro workspace, borrada o de otra cadena: todo es lo mismo.
      IF NOT ((v_shift ->> 'task_id')::uuid = ANY (v_tree)) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_shift ->> 'task_id');
      END IF;
      SELECT * INTO v_target FROM public.tasks
       WHERE id = (v_shift ->> 'task_id')::uuid AND deleted_at IS NULL AND workspace_id = v_task.workspace_id;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_shift ->> 'task_id');
      END IF;
      IF v_target.status = 'completed' OR v_target.due_date IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_target.id);
      END IF;
      -- Solo atrasa.
      IF v_new_due <= v_target.due_date THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_target.id);
      END IF;
      IF v_new_start IS NOT NULL AND (v_target.start_date IS NULL OR v_new_start < v_target.start_date OR v_new_start > v_new_due) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_target.id);
      END IF;

      SELECT e INTO v_exp FROM jsonb_array_elements(p_expected) e WHERE e ->> 'task_id' = v_target.id::text LIMIT 1;
      IF v_exp IS NULL OR (v_exp ->> 'updated_at')::timestamptz IS DISTINCT FROM v_target.updated_at THEN
        RETURN jsonb_build_object('ok', false, 'error', 'stale', 'task_id', v_target.id);
      END IF;
    END LOOP;

    -- Escribir: todo o nada (esto es una sola transaccion).
    UPDATE public.tasks SET status = 'completed' WHERE id = p_task_id;
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
    VALUES (
      v_task.workspace_id, 'task', p_task_id, 'task.completed',
      jsonb_build_object('status', jsonb_build_object('old', v_task.status, 'new', 'completed')),
      jsonb_build_object('shifted', jsonb_array_length(p_shifts)),
      v_uid
    );

    FOR v_shift IN SELECT e FROM jsonb_array_elements(p_shifts) e LOOP
      SELECT * INTO v_target FROM public.tasks WHERE id = (v_shift ->> 'task_id')::uuid;
      v_new_due := (v_shift ->> 'due_date')::date;
      v_new_start := NULLIF(v_shift ->> 'start_date', '')::date;

      -- Solo fechas: la hora y la duracion de la tarea se conservan.
      UPDATE public.tasks
         SET due_date = v_new_due,
             start_date = COALESCE(v_new_start, start_date)
       WHERE id = v_target.id;

      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
      VALUES (
        v_task.workspace_id, 'task', v_target.id, 'task.date_shifted',
        jsonb_strip_nulls(jsonb_build_object(
          'due_date', jsonb_build_object('old', v_target.due_date, 'new', v_new_due),
          'start_date', CASE WHEN v_new_start IS NOT NULL
                             THEN jsonb_build_object('old', v_target.start_date, 'new', v_new_start) END
        )),
        jsonb_build_object('caused_by_task_id', p_task_id, 'reason', 'dependencia completada'),
        v_uid
      );

      v_applied := v_applied || jsonb_build_array(jsonb_build_object(
        'task_id', v_target.id, 'from_due', v_target.due_date, 'to_due', v_new_due
      ));
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'task_id', p_task_id, 'shifted', v_applied);
  EXCEPTION WHEN data_exception THEN
    -- Un id o una fecha que no son lo que dicen: es un pedido invalido, no un error del servidor.
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_task_with_shifts(p_task_id uuid, p_shifts jsonb, p_expected jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.delete_task(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_unlinked integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.is_workspace_member(v_task.workspace_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF NOT COALESCE(public.can_delete_tasks(v_task.workspace_id) AND public.can_see_task(v_task), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- La saca de las dependencias de las demas. NO se mueve ninguna fecha.
  UPDATE public.tasks t
     SET blocked_by = COALESCE((
           SELECT jsonb_agg(e) FROM jsonb_array_elements(t.blocked_by) e WHERE e ->> 'task_id' <> p_task_id::text
         ), '[]'::jsonb)
   WHERE t.workspace_id = v_task.workspace_id
     AND t.blocked_by @> jsonb_build_array(jsonb_build_object('task_id', p_task_id));
  GET DIAGNOSTICS v_unlinked = ROW_COUNT;

  UPDATE public.tasks SET deleted_at = now() WHERE id = p_task_id;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    v_task.workspace_id, 'task', p_task_id, 'task.deleted',
    jsonb_build_object('title', jsonb_build_object('old', v_task.title, 'new', NULL)),
    jsonb_build_object('unlinked_from', v_unlinked),
    v_uid
  );

  RETURN jsonb_build_object('ok', true, 'task_id', p_task_id, 'unlinked_from', v_unlinked);
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_task(p_task_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.set_task_blockers(p_task_id uuid, p_blockers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_ids uuid[];
  v_id uuid;
  v_blocker public.tasks%ROWTYPE;
  v_gap integer;
  v_new jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_blockers IS NULL OR jsonb_typeof(p_blockers) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  BEGIN
    SELECT COALESCE(array_agg(
             CASE WHEN jsonb_typeof(e) = 'string' THEN (e #>> '{}')::uuid ELSE (e ->> 'task_id')::uuid END
             ORDER BY o), '{}')
      INTO v_ids
      FROM jsonb_array_elements(p_blockers) WITH ORDINALITY AS t(e, o);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END;

  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.is_workspace_member(v_task.workspace_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF NOT COALESCE(public.can_edit_tasks(v_task.workspace_id) AND public.can_see_task(v_task), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF cardinality(v_ids) > 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_many');
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> cardinality(v_ids) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate');
  END IF;
  IF p_task_id = ANY (v_ids) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self');
  END IF;

  -- Cada bloqueante existe, es del mismo workspace y la persona lo puede ver.
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_blocker FROM public.tasks WHERE id = v_id AND deleted_at IS NULL;
    IF NOT FOUND OR v_blocker.workspace_id <> v_task.workspace_id OR NOT public.can_see_task(v_blocker) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_task', 'task_id', v_id);
    END IF;
  END LOOP;

  -- Ciclos: subiendo por los bloqueantes de cada nuevo bloqueante, ¿aparece esta tarea?
  IF cardinality(v_ids) > 0 AND EXISTS (
    WITH RECURSIVE up(id) AS (
      SELECT unnest(v_ids)
      UNION
      SELECT (b.e ->> 'task_id')::uuid
        FROM up
        JOIN public.tasks t ON t.id = up.id AND t.workspace_id = v_task.workspace_id AND t.deleted_at IS NULL
        CROSS JOIN LATERAL jsonb_array_elements(t.blocked_by) AS b(e)
    )
    SELECT 1 FROM up WHERE up.id = p_task_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cycle');
  END IF;

  -- gap_days = vencimiento de la bloqueada - el del bloqueante; sin alguna de las dos, 0.
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_blocker FROM public.tasks WHERE id = v_id;
    IF v_task.due_date IS NOT NULL AND v_blocker.due_date IS NOT NULL THEN
      v_gap := v_task.due_date - v_blocker.due_date;
      IF v_gap < 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'date_before_blocker', 'task_id', v_id);
      END IF;
    ELSE
      v_gap := 0;
    END IF;
    v_new := v_new || jsonb_build_array(jsonb_build_object('task_id', v_id, 'gap_days', v_gap));
  END LOOP;

  UPDATE public.tasks SET blocked_by = v_new WHERE id = p_task_id;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by)
  VALUES (
    v_task.workspace_id, 'task', p_task_id, 'task.blockers_changed',
    jsonb_build_object('blocked_by', jsonb_build_object(
      'old', (SELECT COALESCE(jsonb_agg(e ->> 'task_id'), '[]'::jsonb) FROM jsonb_array_elements(v_task.blocked_by) e),
      'new', (SELECT COALESCE(jsonb_agg(e ->> 'task_id'), '[]'::jsonb) FROM jsonb_array_elements(v_new) e)
    )),
    v_uid
  );

  RETURN jsonb_build_object('ok', true, 'blocked_by', v_new);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_task_blockers(p_task_id uuid, p_blockers jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.task_shift_context(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.is_workspace_member(v_task.workspace_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  -- Solo quien puede completar ese bloqueante (editar y verlo) conoce el contexto de sus dependientes.
  IF NOT COALESCE(public.can_edit_tasks(v_task.workspace_id) AND public.can_see_task(v_task), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  WITH RECURSIVE tree(id) AS (
    SELECT t.id
      FROM public.tasks t
     WHERE t.workspace_id = v_task.workspace_id AND t.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.blocked_by) b WHERE b ->> 'task_id' = p_task_id::text)
    UNION
    SELECT t.id
      FROM public.tasks t
      JOIN tree ON EXISTS (SELECT 1 FROM jsonb_array_elements(t.blocked_by) b WHERE b ->> 'task_id' = tree.id::text)
     WHERE t.workspace_id = v_task.workspace_id AND t.deleted_at IS NULL
  ),
  dep_ids AS (
    SELECT id FROM tree WHERE id <> p_task_id
  ),
  -- Los demas bloqueantes de esas dependientes (para saber su fecha): solo estado y fechas.
  other_ids AS (
    SELECT DISTINCT (b ->> 'task_id')::uuid AS id
      FROM public.tasks d
      CROSS JOIN LATERAL jsonb_array_elements(d.blocked_by) b
     WHERE d.id IN (SELECT id FROM dep_ids)
       AND (b ->> 'task_id')::uuid <> p_task_id
       AND (b ->> 'task_id')::uuid NOT IN (SELECT id FROM dep_ids)
  )
  SELECT COALESCE(jsonb_agg(row_json), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id', d.id, 'in_tree', true, 'status', d.status,
             'start_date', d.start_date, 'due_date', d.due_date, 'due_time', d.due_time, 'duration_minutes', d.duration_minutes,
             'completed_at', d.completed_at, 'blocked_by', d.blocked_by, 'owner_id', d.owner_id, 'follower_ids', d.follower_ids,
             'updated_at', d.updated_at,
             'visible', public.can_see_task(d),
             'title', CASE WHEN public.can_see_task(d) THEN d.title END
           ) AS row_json
      FROM public.tasks d
     WHERE d.id IN (SELECT id FROM dep_ids)
    UNION ALL
    SELECT jsonb_build_object(
             'id', o.id, 'in_tree', false, 'status', o.status,
             'start_date', o.start_date, 'due_date', o.due_date, 'due_time', NULL, 'duration_minutes', NULL,
             'completed_at', o.completed_at, 'blocked_by', '[]'::jsonb, 'owner_id', NULL, 'follower_ids', '[]'::jsonb,
             'updated_at', o.updated_at,
             'visible', public.can_see_task(o),
             'title', CASE WHEN public.can_see_task(o) THEN o.title END
           )
      FROM public.tasks o
     WHERE o.id IN (SELECT id FROM other_ids) AND o.workspace_id = v_task.workspace_id AND o.deleted_at IS NULL
  ) x;

  RETURN jsonb_build_object('ok', true, 'task_id', p_task_id, 'workspace_id', v_task.workspace_id, 'tasks', v_rows);
END;
$function$;
REVOKE ALL ON FUNCTION public.task_shift_context(p_task_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.tasks_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.tasks_before_write() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tasks_clean_member_refs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.tasks t
     SET owner_id = CASE WHEN t.owner_id = OLD.user_id THEN NULL ELSE t.owner_id END,
         follower_ids = array_remove(t.follower_ids, OLD.user_id)
   WHERE t.workspace_id = OLD.workspace_id
     AND (t.owner_id = OLD.user_id OR t.follower_ids @> ARRAY[OLD.user_id]);
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.tasks_clean_member_refs() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_tasks_blocked_by ON public.tasks USING gin (blocked_by jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_tasks_contact ON public.tasks USING btree (contact_id) WHERE (contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_tasks_followers ON public.tasks USING gin (follower_ids);

CREATE INDEX IF NOT EXISTS idx_tasks_ws_owner ON public.tasks USING btree (workspace_id, owner_id) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_tasks_ws_project_key ON public.tasks USING btree (workspace_id, project_key);

CREATE INDEX IF NOT EXISTS idx_tasks_ws_status_due ON public.tasks USING btree (workspace_id, status, due_date) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_auto_source_open ON public.tasks USING btree (workspace_id, source, source_ref) WHERE ((source = ANY (ARRAY['flow'::text, 'agent'::text])) AND (source_ref IS NOT NULL) AND (status <> 'completed'::text) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_followup ON public.tasks USING btree (workspace_id, contact_id, source_ref) WHERE ((source_ref ~~ 'followup:%'::text) AND (deleted_at IS NULL));

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER tasks_before_write BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_before_write();

CREATE OR REPLACE TRIGGER tasks_clean_member_refs AFTER DELETE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION public.tasks_clean_member_refs();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY audit_log_select_tasks ON public.audit_log FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND (entity_type = 'task'::text) AND public.can_see_task_id(entity_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO authenticated
    WITH CHECK ((public.can_edit_tasks(workspace_id) AND (created_by = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tasks_select ON public.tasks FOR SELECT TO authenticated
    USING (((deleted_at IS NULL) AND public.can_see_task(tasks.*)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated
    USING (((deleted_at IS NULL) AND public.can_edit_tasks(workspace_id) AND public.can_see_task(tasks.*)))
    WITH CHECK (public.can_edit_tasks(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
