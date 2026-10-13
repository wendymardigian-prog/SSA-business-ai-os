-- ============================================================================
-- 00206 — Tareas × CRM (M1): hora y duracion opcionales, y el seguimiento unico por contacto y fecha
-- ============================================================================
-- Sobre `public.tasks`. Aditiva: las filas que ya existen quedan con `due_time` y `duration_minutes` en null (solo
-- fecha, como hasta ahora). No hay backfill. Ninguna funcion existente cambia: `tasks_before_write`,
-- `complete_task_with_shifts`, `delete_task` y `set_task_blockers` no listan columnas, asi que no se enteran.
--
--   1. `due_time time` y `duration_minutes integer`, los dos opcionales.
--   2. Restricciones: la hora solo puede existir si hay `due_date` (si la fecha se borra, la hora y la duracion
--      tambien: la accion lo hace y la base lo exige) y la duracion va de 5 a 1440 minutos.
--   3. Privilegios por columna: la sesion de la persona puede escribir las dos columnas nuevas al crear y al editar.
--      (Sin esto el editor fallaria en silencio: `tasks` solo deja escribir las columnas que se listan.)
--   4. `uq_tasks_followup`: una sola tarea de seguimiento por contacto y fecha (`source_ref = 'followup:AAAA-MM-DD'`),
--      incluidas las completadas a proposito. Parcial: una tarea borrada (`deleted_at`) libera la fecha. Antes de
--      crearlo se comprueba que ninguna fila lo viole.
--
-- Como volver atras (las columnas nuevas pierden lo que tengan guardado):
--   DROP INDEX IF EXISTS public.uq_tasks_followup;
--   ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_due_time_needs_date;
--   ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_duration_range;
--   ALTER TABLE public.tasks DROP COLUMN IF EXISTS due_time;
--   ALTER TABLE public.tasks DROP COLUMN IF EXISTS duration_minutes;
--   -- Los GRANT por columna se van con las columnas.
-- Riesgo: bajo.
-- ============================================================================

SET search_path = '';

-- 1. Las columnas.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_time time;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS duration_minutes integer;

-- 2. Las restricciones.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_due_time_needs_date' AND conrelid = 'public.tasks'::regclass) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_due_time_needs_date CHECK (due_time IS NULL OR due_date IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_duration_range' AND conrelid = 'public.tasks'::regclass) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_duration_range CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 1440);
  END IF;
END $$;

-- 3. Privilegios por columna (los demas GRANT de la 00196 no se tocan).
GRANT INSERT (due_time, duration_minutes) ON public.tasks TO authenticated;
GRANT UPDATE (due_time, duration_minutes) ON public.tasks TO authenticated;

-- 4. El seguimiento unico. Primero se comprueba que no haya duplicados que lo violen.
DO $$
DECLARE
  v_dups integer;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT 1
      FROM public.tasks
     WHERE source_ref LIKE 'followup:%' AND deleted_at IS NULL
     GROUP BY workspace_id, contact_id, source_ref
    HAVING count(*) > 1
  ) d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'No se puede crear uq_tasks_followup: hay % seguimientos duplicados', v_dups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_followup
  ON public.tasks (workspace_id, contact_id, source_ref)
  WHERE source_ref LIKE 'followup:%' AND deleted_at IS NULL;
