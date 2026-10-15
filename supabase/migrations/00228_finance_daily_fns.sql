-- ============================================================================
-- 00228 — Gastos (G2, GF11): vencer gastos y encolar el trabajo diario (SIN programar el cron)
-- ============================================================================
-- Dos funciones, ninguna cambia lo que hace el codigo de produccion actual:
--
--   1. public.mark_expenses_overdue(workspace, hoy): pasa a `vencido` los gastos `programado` con fecha anterior
--      a hoy. NUNCA toca otro estado (un pagado, un anulado o un «por revisar» no vencen). Devuelve los ids.
--
--   2. private.enqueue_finance_daily(ahora): por cada workspace, si en SU zona ya son las 03:00 o mas, encola UN
--      `finance_daily` para su fecha local, SOLO si no existe ya un trabajo con esa clave EN CUALQUIER ESTADO
--      (el unico de `scheduled_jobs.dedupe_key` solo cubre los pendientes; sin esto, un trabajo completado no
--      impediria encolar otro). Una zona invalida cae a UTC y una falla en un workspace no frena a los demas.
--      Recibe «ahora» como parametro (default now()) para poder probarla con un reloj fijo.
--
-- El `cron.schedule('finance-daily', ...)` NO esta en esta migracion: es la 00233, que se aplica DESPUES de
-- mergear (si se aplicara antes, la tarea encolaria trabajos de un tipo que el codigo en produccion todavia no
-- conoce y la cola los marcaria fallidos). Mientras tanto «Calcular ahora» (Ajustes) encola el trabajo a mano.
--
-- NO se agrega una ruta en `app/api/cron/` ni se toca `private.call_app_cron` (patron de 00167 y 00198).
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS private.enqueue_finance_daily(timestamptz);
--   DROP FUNCTION IF EXISTS public.mark_expenses_overdue(uuid, date);
--   UPDATE public.scheduled_jobs SET status = 'cancelled' WHERE type = 'finance_daily' AND status = 'pending';
-- Riesgo: bajo. Aditiva.
-- ============================================================================

SET search_path = '';

CREATE OR REPLACE FUNCTION public.mark_expenses_overdue(p_workspace_id uuid, p_today date)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH changed AS (
    UPDATE public.expenses e
       SET status = 'vencido'
     WHERE e.workspace_id = p_workspace_id
       AND e.status = 'programado'
       AND e.scheduled_date < p_today
    RETURNING e.id
  )
  SELECT id FROM changed;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_expenses_overdue(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_expenses_overdue(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION private.enqueue_finance_daily(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws record;
  v_local timestamp;
  v_day date;
  v_key text;
  v_enqueued integer := 0;
BEGIN
  FOR v_ws IN SELECT w.id, COALESCE(w.timezone, 'UTC') AS tz FROM public.workspaces w LOOP
    BEGIN
      BEGIN
        v_local := p_now AT TIME ZONE v_ws.tz;
      EXCEPTION WHEN OTHERS THEN
        -- Una zona guardada invalida no frena a nadie: ese workspace corre en UTC.
        v_local := p_now AT TIME ZONE 'UTC';
      END;
      v_day := v_local::date;
      CONTINUE WHEN v_local::time < time '03:00';

      v_key := 'finance_daily:' || v_ws.id::text || ':' || v_day::text;
      -- «Una vez por dia»: se mira si existe en CUALQUIER estado, no solo pendiente.
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.scheduled_jobs j WHERE j.dedupe_key = v_key);

      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES (
        'finance_daily',
        jsonb_build_object('workspace_id', v_ws.id, 'local_date', v_day::text),
        p_now,
        v_key
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;

      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_finance_daily: no pude encolar el workspace %: %', v_ws.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_enqueued;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_finance_daily(timestamptz) FROM PUBLIC, anon, authenticated;
