-- ============================================================================
-- 00080 — Tareas en segundo plano, calidad e intención (Bloque 5, F23-F26)
-- ============================================================================
--   1. workspaces.ai_background_settings (jsonb): modo de cada tarea de IA que
--      no es conversación en vivo (clasificación, resumen, cierre, indexación).
--   2. agent_runs.intent (jsonb): la intención que declara el agente en cada
--      turno (F26). Con GRANT SELECT (no es un costo).
--   3. Cron ssa-cron-bg-dispatch y ssa-cron-bg-collect cada 15 min + whitelist.
--
-- Idempotente y aditiva.
-- ============================================================================

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS ai_background_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS intent jsonb;
GRANT SELECT (intent) ON public.agent_runs TO authenticated;
COMMENT ON COLUMN public.agent_runs.intent IS
  'Intención declarada por el agente en el turno (F26): { category_id, confidence }. null si no la declaró o el id no existe.';

CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_base text; v_secret text;
BEGIN
  IF p_path NOT IN ('jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events', 'agent-bursts', 'drafts-refresh', 'bg-dispatch', 'bg-collect') THEN
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
    timeout_milliseconds => 60000);
END; $$;
REVOKE ALL ON FUNCTION private.call_app_cron(text) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-bg-dispatch') THEN PERFORM cron.unschedule('ssa-cron-bg-dispatch'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-bg-collect') THEN PERFORM cron.unschedule('ssa-cron-bg-collect'); END IF;
  PERFORM cron.schedule('ssa-cron-bg-dispatch', '*/15 * * * *', $c$SELECT private.call_app_cron('bg-dispatch')$c$);
  PERFORM cron.schedule('ssa-cron-bg-collect', '*/15 * * * *', $c$SELECT private.call_app_cron('bg-collect')$c$);
END $$;
