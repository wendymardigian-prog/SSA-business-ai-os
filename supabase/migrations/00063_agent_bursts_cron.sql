-- ============================================================================
-- 00063 — Cron del agente cada 15 segundos y purgas ajustadas al volumen nuevo
-- ============================================================================
-- Fase 3, Bloque 2a.
--
-- 1. Ruta de cron propia: /api/cron/agent-bursts.
--    El runner general (/api/cron/jobs) procesa 20 jobs por corrida y una tanda
--    de broadcasts podria demorar el turno del agente varios minutos. Separarlo
--    lo aisla de esa cola.
--
-- 2. Cada 15 segundos y no cada minuto. El envio apunta a un objetivo absoluto
--    (ultimo_mensaje + ventana + demora), y la demora absorbe el tic del cron y
--    el tiempo de generacion. Con un cron por minuto el tic mete hasta 60 s de
--    azar y la demora default no alcanza a taparlo; con 15 s, si. pg_cron 1.6.4
--    soporta intervalos sub-minuto ('15 seconds').
--    Son ~5.760 llamadas por dia que salen por la puerta de atras cuando no hay
--    turnos pendientes.
--
-- 3. Purgas. Ese volumen se acumula en dos lugares:
--    - net._http_response: la purga pasa de diaria con 3 dias de retencion a
--      CADA HORA con 1 dia. Pico entre purgas: ~12.000 filas en vez de ~47.000.
--    - cron.job_run_details: pg_cron anota cada ejecucion y hasta hoy nadie la
--      limpiaba. Con este cron sumaria 5.760 filas por dia para siempre. Se
--      purga una vez por dia con 3 dias de retencion.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Lista blanca de rutas
-- ------------------------------------------------------------
-- Misma funcion de la 00036, con 'agent-bursts' agregado. Todo lo demas igual.

CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base   text;
  v_secret text;
BEGIN
  IF p_path NOT IN ('jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events', 'agent-bursts') THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;

  SELECT value INTO v_base   FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';

  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;

  RETURN net.http_get(
    url     => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    timeout_milliseconds => 60000
  );
END;
$$;

REVOKE ALL ON FUNCTION private.call_app_cron(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Limpieza de cron.job_run_details
-- ------------------------------------------------------------
-- Mismo patron defensivo que purge_pg_net_responses: la tabla es interna de
-- pg_cron, asi que si cambia de esquema la funcion avisa en vez de reventar.

CREATE OR REPLACE FUNCTION private.purge_cron_run_details(p_retention_days integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION private.purge_cron_run_details(integer) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.purge_cron_run_details(integer) IS
  'Borra el historial de ejecuciones de pg_cron de mas de N dias. Sin esto cron.job_run_details crece sin techo (el cron del agente corre cada 15 s).';

-- ------------------------------------------------------------
-- 3. Los schedules
-- ------------------------------------------------------------

DO $$
DECLARE
  v_job text;
BEGIN
  FOREACH v_job IN ARRAY ARRAY[
    'ssa-cron-agent-bursts',
    'ssa-cron-purge-pg-net',
    'ssa-cron-purge-cron-runs'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job) THEN
      PERFORM cron.unschedule(v_job);
    END IF;
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'ssa-cron-agent-bursts',
  '15 seconds',
  $$SELECT private.call_app_cron('agent-bursts')$$
);

-- Cada hora al minuto 10, 1 dia de retencion (antes: 4:10 diario, 3 dias).
SELECT cron.schedule(
  'ssa-cron-purge-pg-net',
  '10 * * * *',
  $$SELECT private.purge_pg_net_responses(1)$$
);

-- 5:20, despues de las purgas de mensajes (5:00) y de pasos del agente (5:10).
SELECT cron.schedule(
  'ssa-cron-purge-cron-runs',
  '20 5 * * *',
  $$SELECT private.purge_cron_run_details(3)$$
);
