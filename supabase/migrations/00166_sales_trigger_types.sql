-- ============================================================================
-- 00166 — Ventas (B4, F37): seis tipos de trigger nuevos en `triggers.type`
-- ============================================================================
-- Suma `sale_created`, `sale_status_changed`, `payment_created`, `payment_status_changed`,
-- `payment_before_due` y `payment_after_due` al CHECK de `triggers.type`. SOLO SUMA: la lista
-- vieja (24 tipos, con los de Llamadas y Formularios) se leyo de la base viva al escribir esta
-- migracion, no de memoria; `lib/sales/automation/triggers-check.test.ts` lee ESTE archivo y exige
-- los 24 + los 6.
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
--     'contract_signed'::text
--   ])))
--
-- Como volver atras:
--   (antes) DELETE FROM public.triggers WHERE type IN ('sale_created', 'sale_status_changed',
--     'payment_created', 'payment_status_changed', 'payment_before_due', 'payment_after_due');
--   ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
--   ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (type = ANY (ARRAY[<la lista vieja>]));
-- ============================================================================

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
    'payment_after_due'::text
  ]));
