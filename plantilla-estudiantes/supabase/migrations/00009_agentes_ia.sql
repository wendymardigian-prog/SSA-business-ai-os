-- ============================================================================
-- Agentes de IA
--
-- Los agentes de IA de cada negocio (el de chat y el copywriter), cada llamada a IA del
-- sistema (una corrida, con su costo congelado) y sus pasos, los borradores que esperan
-- aprobacion, el historial de instrucciones, los precios por modelo y la base de
-- conocimiento con su busqueda semantica.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  type text DEFAULT 'chat'::text NOT NULL,
  is_enabled boolean DEFAULT false NOT NULL,
  system_prompt text,
  active_prompt_version integer,
  provider text,
  model text,
  fallback_provider text,
  fallback_model text,
  temperature numeric(3,2),
  max_output_tokens integer,
  model_timeout_seconds integer DEFAULT 120 NOT NULL,
  bundle_window_seconds integer DEFAULT 60 NOT NULL,
  response_delay_seconds integer DEFAULT 20 NOT NULL,
  max_wait_seconds integer DEFAULT 300,
  max_replies_per_conversation integer,
  output_format jsonb DEFAULT '{}'::jsonb NOT NULL,
  allowed_tools text[] DEFAULT '{}'::text[] NOT NULL,
  tools_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  guardrails jsonb DEFAULT '{}'::jsonb NOT NULL,
  knowledge_enabled boolean DEFAULT false NOT NULL,
  knowledge_tags text[] DEFAULT '{}'::text[] NOT NULL,
  knowledge_fallback text DEFAULT 'general'::text NOT NULL,
  daily_cost_limit_usd numeric(10,2) DEFAULT 5,
  daily_cost_limit_action text DEFAULT 'notify'::text NOT NULL,
  monthly_cost_limit_usd numeric(10,2) DEFAULT 100,
  monthly_cost_limit_action text DEFAULT 'disable'::text NOT NULL,
  enabled_channel_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  burst_max_age_hours integer DEFAULT 6 NOT NULL,
  close_after_inactive_hours integer DEFAULT 12 NOT NULL,
  summary_on_close boolean DEFAULT true NOT NULL,
  classify_on_close boolean DEFAULT true NOT NULL,
  channel_modes jsonb DEFAULT '{}'::jsonb NOT NULL,
  response_rules jsonb DEFAULT '[]'::jsonb NOT NULL,
  response_rules_default text DEFAULT 'draft'::text NOT NULL,
  external_reply_cooldown_minutes integer DEFAULT 10 NOT NULL,
  CONSTRAINT agents_pkey PRIMARY KEY (id),
  CONSTRAINT agents_burst_max_age_range CHECK (((burst_max_age_hours >= 1) AND (burst_max_age_hours <= 720))),
  CONSTRAINT agents_channel_modes_object CHECK ((jsonb_typeof(channel_modes) = 'object'::text)),
  CONSTRAINT agents_close_after_range CHECK (((close_after_inactive_hours >= 1) AND (close_after_inactive_hours <= 720))),
  CONSTRAINT agents_cost_limits CHECK ((((daily_cost_limit_usd IS NULL) OR (daily_cost_limit_usd >= (0)::numeric)) AND ((monthly_cost_limit_usd IS NULL) OR (monthly_cost_limit_usd >= (0)::numeric)) AND (daily_cost_limit_action = ANY (ARRAY['notify'::text, 'disable'::text])) AND (monthly_cost_limit_action = ANY (ARRAY['notify'::text, 'disable'::text])))),
  CONSTRAINT agents_external_cooldown_range CHECK (((external_reply_cooldown_minutes >= 0) AND (external_reply_cooldown_minutes <= 120))),
  CONSTRAINT agents_knowledge_fallback_values CHECK ((knowledge_fallback = ANY (ARRAY['escalate'::text, 'general'::text]))),
  CONSTRAINT agents_max_output_tokens_range CHECK (((max_output_tokens IS NULL) OR ((max_output_tokens >= 16) AND (max_output_tokens <= 16000)))),
  CONSTRAINT agents_name_not_blank CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 80))),
  CONSTRAINT agents_response_rules_default_values CHECK ((response_rules_default = ANY (ARRAY['send'::text, 'draft'::text, 'skip'::text]))),
  CONSTRAINT agents_response_rules_is_array CHECK ((jsonb_typeof(response_rules) = 'array'::text)),
  CONSTRAINT agents_temperature_range CHECK (((temperature IS NULL) OR ((temperature >= (0)::numeric) AND (temperature <= (2)::numeric)))),
  CONSTRAINT agents_time_budget CHECK (((model_timeout_seconds BETWEEN 10 AND 240) AND (response_delay_seconds BETWEEN 0 AND 180) AND (((response_delay_seconds + model_timeout_seconds) + 30) < 300))),
  CONSTRAINT agents_type_format CHECK ((type ~ '^[a-z][a-z0-9_]{1,39}$'::text)),
  CONSTRAINT agents_windows_range CHECK (((bundle_window_seconds BETWEEN 15 AND 3600) AND ((max_wait_seconds IS NULL) OR (max_wait_seconds >= bundle_window_seconds)) AND ((max_replies_per_conversation IS NULL) OR ((max_replies_per_conversation >= 1) AND (max_replies_per_conversation <= 500))))),
  CONSTRAINT agents_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT agents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.agents IS 'Agentes de IA del workspace. type dirige que configuracion y herramientas se muestran (validado en la app, no con CHECK, para sumar tipos sin migracion). El encendido por canal vive en enabled_channel_ids. Soft delete con deleted_at: los runs historicos siguen apuntando aca.';
COMMENT ON COLUMN public.agents.response_delay_seconds IS 'Demora deliberada despues de que cierra la ventana de silencio. El envio apunta a ultimo_mensaje + bundle_window_seconds + response_delay_seconds; la generacion y el tic del cron se absorben dentro de esta demora.';
COMMENT ON COLUMN public.agents.max_replies_per_conversation IS 'Tope de respuestas del agente por conversacion desde la ultima intervencion humana. NULL = sin tope (el default). El guardarrail solo actua con un numero cargado.';
COMMENT ON COLUMN public.agents.knowledge_fallback IS 'escalate | general. Default general: si la busqueda no encuentra nada, el agente sigue y decide el mismo si deriva.';
COMMENT ON COLUMN public.agents.enabled_channel_ids IS 'Canales que el agente atiende (interruptor maestro). Sin FK: la app valida que existan y sean del workspace. Vacio = ninguno.';
COMMENT ON COLUMN public.agents.burst_max_age_hours IS 'La rafaga que responde un turno ignora los entrantes mas viejos que esto (horas, contadas desde el instante del turno). Siguen en el contexto del prompt; solo no se responden.';
COMMENT ON COLUMN public.agents.close_after_inactive_hours IS 'Horas sin mensajes tras las que el barrido cierra una conversacion que el agente atiende y en la que ya participo. Al cerrar, resumen y clasificacion segun las otras dos columnas.';
COMMENT ON COLUMN public.agents.summary_on_close IS 'Si al cerrar una conversacion el agente genera el resumen acumulativo del contacto (contacts.ai_conversation_summary). Deja un run con source conversation_summary.';
COMMENT ON COLUMN public.agents.classify_on_close IS 'Si al cerrar aplica tags, temperatura y proximo seguimiento, con las mismas reglas que sus herramientas.';
COMMENT ON COLUMN public.agents.channel_modes IS 'Modo del agente por canal: { channel_id: "send" | "draft" }. Sin entrada = send (envia directo). En draft el turno deja un borrador en agent_drafts y no envia nada. Solo tiene sentido para canales que estan en enabled_channel_ids.';
REVOKE ALL ON TABLE public.agents FROM anon;
REVOKE SELECT ON TABLE public.agents FROM authenticated;
GRANT SELECT (id, workspace_id, name, type, is_enabled, system_prompt, active_prompt_version, provider, model, fallback_provider, fallback_model, temperature, max_output_tokens, model_timeout_seconds, bundle_window_seconds, response_delay_seconds, max_wait_seconds, max_replies_per_conversation, output_format, allowed_tools, tools_config, guardrails, knowledge_enabled, knowledge_tags, knowledge_fallback, enabled_channel_ids, config, created_by, created_at, updated_at, deleted_at, burst_max_age_hours, close_after_inactive_hours, summary_on_close, classify_on_close, channel_modes, response_rules, response_rules_default, external_reply_cooldown_minutes) ON TABLE public.agents TO authenticated;

CREATE TABLE IF NOT EXISTS public.agent_prompt_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  version integer NOT NULL,
  system_prompt text NOT NULL,
  note text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT agent_prompt_versions_pkey PRIMARY KEY (id),
  CONSTRAINT agent_prompt_versions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE,
  CONSTRAINT agent_prompt_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT agent_prompt_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.agent_prompt_versions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.agent_prompt_versions IS 'Historial inmutable del system prompt de cada agente. Mismo patron que flow_versions. Cada run guarda la version que uso (agent_runs.prompt_version).';
REVOKE ALL ON TABLE public.agent_prompt_versions FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.agent_prompt_versions FROM authenticated;

CREATE TABLE IF NOT EXISTS public.ai_task_prompt_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  task text NOT NULL,
  version integer NOT NULL,
  instructions text NOT NULL,
  note text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ai_task_prompt_versions_pkey PRIMARY KEY (id),
  CONSTRAINT ai_task_prompt_versions_task_check CHECK ((task = ANY (ARRAY['message_classification'::text, 'conversation_summary'::text, 'close_classification'::text, 'media_description'::text, 'ads_analysis'::text]))),
  CONSTRAINT ai_task_prompt_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT ai_task_prompt_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.ai_task_prompt_versions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ai_task_prompt_versions IS 'Historial inmutable de las instrucciones (parte editable del prompt) de cada tarea de IA. Mismo patron que agent_prompt_versions.';
REVOKE ALL ON TABLE public.ai_task_prompt_versions FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.ai_task_prompt_versions FROM authenticated;

CREATE TABLE IF NOT EXISTS public.knowledge_base (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  title text NOT NULL,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  source_file_path text,
  source_mime text,
  source_size_bytes bigint,
  source_filename text,
  content_md text,
  status text DEFAULT 'processing'::text NOT NULL,
  error_detail text,
  chunk_count integer DEFAULT 0 NOT NULL,
  embedding_model text,
  indexed_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  internal_only boolean DEFAULT false NOT NULL,
  CONSTRAINT knowledge_base_pkey PRIMARY KEY (id),
  CONSTRAINT knowledge_base_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'ready'::text, 'error'::text, 'pending'::text]))),
  CONSTRAINT knowledge_base_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT knowledge_base_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.knowledge_base IS 'Documentos de la base de conocimiento. El archivo original vive en el bucket privado "knowledge"; content_md es su conversion a markdown. Soft delete con deleted_at (retencion 30 dias, purga por cron).';
COMMENT ON COLUMN public.knowledge_base.status IS 'processing = el job async todavia corre; pending = guardado, falta conectar Voyage para indexarlo (se retoma solo al conectarlo); ready = indexado; error = fallo, el motivo esta en error_detail.';
COMMENT ON COLUMN public.knowledge_base.embedding_model IS 'Modelo que genero los embeddings de este documento (ej: voyage-4-lite). Si se cambia de modelo, identifica que hay que reindexar.';
COMMENT ON COLUMN public.knowledge_base.internal_only IS 'Uso interno: nunca llega al prompt de un agente, tenga el tag que tenga. El filtro va dentro de match_knowledge_chunks_filtered.';

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  document_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  token_estimate integer,
  embedding extensions.vector(1024) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT knowledge_chunks_pkey PRIMARY KEY (id),
  CONSTRAINT knowledge_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.knowledge_base(id) ON DELETE CASCADE,
  CONSTRAINT knowledge_chunks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.knowledge_chunks IS 'Fragmentos indexados de un documento. Se borran en cascada con su documento. Los escribe solo el service role, desde el job de indexacion.';
COMMENT ON COLUMN public.knowledge_chunks.workspace_id IS 'Desnormalizado del documento a proposito: evita un JOIN en la busqueda semantica y hace la RLS de una sola condicion.';
COMMENT ON COLUMN public.knowledge_chunks.embedding IS 'Embedding de Voyage AI voyage-4-lite, 1024 dimensiones (su default). Cambiar la dimension obliga a reindexar todo.';

CREATE TABLE IF NOT EXISTS public.model_pricing (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_per_mtok numeric(12,6) NOT NULL,
  output_per_mtok numeric(12,6) NOT NULL,
  cached_input_per_mtok numeric(12,6) NOT NULL,
  currency text DEFAULT 'USD'::text NOT NULL,
  valid_from timestamp with time zone DEFAULT now() NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  audio_per_hour numeric(12,6),
  CONSTRAINT model_pricing_pkey PRIMARY KEY (id),
  CONSTRAINT model_pricing_non_negative CHECK (((input_per_mtok >= (0)::numeric) AND (output_per_mtok >= (0)::numeric) AND (cached_input_per_mtok >= (0)::numeric))),
  CONSTRAINT model_pricing_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.model_pricing ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.model_pricing IS 'Precios por millon de tokens por modelo, con vigencia. Un cambio de precio es una fila nueva con valid_from nuevo: el historial se conserva y los runs viejos no se recalculan. model es texto libre, sin lista cerrada. Solo Owner/Admin la leen.';
COMMENT ON COLUMN public.model_pricing.audio_per_hour IS 'USD por hora de audio. Solo para modelos de transcripcion, que se cobran por duracion y no por tokens. Null en los modelos de chat y de embeddings.';
REVOKE ALL ON TABLE public.model_pricing FROM anon;

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  source text NOT NULL,
  agent_id uuid,
  prompt_version integer,
  conversation_id uuid,
  thread_id text,
  contact_id uuid,
  channel_id uuid,
  trigger text NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  status_detail text,
  provider text,
  model text,
  input_tokens integer,
  output_tokens integer,
  cached_tokens integer,
  embedding_tokens integer,
  cost_usd numeric(12,6),
  pricing_id uuid,
  latency_ms integer,
  step_count integer DEFAULT 0 NOT NULL,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  inbound_at timestamp with time zone,
  responded_at timestamp with time zone,
  routing jsonb,
  intent jsonb,
  audio_seconds numeric(12,3),
  CONSTRAINT agent_runs_pkey PRIMARY KEY (id),
  CONSTRAINT agent_runs_agent_only_for_agent_sources CHECK (((agent_id IS NULL) OR (source = ANY (ARRAY['agent'::text, 'conversation_summary'::text, 'content_copy'::text])))),
  CONSTRAINT agent_runs_source_check CHECK ((source = ANY (ARRAY['agent'::text, 'flow_ai_node'::text, 'sequence_ai_step'::text, 'kb_indexing'::text, 'conversation_summary'::text, 'message_classification'::text, 'message_classification_eval'::text, 'content_copy'::text, 'ads_analysis'::text, 'audio_transcription'::text, 'media_description'::text]))),
  CONSTRAINT agent_runs_status_values CHECK ((status = ANY (ARRAY['running'::text, 'responded'::text, 'escalated'::text, 'skipped_automation'::text, 'skipped'::text, 'blocked_guardrail'::text, 'completed'::text, 'error'::text, 'drafted'::text, 'already_answered'::text]))),
  CONSTRAINT agent_runs_trigger_values CHECK ((trigger = ANY (ARRAY['inbound_message'::text, 'cron_close'::text, 'manual'::text, 'flow_node'::text, 'sequence_step'::text, 'job'::text]))),
  CONSTRAINT agent_runs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL,
  CONSTRAINT agent_runs_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE SET NULL,
  CONSTRAINT agent_runs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT agent_runs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL,
  CONSTRAINT agent_runs_pricing_id_fkey FOREIGN KEY (pricing_id) REFERENCES public.model_pricing(id) ON DELETE SET NULL,
  CONSTRAINT agent_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.agent_runs IS 'Una fila por llamada a IA del sistema (source). Para el agente, un run = un turno. Solo la escribe el service role. Las columnas de tokens y costo solo son legibles por Owner/Admin via servidor (privilegio de columna).';
COMMENT ON COLUMN public.agent_runs.status IS 'running | responded | escalated | skipped_automation | skipped | blocked_guardrail | completed | error. skipped = el agente no actuo por una palanca (apagado, canal, conversacion, pausa, una persona tomo la conversacion); el motivo va en status_detail.';
COMMENT ON COLUMN public.agent_runs.cost_usd IS 'Costo congelado al cerrar el run: tokens de chat + embeddings del turno por el precio vigente en ese momento. NULL si el modelo no tenia precio cargado (status_detail lo aclara).';
COMMENT ON COLUMN public.agent_runs.inbound_at IS 'El ULTIMO mensaje entrante de la rafaga que responde este turno. Se congela al abrir el run. Existe en los dos modos, asi que permite comparar envio directo contra borrador con el mismo numero.';
COMMENT ON COLUMN public.agent_runs.responded_at IS 'Cuando salio la respuesta de verdad. Envio directo: segundos despues del turno. Borrador: cuando alguien lo aprobo. NULL mientras no salio.';
COMMENT ON COLUMN public.agent_runs.routing IS 'Qué decidió el turno: mode, rule_id, rule_index, action, matched, check, moment, refresh. Se lee en Runs y en la cola; la pantalla arma una oración, nunca muestra rule:<id>.';
COMMENT ON COLUMN public.agent_runs.intent IS 'Intención declarada por el agente en el turno: { category_id, confidence }. null si no la declaró o el id no existe.';
COMMENT ON COLUMN public.agent_runs.audio_seconds IS 'Segundos de audio transcriptos en este run. Es lo que se multiplica por model_pricing.audio_per_hour para congelar el costo.';
REVOKE ALL ON TABLE public.agent_runs FROM anon, authenticated;
GRANT SELECT (id, workspace_id, source, agent_id, prompt_version, conversation_id, thread_id, contact_id, channel_id, trigger, status, status_detail, provider, model, latency_ms, step_count, error, created_at, completed_at, inbound_at, responded_at, routing, intent) ON TABLE public.agent_runs TO authenticated;

CREATE TABLE IF NOT EXISTS public.agent_drafts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  agent_id uuid,
  conversation_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  run_id uuid,
  status text DEFAULT 'pending'::text NOT NULL,
  body text,
  body_parts jsonb,
  no_reply_reason text,
  suggested_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
  applied_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
  burst_message_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  burst_started_at timestamp with time zone,
  burst_last_inbound_at timestamp with time zone,
  sendable_until timestamp with time zone,
  alerted_thresholds smallint[] DEFAULT '{}'::smallint[] NOT NULL,
  window_missed_at timestamp with time zone,
  missed_while_assigned_to uuid,
  sent_body text,
  send_error text,
  sent_message_id uuid,
  discard_reason text,
  regenerate_instruction text,
  previous_draft_id uuid,
  decided_at timestamp with time zone,
  decided_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT agent_drafts_pkey PRIMARY KEY (id),
  CONSTRAINT agent_drafts_empty_has_reason CHECK (((body IS NOT NULL) OR (no_reply_reason IS NOT NULL))),
  CONSTRAINT agent_drafts_sent_has_body CHECK (((status <> 'sent'::text) OR (sent_body IS NOT NULL))),
  CONSTRAINT agent_drafts_status_values CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'discarded'::text, 'superseded'::text, 'regenerated'::text, 'expired'::text]))),
  CONSTRAINT agent_drafts_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL,
  CONSTRAINT agent_drafts_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE,
  CONSTRAINT agent_drafts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT agent_drafts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE,
  CONSTRAINT agent_drafts_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT agent_drafts_missed_while_assigned_to_fkey FOREIGN KEY (missed_while_assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT agent_drafts_previous_draft_id_fkey FOREIGN KEY (previous_draft_id) REFERENCES public.agent_drafts(id) ON DELETE SET NULL,
  CONSTRAINT agent_drafts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  CONSTRAINT agent_drafts_sent_message_id_fkey FOREIGN KEY (sent_message_id) REFERENCES public.messages(id) ON DELETE SET NULL,
  CONSTRAINT agent_drafts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.agent_drafts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.agent_drafts IS 'Respuestas del agente que esperan aprobacion humana (modo borrador). No son mensajes: nada de aca se envia ni cuenta como salida hasta que una persona lo aprueba.';
COMMENT ON COLUMN public.agent_drafts.status IS 'pending: espera decision. sending: saliendo en este instante (lo toma quien aprueba). sent: salio. failed: el envio fallo, se puede reintentar. discarded: alguien lo descarto, o hubo una respuesta real por otro lado. superseded: el lead escribio antes de que se aprobara. regenerated: alguien pidio otra version.';
COMMENT ON COLUMN public.agent_drafts.body IS 'Texto propuesto. NULL = "necesita respuesta humana" (el agente sugirio derivar o lo freno un guardarrail); el motivo esta en no_reply_reason.';
COMMENT ON COLUMN public.agent_drafts.no_reply_reason IS 'Por que no hay texto: escalate, guardrail:<cual> o error:<cual>.';
COMMENT ON COLUMN public.agent_drafts.suggested_actions IS 'Acciones que el agente sugirio y NO ejecuto (derivar, pausarse). Se aplican si la persona aprueba.';
COMMENT ON COLUMN public.agent_drafts.applied_actions IS 'Acciones que el agente YA aplico en ese turno (etiquetas, temperatura, seguimiento...), para mostrarlas en la cola. Se revierten desde la pestana Acciones.';
COMMENT ON COLUMN public.agent_drafts.burst_last_inbound_at IS 'El ultimo mensaje del lead que responde. La ventana de mensajeria se cuenta desde aca.';
COMMENT ON COLUMN public.agent_drafts.sendable_until IS 'Hasta cuando se puede enviar (burst_last_inbound_at + ventana del canal). NULL = el canal no tiene ventana. "No enviable" es un calculo sobre esto, no un estado.';
COMMENT ON COLUMN public.agent_drafts.alerted_thresholds IS 'Que cortes de la ventana ya se avisaron, como denominadores: 2 = mitad, 4 = cuarto, 8 = octavo. Sobrevive a un cambio de messaging_window_hours.';
COMMENT ON COLUMN public.agent_drafts.window_missed_at IS 'Cuando la ventana cerro con el borrador todavia sin enviar. El borrador pasa a expired en el mismo momento.';
COMMENT ON COLUMN public.agent_drafts.missed_while_assigned_to IS 'De quien era el borrador cuando se perdio la ventana (setter del contacto, o vendedor). Congelado: una reasignacion posterior no reescribe la historia.';
COMMENT ON COLUMN public.agent_drafts.sent_body IS 'Lo que se envio realmente. Distinto de body si se edito: esa diferencia es la metrica de calidad.';
REVOKE ALL ON TABLE public.agent_drafts FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.agent_drafts FROM authenticated;
GRANT UPDATE (status, sent_body, discard_reason, regenerate_instruction, decided_at, decided_by, updated_at) ON TABLE public.agent_drafts TO authenticated;

CREATE TABLE IF NOT EXISTS public.agent_run_steps (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  step_index integer NOT NULL,
  kind text NOT NULL,
  name text,
  input jsonb,
  output jsonb,
  kb_chunk_ids uuid[],
  audit_log_id uuid,
  duration_ms integer,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT agent_run_steps_pkey PRIMARY KEY (id),
  CONSTRAINT agent_run_steps_kind_values CHECK ((kind = ANY (ARRAY['model_call'::text, 'kb_search'::text, 'tool_call'::text, 'guardrail'::text]))),
  CONSTRAINT agent_run_steps_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  CONSTRAINT agent_run_steps_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.agent_run_steps IS 'Detalle tecnico de cada run: una fila por llamada al modelo, busqueda en la KB o herramienta. input/output pueden tener texto del lead: siguen la retencion de los mensajes y nunca van a los logs.';
REVOKE ALL ON TABLE public.agent_run_steps FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.agent_run_steps FROM authenticated;

-- ----------------------------------------------------------------------------
-- Claves foraneas hacia tablas de esta area
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE public.contact_status_changes ADD CONSTRAINT contact_status_changes_changed_by_agent_id_fkey FOREIGN KEY (changed_by_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.conversations ADD CONSTRAINT conversations_last_agent_error_run_id_fkey FOREIGN KEY (last_agent_error_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.message_texts ADD CONSTRAINT message_texts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.messages ADD CONSTRAINT messages_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.messages ADD CONSTRAINT messages_sent_by_agent_id_fkey FOREIGN KEY (sent_by_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.alert_draft_windows()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_since timestamptz;
  v_drafts integer := 0;
  v_notifications integer := 0;
BEGIN
  SELECT value::timestamptz INTO v_since FROM private.system_config WHERE key = 'draft_alerts_since';
  v_since := COALESCE(v_since, now());

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.draft_alerts (
    id uuid, workspace_id uuid, owner uuid, window_hours integer, new_cuts smallint[], deepest smallint
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.draft_alerts;

  -- Los borradores vivos con ventana abierta que cruzaron algun corte nuevo.
  -- FOR UPDATE: dos corridas superpuestas no avisan el mismo corte.
  INSERT INTO pg_temp.draft_alerts (id, workspace_id, owner, window_hours, new_cuts, deepest)
  SELECT x.id, x.workspace_id, x.owner, x.w, x.cuts, (SELECT max(t) FROM unnest(x.cuts) t)
  FROM (
    SELECT d.id, d.workspace_id, COALESCE(c.setter_id, c.vendedor_id) AS owner, w.w,
      ARRAY(
        SELECT t FROM unnest(ARRAY[2, 4, 8]::smallint[]) t
        WHERE (d.sendable_until - now()) <= make_interval(secs => w.w * 3600.0 / t)
          AND NOT (t = ANY (d.alerted_thresholds))
      ) AS cuts
    FROM public.agent_drafts d
    JOIN public.channels ch ON ch.id = d.channel_id
    JOIN public.contacts c ON c.id = d.contact_id
    CROSS JOIN LATERAL (SELECT public.messaging_window_hours(ch.platform, ch.messaging_window_hours) AS w) w
    WHERE d.status IN ('pending', 'failed')
      AND d.sendable_until IS NOT NULL
      AND d.sendable_until > now()
      AND d.created_at >= v_since
      AND w.w > 0
    FOR UPDATE OF d SKIP LOCKED
  ) x
  WHERE cardinality(x.cuts) > 0;

  -- Se anotan TODOS los cortes cruzados.
  UPDATE public.agent_drafts d
  SET alerted_thresholds = d.alerted_thresholds || a.new_cuts
  FROM pg_temp.draft_alerts a
  WHERE d.id = a.id;
  GET DIAGNOSTICS v_drafts = ROW_COUNT;

  -- Y se avisa solo el mas profundo, agrupado por persona, corte y ventana.
  INSERT INTO public.notifications (workspace_id, type, title, body, entity_type, entity_id, recipient_id, metadata)
  SELECT
    g.workspace_id,
    'draft_window',
    format(
      '%s borrador%s %s con menos de %s de ventana',
      g.n,
      CASE WHEN g.n = 1 THEN '' ELSE 'es' END,
      CASE WHEN g.owner IS NULL THEN 'sin asignar'
           WHEN g.n = 1 THEN 'tuyo' ELSE 'tuyos' END,
      CASE WHEN g.window_hours % g.deepest = 0 THEN (g.window_hours / g.deepest)::text || ' h'
           ELSE round(g.window_hours::numeric / g.deepest * 60)::text || ' min' END
    ),
    CASE WHEN g.owner IS NULL
      THEN 'Nadie los tiene asignados. Pasada la ventana, la plataforma ya no deja responder.'
      ELSE 'Pasada la ventana, la plataforma ya no deja responder: quedan para responder a mano.' END,
    'draft_queue',
    NULL,
    g.owner,
    jsonb_build_object('threshold', g.deepest, 'count', g.n, 'draft_ids', to_jsonb(g.ids), 'unassigned', g.owner IS NULL)
  FROM (
    SELECT workspace_id, owner, deepest, window_hours, count(*) AS n, array_agg(id) AS ids
    FROM pg_temp.draft_alerts
    GROUP BY workspace_id, owner, deepest, window_hours
  ) g;
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  RETURN jsonb_build_object('drafts', v_drafts, 'notifications', v_notifications);
END;
$function$;
COMMENT ON FUNCTION private.alert_draft_windows() IS 'Avisos de ventana de los borradores: agregados por persona y corte (mitad, cuarto, octavo de la ventana del canal), idempotentes por agent_drafts.alerted_thresholds, solo para borradores creados despues de draft_alerts_since (private.system_config). Los sin asignar van a Owner/Admin.';
REVOKE ALL ON FUNCTION private.alert_draft_windows() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.sweep_agent_drafts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_failed integer := 0;
  v_missed integer := 0;
BEGIN
  UPDATE public.agent_drafts
  SET status = 'failed',
      send_error = 'send_timeout'
  WHERE status = 'sending'
    AND updated_at < now() - interval '5 minutes';
  GET DIAGNOSTICS v_failed = ROW_COUNT;

  UPDATE public.agent_drafts d
  SET status = 'expired',
      decided_at = now(),
      window_missed_at = COALESCE(d.window_missed_at, now()),
      missed_while_assigned_to = COALESCE(d.missed_while_assigned_to, (
        SELECT COALESCE(c.setter_id, c.vendedor_id)
        FROM public.contacts c
        WHERE c.id = d.contact_id
      ))
  WHERE d.status IN ('pending', 'failed')
    AND d.sendable_until IS NOT NULL
    AND d.sendable_until < now();
  GET DIAGNOSTICS v_missed = ROW_COUNT;

  RETURN jsonb_build_object('sending_failed', v_failed, 'windows_missed', v_missed);
END;
$function$;
COMMENT ON FUNCTION private.sweep_agent_drafts() IS 'Barrido de borradores cada 5 minutos: envios colgados pasan a failed, y un borrador cuya ventana cerro sin enviarse pasa a expired (con window_missed_at y missed_while_assigned_to).';
REVOKE ALL ON FUNCTION private.sweep_agent_drafts() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.claim_agent_reply(p_conversation_id uuid, p_inbound_at timestamp with time zone, p_run_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_answered boolean;
BEGIN
  -- Serializa contra otro turno del agente sobre la misma conversación. Se
  -- libera al terminar la transacción (commit o rollback): un turno que muere
  -- nunca deja el lock tomado.
  PERFORM pg_advisory_xact_lock(hashtext(p_conversation_id::text));

  SELECT EXISTS (
    SELECT 1 FROM public.messages
    WHERE conversation_id = p_conversation_id
      AND direction = 'outbound'
      AND created_at > p_inbound_at
      AND status <> 'failed'
      AND (p_run_id IS NULL OR agent_run_id IS DISTINCT FROM p_run_id)
  ) INTO v_answered;

  RETURN v_answered;
END;
$function$;
COMMENT ON FUNCTION public.claim_agent_reply(p_conversation_id uuid, p_inbound_at timestamp with time zone, p_run_id uuid) IS 'Bajo un advisory lock por conversación: true si ya hay un saliente posterior al inbound del turno que no es el propio run.';
REVOKE ALL ON FUNCTION public.claim_agent_reply(p_conversation_id uuid, p_inbound_at timestamp with time zone, p_run_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ensure_default_agents(p_workspace_id uuid, p_provider text, p_model text, p_chat_prompt text, p_copywriter_instructions text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_provider text := nullif(btrim(coalesce(p_provider, '')), '');
  v_model text := nullif(btrim(coalesce(p_model, '')), '');
  v_chat_prompt text := btrim(coalesce(p_chat_prompt, ''));
  v_copy_text text := btrim(coalesce(p_copywriter_instructions, ''));
  v_chat_id uuid;
  v_copy_id uuid;
  v_models_set integer := 0;
BEGIN
  IF p_workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = p_workspace_id) THEN
    RAISE EXCEPTION 'El workspace no existe.' USING ERRCODE = '22023';
  END IF;
  IF (v_provider IS NULL) <> (v_model IS NULL) THEN
    RAISE EXCEPTION 'El proveedor y el modelo van juntos.' USING ERRCODE = '22023';
  END IF;
  IF length(v_chat_prompt) < 20 OR length(v_copy_text) < 20 THEN
    RAISE EXCEPTION 'Faltan los textos iniciales de los agentes.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ensure_default_agents:' || p_workspace_id::text, 0));

  -- 1. El agente de chat, solo si el negocio nunca tuvo uno.
  IF NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.workspace_id = p_workspace_id AND a.type = 'chat') THEN
    INSERT INTO public.agents (workspace_id, name, type, is_enabled, system_prompt, active_prompt_version, provider, model)
    VALUES (p_workspace_id, 'Asistente de conversacion', 'chat', false, v_chat_prompt, 1, v_provider, v_model)
    RETURNING id INTO v_chat_id;

    INSERT INTO public.agent_prompt_versions (workspace_id, agent_id, version, system_prompt, note)
    VALUES (p_workspace_id, v_chat_id, 1, v_chat_prompt, 'Prompt inicial');
  END IF;

  -- 2. El modelo, solo donde no hay ninguno elegido.
  IF v_provider IS NOT NULL THEN
    UPDATE public.agents a
       SET provider = v_provider, model = v_model
     WHERE a.workspace_id = p_workspace_id
       AND a.deleted_at IS NULL
       AND a.type IN ('chat', 'copywriter')
       AND a.provider IS NULL;
    GET DIAGNOSTICS v_models_set = ROW_COUNT;
  END IF;

  -- 3. Las instrucciones del copywriter, solo si nunca se escribieron.
  SELECT a.id INTO v_copy_id
    FROM public.agents a
   WHERE a.workspace_id = p_workspace_id
     AND a.type = 'copywriter'
     AND a.deleted_at IS NULL
     AND btrim(coalesce(a.system_prompt, '')) = ''
     AND NOT EXISTS (SELECT 1 FROM public.agent_prompt_versions v WHERE v.agent_id = a.id)
   FOR UPDATE;

  IF v_copy_id IS NOT NULL THEN
    INSERT INTO public.agent_prompt_versions (workspace_id, agent_id, version, system_prompt, note)
    VALUES (p_workspace_id, v_copy_id, 1, v_copy_text, 'Instrucciones iniciales');

    UPDATE public.agents SET system_prompt = v_copy_text, active_prompt_version = 1 WHERE id = v_copy_id;
  END IF;

  RETURN jsonb_build_object(
    'chat_agent_created', v_chat_id IS NOT NULL,
    'chat_agent_id', v_chat_id,
    'models_set', v_models_set,
    'copywriter_instructions_set', v_copy_id IS NOT NULL
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.ensure_default_agents(p_workspace_id uuid, p_provider text, p_model text, p_chat_prompt text, p_copywriter_instructions text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks_filtered(p_workspace_id uuid, p_query_embedding extensions.vector, p_match_count integer, p_min_similarity double precision, p_tags text[], p_include_internal boolean)
 RETURNS TABLE(chunk_id uuid, document_id uuid, document_title text, chunk_index integer, content text, similarity double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;

  -- Mismo chequeo que match_knowledge_chunks (ver ahi por que va el coalesce).
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this workspace';
  END IF;

  RETURN QUERY
  SELECT
    kc.id,
    kc.document_id,
    kb.title,
    kc.chunk_index,
    kc.content,
    (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding))::double precision
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_base kb ON kb.id = kc.document_id
  WHERE kc.workspace_id = p_workspace_id
    AND kb.deleted_at IS NULL
    AND (COALESCE(p_include_internal, false) OR kb.internal_only = false)
    AND (p_tags IS NULL OR cardinality(p_tags) = 0 OR kb.tags && p_tags)
    AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= COALESCE(p_min_similarity, 0)
  ORDER BY kc.embedding OPERATOR(extensions.<=>) p_query_embedding
  LIMIT GREATEST(COALESCE(p_match_count, 8), 1);
END;
$function$;
COMMENT ON FUNCTION public.match_knowledge_chunks_filtered(p_workspace_id uuid, p_query_embedding extensions.vector, p_match_count integer, p_min_similarity double precision, p_tags text[], p_include_internal boolean) IS 'Busqueda semantica con el filtro de acceso del agente adentro de la consulta: tags permitidos (vacio = todos) y exclusion de documentos internal_only. El contenido excluido nunca sale de la base.';
REVOKE ALL ON FUNCTION public.match_knowledge_chunks_filtered(p_workspace_id uuid, p_query_embedding extensions.vector, p_match_count integer, p_min_similarity double precision, p_tags text[], p_include_internal boolean) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(p_workspace_id uuid, p_query_embedding extensions.vector, p_match_count integer DEFAULT 8, p_min_similarity double precision DEFAULT 0.0)
 RETURNS TABLE(chunk_id uuid, document_id uuid, document_title text, chunk_index integer, content text, similarity double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;

  -- coalesce y no auth.role() pelado: una conexion sin JWT devuelve NULL, y
  -- "NULL <> 'service_role' AND ..." evalua a NULL, con lo cual el IF no entra
  -- y el chequeo de permiso se saltea solo. Con coalesce, sin rol conocido se
  -- exige pertenencia al workspace, que es el lado seguro.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this workspace';
  END IF;

  RETURN QUERY
  SELECT
    kc.id,
    kc.document_id,
    kb.title,
    kc.chunk_index,
    kc.content,
    (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding))::double precision
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_base kb ON kb.id = kc.document_id
  WHERE kc.workspace_id = p_workspace_id
    AND kb.deleted_at IS NULL
    AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= p_min_similarity
  ORDER BY kc.embedding OPERATOR(extensions.<=>) p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
END;
$function$;
COMMENT ON FUNCTION public.match_knowledge_chunks(p_workspace_id uuid, p_query_embedding extensions.vector, p_match_count integer, p_min_similarity double precision) IS 'Busqueda semantica sobre la base de conocimiento. Recibe el embedding de la consulta (Voyage voyage-4-lite, 1024 dim, input_type=query) y devuelve los fragmentos mas parecidos.';
REVOKE ALL ON FUNCTION public.match_knowledge_chunks(p_workspace_id uuid, p_query_embedding extensions.vector, p_match_count integer, p_min_similarity double precision) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.seed_copywriter_agent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Apagado y sin prompt propio: la voz de marca se carga desde la pantalla.
  INSERT INTO public.agents (workspace_id, name, type, is_enabled, system_prompt)
  VALUES (
    NEW.id,
    'Copywriter de contenido',
    'copywriter',
    false,
    ''
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sum_ai_spend(p_workspace_id uuid, p_since timestamp with time zone, p_agent_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(SUM(r.cost_usd), 0)
  FROM public.agent_runs r
  WHERE r.workspace_id = p_workspace_id
    AND r.created_at >= p_since
    AND (p_agent_id IS NULL OR r.agent_id = p_agent_id);
$function$;
COMMENT ON FUNCTION public.sum_ai_spend(p_workspace_id uuid, p_since timestamp with time zone, p_agent_id uuid) IS 'Gasto de IA en USD desde un instante: de todo el workspace o de un agente. Lo usan los topes de gasto antes de cada llamada. Solo service role.';
REVOKE ALL ON FUNCTION public.sum_ai_spend(p_workspace_id uuid, p_since timestamp with time zone, p_agent_id uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS agent_drafts_one_open_per_conversation ON public.agent_drafts USING btree (conversation_id) WHERE (status = ANY (ARRAY['pending'::text, 'sending'::text, 'failed'::text]));

CREATE INDEX IF NOT EXISTS idx_agent_drafts_contact ON public.agent_drafts USING btree (contact_id);

CREATE INDEX IF NOT EXISTS idx_agent_drafts_conversation ON public.agent_drafts USING btree (conversation_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_drafts_queue ON public.agent_drafts USING btree (workspace_id, status, sendable_until, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_drafts_run ON public.agent_drafts USING btree (run_id) WHERE (run_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_agent_run_steps_audit ON public.agent_run_steps USING btree (audit_log_id) WHERE (audit_log_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created ON public.agent_runs USING btree (agent_id, created_at DESC) WHERE (agent_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation ON public.agent_runs USING btree (conversation_id, created_at DESC) WHERE (conversation_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_agent_runs_response_time ON public.agent_runs USING btree (workspace_id, inbound_at) WHERE (responded_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_agent_runs_running ON public.agent_runs USING btree (created_at) WHERE (status = 'running'::text);

CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON public.agent_runs USING btree (status);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_created ON public.agent_runs USING btree (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_source_created ON public.agent_runs USING btree (workspace_id, source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agents_enabled_channels ON public.agents USING gin (enabled_channel_ids) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_agents_workspace ON public.agents USING btree (workspace_id) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_deleted ON public.knowledge_base USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_tags ON public.knowledge_base USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_ws_created ON public.knowledge_base USING btree (workspace_id, created_at DESC) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_chunks_doc_index ON public.knowledge_chunks USING btree (document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON public.knowledge_chunks USING hnsw (embedding extensions.vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_ws ON public.knowledge_chunks USING btree (workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_prompt_versions_agent_version ON public.agent_prompt_versions USING btree (agent_id, version);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_run_steps_run_index ON public.agent_run_steps USING btree (run_id, step_index);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_copywriter_por_workspace ON public.agents USING btree (workspace_id) WHERE ((type = 'copywriter'::text) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_task_prompt_versions_workspace_task_version ON public.ai_task_prompt_versions USING btree (workspace_id, task, version);

CREATE UNIQUE INDEX IF NOT EXISTS uq_model_pricing_version ON public.model_pricing USING btree (workspace_id, provider, model, valid_from);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER set_updated_at_agent_drafts BEFORE UPDATE ON public.agent_drafts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_agents BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_knowledge_base BEFORE UPDATE ON public.knowledge_base FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_model_pricing BEFORE UPDATE ON public.model_pricing FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER seed_copywriter_on_workspace AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.seed_copywriter_agent();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY agent_drafts_select ON public.agent_drafts FOR SELECT TO public
    USING ((public.is_workspace_admin(workspace_id) OR (public.is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.conversations conv
  WHERE (conv.id = agent_drafts.conversation_id))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agent_drafts_update ON public.agent_drafts FOR UPDATE TO public
    USING (((status = ANY (ARRAY['pending'::text, 'failed'::text])) AND (public.is_workspace_admin(workspace_id) OR (public.is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.conversations conv
  WHERE (conv.id = agent_drafts.conversation_id)))))))
    WITH CHECK (((status = ANY (ARRAY['sending'::text, 'discarded'::text, 'regenerated'::text])) AND (decided_by = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agent_prompt_versions_insert ON public.agent_prompt_versions FOR INSERT TO public
    WITH CHECK ((( SELECT public.has_permission(agent_prompt_versions.workspace_id, 'agents.edit'::text) AS has_permission) AND (created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.agents a
  WHERE ((a.id = agent_prompt_versions.agent_id) AND (a.workspace_id = agent_prompt_versions.workspace_id))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agent_prompt_versions_select ON public.agent_prompt_versions FOR SELECT TO public
    USING (( SELECT public.has_permission(agent_prompt_versions.workspace_id, 'agents.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agent_run_steps_select ON public.agent_run_steps FOR SELECT TO public
    USING ((public.is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.agent_runs r
  WHERE (r.id = agent_run_steps.run_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agent_runs_select ON public.agent_runs FOR SELECT TO public
    USING ((public.is_workspace_admin(workspace_id) OR (public.is_workspace_member(workspace_id) AND (conversation_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.conversations conv
  WHERE (conv.id = agent_runs.conversation_id))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agents_insert ON public.agents FOR INSERT TO public
    WITH CHECK (( SELECT public.has_permission(agents.workspace_id, 'agents.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agents_select ON public.agents FOR SELECT TO public
    USING ((public.is_workspace_member(workspace_id) AND (deleted_at IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agents_update ON public.agents FOR UPDATE TO public
    USING (( SELECT public.has_permission(agents.workspace_id, 'agents.edit'::text) AS has_permission))
    WITH CHECK (( SELECT public.has_permission(agents.workspace_id, 'agents.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_task_prompt_versions_insert ON public.ai_task_prompt_versions FOR INSERT TO public
    WITH CHECK ((( SELECT public.has_permission(ai_task_prompt_versions.workspace_id, 'ai_tasks.manage'::text) AS has_permission) AND (created_by = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_task_prompt_versions_select ON public.ai_task_prompt_versions FOR SELECT TO public
    USING (( SELECT public.has_permission(ai_task_prompt_versions.workspace_id, 'ai_tasks.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY knowledge_base_delete ON public.knowledge_base FOR DELETE TO public
    USING (( SELECT public.has_permission(knowledge_base.workspace_id, 'knowledge.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY knowledge_base_insert ON public.knowledge_base FOR INSERT TO public
    WITH CHECK (( SELECT public.has_permission(knowledge_base.workspace_id, 'knowledge.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY knowledge_base_select ON public.knowledge_base FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY knowledge_base_update ON public.knowledge_base FOR UPDATE TO public
    USING (( SELECT public.has_permission(knowledge_base.workspace_id, 'knowledge.edit'::text) AS has_permission))
    WITH CHECK (( SELECT public.has_permission(knowledge_base.workspace_id, 'knowledge.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY knowledge_chunks_select ON public.knowledge_chunks FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY model_pricing_delete ON public.model_pricing FOR DELETE TO public
    USING (public.is_workspace_owner(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY model_pricing_insert ON public.model_pricing FOR INSERT TO public
    WITH CHECK (public.is_workspace_owner(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY model_pricing_select ON public.model_pricing FOR SELECT TO public
    USING (public.is_workspace_admin(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY model_pricing_update ON public.model_pricing FOR UPDATE TO public
    USING (public.is_workspace_owner(workspace_id))
    WITH CHECK (public.is_workspace_owner(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Tiempo real
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_drafts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
