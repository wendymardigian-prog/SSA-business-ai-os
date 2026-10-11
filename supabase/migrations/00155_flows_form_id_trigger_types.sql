-- ============================================================================
-- 00155 — Formularios: flows atados a un formulario y tres triggers nuevos
-- ============================================================================
-- Modulo Formularios, F19 y F21.
--
--   1. `flows.form_id`: el flow que se creo desde la pestaña Automatizaciones de
--      un formulario. Mismo patron que `event_type_id` (Agenda): nullable, FK con
--      `ON DELETE SET NULL` e indice parcial. Un formulario NO se borra (se
--      archiva), asi que sus flows nunca quedan huerfanos; el SET NULL es solo
--      una red de seguridad. Todos los flows que ya existen quedan con
--      `form_id = NULL` y no cambia nada para ellos.
--   2. El CHECK de `triggers.type` suma `form_submitted`, `survey_answered` y
--      `contract_signed`.
--
-- SOLO SUMA: la lista se leyo de la base viva al escribir esta migracion (21
-- tipos, incluidos `call_analyzed` y `call_linked` de Llamadas), no de memoria.
--
-- Definicion VIEJA del CHECK, para volver atras:
--   CHECK ((type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text,
--     'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text,
--     'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text,
--     'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text,
--     'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text,
--     'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text,
--     'call_linked'::text])))
--
-- Como volver atras:
--   (antes) DELETE FROM public.triggers WHERE type IN ('form_submitted', 'survey_answered', 'contract_signed');
--           y dejar en borrador los flows con `form_id`.
--   ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
--   ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (type = ANY (ARRAY[<la lista vieja>]));
--   DROP INDEX IF EXISTS public.idx_flows_form;
--   ALTER TABLE public.flows DROP COLUMN IF EXISTS form_id;
-- ============================================================================

ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS form_id uuid REFERENCES public.forms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_flows_form ON public.flows (form_id) WHERE form_id IS NOT NULL;

COMMENT ON COLUMN public.flows.form_id IS
  'El formulario desde cuya pestaña Automatizaciones se creo este flow (Formularios, 00155). Null para el resto.';

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
    'contract_signed'::text
  ]));
