-- ============================================================================
-- 00085 — Generar copy con IA (Etapa 2, F29)
-- ============================================================================
-- Dos cosas, las dos aditivas:
--
--  1. `agent_runs.source` acepta dos fuentes nuevas: `content_copy` (generar
--     guion y caption) y `ads_analysis` (el "Analizar con IA" del bloque 7).
--     Toda llamada a un modelo pasa por openAiRun y queda registrada con su
--     costo; sin ampliar el CHECK, el registro falla y la generacion se cae
--     por un motivo que no tiene nada que ver.
--
--     La 00059 ademas exige que `agent_id` sea null salvo para `agent` y
--     `conversation_summary`. Las fuentes nuevas no tienen agente, asi que esa
--     regla ya las cubre y no hay que tocarla.
--
--  2. `workspaces.content_copy_settings`: la voz de marca. Es lo que hace que
--     el guion suene al negocio y no a un modelo generico, y es por workspace
--     porque cada negocio habla distinto.
--
-- Idempotente.
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;

  ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_source_check
    CHECK (source IN (
      'agent',
      'flow_ai_node',
      'sequence_ai_step',
      'kb_indexing',
      'conversation_summary',
      'message_classification',
      'message_classification_eval',
      -- Etapa 2
      'content_copy',
      'ads_analysis'
    ));
END $$;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS content_copy_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.workspaces.content_copy_settings IS
  'Voz de marca para generar copy: { voice, audience, examples[], avoid }. Vacio = se genera sin guia de estilo.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_content_copy_settings_object') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_content_copy_settings_object
      CHECK (jsonb_typeof(content_copy_settings) = 'object');
  END IF;
END $$;
