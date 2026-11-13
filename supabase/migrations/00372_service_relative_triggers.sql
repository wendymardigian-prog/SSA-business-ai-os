-- ============================================================
-- 00372_service_relative_triggers.sql
-- ============================================================
-- Servicios A4 (plano: A4-M7), F158:
--
--   * Amplia el CHECK de `triggers.type` con `service_relative` («X dias antes o despues de…») y
--     `service_phase_periodic` («Cada N dias mientras este en la fase…»). Se arma desde el que esta EN LA BASE, sin sacar
--     ningun valor (regla del 8/11: la 00321 piso un valor por partir de un archivo viejo).
--   * `app_servicio.svc_relative_due(jsonb)`: gemela pura de `relativeDue` (lib/services/relative-triggers.ts, con
--     `relative-triggers.cases.json`). Solo el servidor.
--   * Reescribe `svc_daily_run`: un paso nuevo, en su propio bloque (si falla no tumba los demas), que emite los dos
--     disparadores UNA vez por disparador, servicio y dia. Y arregla `service_ending_soon`: la pantalla guarda
--     `days_before` y el barrido leia `days` (nunca emitio; en produccion habia 0 disparadores de ese tipo); ahora lee los
--     dos y el evento lleva los dos.
--
-- La definicion vieja de svc_daily_run esta en docs/servicios/definiciones-viejas-a4.sql. Como volver atras: correr esa,
--   DROP FUNCTION IF EXISTS app_servicio.svc_relative_due(jsonb);
--   y el CHECK sin los dos tipos (si no hay filas de esos tipos; si las hay, borrarlas antes).

-- Guarda: si la base aceptara algun tipo que no esta en la lista de abajo, se aborta (no se saca nada).
DO $$
DECLARE
  v_def text;
  v_live text[];
  v_new text[] := ARRAY['keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword', 'new_contact', 'crm_event', 'inactivity', 'email_received', 'booking_created', 'booking_rescheduled', 'booking_cancelled', 'booking_updated', 'booking_ended', 'booking_status_changed', 'booking_before_start', 'booking_after_end', 'booking_after_created', 'call_analyzed', 'call_linked', 'form_submitted', 'survey_answered', 'contract_signed', 'sale_created', 'sale_status_changed', 'payment_created', 'payment_status_changed', 'payment_before_due', 'payment_after_due', 'eod_submitted', 'webhook_received', 'task_completed', 'task_overdue', 'whatsapp_group_joined', 'whatsapp_group_reaction', 'whatsapp_group_poll_vote', 'scheduled_time', 'affiliate_assignment_expired', 'affiliate_lead_created', 'affiliate_sale_created', 'certificate_issued', 'challenge_completed', 'challenge_occurrence_due_soon', 'challenge_occurrence_overdue', 'challenge_started', 'live_session_missed', 'portal_access_expired', 'portal_access_expiring', 'program_lesson_completed', 'program_module_completed', 'quiz_failed', 'quiz_passed', 'service_created', 'service_ending_soon', 'service_extended', 'service_item_completed', 'service_item_overdue', 'service_light_changed', 'service_paused', 'service_phase_completed', 'service_phase_started', 'service_resumed', 'service_started', 'service_status_changed', 'task_submission_received', 'task_submission_reviewed', 'service_relative', 'service_phase_periodic'];
  x text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.triggers'::regclass AND c.conname = 'triggers_type_check';
  IF v_def IS NULL THEN RETURN; END IF;
  SELECT array_agg(m[1]) INTO v_live FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS t(m);
  FOREACH x IN ARRAY COALESCE(v_live, ARRAY[]::text[]) LOOP
    IF NOT (x = ANY (v_new)) THEN
      RAISE EXCEPTION 'triggers_type_check acepta % y la lista nueva no: revisar antes de aplicar', x;
    END IF;
  END LOOP;
END $$;

-- ─── CHECK de triggers.type: los vigentes (leidos de la base el 12/11/2026, 67) + los 2 de A4 ───────────────────
ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text, 'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text, 'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text, 'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text, 'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text, 'task_completed'::text, 'task_overdue'::text, 'whatsapp_group_joined'::text, 'whatsapp_group_reaction'::text, 'whatsapp_group_poll_vote'::text, 'scheduled_time'::text, 'affiliate_assignment_expired'::text, 'affiliate_lead_created'::text, 'affiliate_sale_created'::text, 'certificate_issued'::text, 'challenge_completed'::text, 'challenge_occurrence_due_soon'::text, 'challenge_occurrence_overdue'::text, 'challenge_started'::text, 'live_session_missed'::text, 'portal_access_expired'::text, 'portal_access_expiring'::text, 'program_lesson_completed'::text, 'program_module_completed'::text, 'quiz_failed'::text, 'quiz_passed'::text, 'service_created'::text, 'service_ending_soon'::text, 'service_extended'::text, 'service_item_completed'::text, 'service_item_overdue'::text, 'service_light_changed'::text, 'service_paused'::text, 'service_phase_completed'::text, 'service_phase_started'::text, 'service_resumed'::text, 'service_started'::text, 'service_status_changed'::text, 'task_submission_received'::text, 'task_submission_reviewed'::text, 'service_relative'::text, 'service_phase_periodic'::text]));

-- La regla (pura). input: {kind, anchor, offset_days, every_days, status, today, anchor_on, phase_key,
-- current_phase_key, current_phase_started_on}
CREATE OR REPLACE FUNCTION app_servicio.svc_relative_due(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_off numeric;
  v_every numeric;
  v_day integer;
BEGIN
  IF p ->> 'status' IS DISTINCT FROM 'active' THEN RETURN jsonb_build_object('due', false); END IF;
  IF p ->> 'kind' = 'relative' THEN
    IF jsonb_typeof(p -> 'offset_days') <> 'number' OR NULLIF(p ->> 'anchor_on', '') IS NULL THEN RETURN jsonb_build_object('due', false); END IF;
    v_off := (p ->> 'offset_days')::numeric;
    IF v_off <> trunc(v_off) OR v_off < -365 OR v_off > 365 THEN RETURN jsonb_build_object('due', false); END IF;
    IF (p ->> 'anchor_on')::date + v_off::integer = (p ->> 'today')::date THEN
      RETURN jsonb_build_object('due', true, 'day', p ->> 'today', 'phase_day', NULL);
    END IF;
    RETURN jsonb_build_object('due', false);
  END IF;
  IF jsonb_typeof(p -> 'every_days') <> 'number' THEN RETURN jsonb_build_object('due', false); END IF;
  v_every := (p ->> 'every_days')::numeric;
  IF v_every <> trunc(v_every) OR v_every < 1 OR v_every > 90 THEN RETURN jsonb_build_object('due', false); END IF;
  IF NULLIF(p ->> 'phase_key', '') IS NULL OR p ->> 'current_phase_key' IS DISTINCT FROM p ->> 'phase_key'
     OR NULLIF(p ->> 'current_phase_started_on', '') IS NULL THEN
    RETURN jsonb_build_object('due', false);
  END IF;
  v_day := (p ->> 'today')::date - (p ->> 'current_phase_started_on')::date;
  IF v_day < v_every OR v_day % v_every::integer <> 0 THEN RETURN jsonb_build_object('due', false); END IF;
  RETURN jsonb_build_object('due', true, 'day', p ->> 'today', 'phase_day', v_day);
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_relative_due(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.svc_relative_due(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_daily_run(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date;
  v_out jsonb := '{}'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  n integer;
  s app_servicio.services;
  it record;
  r record;
  d integer;
  -- A4 (00372).
  v_due jsonb;
  v_anchor_on date;
  v_cur_key text;
  v_cur_start date;
BEGIN
  IF NOT app_servicio.module_on(p_workspace_id) THEN RETURN jsonb_build_object('skipped', 'module_off'); END IF;
  PERFORM app_servicio.as_system();
  v_today := app_servicio.today_in(p_workspace_id);

  -- Repeticiones (F21) y Retos de fecha fija (F22).
  BEGIN
    n := 0;
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status = 'active' LOOP
      PERFORM app_servicio.svc_generate_occurrences(s.id);
      n := n + app_servicio.svc_open_due_challenges(s.id);
    END LOOP;
    v_out := v_out || jsonb_build_object('challenges_opened', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('occurrences: ' || SQLERRM);
  END;

  -- Pasos vencidos y su evento (F25), una vez por paso.
  BEGIN
    n := 0;
    FOR it IN SELECT i.id, i.service_id, i.template_key, i.name FROM app_servicio.service_items i JOIN app_servicio.services sv ON sv.id = i.service_id
               WHERE sv.workspace_id = p_workspace_id AND sv.status = 'active' AND NOT sv.is_test AND i.status = 'pending' AND NOT i.is_recurring_template
                 AND i.due_on IS NOT NULL AND i.due_on < v_today
                 AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'service_item_overdue'
                                   AND e.payload ->> 'item_id' = i.id::text) LOOP
      PERFORM app_servicio.emit_service(it.service_id, 'service_item_overdue', jsonb_build_object('item_id', it.id, 'item_key', it.template_key, 'item_name', it.name));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('items_overdue', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('overdue: ' || SQLERRM);
  END;

  -- Semaforo (F24).
  BEGIN
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status IN ('active', 'paused') LOOP
      PERFORM app_servicio.svc_compute_light(s.id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('light: ' || SQLERRM);
  END;

  -- Accesos que se abren con el tiempo y mora (F39).
  BEGIN
    v_out := v_out || jsonb_build_object('access', app_servicio.svc_access_tick(p_workspace_id));
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('access: ' || SQLERRM);
  END;

  -- Renovados que llegan a su fin (F9): el anterior pasa a «renovado» y lo que el nuevo tambien da pasa al nuevo.
  BEGIN
    n := 0;
    FOR s IN SELECT o.* FROM app_servicio.services o
              WHERE o.workspace_id = p_workspace_id AND o.status IN ('active', 'paused') AND o.ends_on IS NOT NULL AND o.ends_on < v_today
                AND EXISTS (SELECT 1 FROM app_servicio.services nx WHERE nx.previous_service_id = o.id AND nx.status IN ('active', 'paused', 'pending_confirmation')) LOOP
      PERFORM app_servicio.svc_cut_access(s.id, 'renewed');
      UPDATE app_servicio.services SET status = 'renewed', completed_at = COALESCE(completed_at, now()), updated_at = now() WHERE id = s.id;
      PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.renewed', '{}'::jsonb, 'system');
      PERFORM app_servicio.emit_service(s.id, 'service_status_changed', jsonb_build_object('previous_status', s.status));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('renewed_closed', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('renewed: ' || SQLERRM);
  END;

  -- Accesos por vencer (7 dias) y vencidos (ayer), una vez por acceso.
  BEGIN
    n := 0;
    FOR r IN SELECT a.id, a.service_id, a.section, a.ends_at FROM app_servicio_portal.portal_access a JOIN app_servicio.services sv ON sv.id = a.service_id
              WHERE a.workspace_id = p_workspace_id AND a.revoked_at IS NULL AND a.ends_at IS NOT NULL AND NOT sv.is_test
                AND a.ends_at > now() AND a.ends_at <= now() + interval '7 days'
                AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'portal_access_expiring'
                                  AND e.payload ->> 'access_id' = a.id::text) LOOP
      PERFORM app_servicio.emit_service(r.service_id, 'portal_access_expiring', jsonb_build_object('access_id', r.id, 'section', r.section, 'ends_at', r.ends_at));
      n := n + 1;
    END LOOP;
    FOR r IN SELECT a.id, a.service_id, a.section, a.ends_at FROM app_servicio_portal.portal_access a JOIN app_servicio.services sv ON sv.id = a.service_id
              WHERE a.workspace_id = p_workspace_id AND a.revoked_at IS NULL AND a.ends_at IS NOT NULL AND NOT sv.is_test
                AND a.ends_at <= now() AND a.ends_at > now() - interval '3 days'
                AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'portal_access_expired'
                                  AND e.payload ->> 'access_id' = a.id::text) LOOP
      PERFORM app_servicio.emit_service(r.service_id, 'portal_access_expired', jsonb_build_object('access_id', r.id, 'section', r.section, 'ends_at', r.ends_at));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('access_events', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('access_events: ' || SQLERRM);
  END;

  -- «Faltó» (F61): fechas de ayer con la ventana cerrada, para quien tiene acceso Calendario vigente, la sesion es de su
  -- variante, el servicio no esta pausado y no tiene asistencia. Una vez por persona, sesion y fecha.
  BEGIN
    n := 0;
    FOR r IN
      SELECT ls.id AS session_id, (o ->> 'occursOn')::date AS occurs_on, sv.id AS service_id, sv.contact_id
        FROM app_servicio.live_sessions ls
        CROSS JOIN LATERAL jsonb_array_elements(app_servicio.live_occurrences_plan(jsonb_build_object(
          'session', jsonb_build_object('kind', ls.kind, 'weekdays', to_jsonb(ls.weekdays), 'every_weeks', ls.every_weeks, 'starts_on', ls.starts_on,
                                        'ends_on', ls.ends_on, 'single_at', ls.single_at, 'start_time', to_char(ls.start_time, 'HH24:MI'),
                                        'duration_minutes', ls.duration_minutes, 'timezone', ls.timezone),
          'exceptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('occurs_on', x.occurs_on, 'status', x.status, 'moved_to', x.moved_to))
                                    FROM app_servicio.live_session_dates x WHERE x.live_session_id = ls.id), '[]'::jsonb),
          'from', v_today - 2, 'to', v_today))) o
        JOIN app_servicio.services sv ON sv.product_id = ls.product_id AND sv.status = 'active' AND NOT sv.is_test
       WHERE ls.workspace_id = p_workspace_id AND ls.archived_at IS NULL AND o ->> 'status' <> 'cancelled'
         AND (o ->> 'endsAt')::timestamptz + interval '30 minutes' < now()
         AND (ls.variant_ids IS NULL OR sv.product_variant_id = ANY (ls.variant_ids))
         AND EXISTS (SELECT 1 FROM app_servicio_portal.portal_access a WHERE a.service_id = sv.id AND a.section = 'calendar' AND a.revoked_at IS NULL
                       AND a.starts_at <= (o ->> 'startsAt')::timestamptz AND (a.ends_at IS NULL OR a.ends_at > (o ->> 'startsAt')::timestamptz))
         AND NOT EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance la WHERE la.live_session_id = ls.id AND la.occurs_on = (o ->> 'occursOn')::date
                           AND la.contact_id = sv.contact_id AND la.removed_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'live_session_missed'
                           AND e.contact_id = sv.contact_id AND e.payload ->> 'live_session_id' = ls.id::text AND e.payload ->> 'occurs_on' = (o ->> 'occursOn'))
    LOOP
      PERFORM app_servicio.emit_service(r.service_id, 'live_session_missed', jsonb_build_object('live_session_id', r.session_id, 'occurs_on', r.occurs_on::text));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('missed', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('missed: ' || SQLERRM);
  END;

  -- «Reanudar sola» (F94).
  BEGIN
    n := 0;
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status = 'paused' AND pause_resume_on IS NOT NULL AND pause_resume_on <= v_today LOOP
      PERFORM app_servicio.svc_resume(s.id, '{}'::jsonb);
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('resumed', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('resume: ' || SQLERRM);
  END;

  -- Servicios que empiezan hoy (F14, F115): `service_started` una vez.
  BEGIN
    n := 0;
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status = 'active' AND starts_on IS NOT NULL AND starts_on <= v_today
               AND NOT COALESCE((flags ->> 'started_emitted')::boolean, false) LOOP
      PERFORM app_servicio.emit(s, 'service_started');
      UPDATE app_servicio.services SET flags = flags || '{"started_emitted": true}'::jsonb WHERE id = s.id;
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('started', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('started: ' || SQLERRM);
  END;

  -- `service_ending_soon` (F25): N dias antes de `ends_on`, una vez por servicio y por N. Los N salen de los
  -- disparadores activos del negocio (si no hay ninguno, no se emite nada).
  BEGIN
    n := 0;
    -- A4 (00372): la pantalla guarda `days_before`; antes se leia solo `days` y el disparador nunca emitia. Se leen los dos.
    FOR d IN SELECT DISTINCT (COALESCE(t.config -> 'days_before', t.config -> 'days') #>> '{}')::integer FROM public.triggers t
              WHERE t.workspace_id = p_workspace_id AND t.type = 'service_ending_soon' AND t.is_active
                AND jsonb_typeof(COALESCE(t.config -> 'days_before', t.config -> 'days')) = 'number'
                AND (COALESCE(t.config -> 'days_before', t.config -> 'days') #>> '{}')::integer BETWEEN 0 AND 365 LOOP
      FOR s IN SELECT * FROM app_servicio.services sv WHERE sv.workspace_id = p_workspace_id AND sv.status = 'active' AND NOT sv.is_test
                 AND sv.ends_on = v_today + d
                 AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'service_ending_soon'
                                   AND e.payload ->> 'service_id' = sv.id::text AND e.payload ->> 'days' = d::text) LOOP
        PERFORM app_servicio.emit(s, 'service_ending_soon', jsonb_build_object('days', d, 'days_before', d));
        n := n + 1;
      END LOOP;
    END LOOP;
    v_out := v_out || jsonb_build_object('ending_soon', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('ending_soon: ' || SQLERRM);
  END;

  -- A4 (F158): `service_relative` y `service_phase_periodic`. Lee los disparadores activos de esos tipos y emite UNA
  -- vez por disparador, servicio y dia. Un servicio pausado o un ancla que no ocurrio no emiten (svc_relative_due).
  BEGIN
    n := 0;
    FOR r IN SELECT t.id, t.type, t.config FROM public.triggers t
              WHERE t.workspace_id = p_workspace_id AND t.is_active AND t.type IN ('service_relative', 'service_phase_periodic') LOOP
      FOR s IN SELECT * FROM app_servicio.services sv
                WHERE sv.workspace_id = p_workspace_id AND sv.status = 'active' AND NOT sv.is_test
                  AND (NULLIF(r.config ->> 'product_id', '') IS NULL OR sv.product_id::text = r.config ->> 'product_id')
                  AND (NULLIF(r.config ->> 'variant_id', '') IS NULL OR sv.product_variant_id::text = r.config ->> 'variant_id') LOOP
        v_cur_key := NULL; v_cur_start := NULL; v_anchor_on := NULL;
        SELECT ph.template_key, app_servicio.local_date(ph.started_at, s.workspace_id) INTO v_cur_key, v_cur_start
          FROM app_servicio.service_phases ph WHERE ph.service_id = s.id AND ph.status = 'in_progress' LIMIT 1;
        IF r.type = 'service_relative' THEN
          v_anchor_on := CASE r.config ->> 'anchor'
            WHEN 'service_created' THEN app_servicio.local_date(s.created_at, s.workspace_id)
            WHEN 'service_start' THEN s.starts_on
            WHEN 'service_end' THEN s.ends_on
            WHEN 'phase_start' THEN (SELECT app_servicio.local_date(ph.started_at, s.workspace_id) FROM app_servicio.service_phases ph
                                      WHERE ph.service_id = s.id AND ph.template_key = r.config ->> 'phase_key' AND ph.started_at IS NOT NULL LIMIT 1)
            WHEN 'item_completed' THEN (SELECT app_servicio.local_date(min(i.completed_at), s.workspace_id) FROM app_servicio.service_items i
                                         WHERE i.service_id = s.id AND i.template_key = r.config ->> 'item_key' AND i.status = 'completed')
          END;
        END IF;
        v_due := app_servicio.svc_relative_due(jsonb_build_object(
          'kind', CASE r.type WHEN 'service_relative' THEN 'relative' ELSE 'periodic' END,
          'anchor', r.config ->> 'anchor', 'offset_days', r.config -> 'offset_days', 'every_days', r.config -> 'every_days',
          'status', s.status, 'today', to_char(v_today, 'YYYY-MM-DD'), 'anchor_on', to_char(v_anchor_on, 'YYYY-MM-DD'),
          'phase_key', r.config ->> 'phase_key', 'current_phase_key', v_cur_key, 'current_phase_started_on', to_char(v_cur_start, 'YYYY-MM-DD')));
        CONTINUE WHEN NOT COALESCE((v_due ->> 'due')::boolean, false);
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = r.type
                                AND e.payload ->> 'service_id' = s.id::text AND e.payload ->> 'trigger_id' = r.id::text AND e.payload ->> 'day' = v_due ->> 'day');
        PERFORM app_servicio.emit(s, r.type, jsonb_build_object('trigger_id', r.id, 'day', v_due ->> 'day', 'phase_day', v_due -> 'phase_day',
          'anchor', r.config ->> 'anchor', 'offset_days', r.config -> 'offset_days', 'phase_key', r.config ->> 'phase_key', 'item_key', r.config ->> 'item_key'));
        n := n + 1;
      END LOOP;
    END LOOP;
    v_out := v_out || jsonb_build_object('relative', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('relative: ' || SQLERRM);
  END;

  -- Purga de la comunidad (F76): lo borrado hace mas de 30 dias.
  BEGIN
    DELETE FROM app_servicio_portal.community_posts WHERE workspace_id = p_workspace_id AND deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
    GET DIAGNOSTICS n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('community_purged', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('community: ' || SQLERRM);
  END;

  RETURN v_out || jsonb_build_object('errors', v_errors, 'day', v_today);
END;
$function$;
