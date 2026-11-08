-- ============================================================================
-- 00339 — «En una fecha y hora»: un disparador nuevo (`scheduled_time`)
-- ============================================================================
-- `triggers_type_check` acepta un tipo mas (37 -> 38): `scheduled_time`, una automatizacion que arranca sola el dia y
-- la hora que se eligen (una vez, todos los dias, ciertos dias de la semana o un dia del mes). Es de SISTEMA: corre sin
-- contacto ni persona (`flow_sessions.source_type = 'system'`, que la 00218 ya admite), asi que no hace falta tocar
-- ningun otro CHECK. La corre un trabajo de la cola (`scheduled_jobs.type = 'flow_scheduled_run'`), agendado al
-- publicar: no suma ningun cron.
--
-- Aditiva: solo acepta MAS valores. Va ANTES de desplegar el codigo (publicar una automatizacion programada inserta
-- una fila de este tipo).
--
-- Un CHECK se redefine partiendo del que esta EN LA BASE: la definicion vigente al escribir esta migracion es la de la
-- 00282 (copiada abajo, en «Como volver atras»). Si otra sesion sumo tipos despues (por ejemplo, la de Servicios), el
-- bloque de abajo ABORTA en vez de borrarlos: hay que sumar esos tipos a la lista y volver a correrla.
--
-- Como volver atras (antes, borrar los triggers de ese tipo y anular sus trabajos):
--   DELETE FROM public.triggers WHERE type = 'scheduled_time';
--   UPDATE public.scheduled_jobs SET status = 'cancelled' WHERE type = 'flow_scheduled_run' AND status = 'pending';
--   ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
--   ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check
--     CHECK ((type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text, 'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text, 'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text, 'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text, 'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text, 'task_completed'::text, 'task_overdue'::text, 'whatsapp_group_joined'::text, 'whatsapp_group_reaction'::text, 'whatsapp_group_poll_vote'::text])));
-- ============================================================================

SET search_path = '';

-- Freno: si la base acepta algun tipo que esta lista no tiene, otra migracion lo sumo despues de la 00282 y redefinir
-- el CHECK lo borraria. Se aborta con el nombre de los que faltan.
DO $$
DECLARE
  v_live    text;
  v_missing text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_live
    FROM pg_constraint c
   WHERE c.conname = 'triggers_type_check' AND c.conrelid = 'public.triggers'::regclass;
  IF v_live IS NULL THEN
    RETURN;
  END IF;
  SELECT array_agg(DISTINCT m[1]) INTO v_missing
    FROM regexp_matches(v_live, '''([a-z_]+)''', 'g') AS m
   WHERE m[1] <> ALL (ARRAY[
     'keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword', 'new_contact', 'crm_event',
     'inactivity', 'email_received', 'booking_created', 'booking_rescheduled', 'booking_cancelled', 'booking_updated',
     'booking_ended', 'booking_status_changed', 'booking_before_start', 'booking_after_end', 'booking_after_created',
     'call_analyzed', 'call_linked', 'form_submitted', 'survey_answered', 'contract_signed', 'sale_created',
     'sale_status_changed', 'payment_created', 'payment_status_changed', 'payment_before_due', 'payment_after_due',
     'eod_submitted', 'webhook_received', 'task_completed', 'task_overdue', 'whatsapp_group_joined',
     'whatsapp_group_reaction', 'whatsapp_group_poll_vote', 'scheduled_time'
   ]);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'triggers_type_check ya acepta tipos que esta migracion no conoce: %. Sumalos a la lista y volve a correrla.', array_to_string(v_missing, ', ');
  END IF;
END $$;

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
    'whatsapp_group_poll_vote'::text,
    'scheduled_time'::text
  ]));
