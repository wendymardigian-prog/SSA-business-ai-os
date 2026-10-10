-- ============================================================
-- MIGRACION 00139 — EL SECRETO DE LOS CRON PASA A VAULT
-- ============================================================
-- Las tareas programadas corren con pg_cron dentro de la base y le pegan a la
-- app por HTTP (`private.call_app_cron`). Para eso la base necesita dos datos:
-- la URL publica de la app y el CRON_SECRET (el mismo valor que en Railway).
--
-- Desde la 00036 vivian en filas comunes de `private.system_config`, en texto
-- plano, y se cargaban tipeando filas a mano. Todos los demas secretos del
-- sistema ya estaban cifrados en Vault (00017). Esta migracion los muda:
--
--   1. `private.set_system_secret(nombre, valor)`: la unica puerta para cargar
--      o cambiar `app_url` y `cron_secret`. Una linea en el SQL Editor:
--        select private.set_system_secret('cron_secret', '...');
--        select private.set_system_secret('app_url', 'https://...');
--      Sirve igual para la primera vez y para cambiarlos despues.
--   2. `private.system_secrets_status()`: chequeo de solo lectura que NUNCA
--      devuelve el secreto. Dice si estan cargados y cuantas llamadas de cron
--      dieron 200 / 401 en los ultimos 15 minutos (un 401 = el valor de Vault
--      no coincide con el CRON_SECRET de Railway).
--   3. Copia a Vault lo que ya hubiera en `private.system_config`, si Vault
--      todavia no lo tiene. Idempotente; en un clon nuevo no copia nada.
--   4. `private.call_app_cron` pasa a leer de Vault. La lista blanca de rutas
--      y la llamada HTTP quedan exactamente como en la 00092.
--
-- Nombres en Vault: `system:app_url` y `system:cron_secret`. No chocan con los
-- de workspace (`ws:<id>:<nombre>`), y `list_secret_names` nunca los muestra.
--
-- Aditiva: NO borra las filas viejas de `private.system_config`. Eso lo hace la
-- 00140, recien despues de comprobar en produccion que los cron siguen dando
-- 200. La fila `draft_alerts_since` (00072) no es un secreto y se queda donde
-- esta.
--
-- PARA VOLVER ATRAS: restaurar la definicion de la 00092 (las filas viejas
-- siguen en `system_config` mientras no se aplique la 00140):
--
--   CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
--   RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
--   AS $$
--   DECLARE v_base text; v_secret text;
--   BEGIN
--     IF p_path NOT IN (
--       'jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events',
--       'agent-bursts', 'drafts-refresh', 'bg-dispatch', 'bg-collect',
--       'social-token-refresh', 'content-media-cleanup', 'metrics-sync',
--       'content-upload'
--     ) THEN
--       RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
--     END IF;
--     SELECT value INTO v_base FROM private.system_config WHERE key = 'app_url';
--     SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';
--     IF v_base IS NULL OR v_secret IS NULL THEN
--       RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
--       RETURN NULL;
--     END IF;
--     RETURN net.http_get(
--       url => rtrim(v_base, '/') || '/api/cron/' || p_path,
--       headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
--       timeout_milliseconds => 60000
--     );
--   END; $$;
-- ============================================================

-- ------------------------------------------------------------
-- 1. Cargar o cambiar un secreto del sistema
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.set_system_secret(p_name text, p_value text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_value text := btrim(coalesce(p_value, ''));
  v_key   text;
  v_host  text;
  v_id    uuid;
BEGIN
  IF p_name IS NULL OR p_name NOT IN ('app_url', 'cron_secret') THEN
    RAISE EXCEPTION 'nombre invalido: solo se aceptan ''app_url'' o ''cron_secret''';
  END IF;

  IF v_value = '' THEN
    RAISE EXCEPTION 'el valor de % no puede quedar vacio', p_name;
  END IF;

  -- La URL tiene que ser la publica de produccion. Una local no falla: los
  -- cron simplemente le pegarian a la nada (misma regla que isLocalUrl en
  -- lib/webhook-url.ts).
  IF p_name = 'app_url' THEN
    IF v_value !~* '^https://' THEN
      RAISE EXCEPTION 'app_url tiene que empezar con https:// (es la direccion publica de la app, por ejemplo la de Railway)';
    END IF;
    v_value := rtrim(v_value, '/');
    v_host := lower(split_part(split_part(substring(v_value from 9), '/', 1), ':', 1));
    IF v_host = '' OR v_host IN ('localhost', '127.0.0.1', '0.0.0.0', '[')
       OR v_host LIKE '%.localhost' OR v_host LIKE '%.local' THEN
      RAISE EXCEPTION 'app_url no puede ser una direccion local: tiene que ser la publica de produccion';
    END IF;
  END IF;

  v_key := 'system:' || p_name;

  SELECT s.id INTO v_id FROM vault.secrets s WHERE s.name = v_key;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(v_value, v_key, 'secreto del sistema (lo lee pg_cron)');
  ELSE
    PERFORM vault.update_secret(v_id, v_value, v_key, 'secreto del sistema (lo lee pg_cron)');
  END IF;

  RETURN 'listo: ' || p_name || ' guardado en Vault';
END;
$$;

REVOKE ALL ON FUNCTION private.set_system_secret(text, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.set_system_secret(text, text) IS
  'Carga o cambia app_url / cron_secret en Vault (system:*). Lo lee private.call_app_cron. El cron_secret tiene que ser igual al CRON_SECRET de Railway.';

-- ------------------------------------------------------------
-- 2. Chequeo sin revelar el secreto
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.system_secrets_status()
RETURNS TABLE (
  app_url          text,
  cron_secret_set  boolean,
  calls_ok_15m     bigint,
  calls_401_15m    bigint,
  calls_other_15m  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'system:app_url'),
    EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'system:cron_secret'),
    (SELECT count(*) FROM net._http_response r
      WHERE r.created > now() - interval '15 minutes' AND r.status_code BETWEEN 200 AND 299),
    (SELECT count(*) FROM net._http_response r
      WHERE r.created > now() - interval '15 minutes' AND r.status_code = 401),
    (SELECT count(*) FROM net._http_response r
      WHERE r.created > now() - interval '15 minutes'
        AND (r.status_code IS NULL OR (r.status_code NOT BETWEEN 200 AND 299 AND r.status_code <> 401)));
$$;

REVOKE ALL ON FUNCTION private.system_secrets_status() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.system_secrets_status() IS
  'Si app_url y cron_secret estan en Vault, y como respondio la app a los cron en los ultimos 15 minutos. Nunca devuelve el cron_secret.';

-- ------------------------------------------------------------
-- 3. Copiar a Vault lo que ya estaba en system_config
-- ------------------------------------------------------------
-- Copia exacta (sin normalizar), asi la 00140 puede comprobar que Vault tiene
-- el mismo valor antes de borrar la fila vieja.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.key, c.value
    FROM private.system_config c
    WHERE c.key IN ('app_url', 'cron_secret')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'system:' || r.key) THEN
      PERFORM vault.create_secret(r.value, 'system:' || r.key, 'secreto del sistema (lo lee pg_cron)');
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4. call_app_cron lee de Vault
-- ------------------------------------------------------------
-- Lista blanca y llamada HTTP identicas a la 00092. La lista se reescribe
-- entera en cada cron nuevo (patron desde la 00036): copiar ESTA version, no
-- una anterior (lib/cron-config.test.ts lo controla).
CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
END; $$;
