-- ============================================================================
-- 00077 — Verificación antes de responder y reglas de respuesta (Bloque 2)
-- ============================================================================
-- Fase 3, Bloque 2 (F5–F12).
--
--   1. Columnas de reglas en `agents`: response_rules (lista jsonb),
--      response_rules_default (send/draft/skip), external_reply_cooldown_minutes
--      (0–120). Con su GRANT SELECT a authenticated (regla de la 00060).
--   2. agent_runs.routing jsonb: qué decidió el turno (modo, regla, chequeo,
--      salud del refresco). Con GRANT SELECT (no es un costo).
--   3. RPC claim_agent_reply: bajo pg_advisory_xact_lock por conversación,
--      mira si ya hubo un saliente después del inbound del turno que no es el
--      propio. Es el "momento 2": el chequeo antes de enviar/guardar.
--      Elección de atomicidad (F5): la app no puede sostener una transacción a
--      través de la llamada a Zernio, así que el lock serializa turno-vs-turno
--      del agente (que además ya es imposible por el índice único de un job
--      pendiente por conversación). El caso "una PERSONA responde entre el
--      chequeo y el envío" queda cubierto por el paso 8 del runner (respuesta
--      humana) y, en modo borrador, por el descarte del momento 3. No se
--      reserva una fila `pending` en messages a propósito: contaminaría la
--      bandeja, los conteos y la ráfaga.
--   4. Trigger messages_discard_answered_drafts (momento 3): cuando entra un
--      saliente, descarta el borrador pendiente/fallido de esa conversación si
--      es posterior a su ráfaga y no salió de su propio run. auto:manual_reply
--      si el saliente es de una persona, auto:answered_elsewhere si no.
--   5. Cron ssa-cron-drafts-refresh cada 5 min (refresca contra Zernio las
--      conversaciones con borrador pendiente) + whitelist de call_app_cron.
--
-- Idempotente. Aditiva.
-- ============================================================================

-- 1. Columnas de reglas ---------------------------------------------------
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS response_rules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS response_rules_default text NOT NULL DEFAULT 'draft';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS external_reply_cooldown_minutes integer NOT NULL DEFAULT 10;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_response_rules_default_values') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_response_rules_default_values
      CHECK (response_rules_default IN ('send', 'draft', 'skip'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_external_cooldown_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_external_cooldown_range
      CHECK (external_reply_cooldown_minutes BETWEEN 0 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_response_rules_is_array') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_response_rules_is_array
      CHECK (jsonb_typeof(response_rules) = 'array');
  END IF;
END $$;

GRANT SELECT (response_rules, response_rules_default, external_reply_cooldown_minutes)
  ON public.agents TO authenticated;

-- 2. agent_runs.routing ---------------------------------------------------
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS routing jsonb;
GRANT SELECT (routing) ON public.agent_runs TO authenticated;

COMMENT ON COLUMN public.agent_runs.routing IS
  'Qué decidió el turno (F9/F12): mode, rule_id, rule_index, action, matched, check, moment, refresh. Se lee en Runs y en la cola; la pantalla arma una oración, nunca muestra rule:<id>.';

-- 3. RPC claim_agent_reply (momento 2) -----------------------------------
CREATE OR REPLACE FUNCTION public.claim_agent_reply(
  p_conversation_id uuid,
  p_inbound_at timestamptz,
  p_run_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_answered boolean;
BEGIN
  -- Serializa contra otro turno del agente sobre la misma conversación. Se
  -- libera al terminar la transacción (commit o rollback): un turno que muere
  -- nunca deja el lock tomado.
  PERFORM pg_advisory_xact_lock(hashtext(p_conversation_id::text));

  SELECT EXISTS (
    SELECT 1 FROM public.messages
    WHERE conversation_id = p_conversation_id
      AND direction = 'outbound'
      AND created_at > p_inbound_at
      AND status <> 'failed'
      AND (p_run_id IS NULL OR agent_run_id IS DISTINCT FROM p_run_id)
  ) INTO v_answered;

  RETURN v_answered;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_reply(uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_agent_reply(uuid, timestamptz, uuid) TO service_role;

COMMENT ON FUNCTION public.claim_agent_reply(uuid, timestamptz, uuid) IS
  'Momento 2 (F5): bajo advisory lock por conversación, true si ya hay un saliente posterior al inbound del turno que no es el propio run. Ver la elección de atomicidad en la cabecera de 00077.';

-- 4. Trigger momento 3: un saliente descarta el borrador pendiente --------
CREATE OR REPLACE FUNCTION public.messages_discard_answered_drafts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.direction <> 'outbound' OR NEW.status = 'failed' THEN
    RETURN NEW;
  END IF;

  UPDATE public.agent_drafts d
  SET status = 'discarded',
      discard_reason = CASE WHEN NEW.origin = 'user' THEN 'auto:manual_reply' ELSE 'auto:answered_elsewhere' END,
      decided_at = now()
  WHERE d.conversation_id = NEW.conversation_id
    AND d.status IN ('pending', 'failed')
    -- Solo si el saliente es posterior a la ráfaga del borrador y no salió del
    -- propio run del borrador (aprobar un borrador no se descarta a sí mismo).
    AND (d.burst_last_inbound_at IS NULL OR d.burst_last_inbound_at < NEW.created_at)
    AND (NEW.agent_run_id IS NULL OR d.run_id IS DISTINCT FROM NEW.agent_run_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_discard_answered_drafts ON public.messages;
CREATE TRIGGER messages_discard_answered_drafts
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_discard_answered_drafts();

-- 5. Cron drafts-refresh + whitelist -------------------------------------
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
  IF p_path NOT IN ('jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events', 'agent-bursts', 'drafts-refresh') THEN
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-drafts-refresh') THEN
    PERFORM cron.unschedule('ssa-cron-drafts-refresh');
  END IF;
  PERFORM cron.schedule('ssa-cron-drafts-refresh', '*/5 * * * *', $cron$SELECT private.call_app_cron('drafts-refresh')$cron$);
END $$;
