-- 00430_google_calendar_inbound.sql · Agenda: Google Calendar de ida y vuelta (18/11/2026)
--
-- Lo que quien atiende mueve o cancela en su Google Calendar se refleja en la plataforma (traído de RER-BAIOS).
-- Aditiva e idempotente (todo es CREATE OR REPLACE):
--   1. `private.enqueue_google_calendar_inbound()`: un job `google_calendar_inbound` por calendario de Google que
--      tiene reuniones de la plataforma por venir (o de las últimas 24 h), con la conexión activa. Uno pendiente por
--      calendario a la vez (dedupe_key).
--   2. una parte más de `private.cron_tick_5_minutes` (cron `every-5-minutes`, 00350), no un trabajo aparte.
-- No usa webhooks de Google: lee los cambios con `calendars.sync_token` (00095, sin uso hasta hoy) cada 5 minutos.
-- No crea tablas ni columnas. El job lo corre `lib/jobs/handlers/google-calendar-inbound.ts`.
--
-- OJO: redefine `private.cron_tick_5_minutes` partiendo de la 00350. Si otra migración posterior la redefine, tiene
-- que partir de ESTA definición (con el bloque `google-calendar-inbound`) para no perderlo.
--
-- Volver atrás: redefinir `private.cron_tick_5_minutes` como en la 00350 (sin el último bloque) y
-- `DROP FUNCTION IF EXISTS private.enqueue_google_calendar_inbound();`

CREATE OR REPLACE FUNCTION private.enqueue_google_calendar_inbound()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cal record;
  v_enqueued integer := 0;
BEGIN
  FOR v_cal IN
    SELECT c.id
    FROM public.calendars c
    JOIN public.oauth_connections oc ON oc.id = c.connection_id
    WHERE c.is_active
      AND oc.status IN ('active', 'attention')
      AND EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.google_calendar_id = c.id
          AND b.google_event_id IS NOT NULL
          AND b.status_group = 'active'
          AND b.end_at > now() - interval '24 hours'
      )
  LOOP
    BEGIN
      INSERT INTO public.scheduled_jobs (type, payload, run_at, status, dedupe_key)
      VALUES (
        'google_calendar_inbound',
        jsonb_build_object('calendar_id', v_cal.id),
        now(),
        'pending',
        'gcal-inbound:' || v_cal.id::text
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_google_calendar_inbound: no pude encolar el calendario %: %', v_cal.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_enqueued;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_google_calendar_inbound() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.enqueue_google_calendar_inbound() TO service_role;

COMMENT ON FUNCTION private.enqueue_google_calendar_inbound() IS
  '00430: encola la lectura de cambios de cada Google Calendar con reuniones de la plataforma (lib/jobs/handlers/google-calendar-inbound.ts).';

-- 2. Una parte más del cron de cada 5 minutos (00350: un trabajo por frecuencia, cada parte en su bloque).
--    Copia la definición de la 00350 y suma el bloque al final.
CREATE OR REPLACE FUNCTION private.cron_tick_5_minutes()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
SET lock_timeout TO '10s'
AS $$
BEGIN
  -- Primero se vencen los borradores cuya ventana ya cerro: los avisos y la
  -- guarda de drafts-refresh, que van despues, ya no los ven.
  BEGIN
    PERFORM private.sweep_agent_drafts();
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('agent-drafts-sweep', SQLERRM);
  END;

  BEGIN
    PERFORM private.alert_draft_windows();
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('draft-window-alerts', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('drafts-refresh', interval '1 hour');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('drafts-refresh', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('whatsapp-health', interval '1 hour');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('whatsapp-health', SQLERRM);
  END;

  -- 00430: encola la lectura de cambios de Google Calendar. Solo escribe en scheduled_jobs; los corre `jobs`.
  BEGIN
    PERFORM private.enqueue_google_calendar_inbound();
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('google-calendar-inbound', SQLERRM);
  END;
END;
$$;
REVOKE ALL ON FUNCTION private.cron_tick_5_minutes() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION private.cron_tick_5_minutes() IS
  'Cron every-5-minutes (00350, 00430): sweep_agent_drafts, alert_draft_windows, drafts-refresh, whatsapp-health y enqueue_google_calendar_inbound, cada uno en su bloque.';
