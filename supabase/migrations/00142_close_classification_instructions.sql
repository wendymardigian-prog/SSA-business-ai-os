-- ============================================================================
-- 00142 — Criterios editables para la Clasificación al cierre
-- ============================================================================
-- La Clasificación al cierre (tags, temperatura y seguimiento al cerrar una
-- conversación) no tenía instrucciones propias: solo tres líneas fijas en el
-- código. Ahora el negocio escribe sus criterios (cuándo poner o quitar cada
-- tag, qué es frío / tibio / caliente, cuándo agendar seguimiento) y se
-- versionan igual que las demás tareas (lib/ai-tasks/instructions.ts,
-- `CLOSE_CLASSIFICATION_DEFAULT_INSTRUCTIONS`).
--
-- Lo único que cambia en la base: el CHECK de `ai_task_prompt_versions.task`
-- (00137, ampliado en la 00138) admite también 'close_classification'.
-- Sin versión guardada, la tarea usa el texto del sistema, así que aplicar
-- esto no cambia nada de lo que ya corre.
--
-- Aditiva e idempotente.
--
-- Como volver atras (solo si no hay filas de close_classification):
--   ALTER TABLE public.ai_task_prompt_versions DROP CONSTRAINT IF EXISTS ai_task_prompt_versions_task_check;
--   ALTER TABLE public.ai_task_prompt_versions ADD CONSTRAINT ai_task_prompt_versions_task_check
--     CHECK (task IN ('message_classification', 'conversation_summary', 'media_description', 'ads_analysis'));
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_task_prompt_versions_task_check'
      AND pg_get_constraintdef(oid) LIKE '%close_classification%'
  ) THEN
    ALTER TABLE public.ai_task_prompt_versions
      DROP CONSTRAINT IF EXISTS ai_task_prompt_versions_task_check;
    ALTER TABLE public.ai_task_prompt_versions
      ADD CONSTRAINT ai_task_prompt_versions_task_check
      CHECK (task IN ('message_classification', 'conversation_summary', 'close_classification', 'media_description', 'ads_analysis'));
  END IF;
END $$;
