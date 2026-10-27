-- ============================================================================
-- Automatizaciones
--
-- Flujos (con su borrador, sus versiones publicadas y sus disparadores), las sesiones
-- que los ejecutan, la cola de eventos del CRM que los arranca, las secuencias (drip)
-- con su auto-pausa cuando el contacto responde, los envios masivos y sus analiticas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.automation_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  event_type text NOT NULL,
  contact_id uuid,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  error text,
  member_user_id uuid,
  source_type text,
  source_id text,
  CONSTRAINT automation_events_pkey PRIMARY KEY (id),
  CONSTRAINT automation_events_contact_or_source CHECK (((contact_id IS NOT NULL) OR ((member_user_id IS NULL) AND (source_type IS NOT NULL)))),
  CONSTRAINT automation_events_source_type_check CHECK (((source_type IS NULL) OR (source_type = ANY (ARRAY['contact'::text, 'member'::text, 'booking'::text, 'system'::text])))),
  CONSTRAINT automation_events_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT automation_events_member_user_id_fkey FOREIGN KEY (member_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT automation_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.automation_events IS 'Cola de cambios del CRM que pueden disparar un flow. La llenan triggers de Postgres y la drena /api/cron/automation-events.';
COMMENT ON COLUMN public.automation_events.member_user_id IS 'La persona del equipo de un evento. Sin contacto, un evento tiene que traer su origen (source_type).';
COMMENT ON COLUMN public.automation_events.source_type IS 'Que origino el evento. Un evento sin contacto lo exige: la base lo completa para contacto y persona.';
COMMENT ON COLUMN public.automation_events.source_id IS 'La entidad que origino el evento, como texto.';

CREATE TABLE IF NOT EXISTS public.broadcasts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  message_content jsonb DEFAULT '{}'::jsonb NOT NULL,
  segment_filter jsonb,
  scheduled_for timestamp with time zone,
  total_recipients integer DEFAULT 0 NOT NULL,
  sent integer DEFAULT 0 NOT NULL,
  delivered integer DEFAULT 0 NOT NULL,
  failed integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT broadcasts_pkey PRIMARY KEY (id),
  CONSTRAINT broadcasts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'completed'::text, 'cancelled'::text]))),
  CONSTRAINT broadcasts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  broadcast_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  sent_at timestamp with time zone,
  error_message text,
  CONSTRAINT broadcast_recipients_pkey PRIMARY KEY (id),
  CONSTRAINT broadcast_recipients_broadcast_id_fkey FOREIGN KEY (broadcast_id) REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  CONSTRAINT broadcast_recipients_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE,
  CONSTRAINT broadcast_recipients_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE
);
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.flows (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  status text DEFAULT 'draft'::text NOT NULL,
  nodes jsonb DEFAULT '[]'::jsonb NOT NULL,
  edges jsonb DEFAULT '[]'::jsonb NOT NULL,
  viewport jsonb,
  version integer DEFAULT 1 NOT NULL,
  published_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  event_type_id uuid,
  template_key text,
  categories text[] DEFAULT '{}'::text[] NOT NULL,
  draft_nodes jsonb,
  draft_edges jsonb,
  draft_updated_at timestamp with time zone,
  CONSTRAINT flows_pkey PRIMARY KEY (id),
  CONSTRAINT flows_categories_max CHECK ((cardinality(categories) <= 10)),
  CONSTRAINT flows_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]))),
  CONSTRAINT flows_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.flows.event_type_id IS 'El evento de agenda al que pertenece este flujo. null = flujo general.';
COMMENT ON COLUMN public.flows.template_key IS 'Cual de las 7 plantillas precreadas es: confirmation, reminder_24h, ...';
COMMENT ON COLUMN public.flows.categories IS 'Categorias libres de la automatizacion (varias). Las sugerencias salen de las que usan los demas flujos.';
COMMENT ON COLUMN public.flows.draft_nodes IS 'Cambios sin publicar de una automatizacion publicada. NULL = no hay. Publicar los copia a nodes.';

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  flow_id uuid,
  contact_id uuid,
  event_type text NOT NULL,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT analytics_events_pkey PRIMARY KEY (id),
  CONSTRAINT analytics_events_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT analytics_events_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE SET NULL,
  CONSTRAINT analytics_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.flow_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contact_id uuid,
  flow_id uuid NOT NULL,
  channel_id uuid,
  status text DEFAULT 'active'::text NOT NULL,
  current_node_id text,
  variables jsonb DEFAULT '{}'::jsonb NOT NULL,
  flow_stack jsonb DEFAULT '[]'::jsonb NOT NULL,
  waiting_until timestamp with time zone,
  waiting_for_input boolean DEFAULT false NOT NULL,
  human_takeover_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  member_user_id uuid,
  source_type text,
  source_id text,
  CONSTRAINT flow_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT flow_sessions_contact_or_source CHECK (((contact_id IS NOT NULL) OR (member_user_id IS NOT NULL) OR (source_type IS NOT NULL))),
  CONSTRAINT flow_sessions_source_type_check CHECK (((source_type IS NULL) OR (source_type = ANY (ARRAY['contact'::text, 'member'::text, 'booking'::text, 'system'::text])))),
  CONSTRAINT flow_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'expired'::text, 'cancelled'::text]))),
  CONSTRAINT flow_sessions_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE,
  CONSTRAINT flow_sessions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT flow_sessions_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE CASCADE,
  CONSTRAINT flow_sessions_member_user_id_fkey FOREIGN KEY (member_user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.flow_sessions ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.flow_sessions.channel_id IS 'Null cuando el flow no arranco por un canal (agenda, evento de CRM sin conversacion). Los nodos que envian por canal se saltean con motivo.';
COMMENT ON COLUMN public.flow_sessions.member_user_id IS 'La persona del equipo de un flujo sin contacto. Una sesion tiene contacto, persona u origen, nunca ninguno.';
COMMENT ON COLUMN public.flow_sessions.source_type IS 'Que disparo la sesion: contact | member | booking | system. Lo completa fill_automation_source si viene vacio.';
COMMENT ON COLUMN public.flow_sessions.source_id IS 'La entidad que disparo la sesion (el envio, el evento, la persona...), como texto.';

CREATE TABLE IF NOT EXISTS public.flow_send_claims (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  node_id text NOT NULL,
  target text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT flow_send_claims_pkey PRIMARY KEY (id),
  CONSTRAINT uq_flow_send_claims UNIQUE (session_id, node_id, target),
  CONSTRAINT flow_send_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.flow_sessions(id) ON DELETE CASCADE,
  CONSTRAINT flow_send_claims_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.flow_send_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.flow_send_claims FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.flow_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  flow_id uuid NOT NULL,
  version integer NOT NULL,
  nodes jsonb NOT NULL,
  edges jsonb NOT NULL,
  viewport jsonb,
  name text NOT NULL,
  published_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT flow_versions_pkey PRIMARY KEY (id),
  CONSTRAINT flow_versions_flow_id_version_key UNIQUE (flow_id, version),
  CONSTRAINT flow_versions_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE CASCADE,
  CONSTRAINT flow_versions_published_by_fkey FOREIGN KEY (published_by) REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.flow_versions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.sequences (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  status text DEFAULT 'draft'::text NOT NULL,
  steps jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT sequences_pkey PRIMARY KEY (id),
  CONSTRAINT sequences_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text]))),
  CONSTRAINT sequences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.sequences.status IS 'draft = todavia no corre | active = inscribe y manda | paused = frenada; sus inscripciones se pausan, no se cancelan.';

CREATE TABLE IF NOT EXISTS public.sequence_enrollments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sequence_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  current_step_index integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  enrolled_at timestamp with time zone DEFAULT now(),
  next_step_at timestamp with time zone,
  completed_at timestamp with time zone,
  paused_reason text,
  paused_at timestamp with time zone,
  attempt_count integer DEFAULT 0 NOT NULL,
  last_error text,
  last_error_at timestamp with time zone,
  locked_at timestamp with time zone,
  collision_detected_at timestamp with time zone,
  collision_with jsonb,
  collision_reviewed_at timestamp with time zone,
  collision_reviewed_by uuid,
  collision_resolution text,
  CONSTRAINT sequence_enrollments_pkey PRIMARY KEY (id),
  CONSTRAINT sequence_enrollments_collision_resolution_check CHECK (((collision_resolution IS NULL) OR (collision_resolution = ANY (ARRAY['kept_both'::text, 'paused_other'::text, 'removed_other'::text, 'removed_this'::text])))),
  CONSTRAINT sequence_enrollments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text, 'cancelled'::text]))),
  CONSTRAINT sequence_enrollments_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE,
  CONSTRAINT sequence_enrollments_collision_reviewed_by_fkey FOREIGN KEY (collision_reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT sequence_enrollments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT sequence_enrollments_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.sequences(id) ON DELETE CASCADE
);
ALTER TABLE public.sequence_enrollments ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.sequence_enrollments.status IS 'active = corriendo | paused = frenada porque el contacto pidio no ser contactado; no se reanuda sola, ni siquiera al sacar la marca | completed = termino | cancelled = la secuencia dejo de estar activa.';
COMMENT ON COLUMN public.sequence_enrollments.paused_reason IS 'contact_replied = el lead contesto | opt_out = pidio no ser contactado | sequence_paused = se pauso la secuencia | no_conversation = no hay hilo abierto por donde escribir | collision = un admin la freno por colision. Solo las tres primeras y collision se reanudan.';
COMMENT ON COLUMN public.sequence_enrollments.attempt_count IS 'Intentos del paso actual. Se limpia al avanzar. Ver MAX_STEP_ATTEMPTS en lib/sequences/steps.ts.';
COMMENT ON COLUMN public.sequence_enrollments.locked_at IS 'La reclamo una corrida del cron. Se limpia al terminar el paso; una corrida caida la libera sola pasado p_stale_after.';
COMMENT ON COLUMN public.sequence_enrollments.collision_with IS 'Snapshot de las otras inscripciones vivas al momento de inscribir: [{enrollment_id, sequence_id, sequence_name}]. Snapshot y no join, para que el aviso siga siendo legible si despues se cancela o renombra.';
COMMENT ON COLUMN public.sequence_enrollments.collision_reviewed_at IS 'Null = colision sin resolver; es lo que filtra el aviso en la pantalla de la secuencia.';

CREATE TABLE IF NOT EXISTS public.triggers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  flow_id uuid NOT NULL,
  channel_id uuid,
  type text NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  priority integer DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  workspace_id uuid NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT triggers_pkey PRIMARY KEY (id),
  CONSTRAINT triggers_type_check CHECK ((type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text, 'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text]))),
  CONSTRAINT triggers_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE SET NULL,
  CONSTRAINT triggers_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE CASCADE,
  CONSTRAINT triggers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.triggers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.trigger_fires (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  trigger_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  dedupe_key text NOT NULL,
  contact_id uuid,
  fired_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT trigger_fires_pkey PRIMARY KEY (id),
  CONSTRAINT trigger_fires_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT trigger_fires_trigger_id_fkey FOREIGN KEY (trigger_id) REFERENCES public.triggers(id) ON DELETE CASCADE,
  CONSTRAINT trigger_fires_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.trigger_fires ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.trigger_fires IS 'Un disparo ya ocurrido. El indice unico sobre (trigger_id, dedupe_key) es lo que impide que un trigger dispare dos veces por el mismo motivo.';

-- ----------------------------------------------------------------------------
-- Claves foraneas hacia tablas de esta area
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE public.comment_logs ADD CONSTRAINT comment_logs_matched_trigger_id_fkey FOREIGN KEY (matched_trigger_id) REFERENCES public.triggers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.messages ADD CONSTRAINT messages_sent_by_flow_id_fkey FOREIGN KEY (sent_by_flow_id) REFERENCES public.flows(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.fill_automation_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.source_type IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Sin contacto y con una persona del equipo: la persona. Con contacto: el contacto.
  IF NEW.member_user_id IS NOT NULL AND NEW.contact_id IS NULL THEN
    NEW.source_type := 'member';
    NEW.source_id := NEW.member_user_id::text;
  ELSIF NEW.contact_id IS NOT NULL THEN
    NEW.source_type := 'contact';
    NEW.source_id := NEW.contact_id::text;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.fill_automation_source() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.claim_sequence_enrollments(p_limit integer DEFAULT 25, p_stale_after interval DEFAULT '00:05:00'::interval)
 RETURNS SETOF public.sequence_enrollments
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH due AS (
    SELECT e.id
    FROM public.sequence_enrollments e
    WHERE e.status = 'active'
      AND e.next_step_at IS NOT NULL
      AND e.next_step_at <= now()
      AND (e.locked_at IS NULL OR e.locked_at < now() - p_stale_after)
    ORDER BY e.next_step_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sequence_enrollments e
  SET locked_at = now()
  FROM due
  WHERE e.id = due.id
  RETURNING e.*;
$function$;
COMMENT ON FUNCTION public.claim_sequence_enrollments(p_limit integer, p_stale_after interval) IS 'Reclama inscripciones vencidas para una corrida del cron. Solo service_role: la ejecuta el procesador, nunca la UI.';
REVOKE ALL ON FUNCTION public.claim_sequence_enrollments(p_limit integer, p_stale_after interval) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.emit_automation_event(p_workspace_id uuid, p_event_type text, p_contact_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
  VALUES (p_workspace_id, p_event_type, p_contact_id, p_payload);
END;
$function$;
REVOKE ALL ON FUNCTION public.emit_automation_event(p_workspace_id uuid, p_event_type text, p_contact_id uuid, p_payload jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_broadcast_failed(b_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.broadcasts
  SET failed = failed + 1
  WHERE id = b_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.increment_broadcast_failed(b_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_broadcast_sent(b_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.broadcasts
  SET sent = sent + 1,
      delivered = delivered + 1
  WHERE id = b_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.increment_broadcast_sent(b_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pause_sequences_on_reply(p_contact_id uuid, p_channel_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ids uuid[];
  v_count integer;
  v_workspace_id uuid;
BEGIN
  IF p_contact_id IS NULL OR p_channel_id IS NULL THEN
    RETURN 0;
  END IF;

  -- El UPDATE va adentro de un CTE para poder juntar los ids de TODAS las
  -- filas tocadas: un RETURNING ... INTO suelto sobre varias filas se queda
  -- solo con una.
  WITH paused AS (
    UPDATE public.sequence_enrollments
    SET status = 'paused',
        paused_reason = 'contact_replied',
        paused_at = now(),
        locked_at = NULL
    WHERE contact_id = p_contact_id
      AND channel_id = p_channel_id
      AND status = 'active'
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM paused;

  v_count := COALESCE(array_length(v_ids, 1), 0);
  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.contacts WHERE id = p_contact_id;

  -- Una sola entrada por respuesta, no una por inscripcion: lo que paso es un
  -- hecho del contacto, y las inscripciones afectadas son su detalle.
  INSERT INTO public.audit_log (
    workspace_id, entity_type, entity_id, action, metadata, performed_by
  ) VALUES (
    v_workspace_id,
    'contact',
    p_contact_id,
    'sequence_paused',
    jsonb_build_object(
      'source', 'auto',
      'reason', 'contact_replied',
      'channel_id', p_channel_id,
      'enrollment_ids', to_jsonb(v_ids),
      'count', v_count
    ),
    NULL
  );

  RETURN v_count;
END;
$function$;
COMMENT ON FUNCTION public.pause_sequences_on_reply(p_contact_id uuid, p_channel_id uuid) IS 'Pausa las secuencias activas del contacto en ESE canal cuando responde. La llaman los dos receptores de webhook con service role.';
REVOKE ALL ON FUNCTION public.pause_sequences_on_reply(p_contact_id uuid, p_channel_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.triggers_set_workspace_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT f.workspace_id INTO NEW.workspace_id
      FROM public.flows f WHERE f.id = NEW.flow_id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.triggers_set_workspace_id() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_analytics_flow ON public.analytics_events USING btree (flow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_workspace ON public.analytics_events USING btree (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_events_contact ON public.automation_events USING btree (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_events_pending ON public.automation_events USING btree (created_at) WHERE (processed_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast ON public.broadcast_recipients USING btree (broadcast_id, status);

CREATE INDEX IF NOT EXISTS idx_broadcasts_workspace ON public.broadcasts USING btree (workspace_id);

CREATE INDEX IF NOT EXISTS idx_flow_send_claims_workspace ON public.flow_send_claims USING btree (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_flow_sessions_contact_active ON public.flow_sessions USING btree (contact_id, channel_id) WHERE (status = 'active'::text);

CREATE INDEX IF NOT EXISTS idx_flow_versions_flow ON public.flow_versions USING btree (flow_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_flows_categories ON public.flows USING gin (categories);

CREATE INDEX IF NOT EXISTS idx_flows_event_type ON public.flows USING btree (event_type_id) WHERE (event_type_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_flows_status ON public.flows USING btree (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_flows_workspace ON public.flows USING btree (workspace_id);

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_contact ON public.sequence_enrollments USING btree (contact_id, status);

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_due ON public.sequence_enrollments USING btree (next_step_at) WHERE (status = 'active'::text);

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_live_channel ON public.sequence_enrollments USING btree (contact_id, channel_id) WHERE (status = ANY (ARRAY['active'::text, 'paused'::text]));

CREATE UNIQUE INDEX IF NOT EXISTS idx_sequence_enrollments_one_live ON public.sequence_enrollments USING btree (sequence_id, contact_id) WHERE (status = ANY (ARRAY['active'::text, 'paused'::text]));

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_open_collision ON public.sequence_enrollments USING btree (sequence_id) WHERE ((collision_detected_at IS NOT NULL) AND (collision_reviewed_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS idx_trigger_fires_dedupe ON public.trigger_fires USING btree (trigger_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_trigger_fires_workspace ON public.trigger_fires USING btree (workspace_id, fired_at DESC);

CREATE INDEX IF NOT EXISTS idx_triggers_channel_type ON public.triggers USING btree (channel_id, type, is_active);

CREATE INDEX IF NOT EXISTS idx_triggers_flow ON public.triggers USING btree (flow_id);

CREATE INDEX IF NOT EXISTS idx_triggers_workspace_type ON public.triggers USING btree (workspace_id, type, is_active);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER fill_source_before_insert BEFORE INSERT ON public.automation_events FOR EACH ROW EXECUTE FUNCTION private.fill_automation_source();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.broadcasts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER fill_source_before_insert BEFORE INSERT ON public.flow_sessions FOR EACH ROW EXECUTE FUNCTION private.fill_automation_source();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.flow_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.flows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER triggers_fill_workspace_id BEFORE INSERT OR UPDATE OF flow_id ON public.triggers FOR EACH ROW EXECUTE FUNCTION public.triggers_set_workspace_id();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY "Users can insert analytics in their workspaces" ON public.analytics_events FOR INSERT TO public
    WITH CHECK (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view analytics in their workspaces" ON public.analytics_events FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY automation_events_select ON public.automation_events FOR SELECT TO public
    USING (public.is_workspace_admin(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert broadcast recipients" ON public.broadcast_recipients FOR INSERT TO public
    WITH CHECK ((EXISTS ( SELECT 1
   FROM public.broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND public.is_workspace_member(b.workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update broadcast recipients" ON public.broadcast_recipients FOR UPDATE TO public
    USING ((EXISTS ( SELECT 1
   FROM public.broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND public.is_workspace_member(b.workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view broadcast recipients" ON public.broadcast_recipients FOR SELECT TO public
    USING ((EXISTS ( SELECT 1
   FROM public.broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND public.is_workspace_member(b.workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can manage broadcasts in their workspaces" ON public.broadcasts TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view broadcasts in their workspaces" ON public.broadcasts FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view flow sessions via flow" ON public.flow_sessions FOR SELECT TO public
    USING ((EXISTS ( SELECT 1
   FROM public.flows f
  WHERE ((f.id = flow_sessions.flow_id) AND public.is_workspace_member(f.workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY flow_versions_insert ON public.flow_versions FOR INSERT TO public
    WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.flows f
     JOIN public.workspace_members wm ON ((wm.workspace_id = f.workspace_id)))
  WHERE ((f.id = flow_versions.flow_id) AND (wm.user_id = auth.uid())))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY flow_versions_select ON public.flow_versions FOR SELECT TO public
    USING ((EXISTS ( SELECT 1
   FROM (public.flows f
     JOIN public.workspace_members wm ON ((wm.workspace_id = f.workspace_id)))
  WHERE ((f.id = flow_versions.flow_id) AND (wm.user_id = auth.uid())))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY flows_delete ON public.flows FOR DELETE TO public
    USING (( SELECT public.has_permission(flows.workspace_id, 'flows.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY flows_insert ON public.flows FOR INSERT TO public
    WITH CHECK (( SELECT public.has_permission(flows.workspace_id, 'flows.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY flows_select ON public.flows FOR SELECT TO public
    USING (( SELECT public.has_permission(flows.workspace_id, 'flows.view'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY flows_update ON public.flows FOR UPDATE TO public
    USING (( SELECT public.has_permission(flows.workspace_id, 'flows.edit'::text) AS has_permission))
    WITH CHECK (( SELECT public.has_permission(flows.workspace_id, 'flows.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY enrollments_delete ON public.sequence_enrollments FOR DELETE TO public
    USING ((EXISTS ( SELECT 1
   FROM public.sequences s
  WHERE ((s.id = sequence_enrollments.sequence_id) AND public.is_workspace_admin(s.workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY enrollments_insert ON public.sequence_enrollments FOR INSERT TO public
    WITH CHECK (((EXISTS ( SELECT 1
   FROM public.sequences s
  WHERE ((s.id = sequence_enrollments.sequence_id) AND public.is_workspace_member(s.workspace_id)))) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = sequence_enrollments.contact_id) AND public.can_see_contact(c.*))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY enrollments_select ON public.sequence_enrollments FOR SELECT TO public
    USING (((EXISTS ( SELECT 1
   FROM public.sequences s
  WHERE ((s.id = sequence_enrollments.sequence_id) AND public.is_workspace_member(s.workspace_id)))) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = sequence_enrollments.contact_id) AND public.can_see_contact(c.*))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY enrollments_update ON public.sequence_enrollments FOR UPDATE TO public
    USING (((EXISTS ( SELECT 1
   FROM public.sequences s
  WHERE ((s.id = sequence_enrollments.sequence_id) AND public.is_workspace_member(s.workspace_id)))) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = sequence_enrollments.contact_id) AND public.can_see_contact(c.*))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY sequences_delete ON public.sequences FOR DELETE TO public
    USING (( SELECT public.has_permission(sequences.workspace_id, 'sequences.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY sequences_insert ON public.sequences FOR INSERT TO public
    WITH CHECK (( SELECT public.has_permission(sequences.workspace_id, 'sequences.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY sequences_select ON public.sequences FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY sequences_update ON public.sequences FOR UPDATE TO public
    USING (( SELECT public.has_permission(sequences.workspace_id, 'sequences.edit'::text) AS has_permission))
    WITH CHECK (( SELECT public.has_permission(sequences.workspace_id, 'sequences.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY trigger_fires_select ON public.trigger_fires FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY triggers_delete ON public.triggers FOR DELETE TO public
    USING (( SELECT public.has_permission(triggers.workspace_id, 'flows.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY triggers_insert ON public.triggers FOR INSERT TO public
    WITH CHECK (( SELECT public.has_permission(triggers.workspace_id, 'flows.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY triggers_select ON public.triggers FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY triggers_update ON public.triggers FOR UPDATE TO public
    USING (( SELECT public.has_permission(triggers.workspace_id, 'flows.edit'::text) AS has_permission))
    WITH CHECK (( SELECT public.has_permission(triggers.workspace_id, 'flows.edit'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
