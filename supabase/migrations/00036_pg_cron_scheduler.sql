-- ============================================================
-- MIGRACION 00036 — LOS CRONS PASAN A CORRER EN LA BASE (pg_cron + pg_net)
-- ============================================================
-- Hasta ahora los cuatro crons del sistema estaban declarados en vercel.json,
-- que Vercel lee y Railway no. La app esta en Railway. O sea: los crons no los
-- corria nadie.
--
-- Eso no es un detalle de configuracion pendiente, es funcionalidad apagada:
--
--   - /api/cron/jobs es quien despierta las sesiones de flow dormidas. Sin el,
--     un nodo Delay para el flow para siempre.
--   - /api/cron/sequences es quien avanza los pasos de las secuencias.
--   - purge_soft_deleted es quien cierra la ventana de retencion de 30 dias.
--
-- La Fase 2 suma ademas el trigger de inactividad, que es puro cron. Asi que
-- antes de construir nada arriba, hay que dejar los crons corriendo.
--
-- Se hace con pg_cron dentro de la misma base, en vez de un servicio externo,
-- por tres razones: no depende de otra cuenta ni de otro proveedor que se
-- pueda vencer sin avisar, el secreto nunca sale de la base, y la purga —que
-- es puro SQL— se llama directo sin dar la vuelta por HTTP.
--
-- Lo que crea:
--   1. Las extensiones pg_cron (agenda) y pg_net (llamadas HTTP desde SQL).
--   2. El schema `private` y la tabla `private.system_config`, donde viven la
--      URL de la app y el CRON_SECRET. Los valores NO van en esta migracion.
--   3. private.call_app_cron(path), que le pega a /api/cron/<path> con el
--      secreto en el header. Solo acepta rutas de una lista blanca.
--   4. private.purge_pg_net_responses(), porque pg_net guarda cada respuesta
--      HTTP en una tabla interna que si nadie limpia crece sin techo.
--   5. Los jobs agendados.
--
-- DESPUES DE APLICAR ESTA MIGRACION hay que cargar los dos valores de config,
-- o los crons que salen por HTTP no van a hacer nada (y lo van a decir claro
-- en el log, no en silencio). El INSERT esta documentado abajo de todo.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Extensiones
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ------------------------------------------------------------
-- 2. Configuracion del sistema
-- ------------------------------------------------------------
-- Va en el schema `private` y no en `public` a proposito: PostgREST solo
-- publica los schemas que tiene configurados (public, graphql_public), asi que
-- nada de lo que viva aca es alcanzable por la API, ni con la anon key ni con
-- un JWT de usuario. La RLS y los REVOKE de abajo son la segunda linea: si
-- alguien expone el schema por error, igual no se lee.
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.system_config (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE private.system_config IS
  'Config del sistema que necesita la base para llamarse a si misma por HTTP (pg_cron). No es config por workspace: eso vive en integration_configs y en Vault.';

ALTER TABLE private.system_config ENABLE ROW LEVEL SECURITY;
-- Sin policies a proposito: con RLS activa y ninguna policy, nadie lee ni
-- escribe. service_role y postgres saltean RLS, que son los unicos que la
-- necesitan.

REVOKE ALL ON TABLE private.system_config FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. La llamada a los endpoints de cron de la app
-- ------------------------------------------------------------
-- El secreto viaja en el header Authorization y no en la query string. Las dos
-- formas las acepta el codigo de las rutas, pero una query string queda escrita
-- en los logs del proxy de Railway y en la tabla de pg_net; un header, no.
--
-- La lista blanca de rutas no es paranoia de mas: sin ella, cualquiera que
-- consiguiera ejecutar esta funcion podria usar la base como trampolin para
-- pegarle a cualquier URL de la app con el secreto de cron adjunto.
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
  IF p_path NOT IN ('jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events') THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;

  SELECT value INTO v_base   FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';

  -- Falta la config: se avisa y se corta. Un cron que falla en silencio es
  -- peor que uno que no corre, porque nadie se entera hasta que un lead se
  -- queda sin seguimiento.
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

COMMENT ON FUNCTION private.call_app_cron(text) IS
  'Llama a /api/cron/<path> de la app con el CRON_SECRET en el header. Solo rutas de la lista blanca. La usan los jobs de pg_cron.';

-- ------------------------------------------------------------
-- 4. Limpieza de la tabla interna de pg_net
-- ------------------------------------------------------------
-- pg_net guarda el resultado de cada llamada HTTP en net._http_response. Con
-- dos jobs por minuto son unas 2.900 filas por dia que nadie vuelve a mirar.
-- Se conservan 3 dias: alcanza para diagnosticar un cron que fallo el fin de
-- semana, y no mas.
--
-- El DELETE va por EXECUTE porque el nombre de esa tabla es interno de pg_net
-- y podria cambiar entre versiones: asi la funcion avisa en vez de reventar el
-- job de cron entero.
CREATE OR REPLACE FUNCTION private.purge_pg_net_responses(p_retention_days integer DEFAULT 3)
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
$$;

REVOKE ALL ON FUNCTION private.purge_pg_net_responses(integer) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.purge_pg_net_responses(integer) IS
  'Borra las respuestas HTTP viejas que guarda pg_net. Sin esto net._http_response crece sin techo.';

-- ------------------------------------------------------------
-- 5. Los jobs
-- ------------------------------------------------------------
-- cron.schedule con nombre hace upsert (pg_cron 1.4+), asi que volver a correr
-- esta migracion reagenda en vez de duplicar. El unschedule previo es por si
-- la base quedo con una version anterior que no hacia upsert.
DO $$
DECLARE
  v_job text;
BEGIN
  FOREACH v_job IN ARRAY ARRAY[
    'ssa-cron-jobs',
    'ssa-cron-sequences',
    'ssa-cron-whatsapp-health',
    'ssa-cron-purge-deleted',
    'ssa-cron-purge-pg-net'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job) THEN
      PERFORM cron.unschedule(v_job);
    END IF;
  END LOOP;
END;
$$;

-- Despierta las sesiones de flow dormidas (nodos Delay) y manda los broadcasts.
SELECT cron.schedule(
  'ssa-cron-jobs',
  '* * * * *',
  $$SELECT private.call_app_cron('jobs')$$
);

-- Avanza los pasos de las secuencias.
SELECT cron.schedule(
  'ssa-cron-sequences',
  '* * * * *',
  $$SELECT private.call_app_cron('sequences')$$
);

-- Estado de conexion de WhatsApp. Hoy sale por la puerta de atras sin hacer
-- nada, porque no hay ningun canal de Evolution: queda agendado para que el
-- dia que se conecte el numero no haya que acordarse de esto.
SELECT cron.schedule(
  'ssa-cron-whatsapp-health',
  '*/5 * * * *',
  $$SELECT private.call_app_cron('whatsapp-health')$$
);

-- La purga es puro SQL: se llama directo, sin dar la vuelta por HTTP. La ruta
-- /api/cron/purge-deleted se conserva para poder correrla a mano.
SELECT cron.schedule(
  'ssa-cron-purge-deleted',
  '0 4 * * *',
  $$SELECT public.purge_soft_deleted(30)$$
);

SELECT cron.schedule(
  'ssa-cron-purge-pg-net',
  '10 4 * * *',
  $$SELECT private.purge_pg_net_responses(3)$$
);

-- ============================================================
-- PASO MANUAL DESPUES DE APLICAR
-- ============================================================
-- Cargar los dos valores, con los mismos que ya tiene la app en Railway:
--
--   INSERT INTO private.system_config (key, value, description) VALUES
--     ('app_url',     'https://<dominio-publico-de-la-app>', 'Base de las llamadas de cron'),
--     ('cron_secret', '<el CRON_SECRET de Railway>',         'Debe coincidir con la env var CRON_SECRET')
--   ON CONFLICT (key) DO UPDATE
--     SET value = EXCLUDED.value, updated_at = now();
--
-- Para verificar que quedaron corriendo:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'ssa-%';
--   SELECT jobname, status, start_time, return_message
--     FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--   SELECT status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;
-- ============================================================
