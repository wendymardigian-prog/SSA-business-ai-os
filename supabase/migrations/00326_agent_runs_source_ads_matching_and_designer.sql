-- 00326_agent_runs_source_ads_matching_and_designer
--
-- Arregla una regresión: la 00318 (conciliación de anuncios) sumó 'ads_matching' al CHECK de `agent_runs.source`, y la
-- 00321 (Diseñador IA), aplicada 17 minutos después, redefinió el mismo CHECK copiando la versión de la 00148 más
-- 'designer', sin 'ads_matching'. Desde entonces una corrida de IA de la conciliación no se puede guardar. Esta
-- migración deja el CHECK con TODOS los valores: los de la 00148, 'ads_matching' (00318) y 'designer' (00321).
--
-- Aditiva: solo agranda la lista. Puede ir antes o después del deploy. Idempotente.
--
-- CHECK vigente antes de esta migración (leído de la base el 8/11/2026):
--   CHECK ((source = ANY (ARRAY['agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing', 'conversation_summary',
--     'message_classification', 'message_classification_eval', 'content_copy', 'ads_analysis', 'audio_transcription',
--     'media_description', 'call_classification', 'call_analysis', 'call_correction', 'call_summary', 'call_prompt_test',
--     'designer'])))
--
-- Cómo volver atrás: volver a crear el CHECK de arriba (sin 'ads_matching'); no conviene: rompe la conciliación.

DO $$
BEGIN
  ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;
  ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_check
    CHECK (source = ANY (ARRAY[
      'agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing', 'conversation_summary', 'message_classification',
      'message_classification_eval', 'content_copy', 'ads_analysis', 'audio_transcription', 'media_description',
      'call_classification', 'call_analysis', 'call_correction', 'call_summary', 'call_prompt_test',
      'ads_matching', 'designer'
    ]));
END $$;
