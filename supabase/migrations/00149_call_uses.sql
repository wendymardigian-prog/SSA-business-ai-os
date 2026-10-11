-- ============================================================================
-- 00149 — Llamadas: lo que se hace con lo analizado (triggers e ideas de contenido)
-- ============================================================================
-- Modulo Llamadas, bloque L3 (F29 y F32). Tres cambios, todos aditivos:
--
--   1. `triggers.type`: el CHECK suma `call_analyzed` y `call_linked` (los dos
--      disparadores de flujos de Llamadas). Conserva los 19 valores de antes.
--   2. `content_ideas.source`: el CHECK suma `call` (una idea que nace de una
--      llamada). Conserva `manual` y `agent`.
--   3. `content_ideas.call_id`: de que llamada salio la idea (ON DELETE SET
--      NULL: borrar la llamada no borra la idea) + indice parcial.
--
-- NO se toca ninguna funcion ni policy. Se puede aplicar antes de desplegar el
-- codigo: el codigo viejo no conoce ninguno de estos valores.
--
-- Como volver atras (solo si no hay triggers ni ideas con los valores nuevos):
--   ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
--   ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (type = ANY (ARRAY[
--     'keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword', 'new_contact',
--     'crm_event', 'inactivity', 'email_received', 'booking_created', 'booking_rescheduled',
--     'booking_cancelled', 'booking_updated', 'booking_ended', 'booking_status_changed',
--     'booking_before_start', 'booking_after_end', 'booking_after_created']));
--   ALTER TABLE public.content_ideas DROP CONSTRAINT IF EXISTS content_ideas_source_check;
--   ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_source_check
--     CHECK (source = ANY (ARRAY['manual', 'agent']));
--   DROP INDEX IF EXISTS public.idx_content_ideas_call;
--   ALTER TABLE public.content_ideas DROP COLUMN IF EXISTS call_id;
--   (antes: borrar los triggers con type call_* y las ideas con source = 'call')
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'triggers_type_check'
      AND conrelid = 'public.triggers'::regclass
      AND pg_get_constraintdef(oid) LIKE '%call_analyzed%'
  ) THEN
    ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
    ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (type = ANY (ARRAY[
      'keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword', 'new_contact',
      'crm_event', 'inactivity', 'email_received', 'booking_created', 'booking_rescheduled',
      'booking_cancelled', 'booking_updated', 'booking_ended', 'booking_status_changed',
      'booking_before_start', 'booking_after_end', 'booking_after_created',
      'call_analyzed', 'call_linked'
    ]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'content_ideas_source_check'
      AND conrelid = 'public.content_ideas'::regclass
      AND pg_get_constraintdef(oid) LIKE '%call%'
  ) THEN
    ALTER TABLE public.content_ideas DROP CONSTRAINT IF EXISTS content_ideas_source_check;
    ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_source_check
      CHECK (source = ANY (ARRAY['manual', 'agent', 'call']));
  END IF;
END $$;

ALTER TABLE public.content_ideas
  ADD COLUMN IF NOT EXISTS call_id uuid REFERENCES public.calls(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.content_ideas.call_id IS
  'La llamada de la que salio la idea (source = ''call''). ON DELETE SET NULL: borrar la llamada no borra la idea.';

CREATE INDEX IF NOT EXISTS idx_content_ideas_call
  ON public.content_ideas (call_id) WHERE call_id IS NOT NULL;
