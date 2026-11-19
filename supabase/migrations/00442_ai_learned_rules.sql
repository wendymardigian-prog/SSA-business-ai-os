-- 00442_ai_learned_rules.sql · Reglas aprendidas y su sección versionada del prompt (traído de RER: 00408).
--
-- Aditiva e idempotente. No borra nada ni cambia columnas existentes. Va después de la 00441 (lee `ai_outcomes`) y
-- ANTES de desplegar el código.
--
-- 1. `agent_learned_rules`: cuando se acumulan rechazos con el MISMO motivo en un agente, el sistema propone una regla;
--    una persona la acepta (puede editar el texto) o la descarta. Solo las aceptadas entran al prompt: el prompt no
--    se reescribe solo. RLS activa: la lee quien tiene `agents.view`; escribe SOLO el servidor.
-- 2. `agent_prompt_versions.learned_rules` (la foto de las reglas activas de esa versión) y `change_kind`
--    (prompt | learned_rules | restore): aceptar o retirar una regla es una versión nueva; volver a una versión
--    restaura también sus reglas.
-- 3. `propose_learned_rule_if_due(...)`: con candado por agente y motivo, cuenta los rechazos con ese motivo desde la
--    última decisión sobre una regla de ese motivo (dentro de la ventana) y, si llegan al umbral y no hay otra
--    propuesta abierta, la crea. Solo `service_role`. Gemela de `ruleIsDue` (`lib/ai-learning/rules.ts`).
--
-- Para volver atrás:
--   DROP FUNCTION IF EXISTS public.propose_learned_rule_if_due(uuid, uuid, text, integer, integer, text);
--   ALTER TABLE public.agent_prompt_versions DROP COLUMN IF EXISTS learned_rules, DROP COLUMN IF EXISTS change_kind;
--   DROP TABLE IF EXISTS public.agent_learned_rules;

-- ─── 1. agent_learned_rules ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_learned_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  reason_key    text NOT NULL,
  text          text NOT NULL,
  evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_ids    uuid[] NOT NULL DEFAULT '{}',
  rejections    integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'proposed',
  proposed_at   timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  version       integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_learned_rules'::regclass AND conname = 'agent_learned_rules_status_check') THEN
    ALTER TABLE public.agent_learned_rules ADD CONSTRAINT agent_learned_rules_status_check
      CHECK (status IN ('proposed', 'active', 'discarded', 'retired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_learned_rules'::regclass AND conname = 'agent_learned_rules_reason_check') THEN
    ALTER TABLE public.agent_learned_rules ADD CONSTRAINT agent_learned_rules_reason_check
      CHECK (reason_key IN ('tone', 'wrong_data', 'not_this_client', 'too_long', 'missing_info', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_learned_rules'::regclass AND conname = 'agent_learned_rules_text_length') THEN
    ALTER TABLE public.agent_learned_rules ADD CONSTRAINT agent_learned_rules_text_length
      CHECK (length(btrim(text)) BETWEEN 5 AND 500);
  END IF;
END;
$$;

-- Una sola propuesta abierta por agente y motivo (diez rechazos a la vez = una regla).
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_learned_rules_open
  ON public.agent_learned_rules (agent_id, reason_key) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_agent_learned_rules_agent ON public.agent_learned_rules (agent_id, status);

COMMENT ON TABLE public.agent_learned_rules IS
  'Reglas aprendidas de los rechazos: propuestas por el sistema, aceptadas o descartadas por una persona. Solo las activas entran al prompt.';

ALTER TABLE public.agent_learned_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_learned_rules_select ON public.agent_learned_rules;
CREATE POLICY agent_learned_rules_select ON public.agent_learned_rules FOR SELECT
  USING (public.is_workspace_member(workspace_id) AND (select public.has_permission(workspace_id, 'agents.view')));
-- Sin INSERT, UPDATE ni DELETE para la sesión.

REVOKE ALL ON TABLE public.agent_learned_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agent_learned_rules TO authenticated;
GRANT ALL ON TABLE public.agent_learned_rules TO service_role;

-- ─── 2. La sección de reglas en cada versión del prompt ──────────────────────
ALTER TABLE public.agent_prompt_versions ADD COLUMN IF NOT EXISTS learned_rules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.agent_prompt_versions ADD COLUMN IF NOT EXISTS change_kind text NOT NULL DEFAULT 'prompt';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_prompt_versions'::regclass AND conname = 'agent_prompt_versions_change_kind_check') THEN
    ALTER TABLE public.agent_prompt_versions ADD CONSTRAINT agent_prompt_versions_change_kind_check
      CHECK (change_kind IN ('prompt', 'learned_rules', 'restore'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_prompt_versions'::regclass AND conname = 'agent_prompt_versions_learned_rules_shape') THEN
    ALTER TABLE public.agent_prompt_versions ADD CONSTRAINT agent_prompt_versions_learned_rules_shape
      CHECK (jsonb_typeof(learned_rules) = 'array');
  END IF;
END;
$$;

COMMENT ON COLUMN public.agent_prompt_versions.learned_rules IS
  'Las reglas aprendidas activas en esta versión: [{id, text}]. Volver a la versión las restaura.';
COMMENT ON COLUMN public.agent_prompt_versions.change_kind IS
  'Qué cambió: prompt (el texto), learned_rules (se aceptó o retiró una regla) o restore (vuelta atrás).';

-- ─── 3. propose_learned_rule_if_due ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.propose_learned_rule_if_due(
  p_workspace_id uuid,
  p_agent_id uuid,
  p_reason text,
  p_threshold integer,
  p_window_days integer,
  p_text text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_since timestamptz;
  v_last timestamptz;
  v_count integer;
  v_ids uuid[];
  v_notes jsonb;
  v_id uuid;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('tone', 'wrong_data', 'not_this_client', 'too_long', 'missing_info', 'other') THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.id = p_agent_id AND a.workspace_id = p_workspace_id) THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('learned_rule:' || p_agent_id::text || ':' || p_reason, 0));

  IF EXISTS (SELECT 1 FROM public.agent_learned_rules r WHERE r.agent_id = p_agent_id AND r.reason_key = p_reason AND r.status = 'proposed') THEN
    RETURN NULL;
  END IF;

  -- Solo cuentan los rechazos posteriores a la última decisión sobre una regla de este motivo (aceptada, descartada o
  -- retirada): descartar una propuesta reinicia la cuenta.
  SELECT max(r.decided_at) INTO v_last FROM public.agent_learned_rules r
   WHERE r.agent_id = p_agent_id AND r.reason_key = p_reason AND r.decided_at IS NOT NULL;
  v_since := greatest(now() - make_interval(days => greatest(coalesce(p_window_days, 30), 1)), coalesce(v_last, '-infinity'::timestamptz));

  SELECT count(*)::integer, array_agg(o.id ORDER BY o.decided_at DESC),
         coalesce(jsonb_agg(o.reject_note ORDER BY o.decided_at DESC) FILTER (WHERE o.reject_note IS NOT NULL), '[]'::jsonb)
    INTO v_count, v_ids, v_notes
    FROM public.ai_outcomes o
   WHERE o.workspace_id = p_workspace_id
     AND o.agent_id = p_agent_id
     AND o.outcome = 'rejected'
     AND o.reject_reason = p_reason
     AND o.decided_at > v_since;

  IF coalesce(v_count, 0) < greatest(coalesce(p_threshold, 3), 2) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.agent_learned_rules (workspace_id, agent_id, reason_key, text, evidence, source_ids, rejections)
  VALUES (
    p_workspace_id, p_agent_id, p_reason, left(btrim(p_text), 500),
    (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (SELECT jsonb_array_elements(v_notes) AS x LIMIT 3) n),
    v_ids[1:20], v_count
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_learned_rule_if_due(uuid, uuid, text, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propose_learned_rule_if_due(uuid, uuid, text, integer, integer, text) TO service_role;
