-- ============================================================================
-- 00198 — Tareas (T3, F18): el cron que encola el barrido de vencimientos
-- ============================================================================
-- Avisar «vence hoy» y «esta vencida» en la campana. Cada hora (minuto 17), pg_cron llama a
-- `private.enqueue_tasks_due_sweep()`, que deja en la cola (`scheduled_jobs`) UN job `tasks_due_sweep`
-- por workspace y por dia local. El cron `jobs` que ya corre cada minuto lo procesa con el handler
-- `lib/jobs/handlers/tasks-due-sweep.ts`.
--
-- NO se agrega una ruta en `app/api/cron/` ni se toca `private.call_app_cron` (patron de 00167 y
-- 00146): `lib/cron-config.test.ts` queda intacto.
--
-- La funcion, por cada workspace:
--   1. Calcula su hora local (`now() AT TIME ZONE workspaces.timezone`). ANTES de las 08:00 locales no
--      encola nada; desde las 08:00, el barrido del dia.
--   2. SOLO encola si hay alguna tarea candidata: no completada, no borrada, con responsable o
--      seguidores, y que (a) vence hoy sin aviso `task_due_today` para ese vencimiento, o (b) esta
--      vencida sin aviso `task_overdue` para ese vencimiento. Sin candidatas no deja ningun job.
--   3. Inserta el job con `dedupe_key = 'tasks-due:<workspace>:<fecha local>'` y `ON CONFLICT DO
--      NOTHING` (el indice unico solo vale mientras el job esta `pending`; despues el handler es igual
--      de seguro: avisa una vez por tarea y fecha).
--   4. Una falla en UN workspace se avisa con RAISE WARNING y no frena a los demas.
-- Devuelve cuantos jobs encolo. SECURITY DEFINER, `search_path = ''`, y nadie con sesion la puede
-- ejecutar. Aditiva e idempotente.
--
-- Como volver atras:
--   SELECT cron.unschedule('tasks-due-enqueue');
--   DROP FUNCTION IF EXISTS private.enqueue_tasks_due_sweep();
--   UPDATE public.scheduled_jobs SET status = 'cancelled' WHERE type = 'tasks_due_sweep' AND status = 'pending';
-- ============================================================================

CREATE OR REPLACE FUNCTION private.enqueue_tasks_due_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION private.enqueue_tasks_due_sweep() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tasks-due-enqueue') THEN
    PERFORM cron.unschedule('tasks-due-enqueue');
  END IF;
END $$;

SELECT cron.schedule('tasks-due-enqueue', '17 * * * *', $$SELECT private.enqueue_tasks_due_sweep()$$);
