-- ============================================================================
-- 00282 — Grupos de WhatsApp: tres disparadores nuevos
-- ============================================================================
-- `triggers_type_check` acepta tres tipos mas (34 -> 37):
--   - whatsapp_group_joined      alguien se unio a un grupo activado
--   - whatsapp_group_reaction    alguien reacciono a un mensaje de un grupo
--   - whatsapp_group_poll_vote   alguien voto en una encuesta de un grupo
-- Los tres son de CONTACTO (el evento lleva contacto): no hace falta tocar
-- `automation_events_contact_or_member`.
--
-- La definicion vigente es la de la 00199 (la ultima migracion que la toco); se
-- la copia abajo, en «Como volver atras». Compatible con el codigo viejo: solo
-- acepta MAS valores.
--
-- Como volver atras (antes, borrar los triggers de esos tipos):
--   DELETE FROM public.triggers WHERE type IN ('whatsapp_group_joined', 'whatsapp_group_reaction', 'whatsapp_group_poll_vote');
--   ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
--   ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check
--     CHECK ((type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text, 'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text, 'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text, 'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text, 'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text, 'task_completed'::text, 'task_overdue'::text])));
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
    'eod_submitted'::text,
    'webhook_received'::text,
    'task_completed'::text,
    'task_overdue'::text,
    'whatsapp_group_joined'::text,
    'whatsapp_group_reaction'::text,
    'whatsapp_group_poll_vote'::text
  ]));
