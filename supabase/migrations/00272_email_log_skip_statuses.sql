-- ============================================================
-- 00272_email_log_skip_statuses
-- ============================================================
-- Suscripcion a emails (E2, M3). El CHECK de email_log.status suma los envios
-- que la puerta (`canSendEmailTo`, lib/email/subscription.ts) saltea, para que un
-- salto quede anotado donde ya se anotan los envios (y en el historial del
-- contacto), en vez de no dejar rastro:
--   skipped_unsubscribed   marketing a una direccion dada de baja
--   skipped_bounced        cualquier email a una direccion que rebota
--   skipped_complained     marketing a una direccion que marco spam
--   skipped_do_not_contact el contacto esta en "no contactar"
--   skipped_unverifiable   marketing que no salio porque la base no contesto
--
-- Superconjunto del CHECK anterior: ninguna fila existente deja de cumplirlo.
--
-- Definicion vieja (leida de la base el 29/10/2026):
--   CONSTRAINT email_log_status_check
--     CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped_not_configured'::text])))
--
-- Cómo volver atrás (solo si no quedo ninguna fila con los estados nuevos):
--   UPDATE public.email_log SET status = 'failed', last_error = coalesce(last_error, status)
--    WHERE status LIKE 'skipped\_%' AND status <> 'skipped_not_configured';
--   ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
--   ALTER TABLE public.email_log ADD CONSTRAINT email_log_status_check
--     CHECK (status = ANY (ARRAY['sent', 'failed', 'skipped_not_configured']));
--
-- Idempotente: se borra y se vuelve a crear con la lista completa.
-- ============================================================

ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
ALTER TABLE public.email_log ADD CONSTRAINT email_log_status_check
  CHECK (status = ANY (ARRAY[
    'sent', 'failed', 'skipped_not_configured',
    'skipped_unsubscribed', 'skipped_bounced', 'skipped_complained',
    'skipped_do_not_contact', 'skipped_unverifiable'
  ]));
