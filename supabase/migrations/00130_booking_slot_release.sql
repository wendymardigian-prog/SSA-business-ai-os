-- 00130: liberar espacio (Agenda v2).
--
-- Aditiva. Una agenda liberada sigue existiendo, activa, con su lead y su
-- link de Meet: lo unico que cambia es que su horario deja de contar como
-- ocupado, para que el equipo pueda agendar otro lead en el mismo lugar
-- mientras este no se confirma (por ejemplo, mientras se espera saber si
-- descalifica). Volver a ocupar lo mismo lo revierte.
--
-- 1. `slot_released_at`/`slot_released_by`: cuando se libero y quien. NULL de
--    toda la vida de una agenda que nunca se libero.
-- 2. `bookings_no_overlap` (00099) se recrea para excluir las liberadas: dos
--    agendas activas siguen sin poder pisarse, salvo que una este liberada.
-- 3. `google_host_connection_id`/`google_host_calendar_id`: a nombre de QUIEN
--    esta sincronizado el evento hoy. Antes de reasignar (bloque D) siempre
--    es la conexion del propio anfitrion (`google_connection_id`); estas dos
--    columnas quedan listas para cuando reasignar las corra a las del nuevo
--    anfitrion sin tocar `google_connection_id` (que sigue siendo el
--    organizador real en Google).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS slot_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS slot_released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS google_host_connection_id uuid REFERENCES public.oauth_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS google_host_calendar_id uuid REFERENCES public.calendars(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') THEN
    ALTER TABLE public.bookings DROP CONSTRAINT bookings_no_overlap;
  END IF;
  ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (
      host_user_id WITH =,
      tstzrange(start_at, end_at) WITH &&
    ) WHERE (status IN ('scheduled', 'confirmed', 'rescheduled') AND slot_released_at IS NULL);
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_slot_released
  ON public.bookings (host_user_id, start_at) WHERE slot_released_at IS NOT NULL;
