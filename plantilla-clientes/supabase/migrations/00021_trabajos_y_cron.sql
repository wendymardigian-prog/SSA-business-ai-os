-- ============================================================================
-- Trabajos programados y cron
--
-- La cola interna de trabajos (scheduled_jobs), el registro de webhooks recibidos
-- (para no procesar dos veces el mismo), el tope por IP de los endpoints publicos, la
-- configuracion del sistema y los cron de pg_cron.
--
-- Casi todos los cron llaman a una ruta /api/cron/<nombre> de la app con
-- private.call_app_cron, que lee la URL de la app y el secreto del cron desde Vault
-- (se cargan con private.set_system_secret). Los que corren seguido pasan antes por
-- una guarda (private.call_app_cron_if_work): solo llaman si hay algo que hacer, y
-- igual una vez cada tanto por seguridad. Los de la misma frecuencia (15 s, 1 min y
-- 5 min) son un solo trabajo de pg_cron (private.cron_tick_*), con cada parte en su
-- bloque: una que falla no frena a las otras. Los demas corren en la base: las purgas
-- de lo borrado (pasados 30 dias) y de lo vencido (mensajes, borradores, eventos, avisos,
-- historial de cron y de pg_net).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE UNLOGGED TABLE IF NOT EXISTS private.cron_guard_state (
  path text NOT NULL,
  last_called_at timestamp with time zone NOT NULL,
  called_count bigint DEFAULT 0 NOT NULL,
  skipped_count bigint DEFAULT 0 NOT NULL,
  counted_since timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT cron_guard_state_pkey PRIMARY KEY (path)
);
COMMENT ON TABLE private.cron_guard_state IS 'Guarda de los cron (00327): ultima llamada a la app y contadores por ruta. UNLOGGED a proposito: sin WAL, y vacia es valida (se llama).';

CREATE UNLOGGED TABLE IF NOT EXISTS private.cron_tick_errors (
  part text NOT NULL,
  error_count bigint DEFAULT 0 NOT NULL,
  last_error_at timestamp with time zone NOT NULL,
  last_error text NOT NULL,
  counted_since timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT cron_tick_errors_pkey PRIMARY KEY (part)
);
COMMENT ON TABLE private.cron_tick_errors IS 'Errores de las partes de los cron agrupados (00350): cuantos y el ultimo. UNLOGGED a proposito: sin WAL, y se vacia si la base se reinicia.';

CREATE TABLE IF NOT EXISTS private.system_config (
  key text NOT NULL,
  value text NOT NULL,
  description text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT system_config_pkey PRIMARY KEY (key)
);
ALTER TABLE private.system_config ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE private.system_config IS 'Config del sistema que necesita la base para llamarse a si misma por HTTP (pg_cron). No es config por workspace: eso vive en integration_configs y en Vault.';

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  key text NOT NULL,
  window_start timestamp with time zone NOT NULL,
  count integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT rate_limits_pkey PRIMARY KEY (id)
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.rate_limits IS 'Tope por IP de los endpoints publicos. La IP va como hash con sal, nunca en texto. Se purga a las 24 h.';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.rate_limits FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.scheduled_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  run_at timestamp with time zone NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  claimed_at timestamp with time zone,
  dedupe_key text,
  CONSTRAINT scheduled_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.scheduled_jobs IS 'Cola interna del motor (delays de flows, entrega de broadcasts). RLS habilitada y SIN POLICIES a proposito: solo el service role entra. No es un descuido — el payload lleva variables de flow y texto de mensajes de los leads, y ninguna pantalla necesita leer esto. Si hace falta exponerla, agregar workspace_id primero.';
COMMENT ON COLUMN public.scheduled_jobs.dedupe_key IS 'Clave de un job reprogramable. Unica solo entre los pending: un job en processing sale del indice y deja lugar a una ventana nueva.';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.scheduled_jobs FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.webhook_events (
  event_id text NOT NULL,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT webhook_events_pkey PRIMARY KEY (event_id)
);
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.webhook_events FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.call_app_cron_if_work(p_path text, p_safety interval DEFAULT '00:10:00'::interval)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_work boolean;
  v_last timestamptz;
BEGIN
  BEGIN
    v_work := private.cron_has_work(p_path, now());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'cron_has_work(%) fallo, se llama igual: %', p_path, SQLERRM;
    v_work := NULL;
  END;

  SELECT s.last_called_at INTO v_last FROM private.cron_guard_state s WHERE s.path = p_path;

  IF NOT private.cron_guard_decide(v_work, v_last, p_safety, now()) THEN
    UPDATE private.cron_guard_state SET skipped_count = skipped_count + 1 WHERE path = p_path;
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO private.cron_guard_state AS s (path, last_called_at, called_count)
    VALUES (p_path, now(), 1)
    ON CONFLICT (path) DO UPDATE SET last_called_at = EXCLUDED.last_called_at, called_count = s.called_count + 1;
  EXCEPTION WHEN OTHERS THEN
    -- Sin poder anotar la llamada, se llama igual (el proximo tic tambien llamara).
    RAISE WARNING 'cron_guard_state(%) no se pudo anotar: %', p_path, SQLERRM;
  END;

  RETURN private.call_app_cron(p_path);
END;
$function$;
COMMENT ON FUNCTION private.call_app_cron_if_work(p_path text, p_safety interval) IS 'Envuelve private.call_app_cron (00327): llama a la app solo si private.cron_has_work dice que hay trabajo, o si paso p_safety desde la ultima llamada.';
REVOKE ALL ON FUNCTION private.call_app_cron_if_work(p_path text, p_safety interval) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_base text; v_secret text;
BEGIN
  IF p_path NOT IN (
    'jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events',
    'agent-bursts', 'drafts-refresh', 'bg-dispatch', 'bg-collect',
    'social-token-refresh', 'content-media-cleanup', 'metrics-sync',
    'content-upload', 'send-queue'
  ) THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;
  SELECT s.decrypted_secret INTO v_base FROM vault.decrypted_secrets s WHERE s.name = 'system:app_url';
  SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = 'system:cron_secret';
  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'falta system:app_url o system:cron_secret en Vault (cargalos con private.set_system_secret): el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;
  RETURN net.http_get(
    url => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds => 60000
  );
END; $function$;
COMMENT ON FUNCTION private.call_app_cron(p_path text) IS 'Llama a /api/cron/<path> de la app con el CRON_SECRET en el header. Solo rutas de la lista blanca. La usan los jobs de pg_cron.';
REVOKE ALL ON FUNCTION private.call_app_cron(p_path text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_guard_decide(p_has_work boolean, p_last_called_at timestamp with time zone, p_safety interval, p_now timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    -- Hay trabajo, o la guarda no sabe (NULL: sin guarda o fallo): se llama.
    WHEN p_has_work IS DISTINCT FROM false THEN true
    -- Nunca se llamo (o la tabla se vacio), o faltan datos para decidir: se llama.
    WHEN p_last_called_at IS NULL OR p_safety IS NULL OR p_now IS NULL THEN true
    -- Una ultima llamada "en el futuro" es un reloj raro: se llama.
    WHEN p_last_called_at > p_now THEN true
    -- La llamada de seguridad: paso el intervalo desde la ultima.
    ELSE p_last_called_at <= p_now - p_safety
  END
$function$;
REVOKE ALL ON FUNCTION private.cron_guard_decide(p_has_work boolean, p_last_called_at timestamp with time zone, p_safety interval, p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_has_work(p_path text, p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN CASE p_path
    WHEN 'agent-bursts' THEN private.cron_work_agent_bursts(p_now)
    WHEN 'send-queue' THEN private.cron_work_send_queue(p_now)
    WHEN 'automation-events' THEN private.cron_work_automation_events(p_now)
    WHEN 'sequences' THEN private.cron_work_sequences(p_now)
    WHEN 'content-upload' THEN private.cron_work_content_upload(p_now)
    WHEN 'jobs' THEN private.cron_work_jobs(p_now)
    WHEN 'drafts-refresh' THEN private.cron_work_drafts_refresh(p_now)
    WHEN 'whatsapp-health' THEN private.cron_work_whatsapp_health(p_now)
    WHEN 'inactivity' THEN private.cron_work_inactivity(p_now)
    WHEN 'bg-collect' THEN private.cron_work_bg_collect(p_now)
    ELSE NULL
  END;
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_has_work(p_path text, p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_tick_15_seconds()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '10s'
AS $function$
BEGIN
  BEGIN
    PERFORM private.call_app_cron_if_work('agent-bursts', interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('agent-bursts', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('send-queue', interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('send-queue', SQLERRM);
  END;
END;
$function$;
COMMENT ON FUNCTION private.cron_tick_15_seconds() IS 'Cron every-15-seconds (00350): agent-bursts y send-queue, cada uno por su guarda y en su bloque.';
REVOKE ALL ON FUNCTION private.cron_tick_15_seconds() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_tick_5_minutes()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '10s'
AS $function$
BEGIN
  -- Primero se vencen los borradores cuya ventana ya cerro: los avisos y la
  -- guarda de drafts-refresh, que van despues, ya no los ven.
  BEGIN
    PERFORM private.sweep_agent_drafts();
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('agent-drafts-sweep', SQLERRM);
  END;

  BEGIN
    PERFORM private.alert_draft_windows();
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('draft-window-alerts', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('drafts-refresh', interval '1 hour');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('drafts-refresh', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('whatsapp-health', interval '1 hour');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('whatsapp-health', SQLERRM);
  END;
END;
$function$;
COMMENT ON FUNCTION private.cron_tick_5_minutes() IS 'Cron every-5-minutes (00350): sweep_agent_drafts, alert_draft_windows, drafts-refresh y whatsapp-health, cada uno en su bloque.';
REVOKE ALL ON FUNCTION private.cron_tick_5_minutes() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_tick_minute()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '10s'
AS $function$
BEGIN
  BEGIN
    PERFORM private.call_app_cron_if_work('automation-events', interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('automation-events', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('jobs', interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('jobs', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('sequences', interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('sequences', SQLERRM);
  END;
END;
$function$;
COMMENT ON FUNCTION private.cron_tick_minute() IS 'Cron every-minute (00350): automation-events, jobs y sequences, cada uno por su guarda y en su bloque.';
REVOKE ALL ON FUNCTION private.cron_tick_minute() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_tick_note_error(p_part text, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  RAISE WARNING 'cron %: %', p_part, p_error;
  BEGIN
    INSERT INTO private.cron_tick_errors AS e (part, error_count, last_error_at, last_error)
    VALUES (p_part, 1, now(), left(COALESCE(p_error, '(sin mensaje)'), 500))
    ON CONFLICT (part) DO UPDATE
      SET error_count = e.error_count + 1, last_error_at = EXCLUDED.last_error_at, last_error = EXCLUDED.last_error;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'cron_tick_errors(%) no se pudo anotar: %', p_part, SQLERRM;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_tick_note_error(p_part text, p_error text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_work_agent_bursts(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := p_now + interval '5 seconds';
BEGIN
  -- Turnos del agente vencidos (la cola de la ruta).
  IF EXISTS (
    SELECT 1 FROM public.scheduled_jobs j
    WHERE j.status = 'pending' AND j.type = 'agent_burst' AND j.run_at <= v_now
  ) THEN RETURN true; END IF;

  -- Turnos trabados en processing (expireStuckJobs, STALE_CLAIM_MS = 6 min).
  IF EXISTS (
    SELECT 1 FROM public.scheduled_jobs j
    WHERE j.status = 'processing' AND j.type = 'agent_burst' AND j.claimed_at < v_now - interval '6 minutes'
  ) THEN RETURN true; END IF;

  -- Corridas de IA abiertas de un proceso que murio, de CUALQUIER origen
  -- (closeStaleRuns en lib/ai/run.ts, 10 minutos).
  IF EXISTS (
    SELECT 1 FROM public.agent_runs r
    WHERE r.status = 'running' AND r.created_at < v_now - interval '10 minutes'
  ) THEN RETURN true; END IF;

  RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_work_agent_bursts(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_work_automation_events(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- La cola de eventos sin procesar (incluye los que esperan el link de Meet).
  RETURN EXISTS (
    SELECT 1 FROM public.automation_events e
    WHERE e.processed_at IS NULL AND e.created_at <= p_now + interval '5 seconds'
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_work_automation_events(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_work_bg_collect(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT false
$function$;
REVOKE ALL ON FUNCTION private.cron_work_bg_collect(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_work_content_upload(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := p_now + interval '5 seconds';
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.scheduled_jobs j
    WHERE j.status = 'pending'
      AND j.type IN ('content_upload', 'content_provider_schedule')
      AND j.run_at <= v_now
  ) THEN RETURN true; END IF;

  -- Reclamados que quedaron colgados (STALE_CLAIM_MS = 10 min), o sin fecha de reclamo.
  IF EXISTS (
    SELECT 1 FROM public.scheduled_jobs j
    WHERE j.status = 'processing'
      AND j.type IN ('content_upload', 'content_provider_schedule')
      AND j.run_at <= v_now
      AND (j.claimed_at IS NULL OR j.claimed_at < v_now - interval '10 minutes')
  ) THEN RETURN true; END IF;

  RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_work_content_upload(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_work_drafts_refresh(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.agent_drafts d
    WHERE d.status IN ('pending', 'failed') AND d.created_at <= p_now + interval '5 seconds'
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_work_drafts_refresh(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_work_inactivity(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.triggers t
    JOIN public.flows f ON f.id = t.flow_id
    WHERE t.type = 'inactivity'
      AND t.is_active
      AND f.status = 'published'
      AND t.created_at <= p_now + interval '5 seconds'
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_work_inactivity(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_work_jobs_extra(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := p_now + interval '5 seconds';
BEGIN
  IF to_regclass('public.inbound_webhooks') IS NULL THEN
    RETURN false;
  END IF;
  -- Guardados y sin procesar (RECEIVED_STALE_MS = 2 min).
  IF EXISTS (
    SELECT 1 FROM public.inbound_webhooks w
    WHERE w.status = 'received' AND w.received_at < v_now - interval '2 minutes'
  ) THEN RETURN true; END IF;
  -- Procesandose desde hace demasiado (PROCESSING_STALE_MS = 15 min).
  IF EXISTS (
    SELECT 1 FROM public.inbound_webhooks w
    WHERE w.status = 'processing' AND w.processing_started_at < v_now - interval '15 minutes'
  ) THEN RETURN true; END IF;
  RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_work_jobs_extra(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_work_jobs(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := p_now + interval '5 seconds';
  v_agent record;
BEGIN
  -- La cola general: pendientes vencidos y reclamos viejos (STALE_INVOCATION_MS = 5 min)
  -- o sin fecha de reclamo. Sin los turnos del agente ni las subidas largas, que
  -- tienen su propia ruta.
  IF EXISTS (
    SELECT 1 FROM public.scheduled_jobs j
    WHERE j.status = 'pending'
      AND j.run_at <= v_now
      AND j.type NOT IN ('agent_burst', 'content_upload')
  ) THEN RETURN true; END IF;
  IF EXISTS (
    SELECT 1 FROM public.scheduled_jobs j
    WHERE j.status = 'processing'
      AND j.run_at <= v_now
      AND j.type NOT IN ('agent_burst', 'content_upload')
      AND (j.claimed_at IS NULL OR j.claimed_at < v_now - interval '5 minutes')
  ) THEN RETURN true; END IF;

  -- Documentos de Conocimiento borrados hace mas de 30 dias (purgeDeletedKnowledgeDocuments).
  IF EXISTS (
    SELECT 1 FROM public.knowledge_base k
    WHERE k.deleted_at IS NOT NULL AND k.deleted_at < v_now - interval '30 days'
  ) THEN RETURN true; END IF;

  -- Publicaciones colgadas en "publicando" (sweepStuckPublications, STUCK_AFTER_MINUTES = 30).
  IF EXISTS (
    SELECT 1 FROM public.social_posts p
    WHERE p.status = 'publishing' AND p.updated_at < v_now - interval '30 minutes' AND p.deleted_at IS NULL
  ) THEN RETURN true; END IF;

  -- Agendadas en el proveedor cuya hora paso (reconcileProviderSchedules, RECONCILE_AFTER_MINUTES = 15).
  IF EXISTS (
    SELECT 1 FROM public.social_posts p
    WHERE p.status = 'scheduled'
      AND p.publisher_ref IS NOT NULL
      AND p.scheduled_at < v_now - interval '15 minutes'
      AND p.deleted_at IS NULL
  ) THEN RETURN true; END IF;

  -- Transcripciones colgadas (reapStuckTranscriptions, STUCK_TRANSCRIPT_MS = 10 min).
  IF EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.transcript_status = 'pending' AND m.transcript_started_at < v_now - interval '10 minutes'
  ) THEN RETURN true; END IF;

  -- Cierre por inactividad (sweepInactiveConversations): la MISMA consulta que
  -- usa la app, por cada agente prendido con canales. La app ademas filtra por
  -- tipo de agente: aca se pregunta de mas, nunca de menos.
  -- SWEEP_MAX_AGE_DAYS = 14 y el default de close_after_inactive_hours = 12
  -- (lib/agent/closing.ts y lib/agent/config.ts).
  FOR v_agent IN
    SELECT a.workspace_id, a.enabled_channel_ids, COALESCE(a.close_after_inactive_hours, 12) AS hours
    FROM public.agents a
    WHERE a.deleted_at IS NULL
      AND a.is_enabled
      AND cardinality(a.enabled_channel_ids) > 0
      AND a.created_at <= v_now
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.closable_inactive_conversations(
        v_agent.workspace_id,
        v_agent.enabled_channel_ids,
        v_now - make_interval(hours => v_agent.hours),
        p_now - interval '14 days',
        v_now,
        1
      )
    ) THEN RETURN true; END IF;
  END LOOP;

  RETURN private.cron_work_jobs_extra(p_now);
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_work_jobs(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_work_send_queue(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := p_now + interval '5 seconds';
BEGIN
  -- Destinatarios que quedaron `sending` (reapStaleSending, STALE_SENDING_MS = 5 min).
  IF EXISTS (
    SELECT 1 FROM public.broadcast_recipients r
    WHERE r.status = 'sending' AND r.claimed_at < v_now - interval '5 minutes'
  ) THEN RETURN true; END IF;

  -- Broadcasts programados cuya hora llego (activateScheduled).
  IF EXISTS (
    SELECT 1 FROM public.broadcasts b
    WHERE b.status = 'scheduled' AND b.scheduled_for <= v_now
  ) THEN RETURN true; END IF;

  -- Broadcasts enviandose cuyo carril puede trabajar (runLane): sin carril
  -- todavia (lo crea), o sin pausa y con next_send_at ya cumplido. Un carril
  -- pausado o esperando no hace nada hasta su hora.
  IF EXISTS (
    SELECT 1
    FROM public.broadcasts b
    LEFT JOIN public.channel_send_lanes l ON l.channel_id = b.channel_id
    WHERE b.status = 'sending'
      AND b.channel_id IS NOT NULL
      AND b.created_at <= v_now
      AND (l.channel_id IS NULL OR (l.paused_at IS NULL AND (l.next_send_at IS NULL OR l.next_send_at <= v_now)))
  ) THEN RETURN true; END IF;

  RETURN false;
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_work_send_queue(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_work_sequences(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := p_now + interval '5 seconds';
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.sequence_enrollments e
    WHERE e.status = 'active'
      AND e.next_step_at IS NOT NULL
      AND e.next_step_at <= v_now
      AND (e.locked_at IS NULL OR e.locked_at < v_now - interval '5 minutes')
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_work_sequences(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cron_work_whatsapp_health(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.channels c
    WHERE c.provider = 'evolution' AND c.evolution_instance IS NOT NULL AND c.created_at <= p_now + interval '5 seconds'
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.cron_work_whatsapp_health(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.purge_cron_run_details(p_retention_days integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_tables
    WHERE schemaname = 'cron' AND tablename = 'job_run_details'
  ) THEN
    RAISE WARNING 'cron.job_run_details no existe: pg_cron cambio de esquema, hay que revisar la limpieza';
    RETURN 0;
  END IF;

  EXECUTE 'DELETE FROM cron.job_run_details WHERE end_time < now() - make_interval(days => $1)'
  USING GREATEST(p_retention_days, 1);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
COMMENT ON FUNCTION private.purge_cron_run_details(p_retention_days integer) IS 'Borra el historial de ejecuciones de pg_cron de mas de N dias. Sin esto cron.job_run_details crece sin techo (el cron del agente corre cada 15 s).';
REVOKE ALL ON FUNCTION private.purge_cron_run_details(p_retention_days integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.purge_pg_net_responses(p_retention_days integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_tables
    WHERE schemaname = 'net' AND tablename = '_http_response'
  ) THEN
    RAISE WARNING 'net._http_response no existe: pg_net cambio de esquema, hay que revisar la limpieza';
    RETURN 0;
  END IF;

  EXECUTE 'DELETE FROM net._http_response WHERE created < now() - make_interval(days => $1)'
  USING p_retention_days;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
COMMENT ON FUNCTION private.purge_pg_net_responses(p_retention_days integer) IS 'Borra las respuestas HTTP viejas que guarda pg_net. Sin esto net._http_response crece sin techo.';
REVOKE ALL ON FUNCTION private.purge_pg_net_responses(p_retention_days integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.purge_scheduled_jobs(p_done_days integer DEFAULT 30, p_failed_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.scheduled_jobs j
  WHERE (
      j.status IN ('completed', 'cancelled')
      AND GREATEST(j.created_at, j.run_at) < now() - make_interval(days => GREATEST(COALESCE(p_done_days, 30), 7))
    ) OR (
      j.status = 'failed'
      AND GREATEST(j.created_at, j.run_at) < now() - make_interval(days => GREATEST(COALESCE(p_failed_days, 90), 30))
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
REVOKE ALL ON FUNCTION private.purge_scheduled_jobs(p_done_days integer, p_failed_days integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.bump_rate_limit(p_key text, p_window_start timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.rate_limits (key, window_start, count)
  VALUES (p_key, p_window_start, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.bump_rate_limit(p_key text, p_window_start timestamp with time zone) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_agent_draft_content(p_retention_months integer DEFAULT 12)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.agent_drafts
  SET body = NULL,
      body_parts = NULL,
      sent_body = CASE WHEN status = 'sent' THEN '' ELSE NULL END,
      no_reply_reason = COALESCE(no_reply_reason, 'purged')
  WHERE status IN ('sent', 'discarded', 'superseded', 'regenerated', 'expired')
    AND created_at < now() - make_interval(months => GREATEST(p_retention_months, 1))
    AND (body IS NOT NULL OR body_parts IS NOT NULL OR (sent_body IS NOT NULL AND sent_body <> ''));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
COMMENT ON FUNCTION public.purge_agent_draft_content(p_retention_months integer) IS 'Vacia el texto de los borradores terminados de mas de N meses (default 12), la misma politica que el contenido de messages. La fila queda para las metricas.';
REVOKE ALL ON FUNCTION public.purge_agent_draft_content(p_retention_months integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_agent_run_step_content(p_retention_months integer DEFAULT 12)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
COMMENT ON FUNCTION public.purge_agent_run_step_content(p_retention_months integer) IS 'Vacia input/output de los pasos de runs vencidos (misma retencion que messages) o cuyo contacto fue purgado. Conserva la fila y sus metricas. La llama el cron diario.';
REVOKE ALL ON FUNCTION public.purge_agent_run_step_content(p_retention_months integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_automation_events(p_retention_days integer DEFAULT 7)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.automation_events
  WHERE processed_at IS NOT NULL
    AND processed_at < now() - make_interval(days => p_retention_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
REVOKE ALL ON FUNCTION public.purge_automation_events(p_retention_days integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_old_messages(p_retention_months integer DEFAULT 12, p_batch_size integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cutoff  timestamptz := now() - make_interval(months => GREATEST(p_retention_months, 1));
  v_deleted integer := 0;
  v_batch   integer := 0;
  v_rounds  integer := 0;
BEGIN
  -- Por lotes y no de un saque. Todo corre igual dentro de una transaccion
  -- (plpgsql no puede commitear en el medio), asi que esto no libera el lock
  -- entre vueltas; lo que evita es un unico DELETE enorme la primera vez que
  -- corra sobre una tabla con anios de historia. A la escala de una agencia el
  -- borrado diario es de unos pocos miles de filas y termina al instante.
  LOOP
    DELETE FROM public.messages
    WHERE id IN (
      SELECT id FROM public.messages
      WHERE created_at < v_cutoff
      ORDER BY created_at
      LIMIT GREATEST(p_batch_size, 1)
    );

    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_deleted := v_deleted + v_batch;
    v_rounds  := v_rounds + 1;

    EXIT WHEN v_batch = 0;

    -- Freno de mano: 200 lotes son un millon de filas. Si un dia hiciera falta
    -- borrar mas que eso de una vez, es una migracion pensada, no un cron que
    -- se queda toda la noche tomando la tabla del inbox.
    IF v_rounds >= 200 THEN
      RAISE WARNING 'purge_old_messages corto en % lotes (% filas). Queda historia por borrar: volve a correrla.', v_rounds, v_deleted;
      EXIT;
    END IF;
  END LOOP;

  RETURN v_deleted;
END;
$function$;
COMMENT ON FUNCTION public.purge_old_messages(p_retention_months integer, p_batch_size integer) IS 'Borra los mensajes de mas de N meses (default 12). Politica de retencion de la Fase 3. No distingue canal ni contacto: un mensaje de un contacto "no contactar" vence igual que cualquier otro, y los de un contacto borrado ya se van por cascade con purge_soft_deleted. La llama el cron diario.';
REVOKE ALL ON FUNCTION public.purge_old_messages(p_retention_months integer, p_batch_size integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_rate_limits()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v integer;
BEGIN
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '24 hours';
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.purge_rate_limits() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_read_notifications(p_retention_days integer DEFAULT 60)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.notifications
  WHERE read_at IS NOT NULL
    AND read_at < now() - make_interval(days => GREATEST(p_retention_days, 1));

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
COMMENT ON FUNCTION public.purge_read_notifications(p_retention_days integer) IS 'Borra las notificaciones LEIDAS de mas de N dias. Las no leidas de mas de 60 dias las borra purge_stale_unread_notifications (00338). La llama el cron diario.';
REVOKE ALL ON FUNCTION public.purge_read_notifications(p_retention_days integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_send_windows(p_retention_days integer DEFAULT 2)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.channel_send_windows
  WHERE window_start < now() - make_interval(days => p_retention_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
REVOKE ALL ON FUNCTION public.purge_send_windows(p_retention_days integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_soft_deleted(p_retention_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cutoff     timestamptz := now() - make_interval(days => GREATEST(p_retention_days, 0));
  v_contacts   integer := 0;
  v_notes      integer := 0;
  v_convs      integer := 0;
  v_assets     integer := 0;
  v_schedules  integer := 0;
  v_ooo        integer := 0;
  v_events     integer := 0;
BEGIN
  DELETE FROM public.contacts c
   WHERE c.deleted_at IS NOT NULL AND c.deleted_at < v_cutoff
     AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.contact_id = c.id);
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_convs = ROW_COUNT;

  DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.response_assets WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_assets = ROW_COUNT;

  DELETE FROM public.availability_schedules WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_schedules = ROW_COUNT;

  DELETE FROM public.out_of_office WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_ooo = ROW_COUNT;

  -- Un evento con agendas NO se purga: la agenda guarda su historia y apunta
  -- al evento. (bookings llega en la 00099; antes de eso la condicion de
  -- existencia da falso y se purgan todos los borrados.)
  IF to_regclass('public.bookings') IS NULL THEN
    DELETE FROM public.event_types WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  ELSE
    EXECUTE '
      DELETE FROM public.event_types e
      WHERE e.deleted_at IS NOT NULL AND e.deleted_at < $1
        AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.event_type_id = e.id)
    ' USING v_cutoff;
  END IF;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_assets', v_assets,
    'availability_schedules', v_schedules,
    'out_of_office', v_ooo,
    'event_types', v_events
  );
END;
$function$;
COMMENT ON FUNCTION public.purge_soft_deleted(p_retention_days integer) IS 'Borra de verdad lo que lleva mas de N dias marcado como eliminado. La llama el cron diario /api/cron/purge-deleted.';
REVOKE ALL ON FUNCTION public.purge_soft_deleted(p_retention_days integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_stale_unread_notifications(p_retention_days integer DEFAULT 60)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  -- Nunca menos de 30 dias: un aviso de la semana pasada sin leer todavia sirve.
  DELETE FROM public.notifications
  WHERE read_at IS NULL
    AND created_at < now() - make_interval(days => GREATEST(p_retention_days, 30));

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
COMMENT ON FUNCTION public.purge_stale_unread_notifications(p_retention_days integer) IS 'Borra las notificaciones SIN LEER de mas de N dias (minimo 30). Las leidas las borra purge_read_notifications. La llama el cron diario purge-notifications (00338).';
REVOKE ALL ON FUNCTION public.purge_stale_unread_notifications(p_retention_days integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_trigger_fires(p_retention_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.trigger_fires
  WHERE fired_at < now() - make_interval(days => p_retention_days)
    AND dedupe_key LIKE 'conv:%';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
REVOKE ALL ON FUNCTION public.purge_trigger_fires(p_retention_days integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_zernio_inbound_messages(p_workspace_id uuid, p_apply boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'purge_zernio_inbound_messages necesita un workspace: sin el, borraria de todos';
  END IF;

  IF NOT p_apply THEN
    SELECT count(*) INTO v_count
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      JOIN public.channels ch     ON ch.id = c.channel_id
     WHERE m.workspace_id = p_workspace_id
       AND m.direction = 'inbound'
       AND ch.provider = 'zernio';
    RETURN v_count;
  END IF;

  DELETE FROM public.messages m
   USING public.conversations c, public.channels ch
   WHERE c.id = m.conversation_id
     AND ch.id = c.channel_id
     AND m.workspace_id = p_workspace_id
     AND m.direction = 'inbound'
     AND ch.provider = 'zernio';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
COMMENT ON FUNCTION public.purge_zernio_inbound_messages(p_workspace_id uuid, p_apply boolean) IS 'La otra mitad del interruptor persist_zernio_inbound: borra TODOS los mensajes entrantes ya guardados de los canales de Zernio, para cuando haya que deshacer la persistencia. No toca los salientes ni WhatsApp. Con p_apply en false solo cuenta. No la llama ningun cron: se corre a mano con scripts/purge-zernio-inbound.mjs.';
REVOKE ALL ON FUNCTION public.purge_zernio_inbound_messages(p_workspace_id uuid, p_apply boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.push_debounced_job(p_type text, p_dedupe_key text, p_payload jsonb, p_run_at timestamp with time zone, p_deadline timestamp with time zone, p_volatile_keys text[])
 RETURNS TABLE(job_id uuid, job_run_at timestamp with time zone, created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_attempt  integer := 0;
  v_volatile text[] := COALESCE(p_volatile_keys, '{}');
BEGIN
  IF p_type IS NULL OR p_dedupe_key IS NULL OR p_run_at IS NULL THEN
    RAISE EXCEPTION 'push_debounced_job: type, dedupe_key y run_at son obligatorios';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;

    RETURN QUERY
    INSERT INTO public.scheduled_jobs AS j (type, payload, run_at, dedupe_key)
    VALUES (
      p_type,
      COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('burst_deadline', p_deadline),
      LEAST(p_run_at, p_deadline),
      p_dedupe_key
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending'
    DO UPDATE SET
      run_at = GREATEST(
        j.run_at,
        LEAST(p_run_at, (j.payload->>'burst_deadline')::timestamptz)
      ),
      payload = (
        j.payload || jsonb_build_object(
          'last_message_at', COALESCE(p_payload->'last_message_at', to_jsonb(now()))
        )
      ) - v_volatile
    WHERE j.status = 'pending'
    RETURNING j.id, j.run_at, (j.xmax = 0);

    IF FOUND THEN
      RETURN;
    END IF;

    IF v_attempt >= 3 THEN
      RAISE EXCEPTION 'push_debounced_job: no se pudo agendar % despues de % intentos', p_dedupe_key, v_attempt;
    END IF;
  END LOOP;
END;
$function$;
COMMENT ON FUNCTION public.push_debounced_job(p_type text, p_dedupe_key text, p_payload jsonb, p_run_at timestamp with time zone, p_deadline timestamp with time zone, p_volatile_keys text[]) IS 'Agenda o empuja hacia adelante un job reprogramable. En un conflicto (dos disparadores fusionados) descarta del payload las claves de p_volatile_keys, vengan del job existente o del que entra. Solo service role.';
REVOKE ALL ON FUNCTION public.push_debounced_job(p_type text, p_dedupe_key text, p_payload jsonb, p_run_at timestamp with time zone, p_deadline timestamp with time zone, p_volatile_keys text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.push_debounced_job(p_type text, p_dedupe_key text, p_payload jsonb, p_run_at timestamp with time zone, p_deadline timestamp with time zone)
 RETURNS TABLE(job_id uuid, job_run_at timestamp with time zone, created boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT * FROM public.push_debounced_job(p_type, p_dedupe_key, p_payload, p_run_at, p_deadline, '{}'::text[]);
$function$;
COMMENT ON FUNCTION public.push_debounced_job(p_type text, p_dedupe_key text, p_payload jsonb, p_run_at timestamp with time zone, p_deadline timestamp with time zone) IS 'Firma original (00061): delega en la de seis parametros sin claves volatiles. Solo service role.';
REVOKE ALL ON FUNCTION public.push_debounced_job(p_type text, p_dedupe_key text, p_payload jsonb, p_run_at timestamp with time zone, p_deadline timestamp with time zone) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits USING btree (window_start);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_booking ON public.scheduled_jobs USING btree (((payload ->> 'booking_id'::text))) WHERE (payload ? 'booking_id'::text);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_payment ON public.scheduled_jobs USING btree (((payload ->> 'payment_id'::text))) WHERE (payload ? 'payment_id'::text);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_pending ON public.scheduled_jobs USING btree (run_at) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_processing ON public.scheduled_jobs USING btree (claimed_at) WHERE (status = 'processing'::text);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_type_pending ON public.scheduled_jobs USING btree (type, run_at) WHERE (status = 'pending'::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_limits_key_window ON public.rate_limits USING btree (key, window_start);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_jobs_bg_task_dedupe ON public.scheduled_jobs USING btree (dedupe_key) WHERE ((type = 'bg_task'::text) AND (dedupe_key IS NOT NULL));
COMMENT ON INDEX public.uq_scheduled_jobs_bg_task_dedupe IS 'Una ventana de tarea en segundo plano se despacha UNA vez, en cualquier estado que haya quedado el job. Acotado a bg_task para no tocar la ventana de agent_burst ni el re-planificado de los avisos de agenda, que necesitan repetir su clave.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_jobs_dedupe_pending ON public.scheduled_jobs USING btree (dedupe_key) WHERE ((dedupe_key IS NOT NULL) AND (status = 'pending'::text));

CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx ON public.webhook_events USING btree (received_at);

-- ----------------------------------------------------------------------------
-- Datos iniciales
-- ----------------------------------------------------------------------------

INSERT INTO private.system_config (key, value, description)
VALUES ('draft_alerts_since', now()::text, 'Los avisos de ventana (00072) ignoran los borradores creados antes de esto, para que la primera corrida no dispare el historial.')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Cron (pg_cron)
-- ----------------------------------------------------------------------------

SELECT cron.schedule('affiliates-daily', '15 * * * *', 'SELECT private.affiliates_daily();');

SELECT cron.schedule('bg-collect', '*/15 * * * *', 'SELECT private.call_app_cron_if_work(''bg-collect'', interval ''1 day'')');

SELECT cron.schedule('bg-dispatch', '*/15 * * * *', 'SELECT private.call_app_cron(''bg-dispatch'')');

SELECT cron.schedule('content-media-cleanup', '50 5 * * *', 'SELECT private.call_app_cron(''content-media-cleanup'')');

SELECT cron.schedule('content-upload', '*/2 * * * *', 'SELECT private.call_app_cron_if_work(''content-upload'', interval ''10 minutes'')');

SELECT cron.schedule('design-cleanup', '23 4 * * *', 'SELECT private.enqueue_design_cleanup()');

SELECT cron.schedule('eod-reminders-enqueue', '*/15 * * * *', 'SELECT private.enqueue_eod_reminders()');

SELECT cron.schedule('every-15-seconds', '15 seconds', 'SELECT private.cron_tick_15_seconds()');

SELECT cron.schedule('every-5-minutes', '3-59/5 * * * *', 'SELECT private.cron_tick_5_minutes()');

SELECT cron.schedule('every-minute', '* * * * *', 'SELECT private.cron_tick_minute()');

SELECT cron.schedule('fathom-sync', '*/10 * * * *', 'SELECT private.enqueue_fathom_sync()');

SELECT cron.schedule('finance-daily', '7 * * * *', 'SELECT private.enqueue_finance_daily()');

SELECT cron.schedule('inactivity', '*/15 * * * *', 'SELECT private.call_app_cron_if_work(''inactivity'', interval ''2 hours'')');

SELECT cron.schedule('meta-capi-cleanup', '23 4 * * *', 'DELETE FROM public.meta_capi_request_context WHERE created_at < now() - interval ''8 days'';
    DELETE FROM public.meta_capi_events WHERE created_at < now() - interval ''180 days'' AND status <> ''pending'';');

SELECT cron.schedule('metrics-sync', '30 * * * *', 'SELECT private.call_app_cron(''metrics-sync'')');

SELECT cron.schedule('payments-overdue-enqueue', '7 * * * *', 'SELECT private.enqueue_payments_overdue_sweep()');

SELECT cron.schedule('purge-agent-drafts', '30 5 * * *', 'SELECT public.purge_agent_draft_content(12)');

SELECT cron.schedule('purge-agent-steps', '10 5 * * *', 'SELECT public.purge_agent_run_step_content(12)');

SELECT cron.schedule('purge-automation-events', '40 4 * * *', 'SELECT public.purge_automation_events(7)');

SELECT cron.schedule('purge-cron-runs', '20 5 * * *', 'SELECT private.purge_cron_run_details(1)');

SELECT cron.schedule('purge-deleted', '0 4 * * *', 'SELECT public.purge_soft_deleted(30)');

SELECT cron.schedule('purge-messages', '0 5 * * *', 'SELECT public.purge_old_messages(12)');

SELECT cron.schedule('purge-notifications', '50 4 * * *', 'SELECT public.purge_read_notifications(60), public.purge_stale_unread_notifications(60)');

SELECT cron.schedule('purge-pg-net', '10 * * * *', 'SELECT private.purge_pg_net_responses(1)');

SELECT cron.schedule('purge-scheduled-jobs', '35 4 * * *', 'SELECT private.purge_scheduled_jobs(30, 90)');

SELECT cron.schedule('purge-send-windows', '20 4 * * *', 'SELECT public.purge_send_windows(2)');

SELECT cron.schedule('purge-trigger-fires', '30 4 * * *', 'SELECT public.purge_trigger_fires(90)');

SELECT cron.schedule('social-token-refresh', '40 4 * * 1', 'SELECT private.call_app_cron(''social-token-refresh'')');

SELECT cron.schedule('svc-daily', '23 * * * *', 'SELECT private.enqueue_svc_daily()');

SELECT cron.schedule('tasks-due-enqueue', '17 * * * *', 'SELECT private.enqueue_tasks_due_sweep()');
