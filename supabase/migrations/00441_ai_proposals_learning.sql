-- 00441_ai_proposals_learning.sql · La IA aprende de lo que se rechaza: propuestas de los agentes, motivo al
-- descartar, desenlaces y panel de calidad (traído de RER: 00406 en parte, 00407).
--
-- Aditiva e idempotente. No borra nada ni cambia columnas existentes. Va ANTES de desplegar el código (la pantalla de
-- Agentes IA, la bandeja de borradores y Aprobaciones leen estas columnas y tablas).
--
-- 0. `agents.actions_need_approval` (APAGADO de serie: decisión de producto del 18/11/2026) y `agents.learning`
--    (ejemplos automáticos, apagados, y el umbral de las reglas aprendidas). Con todo apagado, el agente hace
--    exactamente lo mismo que antes.
-- 1. `ai_proposals`: cada acción que un agente PROPONE en vez de ejecutar (interruptor del agente prendido y turno en
--    borrador, o una escritura pedida al asistente del equipo). Guarda los parámetros propuestos y los finales, el
--    estado y, si se rechazó, el motivo. RLS activa; escribe SOLO el servidor. La ve quien tiene `agents.view` (y, si
--    es de una conversación, puede ver esa conversación) o quien la pidió con `assistant.use`. Sin `contact_id` a
--    propósito: `merge_contacts` no la tiene que tocar.
-- 2. `agent_drafts.reject_reason` / `reject_note`: el motivo (lista cerrada) al descartar un borrador. OPCIONAL
--    (decisión de producto): sin trigger que lo exija; si la persona elige un motivo, cuenta para aprender.
-- 3. `ai_outcomes` (vista, security_invoker): los desenlaces decididos por personas (aprobada, aprobada con edición,
--    rechazada con su motivo). Un descarte sin motivo cuenta como rechazo «sin motivo».
-- 4. `ai_quality_weekly(p_workspace_id, p_weeks, p_agent_id)` (SECURITY INVOKER): por semana, cuántas se decidieron,
--    aprobaron, editaron y rechazaron, y los motivos. Semanas en la zona del negocio.
--
-- Motivos (lista cerrada, gemela de `lib/ai-learning/reject-reasons.ts`):
--   tone, wrong_data, not_this_client, too_long, missing_info, other (con nota).
--
-- Para volver atrás:
--   DROP FUNCTION IF EXISTS public.ai_quality_weekly(uuid, integer, uuid);
--   DROP VIEW IF EXISTS public.ai_outcomes;
--   ALTER TABLE public.agent_drafts DROP COLUMN IF EXISTS reject_reason, DROP COLUMN IF EXISTS reject_note;
--   DROP TABLE IF EXISTS public.ai_proposals;
--   ALTER TABLE public.agents DROP COLUMN IF EXISTS actions_need_approval, DROP COLUMN IF EXISTS learning;

-- ─── 0. Ajustes del agente ───────────────────────────────────────────────────
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS actions_need_approval boolean NOT NULL DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS learning jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agents'::regclass AND conname = 'agents_learning_shape') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_learning_shape CHECK (jsonb_typeof(learning) = 'object');
  END IF;
END;
$$;

COMMENT ON COLUMN public.agents.actions_need_approval IS
  'En un turno en borrador, las acciones que escriben en el CRM (etiquetar, temperatura, tarea…) quedan propuestas en ai_proposals. Apagado de serie.';
COMMENT ON COLUMN public.agents.learning IS
  '{examples, approved_examples, edit_examples, rule_threshold}: ejemplos automáticos en el prompt (apagados de serie) y cuántos rechazos con el mismo motivo proponen una regla.';

-- La pantalla del agente las lee con el cliente de la persona (00060: permisos por columna).
GRANT SELECT (actions_need_approval, learning) ON public.agents TO authenticated;

-- ─── 1. ai_proposals ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_proposals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id         uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  run_id           uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  requested_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  channel_id       uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  conversation_id  uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  subject_type     text,
  subject_id       text,
  kind             text NOT NULL DEFAULT 'action',
  tool_key         text NOT NULL,
  label            text NOT NULL,
  summary          text,
  params_proposed  jsonb NOT NULL DEFAULT '{}'::jsonb,
  params_final     jsonb,
  tool_config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'pending',
  reject_reason    text,
  reject_note      text,
  result           jsonb,
  error            text,
  audit_log_id     uuid REFERENCES public.audit_log(id) ON DELETE SET NULL,
  decided_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_proposals'::regclass AND conname = 'ai_proposals_status_check') THEN
    ALTER TABLE public.ai_proposals ADD CONSTRAINT ai_proposals_status_check
      CHECK (status IN ('pending', 'approving', 'approved', 'approved_edited', 'rejected', 'failed', 'expired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_proposals'::regclass AND conname = 'ai_proposals_kind_check') THEN
    ALTER TABLE public.ai_proposals ADD CONSTRAINT ai_proposals_kind_check CHECK (kind IN ('action', 'message'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_proposals'::regclass AND conname = 'ai_proposals_tool_key_check') THEN
    ALTER TABLE public.ai_proposals ADD CONSTRAINT ai_proposals_tool_key_check CHECK (tool_key ~ '^[a-z][a-z0-9_]{2,63}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_proposals'::regclass AND conname = 'ai_proposals_reject_reason_check') THEN
    ALTER TABLE public.ai_proposals ADD CONSTRAINT ai_proposals_reject_reason_check
      CHECK (reject_reason IS NULL OR reject_reason IN ('tone', 'wrong_data', 'not_this_client', 'too_long', 'missing_info', 'other'));
  END IF;
  -- Rechazada = con motivo; «otro» = con nota .
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_proposals'::regclass AND conname = 'ai_proposals_reject_shape') THEN
    ALTER TABLE public.ai_proposals ADD CONSTRAINT ai_proposals_reject_shape
      CHECK (
        (status <> 'rejected' OR reject_reason IS NOT NULL)
        AND (reject_reason IS DISTINCT FROM 'other' OR length(btrim(coalesce(reject_note, ''))) > 0)
        AND (reject_note IS NULL OR length(reject_note) <= 500)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_proposals'::regclass AND conname = 'ai_proposals_label_length') THEN
    ALTER TABLE public.ai_proposals ADD CONSTRAINT ai_proposals_label_length
      CHECK (length(label) BETWEEN 1 AND 200 AND (summary IS NULL OR length(summary) <= 1000));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_ai_proposals_pending ON public.ai_proposals (workspace_id, created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ai_proposals_decided ON public.ai_proposals (workspace_id, decided_at DESC) WHERE decided_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_proposals_agent ON public.ai_proposals (agent_id, decided_at DESC);

COMMENT ON TABLE public.ai_proposals IS
  'Acciones que un agente propone y una persona aprueba, edita o rechaza una por una. Escribe solo el servidor.';
COMMENT ON COLUMN public.ai_proposals.tool_config IS
  'La configuración de la herramienta en el momento de proponer (la que fijó el operador). No viaja al navegador.';

ALTER TABLE public.ai_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_proposals_select ON public.ai_proposals;
CREATE POLICY ai_proposals_select ON public.ai_proposals FOR SELECT
  USING (
    public.is_workspace_member(workspace_id)
    AND (
      (
        (select public.has_permission(workspace_id, 'agents.view'))
        AND (
          conversation_id IS NULL
          OR EXISTS (SELECT 1 FROM public.conversations conv WHERE conv.id = ai_proposals.conversation_id)
        )
      )
      OR (requested_by = (select auth.uid()) AND (select public.has_permission(workspace_id, 'assistant.use')))
    )
  );
-- Sin INSERT, UPDATE ni DELETE para la sesión: escribe el servidor después de comprobar el permiso.

REVOKE ALL ON TABLE public.ai_proposals FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, workspace_id, agent_id, run_id, requested_by, channel_id, conversation_id, subject_type, subject_id, kind,
  tool_key, label, summary, params_proposed, params_final, status, reject_reason, reject_note, result, error,
  audit_log_id, decided_by, decided_at, created_at, updated_at
) ON public.ai_proposals TO authenticated;
GRANT ALL ON TABLE public.ai_proposals TO service_role;

-- ─── 2. Motivo cerrado al descartar un borrador ───────────────────────────────
ALTER TABLE public.agent_drafts ADD COLUMN IF NOT EXISTS reject_reason text NULL;
ALTER TABLE public.agent_drafts ADD COLUMN IF NOT EXISTS reject_note text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_drafts'::regclass AND conname = 'agent_drafts_reject_reason_check') THEN
    ALTER TABLE public.agent_drafts ADD CONSTRAINT agent_drafts_reject_reason_check
      CHECK (
        (reject_reason IS NULL OR reject_reason IN ('tone', 'wrong_data', 'not_this_client', 'too_long', 'missing_info', 'other'))
        AND (reject_reason IS DISTINCT FROM 'other' OR length(btrim(coalesce(reject_note, ''))) > 0)
        AND (reject_note IS NULL OR length(reject_note) <= 500)
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.agent_drafts.reject_reason IS
  'Motivo de la lista cerrada al descartar un borrador una persona (opcional). Los descartes automáticos (auto:*) no lo llevan.';

GRANT UPDATE (reject_reason, reject_note) ON public.agent_drafts TO authenticated;

-- Sin guardia: el motivo es OPCIONAL (decisión de producto, 18/11/2026). En RER un trigger (AI001) lo exigía.

CREATE INDEX IF NOT EXISTS idx_agent_drafts_decided_outcomes ON public.agent_drafts (workspace_id, decided_at DESC)
  WHERE decided_by IS NOT NULL;

-- ─── 3. ai_outcomes ──────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.ai_outcomes
WITH (security_invoker = true) AS
SELECT
  'draft'::text AS source,
  d.id,
  d.workspace_id,
  d.agent_id,
  d.channel_id,
  'message'::text AS kind,
  'message'::text AS tool_key,
  CASE
    WHEN d.status = 'sent' AND btrim(coalesce(d.sent_body, '')) = btrim(coalesce(d.body, '')) THEN 'approved'
    WHEN d.status = 'sent' THEN 'approved_edited'
    ELSE 'rejected'
  END AS outcome,
  d.body AS proposed_text,
  CASE WHEN d.status = 'sent' THEN d.sent_body ELSE NULL END AS final_text,
  d.reject_reason,
  d.reject_note,
  d.decided_by,
  d.decided_at
FROM public.agent_drafts d
WHERE d.decided_by IS NOT NULL
  AND d.decided_at IS NOT NULL
  AND (d.status = 'sent' OR (d.status = 'discarded' AND coalesce(d.discard_reason, '') NOT LIKE 'auto:%'))
UNION ALL
SELECT
  'proposal'::text AS source,
  p.id,
  p.workspace_id,
  p.agent_id,
  p.channel_id,
  p.kind,
  p.tool_key,
  CASE p.status WHEN 'approved' THEN 'approved' WHEN 'approved_edited' THEN 'approved_edited' ELSE 'rejected' END AS outcome,
  p.params_proposed::text AS proposed_text,
  CASE WHEN p.status = 'rejected' THEN NULL ELSE coalesce(p.params_final, p.params_proposed)::text END AS final_text,
  p.reject_reason,
  p.reject_note,
  p.decided_by,
  p.decided_at
FROM public.ai_proposals p
WHERE p.status IN ('approved', 'approved_edited', 'rejected')
  AND p.decided_at IS NOT NULL;

COMMENT ON VIEW public.ai_outcomes IS
  'Desenlaces decididos por personas : aprobada, aprobada con edición (texto propuesto y final) o rechazada con motivo. Lee con la RLS de quien mira.';

REVOKE ALL ON public.ai_outcomes FROM PUBLIC, anon;
GRANT SELECT ON public.ai_outcomes TO authenticated, service_role;

-- ─── 4. ai_quality_weekly ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_quality_weekly(p_workspace_id uuid, p_weeks integer DEFAULT 8, p_agent_id uuid DEFAULT NULL)
RETURNS TABLE (
  week_start date,
  decided integer,
  approved integer,
  approved_edited integer,
  rejected integer,
  reasons jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH tz AS (
    SELECT coalesce(nullif(w.timezone, ''), 'UTC') AS name FROM public.workspaces w WHERE w.id = p_workspace_id
  ),
  bounds AS (
    SELECT (date_trunc('week', (now() AT TIME ZONE tz.name)) - make_interval(weeks => greatest(least(coalesce(p_weeks, 8), 52), 1) - 1))::date AS from_week,
           tz.name
      FROM tz
  ),
  picked AS (
    SELECT date_trunc('week', o.decided_at AT TIME ZONE b.name)::date AS wk, o.outcome, o.reject_reason
      FROM public.ai_outcomes o, bounds b
     WHERE o.workspace_id = p_workspace_id
       AND (p_agent_id IS NULL OR o.agent_id = p_agent_id)
       AND date_trunc('week', o.decided_at AT TIME ZONE b.name)::date >= b.from_week
  )
  SELECT
    r.wk AS week_start,
    count(*)::integer AS decided,
    count(*) FILTER (WHERE r.outcome = 'approved')::integer AS approved,
    count(*) FILTER (WHERE r.outcome = 'approved_edited')::integer AS approved_edited,
    count(*) FILTER (WHERE r.outcome = 'rejected')::integer AS rejected,
    coalesce(
      (SELECT jsonb_object_agg(x.reason, x.n) FROM (
         SELECT coalesce(r2.reject_reason, 'unknown') AS reason, count(*) AS n
           FROM picked r2 WHERE r2.wk = r.wk AND r2.outcome = 'rejected' GROUP BY 1
       ) x),
      '{}'::jsonb
    ) AS reasons
  FROM picked r
  GROUP BY r.wk
  ORDER BY r.wk;
$$;

REVOKE ALL ON FUNCTION public.ai_quality_weekly(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_quality_weekly(uuid, integer, uuid) TO authenticated, service_role;
