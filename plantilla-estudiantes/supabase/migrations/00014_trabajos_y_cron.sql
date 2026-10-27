-- ============================================================================
-- Trabajos programados y cron
--
-- La cola interna de trabajos (scheduled_jobs), el registro de webhooks recibidos
-- (para no procesar dos veces el mismo), el tope por IP de los endpoints publicos, la
-- configuracion del sistema y los cron de pg_cron.
--
-- Casi todos los cron llaman a una ruta /api/cron/<nombre> de la app con
-- private.call_app_cron, que lee la URL de la app y el secreto del cron desde Vault
-- (se cargan con private.set_system_secret). Los demas corren en la base: las purgas
-- de lo borrado (pasados 30 dias) y de lo vencido (mensajes, borradores, eventos, avisos,
-- historial de cron y de pg_net).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

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

CREATE TABLE IF NOT EXISTS public.webhook_events (
  event_id text NOT NULL,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT webhook_events_pkey PRIMARY KEY (event_id)
);
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

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
    'content-upload'
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
COMMENT ON FUNCTION public.purge_old_messages(p_retention_months integer, p_batch_size integer) IS 'Borra los mensajes de mas de N meses (default 12). No distingue canal ni contacto: un mensaje de un contacto "no contactar" vence igual que cualquier otro, y los de un contacto borrado ya se van por cascade con purge_soft_deleted. La llama el cron diario.';
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
COMMENT ON FUNCTION public.purge_read_notifications(p_retention_days integer) IS 'Borra las notificaciones LEIDAS de mas de N dias. Las no leidas no se tocan nunca. La llama el cron diario.';
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
   WHERE c.deleted_at IS NOT NULL AND c.deleted_at < v_cutoff;
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

  -- Un evento con agendas NO se purga: la agenda guarda su historia y apunta al evento.
  DELETE FROM public.event_types e
   WHERE e.deleted_at IS NOT NULL AND e.deleted_at < v_cutoff
     AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.event_type_id = e.id);
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
COMMENT ON FUNCTION public.purge_zernio_inbound_messages(p_workspace_id uuid, p_apply boolean) IS 'Borra TODOS los mensajes entrantes ya guardados de los canales de Zernio, para cuando haya que deshacer su guardado. No toca los salientes ni WhatsApp. Con p_apply en false solo cuenta. No la llama ningun cron: se corre a mano con scripts/purge-zernio-inbound.mjs.';
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
COMMENT ON FUNCTION public.push_debounced_job(p_type text, p_dedupe_key text, p_payload jsonb, p_run_at timestamp with time zone, p_deadline timestamp with time zone) IS 'Version de cinco parametros: delega en la de seis sin claves volatiles. Solo service role.';
REVOKE ALL ON FUNCTION public.push_debounced_job(p_type text, p_dedupe_key text, p_payload jsonb, p_run_at timestamp with time zone, p_deadline timestamp with time zone) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits USING btree (window_start);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_booking ON public.scheduled_jobs USING btree (((payload ->> 'booking_id'::text))) WHERE (payload ? 'booking_id'::text);

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
VALUES ('draft_alerts_since', now()::text, 'Los avisos de ventana de los borradores ignoran los creados antes de esto, para que la primera corrida no avise por el historial.')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Cron (pg_cron)
-- ----------------------------------------------------------------------------

SELECT cron.schedule('agent-bursts', '15 seconds', 'SELECT private.call_app_cron(''agent-bursts'')');

SELECT cron.schedule('agent-drafts-sweep', '*/5 * * * *', 'SELECT private.sweep_agent_drafts()');

SELECT cron.schedule('automation-events', '* * * * *', 'SELECT private.call_app_cron(''automation-events'')');

SELECT cron.schedule('bg-collect', '*/15 * * * *', 'SELECT private.call_app_cron(''bg-collect'')');

SELECT cron.schedule('bg-dispatch', '*/15 * * * *', 'SELECT private.call_app_cron(''bg-dispatch'')');

SELECT cron.schedule('content-media-cleanup', '50 5 * * *', 'SELECT private.call_app_cron(''content-media-cleanup'')');

SELECT cron.schedule('content-upload', '*/2 * * * *', 'SELECT private.call_app_cron(''content-upload'');');

SELECT cron.schedule('draft-window-alerts', '*/5 * * * *', 'SELECT private.alert_draft_windows()');

SELECT cron.schedule('drafts-refresh', '*/5 * * * *', 'SELECT private.call_app_cron(''drafts-refresh'')');

SELECT cron.schedule('inactivity', '*/15 * * * *', 'SELECT private.call_app_cron(''inactivity'')');

SELECT cron.schedule('jobs', '* * * * *', 'SELECT private.call_app_cron(''jobs'')');

SELECT cron.schedule('metrics-sync', '30 * * * *', 'SELECT private.call_app_cron(''metrics-sync'')');

SELECT cron.schedule('purge-agent-drafts', '30 5 * * *', 'SELECT public.purge_agent_draft_content(12)');

SELECT cron.schedule('purge-agent-steps', '10 5 * * *', 'SELECT public.purge_agent_run_step_content(12)');

SELECT cron.schedule('purge-automation-events', '40 4 * * *', 'SELECT public.purge_automation_events(7)');

SELECT cron.schedule('purge-cron-runs', '20 5 * * *', 'SELECT private.purge_cron_run_details(3)');

SELECT cron.schedule('purge-deleted', '0 4 * * *', 'SELECT public.purge_soft_deleted(30)');

SELECT cron.schedule('purge-messages', '0 5 * * *', 'SELECT public.purge_old_messages(12)');

SELECT cron.schedule('purge-notifications', '50 4 * * *', 'SELECT public.purge_read_notifications(60)');

SELECT cron.schedule('purge-pg-net', '10 * * * *', 'SELECT private.purge_pg_net_responses(1)');

SELECT cron.schedule('purge-send-windows', '20 4 * * *', 'SELECT public.purge_send_windows(2)');

SELECT cron.schedule('purge-trigger-fires', '30 4 * * *', 'SELECT public.purge_trigger_fires(90)');

SELECT cron.schedule('sequences', '* * * * *', 'SELECT private.call_app_cron(''sequences'')');

SELECT cron.schedule('social-token-refresh', '40 4 * * 1', 'SELECT private.call_app_cron(''social-token-refresh'')');

SELECT cron.schedule('whatsapp-health', '*/5 * * * *', 'SELECT private.call_app_cron(''whatsapp-health'')');
