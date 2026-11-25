-- 00522 · Pasos del camino que se repiten: más frecuencias, el estado de la serie y la vuelta en su tarea
-- (25/11/2026, traído de RER #70 y #140 B-PRD-15, adaptado al motor de SSA).
--
-- SSA ya repetía pasos desde el Reto (00333, 00376: `recurrence` con `from`, `until`, `max_days` y el atraso). RER
-- construyó lo suyo sobre otra base; acá se suma SOLO lo que le faltaba a SSA, partiendo de las definiciones vigentes
-- en producción (leídas con pg_get_functiondef el 25/11/2026, copiadas abajo letra por letra para volver atrás):
--
--  1. `service_items`: `round_on` (el día de la vuelta) y el estado de la serie en el paso que se repite:
--     `series_ended_at`, `series_end_reason` (manual | service_end | n_times), `series_ended_by`, `series_end_note`.
--  2. `svc_occurrence_next` (nueva) y `svc_occurrence_dates`: cada N semanas, cada mes (un día del mes o el último) y
--     los días de la semana. Con un paso fijo (día, semana, N días) da exactamente lo mismo que antes. Gemelas
--     `nextOccurrence` / `occurrenceDates` (lib/services/engine-rules.ts) con recurrence.cases.json.
--  3. `journey_recurrence_problems`: acepta `n_weeks`, `month`, `weekdays` y `day_of_month` (gemela `recurrenceProblems`
--     en lib/services/journey-template.ts, con journey-template.cases.json).
--  4. `svc_series_reached` (nueva): «después de N vueltas» cuenta las CUMPLIDAS (en producción ningún paso usaba
--     `n_times` al 25/11). Gemela `seriesReached` (lib/services/repetition.ts) con repetition.cases.json.
--  5. `svc_generate_occurrences`: no crea vueltas de una serie terminada, termina la serie al cumplir sus N vueltas y
--     guarda `round_on`.
--  6. `svc_ensure_task`: la tarea de una vuelta se llama «… · vuelta N».
--  7. `svc_mark_item` y `svc_challenge_view`: el día de la vuelta sale de `round_on` (con el cálculo de antes como respaldo).
--  8. `svc_end_series` / `svc_set_item_series` (nuevas, con la sesión y `services.items` adentro): terminar o cambiar
--     la serie de un paso en UN servicio. Quedan en el historial.
--  9. El trigger `trg_app_servicio_end_series`: al terminar, cancelar o renovar el servicio, sus series terminan.
--     Nunca hace fallar el cambio de estado (`hook_failed`) y con el módulo apagado no hace nada.
--
-- B-PRD-15 (las vueltas heredan el bloqueo del paso) ya se cumplía en SSA: cada vuelta copia `ref`, y el bloqueo vive
-- en `ref.lock` (00369). verify-services lo comprueba (bloque `rp`).
--
-- La pausa no se recupera: al reanudar, svc_resume corre el inicio de la fase y las fechas de la serie se corren con él.
--
-- ADITIVA: columnas nuevas, funciones nuevas y funciones vigentes reescritas con su cambio marcado. Solo completa
-- `round_on` de las vueltas que ya existen (al 25/11 no había ninguna). Va ANTES del deploy: el código lee las columnas.
--
-- Volver atrás: recrear las seis funciones de abajo con su definición vieja; `DROP TRIGGER trg_app_servicio_end_series
-- ON app_servicio.services`; `DROP FUNCTION app_servicio.services_end_series_hook(), app_servicio.svc_end_series(uuid, text),
-- app_servicio.svc_set_item_series(uuid, jsonb), app_servicio.svc_series_reached(jsonb, integer),
-- app_servicio.svc_occurrence_next(jsonb, date, date)`; y borrar las cinco columnas nuevas.
--
-- ════ Definiciones vigentes antes de la 00522, letra por letra ════
--
-- ---- app_servicio.svc_occurrence_dates ----
-- CREATE OR REPLACE FUNCTION app_servicio.svc_occurrence_dates(p_recurrence jsonb, p_start date, p_phase_end date, p_service_end date, p_upto date)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  IMMUTABLE
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v_step integer := CASE p_recurrence ->> 'every' WHEN 'day' THEN 1 WHEN 'week' THEN 7
--                        ELSE GREATEST(1, COALESCE((p_recurrence ->> 'n')::integer, 1)) END;
--   v_limit date := CASE p_recurrence ->> 'until'
--                     WHEN 'phase_end' THEN p_phase_end WHEN 'item_completed' THEN p_phase_end WHEN 'service_end' THEN p_service_end
--                     WHEN 'n_days' THEN p_start + (GREATEST(1, COALESCE((p_recurrence ->> 'n_until')::integer, 1)) - 1) END;
--   v_max integer := CASE WHEN p_recurrence ->> 'until' = 'n_times' THEN GREATEST(1, COALESCE((p_recurrence ->> 'n_until')::integer, 1)) ELSE 1000 END;
--   v_out jsonb := '[]'::jsonb;
--   v_day date;
--   k integer;
-- BEGIN
--   IF p_start IS NULL THEN RETURN v_out; END IF;
--   IF app_servicio.j_int(p_recurrence -> 'max_days') AND (p_recurrence ->> 'max_days')::integer >= 1 THEN
--     v_limit := LEAST(v_limit, p_start + (p_recurrence ->> 'max_days')::integer - 1);
--   END IF;
--   FOR k IN 0 .. v_max - 1 LOOP
--     v_day := p_start + k * v_step;
--     EXIT WHEN v_limit IS NOT NULL AND v_day > v_limit;
--     EXIT WHEN v_day > p_upto;
--     v_out := v_out || jsonb_build_array(jsonb_build_object('index', k + 1, 'occursOn', to_char(v_day, 'YYYY-MM-DD'),
--                                                            'dueOn', to_char(v_day + v_step - 1, 'YYYY-MM-DD')));
--   END LOOP;
--   RETURN v_out;
-- END;
-- $function$;
--
-- ---- app_servicio.journey_recurrence_problems ----
-- CREATE OR REPLACE FUNCTION app_servicio.journey_recurrence_problems(p_item jsonb, p_nm text)
--  RETURNS text[]
--  LANGUAGE plpgsql
--  IMMUTABLE
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v text[] := ARRAY[]::text[];
--   r jsonb := p_item -> 'recurrence';
--   f jsonb;
--   l jsonb := p_item -> 'late';
-- BEGIN
--   IF r IS NOT NULL AND jsonb_typeof(r) <> 'null' THEN
--     IF jsonb_typeof(r) <> 'object' THEN
--       v := v || format('«%s»: la repetición no es válida', p_nm);
--     ELSE
--       IF NOT COALESCE(r ->> 'every' = ANY (ARRAY['day','week','n_days']), false) THEN v := v || format('«%s»: elegí cada cuánto se repite', p_nm); END IF;
--       IF r ->> 'every' = 'n_days' AND NOT (app_servicio.j_int(r -> 'n') AND app_servicio.j_num(r -> 'n') BETWEEN 1 AND 365) THEN
--         v := v || format('«%s»: elegí cada cuántos días se repite', p_nm);
--       END IF;
--       IF NOT COALESCE(r ->> 'until' = ANY (ARRAY['phase_end','service_end','n_days','n_times','item_completed']), false) THEN v := v || format('«%s»: elegí hasta cuándo se repite', p_nm); END IF;
--       IF r ->> 'until' IN ('n_days','n_times') AND NOT (app_servicio.j_int(r -> 'n_until') AND app_servicio.j_num(r -> 'n_until') BETWEEN 1 AND 1000) THEN
--         v := v || format('«%s»: elegí cuántas veces o días', p_nm);
--       END IF;
--       IF r ->> 'until' = 'item_completed' AND (jsonb_typeof(r -> 'item_key') = 'string' AND (r ->> 'item_key') ~ '^it_[a-z0-9]{6}$') IS NOT TRUE THEN
--         v := v || format('«%s»: elegí el paso que corta la repetición', p_nm);
--       END IF;
--       IF r ? 'phase_key' AND jsonb_typeof(r -> 'phase_key') <> 'null'
--          AND (r ->> 'until' = 'phase_end' AND jsonb_typeof(r -> 'phase_key') = 'string' AND (r ->> 'phase_key') ~ '^ph_[a-z0-9]{6}$') IS NOT TRUE THEN
--         v := v || format('«%s»: la fase no es válida', p_nm);
--       END IF;
--       IF r ? 'max_days' AND jsonb_typeof(r -> 'max_days') <> 'null' AND NOT (app_servicio.j_int(r -> 'max_days') AND app_servicio.j_num(r -> 'max_days') BETWEEN 1 AND 1000) THEN
--         v := v || format('«%s»: el tope de días va de 1 a 1000', p_nm);
--       END IF;
--       IF r ? 'from' AND jsonb_typeof(r -> 'from') <> 'null' THEN
--         f := r -> 'from';
--         IF (CASE WHEN jsonb_typeof(f) = 'object' THEN
--                   COALESCE(f ->> 'from' = ANY (ARRAY['service_created','service_start','phase_start','phase_end','item_completed']), false)
--                   AND app_servicio.j_int(f -> 'days') AND app_servicio.j_num(f -> 'days') BETWEEN 0 AND 3650
--                   AND (CASE WHEN f ->> 'from' = 'item_completed'
--                             THEN jsonb_typeof(f -> 'item_key') = 'string' AND (f ->> 'item_key') ~ '^it_[a-z0-9]{6}$'
--                             ELSE NOT (f ? 'item_key') OR jsonb_typeof(f -> 'item_key') = 'null' END)
--                   AND (NOT (f ? 'phase_key') OR jsonb_typeof(f -> 'phase_key') = 'null'
--                        OR (f ->> 'from' IN ('phase_start','phase_end') AND jsonb_typeof(f -> 'phase_key') = 'string' AND (f ->> 'phase_key') ~ '^ph_[a-z0-9]{6}$'))
--                 ELSE false END) IS NOT TRUE THEN
--           v := v || format('«%s»: elegí desde cuándo se repite', p_nm);
--         END IF;
--       END IF;
--     END IF;
--   END IF;
--   IF l IS NOT NULL AND jsonb_typeof(l) <> 'null' THEN
--     IF (CASE WHEN jsonb_typeof(l) = 'object' THEN
--               NOT (l ? 'accept' AND jsonb_typeof(l -> 'accept') <> 'boolean')
--               AND NOT (l ? 'early' AND jsonb_typeof(l -> 'early') <> 'boolean')
--               AND NOT (l ? 'grace_hours' AND jsonb_typeof(l -> 'grace_hours') <> 'null' AND NOT (app_servicio.j_int(l -> 'grace_hours') AND app_servicio.j_num(l -> 'grace_hours') BETWEEN 0 AND 168))
--               AND NOT (l ? 'grace_days' AND jsonb_typeof(l -> 'grace_days') <> 'null' AND NOT (app_servicio.j_int(l -> 'grace_days') AND app_servicio.j_num(l -> 'grace_days') BETWEEN 0 AND 365))
--             ELSE false END) IS NOT TRUE THEN
--       v := v || format('«%s»: el atraso no es válido', p_nm);
--     END IF;
--   END IF;
--   RETURN v;
-- END;
-- $function$;
--
-- ---- app_servicio.svc_generate_occurrences ----
-- CREATE OR REPLACE FUNCTION app_servicio.svc_generate_occurrences(p_service_id uuid)
--  RETURNS integer
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   s app_servicio.services;
--   m app_servicio.service_items;
--   ph app_servicio.service_phases;
--   v_tz text; v_student_tz text; v_today date; v_start date; v_until date; v_phase_start date;
--   v_occ jsonb; o jsonb; v_created integer := 0; v_new uuid;
--   v_grace integer;
--   v_phases jsonb; v_items jsonb; v_win jsonb;
-- BEGIN
--   SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
--   IF s.id IS NULL OR s.status <> 'active' OR NOT app_servicio.module_on(s.workspace_id) THEN RETURN 0; END IF;
--   v_tz := app_servicio.ws_tz(s.workspace_id);
--   SELECT COALESCE(NULLIF(c.timezone, ''), v_tz) INTO v_student_tz FROM public.contacts c WHERE c.id = s.contact_id;
--   v_student_tz := COALESCE(v_student_tz, v_tz);
--   v_today := (now() AT TIME ZONE v_student_tz)::date;
--   SELECT COALESCE(jsonb_object_agg(p.template_key, jsonb_build_object(
--            'start', to_char(app_servicio.local_date(p.started_at, s.workspace_id), 'YYYY-MM-DD'),
--            'end', to_char(app_servicio.local_date(p.completed_at, s.workspace_id), 'YYYY-MM-DD'))), '{}'::jsonb)
--     INTO v_phases FROM app_servicio.service_phases p WHERE p.service_id = s.id AND p.template_key IS NOT NULL;
--   SELECT COALESCE(jsonb_object_agg(i.template_key, to_char(app_servicio.local_date(i.completed_at, s.workspace_id), 'YYYY-MM-DD')), '{}'::jsonb)
--     INTO v_items FROM app_servicio.service_items i
--    WHERE i.service_id = s.id AND i.parent_item_id IS NULL AND NOT i.is_recurring_template AND i.template_key IS NOT NULL;
--   FOR m IN SELECT i.* FROM app_servicio.service_items i JOIN app_servicio.service_phases p ON p.id = i.phase_id
--             WHERE i.service_id = p_service_id AND i.is_recurring_template AND p.status = 'in_progress' LOOP
--     SELECT * INTO ph FROM app_servicio.service_phases WHERE id = m.phase_id;
--     v_phase_start := app_servicio.local_date(ph.started_at, s.workspace_id);
--     v_win := app_servicio.svc_recurrence_window(m.recurrence, jsonb_build_object(
--       'serviceCreated', app_servicio.local_date(s.created_at, s.workspace_id), 'serviceStart', s.starts_on, 'serviceEnd', s.ends_on,
--       'phaseStart', v_phase_start, 'phaseEnd', CASE WHEN ph.duration_days IS NOT NULL THEN v_phase_start + ph.duration_days - 1 END,
--       'phases', v_phases, 'items', v_items));
--     v_start := (v_win ->> 'start')::date;
--     CONTINUE WHEN v_start IS NULL;
--     v_until := (v_win ->> 'until')::date;
--     v_occ := app_servicio.svc_occurrence_dates(m.recurrence, v_start, v_until, v_until, v_today);
--     v_grace := COALESCE((m.late ->> 'grace_hours')::integer, 0);
--     FOR o IN SELECT x FROM jsonb_array_elements(v_occ) x LOOP
--       CONTINUE WHEN v_phase_start IS NOT NULL AND (o ->> 'occursOn')::date < v_phase_start;
--       INSERT INTO app_servicio.service_items (workspace_id, service_id, phase_id, template_key, kind, name, description, required, assignee,
--         assignee_user_id, visible_to_client, portal_button, ref, late, reminders, parent_item_id, occurrence_index, position,
--         yellow_after_days, red_after_days, due_on, due_at)
--       VALUES (s.workspace_id, s.id, m.phase_id, m.template_key, m.kind, m.name, m.description, m.required, m.assignee,
--         m.assignee_user_id, m.visible_to_client, m.portal_button, m.ref, m.late, m.reminders, m.id, (o ->> 'index')::integer,
--         m.position, m.yellow_after_days, m.red_after_days, (o ->> 'dueOn')::date,
--         app_servicio.end_of_day((o ->> 'dueOn')::date, v_student_tz) + make_interval(hours => v_grace))
--       ON CONFLICT (parent_item_id, occurrence_index) WHERE parent_item_id IS NOT NULL DO NOTHING
--       RETURNING id INTO v_new;
--       IF v_new IS NOT NULL THEN
--         v_created := v_created + 1;
--         PERFORM app_servicio.svc_ensure_task(v_new);
--         v_new := NULL;
--       END IF;
--     END LOOP;
--   END LOOP;
--   RETURN v_created;
-- END;
-- $function$;
--
-- ---- app_servicio.svc_ensure_task ----
-- CREATE OR REPLACE FUNCTION app_servicio.svc_ensure_task(p_item_id uuid)
--  RETURNS void
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   it app_servicio.service_items;
--   s app_servicio.services;
--   v_owner uuid;
--   v_task uuid;
-- BEGIN
--   SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
--   IF it.id IS NULL OR it.kind <> 'team_task' OR it.task_id IS NOT NULL OR it.status = 'completed' OR it.is_recurring_template THEN RETURN; END IF;
--   SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
--   v_owner := CASE it.assignee WHEN 'user' THEN it.assignee_user_id ELSE s.owner_user_id END;
--   -- A4 (F148, F152): la tarea nace con su servicio y con los puntos del checklist del paso, sin tildar.
--   INSERT INTO public.tasks (workspace_id, title, description, status, priority, due_date, owner_id, contact_id, source, source_ref, created_by,
--                             service_id, checklist)
--   VALUES (s.workspace_id, left(it.name, 200), it.description, 'pending', 'normal',
--           COALESCE(it.due_on, app_servicio.local_date(it.due_at, s.workspace_id)), v_owner, s.contact_id, 'cx', 'svc_item:' || it.id::text, NULL,
--           s.id,
--           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'text', left(btrim(c #>> '{}'), 200), 'done', false) ORDER BY o)
--                       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(it.ref -> 'checklist') = 'array' THEN it.ref -> 'checklist' ELSE '[]'::jsonb END)
--                            WITH ORDINALITY AS t(c, o)
--                      WHERE jsonb_typeof(c) = 'string' AND btrim(c #>> '{}') <> '' AND o <= 30), '[]'::jsonb))
--   RETURNING id INTO v_task;
--   UPDATE app_servicio.service_items SET task_id = v_task WHERE id = it.id;
--   IF v_owner IS NOT NULL THEN
--     PERFORM app_servicio.notify(s.workspace_id, v_owner, 'task_assigned', 'Tenés una tarea nueva', it.name, 'task', v_task,
--                                 jsonb_build_object('service_id', s.id));
--   END IF;
-- END;
-- $function$;
--
-- ---- app_servicio.svc_mark_item ----
-- CREATE OR REPLACE FUNCTION app_servicio.svc_mark_item(p_item_id uuid, p_source text, p_by_kind text, p_by uuid)
--  RETURNS boolean
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   it app_servicio.service_items;
--   s app_servicio.services;
--   ph app_servicio.service_phases;
--   d record;
--   v_rec jsonb; v_step integer; v_tz text; v_plan jsonb;
-- BEGIN
--   SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
--   IF it.id IS NULL OR it.status = 'completed' OR it.is_recurring_template THEN RETURN false; END IF;
--   SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
--   SELECT * INTO ph FROM app_servicio.service_phases WHERE id = it.phase_id;
--   IF p_source = 'automation' THEN
--     PERFORM app_servicio.svc_assert_completable(it.id);
--   ELSIF p_by_kind = 'client' OR p_source = 'call' THEN
--     BEGIN
--       IF (app_servicio.svc_item_lock_state(it.id) ->> 'locked')::boolean THEN
--         PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.item_completed_while_locked',
--           jsonb_build_object('service_id', s.id, 'item_key', it.template_key, 'source', p_source), 'system');
--       END IF;
--     EXCEPTION WHEN OTHERS THEN
--       RAISE WARNING 'svc_mark_item: no pude anotar el bloqueo: %', SQLERRM;
--     END;
--   END IF;
--   IF p_by_kind = 'client' AND it.parent_item_id IS NOT NULL AND jsonb_typeof(it.late) = 'object' AND it.due_on IS NOT NULL THEN
--     SELECT i.recurrence INTO v_rec FROM app_servicio.service_items i WHERE i.id = it.parent_item_id;
--     v_step := CASE v_rec ->> 'every' WHEN 'day' THEN 1 WHEN 'week' THEN 7 ELSE GREATEST(1, COALESCE((v_rec ->> 'n')::integer, 1)) END;
--     SELECT NULLIF(c.timezone, '') INTO v_tz FROM public.contacts c WHERE c.id = s.contact_id;
--     v_tz := COALESCE(v_tz, app_servicio.ws_tz(s.workspace_id));
--     v_plan := app_servicio.svc_late_plan(it.late, it.due_on - v_step + 1, it.due_on, (now() AT TIME ZONE v_tz));
--     IF NOT (v_plan ->> 'ok')::boolean THEN
--       RAISE EXCEPTION '%', v_plan ->> 'message' USING ERRCODE = v_plan ->> 'code';
--     END IF;
--   END IF;
--   UPDATE app_servicio.service_items
--      SET status = 'completed', completed_at = now(), completed_by_kind = p_by_kind, completed_by = p_by, completed_source = p_source
--    WHERE id = it.id;
--   IF it.task_id IS NOT NULL THEN
--     UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = it.task_id AND status <> 'completed';
--   END IF;
--   FOR d IN SELECT o.id FROM app_servicio.service_items o
--             WHERE o.service_id = it.service_id AND o.status = 'pending' AND o.due_rule ->> 'from' = 'item_completed'
--               AND o.due_rule ->> 'item_key' = it.template_key LOOP
--     PERFORM app_servicio.svc_compute_due(d.id);
--   END LOOP;
--   PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.item_completed',
--     jsonb_build_object('service_id', s.id, 'item_key', it.template_key, 'source', p_source), CASE p_by_kind WHEN 'client' THEN 'client' WHEN 'user' THEN 'user' ELSE 'system' END);
--   PERFORM app_servicio.emit(s, 'service_item_completed', jsonb_build_object('phase_key', ph.template_key, 'item_key', it.template_key, 'item_kind', it.kind));
--   IF ph.status = 'in_progress' THEN
--     PERFORM app_servicio.svc_check_open_items(ph.id);
--     PERFORM app_servicio.svc_try_advance_phase(s.id);
--   END IF;
--   PERFORM app_servicio.svc_compute_light(s.id);
--   RETURN true;
-- END;
-- $function$;
--
-- ---- app_servicio.svc_challenge_view ----
-- CREATE OR REPLACE FUNCTION app_servicio.svc_challenge_view(p_service_id uuid)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   s app_servicio.services;
--   ph app_servicio.service_phases;
--   w jsonb; v_start date; v_rows jsonb; v_today date;
-- BEGIN
--   SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
--   IF s.id IS NULL THEN RETURN NULL; END IF;
--   IF NOT app_servicio.is_system() AND NOT app_servicio.can_see_service_row(s) THEN
--     RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
--   END IF;
--   SELECT * INTO ph FROM app_servicio.service_phases
--    WHERE service_id = s.id AND challenge -> 'enabled' = 'true'::jsonb ORDER BY position LIMIT 1;
--   IF ph.id IS NULL THEN RETURN NULL; END IF;
--   w := CASE WHEN jsonb_typeof(ph.challenge -> 'weekly') = 'object' THEN ph.challenge -> 'weekly' ELSE '{}'::jsonb END;
--   v_start := app_servicio.local_date(ph.started_at, s.workspace_id);
--   v_today := app_servicio.today_in(s.workspace_id);
--   SELECT COALESCE(jsonb_agg(jsonb_build_object(
--            'on', to_char(i.due_on - CASE m.recurrence ->> 'every' WHEN 'day' THEN 1 WHEN 'week' THEN 7 ELSE GREATEST(1, COALESCE((m.recurrence ->> 'n')::integer, 1)) END + 1, 'YYYY-MM-DD'),
--            'number', CASE WHEN w ->> 'number_field_key' IS NOT NULL AND (fs.answers ->> (w ->> 'number_field_key')) ~ '^\s*-?\d+(\.\d+)?\s*$'
--                           THEN to_jsonb((fs.answers ->> (w ->> 'number_field_key'))::numeric) END,
--            'link', CASE WHEN w ->> 'link_field_key' IS NOT NULL THEN fs.answers ->> (w ->> 'link_field_key') END,
--            'stuck', CASE WHEN w ->> 'stuck_field_key' IS NOT NULL THEN fs.answers ->> (w ->> 'stuck_field_key') END)
--            ORDER BY i.due_on), '[]'::jsonb)
--     INTO v_rows
--     FROM app_servicio.service_items i
--     JOIN app_servicio.service_items m ON m.id = i.parent_item_id
--     JOIN LATERAL (SELECT f.answers FROM public.form_submissions f
--                    WHERE f.service_item_id = i.id AND f.status = 'received' AND f.review_status IS DISTINCT FROM 'superseded'
--                    ORDER BY f.created_at DESC LIMIT 1) fs ON true
--    WHERE i.phase_id = ph.id AND i.parent_item_id IS NOT NULL AND i.due_on IS NOT NULL;
--   RETURN jsonb_build_object(
--     'phase_id', ph.id, 'phase_name', ph.name, 'status', ph.status, 'awaiting_start', ph.awaiting_start,
--     'started_on', to_char(v_start, 'YYYY-MM-DD'), 'days', ph.duration_days,
--     'accepted', ph.challenge -> 'accepted',
--     'start_by', to_char(app_servicio.svc_challenge_start_by(ph.challenge -> 'start_by', s.starts_on, app_servicio.local_date(s.created_at, s.workspace_id)), 'YYYY-MM-DD'),
--     'weekly', w,
--     'weeks', CASE WHEN v_start IS NULL THEN '[]'::jsonb ELSE app_servicio.svc_challenge_weeks_plan(jsonb_build_object(
--                'startOn', v_start, 'today', v_today, 'days', ph.duration_days, 'min', w -> 'min', 'video', COALESCE(w -> 'video', 'false'::jsonb), 'rows', v_rows)) END,
--     'rows', v_rows);
-- END;
-- $function$;


-- ─── 1. Columnas ─────────────────────────────────────────────────────────────
ALTER TABLE app_servicio.service_items ADD COLUMN IF NOT EXISTS round_on date;
ALTER TABLE app_servicio.service_items ADD COLUMN IF NOT EXISTS series_ended_at timestamptz;
ALTER TABLE app_servicio.service_items ADD COLUMN IF NOT EXISTS series_end_reason text;
ALTER TABLE app_servicio.service_items ADD COLUMN IF NOT EXISTS series_ended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE app_servicio.service_items ADD COLUMN IF NOT EXISTS series_end_note text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_items_series_end_reason_check') THEN
    ALTER TABLE app_servicio.service_items ADD CONSTRAINT service_items_series_end_reason_check
      CHECK (series_end_reason IS NULL OR series_end_reason IN ('manual', 'service_end', 'n_times'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_items_series_end_note_check') THEN
    ALTER TABLE app_servicio.service_items ADD CONSTRAINT service_items_series_end_note_check
      CHECK (series_end_note IS NULL OR char_length(series_end_note) <= 500);
  END IF;
END $$;
COMMENT ON COLUMN app_servicio.service_items.round_on IS 'El día de la vuelta (00522). En un paso que no se repite, NULL.';
COMMENT ON COLUMN app_servicio.service_items.series_ended_at IS 'En el paso que se repite: cuándo terminó su serie (00522). NULL = sigue.';

-- Las vueltas que ya existen: su día sale del paso (las cadencias viejas tienen paso fijo).
UPDATE app_servicio.service_items c
   SET round_on = c.due_on - CASE m.recurrence ->> 'every' WHEN 'day' THEN 1 WHEN 'week' THEN 7
                                  ELSE GREATEST(1, COALESCE(CASE WHEN app_servicio.j_int(m.recurrence -> 'n') THEN (m.recurrence ->> 'n')::integer END, 1)) END + 1
  FROM app_servicio.service_items m
 WHERE c.parent_item_id = m.id AND c.round_on IS NULL AND c.due_on IS NOT NULL
   AND COALESCE(m.recurrence ->> 'every', '') IN ('day', 'week', 'n_days');

-- ─── 2. Las fechas ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_occurrence_next(p_recurrence jsonb, p_start date, p_from date)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
-- La primera fecha de la serie que cae el día p_from o después (p_from >= p_start). Gemela de `nextOccurrence`
-- (lib/services/engine-rules.ts), con los casos de recurrence.cases.json.
DECLARE
  v_every text := p_recurrence ->> 'every';
  v_n integer := GREATEST(1, CASE WHEN app_servicio.j_int(p_recurrence -> 'n') THEN (p_recurrence ->> 'n')::integer ELSE 1 END);
  v_days integer[];
  v_want integer; v_first date; v_last integer; v_cand date; v_monday date; v_step integer; d date; k integer;
BEGIN
  IF v_every = 'month' THEN
    v_want := CASE WHEN app_servicio.j_int(p_recurrence -> 'day_of_month') AND app_servicio.j_num(p_recurrence -> 'day_of_month') BETWEEN 1 AND 31
                   THEN (p_recurrence ->> 'day_of_month')::integer ELSE extract(day FROM p_start)::integer END;
    -- El día pedido del mes (o el último, si el mes no lo tiene), empezando por el mes de p_from.
    FOR k IN 0 .. 2 LOOP
      v_first := (date_trunc('month', p_from::timestamp) + make_interval(months => k))::date;
      v_last := extract(day FROM (v_first + interval '1 month' - interval '1 day'))::integer;
      v_cand := v_first + (LEAST(v_want, v_last) - 1);
      IF v_cand >= p_from THEN RETURN v_cand; END IF;
    END LOOP;
    RETURN (p_from + interval '1 month')::date;
  END IF;
  IF jsonb_typeof(p_recurrence -> 'weekdays') = 'array' THEN
    SELECT array_agg(DISTINCT app_servicio.j_num(x)::integer) INTO v_days
      FROM jsonb_array_elements(p_recurrence -> 'weekdays') x
     WHERE app_servicio.j_int(x) AND app_servicio.j_num(x) BETWEEN 1 AND 7;
  END IF;
  IF v_every IN ('week', 'n_weeks') AND COALESCE(cardinality(v_days), 0) > 0 THEN
    IF v_every = 'week' THEN v_n := 1; END IF;
    -- Las semanas se cuentan desde el lunes de la semana en que empieza la serie.
    v_monday := p_start - (extract(isodow FROM p_start)::integer - 1);
    FOR k IN 0 .. 7 * v_n + 7 LOOP
      d := p_from + k;
      IF ((d - v_monday) / 7) % v_n = 0 AND extract(isodow FROM d)::integer = ANY (v_days) THEN RETURN d; END IF;
    END LOOP;
    RETURN p_from + 7 * v_n;
  END IF;
  v_step := CASE v_every WHEN 'day' THEN 1 WHEN 'week' THEN 7 WHEN 'n_weeks' THEN 7 * v_n ELSE v_n END;
  RETURN p_start + (GREATEST(0, ceil((p_from - p_start)::numeric / v_step))::integer * v_step);
END;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.svc_occurrence_dates(p_recurrence jsonb, p_start date, p_phase_end date, p_service_end date, p_upto date)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_limit date := CASE p_recurrence ->> 'until'
                    WHEN 'phase_end' THEN p_phase_end WHEN 'item_completed' THEN p_phase_end WHEN 'service_end' THEN p_service_end
                    WHEN 'n_days' THEN p_start + (GREATEST(1, COALESCE((p_recurrence ->> 'n_until')::integer, 1)) - 1) END;
  v_max integer := CASE WHEN p_recurrence ->> 'until' = 'n_times' THEN GREATEST(1, COALESCE((p_recurrence ->> 'n_until')::integer, 1)) ELSE 1000 END;
  v_out jsonb := '[]'::jsonb;
  v_day date;
  v_next date;
  k integer;
BEGIN
  IF p_start IS NULL THEN RETURN v_out; END IF;
  IF app_servicio.j_int(p_recurrence -> 'max_days') AND (p_recurrence ->> 'max_days')::integer >= 1 THEN
    v_limit := LEAST(v_limit, p_start + (p_recurrence ->> 'max_days')::integer - 1);
  END IF;
  -- 00522: las fechas salen de svc_occurrence_next (cada N semanas, cada mes, días de la semana); cada vuelta vence el
  -- día antes de la siguiente (con un paso fijo, igual que antes: occursOn + paso - 1).
  v_day := app_servicio.svc_occurrence_next(p_recurrence, p_start, p_start);
  FOR k IN 0 .. v_max - 1 LOOP
    EXIT WHEN v_limit IS NOT NULL AND v_day > v_limit;
    EXIT WHEN v_day > p_upto;
    v_next := app_servicio.svc_occurrence_next(p_recurrence, p_start, v_day + 1);
    v_out := v_out || jsonb_build_array(jsonb_build_object('index', k + 1, 'occursOn', to_char(v_day, 'YYYY-MM-DD'),
                                                           'dueOn', to_char(v_next - 1, 'YYYY-MM-DD')));
    v_day := v_next;
  END LOOP;
  RETURN v_out;
END;
$function$;

-- ─── 3. La regla del editor ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.journey_recurrence_problems(p_item jsonb, p_nm text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  r jsonb := p_item -> 'recurrence';
  f jsonb;
  l jsonb := p_item -> 'late';
BEGIN
  IF r IS NOT NULL AND jsonb_typeof(r) <> 'null' THEN
    IF jsonb_typeof(r) <> 'object' THEN
      v := v || format('«%s»: la repetición no es válida', p_nm);
    ELSE
      IF NOT COALESCE(r ->> 'every' = ANY (ARRAY['day','week','n_weeks','month','n_days']), false) THEN v := v || format('«%s»: elegí cada cuánto se repite', p_nm); END IF;
      IF r ->> 'every' = 'n_days' AND NOT (app_servicio.j_int(r -> 'n') AND app_servicio.j_num(r -> 'n') BETWEEN 1 AND 365) THEN
        v := v || format('«%s»: elegí cada cuántos días se repite', p_nm);
      END IF;
      -- 00522 (traído de RER #70): cada N semanas, cada mes y los días de la semana.
      IF r ->> 'every' = 'n_weeks' AND NOT (app_servicio.j_int(r -> 'n') AND app_servicio.j_num(r -> 'n') BETWEEN 1 AND 52) THEN
        v := v || format('«%s»: elegí cada cuántas semanas se repite', p_nm);
      END IF;
      IF r ? 'weekdays' AND jsonb_typeof(r -> 'weekdays') <> 'null'
         AND (CASE WHEN r ->> 'every' IN ('week','n_weeks') AND jsonb_typeof(r -> 'weekdays') = 'array'
                   THEN jsonb_array_length(r -> 'weekdays') BETWEEN 1 AND 7
                        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'weekdays') x
                                         WHERE NOT (app_servicio.j_int(x) AND app_servicio.j_num(x) BETWEEN 1 AND 7))
                        AND (SELECT count(DISTINCT app_servicio.j_num(x)) FROM jsonb_array_elements(r -> 'weekdays') x) = jsonb_array_length(r -> 'weekdays')
                   ELSE false END) IS NOT TRUE THEN
        v := v || format('«%s»: los días de la semana no son válidos', p_nm);
      END IF;
      IF r ? 'day_of_month' AND jsonb_typeof(r -> 'day_of_month') <> 'null'
         AND (r ->> 'every' = 'month' AND app_servicio.j_int(r -> 'day_of_month') AND app_servicio.j_num(r -> 'day_of_month') BETWEEN 1 AND 31) IS NOT TRUE THEN
        v := v || format('«%s»: el día del mes no es válido', p_nm);
      END IF;
      IF NOT COALESCE(r ->> 'until' = ANY (ARRAY['phase_end','service_end','n_days','n_times','item_completed']), false) THEN v := v || format('«%s»: elegí hasta cuándo se repite', p_nm); END IF;
      IF r ->> 'until' IN ('n_days','n_times') AND NOT (app_servicio.j_int(r -> 'n_until') AND app_servicio.j_num(r -> 'n_until') BETWEEN 1 AND 1000) THEN
        v := v || format('«%s»: elegí cuántas veces o días', p_nm);
      END IF;
      IF r ->> 'until' = 'item_completed' AND (jsonb_typeof(r -> 'item_key') = 'string' AND (r ->> 'item_key') ~ '^it_[a-z0-9]{6}$') IS NOT TRUE THEN
        v := v || format('«%s»: elegí el paso que corta la repetición', p_nm);
      END IF;
      IF r ? 'phase_key' AND jsonb_typeof(r -> 'phase_key') <> 'null'
         AND (r ->> 'until' = 'phase_end' AND jsonb_typeof(r -> 'phase_key') = 'string' AND (r ->> 'phase_key') ~ '^ph_[a-z0-9]{6}$') IS NOT TRUE THEN
        v := v || format('«%s»: la fase no es válida', p_nm);
      END IF;
      IF r ? 'max_days' AND jsonb_typeof(r -> 'max_days') <> 'null' AND NOT (app_servicio.j_int(r -> 'max_days') AND app_servicio.j_num(r -> 'max_days') BETWEEN 1 AND 1000) THEN
        v := v || format('«%s»: el tope de días va de 1 a 1000', p_nm);
      END IF;
      IF r ? 'from' AND jsonb_typeof(r -> 'from') <> 'null' THEN
        f := r -> 'from';
        IF (CASE WHEN jsonb_typeof(f) = 'object' THEN
                  COALESCE(f ->> 'from' = ANY (ARRAY['service_created','service_start','phase_start','phase_end','item_completed']), false)
                  AND app_servicio.j_int(f -> 'days') AND app_servicio.j_num(f -> 'days') BETWEEN 0 AND 3650
                  AND (CASE WHEN f ->> 'from' = 'item_completed'
                            THEN jsonb_typeof(f -> 'item_key') = 'string' AND (f ->> 'item_key') ~ '^it_[a-z0-9]{6}$'
                            ELSE NOT (f ? 'item_key') OR jsonb_typeof(f -> 'item_key') = 'null' END)
                  AND (NOT (f ? 'phase_key') OR jsonb_typeof(f -> 'phase_key') = 'null'
                       OR (f ->> 'from' IN ('phase_start','phase_end') AND jsonb_typeof(f -> 'phase_key') = 'string' AND (f ->> 'phase_key') ~ '^ph_[a-z0-9]{6}$'))
                ELSE false END) IS NOT TRUE THEN
          v := v || format('«%s»: elegí desde cuándo se repite', p_nm);
        END IF;
      END IF;
    END IF;
  END IF;
  IF l IS NOT NULL AND jsonb_typeof(l) <> 'null' THEN
    IF (CASE WHEN jsonb_typeof(l) = 'object' THEN
              NOT (l ? 'accept' AND jsonb_typeof(l -> 'accept') <> 'boolean')
              AND NOT (l ? 'early' AND jsonb_typeof(l -> 'early') <> 'boolean')
              AND NOT (l ? 'grace_hours' AND jsonb_typeof(l -> 'grace_hours') <> 'null' AND NOT (app_servicio.j_int(l -> 'grace_hours') AND app_servicio.j_num(l -> 'grace_hours') BETWEEN 0 AND 168))
              AND NOT (l ? 'grace_days' AND jsonb_typeof(l -> 'grace_days') <> 'null' AND NOT (app_servicio.j_int(l -> 'grace_days') AND app_servicio.j_num(l -> 'grace_days') BETWEEN 0 AND 365))
            ELSE false END) IS NOT TRUE THEN
      v := v || format('«%s»: el atraso no es válido', p_nm);
    END IF;
  END IF;
  RETURN v;
END;
$function$;

-- ─── 4. «Después de N vueltas» ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_series_reached(p_recurrence jsonb, p_completed integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  -- «Después de N vueltas»: cuenta las vueltas CUMPLIDAS, no las creadas (00522, como RER #70). Gemela de
  -- `seriesReached` (lib/services/repetition.ts), con los casos de repetition.cases.json.
  SELECT COALESCE(p_recurrence ->> 'until' = 'n_times', false)
     AND COALESCE(p_completed, 0) >= GREATEST(1, CASE WHEN app_servicio.j_int(p_recurrence -> 'n_until') THEN (p_recurrence ->> 'n_until')::integer ELSE 1 END);
$function$;

-- ─── 5 a 7. El motor ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_generate_occurrences(p_service_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  m app_servicio.service_items;
  ph app_servicio.service_phases;
  v_tz text; v_student_tz text; v_today date; v_start date; v_until date; v_phase_start date;
  v_occ jsonb; o jsonb; v_created integer := 0; v_new uuid;
  v_grace integer;
  v_phases jsonb; v_items jsonb; v_win jsonb;
  v_rec jsonb; v_done integer;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR s.status <> 'active' OR NOT app_servicio.module_on(s.workspace_id) THEN RETURN 0; END IF;
  v_tz := app_servicio.ws_tz(s.workspace_id);
  SELECT COALESCE(NULLIF(c.timezone, ''), v_tz) INTO v_student_tz FROM public.contacts c WHERE c.id = s.contact_id;
  v_student_tz := COALESCE(v_student_tz, v_tz);
  v_today := (now() AT TIME ZONE v_student_tz)::date;
  SELECT COALESCE(jsonb_object_agg(p.template_key, jsonb_build_object(
           'start', to_char(app_servicio.local_date(p.started_at, s.workspace_id), 'YYYY-MM-DD'),
           'end', to_char(app_servicio.local_date(p.completed_at, s.workspace_id), 'YYYY-MM-DD'))), '{}'::jsonb)
    INTO v_phases FROM app_servicio.service_phases p WHERE p.service_id = s.id AND p.template_key IS NOT NULL;
  SELECT COALESCE(jsonb_object_agg(i.template_key, to_char(app_servicio.local_date(i.completed_at, s.workspace_id), 'YYYY-MM-DD')), '{}'::jsonb)
    INTO v_items FROM app_servicio.service_items i
   WHERE i.service_id = s.id AND i.parent_item_id IS NULL AND NOT i.is_recurring_template AND i.template_key IS NOT NULL;
  FOR m IN SELECT i.* FROM app_servicio.service_items i JOIN app_servicio.service_phases p ON p.id = i.phase_id
            WHERE i.service_id = p_service_id AND i.is_recurring_template AND p.status = 'in_progress'
              -- 00522: una serie terminada (a mano, por el fin del servicio o por sus N vueltas) ya no crea vueltas.
              AND i.series_ended_at IS NULL LOOP
    SELECT * INTO ph FROM app_servicio.service_phases WHERE id = m.phase_id;
    v_phase_start := app_servicio.local_date(ph.started_at, s.workspace_id);
    v_win := app_servicio.svc_recurrence_window(m.recurrence, jsonb_build_object(
      'serviceCreated', app_servicio.local_date(s.created_at, s.workspace_id), 'serviceStart', s.starts_on, 'serviceEnd', s.ends_on,
      'phaseStart', v_phase_start, 'phaseEnd', CASE WHEN ph.duration_days IS NOT NULL THEN v_phase_start + ph.duration_days - 1 END,
      'phases', v_phases, 'items', v_items));
    v_start := (v_win ->> 'start')::date;
    CONTINUE WHEN v_start IS NULL;
    v_until := (v_win ->> 'until')::date;
    -- 00522: «después de N vueltas» cuenta las cumplidas. Al llegar a N, la serie termina; mientras tanto se siguen
    -- creando vueltas en sus fechas (las que no se cumplieron no cuentan).
    v_rec := m.recurrence;
    IF m.recurrence ->> 'until' = 'n_times' THEN
      SELECT count(*) INTO v_done FROM app_servicio.service_items c WHERE c.parent_item_id = m.id AND c.status = 'completed';
      IF app_servicio.svc_series_reached(m.recurrence, v_done) THEN
        UPDATE app_servicio.service_items SET series_ended_at = now(), series_end_reason = 'n_times' WHERE id = m.id AND series_ended_at IS NULL;
        CONTINUE;
      END IF;
      v_rec := jsonb_set(m.recurrence, '{n_until}', '1000'::jsonb);
    END IF;
    v_occ := app_servicio.svc_occurrence_dates(v_rec, v_start, v_until, v_until, v_today);
    v_grace := COALESCE((m.late ->> 'grace_hours')::integer, 0);
    FOR o IN SELECT x FROM jsonb_array_elements(v_occ) x LOOP
      CONTINUE WHEN v_phase_start IS NOT NULL AND (o ->> 'occursOn')::date < v_phase_start;
      INSERT INTO app_servicio.service_items (workspace_id, service_id, phase_id, template_key, kind, name, description, required, assignee,
        assignee_user_id, visible_to_client, portal_button, ref, late, reminders, parent_item_id, occurrence_index, position,
        yellow_after_days, red_after_days, due_on, due_at, round_on)
      VALUES (s.workspace_id, s.id, m.phase_id, m.template_key, m.kind, m.name, m.description, m.required, m.assignee,
        m.assignee_user_id, m.visible_to_client, m.portal_button, m.ref, m.late, m.reminders, m.id, (o ->> 'index')::integer,
        m.position, m.yellow_after_days, m.red_after_days, (o ->> 'dueOn')::date,
        app_servicio.end_of_day((o ->> 'dueOn')::date, v_student_tz) + make_interval(hours => v_grace), (o ->> 'occursOn')::date)
      ON CONFLICT (parent_item_id, occurrence_index) WHERE parent_item_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_new;
      IF v_new IS NOT NULL THEN
        v_created := v_created + 1;
        PERFORM app_servicio.svc_ensure_task(v_new);
        v_new := NULL;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_created;
END;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.svc_ensure_task(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  v_owner uuid;
  v_task uuid;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR it.kind <> 'team_task' OR it.task_id IS NOT NULL OR it.status = 'completed' OR it.is_recurring_template THEN RETURN; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  v_owner := CASE it.assignee WHEN 'user' THEN it.assignee_user_id ELSE s.owner_user_id END;
  -- A4 (F148, F152): la tarea nace con su servicio y con los puntos del checklist del paso, sin tildar.
  INSERT INTO public.tasks (workspace_id, title, description, status, priority, due_date, owner_id, contact_id, source, source_ref, created_by,
                            service_id, checklist)
  VALUES (s.workspace_id,
          -- 00522: la tarea de una vuelta dice cuál es («… · vuelta 3»).
          left(it.name || CASE WHEN it.parent_item_id IS NOT NULL AND it.occurrence_index IS NOT NULL THEN ' · vuelta ' || it.occurrence_index ELSE '' END, 200),
          it.description, 'pending', 'normal',
          COALESCE(it.due_on, app_servicio.local_date(it.due_at, s.workspace_id)), v_owner, s.contact_id, 'cx', 'svc_item:' || it.id::text, NULL,
          s.id,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'text', left(btrim(c #>> '{}'), 200), 'done', false) ORDER BY o)
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(it.ref -> 'checklist') = 'array' THEN it.ref -> 'checklist' ELSE '[]'::jsonb END)
                           WITH ORDINALITY AS t(c, o)
                     WHERE jsonb_typeof(c) = 'string' AND btrim(c #>> '{}') <> '' AND o <= 30), '[]'::jsonb))
  RETURNING id INTO v_task;
  UPDATE app_servicio.service_items SET task_id = v_task WHERE id = it.id;
  IF v_owner IS NOT NULL THEN
    PERFORM app_servicio.notify(s.workspace_id, v_owner, 'task_assigned', 'Tenés una tarea nueva', it.name, 'task', v_task,
                                jsonb_build_object('service_id', s.id));
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.svc_mark_item(p_item_id uuid, p_source text, p_by_kind text, p_by uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  ph app_servicio.service_phases;
  d record;
  v_rec jsonb; v_step integer; v_tz text; v_plan jsonb;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR it.status = 'completed' OR it.is_recurring_template THEN RETURN false; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = it.phase_id;
  IF p_source = 'automation' THEN
    PERFORM app_servicio.svc_assert_completable(it.id);
  ELSIF p_by_kind = 'client' OR p_source = 'call' THEN
    BEGIN
      IF (app_servicio.svc_item_lock_state(it.id) ->> 'locked')::boolean THEN
        PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.item_completed_while_locked',
          jsonb_build_object('service_id', s.id, 'item_key', it.template_key, 'source', p_source), 'system');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'svc_mark_item: no pude anotar el bloqueo: %', SQLERRM;
    END;
  END IF;
  IF p_by_kind = 'client' AND it.parent_item_id IS NOT NULL AND jsonb_typeof(it.late) = 'object' AND it.due_on IS NOT NULL THEN
    SELECT i.recurrence INTO v_rec FROM app_servicio.service_items i WHERE i.id = it.parent_item_id;
    v_step := CASE v_rec ->> 'every' WHEN 'day' THEN 1 WHEN 'week' THEN 7 ELSE GREATEST(1, COALESCE((v_rec ->> 'n')::integer, 1)) END;
    SELECT NULLIF(c.timezone, '') INTO v_tz FROM public.contacts c WHERE c.id = s.contact_id;
    v_tz := COALESCE(v_tz, app_servicio.ws_tz(s.workspace_id));
    -- 00522: el día de la vuelta se guarda (`round_on`); el cálculo por el paso queda para las vueltas viejas.
    v_plan := app_servicio.svc_late_plan(it.late, COALESCE(it.round_on, it.due_on - v_step + 1), it.due_on, (now() AT TIME ZONE v_tz));
    IF NOT (v_plan ->> 'ok')::boolean THEN
      RAISE EXCEPTION '%', v_plan ->> 'message' USING ERRCODE = v_plan ->> 'code';
    END IF;
  END IF;
  UPDATE app_servicio.service_items
     SET status = 'completed', completed_at = now(), completed_by_kind = p_by_kind, completed_by = p_by, completed_source = p_source
   WHERE id = it.id;
  IF it.task_id IS NOT NULL THEN
    UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = it.task_id AND status <> 'completed';
  END IF;
  FOR d IN SELECT o.id FROM app_servicio.service_items o
            WHERE o.service_id = it.service_id AND o.status = 'pending' AND o.due_rule ->> 'from' = 'item_completed'
              AND o.due_rule ->> 'item_key' = it.template_key LOOP
    PERFORM app_servicio.svc_compute_due(d.id);
  END LOOP;
  PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.item_completed',
    jsonb_build_object('service_id', s.id, 'item_key', it.template_key, 'source', p_source), CASE p_by_kind WHEN 'client' THEN 'client' WHEN 'user' THEN 'user' ELSE 'system' END);
  PERFORM app_servicio.emit(s, 'service_item_completed', jsonb_build_object('phase_key', ph.template_key, 'item_key', it.template_key, 'item_kind', it.kind));
  IF ph.status = 'in_progress' THEN
    PERFORM app_servicio.svc_check_open_items(ph.id);
    PERFORM app_servicio.svc_try_advance_phase(s.id);
  END IF;
  PERFORM app_servicio.svc_compute_light(s.id);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.svc_challenge_view(p_service_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
  ph app_servicio.service_phases;
  w jsonb; v_start date; v_rows jsonb; v_today date;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT app_servicio.can_see_service_row(s) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  SELECT * INTO ph FROM app_servicio.service_phases
   WHERE service_id = s.id AND challenge -> 'enabled' = 'true'::jsonb ORDER BY position LIMIT 1;
  IF ph.id IS NULL THEN RETURN NULL; END IF;
  w := CASE WHEN jsonb_typeof(ph.challenge -> 'weekly') = 'object' THEN ph.challenge -> 'weekly' ELSE '{}'::jsonb END;
  v_start := app_servicio.local_date(ph.started_at, s.workspace_id);
  v_today := app_servicio.today_in(s.workspace_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'on', to_char(COALESCE(i.round_on, i.due_on - CASE m.recurrence ->> 'every' WHEN 'day' THEN 1 WHEN 'week' THEN 7 ELSE GREATEST(1, COALESCE((m.recurrence ->> 'n')::integer, 1)) END + 1), 'YYYY-MM-DD'),
           'number', CASE WHEN w ->> 'number_field_key' IS NOT NULL AND (fs.answers ->> (w ->> 'number_field_key')) ~ '^\s*-?\d+(\.\d+)?\s*$'
                          THEN to_jsonb((fs.answers ->> (w ->> 'number_field_key'))::numeric) END,
           'link', CASE WHEN w ->> 'link_field_key' IS NOT NULL THEN fs.answers ->> (w ->> 'link_field_key') END,
           'stuck', CASE WHEN w ->> 'stuck_field_key' IS NOT NULL THEN fs.answers ->> (w ->> 'stuck_field_key') END)
           ORDER BY i.due_on), '[]'::jsonb)
    INTO v_rows
    FROM app_servicio.service_items i
    JOIN app_servicio.service_items m ON m.id = i.parent_item_id
    JOIN LATERAL (SELECT f.answers FROM public.form_submissions f
                   WHERE f.service_item_id = i.id AND f.status = 'received' AND f.review_status IS DISTINCT FROM 'superseded'
                   ORDER BY f.created_at DESC LIMIT 1) fs ON true
   WHERE i.phase_id = ph.id AND i.parent_item_id IS NOT NULL AND i.due_on IS NOT NULL;
  RETURN jsonb_build_object(
    'phase_id', ph.id, 'phase_name', ph.name, 'status', ph.status, 'awaiting_start', ph.awaiting_start,
    'started_on', to_char(v_start, 'YYYY-MM-DD'), 'days', ph.duration_days,
    'accepted', ph.challenge -> 'accepted',
    'start_by', to_char(app_servicio.svc_challenge_start_by(ph.challenge -> 'start_by', s.starts_on, app_servicio.local_date(s.created_at, s.workspace_id)), 'YYYY-MM-DD'),
    'weekly', w,
    'weeks', CASE WHEN v_start IS NULL THEN '[]'::jsonb ELSE app_servicio.svc_challenge_weeks_plan(jsonb_build_object(
               'startOn', v_start, 'today', v_today, 'days', ph.duration_days, 'min', w -> 'min', 'video', COALESCE(w -> 'video', 'false'::jsonb), 'rows', v_rows)) END,
    'rows', v_rows);
END;
$function$;

-- ─── 8. Terminar o cambiar la serie de un paso en un servicio ────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_end_series(p_item_id uuid, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Termina la serie de un paso que se repite: no se crean más vueltas. Las que ya existen quedan como están (se
-- cumplen o se dejan). Pide `services.items` y ver el servicio (require_service).
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR NOT it.is_recurring_template THEN
    RAISE EXCEPTION 'Este paso no se repite' USING ERRCODE = 'SV044';
  END IF;
  s := app_servicio.svc_get(it.service_id, true);
  PERFORM app_servicio.require_service(s, 'services.items');
  IF it.series_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta serie ya terminó' USING ERRCODE = 'SV044';
  END IF;
  UPDATE app_servicio.service_items
     SET series_ended_at = now(), series_end_reason = 'manual', series_ended_by = auth.uid(),
         series_end_note = NULLIF(left(btrim(COALESCE(p_note, '')), 500), '')
   WHERE id = it.id;
  PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.series_ended',
    jsonb_build_object('service_id', s.id, 'item_key', it.template_key, 'reason', 'manual'));
  RETURN jsonb_build_object('ended', true);
END;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.svc_set_item_series(p_item_id uuid, p_recurrence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Cambia cada cuánto y hasta cuándo se repite un paso en ESTE servicio (la plantilla de la variante no cambia). Las
-- vueltas que ya existen no se tocan; las que vienen siguen la regla nueva. Pide `services.items`.
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  v_problems text[];
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR NOT it.is_recurring_template THEN
    RAISE EXCEPTION 'Este paso no se repite' USING ERRCODE = 'SV044';
  END IF;
  s := app_servicio.svc_get(it.service_id, true);
  PERFORM app_servicio.require_service(s, 'services.items');
  IF it.series_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta serie ya terminó' USING ERRCODE = 'SV044';
  END IF;
  IF p_recurrence IS NULL OR jsonb_typeof(p_recurrence) <> 'object' THEN
    RAISE EXCEPTION 'Elegí cada cuánto se repite' USING ERRCODE = 'SV045';
  END IF;
  v_problems := app_servicio.journey_recurrence_problems(jsonb_build_object('recurrence', p_recurrence), COALESCE(it.name, 'el paso'));
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION '%', v_problems[1] USING ERRCODE = 'SV045';
  END IF;
  UPDATE app_servicio.service_items SET recurrence = p_recurrence WHERE id = it.id;
  PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.series_changed',
    jsonb_build_object('service_id', s.id, 'item_key', it.template_key, 'recurrence', jsonb_build_object('old', it.recurrence, 'new', p_recurrence)));
  PERFORM app_servicio.svc_generate_occurrences(s.id);
  RETURN jsonb_build_object('changed', true);
END;
$function$;

-- ─── 9. Al terminar el servicio, sus series terminan ─────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.services_end_series_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('cancelled', 'completed', 'renewed') THEN RETURN NULL; END IF;
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    UPDATE app_servicio.service_items
       SET series_ended_at = now(), series_end_reason = 'service_end'
     WHERE service_id = NEW.id AND is_recurring_template AND series_ended_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'services_end_series', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_app_servicio_end_series ON app_servicio.services;
CREATE TRIGGER trg_app_servicio_end_series
  AFTER UPDATE OF status ON app_servicio.services
  FOR EACH ROW EXECUTE FUNCTION app_servicio.services_end_series_hook();

-- ─── Permisos ────────────────────────────────────────────────────────────────
-- Las funciones reescritas conservan sus permisos (CREATE OR REPLACE no los cambia). Las nuevas:
REVOKE ALL ON FUNCTION app_servicio.svc_occurrence_next(jsonb, date, date), app_servicio.svc_series_reached(jsonb, integer),
  app_servicio.svc_end_series(uuid, text), app_servicio.svc_set_item_series(uuid, jsonb), app_servicio.services_end_series_hook()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.svc_occurrence_next(jsonb, date, date), app_servicio.svc_series_reached(jsonb, integer),
  app_servicio.svc_end_series(uuid, text), app_servicio.svc_set_item_series(uuid, jsonb)
TO authenticated, service_role;
