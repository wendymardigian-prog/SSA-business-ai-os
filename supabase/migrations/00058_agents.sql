-- ============================================================================
-- 00058 — Agentes de IA, historial del system prompt y las palancas nuevas
-- ============================================================================
-- Fase 3, Bloque 2a. Crea la configuracion del agente conversacional y las
-- columnas que lo conectan con el resto del sistema.
--
-- 1. `agents`. Una fila por agente. En la Etapa 1 hay un solo tipo (`chat`),
--    pero la tabla no lo asume: `type` es texto libre validado en la app contra
--    el registro de tipos, asi que el agente de contenido (Etapa 2/3) y el de
--    gestion (Etapa 3) entran como filas nuevas, sin migracion.
--    - El encendido por canal vive en `enabled_channel_ids` y no en una tabla
--      join: single-tenant, pocos canales, un agente. Al no haber FK, la app
--      valida que cada id exista y sea del workspace.
--    - Lo heterogeneo va en jsonb (`tools_config`, `guardrails`,
--      `output_format`) y se valida contra los schemas del registro.
--    - Dos defaults se apartan del documento de requerimientos a proposito:
--      `knowledge_enabled` arranca en false (el agente arranca con la base de
--      conocimiento apagada) y `knowledge_fallback` en 'general' (quien decide
--      "no se" es el agente usando la herramienta de derivar, no una busqueda
--      que volvio vacia).
--    - Tres campos que no estaban en el documento: `response_delay_seconds`
--      (demora deliberada despues de la ventana de silencio),
--      `model_timeout_seconds` y `max_replies_per_conversation`.
--    - Topes de gasto con una accion por tope: el diario avisa, el mensual
--      apaga. Cortar leads por un numero que todavia no conocemos es peor que
--      avisar, pero un loop que se come la key en una noche tiene que frenarse.
--
-- 2. `agent_prompt_versions`. Mismo patron que `flow_versions` (00010): cada
--    guardado del prompt es una fila nueva e inmutable, unica por
--    (agent_id, version). Sin policy de UPDATE ni de DELETE: el historial no se
--    reescribe. Se va en cascada solo si el agente se borra fisicamente, cosa
--    que la app no hace (soft delete).
--
-- 3. Columnas nuevas en tablas existentes:
--    - conversations.agent_enabled: el toggle de la bandeja. Decision tuya.
--    - conversations.agent_paused_until: la pausa temporal que ponen los flows
--      ("pausar agente"). Separada del toggle a proposito: "reanudar agente"
--      levanta la pausa y nunca prende un agente que nadie prendio. NULL = sin
--      pausa; 'infinity' = pausado hasta que un flow lo reanude.
--    - knowledge_base.internal_only: documento de uso interno, nunca llega al
--      prompt del agente tenga el tag que tenga.
--    - audit_log.performed_by_agent_id: performed_by apunta a un usuario, asi
--      que sin esta columna no hay forma de filtrar "lo que hizo el agente".
--    - La FK que la 00053 dejo pendiente: messages.sent_by_agent_id -> agents.
--    - workspaces.ai_daily_cost_limit_usd / ai_monthly_cost_limit_usd: topes
--      globales de gasto de IA del workspace (todas las fuentes). NULL = sin
--      tope global; los del agente siguen valiendo.
--
-- Los costos de los topes (`daily_cost_limit_usd`, `monthly_cost_limit_usd`)
-- solo los lee Owner/Admin: el privilegio de columna se ajusta en la 00060.
--
-- El estado efectivo del agente NO se guarda: se deriva de agente global +
-- canal + toggle + pausa + guardarrailes + automatizaciones + control humano.
-- Guardar solo las palancas evita estados inconsistentes.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. agents
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agents (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                 uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name                         text NOT NULL,
  type                         text NOT NULL DEFAULT 'chat',
  is_enabled                   boolean NOT NULL DEFAULT false,

  system_prompt                text,
  active_prompt_version        integer,

  provider                     text,
  model                        text,
  fallback_provider            text,
  fallback_model               text,
  temperature                  numeric(3,2),
  max_output_tokens            integer,
  model_timeout_seconds        integer NOT NULL DEFAULT 120,

  bundle_window_seconds        integer NOT NULL DEFAULT 60,
  response_delay_seconds       integer NOT NULL DEFAULT 20,
  max_wait_seconds             integer DEFAULT 300,
  max_replies_per_conversation integer NOT NULL DEFAULT 12,

  output_format                jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_tools                text[] NOT NULL DEFAULT '{}',
  tools_config                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  guardrails                   jsonb NOT NULL DEFAULT '{}'::jsonb,

  knowledge_enabled            boolean NOT NULL DEFAULT false,
  knowledge_tags               text[] NOT NULL DEFAULT '{}',
  knowledge_fallback           text NOT NULL DEFAULT 'general',

  daily_cost_limit_usd         numeric(10,2) DEFAULT 5,
  daily_cost_limit_action      text NOT NULL DEFAULT 'notify',
  monthly_cost_limit_usd       numeric(10,2) DEFAULT 100,
  monthly_cost_limit_action    text NOT NULL DEFAULT 'disable',

  enabled_channel_ids          uuid[] NOT NULL DEFAULT '{}',
  config                       jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by                   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  deleted_at                   timestamptz
);

COMMENT ON TABLE public.agents IS
  'Agentes de IA del workspace. type dirige que configuracion y herramientas se muestran (validado en la app, no con CHECK, para sumar tipos sin migracion). El encendido por canal vive en enabled_channel_ids. Soft delete con deleted_at: los runs historicos siguen apuntando aca.';
COMMENT ON COLUMN public.agents.enabled_channel_ids IS
  'Canales que el agente atiende (interruptor maestro). Sin FK: la app valida que existan y sean del workspace. Vacio = ninguno.';
COMMENT ON COLUMN public.agents.response_delay_seconds IS
  'Demora deliberada despues de que cierra la ventana de silencio. El envio apunta a ultimo_mensaje + bundle_window_seconds + response_delay_seconds; la generacion y el tic del cron se absorben dentro de esta demora.';
COMMENT ON COLUMN public.agents.knowledge_fallback IS
  'escalate | general. Default general: si la busqueda no encuentra nada, el agente sigue y decide el mismo si deriva.';

-- Checks con nombre, agregados por separado para que la migracion sea
-- re-ejecutable sobre una tabla que ya existe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_type_format') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_type_format
      CHECK (type ~ '^[a-z][a-z0-9_]{1,39}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_name_not_blank') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_name_not_blank
      CHECK (length(btrim(name)) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_temperature_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_temperature_range
      CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_max_output_tokens_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_max_output_tokens_range
      CHECK (max_output_tokens IS NULL OR max_output_tokens BETWEEN 16 AND 16000);
  END IF;
  -- Techo del tiempo de la invocacion: la ruta de cron tiene maxDuration 300 s
  -- y la espera al objetivo suma demora + timeout dentro de la misma ejecucion.
  -- La app valida la regla completa (demora + timeout + 30 < 300); la base
  -- sostiene la version dura por si alguien escribe por fuera de la app.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_time_budget') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_time_budget
      CHECK (
        model_timeout_seconds BETWEEN 10 AND 240
        AND response_delay_seconds BETWEEN 0 AND 180
        AND response_delay_seconds + model_timeout_seconds + 30 < 300
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_windows_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_windows_range
      CHECK (
        bundle_window_seconds BETWEEN 15 AND 3600
        AND (max_wait_seconds IS NULL OR max_wait_seconds >= bundle_window_seconds)
        AND max_replies_per_conversation BETWEEN 1 AND 500
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_knowledge_fallback_values') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_knowledge_fallback_values
      CHECK (knowledge_fallback IN ('escalate', 'general'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_cost_limits') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_cost_limits
      CHECK (
        (daily_cost_limit_usd IS NULL OR daily_cost_limit_usd >= 0)
        AND (monthly_cost_limit_usd IS NULL OR monthly_cost_limit_usd >= 0)
        AND daily_cost_limit_action IN ('notify', 'disable')
        AND monthly_cost_limit_action IN ('notify', 'disable')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agents_workspace
  ON public.agents(workspace_id) WHERE deleted_at IS NULL;

-- "Que agente atiende este canal" es la consulta de cada mensaje entrante.
CREATE INDEX IF NOT EXISTS idx_agents_enabled_channels
  ON public.agents USING gin(enabled_channel_ids) WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_agents') THEN
    CREATE TRIGGER set_updated_at_agents
      BEFORE UPDATE ON public.agents
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. agent_prompt_versions
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_prompt_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  system_prompt text NOT NULL,
  note          text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_prompt_versions IS
  'Historial inmutable del system prompt de cada agente. Mismo patron que flow_versions. Cada run guarda la version que uso (agent_runs.prompt_version).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_prompt_versions_agent_version
  ON public.agent_prompt_versions(agent_id, version);

-- ------------------------------------------------------------
-- 3. Columnas nuevas en tablas existentes
-- ------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS agent_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_paused_until timestamptz;

COMMENT ON COLUMN public.conversations.agent_enabled IS
  'Toggle del agente en esta conversacion (bandeja). Lo apaga Human Takeover y una respuesta manual del operador. Ortogonal a is_automation_paused, que gobierna los flows.';
COMMENT ON COLUMN public.conversations.agent_paused_until IS
  'Pausa temporal del agente puesta por un flow ("pausar agente"). NULL = sin pausa, infinity = hasta que un flow lo reanude. Reanudar la levanta sin tocar agent_enabled.';

ALTER TABLE public.knowledge_base
  ADD COLUMN IF NOT EXISTS internal_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.knowledge_base.internal_only IS
  'Uso interno: nunca llega al prompt de un agente, tenga el tag que tenga. El filtro va dentro de match_knowledge_chunks_filtered (00062).';

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS performed_by_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.audit_log.performed_by_agent_id IS
  'Agente que ejecuto la accion. performed_by (usuario) queda NULL en ese caso. Es la base de la vista de Acciones.';

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS ai_daily_cost_limit_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS ai_monthly_cost_limit_usd numeric(10,2);

COMMENT ON COLUMN public.workspaces.ai_daily_cost_limit_usd IS
  'Tope diario de gasto de IA de todo el workspace (todas las fuentes). NULL = sin tope global. Corte del dia en la zona del negocio.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_sent_by_agent_id_fkey') THEN
    -- NOT VALID + VALIDATE: si quedo algun id huerfano de pruebas, la
    -- validacion avisa en vez de tumbar toda la migracion.
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_sent_by_agent_id_fkey
      FOREIGN KEY (sent_by_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL
      NOT VALID;
    BEGIN
      ALTER TABLE public.messages VALIDATE CONSTRAINT messages_sent_by_agent_id_fkey;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'messages.sent_by_agent_id tiene ids que no existen en agents: la FK queda NOT VALID. Revisar.';
    END;
  END IF;
END $$;

COMMENT ON COLUMN public.messages.sent_by_agent_id IS
  'Que agente de IA mando este mensaje. FK a agents desde la 00058.';

-- El agente se busca por conversacion en cada mensaje entrante y en cada turno.
CREATE INDEX IF NOT EXISTS idx_conversations_agent_enabled
  ON public.conversations(workspace_id) WHERE agent_enabled;
