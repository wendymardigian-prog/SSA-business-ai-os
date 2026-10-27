-- ============================================================================
-- Bandeja
--
-- La bandeja multicanal: conversaciones (una por canal y contacto) y sus mensajes,
-- reacciones, llamadas de WhatsApp, stickers, comentarios de Instagram, el responsable
-- de cada chat y sus reglas de asignacion por cuenta, el tope de envios automaticos por
-- hora, los patrones de mensajes y el registro de emails salientes.
--
-- Un disparador sobre messages mantiene en la conversacion el ultimo mensaje, los no
-- leidos y si el lead esta esperando respuesta. Un Member ve una conversacion segun lo
-- que su rol tiene en esa cuenta (can_see_conversation).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.channel_send_windows (
  channel_id uuid NOT NULL,
  window_start timestamp with time zone NOT NULL,
  sent_count integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT channel_send_windows_pkey PRIMARY KEY (channel_id, window_start),
  CONSTRAINT channel_send_windows_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE
);
ALTER TABLE public.channel_send_windows ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.channel_send_windows IS 'Contador de mensajes automatizados por canal y por hora. Sostiene el tope de la API de Instagram (200/hora).';

CREATE TABLE IF NOT EXISTS public.comment_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  channel_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  post_id text,
  platform_comment_id text NOT NULL,
  author_id text,
  author_name text,
  author_username text,
  comment_text text NOT NULL,
  matched_trigger_id uuid,
  dm_sent boolean DEFAULT false NOT NULL,
  reply_sent boolean DEFAULT false NOT NULL,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT comment_logs_pkey PRIMARY KEY (id),
  CONSTRAINT comment_logs_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE,
  CONSTRAINT comment_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.comment_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.conversation_assignment_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text DEFAULT ''::text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  channel_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  mode text DEFAULT 'fixed'::text NOT NULL,
  member_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  last_assigned_member_id uuid,
  setter_mode text DEFAULT 'none'::text NOT NULL,
  archived_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT conversation_assignment_rules_pkey PRIMARY KEY (id),
  CONSTRAINT conversation_assignment_rules_members_max CHECK (((cardinality(member_ids) <= 50) AND (cardinality(channel_ids) <= 100))),
  CONSTRAINT conversation_assignment_rules_mode_check CHECK ((mode = ANY (ARRAY['fixed'::text, 'round_robin'::text]))),
  CONSTRAINT conversation_assignment_rules_name_length CHECK ((char_length(name) <= 80)),
  CONSTRAINT conversation_assignment_rules_setter_mode_check CHECK ((setter_mode = ANY (ARRAY['none'::text, 'if_empty'::text, 'overwrite'::text]))),
  CONSTRAINT conversation_assignment_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT conversation_assignment_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT conversation_assignment_rules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.conversation_assignment_rules ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.conversation_assignment_rules IS 'Reglas de asignacion de conversaciones nuevas por cuenta conectada. Gana la primera activa que coincide (position). Escribe solo el servidor.';
REVOKE ALL ON TABLE public.conversation_assignment_rules FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.conversation_assignment_rules FROM authenticated;

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  late_conversation_id text,
  platform text NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  assigned_to uuid,
  last_message_at timestamp with time zone,
  last_message_preview text,
  unread_count integer DEFAULT 0 NOT NULL,
  is_automation_paused boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  agent_enabled boolean,
  agent_paused_until timestamp with time zone,
  last_agent_error_at timestamp with time zone,
  last_agent_error_run_id uuid,
  closed_at timestamp with time zone,
  summarized_at timestamp with time zone,
  agent_disabled_by_tag_id uuid,
  needs_human boolean DEFAULT false NOT NULL,
  needs_human_reason text,
  needs_human_at timestamp with time zone,
  agent_disabled_by_known boolean DEFAULT false NOT NULL,
  awaiting_reply_since timestamp with time zone,
  awaiting_last_inbound_at timestamp with time zone,
  reply_window_until timestamp with time zone,
  no_reply_needed_at timestamp with time zone,
  no_reply_needed_reason text,
  no_reply_needed_by uuid,
  last_message_direction text,
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_channel_id_contact_id_key UNIQUE (channel_id, contact_id),
  CONSTRAINT conversations_last_message_direction_check CHECK (((last_message_direction IS NULL) OR (last_message_direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))),
  CONSTRAINT conversations_no_reply_complete CHECK (((no_reply_needed_at IS NULL) = (no_reply_needed_reason IS NULL))),
  CONSTRAINT conversations_no_reply_reason_values CHECK (((no_reply_needed_reason IS NULL) OR (no_reply_needed_reason = ANY (ARRAY['rule'::text, 'agent'::text, 'manual'::text])))),
  CONSTRAINT conversations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'snoozed'::text]))),
  CONSTRAINT conversations_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT conversations_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE,
  CONSTRAINT conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT conversations_no_reply_needed_by_fkey FOREIGN KEY (no_reply_needed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.conversations.deleted_at IS 'Borrado logico. Retencion de 30 dias, despues lo purga /api/cron/purge-deleted.';
COMMENT ON COLUMN public.conversations.agent_enabled IS 'Agente de IA en esta conversacion, tres estados. NULL = hereda del canal (el maestro de agents.enabled_channel_ids decide). true = forzado prendido. false = forzado apagado: lo pone Human Takeover, una respuesta manual del operador o una persona desde la bandeja. Ortogonal a is_automation_paused (flows) y a agent_paused_until (pausa de un flow).';
COMMENT ON COLUMN public.conversations.agent_paused_until IS 'Pausa temporal del agente puesta por un flow ("pausar agente"). NULL = sin pausa, infinity = hasta que un flow lo reanude. Reanudar la levanta sin tocar agent_enabled.';
COMMENT ON COLUMN public.conversations.last_agent_error_at IS 'El agente fallo en esta conversacion y el lead puede estar sin respuesta. Se pone con un turno en error, descartado o con el proveedor caido despues del respaldo. Se borra con una respuesta buena del agente, un mensaje de una persona del equipo o el cierre de la conversacion. No se borra por paso del tiempo ni porque el lead vuelva a escribir.';
COMMENT ON COLUMN public.conversations.closed_at IS 'Cuando se cerro por ultima vez (a mano o por inactividad). Se conserva al reabrir.';
COMMENT ON COLUMN public.conversations.summarized_at IS 'Hasta que instante estan incorporados sus mensajes al resumen del contacto. Un cierre sin mensajes posteriores no genera otro resumen.';
COMMENT ON COLUMN public.conversations.agent_disabled_by_tag_id IS 'La etiqueta que apago el agente aca. Se limpia sola si una persona cambia el estado del agente.';
COMMENT ON COLUMN public.conversations.needs_human IS 'El agente no pudo interpretar lo que llego y escalo. Se limpia cuando una persona responde o marca "Ya lo vi".';
COMMENT ON COLUMN public.conversations.needs_human_reason IS 'Por que escalo, en castellano y en una linea: es lo que lee la persona que la toma.';
COMMENT ON COLUMN public.conversations.agent_disabled_by_known IS 'El agente lo apago la marca de conocido. Se limpia sola si una persona cambia el estado del agente.';
COMMENT ON COLUMN public.conversations.awaiting_reply_since IS 'Primer mensaje del lead sin responder. NULL = el ultimo mensaje que importa es nuestro. Lo mantiene el trigger de messages.';
COMMENT ON COLUMN public.conversations.awaiting_last_inbound_at IS 'Ultimo mensaje del lead sin responder: de aca corre la ventana de mensajeria. Lo mantiene el trigger de messages.';
COMMENT ON COLUMN public.conversations.reply_window_until IS 'Hasta cuando se puede responder desde el sistema (awaiting_last_inbound_at + ventana del canal). NULL = sin ventana o no espera.';
COMMENT ON COLUMN public.conversations.no_reply_needed_at IS 'La tanda sin responder no pide respuesta (un gracias, un emoji). Se borra sola cuando el lead vuelve a escribir o le respondemos.';
COMMENT ON COLUMN public.conversations.no_reply_needed_reason IS 'Quien lo decidio: rule (regla de cierre), agent (el agente) o manual (una persona).';
COMMENT ON COLUMN public.conversations.last_message_direction IS 'Si el ultimo mensaje de la conversacion fue del contacto (inbound) o nuestro (outbound). Lo mantiene el trigger messages_zz_last_message.';

CREATE TABLE IF NOT EXISTS public.email_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  provider_message_id text,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  related_entity_type text,
  related_entity_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  contact_id uuid,
  CONSTRAINT email_log_pkey PRIMARY KEY (id),
  CONSTRAINT email_log_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped_not_configured'::text]))),
  CONSTRAINT email_log_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT email_log_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT email_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.email_log IS 'Emails salientes intentados. skipped_not_configured = no habia Resend conectado al momento del envio.';
COMMENT ON COLUMN public.email_log.contact_id IS 'El contacto al que se refiere el email (el que lo recibe, o sobre quien trata un aviso al equipo). NULL en los emails del sistema.';

CREATE TABLE IF NOT EXISTS public.message_categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  direction text NOT NULL,
  name text NOT NULL,
  description text,
  examples text[] DEFAULT '{}'::text[] NOT NULL,
  is_fallback boolean DEFAULT false NOT NULL,
  created_by text NOT NULL,
  created_by_user_id uuid,
  merged_into_id uuid,
  archived_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT message_categories_pkey PRIMARY KEY (id),
  CONSTRAINT message_categories_created_by_check CHECK ((created_by = ANY (ARRAY['model'::text, 'user'::text, 'system'::text]))),
  CONSTRAINT message_categories_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))),
  CONSTRAINT message_categories_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT message_categories_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES public.message_categories(id) ON DELETE SET NULL,
  CONSTRAINT message_categories_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.message_categories ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.message_texts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  direction text NOT NULL,
  normalized_text text NOT NULL,
  sample_text text NOT NULL,
  category_id uuid,
  confidence numeric(3,2),
  source text,
  prompt_version integer,
  run_id uuid,
  is_button boolean DEFAULT false NOT NULL,
  classified_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  review_result text,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT message_texts_pkey PRIMARY KEY (id),
  CONSTRAINT message_texts_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))),
  CONSTRAINT message_texts_review_result_check CHECK ((review_result = ANY (ARRAY['ok'::text, 'corrected'::text]))),
  CONSTRAINT message_texts_source_check CHECK ((source = ANY (ARRAY['rule'::text, 'model'::text, 'human'::text]))),
  CONSTRAINT message_texts_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.message_categories(id) ON DELETE SET NULL,
  CONSTRAINT message_texts_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT message_texts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.message_texts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  direction text NOT NULL,
  text text,
  attachments jsonb,
  quick_reply_payload text,
  postback_payload text,
  callback_data text,
  platform_message_id text,
  sent_by_flow_id uuid,
  sent_by_node_id text,
  sent_by_user_id uuid,
  status text DEFAULT 'sent'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  workspace_id uuid NOT NULL,
  sent_by_agent_id uuid,
  platform_native_message_id text,
  agent_run_id uuid,
  origin text,
  text_norm text GENERATED ALWAYS AS (public.normalize_for_grouping(text)) STORED,
  email_subject text,
  email_message_id text,
  email_in_reply_to text,
  email_references text,
  email_from text,
  email_to jsonb,
  email_cc jsonb,
  media_description text,
  interpretability text DEFAULT 'unknown'::text NOT NULL,
  transcript text,
  transcript_status text DEFAULT 'none'::text NOT NULL,
  transcript_error text,
  transcript_seconds numeric,
  transcript_started_at timestamp with time zone,
  origin_context jsonb,
  send_error text,
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))),
  CONSTRAINT messages_interpretability_check CHECK ((interpretability = ANY (ARRAY['text'::text, 'transcribed'::text, 'described'::text, 'label_only'::text, 'unreadable'::text, 'unknown'::text]))),
  CONSTRAINT messages_origin_values CHECK (((origin IS NULL) OR (origin = ANY (ARRAY['agent'::text, 'user'::text, 'flow'::text, 'sequence'::text, 'broadcast'::text, 'external'::text])))),
  CONSTRAINT messages_outbound_has_origin CHECK (((direction <> 'outbound'::text) OR (origin IS NOT NULL))),
  CONSTRAINT messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'failed'::text]))),
  CONSTRAINT messages_transcript_status_check CHECK ((transcript_status = ANY (ARRAY['none'::text, 'pending'::text, 'ready'::text, 'failed'::text]))),
  CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE,
  CONSTRAINT messages_sent_by_user_id_fkey FOREIGN KEY (sent_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.messages IS 'Mensajes de todos los canales, entrantes y salientes. SELECT e INSERT exigen ver la conversacion (de ahi sale el alcance de leads) ademas de ser miembro del workspace. UPDATE y DELETE no tienen policy a proposito: solo el service role escribe estados y solo la purga borra.';
COMMENT ON COLUMN public.messages.workspace_id IS 'Denormalizado desde conversations. Lo completa el trigger messages_fill_workspace_id, asi que ningun insert tiene que acordarse. Existe para que los dashboards agrupen sin join; NO reemplaza al EXISTS de la policy, que es de donde sale el scope de leads.';
COMMENT ON COLUMN public.messages.sent_by_agent_id IS 'Que agente de IA mando este mensaje.';
COMMENT ON COLUMN public.messages.platform_native_message_id IS 'Id que le dio la plataforma al mensaje (Instagram via Meta), distinto del de platform_message_id, que es el de Zernio. Solo lo trae el webhook en vivo: el endpoint de historial no lo devuelve, asi que los mensajes del backfill lo tienen en null. Es el handle para pedidos de borrado o soporte contra Meta.';
COMMENT ON COLUMN public.messages.agent_run_id IS 'Run del agente que genero este mensaje. Desde la bandeja se abre el run; desde el run se salta a la conversacion.';
COMMENT ON COLUMN public.messages.origin IS 'De donde salio el saliente: agent, user, flow, sequence, broadcast o external. null en entrantes. Lo escribe cada camino de envio; el trigger messages_fill_origin lo deriva si falta.';
COMMENT ON COLUMN public.messages.email_message_id IS 'El Message-ID del correo. Es con lo que el cliente de la otra persona arma el hilo.';
COMMENT ON COLUMN public.messages.email_references IS 'La cadena References acumulada: todos los Message-ID del hilo, en orden.';
COMMENT ON COLUMN public.messages.media_description IS 'Descripcion de la imagen generada por el modelo de vision. Es lo que lee el agente cuando el lead manda una captura sin texto.';
COMMENT ON COLUMN public.messages.interpretability IS 'Si el agente pudo entender este mensaje. Se guarda aunque se pueda calcular: permite contar los no interpretables sin recorrer los adjuntos de cada fila.';
COMMENT ON COLUMN public.messages.transcript IS 'Lo que dice el audio, en su idioma original. NUNCA se borra por retencion: es texto, pesa nada, y es el contexto del agente.';
COMMENT ON COLUMN public.messages.transcript_seconds IS 'Segundos de audio que cobro el proveedor. Los proveedores de transcripcion cobran por duracion, no por tokens.';
COMMENT ON COLUMN public.messages.transcript_started_at IS 'Cuando arranco la transcripcion. Es lo que usa el reaper: un pending de mas de 10 minutos se libera para que se pueda reintentar.';
COMMENT ON COLUMN public.messages.origin_context IS 'De donde vino un mensaje entrante: respuesta o mencion en una historia, anuncio (lista blanca, lib/messages/origin-context.ts). Null si no vino de ninguno.';
COMMENT ON COLUMN public.messages.send_error IS 'Por que no salio un envio (status failed), en castellano. El texto queda con lo que se quiso mandar.';

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid,
  platform_message_id text NOT NULL,
  emoji text NOT NULL,
  direction text NOT NULL,
  actor_key text NOT NULL,
  reacted_by_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  removed_at timestamp with time zone,
  CONSTRAINT message_reactions_pkey PRIMARY KEY (id),
  CONSTRAINT message_reactions_actor_values CHECK ((actor_key = ANY (ARRAY['business'::text, 'contact'::text]))),
  CONSTRAINT message_reactions_direction_values CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text]))),
  CONSTRAINT message_reactions_emoji_length CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 32))),
  CONSTRAINT message_reactions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE,
  CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE,
  CONSTRAINT message_reactions_reacted_by_user_id_fkey FOREIGN KEY (reacted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT message_reactions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.message_reactions IS 'Reacciones (emoji) a mensajes. No son mensajes: no cuentan como entrantes, no suman no leidos, no disparan flows ni al agente. Una por actor (business/contact) y mensaje. Solo el servidor escribe.';
REVOKE ALL ON TABLE public.message_reactions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.message_reactions FROM authenticated;

CREATE TABLE IF NOT EXISTS public.stickers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  mime_type text DEFAULT 'image/webp'::text NOT NULL,
  is_animated boolean DEFAULT false NOT NULL,
  size_bytes integer,
  source text NOT NULL,
  is_favorite boolean DEFAULT false NOT NULL,
  use_count integer DEFAULT 0 NOT NULL,
  last_used_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT stickers_pkey PRIMARY KEY (id),
  CONSTRAINT stickers_path_check CHECK ((storage_path = ((((workspace_id)::text || '/stickers/'::text) || sha256) || '.webp'::text))),
  CONSTRAINT stickers_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT stickers_source_check CHECK ((source = ANY (ARRAY['uploaded'::text, 'sent'::text, 'saved'::text]))),
  CONSTRAINT stickers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT stickers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.stickers IS 'Biblioteca de stickers de WhatsApp: los mandados se agregan solos, los recibidos se guardan con un boton, y se pueden subir. Archivo en chat-media/<ws>/stickers/<sha>.webp.';
REVOKE ALL ON TABLE public.stickers FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.stickers FROM authenticated;

CREATE TABLE IF NOT EXISTS public.whatsapp_calls (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  platform_call_id text NOT NULL,
  is_video boolean DEFAULT false NOT NULL,
  status text DEFAULT 'ringing'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  answered_at timestamp with time zone,
  ended_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT whatsapp_calls_pkey PRIMARY KEY (id),
  CONSTRAINT whatsapp_calls_status_check CHECK ((status = ANY (ARRAY['ringing'::text, 'answered'::text, 'missed'::text, 'rejected'::text]))),
  CONSTRAINT whatsapp_calls_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_calls_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_calls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.whatsapp_calls ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.whatsapp_calls IS 'Llamadas de WhatsApp recibidas: lo que avisa Evolution por el evento CALL. Se ven en el hilo; no son mensajes.';
REVOKE ALL ON TABLE public.whatsapp_calls FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.whatsapp_calls FROM authenticated;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.contact_is_mine(c public.contacts)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.setter_id = auth.uid()
      OR c.vendedor_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.conversations conv WHERE conv.contact_id = c.id AND conv.assigned_to = auth.uid())
$function$;
REVOKE ALL ON FUNCTION private.contact_is_mine(c public.contacts) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.contact_is_mine(c public.contacts) TO service_role;

CREATE OR REPLACE FUNCTION private.contact_is_unassigned(c public.contacts)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.setter_id IS NULL
     AND c.vendedor_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.conversations conv WHERE conv.contact_id = c.id AND conv.assigned_to IS NOT NULL)
$function$;
REVOKE ALL ON FUNCTION private.contact_is_unassigned(c public.contacts) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.contact_is_unassigned(c public.contacts) TO service_role;

CREATE OR REPLACE FUNCTION private.refresh_conversation_awaiting(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv record;
  v_reply_at timestamptz;
  v_reply_text text;
  v_since timestamptz;
  v_last timestamptz;
  v_all_closure boolean;
  v_window integer;
  v_until timestamptz;
BEGIN
  SELECT c.id, c.awaiting_last_inbound_at, ch.platform, ch.messaging_window_hours
  INTO v_conv
  FROM public.conversations c
  LEFT JOIN public.channels ch ON ch.id = c.channel_id
  WHERE c.id = p_conversation_id
  FOR UPDATE OF c;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT m.created_at, m.text INTO v_reply_at, v_reply_text
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.direction = 'outbound'
    AND m.status IS DISTINCT FROM 'failed'
  ORDER BY m.created_at DESC
  LIMIT 1;

  SELECT MIN(m.created_at), MAX(m.created_at),
         bool_and(public.chat_is_closure_message(m.text, m.attachments, v_reply_text))
  INTO v_since, v_last, v_all_closure
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.direction = 'inbound'
    AND (v_reply_at IS NULL OR m.created_at > v_reply_at);

  v_window := public.messaging_window_hours(v_conv.platform, v_conv.messaging_window_hours);
  v_until := CASE WHEN v_last IS NOT NULL AND v_window > 0 THEN v_last + make_interval(hours => v_window) END;

  IF v_last IS NOT DISTINCT FROM v_conv.awaiting_last_inbound_at THEN
    UPDATE public.conversations
    SET awaiting_reply_since = v_since,
        reply_window_until = v_until
    WHERE id = p_conversation_id
      AND (awaiting_reply_since IS DISTINCT FROM v_since OR reply_window_until IS DISTINCT FROM v_until);
    RETURN;
  END IF;

  UPDATE public.conversations
  SET awaiting_reply_since = v_since,
      awaiting_last_inbound_at = v_last,
      reply_window_until = v_until,
      no_reply_needed_at = CASE WHEN v_last IS NOT NULL AND COALESCE(v_all_closure, false) THEN now() END,
      no_reply_needed_reason = CASE WHEN v_last IS NOT NULL AND COALESCE(v_all_closure, false) THEN 'rule' END,
      no_reply_needed_by = NULL
  WHERE id = p_conversation_id;
END;
$function$;
COMMENT ON FUNCTION private.refresh_conversation_awaiting(p_conversation_id uuid) IS 'Recalcula awaiting_*, reply_window_until y la marca de la regla de cierre de una conversacion a partir de sus mensajes.';
REVOKE ALL ON FUNCTION private.refresh_conversation_awaiting(p_conversation_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.refresh_conversation_awaiting(p_conversation_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.assign_new_conversation(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  conv             public.conversations%ROWTYPE;
  r                public.conversation_assignment_rules%ROWTYPE;
  v_active         uuid[];
  v_pick           uuid;
  v_setter_old     uuid;
  v_setter_changed boolean := false;
BEGIN
  SELECT * INTO conv FROM public.conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF conv.assigned_to IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_assigned', 'assigned_to', conv.assigned_to);
  END IF;

  -- El chat de un conocido va a la persona de esa cuenta, sin reglas y
  -- sin tocar el setter.
  IF EXISTS (SELECT 1 FROM public.contacts ct WHERE ct.id = conv.contact_id AND ct.is_known) THEN
    v_pick := private.known_assignee(conv.workspace_id, conv.channel_id);
    IF v_pick IS NULL THEN
      RETURN jsonb_build_object('status', 'no_rule');
    END IF;
    UPDATE public.conversations SET assigned_to = v_pick WHERE id = conv.id;
    RETURN jsonb_build_object('status', 'assigned', 'assigned_to', v_pick, 'rule_id', NULL, 'rule_name', NULL,
      'source', 'known', 'contact_id', conv.contact_id, 'setter_changed', false, 'setter_old', NULL);
  END IF;

  SELECT coalesce(array_agg(wm.user_id), '{}'::uuid[]) INTO v_active
  FROM public.workspace_members wm
  WHERE wm.workspace_id = conv.workspace_id;

  FOR r IN
    SELECT *
    FROM public.conversation_assignment_rules car
    WHERE car.workspace_id = conv.workspace_id
      AND car.enabled
      AND car.archived_at IS NULL
      AND (cardinality(car.channel_ids) = 0 OR conv.channel_id = ANY (car.channel_ids))
    ORDER BY car.position, car.created_at, car.id
    FOR UPDATE
  LOOP
    v_pick := public.conversation_rule_pick(r.mode, r.member_ids, v_active, r.last_assigned_member_id);
    CONTINUE WHEN v_pick IS NULL;

    UPDATE public.conversations SET assigned_to = v_pick WHERE id = conv.id;

    IF r.mode = 'round_robin' THEN
      UPDATE public.conversation_assignment_rules SET last_assigned_member_id = v_pick WHERE id = r.id;
    END IF;

    IF r.setter_mode <> 'none' AND conv.contact_id IS NOT NULL THEN
      SELECT ct.setter_id INTO v_setter_old
      FROM public.contacts ct
      WHERE ct.id = conv.contact_id AND ct.deleted_at IS NULL
      FOR UPDATE;
      IF FOUND
         AND v_setter_old IS DISTINCT FROM v_pick
         AND (r.setter_mode = 'overwrite' OR v_setter_old IS NULL) THEN
        UPDATE public.contacts SET setter_id = v_pick WHERE id = conv.contact_id;
        v_setter_changed := true;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'status', 'assigned',
      'assigned_to', v_pick,
      'rule_id', r.id,
      'rule_name', r.name,
      'source', 'rule',
      'contact_id', conv.contact_id,
      'setter_changed', v_setter_changed,
      'setter_old', v_setter_old
    );
  END LOOP;

  RETURN jsonb_build_object('status', 'no_rule');
END;
$function$;
COMMENT ON FUNCTION public.assign_new_conversation(p_conversation_id uuid) IS 'Aplica conversation_assignment_rules a una conversacion recien creada. Solo service_role. Nunca pisa un responsable que ya tiene.';
REVOKE ALL ON FUNCTION public.assign_new_conversation(p_conversation_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_see_conversation(conv public.conversations)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_scope text;
  c       public.contacts;
BEGIN
  IF NOT public.is_workspace_member(conv.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(conv.workspace_id) THEN
    RETURN true;
  END IF;

  -- Lo que mi rol tiene en ESA cuenta. Sin acceso, no se ve, aunque el contacto sea mio.
  v_scope := private.role_channel_grant(private.my_channels(conv.workspace_id), conv.channel_id::text) ->> 'scope';
  IF v_scope IS NULL THEN
    RETURN false;
  END IF;
  IF v_scope = 'all' THEN
    RETURN true;
  END IF;

  SELECT * INTO c FROM public.contacts ct WHERE ct.id = conv.contact_id AND ct.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF private.contact_is_mine(c) THEN
    RETURN true;
  END IF;

  RETURN v_scope = 'own_unassigned' AND private.contact_is_unassigned(c);
END;
$function$;
COMMENT ON FUNCTION public.can_see_conversation(conv public.conversations) IS 'Se ve la conversacion si sos Admin, o si tu rol tiene acceso a esa CUENTA (permissions.channels): todas, las asignadas (setter, vendedor o conversacion a cargo) o las asignadas + las que nadie tiene.';
REVOKE ALL ON FUNCTION public.can_see_conversation(conv public.conversations) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.chat_is_closure_message(p_text text, p_attachments jsonb, p_last_reply text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_text text := btrim(COALESCE(p_text, ''));
  v_norm text;
  v_symbols text;
  v_words text[];
  v_kinds text[];
  v_vocab text[] := ARRAY[
    'gracias','graciass','gracia','grax','thanks','thank','thx','ty','you',
    'mil','muchas','muchisimas','muchisimo','mucho','infinitas',
    'de','nada','igualmente','vos','tambien','ti','a','para','el','la','lo','y','me','te',
    'chau','chao','adios','bye','saludos','saludo','abrazo','abrazos','abrazote',
    'beso','besos','besito','besitos','hasta','luego','pronto','manana','nos','vemos','hablamos',
    'buen','buena','buenas','dia','dias','noches','tardes','finde','semana','que','tengas',
    'ok','okey','oki','okis','oka','okay','dale','perfecto','perfecta','genial','listo','lista',
    'joya','buenisimo','buenisima','barbaro','barbara','copado','super','bien','bueno','excelente',
    'entendido','claro','re','muy','todo','ah','oh','wow','amo','love','hermoso','hermosa',
    'lindo','linda','encanta','encanto','gusto','un','una','sos','crack','idola','idolo',
    'increible','fantastico','no'
  ];
  -- Frases de una respuesta nuestra que dejan algo pendiente (PENDING_PROMISE_PHRASES).
  v_promises text[] := ARRAY[
    'dame un momento','dame un segundo','un momentito','un segundito','en breve','enseguida te',
    'ya te lo paso','ya te la paso','ya te paso','ya te lo mando','ya te la mando',
    'ahora te lo','ahora te la','te aviso'
  ];
  v_reply_norm text;
BEGIN
  -- Si nuestra ultima respuesta fue una pregunta, o prometio algo ("dame un
  -- momento", "ya te lo paso"), nada cierra: el lead sigue esperando.
  IF p_last_reply IS NOT NULL THEN
    IF position('?' IN p_last_reply) > 0 OR position('¿' IN p_last_reply) > 0 THEN
      RETURN false;
    END IF;
    v_reply_norm := regexp_replace(
      translate(lower(p_last_reply), 'áéíóúüñàèìòù', 'aeiouunaeiou'),
      '([a-z])\1{2,}', '\1', 'g'
    );
    IF EXISTS (SELECT 1 FROM unnest(v_promises) AS p WHERE position(p IN v_reply_norm) > 0) THEN
      RETURN false;
    END IF;
  END IF;

  IF v_text = '' THEN
    -- Sin texto: cierra solo si todos los adjuntos (formato v2) son stickers o GIFs.
    IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'object' OR p_attachments->>'v' <> '2'
       OR jsonb_typeof(p_attachments->'items') <> 'array' THEN
      RETURN false;
    END IF;
    SELECT array_agg(item->>'kind') INTO v_kinds FROM jsonb_array_elements(p_attachments->'items') AS item;
    RETURN v_kinds IS NOT NULL AND array_length(v_kinds, 1) > 0
       AND v_kinds <@ ARRAY['sticker', 'gif']::text[];
  END IF;

  IF position('?' IN v_text) > 0 OR position('¿' IN v_text) > 0 THEN
    RETURN false;
  END IF;

  v_norm := regexp_replace(
    translate(lower(v_text), 'áéíóúüñàèìòù', 'aeiouunaeiou'),
    '([a-z])\1{2,}', '\1', 'g'
  );

  -- Solo emojis o simbolos (sin letras ni numeros).
  v_symbols := regexp_replace(v_norm, '[[:space:].,;:!¡''"()\-_*~…]', '', 'g');
  IF v_symbols <> '' AND v_symbols !~ '[a-z0-9]' THEN
    RETURN v_symbols ~ '^[ -⯿️‍\U0001F000-\U0001FAFF]+$';
  END IF;

  IF v_norm ~ '[0-9]' THEN
    RETURN false;
  END IF;

  SELECT array_agg(w) INTO v_words
  FROM regexp_split_to_table(v_norm, '[^a-z]+') AS w
  WHERE w <> '';

  IF v_words IS NULL OR array_length(v_words, 1) > 10 THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM unnest(v_words) AS w
    WHERE NOT (w = ANY (v_vocab)) AND w !~ '^(ja|je|ji|ha|he)+j?$'
  );
END;
$function$;
COMMENT ON FUNCTION public.chat_is_closure_message(p_text text, p_attachments jsonb, p_last_reply text) IS 'Si un mensaje del lead solo cierra la charla (gracias, ok, un emoji, un sticker) y no pide respuesta. Gemela de lib/messages/closure.ts (casos en closure.cases.json).';
REVOKE ALL ON FUNCTION public.chat_is_closure_message(p_text text, p_attachments jsonb, p_last_reply text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.claim_automated_send(p_channel_id uuid, p_limit integer DEFAULT 200)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_window timestamptz := date_trunc('hour', now());
  v_count  integer;
BEGIN
  INSERT INTO public.channel_send_windows (channel_id, window_start, sent_count)
  VALUES (p_channel_id, v_window, 1)
  ON CONFLICT (channel_id, window_start) DO UPDATE
    SET sent_count = public.channel_send_windows.sent_count + 1,
        updated_at = now()
    WHERE public.channel_send_windows.sent_count < p_limit
  RETURNING sent_count INTO v_count;

  -- Sin fila devuelta, el WHERE del upsert no se cumplio: la ventana esta llena.
  RETURN v_count IS NOT NULL;
END;
$function$;
COMMENT ON FUNCTION public.claim_automated_send(p_channel_id uuid, p_limit integer) IS 'Reclama un envio automatizado en la ventana de la hora actual. true si entra, false si se llego al tope.';
REVOKE ALL ON FUNCTION public.claim_automated_send(p_channel_id uuid, p_limit integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.conversation_people(conv public.conversations)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT array_remove(ARRAY[
    conv.assigned_to,
    (SELECT c.setter_id FROM public.contacts c WHERE c.id = conv.contact_id),
    (SELECT c.vendedor_id FROM public.contacts c WHERE c.id = conv.contact_id)
  ], NULL)
$function$;
COMMENT ON FUNCTION public.conversation_people(conv public.conversations) IS 'Responsable del chat + setter + vendedor del contacto. Lo usa el filtro de asignacion de la bandeja.';
REVOKE ALL ON FUNCTION public.conversation_people(conv public.conversations) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.conversation_rule_pick(p_mode text, p_member_ids uuid[], p_active_ids uuid[], p_last uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  n     integer := coalesce(cardinality(p_member_ids), 0);
  start integer := 0;
  i     integer;
  cand  uuid;
BEGIN
  IF n = 0 THEN
    RETURN NULL;
  END IF;

  IF p_mode = 'round_robin' AND p_last IS NOT NULL THEN
    start := coalesce(array_position(p_member_ids, p_last), 0);
  END IF;

  FOR k IN 1..n LOOP
    i := ((start + k - 1) % n) + 1;
    cand := p_member_ids[i];
    IF cand IS NOT NULL AND cand = ANY (coalesce(p_active_ids, '{}'::uuid[])) THEN
      RETURN cand;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;
COMMENT ON FUNCTION public.conversation_rule_pick(p_mode text, p_member_ids uuid[], p_active_ids uuid[], p_last uuid) IS 'Gemela de pickRuleMember (lib/inbox/assignment-rules.ts). Casos compartidos en lib/inbox/assignment-rules.cases.json.';
REVOKE ALL ON FUNCTION public.conversation_rule_pick(p_mode text, p_member_ids uuid[], p_active_ids uuid[], p_last uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.conversations_inherit_known()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_known boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id THEN
    RETURN NEW;
  END IF;

  SELECT ct.is_known INTO v_known FROM public.contacts ct WHERE ct.id = NEW.contact_id;

  IF coalesce(v_known, false) THEN
    IF NEW.agent_enabled IS DISTINCT FROM false THEN
      NEW.agent_enabled := false;
      NEW.agent_disabled_by_known := true;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.agent_disabled_by_known THEN
    -- Se mudo a un contacto que no es conocido: lo que apago la marca se libera.
    NEW.agent_enabled := NULL;
    NEW.agent_disabled_by_known := false;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.conversations_inherit_known() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.conversations_inherit_tag_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tag_id   uuid;
  v_tag_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id THEN
    RETURN NEW;
  END IF;

  SELECT ct.tag_id, t.name INTO v_tag_id, v_tag_name
  FROM public.contact_tags ct
  JOIN public.tags t ON t.id = ct.tag_id
  WHERE ct.contact_id = NEW.contact_id AND t.disables_agent
  ORDER BY ct.created_at
  LIMIT 1;

  IF v_tag_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.agent_enabled IS DISTINCT FROM false THEN
      NEW.agent_enabled := false;
      NEW.agent_disabled_by_tag_id := v_tag_id;
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
      VALUES (
        NEW.workspace_id, 'contact', NEW.contact_id, 'tag_effect', NULL,
        jsonb_build_object(
          'applied', true,
          'origin', CASE WHEN TG_OP = 'INSERT' THEN 'new_conversation' ELSE 'contact_merge' END,
          'tag_id', v_tag_id,
          'tag_name', v_tag_name,
          'conversations_forced_off', jsonb_build_array(jsonb_build_object('id', NEW.id, 'previous', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.agent_enabled END))
        ),
        auth.uid()
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.agent_disabled_by_tag_id IS NOT NULL THEN
    -- Se movio a un contacto sin etiqueta con efecto: lo que apago la
    -- etiqueta del contacto anterior se libera.
    NEW.agent_enabled := NULL;
    NEW.agent_disabled_by_tag_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.conversations_inherit_tag_effects() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.conversations_keep_known_marker()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.agent_enabled IS DISTINCT FROM OLD.agent_enabled
     AND NEW.agent_disabled_by_known IS NOT DISTINCT FROM OLD.agent_disabled_by_known THEN
    NEW.agent_disabled_by_known := false;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.conversations_keep_known_marker() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.conversations_keep_tag_marker()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.agent_enabled IS DISTINCT FROM OLD.agent_enabled
     AND NEW.agent_disabled_by_tag_id IS NOT DISTINCT FROM OLD.agent_disabled_by_tag_id THEN
    NEW.agent_disabled_by_tag_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.conversations_keep_tag_marker() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_unread(conv_id uuid, preview text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.conversations
  SET unread_count = unread_count + 1,
      last_message_at = now(),
      last_message_preview = preview,
      status = 'open'
  WHERE id = conv_id;
END;
$function$;
COMMENT ON FUNCTION public.increment_unread(conv_id uuid, preview text) IS 'Suma un no leido y pisa el preview de la conversacion. Solo service_role: la llaman los receptores de webhooks (lib/inbound.ts). No valida permisos, por eso no puede quedar expuesta a la anon key.';
REVOKE ALL ON FUNCTION public.increment_unread(conv_id uuid, preview text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.messages_discard_answered_drafts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.direction <> 'outbound' OR NEW.status = 'failed' THEN
    RETURN NEW;
  END IF;

  UPDATE public.agent_drafts d
  SET status = 'discarded',
      discard_reason = CASE WHEN NEW.origin = 'user' THEN 'auto:manual_reply' ELSE 'auto:answered_elsewhere' END,
      decided_at = now()
  WHERE d.conversation_id = NEW.conversation_id
    AND d.status IN ('pending', 'failed')
    -- Solo si el saliente es posterior a la ráfaga del borrador y no salió del
    -- propio run del borrador (aprobar un borrador no se descarta a sí mismo).
    AND (d.burst_last_inbound_at IS NULL OR d.burst_last_inbound_at < NEW.created_at)
    AND (NEW.agent_run_id IS NULL OR d.run_id IS DISTINCT FROM NEW.agent_run_id);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.messages_fill_origin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.direction = 'inbound' THEN
    NEW.origin := NULL;
  ELSIF NEW.origin IS NULL THEN
    NEW.origin := CASE
      WHEN NEW.sent_by_agent_id IS NOT NULL THEN 'agent'
      WHEN NEW.sent_by_user_id IS NOT NULL THEN 'user'
      WHEN NEW.sent_by_flow_id IS NOT NULL THEN 'flow'
      ELSE 'external'
    END;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.messages_refresh_awaiting()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  BEGIN
    PERFORM private.refresh_conversation_awaiting(NEW.conversation_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'messages_refresh_awaiting: no pude recalcular la conversacion % (%)', NEW.conversation_id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.messages_refresh_awaiting() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.messages_refresh_last_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_last record;
BEGIN
  BEGIN
    -- El ultimo mensaje que existe de verdad (ni fallido ni en vuelo). Incluye
    -- al que se acaba de guardar.
    SELECT m.id, m.direction::text AS direction, m.created_at, m.origin::text AS origin, m.sent_by_user_id,
           m.text, m.transcript, m.attachments
    INTO v_last
    FROM public.messages m
    WHERE m.conversation_id = NEW.conversation_id
      AND m.status IS DISTINCT FROM 'failed'
      AND m.status IS DISTINCT FROM 'pending'
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1;

    IF v_last.id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Fecha, direccion y preview salen SIEMPRE del ultimo mensaje, no del que
    -- se acaba de guardar: `increment_unread` escribe el preview del entrante
    -- aunque ya haya una respuesta mas nueva (el eco de ManyChat que llego
    -- antes), y esto lo vuelve a dejar bien. La fecha nunca va para atras.
    UPDATE public.conversations c
    SET last_message_at = GREATEST(c.last_message_at, v_last.created_at),
        last_message_direction = v_last.direction,
        last_message_preview = private.message_preview_text(v_last.text, v_last.transcript, v_last.attachments)
    WHERE c.id = NEW.conversation_id
      AND (
        c.last_message_at IS NULL
        OR c.last_message_at < v_last.created_at
        OR c.last_message_direction IS DISTINCT FROM v_last.direction
        OR c.last_message_preview IS DISTINCT FROM private.message_preview_text(v_last.text, v_last.transcript, v_last.attachments)
      );

    -- El no leido: si lo ultimo que se dijo es nuestro, no hay nada sin leer.
    -- Vale tambien cuando el que se acaba de guardar es un entrante mas viejo
    -- que esa respuesta (llego tarde).
    IF v_last.direction = 'outbound'
       AND (v_last.sent_by_user_id IS NOT NULL OR v_last.origin IN ('user', 'external')) THEN
      UPDATE public.conversations c
      SET unread_count = 0
      WHERE c.id = NEW.conversation_id
        AND c.unread_count > 0;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'messages_refresh_last_message: no pude actualizar la conversacion % (%)', NEW.conversation_id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.messages_refresh_last_message() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.messages_set_workspace_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT c.workspace_id INTO NEW.workspace_id
      FROM public.conversations c WHERE c.id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.messages_set_workspace_id() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.messages_upsert_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_norm text;
  v_emoji_cat uuid;
BEGIN
  IF NEW.text IS NULL OR btrim(NEW.text) = '' THEN
    RETURN NEW;
  END IF;
  v_norm := public.normalize_for_grouping(NEW.text);

  IF v_norm = '' THEN
    -- Solo emoji/adjunto: va directo a su categoría con source rule.
    SELECT id INTO v_emoji_cat FROM public.message_categories
      WHERE workspace_id = NEW.workspace_id AND direction = NEW.direction AND name = 'Solo emoji o adjunto' LIMIT 1;
    INSERT INTO public.message_texts (workspace_id, direction, normalized_text, sample_text, category_id, source, first_seen_at)
    VALUES (NEW.workspace_id, NEW.direction, '', NEW.text, v_emoji_cat, 'rule', NEW.created_at)
    ON CONFLICT (workspace_id, direction, normalized_text) DO NOTHING;
  ELSE
    INSERT INTO public.message_texts (workspace_id, direction, normalized_text, sample_text, first_seen_at)
    VALUES (NEW.workspace_id, NEW.direction, v_norm, NEW.text, NEW.created_at)
    ON CONFLICT (workspace_id, direction, normalized_text) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_whatsapp_call(p_workspace_id uuid, p_channel_id uuid, p_conversation_id uuid, p_call_id text, p_is_video boolean, p_event text, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_initial  text;
  v_previous text;
  v_row      public.whatsapp_calls%ROWTYPE;
BEGIN
  v_initial := CASE p_event
    WHEN 'accept' THEN 'answered'
    WHEN 'reject' THEN 'rejected'
    WHEN 'timeout' THEN 'missed'
    WHEN 'terminate' THEN 'missed'
    ELSE 'ringing'
  END;

  SELECT status INTO v_previous FROM public.whatsapp_calls
  WHERE channel_id = p_channel_id AND platform_call_id = p_call_id;

  INSERT INTO public.whatsapp_calls AS w (
    workspace_id, channel_id, conversation_id, platform_call_id, is_video, status, started_at,
    answered_at, ended_at
  ) VALUES (
    p_workspace_id, p_channel_id, p_conversation_id, p_call_id, coalesce(p_is_video, false), v_initial,
    coalesce(p_at, now()),
    CASE WHEN v_initial = 'answered' THEN coalesce(p_at, now()) END,
    CASE WHEN v_initial IN ('missed', 'rejected') THEN coalesce(p_at, now()) END
  )
  ON CONFLICT (channel_id, platform_call_id) DO UPDATE SET
    status = CASE
      WHEN w.status = 'ringing' AND p_event = 'accept' THEN 'answered'
      WHEN w.status = 'ringing' AND p_event = 'reject' THEN 'rejected'
      WHEN w.status = 'ringing' AND p_event IN ('timeout', 'terminate') THEN 'missed'
      ELSE w.status
    END,
    is_video = w.is_video OR coalesce(p_is_video, false),
    answered_at = CASE WHEN w.status = 'ringing' AND p_event = 'accept' THEN coalesce(p_at, now()) ELSE w.answered_at END,
    ended_at = CASE
      WHEN w.ended_at IS NOT NULL THEN w.ended_at
      WHEN p_event IN ('reject', 'timeout', 'terminate') AND w.status IN ('ringing', 'answered') THEN coalesce(p_at, now())
      ELSE w.ended_at
    END
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'previous', v_previous,
    'became_unanswered', v_row.status IN ('missed', 'rejected') AND coalesce(v_previous, 'ringing') = 'ringing'
  );
END;
$function$;
COMMENT ON FUNCTION public.record_whatsapp_call(p_workspace_id uuid, p_channel_id uuid, p_conversation_id uuid, p_call_id text, p_is_video boolean, p_event text, p_at timestamp with time zone) IS 'Registra un evento CALL de Evolution. Atomica; devuelve si la llamada recien quedo sin atender. Solo service_role.';
REVOKE ALL ON FUNCTION public.record_whatsapp_call(p_workspace_id uuid, p_channel_id uuid, p_conversation_id uuid, p_call_id text, p_is_video boolean, p_event text, p_at timestamp with time zone) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_message_categories()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.message_categories (workspace_id, direction, name, is_fallback, created_by)
  VALUES (NEW.id, 'inbound', 'Otro', true, 'system'), (NEW.id, 'outbound', 'Otro', true, 'system'),
         (NEW.id, 'inbound', 'Solo emoji o adjunto', false, 'system'), (NEW.id, 'outbound', 'Solo emoji o adjunto', false, 'system')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.set_conversation_no_reply(p_conversation_id uuid, p_needed boolean, p_reason text, p_by uuid DEFAULT NULL::uuid, p_expected_last_inbound_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_needed THEN
    -- "Necesita respuesta": se saca la marca, sea de quien sea.
    UPDATE public.conversations
    SET no_reply_needed_at = NULL, no_reply_needed_reason = NULL, no_reply_needed_by = NULL
    WHERE id = p_conversation_id AND no_reply_needed_at IS NOT NULL;
  ELSE
    IF p_reason NOT IN ('agent', 'manual') THEN
      RAISE EXCEPTION 'motivo invalido: %', p_reason USING ERRCODE = '22023';
    END IF;
    UPDATE public.conversations
    SET no_reply_needed_at = now(), no_reply_needed_reason = p_reason, no_reply_needed_by = p_by
    WHERE id = p_conversation_id
      AND awaiting_last_inbound_at IS NOT NULL
      AND (p_expected_last_inbound_at IS NULL OR awaiting_last_inbound_at = p_expected_last_inbound_at);
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$function$;
COMMENT ON FUNCTION public.set_conversation_no_reply(p_conversation_id uuid, p_needed boolean, p_reason text, p_by uuid, p_expected_last_inbound_at timestamp with time zone) IS 'Pone o saca la marca "no necesita respuesta" (agente o persona). Solo service_role: el permiso lo chequea quien llama.';
REVOKE ALL ON FUNCTION public.set_conversation_no_reply(p_conversation_id uuid, p_needed boolean, p_reason text, p_by uuid, p_expected_last_inbound_at timestamp with time zone) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_channel_send_windows_start ON public.channel_send_windows USING btree (window_start);

CREATE INDEX IF NOT EXISTS idx_comment_logs_channel_id ON public.comment_logs USING btree (channel_id);

CREATE INDEX IF NOT EXISTS idx_comment_logs_created_at ON public.comment_logs USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comment_logs_platform_comment_id ON public.comment_logs USING btree (platform_comment_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_logs_unique_comment ON public.comment_logs USING btree (channel_id, platform_comment_id);

CREATE INDEX IF NOT EXISTS idx_comment_logs_workspace_id ON public.comment_logs USING btree (workspace_id);

CREATE INDEX IF NOT EXISTS idx_conversation_assignment_rules_workspace ON public.conversation_assignment_rules USING btree (workspace_id, "position") WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_conversations_agent_enabled ON public.conversations USING btree (workspace_id) WHERE agent_enabled;

CREATE INDEX IF NOT EXISTS idx_conversations_agent_error ON public.conversations USING btree (workspace_id, last_agent_error_at DESC) WHERE (last_agent_error_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_conversations_awaiting ON public.conversations USING btree (workspace_id, awaiting_last_inbound_at) WHERE ((awaiting_last_inbound_at IS NOT NULL) AND (deleted_at IS NULL));

CREATE INDEX IF NOT EXISTS idx_conversations_contact_assigned ON public.conversations USING btree (contact_id, assigned_to);

CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at ON public.conversations USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_conversations_disabled_by_tag ON public.conversations USING btree (agent_disabled_by_tag_id) WHERE (agent_disabled_by_tag_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_conversations_needs_human ON public.conversations USING btree (workspace_id, needs_human_at DESC) WHERE needs_human;

CREATE INDEX IF NOT EXISTS idx_conversations_open_by_last_message ON public.conversations USING btree (channel_id, last_message_at) WHERE ((status = 'open'::text) AND (deleted_at IS NULL));

CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations USING btree (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON public.conversations USING btree (workspace_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_ws_assigned_last ON public.conversations USING btree (workspace_id, assigned_to, last_message_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_conversations_ws_status_last ON public.conversations USING btree (workspace_id, status, last_message_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_email_log_contact ON public.email_log USING btree (contact_id, created_at DESC) WHERE (contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_email_log_ws_created ON public.email_log USING btree (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_log_ws_status ON public.email_log USING btree (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_message_reactions_conversation ON public.message_reactions USING btree (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON public.message_reactions USING btree (message_id) WHERE (message_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_message_texts_category ON public.message_texts USING btree (workspace_id, category_id);

CREATE INDEX IF NOT EXISTS idx_message_texts_unclassified ON public.message_texts USING btree (workspace_id, direction) WHERE (category_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_messages_agent_run ON public.messages USING btree (agent_run_id) WHERE (agent_run_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages USING btree (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_email_message_id ON public.messages USING btree (email_message_id) WHERE (email_message_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_platform_message_id ON public.messages USING btree (conversation_id, platform_message_id) WHERE (platform_message_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_messages_sent_by_agent ON public.messages USING btree (sent_by_agent_id) WHERE (sent_by_agent_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_messages_transcript_pending ON public.messages USING btree (transcript_started_at) WHERE (transcript_status = 'pending'::text);

CREATE INDEX IF NOT EXISTS idx_messages_unreadable ON public.messages USING btree (conversation_id, created_at DESC) WHERE (interpretability = 'unreadable'::text);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_created ON public.messages USING btree (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_direction_created ON public.messages USING btree (workspace_id, direction, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_origin_created ON public.messages USING btree (workspace_id, origin, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_textnorm ON public.messages USING btree (workspace_id, direction, text_norm);

CREATE INDEX IF NOT EXISTS idx_stickers_workspace_recent ON public.stickers USING btree (workspace_id, last_used_at DESC NULLS LAST) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_whatsapp_calls_conversation ON public.whatsapp_calls USING btree (conversation_id, started_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_categories_fallback ON public.message_categories USING btree (workspace_id, direction) WHERE is_fallback;

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_categories_name ON public.message_categories USING btree (workspace_id, direction, lower(name)) WHERE (archived_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_reactions_actor ON public.message_reactions USING btree (conversation_id, platform_message_id, actor_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_texts_norm ON public.message_texts USING btree (workspace_id, direction, normalized_text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stickers_workspace_sha ON public.stickers USING btree (workspace_id, sha256);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_calls_channel_call ON public.whatsapp_calls USING btree (channel_id, platform_call_id);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.conversation_assignment_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER conversations_a_inherit_tag_effects BEFORE INSERT OR UPDATE OF contact_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.conversations_inherit_tag_effects();

CREATE OR REPLACE TRIGGER conversations_a2_inherit_known BEFORE INSERT OR UPDATE OF contact_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.conversations_inherit_known();

CREATE OR REPLACE TRIGGER conversations_b_keep_tag_marker BEFORE UPDATE OF agent_enabled ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.conversations_keep_tag_marker();

CREATE OR REPLACE TRIGGER conversations_b2_keep_known_marker BEFORE UPDATE OF agent_enabled ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.conversations_keep_known_marker();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER messages_discard_answered_drafts AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.messages_discard_answered_drafts();

CREATE OR REPLACE TRIGGER messages_fill_origin BEFORE INSERT OR UPDATE OF origin, direction, sent_by_agent_id, sent_by_user_id, sent_by_flow_id ON public.messages FOR EACH ROW EXECUTE FUNCTION public.messages_fill_origin();

CREATE OR REPLACE TRIGGER messages_fill_workspace_id BEFORE INSERT OR UPDATE OF conversation_id ON public.messages FOR EACH ROW EXECUTE FUNCTION public.messages_set_workspace_id();

CREATE OR REPLACE TRIGGER messages_upsert_text AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.messages_upsert_text();

CREATE OR REPLACE TRIGGER messages_zz_last_message AFTER INSERT ON public.messages FOR EACH ROW WHEN (((new.status IS DISTINCT FROM 'failed'::text) AND (new.status IS DISTINCT FROM 'pending'::text))) EXECUTE FUNCTION public.messages_refresh_last_message();

CREATE OR REPLACE TRIGGER messages_zz_last_message_update AFTER UPDATE OF status ON public.messages FOR EACH ROW WHEN (((old.status = ANY (ARRAY['failed'::text, 'pending'::text])) AND (new.status IS DISTINCT FROM 'failed'::text) AND (new.status IS DISTINCT FROM 'pending'::text))) EXECUTE FUNCTION public.messages_refresh_last_message();

CREATE OR REPLACE TRIGGER messages_zz_refresh_awaiting AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.messages_refresh_awaiting();

CREATE OR REPLACE TRIGGER messages_zz_refresh_awaiting_update AFTER UPDATE OF status, direction, created_at ON public.messages FOR EACH ROW WHEN (((old.direction IS DISTINCT FROM new.direction) OR (old.created_at IS DISTINCT FROM new.created_at) OR ((old.status = 'failed'::text) IS DISTINCT FROM (new.status = 'failed'::text)))) EXECUTE FUNCTION public.messages_refresh_awaiting();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.stickers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_calls FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER seed_message_categories AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.seed_message_categories();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY channel_send_windows_select ON public.channel_send_windows FOR SELECT TO public
    USING ((EXISTS ( SELECT 1
   FROM public.channels c
  WHERE ((c.id = channel_send_windows.channel_id) AND public.is_workspace_member(c.workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view comment logs in their workspace" ON public.comment_logs FOR SELECT TO public
    USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY conversation_assignment_rules_select ON public.conversation_assignment_rules FOR SELECT TO public
    USING (( SELECT public.is_workspace_member(conversation_assignment_rules.workspace_id) AS is_workspace_member));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY conversations_delete ON public.conversations FOR DELETE TO public
    USING (public.is_workspace_admin(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY conversations_insert ON public.conversations FOR INSERT TO public
    WITH CHECK (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY conversations_select ON public.conversations FOR SELECT TO public
    USING (((deleted_at IS NULL) AND public.can_see_conversation(conversations.*)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY conversations_update ON public.conversations FOR UPDATE TO public
    USING (public.can_see_conversation(conversations.*))
    WITH CHECK (public.can_see_conversation(conversations.*));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY email_log_select ON public.email_log FOR SELECT TO public
    USING (public.is_workspace_admin(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY email_log_select_contact ON public.email_log FOR SELECT TO public
    USING (((contact_id IS NOT NULL) AND public.is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = email_log.contact_id) AND public.can_see_contact(c.*))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY message_categories_select ON public.message_categories FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY message_categories_write ON public.message_categories TO public
    USING (public.is_workspace_admin(workspace_id))
    WITH CHECK (public.is_workspace_admin(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY message_reactions_select ON public.message_reactions FOR SELECT TO public
    USING ((public.is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.conversations conv
  WHERE (conv.id = message_reactions.conversation_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY message_texts_select ON public.message_texts FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY message_texts_write ON public.message_texts TO public
    USING (public.is_workspace_admin(workspace_id))
    WITH CHECK (public.is_workspace_admin(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY messages_insert ON public.messages FOR INSERT TO public
    WITH CHECK ((public.is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.conversations conv
  WHERE (conv.id = messages.conversation_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY messages_select ON public.messages FOR SELECT TO public
    USING ((public.is_workspace_member(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.conversations conv
  WHERE (conv.id = messages.conversation_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY stickers_select ON public.stickers FOR SELECT TO public
    USING (( SELECT public.is_workspace_member(stickers.workspace_id) AS is_workspace_member));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY whatsapp_calls_select ON public.whatsapp_calls FOR SELECT TO public
    USING ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = whatsapp_calls.conversation_id) AND public.can_see_conversation(c.*)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Tiempo real
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
