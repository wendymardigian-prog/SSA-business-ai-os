-- 00510_google_calendar_events.sql · Agenda: los eventos de Google Calendar en la Agenda (20/11/2026)
--
-- La Agenda muestra, deja editar e importa los eventos de Google Calendar de cada persona. Aditiva e idempotente;
-- va ANTES de desplegar el código (la Agenda y el lector leen estas columnas).
--
--   1. `calendars.show_in_agenda` («Mostrar en Agenda», solo el principal arranca prendido), `events_synced_at`
--      (última lectura de la copia) y `events_sync_lock_until` (para que dos lecturas del mismo calendario no se pisen).
--   2. `google_calendar_events`: la copia de los eventos de los calendarios con «Mostrar en Agenda», de 60 días atrás a
--      12 meses adelante. La escribe SOLO el servidor (el lector `google_calendar_inbound`); la ve SOLO su dueño.
--      Sin `contact_id` a propósito: la fusión de contactos no la toca. Se borra sola con su calendario (CASCADE).
--   3. `google_busy_blocks(...)`: lo único que ve otra persona del equipo de los eventos de Google de alguien: el
--      horario ocupado, sin título ni invitados. Solo Owner, Admin, `scheduling.manage_others` o `bookings.view` con
--      alcance `all` (las mismas personas que ya ven la agenda de otros).
--   4. `private.enqueue_google_calendar_inbound()`: suma los calendarios con «Mostrar en Agenda» (y el permiso de
--      eventos) a los que ya leía (los que tienen reuniones de la plataforma). Copia la definición de la 00430.
--   5. Un índice único parcial en `bookings (google_calendar_id, google_event_id)`: un evento de Google es de UNA
--      reunión viva. Si ya hubiera duplicados no se crea (NOTICE) y se anota.
--
-- Volver atrás:
--   DROP FUNCTION IF EXISTS public.google_busy_blocks(uuid, uuid[], timestamptz, timestamptz);
--   DROP TABLE IF EXISTS public.google_calendar_events;
--   DROP INDEX IF EXISTS public.uq_bookings_google_event_live;
--   ALTER TABLE public.calendars DROP COLUMN IF EXISTS show_in_agenda, DROP COLUMN IF EXISTS events_synced_at,
--     DROP COLUMN IF EXISTS events_sync_lock_until;
--   y `private.enqueue_google_calendar_inbound()` como en la 00430.

-- ------------------------------------------------------------
-- 1. calendars
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendars' AND column_name = 'show_in_agenda'
  ) THEN
    ALTER TABLE public.calendars ADD COLUMN show_in_agenda boolean NOT NULL DEFAULT false;
    -- Solo la primera vez: el principal de cada cuenta que puede leer eventos arranca prendido.
    UPDATE public.calendars c
       SET show_in_agenda = true
      FROM public.oauth_connections oc
     WHERE oc.id = c.connection_id
       AND c.is_primary
       AND c.is_active
       AND 'https://www.googleapis.com/auth/calendar.events' = ANY (oc.granted_scopes);
  END IF;
END $$;

ALTER TABLE public.calendars ADD COLUMN IF NOT EXISTS events_synced_at timestamptz;
ALTER TABLE public.calendars ADD COLUMN IF NOT EXISTS events_sync_lock_until timestamptz;

COMMENT ON COLUMN public.calendars.show_in_agenda IS
  '00510: «Mostrar en Agenda». Sus eventos se copian a google_calendar_events y se ven en el calendario de la Agenda.';
COMMENT ON COLUMN public.calendars.events_synced_at IS
  '00510: última lectura completa o incremental de la copia de eventos. NULL = falta la primera lectura (60 días atrás).';
COMMENT ON COLUMN public.calendars.events_sync_lock_until IS
  '00510: candado de la lectura (cron y «Actualizar» no leen a la vez el mismo calendario).';

-- ------------------------------------------------------------
-- 2. google_calendar_events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.google_calendar_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id         uuid NOT NULL REFERENCES public.oauth_connections(id) ON DELETE CASCADE,
  calendar_id           uuid NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
  external_event_id     text NOT NULL,
  recurring_event_id    text,
  ical_uid              text,
  etag                  text,
  status                text NOT NULL DEFAULT 'confirmed',
  summary               text,
  description           text,
  location              text,
  html_link             text,
  meet_url              text,
  organizer_email       text,
  organizer_self        boolean NOT NULL DEFAULT false,
  attendees             jsonb NOT NULL DEFAULT '[]'::jsonb,
  self_response_status  text,
  guests_can_modify     boolean NOT NULL DEFAULT false,
  -- Con hora: el instante. De todo el día: la medianoche UTC de start_date / end_date (sirve para buscar por rango).
  start_at              timestamptz NOT NULL,
  end_at                timestamptz NOT NULL,
  all_day               boolean NOT NULL DEFAULT false,
  -- Solo de todo el día: la fecha civil (end_date es exclusiva, como en Google).
  start_date            date,
  end_date              date,
  time_zone             text,
  transparency          text NOT NULL DEFAULT 'opaque',
  google_event_type     text NOT NULL DEFAULT 'default',
  -- Si el evento es de una reunión de la plataforma (creada acá o pasada al sistema): la Agenda la muestra como reunión.
  booking_id            uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  -- Mientras se pasa al sistema: el reclamo que evita que un doble clic cree dos reuniones.
  importing_until       timestamptz,
  google_updated_at     timestamptz,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.google_calendar_events IS
  '00510: copia de los eventos de Google Calendar de los calendarios con «Mostrar en Agenda». La escribe solo el servidor; la ve solo su dueño (otros: google_busy_blocks).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_calendar_events_status_check') THEN
    ALTER TABLE public.google_calendar_events ADD CONSTRAINT google_calendar_events_status_check
      CHECK (status IN ('confirmed', 'tentative', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_calendar_events_transparency_check') THEN
    ALTER TABLE public.google_calendar_events ADD CONSTRAINT google_calendar_events_transparency_check
      CHECK (transparency IN ('opaque', 'transparent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_calendar_events_range_check') THEN
    ALTER TABLE public.google_calendar_events ADD CONSTRAINT google_calendar_events_range_check
      CHECK (end_at >= start_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_calendar_events_all_day_check') THEN
    ALTER TABLE public.google_calendar_events ADD CONSTRAINT google_calendar_events_all_day_check
      CHECK ((all_day AND start_date IS NOT NULL AND end_date IS NOT NULL) OR (NOT all_day));
  END IF;
END $$;

ALTER TABLE public.google_calendar_events ADD COLUMN IF NOT EXISTS importing_until timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_google_calendar_events_calendar_event
  ON public.google_calendar_events (calendar_id, external_event_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_owner_range
  ON public.google_calendar_events (workspace_id, user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_booking
  ON public.google_calendar_events (booking_id) WHERE booking_id IS NOT NULL;

ALTER TABLE public.google_calendar_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.google_calendar_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.google_calendar_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_calendar_events TO service_role;

-- Solo su dueño. Sin políticas de escritura: escribe el servidor (service_role).
DROP POLICY IF EXISTS google_calendar_events_select_own ON public.google_calendar_events;
CREATE POLICY google_calendar_events_select_own ON public.google_calendar_events
  FOR SELECT USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

-- ------------------------------------------------------------
-- 3. google_busy_blocks: el «Ocupado» de otras personas
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.google_busy_blocks(
  p_workspace_id uuid,
  p_user_ids uuid[],
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (user_id uuid, start_at timestamptz, end_at timestamptz, all_day boolean, start_date date, end_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.user_id, e.start_at, e.end_at, e.all_day, e.start_date, e.end_date
    FROM public.google_calendar_events e
   WHERE e.workspace_id = p_workspace_id
     AND e.user_id = ANY (p_user_ids)
     AND e.user_id IS DISTINCT FROM auth.uid()
     AND e.booking_id IS NULL
     AND e.status <> 'cancelled'
     AND e.transparency = 'opaque'
     AND e.self_response_status IS DISTINCT FROM 'declined'
     AND e.google_event_type <> 'workingLocation'
     AND e.start_at < p_to
     AND e.end_at > p_from
     AND public.is_workspace_member(p_workspace_id)
     AND (
       public.is_workspace_admin(p_workspace_id)
       OR public.has_permission(p_workspace_id, 'scheduling.manage_others')
       OR (
         public.has_permission(p_workspace_id, 'bookings.view')
         AND public.permission_scope(p_workspace_id, 'bookings') = 'all'
       )
     )
   ORDER BY e.start_at
   LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION public.google_busy_blocks(uuid, uuid[], timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.google_busy_blocks(uuid, uuid[], timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.google_busy_blocks(uuid, uuid[], timestamptz, timestamptz) IS
  '00510: el horario ocupado (sin título ni invitados) de los eventos de Google de otras personas, para quien ya ve sus agendas.';

-- ------------------------------------------------------------
-- 4. El lector cada 5 minutos también lee los calendarios con «Mostrar en Agenda»
--    (copia de la 00430 con la condición nueva).
-- ------------------------------------------------------------
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
      AND (
        EXISTS (
          SELECT 1 FROM public.bookings b
          WHERE b.google_calendar_id = c.id
            AND b.google_event_id IS NOT NULL
            AND b.status_group = 'active'
            AND b.end_at > now() - interval '24 hours'
        )
        -- 00510: los que se muestran en la Agenda (con permiso para leer eventos).
        OR (
          c.show_in_agenda
          AND 'https://www.googleapis.com/auth/calendar.events' = ANY (oc.granted_scopes)
        )
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
  '00430, 00510: encola la lectura de cada Google Calendar con reuniones de la plataforma o con «Mostrar en Agenda» (lib/jobs/handlers/google-calendar-inbound.ts).';

-- ------------------------------------------------------------
-- 5. Un evento de Google es de una sola reunión viva
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_bookings_google_event_live') THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.bookings
     WHERE google_event_id IS NOT NULL AND google_calendar_id IS NOT NULL AND status_group <> 'cancelled'
     GROUP BY google_calendar_id, google_event_id
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE '00510: hay reuniones vivas que comparten evento de Google; no se crea uq_bookings_google_event_live';
    RETURN;
  END IF;
  CREATE UNIQUE INDEX uq_bookings_google_event_live
    ON public.bookings (google_calendar_id, google_event_id)
    WHERE google_event_id IS NOT NULL AND google_calendar_id IS NOT NULL AND status_group <> 'cancelled';
END $$;
