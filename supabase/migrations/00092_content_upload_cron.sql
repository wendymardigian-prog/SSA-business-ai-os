-- 00092 · La ruta de las subidas largas (A17)
--
-- Subir un video a YouTube por trozos puede tardar minutos. Corriendo dentro
-- del cron general, esos minutos se los come la cola entera: los jobs que
-- venian detras esperan. Y esa ruta no declara limite de tiempo, asi que la
-- corrida se puede cortar a la mitad de la subida.
--
-- `/api/cron/content-upload` corre de a una subida, con cinco minutos de
-- margen, cada dos minutos.
--
-- La lista blanca de `call_app_cron` se redefine entera (es el patron desde
-- la 00036): la funcion no acumula rutas, se reescribe con la lista vigente.
--
-- Aditiva. No borra ni modifica datos.

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
  SELECT value INTO v_base FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';
  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;
  RETURN net.http_get(
    url => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds => 60000
  );
END; $$;

-- Cada dos minutos: una publicacion programada no puede esperar mucho mas
-- que eso, y con una subida por corrida no se pisan entre si.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('ssa-cron-content-upload')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-content-upload');

    PERFORM cron.schedule(
      'ssa-cron-content-upload',
      '*/2 * * * *',
      $cron$SELECT private.call_app_cron('content-upload');$cron$
    );
  END IF;
END $$;
