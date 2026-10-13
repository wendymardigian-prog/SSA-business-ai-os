-- ============================================================================
-- 00187 — Webhooks entrantes: sesiones de flujo sin contacto y el disparador  (M2 del Extra L)
-- ============================================================================
-- Un flujo disparado por un webhook arranca SIN contacto y SIN persona del equipo: el
-- contacto aparece a mitad de flujo, cuando el paso "Crear o actualizar contacto" lo crea o
-- lo encuentra. Dos cambios sobre estructura existente:
--
--  1. `flow_sessions.inbound_webhook_id` (FK a `inbound_webhooks`, ON DELETE SET NULL) y el
--     CHECK `flow_sessions_contact_or_member` recreado con una tercera salida:
--     contact_id IS NOT NULL OR member_user_id IS NOT NULL OR inbound_webhook_id IS NOT NULL.
--     Ninguna fila existente cambia: todas tienen contacto (o persona del equipo) y la columna
--     nueva queda null. NO se afloja nada mas: el NOT NULL de `contact_id` ya lo quito la 00182.
--  2. El CHECK de `triggers.type` suma `webhook_received` (32 tipos). La lista se leyo de la
--     base viva el 12/10/2026 (los 31 de la 00183); `lib/webhooks/migrations.test.ts` lee ESTE
--     archivo y exige los 31 + el nuevo.
--
-- Definicion VIEJA de `flow_sessions_contact_or_member` (pg_get_constraintdef, base viva):
--   CHECK (((contact_id IS NOT NULL) OR (member_user_id IS NOT NULL)))
--
-- Definicion VIEJA de `triggers_type_check` (31 tipos):
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
--     'payment_after_due'::text,
--     'eod_submitted'::text
--   ])))
--
-- Como volver atras:
--   (antes) UPDATE public.triggers SET is_active = false WHERE type = 'webhook_received';
--           DELETE FROM public.triggers WHERE type = 'webhook_received';
--           DELETE FROM public.flow_sessions WHERE contact_id IS NULL AND member_user_id IS NULL;
--   ALTER TABLE public.flow_sessions DROP CONSTRAINT IF EXISTS flow_sessions_contact_or_member;
--   ALTER TABLE public.flow_sessions ADD CONSTRAINT flow_sessions_contact_or_member
--     CHECK (contact_id IS NOT NULL OR member_user_id IS NOT NULL);
--   DROP INDEX IF EXISTS public.idx_flow_sessions_inbound_webhook;
--   ALTER TABLE public.flow_sessions DROP COLUMN IF EXISTS inbound_webhook_id;
--   ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
--   ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (type = ANY (ARRAY[<la lista vieja>]));
-- Riesgo: ALTO en estructura (toca flow_sessions y triggers), pero compatible con el codigo
-- viejo: este nunca crea sesiones sin contacto ni persona ni dispara `webhook_received`.
-- ============================================================================

SET search_path = '';

-- 1. La sesion de un flujo disparado por un webhook.
ALTER TABLE public.flow_sessions
  ADD COLUMN IF NOT EXISTS inbound_webhook_id uuid REFERENCES public.inbound_webhooks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_flow_sessions_inbound_webhook
  ON public.flow_sessions (inbound_webhook_id)
  WHERE inbound_webhook_id IS NOT NULL;

ALTER TABLE public.flow_sessions DROP CONSTRAINT IF EXISTS flow_sessions_contact_or_member;
ALTER TABLE public.flow_sessions ADD CONSTRAINT flow_sessions_contact_or_member
  CHECK (contact_id IS NOT NULL OR member_user_id IS NOT NULL OR inbound_webhook_id IS NOT NULL);

-- 2. El tipo de disparador.
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
    'eod_submitted'::text,
    'webhook_received'::text
  ]));
