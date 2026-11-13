-- ============================================================
-- 00370_task_guard_service_close.sql
-- ============================================================
-- Servicios A4 (plano: A4-M5), F153 y F156 (decision 480):
--
--   1. `app_servicio.task_guard()`: BEFORE UPDATE OF status ON public.tasks. Frena completar la tarea de un paso
--      bloqueado (SV033) o que pide evidencia sin tenerla (SV034). Solo actua con el modulo prendido, en tareas del
--      camino (`source = 'cx'`, `source_ref = 'svc_item:…'`), con el paso PENDIENTE y el servicio activo o pausado (asi
--      el cierre de abajo no queda frenado). Es la UNICA excepcion a «los enganches nunca hacen fallar lo que los
--      dispara», a proposito: es la regla que se pidio. Cualquier otro error del modulo NO frena la tarea (warning).
--      Una tarea que no es del camino nunca pasa por aca.
--   2. `app_servicio.service_close_tasks_hook()`: AFTER UPDATE OF status ON app_servicio.services. Al pasar a
--      cancelled, completed o renewed cierra las tareas abiertas de los pasos de ese servicio (`completed`), con un
--      comentario de sistema («Cerrada: el servicio se canceló / terminó / se renovó») y su entrada en `audit_log`.
--      Los pasos NO cambian. Pausar no cierra nada. Reabrir la tarea a mano se puede (no reabre el servicio).
--   3. Reescribe `app_servicio.task_hook()`: el enganche tarea → paso solo actua con el servicio activo o pausado (si
--      no, cerrar las tareas al terminar completaria los pasos). La definicion vieja esta en
--      docs/servicios/definiciones-viejas-a4.sql.
--
-- Aditiva (triggers nuevos) + una funcion reescrita. Como volver atras:
--   DROP TRIGGER IF EXISTS trg_app_servicio_task_guard ON public.tasks;
--   DROP TRIGGER IF EXISTS trg_app_servicio_close_tasks ON app_servicio.services;
--   DROP FUNCTION IF EXISTS app_servicio.task_guard(), app_servicio.service_close_tasks_hook();
--   y correr la definicion vieja de app_servicio.task_hook (docs/servicios/definiciones-viejas-a4.sql).
-- No cambia datos por si sola. Las tareas que ya cerro el cierre se pueden reabrir a mano.

-- ─── 1. La guardia de completar tareas (F153) ───────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.task_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- `record` y no tipos del modulo: un problema con una tabla del modulo no puede frenar una tarea de BAIOS.
  v_item record;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' OR OLD.status = 'completed' THEN RETURN NEW; END IF;
  IF NEW.source IS DISTINCT FROM 'cx' OR NEW.source_ref IS NULL OR NEW.source_ref NOT LIKE 'svc\_item:%' THEN RETURN NEW; END IF;
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NEW; END IF;
  BEGIN
    SELECT i.id, i.status, s.status AS service_status INTO v_item
      FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
     WHERE i.id = substr(NEW.source_ref, 10)::uuid AND i.workspace_id = NEW.workspace_id;
    IF v_item.id IS NULL OR v_item.status <> 'pending' OR v_item.service_status NOT IN ('active', 'paused') THEN RETURN NEW; END IF;
    PERFORM app_servicio.svc_assert_completable(v_item.id);
  EXCEPTION
    WHEN SQLSTATE 'SV033' OR SQLSTATE 'SV034' THEN RAISE;
    WHEN OTHERS THEN
      RAISE WARNING 'app_servicio task_guard: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.task_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_app_servicio_task_guard ON public.tasks;
CREATE TRIGGER trg_app_servicio_task_guard
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION app_servicio.task_guard();

-- ─── 2. El cierre de tareas al terminar el servicio (F156, decision 480) ───
CREATE OR REPLACE FUNCTION app_servicio.service_close_tasks_hook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t record;
  v_text text;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('cancelled', 'completed', 'renewed') THEN RETURN NULL; END IF;
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    v_text := CASE NEW.status WHEN 'cancelled' THEN 'Cerrada: el servicio se canceló.'
                              WHEN 'completed' THEN 'Cerrada: el servicio terminó.'
                              ELSE 'Cerrada: el servicio se renovó.' END;
    FOR t IN
      SELECT tk.id, tk.workspace_id
        FROM public.tasks tk
        JOIN app_servicio.service_items i ON i.task_id = tk.id
       WHERE i.service_id = NEW.id AND tk.status <> 'completed' AND tk.deleted_at IS NULL
         AND tk.source = 'cx' AND tk.source_ref = 'svc_item:' || i.id::text
    LOOP
      UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = t.id AND status <> 'completed';
      PERFORM private.comment_system(t.workspace_id, 'task', t.id, v_text);
      PERFORM app_servicio.audit(t.workspace_id, 'task', t.id, 'svc.task_closed_by_service',
        jsonb_build_object('service_id', NEW.id, 'service_status', NEW.status), 'system');
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'service_close_tasks', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.service_close_tasks_hook() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_app_servicio_close_tasks ON app_servicio.services;
CREATE TRIGGER trg_app_servicio_close_tasks
  AFTER UPDATE OF status ON app_servicio.services
  FOR EACH ROW EXECUTE FUNCTION app_servicio.service_close_tasks_hook();

-- ─── 3. El enganche tarea → paso, solo con el servicio activo o pausado (F156) ───
CREATE OR REPLACE FUNCTION app_servicio.task_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item uuid;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NEW.source <> 'cx' OR NEW.source_ref IS NULL OR NEW.source_ref NOT LIKE 'svc\_item:%' THEN RETURN NULL; END IF;
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    SELECT i.id INTO v_item FROM app_servicio.service_items i
      JOIN app_servicio.services s ON s.id = i.service_id
     WHERE i.id = substr(NEW.source_ref, 10)::uuid AND i.workspace_id = NEW.workspace_id AND i.task_id = NEW.id
       -- A4 (00370): con el servicio cancelado, terminado o renovado, la tarea no toca el paso.
       AND s.status IN ('active', 'paused');
    IF v_item IS NOT NULL THEN
      IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
        PERFORM app_servicio.svc_mark_item(v_item, 'task', 'user', NULL);
      ELSIF OLD.status = 'completed' AND NEW.status <> 'completed' THEN
        PERFORM app_servicio.svc_unmark_item(v_item);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'task', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$function$;
