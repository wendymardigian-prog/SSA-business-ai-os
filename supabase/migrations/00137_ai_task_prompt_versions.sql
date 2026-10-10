-- ============================================================================
-- 00137 — Instrucciones versionadas de las tareas de IA (Agentes IA)
-- ============================================================================
-- Agentes IA (pantalla unica de agentes + tareas). Mismo patron que
-- agent_prompt_versions (00058/00060): historial inmutable, solo Owner/Admin
-- lee y escribe, nadie actualiza ni borra una version ya guardada.
--
-- Solo se versiona la parte EDITABLE del prompt de cada tarea (que hacer, con
-- que criterio); la parte tecnica (anti-inyeccion, formato JSON que el codigo
-- parsea) sigue fija en el codigo y nunca sale de ahi (lib/ai-tasks/
-- instructions.ts). Sin version activa, la tarea usa el texto del sistema
-- (la "v0"): aditiva, no cambia nada de lo que ya corre.
--
-- Aditiva e idempotente.

-- ------------------------------------------------------------
-- 1. ai_task_prompt_versions
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_task_prompt_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- lib/ai-tasks/catalog.ts: las cuatro tareas con instrucciones editables.
  task          text NOT NULL,
  version       integer NOT NULL,
  instructions  text NOT NULL,
  note          text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_task_prompt_versions_task_check'
  ) THEN
    ALTER TABLE public.ai_task_prompt_versions
      ADD CONSTRAINT ai_task_prompt_versions_task_check
      CHECK (task IN ('message_classification', 'conversation_summary', 'media_description'));
  END IF;
END $$;

COMMENT ON TABLE public.ai_task_prompt_versions IS
  'Historial inmutable de las instrucciones (parte editable del prompt) de cada tarea de IA. Mismo patron que agent_prompt_versions.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_task_prompt_versions_workspace_task_version
  ON public.ai_task_prompt_versions(workspace_id, task, version);

-- ------------------------------------------------------------
-- 2. La version activa de cada tarea, por workspace.
-- ------------------------------------------------------------
-- {"message_classification": 2, "conversation_summary": 1}. Una tarea sin
-- entrada (el caso de hoy, para todos) usa el texto del sistema.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS ai_task_prompt_active jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ------------------------------------------------------------
-- 3. RLS: igual que agent_prompt_versions (00060). Owner/Admin leen e
--    insertan; nadie actualiza ni borra una version ya guardada.
-- ------------------------------------------------------------

ALTER TABLE public.ai_task_prompt_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_task_prompt_versions_select" ON public.ai_task_prompt_versions;
CREATE POLICY "ai_task_prompt_versions_select" ON public.ai_task_prompt_versions
  FOR SELECT USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "ai_task_prompt_versions_insert" ON public.ai_task_prompt_versions;
CREATE POLICY "ai_task_prompt_versions_insert" ON public.ai_task_prompt_versions
  FOR INSERT WITH CHECK (
    public.is_workspace_admin(workspace_id)
    AND created_by = auth.uid()
  );

-- Inmutable: sin policies de UPDATE ni DELETE, y sin el privilegio.
DROP POLICY IF EXISTS "ai_task_prompt_versions_update" ON public.ai_task_prompt_versions;
DROP POLICY IF EXISTS "ai_task_prompt_versions_delete" ON public.ai_task_prompt_versions;
REVOKE ALL ON TABLE public.ai_task_prompt_versions FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.ai_task_prompt_versions FROM authenticated;
