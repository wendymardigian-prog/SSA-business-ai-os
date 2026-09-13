-- ============================================================================
-- 00061 — Jobs reprogramables: la ventana de silencio del agente
-- ============================================================================
-- Fase 3, Bloque 2a. El agente no responde al instante: espera una ventana de
-- silencio desde el ULTIMO mensaje del lead, y cada mensaje nuevo la reinicia.
-- Un temporizador en memoria (setTimeout) se pierde con cada reinicio del
-- proceso, asi que la ventana es una fila en scheduled_jobs que cada mensaje
-- empuja hacia adelante.
--
-- ---------------------------------------------------------------------------
-- dedupe_key + indice unico parcial SOLO sobre 'pending'
-- ---------------------------------------------------------------------------
-- La clave es "agent_burst:<conversation_id>". El indice unico cubre solo las
-- filas pending, y esa restriccion es la que hace todo el mecanismo:
--
--   - Mientras la rafaga esta abierta hay UNA fila pending por conversacion.
--     Dos webhooks a la vez no pueden crear dos: la exclusion la hace el motor,
--     no un "fijate si existe y si no inserto" que se pisa solo.
--
--   - Cuando el runner reclama el job (pending -> processing) la fila SALE del
--     indice. Un mensaje que llega mientras el agente esta generando puede
--     insertar una fila pending nueva con la misma clave: abre una ventana
--     nueva sin pisar el turno en curso. Si el indice cubriera processing, ese
--     mensaje tardio no tendria donde anotarse.
--
-- ---------------------------------------------------------------------------
-- push_debounced_job
-- ---------------------------------------------------------------------------
-- Atomica: INSERT ... ON CONFLICT DO UPDATE.
--
--   - El tope de espera (burst_deadline) se congela en el PRIMER mensaje de la
--     rafaga y las reprogramaciones lo leen del payload: es imposible empujar la
--     rafaga mas alla del techo aunque el lead escriba cuarenta veces.
--   - Sin tope (p_deadline NULL): LEAST(x, NULL) devuelve x en Postgres, asi que
--     el mecanismo funciona igual sin ramas. Hay test de este borde.
--   - GREATEST con el run_at existente: un webhook viejo que llega tarde (fuera
--     de orden) nunca adelanta la ventana.
--   - Si el UPDATE no afecta filas es porque la fila en conflicto paso a
--     processing entre el conflicto y el update: se reintenta el INSERT, que
--     ahora ya no choca.
--
-- El payload NO lleva textos de mensajes: el job los lee de messages al
-- ejecutarse. Eso resuelve solo la carrera del mensaje que llega entre el
-- agendado y la ejecucion, y mantiene la cola sin datos del lead.
--
-- Solo service role, como el resto de la cola (00046).
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.scheduled_jobs
  ADD COLUMN IF NOT EXISTS dedupe_key text;

COMMENT ON COLUMN public.scheduled_jobs.dedupe_key IS
  'Clave de un job reprogramable. Unica solo entre los pending: un job en processing sale del indice y deja lugar a una ventana nueva.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_jobs_dedupe_pending
  ON public.scheduled_jobs(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status = 'pending';

-- La ruta de cron del agente pide solo sus jobs.
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_type_pending
  ON public.scheduled_jobs(type, run_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.push_debounced_job(
  p_type       text,
  p_dedupe_key text,
  p_payload    jsonb,
  p_run_at     timestamptz,
  p_deadline   timestamptz
)
RETURNS TABLE (job_id uuid, job_run_at timestamptz, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt integer := 0;
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
      payload = j.payload || jsonb_build_object(
        'last_message_at', COALESCE(p_payload->'last_message_at', to_jsonb(now()))
      )
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
$$;

COMMENT ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) IS
  'Agenda o empuja hacia adelante un job reprogramable (ventana de silencio del agente). Atomica. El tope se congela en el primer mensaje de la rafaga. Solo service role.';

REVOKE ALL ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) TO service_role;
