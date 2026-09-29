-- ============================================================================
-- 00103 — Transcripciones, y la conversacion que necesita una persona
-- ============================================================================
-- El problema que arregla, en una frase: hoy un lead manda una nota de voz y el
-- agente le contesta igual, sin haberla escuchado. El mensaje entra con el texto
-- vacio, el agente lo filtra del historial, pero el turno IGUAL se agenda y
-- responde. Esta contestando cosas que no tienen nada que ver.
--
-- Esta migracion abre las dos columnas que hacen falta para arreglarlo:
--
--   1. La transcripcion del audio, con su estado. `transcript_started_at` esta
--      para el reaper: un `pending` colgado (por ejemplo, un after() que se
--      corto) se libera a los 10 minutos. Sin eso, la bandeja queda con
--      "Transcribiendo…" girando para siempre y el mensaje no se reintenta
--      nunca.
--
--   2. La marca de "necesita humano" en la conversacion. Cuando el agente no
--      puede interpretar lo que llego, no responde: marca, se apaga en esa
--      conversacion, y avisa. Ante la duda escala: es preferible que una
--      persona conteste de mas a que el bot conteste a ciegas.
--
-- Y suma dos valores al CHECK de `agent_runs.source`, para que el consumo de la
-- transcripcion y de la descripcion de imagenes quede registrado con su costo
-- como cualquier otra llamada a un modelo.
--
-- Todo aditivo: columnas con default y un CHECK que se reemplaza SUMANDO
-- valores, nunca quitando. Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. La transcripcion
-- ------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS transcript_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS transcript_error text,
  ADD COLUMN IF NOT EXISTS transcript_seconds numeric,
  ADD COLUMN IF NOT EXISTS transcript_started_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_transcript_status_check;
  ALTER TABLE public.messages
    ADD CONSTRAINT messages_transcript_status_check
    CHECK (transcript_status IN ('none', 'pending', 'ready', 'failed'));
END $$;

COMMENT ON COLUMN public.messages.transcript IS
  'Lo que dice el audio, en su idioma original. NUNCA se borra por retencion: es texto, pesa nada, y es el contexto del agente.';

COMMENT ON COLUMN public.messages.transcript_started_at IS
  'Cuando arranco la transcripcion. Es lo que usa el reaper: un pending de mas de 10 minutos se libera para que se pueda reintentar.';

COMMENT ON COLUMN public.messages.transcript_seconds IS
  'Segundos de audio que cobro el proveedor. Los proveedores de transcripcion cobran por duracion, no por tokens.';

-- El reaper busca por este indice. Parcial, asi que pesa lo que pesan los
-- pendientes del momento (normalmente cero).
CREATE INDEX IF NOT EXISTS idx_messages_transcript_pending
  ON public.messages(transcript_started_at)
  WHERE transcript_status = 'pending';

-- ------------------------------------------------------------
-- 2. La conversacion que necesita una persona
-- ------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS needs_human boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_human_reason text,
  ADD COLUMN IF NOT EXISTS needs_human_at timestamptz;

COMMENT ON COLUMN public.conversations.needs_human IS
  'El agente no pudo interpretar lo que llego y escalo. Se limpia cuando una persona responde o marca "Ya lo vi".';

COMMENT ON COLUMN public.conversations.needs_human_reason IS
  'Por que escalo, en castellano y en una linea: es lo que lee la persona que la toma.';

-- El filtro "Necesita humano" de la bandeja. Parcial por la misma razon: son
-- pocas conversaciones a la vez, y son justo las que hay que encontrar rapido.
CREATE INDEX IF NOT EXISTS idx_conversations_needs_human
  ON public.conversations(workspace_id, needs_human_at DESC)
  WHERE needs_human;

-- ------------------------------------------------------------
-- 3. El interruptor de la compuerta
-- ------------------------------------------------------------
--
-- Arranca PRENDIDO: es el arreglo, no una opcion. Pero es apagable por
-- workspace por si los primeros dias genera demasiado escalado.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS agent_escalate_on_unreadable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workspaces.agent_escalate_on_unreadable IS
  'Si el agente escala a una persona cuando no puede interpretar un mensaje de la rafaga. Apagarlo hace que vuelva a responder a ciegas.';

-- ------------------------------------------------------------
-- 4. Los dos valores nuevos de agent_runs.source
-- ------------------------------------------------------------
--
-- La constraint vigente es `agent_runs_source_check`, de la 00085. Se reemplaza
-- con los nueve valores que ya tenia MAS los dos nuevos: nunca se quita uno,
-- porque las filas viejas lo siguen usando.
--
-- La otra constraint, `agent_runs_agent_only_for_agent_sources` (00094), NO se
-- toca: estos dos runs no llevan agent_id (no los pide un agente, los pide el
-- sistema al recibir un mensaje), asi que ya pasan.

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
      'ads_analysis',
      -- Mejoras de Chat
      'audio_transcription',
      'media_description'
    ));
END $$;

-- ------------------------------------------------------------
-- 5. El consumo de la transcripcion, en su unidad
-- ------------------------------------------------------------
--
-- Los proveedores de transcripcion NO cobran por token: cobran por HORA DE
-- AUDIO (Groq US$ 0,04, OpenAI US$ 0,36 al 28/9/2026). Guardar eso en
-- `input_per_mtok` seria un numero que dice una cosa y significa otra, y el
-- informe de gasto quedaria mintiendo.
--
-- Asi que cada tabla suma una columna en la unidad correcta. Las dos son
-- nullable: una fila de un modelo de chat no tiene hora de audio, y un run del
-- agente no tiene segundos.
--
-- El precio sigue viviendo en la base y no en el codigo, que es la regla de la
-- 00059: cambia seguido y el numero no deberia depender de un deploy.

ALTER TABLE public.model_pricing
  ADD COLUMN IF NOT EXISTS audio_per_hour numeric(12,6);

COMMENT ON COLUMN public.model_pricing.audio_per_hour IS
  'USD por hora de audio. Solo para modelos de transcripcion, que se cobran por duracion y no por tokens. Null en los modelos de chat y de embeddings.';

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS audio_seconds numeric(12,3);

COMMENT ON COLUMN public.agent_runs.audio_seconds IS
  'Segundos de audio transcriptos en este run. Es lo que se multiplica por model_pricing.audio_per_hour para congelar el costo.';
