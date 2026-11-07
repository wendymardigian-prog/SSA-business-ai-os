-- ============================================================================
-- 00321_agent_runs_source_designer  (Diseñador IA, D3)
-- ============================================================================
-- El CHECK de `agent_runs.source` suma 'designer': los costos de IA del Diseñador IA se registran como
-- cualquier corrida (`openAiRun`), aparecen en Costos como «Diseñador IA» y respetan los topes del negocio.
-- Todos los valores que ya existen siguen valiendo. `lib/agent/run-labels.test.ts` compara la lista con
-- `RUN_SOURCE_LABELS`, y `AGENT_RUN_SOURCES` no compila si le falta uno de `AgentRunSource`.
--
-- CHECK vigente en la base antes de esta migración (leído con pg_get_constraintdef el 7/11/2026):
--   CHECK ((source = ANY (ARRAY['agent'::text, 'flow_ai_node'::text, 'sequence_ai_step'::text,
--     'kb_indexing'::text, 'conversation_summary'::text, 'message_classification'::text,
--     'message_classification_eval'::text, 'content_copy'::text, 'ads_analysis'::text,
--     'audio_transcription'::text, 'media_description'::text, 'call_classification'::text,
--     'call_analysis'::text, 'call_correction'::text, 'call_summary'::text, 'call_prompt_test'::text])))
--
-- Cómo volver atrás (primero, que no quede ninguna corrida `designer`:
--   UPDATE public.agent_runs SET source = 'flow_ai_node' WHERE source = 'designer';  -- o borrarlas):
--   ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;
--   ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_check
--     CHECK (source = ANY (ARRAY['agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing',
--       'conversation_summary', 'message_classification', 'message_classification_eval', 'content_copy',
--       'ads_analysis', 'audio_transcription', 'media_description', 'call_classification', 'call_analysis',
--       'call_correction', 'call_summary', 'call_prompt_test']));
--
-- Riesgo: alto (cambia un CHECK existente), pero el nuevo es un superconjunto del viejo. Va ANTES del deploy.
-- Idempotente: si el CHECK ya tiene 'designer', no hace nada.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_source_check'
      AND conrelid = 'public.agent_runs'::regclass
      AND pg_get_constraintdef(oid) LIKE '%''designer''%'
  ) THEN
    ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;
    ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_check
      CHECK (source = ANY (ARRAY[
        'agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing', 'conversation_summary',
        'message_classification', 'message_classification_eval', 'content_copy', 'ads_analysis',
        'audio_transcription', 'media_description',
        'call_classification', 'call_analysis', 'call_correction', 'call_summary', 'call_prompt_test',
        'designer'
      ]));
  END IF;
END $$;
