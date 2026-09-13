-- ============================================================================
-- 00059 — Runs, pasos, precios por modelo y la marca de error del agente
-- ============================================================================
-- Fase 3, Bloque 2a. La observabilidad va junto con el agente y no despues:
-- el historial de runs y el costo no son retroactivos.
--
-- 1. `agent_runs`. Una fila por llamada a IA del sistema, no solo del agente.
--    - Un run del agente es un TURNO (un disparo y su respuesta), no una
--      conversacion: es la unidad que hace el costo atribuible y el error
--      localizable. Una rafaga respondida junta es un run.
--    - `source` cubre todo el gasto de IA: agent / flow_ai_node /
--      sequence_ai_step / kb_indexing / conversation_summary. El documento
--      listaba cuatro; los pasos de IA de las secuencias son un quinto llamador
--      real y meterlos en flow_ai_node haria mentir la pestana de costos.
--    - `status` suma dos valores a los cinco del documento: `running` (el run
--      se abre ANTES de la llamada, asi un proceso que muere deja evidencia y no
--      un agujero; un barrido del cron los cierra) y `completed` (indexar un
--      documento no "responde").
--    - `conversation_id` nullable + `thread_id`: el agente de contenido de la
--      Etapa 2/3 no vive en una conversacion de la bandeja.
--    - `cost_usd` se calcula y se congela al cerrar el run. Si el precio cambia
--      despues, el historial no se reescribe. NULL si el modelo no tenia precio
--      cargado: el run se guarda igual.
--    - Los runs NO se borran con el agente ni con el contacto: son la serie
--      historica del gasto. Las FKs son ON DELETE SET NULL.
--
-- 2. `agent_run_steps`. Una fila por llamada a modelo, busqueda en la KB o
--    herramienta. Guarda el detalle tecnico; el efecto de negocio vive en
--    audit_log y el paso lo referencia (`audit_log_id`) sin duplicarlo.
--    `input`/`output` pueden tener texto del lead y fragmentos de documentos:
--    siguen la retencion de los mensajes (12 meses) y se vacian cuando el
--    contacto se purga. La fila y sus metricas se conservan.
--
-- 3. `model_pricing`. Precio por millon de tokens con `valid_from`. Nunca se
--    sobrescribe: un precio nuevo es una fila nueva. Se siembra con
--    supabase/seeds/00_model_pricing.sql, separado de la estructura.
--
-- 4. `messages.agent_run_id`: desde un mensaje de la bandeja se abre el run que
--    lo genero.
--
-- 5. `conversations.last_agent_error_at` / `last_agent_error_run_id`: la marca
--    de "el agente fallo aca y este lead puede estar sin respuesta". La pone el
--    runner cuando un turno termina en error o se descarta; la borran una
--    respuesta buena del agente, un mensaje de una persona del equipo o el
--    cierre de la conversacion. Nunca la borra el paso del tiempo.
--
-- Indices: los de la seccion 7.3 del documento, mas los de audit_log para la
-- vista de Acciones (Bloque 2b) y el parcial del filtro de errores de la bandeja.
--
-- Las policies y los privilegios de columna van en la 00060.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. model_pricing (primero: agent_runs la referencia)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.model_pricing (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider              text NOT NULL,
  model                 text NOT NULL,
  input_per_mtok        numeric(12,6) NOT NULL,
  output_per_mtok       numeric(12,6) NOT NULL,
  cached_input_per_mtok numeric(12,6) NOT NULL,
  currency              text NOT NULL DEFAULT 'USD',
  valid_from            timestamptz NOT NULL DEFAULT now(),
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.model_pricing IS
  'Precios por millon de tokens por modelo, con vigencia. Un cambio de precio es una fila nueva con valid_from nuevo: el historial se conserva y los runs viejos no se recalculan. model es texto libre, sin lista cerrada. Solo Owner/Admin la leen.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'model_pricing_non_negative') THEN
    ALTER TABLE public.model_pricing ADD CONSTRAINT model_pricing_non_negative
      CHECK (input_per_mtok >= 0 AND output_per_mtok >= 0 AND cached_input_per_mtok >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_model_pricing_version
  ON public.model_pricing(workspace_id, provider, model, valid_from);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_model_pricing') THEN
    CREATE TRIGGER set_updated_at_model_pricing
      BEFORE UPDATE ON public.model_pricing
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. agent_runs
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source           text NOT NULL,
  agent_id         uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  prompt_version   integer,
  conversation_id  uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  thread_id        text,
  contact_id       uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  channel_id       uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  trigger          text NOT NULL,
  status           text NOT NULL DEFAULT 'running',
  status_detail    text,
  provider         text,
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  cached_tokens    integer,
  embedding_tokens integer,
  cost_usd         numeric(12,6),
  pricing_id       uuid REFERENCES public.model_pricing(id) ON DELETE SET NULL,
  latency_ms       integer,
  step_count       integer NOT NULL DEFAULT 0,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

COMMENT ON TABLE public.agent_runs IS
  'Una fila por llamada a IA del sistema (source). Para el agente, un run = un turno. Solo la escribe el service role. Las columnas de tokens y costo solo son legibles por Owner/Admin via servidor (privilegio de columna en la 00060).';
COMMENT ON COLUMN public.agent_runs.cost_usd IS
  'Costo congelado al cerrar el run: tokens de chat + embeddings del turno por el precio vigente en ese momento. NULL si el modelo no tenia precio cargado (status_detail lo aclara).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_source_values') THEN
    ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_values
      CHECK (source IN ('agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing', 'conversation_summary'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_trigger_values') THEN
    ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_trigger_values
      CHECK (trigger IN ('inbound_message', 'cron_close', 'manual', 'flow_node', 'sequence_step', 'job'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_status_values') THEN
    ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_values
      CHECK (status IN ('running', 'responded', 'escalated', 'skipped_automation',
                        'blocked_guardrail', 'completed', 'error'));
  END IF;
  -- Cuando la fuente no es el agente, agent_id queda nulo (documento, 4.5).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_agent_only_for_agent_sources') THEN
    ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_agent_only_for_agent_sources
      CHECK (agent_id IS NULL OR source IN ('agent', 'conversation_summary'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_created
  ON public.agent_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created
  ON public.agent_runs(agent_id, created_at DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation
  ON public.agent_runs(conversation_id, created_at DESC) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_status
  ON public.agent_runs(status);
-- El barrido de runs colgados mira solo los abiertos.
CREATE INDEX IF NOT EXISTS idx_agent_runs_running
  ON public.agent_runs(created_at) WHERE status = 'running';

-- ------------------------------------------------------------
-- 3. agent_run_steps
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_run_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id       uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_index   integer NOT NULL,
  kind         text NOT NULL,
  name         text,
  input        jsonb,
  output       jsonb,
  kb_chunk_ids uuid[],
  audit_log_id uuid REFERENCES public.audit_log(id) ON DELETE SET NULL,
  duration_ms  integer,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_run_steps IS
  'Detalle tecnico de cada run: una fila por llamada al modelo, busqueda en la KB o herramienta. input/output pueden tener texto del lead: siguen la retencion de los mensajes y nunca van a los logs.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_run_steps_kind_values') THEN
    ALTER TABLE public.agent_run_steps ADD CONSTRAINT agent_run_steps_kind_values
      CHECK (kind IN ('model_call', 'kb_search', 'tool_call', 'guardrail'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_run_steps_run_index
  ON public.agent_run_steps(run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_agent_run_steps_audit
  ON public.agent_run_steps(audit_log_id) WHERE audit_log_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. messages.agent_run_id
-- ------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS agent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.messages.agent_run_id IS
  'Run del agente que genero este mensaje. Desde la bandeja se abre el run; desde el run se salta a la conversacion.';

CREATE INDEX IF NOT EXISTS idx_messages_agent_run
  ON public.messages(agent_run_id) WHERE agent_run_id IS NOT NULL;

-- ------------------------------------------------------------
-- 5. La marca de error del agente en la conversacion
-- ------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_agent_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_agent_error_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.conversations.last_agent_error_at IS
  'El agente fallo en esta conversacion y el lead puede estar sin respuesta. Se pone con un turno en error, descartado o con el proveedor caido despues del respaldo. Se borra con una respuesta buena del agente, un mensaje de una persona del equipo o el cierre de la conversacion. No se borra por paso del tiempo ni porque el lead vuelva a escribir.';

-- El filtro "con error del agente" de la bandeja. Parcial: son pocas filas.
CREATE INDEX IF NOT EXISTS idx_conversations_agent_error
  ON public.conversations(workspace_id, last_agent_error_at DESC)
  WHERE last_agent_error_at IS NOT NULL;

-- ------------------------------------------------------------
-- 6. Indices de audit_log para la vista de Acciones (Bloque 2b)
-- ------------------------------------------------------------
-- (workspace_id, performed_at DESC) ya existe desde la 00023 con otro nombre;
-- IF NOT EXISTS por nombre no lo detecta, asi que se chequea por definicion.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'audit_log'
      AND indexdef ILIKE '%(workspace_id, performed_at DESC)%'
  ) THEN
    CREATE INDEX idx_audit_log_workspace_performed
      ON public.audit_log(workspace_id, performed_at DESC);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_action
  ON public.audit_log(workspace_id, action, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_agent
  ON public.audit_log(performed_by_agent_id, performed_at DESC)
  WHERE performed_by_agent_id IS NOT NULL;

-- ------------------------------------------------------------
-- 7. Retencion del contenido textual de los pasos
-- ------------------------------------------------------------
-- Dos casos, los dos vacian input/output y conservan la fila con sus metricas:
--   - Antiguedad: la misma que los mensajes (12 meses, 00055).
--   - Contacto purgado: purge_soft_deleted (00025) borra el contacto y, por
--     ON DELETE SET NULL, el run queda sin contact_id ni conversation_id. Si la
--     fuente era una conversacion con un lead (agent / conversation_summary),
--     ese texto ya no tiene dueno y se vacia.

CREATE OR REPLACE FUNCTION public.purge_agent_run_step_content(p_retention_months integer DEFAULT 12)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff  timestamptz := now() - make_interval(months => GREATEST(p_retention_months, 1));
  v_cleared integer := 0;
BEGIN
  UPDATE public.agent_run_steps s
     SET input = NULL, output = NULL
    FROM public.agent_runs r
   WHERE r.id = s.run_id
     AND (s.input IS NOT NULL OR s.output IS NOT NULL)
     AND (
       s.created_at < v_cutoff
       OR (r.source IN ('agent', 'conversation_summary')
           AND r.contact_id IS NULL AND r.conversation_id IS NULL AND r.thread_id IS NULL)
     );

  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  RETURN v_cleared;
END;
$$;

COMMENT ON FUNCTION public.purge_agent_run_step_content(integer) IS
  'Vacia input/output de los pasos de runs vencidos (misma retencion que messages) o cuyo contacto fue purgado. Conserva la fila y sus metricas. La llama el cron diario.';

REVOKE ALL ON FUNCTION public.purge_agent_run_step_content(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_agent_run_step_content(integer) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('ssa-cron-purge-agent-steps');
EXCEPTION
  WHEN OTHERS THEN NULL;  -- todavia no existia
END $$;

-- 5:10, despues de la purga de mensajes de las 5:00.
SELECT cron.schedule(
  'ssa-cron-purge-agent-steps',
  '10 5 * * *',
  $$SELECT public.purge_agent_run_step_content(12)$$
);
