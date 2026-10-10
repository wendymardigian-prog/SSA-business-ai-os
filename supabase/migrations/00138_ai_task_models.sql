-- ============================================================================
-- 00138 — Modelo propio por tarea de IA, y el Análisis de anuncios como tarea
-- ============================================================================
-- "Analizar con IA" (dashboard de Meta Ads) pasa a ser una tarea de Agentes IA
-- (lib/ai-tasks/catalog.ts: `ads_analysis`), con instrucciones versionadas y
-- el modelo elegible.
--
-- 1. `workspaces.ai_task_models`: el modelo que el negocio eligio para una
--    tarea, por id de tarea: {"ads_analysis": {"provider": "anthropic",
--    "model": "claude-haiku-4-5"}}. Una tarea sin entrada (el caso de todos
--    hoy) usa el modelo por defecto del negocio, igual que antes. Es un jsonb
--    y no una columna por tarea para que sumar otra tarea no pida otra
--    migracion.
--
-- 2. El CHECK de `ai_task_prompt_versions.task` (00137) admite tambien
--    'ads_analysis'.
--
-- Aditiva e idempotente: no borra ni cambia nada de lo que ya corre, asi que
-- se puede aplicar antes de desplegar el codigo.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS ai_task_models jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.workspaces.ai_task_models IS
  'Modelo elegido por tarea de IA: {"<tarea>": {"provider": "...", "model": "..."}}. Sin entrada: el modelo por defecto del negocio.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_task_prompt_versions_task_check'
      AND pg_get_constraintdef(oid) LIKE '%ads_analysis%'
  ) THEN
    ALTER TABLE public.ai_task_prompt_versions
      DROP CONSTRAINT IF EXISTS ai_task_prompt_versions_task_check;
    ALTER TABLE public.ai_task_prompt_versions
      ADD CONSTRAINT ai_task_prompt_versions_task_check
      CHECK (task IN ('message_classification', 'conversation_summary', 'media_description', 'ads_analysis'));
  END IF;
END $$;
