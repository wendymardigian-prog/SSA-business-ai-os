-- ============================================================================
-- 00199 — Tareas (T4, F25): los disparadores `task_completed` y `task_overdue`, tambien sin contacto
-- ============================================================================
-- Dos cambios de restricciones, ninguno toca datos:
--
--   1. `triggers_type_check` acepta dos tipos mas: `task_completed` y `task_overdue` (32 -> 34). Se leyo la definicion
--      VIGENTE en la base con `pg_get_constraintdef` (la ultima migracion que la toco es la 00187) y se la copio abajo,
--      en «Como volver atras».
--   2. `automation_events_contact_or_member` (00182) acepta un evento SIN contacto tambien para `task_completed` y
--      `task_overdue`, siempre con una persona del equipo (`member_user_id`). Una tarea sin contacto emite sobre la
--      persona a cargo y el flujo corre sin contacto (como los de fin de dia); una tarea con contacto emite sobre el
--      contacto y no cambia nada.
--
-- Compatible con el codigo viejo: nunca crea esos tipos ni esos eventos. Solo acepta MAS valores: lo que ya estaba
-- guardado sigue valiendo (`verify-tasks.mjs` prueba que `sale_created` y `eod_submitted` se siguen aceptando).
--
-- Como volver atras (ANTES de revertir hay que borrar los triggers de tipo task_* y los eventos task_* sin contacto):
--   DELETE FROM public.triggers WHERE type IN ('task_completed', 'task_overdue');
--   DELETE FROM public.automation_events WHERE event_type IN ('task_completed', 'task_overdue') AND contact_id IS NULL;
--   ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
--   ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check
--     CHECK ((type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text, 'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text, 'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text, 'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text, 'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text])));
--   ALTER TABLE public.automation_events DROP CONSTRAINT IF EXISTS automation_events_contact_or_member;
--   ALTER TABLE public.automation_events ADD CONSTRAINT automation_events_contact_or_member
--     CHECK (((contact_id IS NOT NULL) OR ((event_type = ANY (ARRAY['eod_submitted'::text])) AND (member_user_id IS NOT NULL))));
-- Riesgo: medio (reescribe dos restricciones existentes), con la definicion vieja guardada arriba.
-- ============================================================================

SET search_path = '';

-- 1. El tipo de disparador.
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
    'task_overdue'::text
  ]));

-- 2. Un evento sin contacto: de fin de dia o de tareas, siempre con una persona del equipo.
ALTER TABLE public.automation_events DROP CONSTRAINT IF EXISTS automation_events_contact_or_member;
ALTER TABLE public.automation_events ADD CONSTRAINT automation_events_contact_or_member
  CHECK (
    contact_id IS NOT NULL
    OR (event_type = ANY (ARRAY['eod_submitted'::text, 'task_completed'::text, 'task_overdue'::text]) AND member_user_id IS NOT NULL)
  );

COMMENT ON COLUMN public.automation_events.member_user_id IS
  'La persona del equipo de un evento sin contacto (eod_submitted, task_completed, task_overdue). Los demas eventos llevan contacto.';
