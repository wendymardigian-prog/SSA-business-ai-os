-- ============================================================================
-- 00339 — «En una fecha y hora»: un disparador nuevo (`scheduled_time`)
-- ============================================================================
-- `triggers_type_check` acepta un tipo mas: `scheduled_time`, una automatizacion que arranca sola el dia y la hora que
-- se eligen (una vez, todos los dias, ciertos dias de la semana o un dia del mes). Es de SISTEMA: corre sin contacto ni
-- persona (`flow_sessions.source_type = 'system'`, que la 00218 ya admite), asi que no hace falta tocar ningun otro
-- CHECK. La corre un trabajo de la cola (`scheduled_jobs.type = 'flow_scheduled_run'`), agendado al publicar: no suma
-- ningun cron.
--
-- Aditiva: solo acepta MAS valores. Va ANTES de desplegar el codigo (publicar una automatizacion programada inserta
-- una fila de este tipo).
--
-- Un CHECK se redefine partiendo del que esta EN LA BASE. La lista fija de abajo es la del codigo de `main` al escribir
-- esta migracion (la de la 00282 + `scheduled_time`). Pero la base puede aceptar MAS tipos que el codigo: en
-- produccion, la 00336 de Servicios se aplico antes de que su codigo llegara a `main`. En ese caso el CHECK se arma con
-- TODO lo que la base ya acepta + `scheduled_time`, sin sacar nada. Asi sirve en cualquier orden de aplicacion. Quien
-- sume tipos despues (Servicios, al mergear) redefine el CHECK en una migracion posterior con la lista completa.
--
-- Como volver atras (antes, borrar los triggers de ese tipo y anular sus trabajos): volver a poner el CHECK que habia,
-- sin `scheduled_time` (en produccion, el de la 00336; en una instalacion sin Servicios, el de la 00282):
--   DELETE FROM public.triggers WHERE type = 'scheduled_time';
--   UPDATE public.scheduled_jobs SET status = 'cancelled' WHERE type = 'flow_scheduled_run' AND status = 'pending';
--   ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
--   ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check
--     CHECK ((type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text, 'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text, 'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text, 'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text, 'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text, 'task_completed'::text, 'task_overdue'::text, 'whatsapp_group_joined'::text, 'whatsapp_group_reaction'::text, 'whatsapp_group_poll_vote'::text])));
--   (+ los tipos de Servicios de la 00336, si estaban).
-- ============================================================================

SET search_path = '';

DO $$
DECLARE
  v_fixed text[] := ARRAY[
    'keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword', 'new_contact', 'crm_event',
    'inactivity', 'email_received', 'booking_created', 'booking_rescheduled', 'booking_cancelled', 'booking_updated',
    'booking_ended', 'booking_status_changed', 'booking_before_start', 'booking_after_end', 'booking_after_created',
    'call_analyzed', 'call_linked', 'form_submitted', 'survey_answered', 'contract_signed', 'sale_created',
    'sale_status_changed', 'payment_created', 'payment_status_changed', 'payment_before_due', 'payment_after_due',
    'eod_submitted', 'webhook_received', 'task_completed', 'task_overdue', 'whatsapp_group_joined',
    'whatsapp_group_reaction', 'whatsapp_group_poll_vote', 'scheduled_time'
  ];
  v_live  text;
  v_extra text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_live
    FROM pg_constraint c
   WHERE c.conname = 'triggers_type_check' AND c.conrelid = 'public.triggers'::regclass;

  -- Los tipos que la base ya acepta y la lista fija no tiene (por ejemplo, los de Servicios).
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_extra
    FROM regexp_matches(COALESCE(v_live, ''), '''([a-z_]+)''', 'g') AS m
   WHERE m[1] <> ALL (v_fixed);

  ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;

  IF v_extra IS NULL THEN
    -- Lo normal en una instalacion nueva: la lista fija.
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
  ELSE
    -- La base acepta mas tipos que el codigo: se conservan todos y se suma `scheduled_time`.
    RAISE NOTICE 'triggers_type_check conserva % tipos que la lista fija no tiene: %', array_length(v_extra, 1), array_to_string(v_extra, ', ');
    -- Escrito como `ARRAY['x'::text, ...]`, igual que los demas: un literal `'{x,y}'::text[]` lo guardaria sin comillas
    -- por tipo, y ninguna migracion posterior lo podria leer como se lee este.
    EXECUTE format(
      'ALTER TABLE public.triggers ADD CONSTRAINT %I CHECK (type = ANY (ARRAY[%s]))',
      'triggers_type_check',
      (SELECT string_agg(quote_literal(t) || '::text', ', ' ORDER BY ord) FROM unnest(v_fixed || v_extra) WITH ORDINALITY AS u(t, ord))
    );
  END IF;
END $$;
