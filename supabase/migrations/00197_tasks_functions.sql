-- ============================================================================
-- 00197 — Tareas: las operaciones que no pueden quedar a medias, y su historial
-- ============================================================================
-- Extra A (Sistema de Tareas), bloque T1, F4, F5, F6 y F7.
--
--   1. `complete_task_with_shifts(task, shifts, expected)`: completa una tarea y APLICA el
--      plan de corrimientos de fechas, todo en una transaccion. NO recalcula el plan (lo
--      calcula `computeDateShifts`, lib/tasks/date-rules.ts): VALIDA y aplica. Solo atrasa,
--      solo tareas abiertas del workspace que la persona puede editar, y cada tarea afectada
--      tiene que seguir como estaba (`updated_at` esperado; si no, `stale`). Con un solo
--      corrimiento invalido NO se completa nada.
--   2. `set_task_blockers(task, blockers)`: guarda las dependencias sin ciclos (directos ni
--      indirectos), sin bloquear antes de la fecha del bloqueante, maximo 10, y calcula
--      `gap_days`.
--   3. `delete_task(task)`: borrado logico (`deleted_at`) que ademas la saca de los
--      `blocked_by` de las demas SIN mover fechas. Pide `tasks.delete`.
--   4. `can_delete_tasks(ws)`: Owner/Admin o un rol personalizado con `tasks.delete` (el Member
--      de sistema no tiene esa clave).
--   5. Policy ADICIONAL `audit_log_select_tasks`: el historial de una tarea lo ve quien ve la
--      tarea (patron 00168). `audit_log_select` y las demas `audit_log_select_*` NO se tocan.
--
-- Las tres RPC devuelven jsonb `{ok:true,...}` o `{ok:false,error:'<codigo>'}`: un error de
-- negocio no es una excepcion, y como se valida ANTES de escribir, un `ok:false` nunca deja
-- nada a medias. Todas escriben `audit_log` (con `performed_by = auth.uid()`).
--
-- Aditiva e idempotente.
--
-- Como volver atras:
--   DROP POLICY IF EXISTS audit_log_select_tasks ON public.audit_log;
--   DROP FUNCTION IF EXISTS public.delete_task(uuid);
--   DROP FUNCTION IF EXISTS public.set_task_blockers(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.complete_task_with_shifts(uuid, jsonb, jsonb);
--   DROP FUNCTION IF EXISTS public.can_delete_tasks(uuid);
-- ============================================================================

SET search_path = '';

-- ------------------------------------------------------------
-- 1. Quien puede borrar
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_delete_tasks(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.is_workspace_admin(p_workspace_id) THEN true
    ELSE COALESCE((
      SELECT COALESCE(r.permissions -> 'keys' @> to_jsonb(ARRAY['tasks.delete']), false)
      FROM public.workspace_members m
      LEFT JOIN public.workspace_roles r ON r.id = m.role_id
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
    ), false)
  END;
$$;

REVOKE ALL ON FUNCTION public.can_delete_tasks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_delete_tasks(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. Completar con corrimientos (F4)
-- ------------------------------------------------------------
-- p_shifts   = [{ "task_id": uuid, "due_date": "AAAA-MM-DD", "start_date": "AAAA-MM-DD"? }]
-- p_expected = [{ "task_id": uuid, "updated_at": "<timestamptz tal cual lo devolvio la base>" }]
--              con la tarea que se completa y una entrada por cada tarea de p_shifts.
CREATE OR REPLACE FUNCTION public.complete_task_with_shifts(
  p_task_id uuid,
  p_shifts jsonb DEFAULT '[]'::jsonb,
  p_expected jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_ids uuid[];
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

      SELECT * INTO v_target FROM public.tasks
       WHERE id = (v_shift ->> 'task_id')::uuid AND deleted_at IS NULL;
      -- Inexistente, de otro workspace, borrada: todas son lo mismo para quien llama.
      IF NOT FOUND OR v_target.workspace_id <> v_task.workspace_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_shift ->> 'task_id');
      END IF;
      IF NOT COALESCE(public.can_edit_tasks(v_target.workspace_id) AND public.can_see_task(v_target), false) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'task_id', v_target.id);
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
        jsonb_build_object('caused_by_task_id', p_task_id),
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
$$;

REVOKE ALL ON FUNCTION public.complete_task_with_shifts(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_task_with_shifts(uuid, jsonb, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Dependencias sin ciclos (F5)
-- ------------------------------------------------------------
-- p_blockers = [ "<uuid>", ... ]  o  [ { "task_id": "<uuid>" }, ... ]   (el gap lo calcula la base)
CREATE OR REPLACE FUNCTION public.set_task_blockers(p_task_id uuid, p_blockers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.set_task_blockers(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_task_blockers(uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Borrar (F6)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.delete_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_task(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. Historial: lo ve quien ve la tarea (F7)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS audit_log_select_tasks ON public.audit_log;
CREATE POLICY audit_log_select_tasks ON public.audit_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND entity_type = 'task'
    AND public.can_see_task_id(entity_id)
  );
