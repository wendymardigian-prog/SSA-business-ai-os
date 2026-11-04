-- ============================================================================
-- 00288 — Broadcasts: primero los contactos con actividad mas reciente (automatizaciones de email, Fase 1a, A6)
-- ============================================================================
-- Con un tope diario de marketing, el orden importa: si el dia alcanza para 100, que sean los 100 mas activos (los que
-- mas probablemente abren, y los que menos rebotan). `sort_key` es la actividad del contacto al poner el broadcast en
-- cola (`contact_last_activity`, 00287) y `claim_broadcast_recipient` la usa despues de los reintentos.
--
-- Orden: ANTES de desplegar el codigo (la cola escribe `sort_key` al poner en cola).
--
-- Como volver atras:
--   ALTER TABLE public.broadcast_recipients DROP COLUMN IF EXISTS sort_key;
--   y `claim_broadcast_recipient` como estaba (la 00285):
--
--   CREATE OR REPLACE FUNCTION public.claim_broadcast_recipient(p_broadcast_id uuid)
--   RETURNS SETOF public.broadcast_recipients
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $$
--   BEGIN
--     RETURN QUERY
--     UPDATE public.broadcast_recipients r
--     SET status = 'sending', claimed_at = now()
--     WHERE r.id = (
--       SELECT x.id FROM public.broadcast_recipients x
--       WHERE x.broadcast_id = p_broadcast_id
--         AND x.status = 'pending'
--         AND (x.next_attempt_at IS NULL OR x.next_attempt_at <= now())
--       ORDER BY x.next_attempt_at NULLS FIRST, x.id
--       LIMIT 1
--       FOR UPDATE SKIP LOCKED
--     )
--     RETURNING r.*;
--   END;
--   $$;
--
-- Riesgo: bajo. Una columna nullable y la misma funcion con un criterio de orden mas (los que no tienen `sort_key`, al
-- final, como antes por id).
-- ============================================================================

SET search_path = '';

ALTER TABLE public.broadcast_recipients ADD COLUMN IF NOT EXISTS sort_key timestamptz;

COMMENT ON COLUMN public.broadcast_recipients.sort_key IS
  'La actividad mas reciente del contacto al poner el broadcast en cola (00288). Sale primero el mas activo.';

CREATE OR REPLACE FUNCTION public.claim_broadcast_recipient(p_broadcast_id uuid)
RETURNS SETOF public.broadcast_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.broadcast_recipients r
  SET status = 'sending', claimed_at = now()
  WHERE r.id = (
    SELECT x.id FROM public.broadcast_recipients x
    WHERE x.broadcast_id = p_broadcast_id
      AND x.status = 'pending'
      AND (x.next_attempt_at IS NULL OR x.next_attempt_at <= now())
    ORDER BY x.next_attempt_at NULLS FIRST, x.sort_key DESC NULLS LAST, x.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING r.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_broadcast_recipient(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_recipient(uuid) TO service_role;
