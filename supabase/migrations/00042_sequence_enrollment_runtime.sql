-- ============================================================================
-- 00042 — Secuencias: estado de corrida y claim atomico del procesador
-- ============================================================================
-- Que hace:
--   1. Columnas de corrida en sequence_enrollments: por que se pauso, cuantos
--      intentos lleva el paso actual, cual fue el ultimo error, y desde cuando
--      esta reclamada por una corrida del cron.
--   2. claim_sequence_enrollments(): reclama las inscripciones vencidas de
--      forma atomica.
--
-- Por que el claim: el procesador hacia "select ... limit 50" sin reclamar
-- nada. En cuanto cada paso implica un POST a Instagram, una corrida dura mas
-- que el intervalo del cron (un minuto) y dos ticks leen las mismas filas: el
-- mismo DM sale dos veces. Es el mismo problema que webhook_events resolvio
-- del lado de entrada, ahora del lado de salida.
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

COMMENT ON COLUMN public.sequence_enrollments.paused_reason IS
  'contact_replied = el lead contesto (F11) | opt_out = pidio no ser contactado | sequence_paused = se pauso la secuencia | no_conversation = no hay hilo abierto por donde escribir | collision = un admin la freno por colision (F13). Solo las tres primeras y collision se reanudan.';

COMMENT ON COLUMN public.sequence_enrollments.attempt_count IS
  'Intentos del paso actual. Se limpia al avanzar. Ver MAX_STEP_ATTEMPTS en lib/sequences/steps.ts.';

COMMENT ON COLUMN public.sequence_enrollments.locked_at IS
  'La reclamo una corrida del cron. Se limpia al terminar el paso; una corrida caida la libera sola pasado p_stale_after.';

-- ----------------------------------------------------------------------------
-- claim_sequence_enrollments
-- ----------------------------------------------------------------------------
-- FOR UPDATE SKIP LOCKED hace que dos corridas simultaneas se repartan las
-- filas en vez de pelearlas. La ventana de 5 minutos recupera lo que quedo
-- trabado por una corrida que se cayo antes de soltar el lock (mismo criterio
-- que /api/cron/jobs con las invocaciones muertas).

CREATE OR REPLACE FUNCTION public.claim_sequence_enrollments(
  p_limit integer DEFAULT 25,
  p_stale_after interval DEFAULT '5 minutes'
)
RETURNS SETOF public.sequence_enrollments
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH due AS (
    SELECT e.id
    FROM public.sequence_enrollments e
    WHERE e.status = 'active'
      AND e.next_step_at IS NOT NULL
      AND e.next_step_at <= now()
      AND (e.locked_at IS NULL OR e.locked_at < now() - p_stale_after)
    ORDER BY e.next_step_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sequence_enrollments e
  SET locked_at = now()
  FROM due
  WHERE e.id = due.id
  RETURNING e.*;
$$;

REVOKE ALL ON FUNCTION public.claim_sequence_enrollments(integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sequence_enrollments(integer, interval) TO service_role;

COMMENT ON FUNCTION public.claim_sequence_enrollments(integer, interval) IS
  'Reclama inscripciones vencidas para una corrida del cron. Solo service_role: la ejecuta el procesador, nunca la UI.';
