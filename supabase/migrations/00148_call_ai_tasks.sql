-- ============================================================================
-- 00148 — Llamadas: las tareas de IA del analisis y como se guarda su configuracion
-- ============================================================================
-- Llamadas suma tres tareas de IA al catalogo (Clasificacion, Analisis y
-- Resumen de llamadas) y cuatro tipos de corrida mas (correccion, prueba del
-- borrador y las propias de cada tarea). Esta migracion:
--
--   1. Amplia el CHECK de `agent_runs.source`: + call_classification,
--      call_analysis, call_correction, call_summary, call_prompt_test.
--      (Lista leida de la base al escribirla; nada se borra.)
--   2. Amplia el CHECK de `ai_task_prompt_versions.task`: + call_classification,
--      call_analysis, call_summary. `lib/ai-tasks/store.test.ts` lee esta
--      migracion y compara la lista con el catalogo.
--   3. `set_ai_background_task_settings(p_workspace_id, p_task, p_value)`:
--      escribe la configuracion de UNA tarea dentro de
--      `workspaces.ai_background_settings` (jsonb_set de una sola clave), sin
--      pisar las demas, y devuelve lo que habia antes (para la auditoria). Solo
--      acepta call_classification y call_analysis. Solo `service_role`.
--
-- NO se crea ninguna tabla. Aditiva (los CHECK conservan todos sus valores) e
-- idempotente. Se puede aplicar antes de desplegar: el codigo viejo no lee nada
-- de esto.
--
-- Como volver atras (solo si no hay corridas ni versiones de las tareas nuevas):
--   ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;
--   ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_check
--     CHECK (source = ANY (ARRAY['agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing',
--       'conversation_summary', 'message_classification', 'message_classification_eval',
--       'content_copy', 'ads_analysis', 'audio_transcription', 'media_description']));
--   ALTER TABLE public.ai_task_prompt_versions DROP CONSTRAINT IF EXISTS ai_task_prompt_versions_task_check;
--   ALTER TABLE public.ai_task_prompt_versions ADD CONSTRAINT ai_task_prompt_versions_task_check
--     CHECK (task IN ('message_classification', 'conversation_summary', 'close_classification', 'media_description', 'ads_analysis'));
--   DROP FUNCTION IF EXISTS public.set_ai_background_task_settings(uuid, text, jsonb);
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_source_check'
      AND conrelid = 'public.agent_runs'::regclass
      AND pg_get_constraintdef(oid) LIKE '%call_analysis%'
  ) THEN
    ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;
    ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_check
      CHECK (source = ANY (ARRAY[
        'agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing', 'conversation_summary',
        'message_classification', 'message_classification_eval', 'content_copy', 'ads_analysis',
        'audio_transcription', 'media_description',
        'call_classification', 'call_analysis', 'call_correction', 'call_summary', 'call_prompt_test'
      ]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_task_prompt_versions_task_check'
      AND conrelid = 'public.ai_task_prompt_versions'::regclass
      AND pg_get_constraintdef(oid) LIKE '%call_analysis%'
  ) THEN
    ALTER TABLE public.ai_task_prompt_versions DROP CONSTRAINT IF EXISTS ai_task_prompt_versions_task_check;
    ALTER TABLE public.ai_task_prompt_versions
      ADD CONSTRAINT ai_task_prompt_versions_task_check
      CHECK (task IN ('message_classification', 'conversation_summary', 'close_classification', 'media_description', 'ads_analysis', 'call_classification', 'call_analysis', 'call_summary'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_ai_background_task_settings(p_workspace_id uuid, p_task text, p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old jsonb;
BEGIN
  IF p_task NOT IN ('call_classification', 'call_analysis') THEN
    RAISE EXCEPTION 'tarea no admitida: %', p_task USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT ai_background_settings -> p_task INTO v_old
    FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace inexistente' USING ERRCODE = 'no_data_found';
  END IF;

  -- Solo esa clave: las demas tareas quedan como estaban.
  UPDATE public.workspaces
     SET ai_background_settings = jsonb_set(COALESCE(ai_background_settings, '{}'::jsonb), ARRAY[p_task], p_value, true)
   WHERE id = p_workspace_id;

  RETURN v_old;
END;
$$;

REVOKE ALL ON FUNCTION public.set_ai_background_task_settings(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_ai_background_task_settings(uuid, text, jsonb) TO service_role;
