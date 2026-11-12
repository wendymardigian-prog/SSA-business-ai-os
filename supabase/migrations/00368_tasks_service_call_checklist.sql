-- ============================================================
-- 00368_tasks_service_call_checklist.sql
-- ============================================================
-- Servicios A4 (plano: A4-M3), F152, F153 y F155:
--
--   * `tasks.service_id` (uuid SIN clave foranea, como `calls.service_id`: lo valida el modulo; una tarea nunca falla
--     por el modulo, regla del 8/11), `tasks.call_id` (clave foranea a `calls`, ON DELETE SET NULL) y
--     `tasks.checklist` (`[]`, los puntos del paso del camino y los que se suman a mano; hasta 30).
--   * El CHECK de `tasks.source` suma 'call' (una tarea que sale de una reunion). Se arma desde el que esta EN LA BASE,
--     sin sacar ningun valor. El indice unico `uq_tasks_auto_source_open` NO cambia (sigue cubriendo flow y agent).
--   * Completa `service_id` en las tareas del camino que ya existen (`source = 'cx'`, `source_ref = 'svc_item:<id>'`)
--     con el servicio de ese paso. Las demas quedan en NULL.
--   * Las tres columnas nuevas NO se escriben con la sesion: las escribe el servidor (Server Actions con el cliente de
--     servicio despues de mirar el permiso). `authenticated` las LEE (la RLS de siempre, `can_see_task`).
--
-- Modifica estructura (CHECK) y datos (backfill). Como volver atras:
--   UPDATE public.tasks SET service_id = NULL WHERE source = 'cx';                       -- el backfill
--   UPDATE public.tasks SET source = 'manual' WHERE source = 'call';                     -- solo si hay alguna
--   ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
--   ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check CHECK (source IN ('manual','flow','agent','cx'));
--   DROP INDEX IF EXISTS public.idx_tasks_service, public.idx_tasks_call;
--   ALTER TABLE public.tasks DROP COLUMN IF EXISTS service_id, DROP COLUMN IF EXISTS call_id, DROP COLUMN IF EXISTS checklist;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS service_id uuid;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS call_id uuid REFERENCES public.calls(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_checklist_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_checklist_check
      CHECK (jsonb_typeof(checklist) = 'array' AND jsonb_array_length(checklist) <= 30);
  END IF;
END $$;

COMMENT ON COLUMN public.tasks.service_id IS
  'El servicio de la tarea (Servicios A4, F152). Sin clave foranea a proposito: lo valida el modulo (regla del 8/11).';
COMMENT ON COLUMN public.tasks.call_id IS 'La reunion de la que sale la tarea (F152, F155).';
COMMENT ON COLUMN public.tasks.checklist IS '[{id, text, done, done_by?, done_at?}] hasta 30 (F148, F153). No impide completar la tarea.';

-- El CHECK de source, ampliado desde el vigente (nunca se achica).
DO $$
DECLARE
  v_def text;
  v_vals text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.tasks'::regclass AND c.conname = 'tasks_source_check';
  IF v_def IS NULL THEN
    v_vals := ARRAY['manual','flow','agent','cx'];
  ELSE
    SELECT array_agg(m[1] ORDER BY ord) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') WITH ORDINALITY AS t(m, ord);
  END IF;
  IF 'call' = ANY (v_vals) THEN RETURN; END IF;
  v_vals := array_append(v_vals, 'call');
  ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
  EXECUTE format('ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check CHECK (source = ANY (ARRAY[%s]))',
    (SELECT string_agg(quote_literal(v) || '::text', ', ') FROM unnest(v_vals) AS v));
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_service ON public.tasks (workspace_id, service_id) WHERE service_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_call ON public.tasks (call_id) WHERE call_id IS NOT NULL;

-- Las tareas del camino que ya existen: el servicio de su paso.
UPDATE public.tasks t
   SET service_id = i.service_id
  FROM app_servicio.service_items i
 WHERE t.source = 'cx'
   AND t.source_ref LIKE 'svc\_item:%'
   AND t.service_id IS NULL
   AND i.id = substr(t.source_ref, 10)::uuid
   AND i.workspace_id = t.workspace_id;
