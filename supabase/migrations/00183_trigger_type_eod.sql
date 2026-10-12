-- ============================================================================
-- 00183 — Reporte de fin de dia (E16): el tipo de trigger `eod_submitted`
-- ============================================================================
-- Suma `eod_submitted` al CHECK de `triggers.type`. SOLO SUMA: la lista vieja (30 tipos, la
-- de la 00166) se leyo de la base viva al escribir esta migracion (12/10/2026);
-- `lib/eod/migrations.test.ts` lee ESTE archivo y exige los 30 + el nuevo.
--
-- Definicion VIEJA del CHECK, para volver atras:
--   CHECK ((type = ANY (ARRAY[
--     'keyword'::text,
--     'postback'::text,
--     'quick_reply'::text,
--     'welcome'::text,
--     'default'::text,
--     'comment_keyword'::text,
--     'new_contact'::text,
--     'crm_event'::text,
--     'inactivity'::text,
--     'email_received'::text,
--     'booking_created'::text,
--     'booking_rescheduled'::text,
--     'booking_cancelled'::text,
--     'booking_updated'::text,
--     'booking_ended'::text,
--     'booking_status_changed'::text,
--     'booking_before_start'::text,
--     'booking_after_end'::text,
--     'booking_after_created'::text,
--     'call_analyzed'::text,
--     'call_linked'::text,
--     'form_submitted'::text,
--     'survey_answered'::text,
--     'contract_signed'::text,
--     'sale_created'::text,
--     'sale_status_changed'::text,
--     'payment_created'::text,
--     'payment_status_changed'::text,
--     'payment_before_due'::text,
--     'payment_after_due'::text
--   ])))
--
-- Como volver atras:
--   (antes) DELETE FROM public.triggers WHERE type = 'eod_submitted';
--   ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
--   ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (type = ANY (ARRAY[<la lista vieja>]));
-- Riesgo: bajo (aditiva).
-- ============================================================================

SET search_path = '';

ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check
  CHECK (type = ANY (ARRAY[
    'keyword'::text,
    'postback'::text,
    'quick_reply'::text,
    'welcome'::text,
    'default'::text,
    'comment_keyword'::text,
    'new_contact'::text,
    'crm_event'::text,
    'inactivity'::text,
    'email_received'::text,
    'booking_created'::text,
    'booking_rescheduled'::text,
    'booking_cancelled'::text,
    'booking_updated'::text,
    'booking_ended'::text,
    'booking_status_changed'::text,
    'booking_before_start'::text,
    'booking_after_end'::text,
    'booking_after_created'::text,
    'call_analyzed'::text,
    'call_linked'::text,
    'form_submitted'::text,
    'survey_answered'::text,
    'contract_signed'::text,
    'sale_created'::text,
    'sale_status_changed'::text,
    'payment_created'::text,
    'payment_status_changed'::text,
    'payment_before_due'::text,
    'payment_after_due'::text,
    'eod_submitted'::text
  ]));
