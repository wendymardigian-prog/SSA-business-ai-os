-- ============================================================
-- 00537_tasks_live_session.sql
-- ============================================================
-- Calendario del programa: una tarea puede ser de UNA clase en vivo (una fecha de una sesion del portal).
--
--   * `tasks.live_session_id` (uuid SIN clave foranea, como `tasks.service_id`: la sesion vive en `app_servicio` y una
--     tarea nunca falla por el modulo) y `tasks.live_session_on` (la fecha ORIGINAL de la clase, la misma clave que
--     `app_servicio.live_session_dates.occurs_on`: mover una clase no la cambia).
--   * Van los dos o ninguno (CHECK).
--   * No se escriben con la sesion: las escribe el servidor (Server Actions con el cliente de servicio despues de mirar
--     el permiso y que la sesion sea del negocio). `authenticated` las LEE con el GRANT SELECT de la tabla (00196) y la
--     RLS de siempre (`can_see_task`).
--
-- Aditiva: puede ir antes o despues del deploy (sin ella, crear una tarea desde una clase falla y el resto anda).
-- Como volver atras:
--   DROP INDEX IF EXISTS public.idx_tasks_live_session;
--   ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_live_session_check;
--   ALTER TABLE public.tasks DROP COLUMN IF EXISTS live_session_id, DROP COLUMN IF EXISTS live_session_on;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS live_session_id uuid;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS live_session_on date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_live_session_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_live_session_check
      CHECK ((live_session_id IS NULL) = (live_session_on IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.tasks.live_session_id IS
  'La sesion en vivo del portal (app_servicio.live_sessions) de la que es la tarea. Sin clave foranea a proposito.';
COMMENT ON COLUMN public.tasks.live_session_on IS
  'La fecha original de esa clase (app_servicio.live_session_dates.occurs_on). Va junto con live_session_id.';

CREATE INDEX IF NOT EXISTS idx_tasks_live_session ON public.tasks (workspace_id, live_session_id, live_session_on)
  WHERE live_session_id IS NOT NULL AND deleted_at IS NULL;
