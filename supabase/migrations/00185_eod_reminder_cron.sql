-- ============================================================================
-- 00185 — Reporte de fin de dia (E13): el recordatorio
-- ============================================================================
-- pg_cron cada 15 minutos llama a `private.enqueue_eod_reminders()`, que encola en
-- `scheduled_jobs` UN barrido (`eod_reminder_sweep`) por cada reporte publicado con el
-- recordatorio prendido, con `dedupe_key = 'eod-reminder:<form>:<franja de 15 min>'`.
-- El barrido (lib/jobs/handlers/eod-reminder.ts) decide a quien avisar: quien esta en la
-- audiencia, la hora en SU zona, si ya envio el de hoy y si ya se le aviso. Esa regla vive en
-- TypeScript (`lib/eod/reminder.ts`, con su test) y NO se repite aca: la audiencia por roles
-- es la misma funcion que usa la pantalla.
--
-- Desvio del plano: el plano pedia `dedupe_key = eod-reminder:<form>:<user>:<fecha>` en la
-- cola; aca la cola lleva uno por reporte y franja, y "un aviso por persona y dia" lo
-- garantiza el barrido mirando los avisos ya mandados (metadata.report_date).
--
-- No usa `private.call_app_cron` (patron 00146/00167): el cron de jobs que ya existe
-- procesa la cola.
--
-- Como volver atras:
--   SELECT cron.unschedule('eod-reminders-enqueue');
--   DROP FUNCTION IF EXISTS private.enqueue_eod_reminders();
--   UPDATE public.scheduled_jobs SET status = 'cancelled' WHERE type = 'eod_reminder_sweep' AND status = 'pending';
-- Riesgo: bajo (aditiva; sin reportes con recordatorio, no encola nada).
-- ============================================================================

SET search_path = '';

CREATE OR REPLACE FUNCTION private.enqueue_eod_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_form record;
  v_slot bigint := floor(extract(epoch FROM now()) / 900);
  v_enqueued integer := 0;
BEGIN
  FOR v_form IN
    SELECT f.id
    FROM public.forms f
    WHERE f.type = 'eod'
      AND f.status = 'published'
      AND f.current_version_id IS NOT NULL
      AND COALESCE((f.eod_config -> 'reminder' ->> 'enabled')::boolean, false)
  LOOP
    BEGIN
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES (
        'eod_reminder_sweep',
        jsonb_build_object('form_id', v_form.id),
        now(),
        'eod-reminder:' || v_form.id::text || ':' || v_slot::text
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_eod_reminders: no pude encolar el reporte %: %', v_form.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_enqueued;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_eod_reminders() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'eod-reminders-enqueue') THEN
    PERFORM cron.unschedule('eod-reminders-enqueue');
  END IF;
END $$;

SELECT cron.schedule('eod-reminders-enqueue', '*/15 * * * *', $$SELECT private.enqueue_eod_reminders()$$);
