-- ============================================================================
-- 00327: los cron llaman a la app solo si hay algo que hacer
-- ============================================================================
--
-- Por que: el 8/11/2026 la base quedo "Unhealthy". De las ~17.000 llamadas por
-- dia que pg_cron le hace a la app con private.call_app_cron, casi todas no
-- encuentran nada: agent-bursts y send-queue corren cada 15 segundos (~5.600
-- veces cada uno), automation-events, jobs y sequences cada minuto. Cada
-- llamada despierta a la app, que le hace varias consultas a la base, y le
-- cuesta a la base descifrar dos secretos de Vault.
--
-- Que hace (sin cambiar lo que hace el sistema):
--
-- 1. Una guarda por cron: private.cron_work_<ruta>(p_now) mira, con las MISMAS
--    condiciones que el handler de app/api/cron/<ruta>, si hay trabajo. Si no
--    hay, no se llama a la app. La guarda mira 5 segundos hacia adelante
--    (lo que tarda en llegar la llamada) y ante cualquier error llama igual.
-- 2. Una llamada de seguridad: aunque la guarda diga que no hay nada, cada
--    cron llama a la app al menos una vez cada N minutos (10 por defecto). Si
--    la guarda se equivoca, se pierden como mucho N minutos, nunca el trabajo.
--    Tambien cubre lo que la guarda NO mira a proposito: la limpieza del
--    registro de webhooks (webhook_events, 48 h) en /api/cron/jobs y el aviso
--    de salud del refresco en /api/cron/drafts-refresh (una vez por dia).
-- 3. private.call_app_cron NO se toca: private.call_app_cron_if_work la
--    envuelve. El estado (la ultima llamada y los contadores) vive en una
--    tabla UNLOGGED: no escribe WAL. Si la base se reinicia de golpe, la tabla
--    se vacia y el primer tic de cada cron llama (nada se pierde).
-- 4. private.alert_draft_windows sale enseguida si no hay borradores vivos con
--    ventana (antes creaba una tabla temporal cada 5 minutos: escrituras en el
--    catalogo de la base aunque no hubiera nada).
-- 5. Realtime: messages sale de la publicacion supabase_realtime. Ninguna
--    pantalla la escucha (la bandeja escucha conversations y vuelve a pedir el
--    hilo); cada mensaje guardado se decodificaba para nadie. Ver
--    lib/realtime/tables.ts.
-- 6. Purgas: scheduled_jobs completados o cancelados de mas de 30 dias, y
--    fallidos de mas de 90 (los pendientes nunca); el historial de pg_cron
--    (cron.job_run_details) pasa de 3 dias a 1.
--
-- Que crons NO llevan guarda, y por que:
--   - bg-dispatch y metrics-sync: deciden por la hora de cada negocio con reglas
--     que viven en TypeScript (planDispatch, isSyncHour). Copiarlas al SQL
--     seria una gemela mas para 120 llamadas por dia. Siguen igual.
--   - social-token-refresh y content-media-cleanup: una vez por semana o por dia.
--
-- Las condiciones de cada guarda y su lugar en el codigo estan en
-- lib/cron/guards.ts; lib/cron/guards.test.ts ata cada umbral de aca con la
-- constante del codigo y avisa si un handler suma un barrido nuevo. Si se
-- cambia un handler, se cambia su guarda en una migracion nueva.
--
-- Aditiva: puede ir antes o despues del deploy (el codigo no cambia).
--
-- ---------------------------------------------------------------------------
-- Para volver atras (los comandos de antes, leidos de cron.job el 8/11/2026):
--   agent-bursts       SELECT private.call_app_cron('agent-bursts')
--   send-queue         SELECT private.call_app_cron('send-queue')
--   automation-events  SELECT private.call_app_cron('automation-events')
--   jobs               SELECT private.call_app_cron('jobs')
--   sequences          SELECT private.call_app_cron('sequences')
--   content-upload     SELECT private.call_app_cron('content-upload');
--   drafts-refresh     SELECT private.call_app_cron('drafts-refresh')
--   whatsapp-health    SELECT private.call_app_cron('whatsapp-health')
--   inactivity         SELECT private.call_app_cron('inactivity')
--   bg-collect         SELECT private.call_app_cron('bg-collect')
--   purge-cron-runs    SELECT private.purge_cron_run_details(3)
-- con: SELECT cron.alter_job(jobid, command := '<comando>') FROM cron.job WHERE jobname = '<nombre>';
-- Realtime: ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
-- La purga nueva: SELECT cron.unschedule('purge-scheduled-jobs');
--
-- private.alert_draft_windows antes de esta migracion (pg_get_functiondef, 8/11/2026):
--
-- CREATE OR REPLACE FUNCTION private.alert_draft_windows()
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v_since timestamptz;
--   v_drafts integer := 0;
--   v_notifications integer := 0;
-- BEGIN
--   SELECT value::timestamptz INTO v_since FROM private.system_config WHERE key = 'draft_alerts_since';
--   v_since := COALESCE(v_since, now());
--
--   CREATE TEMP TABLE IF NOT EXISTS pg_temp.draft_alerts (
--     id uuid, workspace_id uuid, owner uuid, window_hours integer, new_cuts smallint[], deepest smallint
--   ) ON COMMIT DROP;
--   TRUNCATE pg_temp.draft_alerts;
--
--   INSERT INTO pg_temp.draft_alerts (id, workspace_id, owner, window_hours, new_cuts, deepest)
--   SELECT x.id, x.workspace_id, x.owner, x.w, x.cuts, (SELECT max(t) FROM unnest(x.cuts) t)
--   FROM (
--     SELECT d.id, d.workspace_id, COALESCE(c.setter_id, c.vendedor_id) AS owner, w.w,
--       ARRAY(
--         SELECT t FROM unnest(ARRAY[2, 4, 8]::smallint[]) t
--         WHERE (d.sendable_until - now()) <= make_interval(secs => w.w * 3600.0 / t)
--           AND NOT (t = ANY (d.alerted_thresholds))
--       ) AS cuts
--     FROM public.agent_drafts d
--     JOIN public.channels ch ON ch.id = d.channel_id
--     JOIN public.contacts c ON c.id = d.contact_id
--     CROSS JOIN LATERAL (SELECT public.messaging_window_hours(ch.platform, ch.messaging_window_hours) AS w) w
--     WHERE d.status IN ('pending', 'failed')
--       AND d.sendable_until IS NOT NULL
--       AND d.sendable_until > now()
--       AND d.created_at >= v_since
--       AND w.w > 0
--     FOR UPDATE OF d SKIP LOCKED
--   ) x
--   WHERE cardinality(x.cuts) > 0;
--
--   (el resto, igual que abajo)
-- $function$
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. El estado de la guarda (UNLOGGED: no escribe WAL)
-- ----------------------------------------------------------------------------
CREATE UNLOGGED TABLE IF NOT EXISTS private.cron_guard_state (
  path text PRIMARY KEY,
  -- La ultima vez que se llamo a la app por este cron (por trabajo o por seguridad).
  last_called_at timestamptz NOT NULL,
  -- Contadores para medir: cuantas veces se llamo y cuantas se salteo, desde counted_since.
  called_count bigint NOT NULL DEFAULT 0,
  skipped_count bigint NOT NULL DEFAULT 0,
  counted_since timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.cron_guard_state FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE private.cron_guard_state IS
  'Guarda de los cron (00327): ultima llamada a la app y contadores por ruta. UNLOGGED a proposito: sin WAL, y vacia es valida (se llama).';

-- ----------------------------------------------------------------------------
-- 2. La decision (gemela de shouldCallCron en lib/cron/guards.ts, casos en
--    lib/cron/guard-decide.cases.json)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.cron_guard_decide(
  p_has_work boolean,
  p_last_called_at timestamptz,
  p_safety interval,
  p_now timestamptz
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION private.cron_guard_decide(boolean, timestamptz, interval, timestamptz) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Las guardas, una por ruta. Cada condicion copia la consulta del handler
--    (el archivo esta al lado). Todas reciben p_now para poder probarlas con
--    datos de prueba en una fecha vieja (scripts/verify-cron-guards.mjs): por
--    eso las que no dependen de la hora piden ademas created_at <= p_now, que
--    con p_now = now() no cambia nada.
--    Regla de los 5 segundos: un limite de ARRIBA (run_at <= ...) usa v_now =
--    p_now + 5 s, porque la app mira un instante despues; uno de ABAJO usa p_now.
-- ----------------------------------------------------------------------------

-- app/api/cron/agent-bursts/route.ts
CREATE OR REPLACE FUNCTION private.cron_work_agent_bursts(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;

-- app/api/cron/send-queue/route.ts -> runSendQueue (lib/send-queue/dispatch.ts)
CREATE OR REPLACE FUNCTION private.cron_work_send_queue(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;

-- app/api/cron/automation-events/route.ts
CREATE OR REPLACE FUNCTION private.cron_work_automation_events(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- La cola de eventos sin procesar (incluye los que esperan el link de Meet).
  RETURN EXISTS (
    SELECT 1 FROM public.automation_events e
    WHERE e.processed_at IS NULL AND e.created_at <= p_now + interval '5 seconds'
  );
END;
$$;

-- app/api/cron/sequences/route.ts -> public.claim_sequence_enrollments (mismo WHERE)
CREATE OR REPLACE FUNCTION private.cron_work_sequences(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;

-- app/api/cron/content-upload/route.ts (SLOW_JOB_TYPES de lib/content/jobs.ts)
CREATE OR REPLACE FUNCTION private.cron_work_content_upload(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;

-- Lo que suman al cron de jobs los modulos opcionales (hoy, los envios
-- recibidos por un endpoint propio que nadie proceso: lib/webhooks/reaper.ts).
-- En la plantilla de estudiantes la poda la deja en false.
CREATE OR REPLACE FUNCTION private.cron_work_jobs_extra(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;

-- app/api/cron/jobs/route.ts. Lo que NO mira a proposito: borrar webhook_events
-- de mas de 48 h (casi siempre hay alguno; esperar hasta la llamada de
-- seguridad solo deja el registro unos minutos mas, y eso no cambia nada).
CREATE OR REPLACE FUNCTION private.cron_work_jobs(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;

-- app/api/cron/drafts-refresh/route.ts (refreshPendingDrafts). El aviso de
-- salud (checkRefreshHealth) es diario: lo cubre la llamada de seguridad (1 h).
CREATE OR REPLACE FUNCTION private.cron_work_drafts_refresh(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.agent_drafts d
    WHERE d.status IN ('pending', 'failed') AND d.created_at <= p_now + interval '5 seconds'
  );
END;
$$;

-- app/api/cron/whatsapp-health/route.ts: hay algun numero de Evolution para revisar.
CREATE OR REPLACE FUNCTION private.cron_work_whatsapp_health(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.channels c
    WHERE c.provider = 'evolution' AND c.evolution_instance IS NOT NULL AND c.created_at <= p_now + interval '5 seconds'
  );
END;
$$;

-- app/api/cron/inactivity/route.ts: hay algun disparador de inactividad activo en un flujo publicado.
CREATE OR REPLACE FUNCTION private.cron_work_inactivity(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;

-- app/api/cron/bg-collect/route.ts todavia no hace nada (el after() esta vacio).
-- Cuando haga algo, esta guarda tiene que mirar lo mismo.
CREATE OR REPLACE FUNCTION private.cron_work_bg_collect(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT false
$$;

-- El indice de guardas. NULL = esa ruta no tiene guarda (siempre se llama).
CREATE OR REPLACE FUNCTION private.cron_has_work(p_path text, p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;

-- ----------------------------------------------------------------------------
-- 4. El envoltorio que llaman los cron. Ante cualquier error de la guarda,
--    llama: perder trabajo es peor que una llamada de mas.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.call_app_cron_if_work(p_path text, p_safety interval DEFAULT interval '10 minutes')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION private.cron_work_agent_bursts(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_work_send_queue(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_work_automation_events(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_work_sequences(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_work_content_upload(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_work_jobs_extra(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_work_jobs(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_work_drafts_refresh(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_work_whatsapp_health(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_work_inactivity(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_work_bg_collect(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_has_work(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.call_app_cron_if_work(text, interval) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.call_app_cron_if_work(text, interval) IS
  'Envuelve private.call_app_cron (00327): llama a la app solo si private.cron_has_work dice que hay trabajo, o si paso p_safety desde la ultima llamada.';

-- ----------------------------------------------------------------------------
-- 5. Los cron pasan por la guarda (cambia solo el comando, no el horario).
--    La llamada de seguridad es de 10 minutos para los que corren cada 15 s,
--    cada minuto o cada 2; mas larga para los lentos (si no, nunca se
--    saltearian): whatsapp-health y drafts-refresh 1 hora (lo que la guarda de
--    drafts-refresh no mira es un aviso diario), inactivity 2 horas y
--    bg-collect 1 dia (no hace nada). Gemela: CRON_GUARDS en lib/cron/guards.ts.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('agent-bursts', '10 minutes'),
      ('send-queue', '10 minutes'),
      ('automation-events', '10 minutes'),
      ('jobs', '10 minutes'),
      ('sequences', '10 minutes'),
      ('content-upload', '10 minutes'),
      ('whatsapp-health', '1 hour'),
      ('inactivity', '2 hours'),
      ('drafts-refresh', '1 hour'),
      ('bg-collect', '1 day')
    ) AS v(path, safety)
  LOOP
    PERFORM cron.alter_job(
      j.jobid,
      command := format('SELECT private.call_app_cron_if_work(%L, interval %L)', r.path, r.safety)
    )
    FROM cron.job j
    WHERE j.jobname = r.path;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Alertas de ventana: salir enseguida si no hay borradores vivos con ventana
--    (el mismo WHERE de adentro, sin el calculo de los cortes).
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

  -- 00327: sin borradores vivos con ventana no hay nada que avisar. Antes de
  -- esto, cada 5 minutos se creaba y borraba la tabla temporal igual.
  IF NOT EXISTS (
    SELECT 1 FROM public.agent_drafts d
    WHERE d.status IN ('pending', 'failed')
      AND d.sendable_until IS NOT NULL
      AND d.sendable_until > now()
      AND d.created_at >= v_since
  ) THEN
    RETURN jsonb_build_object('drafts', 0, 'notifications', 0);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.draft_alerts (
    id uuid, workspace_id uuid, owner uuid, window_hours integer, new_cuts smallint[], deepest smallint
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.draft_alerts;

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

  UPDATE public.agent_drafts d
  SET alerted_thresholds = d.alerted_thresholds || a.new_cuts
  FROM pg_temp.draft_alerts a
  WHERE d.id = a.id;
  GET DIAGNOSTICS v_drafts = ROW_COUNT;

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

-- ----------------------------------------------------------------------------
-- 7. Realtime: messages sale de la publicacion (nadie la escucha).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.messages;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 8. Purgas
-- ----------------------------------------------------------------------------

-- scheduled_jobs: completados y cancelados pasados p_done_days (minimo 7),
-- fallidos pasados p_failed_days (minimo 30). Los pendientes y en curso nunca.
-- Ningun codigo mira jobs terminados viejos: las claves de dedupe que se
-- consultan llevan la fecha o la ventana de hoy.
CREATE OR REPLACE FUNCTION private.purge_scheduled_jobs(p_done_days integer DEFAULT 30, p_failed_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION private.purge_scheduled_jobs(integer, integer) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('purge-scheduled-jobs', '35 4 * * *', $$SELECT private.purge_scheduled_jobs(30, 90)$$);

-- El historial de pg_cron: de 3 dias a 1. Con la purga diaria quedan entre 24
-- y 48 horas, suficiente para medir un dia entero.
SELECT cron.alter_job(j.jobid, command := 'SELECT private.purge_cron_run_details(1)')
FROM cron.job j
WHERE j.jobname = 'purge-cron-runs';
