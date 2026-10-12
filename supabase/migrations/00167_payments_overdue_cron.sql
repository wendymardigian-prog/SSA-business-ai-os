-- ============================================================================
-- 00167 — Ventas (B4, F30): el cron que encola el barrido de mora
-- ============================================================================
-- Un pago `scheduled` que vence pasa a `overdue` solo. Cada hora (minuto 7), pg_cron llama a
-- `private.enqueue_payments_overdue_sweep()`, que deja en la cola (`scheduled_jobs`) UN job
-- `payments_overdue_sweep` por workspace y por dia local. El cron `jobs` que ya corre cada minuto
-- lo procesa con el handler `lib/jobs/handlers/payments-overdue-sweep.ts`.
--
-- NO se agrega una ruta en `app/api/cron/` ni se toca `private.call_app_cron`: comparten esa
-- funcion y su lista blanca TODOS los crons de la app. Este cron llama una funcion SQL directo, igual
-- que `private.enqueue_fathom_sync()` (00146); `lib/cron-config.test.ts` queda intacto.
--
-- La funcion, por cada workspace:
--   1. Calcula su hora local (`now() AT TIME ZONE workspaces.timezone`). ANTES de las 03:00 locales
--      no encola nada; desde las 03:00, el barrido del dia (cada workspace se barre una vez por dia
--      local, sea cual sea su zona).
--   2. SOLO encola si el workspace tiene algun pago candidato (`scheduled`, con `due_date <
--      hoy_local - overdue_grace_days`, de una venta que no sea cancelled, refunded, disputed ni
--      subscription_cancelled). Sin candidatos no deja ningun job: un workspace sin ventas (o sin
--      nada vencido) no genera trabajo ni ruido.
--   3. Inserta el job con `dedupe_key = 'overdue:<workspace>:<fecha local>'` y `ON CONFLICT DO NOTHING`
--      (el indice unico solo vale mientras el job esta `pending`; despues el handler es igual de seguro
--      porque su transicion es idempotente).
--   4. Una falla en UN workspace se avisa con RAISE WARNING y no frena a los demas.
-- Devuelve cuantos jobs encolo. Es SECURITY DEFINER y nadie con sesion la puede ejecutar. Aditiva
-- e idempotente.
--
-- Como volver atras:
--   SELECT cron.unschedule('payments-overdue-enqueue');
--   DROP FUNCTION IF EXISTS private.enqueue_payments_overdue_sweep();
--   UPDATE public.scheduled_jobs SET status = 'cancelled' WHERE type = 'payments_overdue_sweep' AND status = 'pending';
-- ============================================================================

CREATE OR REPLACE FUNCTION private.enqueue_payments_overdue_sweep()
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
    SELECT w.id, COALESCE(w.timezone, 'UTC') AS tz, COALESCE(w.overdue_grace_days, 0) AS grace
    FROM public.workspaces w
  LOOP
    BEGIN
      v_local := now() AT TIME ZONE v_ws.tz;
      v_day := v_local::date;

      -- Antes de las 03:00 locales no se encola nada.
      CONTINUE WHEN extract(hour FROM v_local) < 3;

      -- Sin pagos candidatos no hay trabajo que dejar.
      CONTINUE WHEN NOT EXISTS (
        SELECT 1
        FROM public.payments p
        JOIN public.sales s ON s.id = p.sale_id
        WHERE p.workspace_id = v_ws.id
          AND p.status = 'scheduled'
          AND p.due_date IS NOT NULL
          AND p.due_date < v_day - v_ws.grace
          AND s.status NOT IN ('cancelled', 'refunded', 'disputed', 'subscription_cancelled')
      );

      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES (
        'payments_overdue_sweep',
        jsonb_build_object('workspace_id', v_ws.id, 'local_date', v_day::text),
        now(),
        'overdue:' || v_ws.id::text || ':' || v_day::text
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_payments_overdue_sweep: no pude encolar el workspace %: %', v_ws.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_enqueued;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_payments_overdue_sweep() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payments-overdue-enqueue') THEN
    PERFORM cron.unschedule('payments-overdue-enqueue');
  END IF;
END $$;

SELECT cron.schedule('payments-overdue-enqueue', '7 * * * *', $$SELECT private.enqueue_payments_overdue_sweep()$$);
