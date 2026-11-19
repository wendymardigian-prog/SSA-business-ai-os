-- ============================================================================
-- 00444 · El asistente del equipo: botón flotante, panel acoplado y pantalla completa (traído de RER: 00442)
-- ============================================================================
-- Aditiva e idempotente. Va ANTES de desplegar el código.
--
-- Las corridas del asistente quedan en agent_runs con su propio origen ('assistant') y con su agente (type
-- 'assistant', uno por negocio, nace apagado). La conversación vive en ai_threads / ai_messages (canal 'assistant',
-- ya permitido por la 00320, con su RLS: solo la persona dueña del hilo la lee). Las escrituras que pide la IA quedan
-- como propuestas en ai_proposals (00441): no hace falta tabla nueva.
--
-- Suma:
--   1. 'assistant' a agent_runs_source_check y a agent_runs_agent_only_for_agent_sources (copia de la 00395 + uno).
--   2. Un asistente por negocio: índice único parcial sobre agents (type = 'assistant', sin borrar).
--   3. Índice para abrir rápido el hilo vigente de cada persona (user_id, canal, último mensaje).
--   4. El asistente APAGADO en cada negocio que todavía no tiene uno, sin modelo (usa el del negocio), sin
--      instrucciones propias (usa las de serie, que viven en el código: lib/assistant/agent.ts) y sin herramientas
--      elegidas (ofrece todas). Nunca prende nada. Los negocios nuevos lo reciben con `ensureDefaultAgents`.
--
-- OJO al unir con otras ramas: si otra migración también redefine estos dos CHECK, el que se aplique último manda.
-- Hay que partir del CHECK vigente en la base y SUMAR, nunca copiar uno viejo.
--
-- Volver atrás: recrear los dos CHECK sin 'assistant' (copia de la 00395), DROP INDEX uq_agents_one_assistant y
-- DROP INDEX idx_ai_threads_user_channel y borrar los agentes type 'assistant'. Antes, borrar o cambiar de origen las corridas 'assistant'.
-- Riesgo: alto por los CHECK de agent_runs (tabla en uso): solo se SUMA un valor; todo lo que ya existe sigue valiendo.
-- ============================================================================

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_check CHECK ((source = ANY (ARRAY['agent'::text, 'flow_ai_node'::text,
  'sequence_ai_step'::text, 'kb_indexing'::text, 'conversation_summary'::text, 'message_classification'::text,
  'message_classification_eval'::text, 'content_copy'::text, 'ads_analysis'::text, 'audio_transcription'::text,
  'media_description'::text, 'call_classification'::text, 'call_analysis'::text, 'call_correction'::text, 'call_summary'::text,
  'call_prompt_test'::text, 'ads_matching'::text, 'designer'::text, 'portal_tutor'::text, 'portal_project_review'::text,
  'assistant'::text])));
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_agent_only_for_agent_sources;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_agent_only_for_agent_sources CHECK (((agent_id IS NULL) OR (source = ANY (ARRAY['agent'::text,
  'conversation_summary'::text, 'content_copy'::text, 'portal_tutor'::text, 'portal_project_review'::text, 'assistant'::text]))));

CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_one_assistant
  ON public.agents (workspace_id) WHERE type = 'assistant' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_threads_user_channel ON public.ai_threads (user_id, channel, last_message_at DESC)
  WHERE user_id IS NOT NULL AND archived_at IS NULL;

INSERT INTO public.agents (workspace_id, name, type, is_enabled, system_prompt)
SELECT w.id, 'Asistente del equipo', 'assistant', false, ''
  FROM public.workspaces w
 WHERE NOT EXISTS (
   SELECT 1 FROM public.agents a WHERE a.workspace_id = w.id AND a.type = 'assistant' AND a.deleted_at IS NULL
 )
ON CONFLICT DO NOTHING;
