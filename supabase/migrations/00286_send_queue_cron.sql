-- ============================================================
-- 00286_send_queue_cron.sql
--
-- El cron de la cola de envíos masivos (docs/broadcasts.md): /api/cron/send-queue
-- cada 15 segundos, como el del agente (00063).
--
-- Reescribe `private.call_app_cron` para sumar 'send-queue' a la lista blanca.
-- Es la definición vigente (00139) letra por letra, con esa ruta de más.
-- lib/cron-config.test.ts compara la lista con las carpetas de app/api/cron.
--
-- Va DESPUÉS de desplegar el código: antes, la ruta no existe y cada tic daría 404.
--
-- Definición anterior (00139), para volver atrás:
--   IF p_path NOT IN (
--     'jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events',
--     'agent-bursts', 'drafts-refresh', 'bg-dispatch', 'bg-collect',
--     'social-token-refresh', 'content-media-cleanup', 'metrics-sync',
--     'content-upload'
--   ) THEN ... (el resto igual)
--   y sin el cron 'send-queue' (SELECT cron.unschedule('send-queue');).
--
-- Idempotente.
-- ============================================================

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
END; $$;

REVOKE ALL ON FUNCTION private.call_app_cron(text) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-queue') THEN
    PERFORM cron.unschedule('send-queue');
  END IF;
  PERFORM cron.schedule('send-queue', '15 seconds', $cmd$SELECT private.call_app_cron('send-queue')$cmd$);
END $$;
