-- ============================================================================
-- 00233 — Gastos (G2, GF11): programa la tarea `finance-daily`   *** SE APLICA DESPUES DEL MERGE ***
-- ============================================================================
-- Cada hora, minuto 7, pg_cron llama a `private.enqueue_finance_daily()` (00228), que encola UN `finance_daily` por
-- workspace y por dia local, a partir de las 03:00 de su zona. El cron `jobs` que ya corre cada minuto lo procesa
-- con el handler `lib/jobs/handlers/finance-daily.ts`.
--
-- POR QUE NO SE APLICA ANTES DEL MERGE: si se programara antes de desplegar el codigo, la tarea encolaria
-- trabajos de un tipo que el runner de produccion todavia no conoce y la cola los marcaria fallidos. No rompe
-- nada, pero ensucia la cola. Si pasara: UPDATE scheduled_jobs SET status = 'cancelled' WHERE type = 'finance_daily' AND status = 'failed'.
--
-- NO se agrega una ruta en `app/api/cron/` ni se toca `private.call_app_cron` (patron de 00167 y 00198).
--
-- Como volver atras:
--   SELECT cron.unschedule('finance-daily');
--   UPDATE public.scheduled_jobs SET status = 'cancelled' WHERE type = 'finance_daily' AND status = 'pending';
-- Riesgo: medio (un proceso periodico nuevo). Aditiva.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finance-daily') THEN
    PERFORM cron.unschedule('finance-daily');
  END IF;
END $$;

SELECT cron.schedule('finance-daily', '7 * * * *', $$SELECT private.enqueue_finance_daily()$$);
