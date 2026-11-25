-- 00524 · Reuniones del camino que se repiten: la serie que fija el responsable en su Google Calendar y el estado de
-- cada vuelta (25/11/2026, traído de RER #71 y adaptado a SSA; va encima de la 00522).
--
-- Un paso de Reunión que se repite elige cómo se agenda (`ref.schedule`):
--   · `team` (o nada): cada vuelta crea la tarea «Agendar [tipo] con [cliente] · vuelta N». La tarea se cierra sola
--     cuando la reunión queda agendada (y vuelve a abrirse si se cancela).
--   · `series`: cuando la serie tendría que empezar, quien atiende recibe «Fijar reuniones recurrentes con [cliente]».
--     Elige el primer día y la hora y la app crea UN evento que se repite en su Google Calendar (con Meet e invitación
--     al cliente). Cada fecha del evento pasa a ser una reunión de la plataforma (hasta 60 días por delante, barrido
--     diario) unida a su vuelta. Nada se agenda solo: una persona elige siempre el día y la hora.
-- Las reuniones de una serie se guardan como las «traídas de Google» de la 00510 (`metadata.google_import`, con la
-- fecha del evento): la sincronización nunca crea otro evento, mover una mueve esa fecha en Google y no dispara «Se
-- agendó una reunión» (Google ya mandó la invitación). Además llevan `metadata.series_id`. `bookings` no cambia.
--
-- Estados de una vuelta de Reunión (`service_items.round_state`): por agendar, agendada, asistida, no se presentó y
-- perdida. Una vuelta se cumple SOLO al asistir; «perdida» la cierra sin contar para «N vueltas».
--
-- ADITIVA (va ANTES del deploy del PR 2; después de la 00522):
--  1. `app_servicio.meeting_series` (sin `contact_id`: la fusión no la toca). La lee quien ve el servicio
--     (`rls_visible_service_ids`, 00523); escribe solo el servidor.
--  2. `service_items.booking_id` (la reunión de la vuelta) y `round_state`.
--  3. `booking_hook`: una reunión nueva se une a la vuelta pendiente MÁS ANTIGUA de su paso (nunca al molde: antes el
--     molde de un paso que se repite podía ganar y la reunión no completaba nada). Lo que no es una vuelta sigue igual.
--  4. `svc_generate_occurrences`, `svc_ensure_task` y `svc_end_series` (de la 00522) con lo de las reuniones.
--  5. `journey_item_ref_problems` acepta `ref.schedule` (gemela `refProblems`, journey-template.cases.json).
--  6. Funciones nuevas: `svc_client_label`, `booking_round_candidate`, `svc_series_request_fix`, `svc_end_meeting_series`
--     y `svc_round_mark` (con la sesión y `services.items`). Una fecha borrada en Google la cancela el lector de Google
--     (`cancelBooking` con `fromGoogle`) y el enganche devuelve la vuelta a «por agendar».
--  7. Triggers: al pausar, terminar o cambiar el responsable se corta la serie; mover una reunión mueve su vuelta.
--
-- Volver atrás: recrear las cinco funciones de abajo con su definición vieja; DROP de las funciones y triggers nuevos;
-- DROP TABLE app_servicio.meeting_series; borrar `service_items.booking_id` y `round_state`.
--
-- ════ Definiciones vigentes antes de la 00524, letra por letra ════
--
-- ---- app_servicio.booking_hook ----
-- CREATE OR REPLACE FUNCTION app_servicio.booking_hook()
--  RETURNS trigger
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   -- `record` y no el tipo de la tabla del modulo: un tipo se resuelve al ENTRAR a la funcion, antes del bloque que
--   -- atrapa los errores, y un problema con la tabla haria fallar la operacion de BAIOS (verify-services, sv2).
--   v_when text;
--   it record;
--   v_count integer;
--   v_signed uuid;
--   v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
-- BEGIN
--   IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
--   BEGIN
--     PERFORM app_servicio.as_system();
--     IF NEW.contact_id IS NULL OR NEW.status LIKE 'cancelled%' THEN
--       PERFORM set_config('app_servicio.system', v_prev_system, true);
--       RETURN NULL;
--     END IF;
--     -- booked: al agendar. attended: al pasar a un resultado (status_group = outcome).
--     v_when := CASE WHEN TG_OP = 'INSERT' THEN 'booked'
--                    WHEN NEW.status_group = 'outcome' AND OLD.status_group IS DISTINCT FROM 'outcome' THEN 'attended' END;
--     IF v_when IS NOT NULL THEN
--       -- El paso que viene en el link de la agenda, solo si es del mismo contacto.
--       IF (NEW.utm ->> 'svc_item') ~* '^[0-9a-f-]{36}$' THEN
--         SELECT i.id INTO v_signed FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
--          WHERE i.id = (NEW.utm ->> 'svc_item')::uuid AND s.contact_id = NEW.contact_id AND s.workspace_id = NEW.workspace_id;
--       END IF;
--       SELECT count(DISTINCT i.service_id) INTO v_count
--         FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
--        WHERE s.workspace_id = NEW.workspace_id AND s.contact_id = NEW.contact_id AND s.status = 'active' AND i.status = 'pending'
--          AND i.kind = 'booking' AND i.ref ->> 'event_type_id' = NEW.event_type_id::text AND COALESCE(i.ref ->> 'complete_on', 'booked') = v_when
--          AND ph.status <> 'completed' AND (v_signed IS NULL OR i.id = v_signed);
--       IF v_count > 0 THEN
--         SELECT i.* INTO it
--           FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
--          WHERE s.workspace_id = NEW.workspace_id AND s.contact_id = NEW.contact_id AND s.status = 'active' AND i.status = 'pending'
--            AND i.kind = 'booking' AND i.ref ->> 'event_type_id' = NEW.event_type_id::text AND COALESCE(i.ref ->> 'complete_on', 'booked') = v_when
--            AND ph.status <> 'completed' AND (v_signed IS NULL OR i.id = v_signed)
--          ORDER BY s.created_at, (ph.status = 'in_progress') DESC, ph.position, i.position LIMIT 1;
--         IF v_count > 1 THEN
--           PERFORM app_servicio.audit(NEW.workspace_id, 'service_item', it.id, 'svc.item_ambiguous',
--             jsonb_build_object('service_id', it.service_id, 'event_type_id', NEW.event_type_id, 'services', v_count), 'system');
--         END IF;
--         PERFORM app_servicio.svc_mark_item(it.id, 'booking_' || v_when, 'client', NULL);
--       END IF;
--     END IF;
--   EXCEPTION WHEN OTHERS THEN
--     PERFORM app_servicio.hook_failed(NEW.workspace_id, 'booking', SQLSTATE || ' ' || SQLERRM, NEW.id);
--   END;
--   PERFORM set_config('app_servicio.system', v_prev_system, true);
--   RETURN NULL;
-- END;
-- $function$;
--
-- ---- app_servicio.journey_item_ref_problems ----
-- CREATE OR REPLACE FUNCTION app_servicio.journey_item_ref_problems(p_item jsonb, p_nm text, p_ws uuid, p_product uuid)
--  RETURNS text[]
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v text[] := ARRAY[]::text[];
--   v_kind text := p_item ->> 'kind';
--   v_ref jsonb := CASE WHEN jsonb_typeof(p_item -> 'ref') = 'object' THEN p_item -> 'ref' ELSE '{}'::jsonb END;
--   v_co text := v_ref ->> 'complete_on';
--   v_form jsonb;
--   v_want text;
--   v_grading boolean;
--   v_ok boolean;
--   v_link_kind boolean := v_kind = ANY (ARRAY['team_task','student_task','checkbox']);
--   v_btn jsonb;
--   v_label jsonb;
--   v_url jsonb;
--   v_url_ok boolean := false;
--   v_url_bad boolean := false;
--   v_lock jsonb;
--   v_ev jsonb;
--   v_tpls jsonb;
-- BEGIN
--   IF v_kind = ANY (ARRAY['form','survey','contract','activity','quiz']) THEN
--     IF NOT app_servicio.j_uuid(v_ref -> 'form_id') THEN
--       v := v || format('«%s»: elegí el formulario', p_nm);
--     ELSE
--       IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (CASE v_kind
--           WHEN 'form' THEN ARRAY['submitted','reviewed'] WHEN 'survey' THEN ARRAY['submitted','reviewed']
--           WHEN 'contract' THEN ARRAY['submitted'] WHEN 'activity' THEN ARRAY['submitted','reviewed','passed']
--           ELSE ARRAY['passed','finished'] END), false) THEN
--         v := v || format('«%s»: elegí cuándo se completa', p_nm);
--       END IF;
--       IF p_ws IS NOT NULL THEN
--         SELECT to_jsonb(f) INTO v_form FROM public.forms f WHERE f.id = (v_ref ->> 'form_id')::uuid AND f.workspace_id = p_ws;
--         IF v_form IS NULL THEN
--           v := v || format('«%s»: el formulario no existe', p_nm);
--         ELSE
--           v_want := CASE v_kind WHEN 'form' THEN 'custom' ELSE v_kind END;
--           IF v_form ->> 'type' IS DISTINCT FROM v_want THEN v := v || format('«%s»: el formulario no es del tipo del paso', p_nm); END IF;
--           IF v_kind IN ('quiz','activity') AND p_product IS NOT NULL AND (v_form ->> 'product_id') IS DISTINCT FROM p_product::text THEN
--             v := v || CASE v_kind WHEN 'quiz' THEN 'la evaluación tiene que ser de este programa' ELSE 'la actividad tiene que ser de este programa' END;
--           END IF;
--           IF v_kind = 'activity' AND v_co = 'passed' THEN
--             SELECT COALESCE((fv.definition #>> '{grading,enabled}')::boolean, false) INTO v_grading
--               FROM public.form_versions fv WHERE fv.id = (v_form ->> 'current_version_id')::uuid;
--             IF NOT COALESCE(v_grading, false) THEN v := v || format('«%s»: «al aprobar» necesita una actividad con calificación', p_nm); END IF;
--           END IF;
--         END IF;
--       END IF;
--     END IF;
--   ELSIF v_kind = 'booking' THEN
--     IF NOT app_servicio.j_uuid(v_ref -> 'event_type_id') THEN
--       v := v || format('«%s»: elegí el tipo de reunión', p_nm);
--     ELSIF p_ws IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.event_types e WHERE e.id = (v_ref ->> 'event_type_id')::uuid AND e.workspace_id = p_ws) THEN
--       v := v || format('«%s»: el tipo de reunión no existe', p_nm);
--     END IF;
--     IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (ARRAY['booked','attended','recorded']), false) THEN v := v || format('«%s»: elegí cuándo se completa', p_nm); END IF;
--   ELSIF v_kind IN ('program_item','open_module') THEN
--     IF NOT app_servicio.j_uuid(v_ref -> 'program_item_id') THEN
--       v := v || format('«%s»: elegí el módulo o la clase', p_nm);
--     ELSIF p_product IS NOT NULL THEN
--       v_ok := false;
--       IF to_regclass('app_servicio.program_items') IS NOT NULL THEN
--         EXECUTE 'SELECT EXISTS (SELECT 1 FROM app_servicio.program_items WHERE id = $1 AND product_id = $2)'
--           INTO v_ok USING (v_ref ->> 'program_item_id')::uuid, p_product;
--       END IF;
--       IF NOT v_ok THEN v := v || format('«%s»: el módulo o la clase no es de este programa', p_nm); END IF;
--     END IF;
--   ELSIF v_kind = 'certificate' THEN
--     IF v_ref ? 'templates' THEN
--       v_tpls := v_ref -> 'templates';
--       IF NOT (CASE WHEN jsonb_typeof(v_tpls) = 'array' AND jsonb_array_length(v_tpls) BETWEEN 2 AND 5 THEN NOT EXISTS (
--             SELECT 1 FROM jsonb_array_elements(v_tpls) WITH ORDINALITY AS t(c, o)
--              WHERE (CASE WHEN jsonb_typeof(c) = 'object' AND app_servicio.j_uuid(c -> 'template_id') THEN
--                           CASE WHEN o = jsonb_array_length(v_tpls)
--                                THEN c -> 'else' = 'true'::jsonb AND (SELECT count(*) FROM jsonb_object_keys(c)) = 2
--                                ELSE c ->> 'if' = 'on_time' AND jsonb_typeof(c -> 'item_key') = 'string'
--                                     AND (c ->> 'item_key') ~ '^it_[a-z0-9]{6}$' AND (SELECT count(*) FROM jsonb_object_keys(c)) = 3 END
--                         ELSE false END) IS NOT TRUE) ELSE false END) THEN
--         v := v || format('«%s»: las plantillas del certificado no son válidas', p_nm);
--       ELSIF p_ws IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_tpls) c WHERE NOT EXISTS (
--               SELECT 1 FROM public.design_templates t WHERE t.id = (c ->> 'template_id')::uuid AND t.workspace_id = p_ws AND t.doc_type = 'certificado')) THEN
--         v := v || format('«%s»: la plantilla no es de un certificado de este negocio', p_nm);
--       END IF;
--     ELSIF NOT app_servicio.j_uuid(v_ref -> 'template_id') THEN
--       v := v || 'Elegí la plantilla del certificado'::text;
--     ELSIF p_ws IS NOT NULL AND NOT EXISTS (
--       SELECT 1 FROM public.design_templates t WHERE t.id = (v_ref ->> 'template_id')::uuid AND t.workspace_id = p_ws AND t.doc_type = 'certificado'
--     ) THEN
--       v := v || format('«%s»: la plantilla no es de un certificado de este negocio', p_nm);
--     END IF;
--   ELSIF v_kind = 'open_section' THEN
--     IF NOT COALESCE(v_ref ->> 'section' = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN
--       v := v || format('«%s»: elegí la sección', p_nm);
--     END IF;
--   END IF;
--   IF v_ref ? 'button' THEN
--     v_btn := v_ref -> 'button';
--     IF jsonb_typeof(v_btn) IS DISTINCT FROM 'object' THEN
--       v := v || format('«%s»: el botón no es válido', p_nm);
--     ELSE
--       v_label := v_btn -> 'label';
--       IF v_label IS NOT NULL AND jsonb_typeof(v_label) <> 'null' AND v_label <> '""'::jsonb THEN
--         IF jsonb_typeof(v_label) <> 'string' OR char_length(v_label #>> '{}') > 40 OR (v_label #>> '{}') ~ '[\r\n]' THEN
--           v := v || format('«%s»: el texto del botón tiene hasta 40 caracteres, en una línea', p_nm);
--         END IF;
--       END IF;
--       v_url := v_btn -> 'url';
--       IF v_url IS NOT NULL AND jsonb_typeof(v_url) <> 'null' AND v_url <> '""'::jsonb THEN
--         IF NOT v_link_kind THEN
--           v := v || format('«%s»: este paso ya lleva a su destino', p_nm);
--         ELSIF jsonb_typeof(v_url) <> 'string' OR (v_url #>> '{}') !~ '^https://\S+$' OR char_length(v_url #>> '{}') > 2000 THEN
--           v := v || format('«%s»: el link del botón tiene que empezar con https:// y no llevar espacios', p_nm);
--           v_url_bad := true;
--         ELSE
--           v_url_ok := true;
--         END IF;
--       END IF;
--     END IF;
--   END IF;
--   IF p_item -> 'portal_button' = 'true'::jsonb THEN
--     IF p_item -> 'visible_to_client' = 'false'::jsonb THEN
--       v := v || format('«%s»: para mostrar el botón, el cliente tiene que ver el paso', p_nm);
--     ELSIF v_link_kind AND NOT v_url_ok AND NOT v_url_bad THEN
--       v := v || format('«%s»: pegá el link del botón', p_nm);
--     END IF;
--   END IF;
--   IF v_ref ? 'show_response' THEN
--     IF jsonb_typeof(v_ref -> 'show_response') <> 'boolean' THEN
--       v := v || format('«%s»: «El cliente puede ver su respuesta» no es válido', p_nm);
--     ELSIF NOT (v_kind = ANY (ARRAY['form','survey','activity','quiz','contract'])) THEN
--       v := v || format('«%s»: «El cliente puede ver su respuesta» es solo para pasos con formulario', p_nm);
--     END IF;
--   END IF;
--   IF v_co = 'recorded' AND v_kind <> 'booking' THEN
--     v := v || format('«%s»: «cuando hay grabación» es solo para pasos Reunión', p_nm);
--   END IF;
--   IF v_ref ? 'lock' THEN
--     v_lock := v_ref -> 'lock';
--     IF NOT (
--          (jsonb_typeof(v_lock) = 'object' AND jsonb_typeof(v_lock -> 'after_item_key') = 'string'
--           AND (v_lock ->> 'after_item_key') ~ '^it_[a-z0-9]{6}$' AND (SELECT count(*) FROM jsonb_object_keys(v_lock)) = 1)
--       OR (jsonb_typeof(v_lock) = 'object' AND COALESCE(v_lock ->> 'from' = ANY (ARRAY['service_created','service_start','phase_start']), false)
--           AND app_servicio.j_int(v_lock -> 'days') AND app_servicio.j_num(v_lock -> 'days') BETWEEN 0 AND 365
--           AND (SELECT count(*) FROM jsonb_object_keys(v_lock)) = 2)
--     ) THEN
--       v := v || format('«%s»: el bloqueo no es válido', p_nm);
--     END IF;
--   END IF;
--   IF v_ref ? 'evidence' THEN
--     v_ev := v_ref -> 'evidence';
--     IF NOT (v_kind = ANY (ARRAY['team_task','student_task','checkbox'])) THEN
--       v := v || format('«%s»: la evidencia es solo para tareas y casillas', p_nm);
--     ELSIF jsonb_typeof(v_ev) IS DISTINCT FROM 'object' OR v_ev -> 'required' IS DISTINCT FROM 'true'::jsonb
--        OR jsonb_typeof(v_ev -> 'kinds') IS DISTINCT FROM 'array' OR jsonb_array_length(v_ev -> 'kinds') = 0
--        OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_ev -> 'kinds') k WHERE NOT COALESCE(k #>> '{}' = ANY (ARRAY['file','link','note']), false) OR jsonb_typeof(k) <> 'string')
--        OR (SELECT count(DISTINCT k #>> '{}') FROM jsonb_array_elements(v_ev -> 'kinds') k) <> jsonb_array_length(v_ev -> 'kinds') THEN
--       v := v || format('«%s»: elegí qué evidencia pide', p_nm);
--     END IF;
--   END IF;
--   IF v_ref ? 'checklist' THEN
--     IF NOT (v_kind = ANY (ARRAY['team_task','student_task'])) THEN
--       v := v || format('«%s»: el checklist es solo para tareas', p_nm);
--     ELSIF jsonb_typeof(v_ref -> 'checklist') IS DISTINCT FROM 'array' OR jsonb_array_length(v_ref -> 'checklist') > 20
--        OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_ref -> 'checklist') c
--                   WHERE jsonb_typeof(c) <> 'string' OR btrim(c #>> '{}') = '' OR char_length(c #>> '{}') > 200) THEN
--       v := v || format('«%s»: el checklist tiene hasta 20 puntos de hasta 200 caracteres', p_nm);
--     END IF;
--   END IF;
--   RETURN v;
-- END;
-- $function$;
--
-- ---- app_servicio.svc_generate_occurrences (00522) ----
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
--   v_rec jsonb; v_done integer;
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
--             WHERE i.service_id = p_service_id AND i.is_recurring_template AND p.status = 'in_progress'
--               -- 00522: una serie terminada (a mano, por el fin del servicio o por sus N vueltas) ya no crea vueltas.
--               AND i.series_ended_at IS NULL LOOP
--     SELECT * INTO ph FROM app_servicio.service_phases WHERE id = m.phase_id;
--     v_phase_start := app_servicio.local_date(ph.started_at, s.workspace_id);
--     v_win := app_servicio.svc_recurrence_window(m.recurrence, jsonb_build_object(
--       'serviceCreated', app_servicio.local_date(s.created_at, s.workspace_id), 'serviceStart', s.starts_on, 'serviceEnd', s.ends_on,
--       'phaseStart', v_phase_start, 'phaseEnd', CASE WHEN ph.duration_days IS NOT NULL THEN v_phase_start + ph.duration_days - 1 END,
--       'phases', v_phases, 'items', v_items));
--     v_start := (v_win ->> 'start')::date;
--     CONTINUE WHEN v_start IS NULL;
--     v_until := (v_win ->> 'until')::date;
--     -- 00522: «después de N vueltas» cuenta las cumplidas. Al llegar a N, la serie termina; mientras tanto se siguen
--     -- creando vueltas en sus fechas (las que no se cumplieron no cuentan).
--     v_rec := m.recurrence;
--     IF m.recurrence ->> 'until' = 'n_times' THEN
--       SELECT count(*) INTO v_done FROM app_servicio.service_items c WHERE c.parent_item_id = m.id AND c.status = 'completed';
--       IF app_servicio.svc_series_reached(m.recurrence, v_done) THEN
--         UPDATE app_servicio.service_items SET series_ended_at = now(), series_end_reason = 'n_times' WHERE id = m.id AND series_ended_at IS NULL;
--         CONTINUE;
--       END IF;
--       v_rec := jsonb_set(m.recurrence, '{n_until}', '1000'::jsonb);
--     END IF;
--     v_occ := app_servicio.svc_occurrence_dates(v_rec, v_start, v_until, v_until, v_today);
--     v_grace := COALESCE((m.late ->> 'grace_hours')::integer, 0);
--     FOR o IN SELECT x FROM jsonb_array_elements(v_occ) x LOOP
--       CONTINUE WHEN v_phase_start IS NOT NULL AND (o ->> 'occursOn')::date < v_phase_start;
--       INSERT INTO app_servicio.service_items (workspace_id, service_id, phase_id, template_key, kind, name, description, required, assignee,
--         assignee_user_id, visible_to_client, portal_button, ref, late, reminders, parent_item_id, occurrence_index, position,
--         yellow_after_days, red_after_days, due_on, due_at, round_on)
--       VALUES (s.workspace_id, s.id, m.phase_id, m.template_key, m.kind, m.name, m.description, m.required, m.assignee,
--         m.assignee_user_id, m.visible_to_client, m.portal_button, m.ref, m.late, m.reminders, m.id, (o ->> 'index')::integer,
--         m.position, m.yellow_after_days, m.red_after_days, (o ->> 'dueOn')::date,
--         app_servicio.end_of_day((o ->> 'dueOn')::date, v_student_tz) + make_interval(hours => v_grace), (o ->> 'occursOn')::date)
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
-- ---- app_servicio.svc_ensure_task (00522) ----
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
--   VALUES (s.workspace_id,
--           -- 00522: la tarea de una vuelta dice cuál es («… · vuelta 3»).
--           left(it.name || CASE WHEN it.parent_item_id IS NOT NULL AND it.occurrence_index IS NOT NULL THEN ' · vuelta ' || it.occurrence_index ELSE '' END, 200),
--           it.description, 'pending', 'normal',
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
-- ---- app_servicio.svc_end_series (00522) ----
-- CREATE OR REPLACE FUNCTION app_servicio.svc_end_series(p_item_id uuid, p_note text DEFAULT NULL)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- -- Termina la serie de un paso que se repite: no se crean más vueltas. Las que ya existen quedan como están (se
-- -- cumplen o se dejan). Pide `services.items` y ver el servicio (require_service).
-- DECLARE
--   it app_servicio.service_items;
--   s app_servicio.services;
-- BEGIN
--   SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
--   IF it.id IS NULL OR NOT it.is_recurring_template THEN
--     RAISE EXCEPTION 'Este paso no se repite' USING ERRCODE = 'SV044';
--   END IF;
--   s := app_servicio.svc_get(it.service_id, true);
--   PERFORM app_servicio.require_service(s, 'services.items');
--   IF it.series_ended_at IS NOT NULL THEN
--     RAISE EXCEPTION 'Esta serie ya terminó' USING ERRCODE = 'SV044';
--   END IF;
--   UPDATE app_servicio.service_items
--      SET series_ended_at = now(), series_end_reason = 'manual', series_ended_by = auth.uid(),
--          series_end_note = NULLIF(left(btrim(COALESCE(p_note, '')), 500), '')
--    WHERE id = it.id;
--   PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.series_ended',
--     jsonb_build_object('service_id', s.id, 'item_key', it.template_key, 'reason', 'manual'));
--   RETURN jsonb_build_object('ended', true);
-- END;
-- $function$;


-- ─── 1. La serie ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio.meeting_series (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  service_id           uuid NOT NULL REFERENCES app_servicio.services(id) ON DELETE CASCADE,
  service_item_id      uuid NOT NULL REFERENCES app_servicio.service_items(id) ON DELETE CASCADE,
  host_user_id         uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type_id        uuid NULL REFERENCES public.event_types(id) ON DELETE SET NULL,
  rrule                text NOT NULL,
  first_start_at       timestamptz NOT NULL,
  duration_minutes     integer NOT NULL,
  timezone             text NOT NULL,
  google_connection_id uuid NULL,
  google_calendar_id   uuid NULL,
  google_event_id      text NULL,
  meet_url             text NULL,
  status               text NOT NULL DEFAULT 'active',
  ended_reason         text NULL,
  ended_at             timestamptz NULL,
  google_cleanup       text NOT NULL DEFAULT 'none',
  created_by           uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meeting_series_status_check') THEN
    ALTER TABLE app_servicio.meeting_series ADD CONSTRAINT meeting_series_status_check CHECK (status IN ('active', 'ended'));
    ALTER TABLE app_servicio.meeting_series ADD CONSTRAINT meeting_series_duration_check CHECK (duration_minutes BETWEEN 5 AND 1440);
    ALTER TABLE app_servicio.meeting_series ADD CONSTRAINT meeting_series_rrule_check CHECK (rrule ~ '^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY)' AND char_length(rrule) <= 300);
    ALTER TABLE app_servicio.meeting_series ADD CONSTRAINT meeting_series_cleanup_check CHECK (google_cleanup IN ('none', 'pending', 'done', 'failed'));
    ALTER TABLE app_servicio.meeting_series ADD CONSTRAINT meeting_series_ended_check CHECK ((status = 'ended') = (ended_at IS NOT NULL));
    ALTER TABLE app_servicio.meeting_series ADD CONSTRAINT meeting_series_reason_check CHECK (ended_reason IS NULL OR ended_reason IN
      ('n_times', 'manual', 'paused', 'owner_changed', 'service_end', 'rescheduled'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS meeting_series_one_active_idx ON app_servicio.meeting_series (service_item_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS meeting_series_service_idx ON app_servicio.meeting_series (service_id);
CREATE INDEX IF NOT EXISTS meeting_series_active_ws_idx ON app_servicio.meeting_series (workspace_id) WHERE status = 'active';
COMMENT ON TABLE app_servicio.meeting_series IS
  '00524: la serie de reuniones que fija quien atiende un paso de Reunión que se repite: UN evento recurrente en su Google. Escribe solo el servidor.';

ALTER TABLE app_servicio.meeting_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_servicio.meeting_series FROM PUBLIC, anon, authenticated;
GRANT SELECT ON app_servicio.meeting_series TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_servicio.meeting_series TO service_role;
DROP POLICY IF EXISTS meeting_series_select ON app_servicio.meeting_series;
CREATE POLICY meeting_series_select ON app_servicio.meeting_series FOR SELECT TO authenticated
  USING (service_id IN (SELECT app_servicio.rls_visible_service_ids()));
DROP TRIGGER IF EXISTS set_updated_at ON app_servicio.meeting_series;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_servicio.meeting_series FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── 2. La reunión y el estado de cada vuelta ────────────────────────────────
ALTER TABLE app_servicio.service_items ADD COLUMN IF NOT EXISTS booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE SET NULL;
ALTER TABLE app_servicio.service_items ADD COLUMN IF NOT EXISTS round_state text NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_items_round_state_check') THEN
    ALTER TABLE app_servicio.service_items ADD CONSTRAINT service_items_round_state_check
      CHECK (round_state IS NULL OR round_state IN ('to_schedule', 'scheduled', 'attended', 'no_show', 'lost'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS service_items_booking_idx ON app_servicio.service_items (booking_id) WHERE booking_id IS NOT NULL;
COMMENT ON COLUMN app_servicio.service_items.round_state IS '00524: en una vuelta de Reunión: to_schedule, scheduled, attended, no_show o lost.';

-- ─── 3. Ayudas ───────────────────────────────────────────────────────────────
-- Cómo se llama el cliente en los títulos de las tareas.
CREATE OR REPLACE FUNCTION app_servicio.svc_client_label(p_service_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((SELECT NULLIF(btrim(c.display_name), '') FROM app_servicio.services s JOIN public.contacts c ON c.id = s.contact_id
                    WHERE s.id = p_service_id), 'el cliente');
$function$;

-- La vuelta de Reunión a la que se une una reunión: la pendiente MÁS ANTIGUA de un servicio activo del contacto, del
-- tipo de la reunión, sin reunión (o con una cancelada). Una reunión de una serie solo se une a las vueltas de SU paso.
CREATE OR REPLACE FUNCTION app_servicio.booking_round_candidate(p_booking public.bookings)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT r.id
    FROM app_servicio.service_items r
    JOIN app_servicio.services s ON s.id = r.service_id
   WHERE s.workspace_id = p_booking.workspace_id AND s.contact_id = p_booking.contact_id AND s.status = 'active'
     AND r.parent_item_id IS NOT NULL AND r.kind = 'booking' AND r.status = 'pending'
     AND (r.booking_id IS NULL OR r.booking_id = p_booking.id
          OR EXISTS (SELECT 1 FROM public.bookings o WHERE o.id = r.booking_id AND o.status_group = 'cancelled'))
     -- Una reunión de una serie (la crea la app con quien atiende, no con el tipo de evento) va a las vueltas de SU
     -- paso; cualquier otra, a las del tipo de reunión del paso.
     AND (CASE WHEN p_booking.metadata ? 'series_id'
               THEN r.parent_item_id = (SELECT ms.service_item_id FROM app_servicio.meeting_series ms WHERE ms.id::text = p_booking.metadata ->> 'series_id')
               ELSE r.ref ->> 'event_type_id' = p_booking.event_type_id::text END)
   ORDER BY (r.booking_id IS NOT DISTINCT FROM p_booking.id) DESC, s.created_at, r.occurrence_index
   LIMIT 1;
$function$;

-- ─── 4. Qué pasa con la vuelta cuando la reunión se agenda, se cancela, no se presenta o asiste ───
CREATE OR REPLACE FUNCTION app_servicio.booking_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- `record` y no el tipo de la tabla del modulo: un tipo se resuelve al ENTRAR a la funcion, antes del bloque que
  -- atrapa los errores, y un problema con la tabla haria fallar la operacion de BAIOS (verify-services, sv2).
  v_when text;
  it record;
  v_count integer;
  v_signed uuid;
  v_round uuid;
  v_task uuid;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    IF NEW.contact_id IS NULL THEN
      PERFORM set_config('app_servicio.system', v_prev_system, true);
      RETURN NULL;
    END IF;
    -- 00524: las vueltas de una Reunión que se repite.
    IF NEW.status LIKE 'cancelled%' THEN
      IF TG_OP = 'UPDATE' THEN
        -- Cancelada: su vuelta vuelve a «por agendar» (con su fecha) y su tarea «Agendar…» se abre otra vez.
        FOR it IN SELECT r.id, r.task_id FROM app_servicio.service_items r WHERE r.booking_id = NEW.id AND r.status = 'pending' AND r.parent_item_id IS NOT NULL LOOP
          UPDATE app_servicio.service_items SET booking_id = NULL, round_state = 'to_schedule', due_on = COALESCE(round_on, due_on), due_at = NULL WHERE id = it.id;
          IF it.task_id IS NOT NULL THEN
            UPDATE public.tasks SET status = 'pending', completed_at = NULL WHERE id = it.task_id AND status = 'completed' AND source_ref LIKE 'svc\_round:%';
          END IF;
        END LOOP;
      END IF;
      PERFORM set_config('app_servicio.system', v_prev_system, true);
      RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN
      v_round := app_servicio.booking_round_candidate(NEW);
      IF v_round IS NOT NULL THEN
        -- Agendada: vence el día de la reunión y su tarea «Agendar…» se cierra. Se cumple recién al asistir.
        UPDATE app_servicio.service_items
           SET booking_id = NEW.id, round_state = 'scheduled', due_on = app_servicio.local_date(NEW.start_at, NEW.workspace_id), due_at = NEW.start_at
         WHERE id = v_round
        RETURNING task_id INTO v_task;
        IF v_task IS NOT NULL THEN
          UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = v_task AND status <> 'completed' AND source_ref LIKE 'svc\_round:%';
        END IF;
        PERFORM set_config('app_servicio.system', v_prev_system, true);
        RETURN NULL;
      END IF;
    ELSIF NEW.status_group = 'no_show' AND OLD.status_group IS DISTINCT FROM 'no_show' THEN
      -- No se presentó: no cuenta. Quien atiende elige reagendar o darla por perdida.
      UPDATE app_servicio.service_items SET round_state = 'no_show' WHERE booking_id = NEW.id AND parent_item_id IS NOT NULL AND status = 'pending';
    ELSIF NEW.status_group = 'active' AND OLD.status_group = 'no_show' THEN
      UPDATE app_servicio.service_items SET round_state = 'scheduled' WHERE booking_id = NEW.id AND parent_item_id IS NOT NULL AND status = 'pending';
    ELSIF NEW.status_group = 'outcome' AND OLD.status_group IS DISTINCT FROM 'outcome' THEN
      -- Asistida: la vuelta unida a la reunión (o, si no tenía, la que le toca) se cumple.
      SELECT r.id INTO v_round FROM app_servicio.service_items r WHERE r.booking_id = NEW.id AND r.parent_item_id IS NOT NULL AND r.status = 'pending' LIMIT 1;
      v_round := COALESCE(v_round, app_servicio.booking_round_candidate(NEW));
      IF v_round IS NOT NULL THEN
        UPDATE app_servicio.service_items SET booking_id = NEW.id, round_state = 'attended' WHERE id = v_round;
        PERFORM app_servicio.svc_mark_item(v_round, 'booking_attended', 'client', NULL);
        PERFORM set_config('app_servicio.system', v_prev_system, true);
        RETURN NULL;
      END IF;
    END IF;
    -- Lo de siempre, para los pasos que no se repiten (nunca el molde de uno que se repite ni una vuelta).
    v_when := CASE WHEN TG_OP = 'INSERT' THEN 'booked'
                   WHEN NEW.status_group = 'outcome' AND OLD.status_group IS DISTINCT FROM 'outcome' THEN 'attended' END;
    IF v_when IS NOT NULL THEN
      IF (NEW.utm ->> 'svc_item') ~* '^[0-9a-f-]{36}$' THEN
        SELECT i.id INTO v_signed FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
         WHERE i.id = (NEW.utm ->> 'svc_item')::uuid AND s.contact_id = NEW.contact_id AND s.workspace_id = NEW.workspace_id;
      END IF;
      SELECT count(DISTINCT i.service_id) INTO v_count
        FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
       WHERE s.workspace_id = NEW.workspace_id AND s.contact_id = NEW.contact_id AND s.status = 'active' AND i.status = 'pending'
         AND i.kind = 'booking' AND i.ref ->> 'event_type_id' = NEW.event_type_id::text AND COALESCE(i.ref ->> 'complete_on', 'booked') = v_when
         AND ph.status <> 'completed' AND (v_signed IS NULL OR i.id = v_signed)
         AND NOT i.is_recurring_template AND i.parent_item_id IS NULL;
      IF v_count > 0 THEN
        SELECT i.* INTO it
          FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
         WHERE s.workspace_id = NEW.workspace_id AND s.contact_id = NEW.contact_id AND s.status = 'active' AND i.status = 'pending'
           AND i.kind = 'booking' AND i.ref ->> 'event_type_id' = NEW.event_type_id::text AND COALESCE(i.ref ->> 'complete_on', 'booked') = v_when
           AND ph.status <> 'completed' AND (v_signed IS NULL OR i.id = v_signed)
           AND NOT i.is_recurring_template AND i.parent_item_id IS NULL
         ORDER BY s.created_at, (ph.status = 'in_progress') DESC, ph.position, i.position LIMIT 1;
        IF v_count > 1 THEN
          PERFORM app_servicio.audit(NEW.workspace_id, 'service_item', it.id, 'svc.item_ambiguous',
            jsonb_build_object('service_id', it.service_id, 'event_type_id', NEW.event_type_id, 'services', v_count), 'system');
        END IF;
        PERFORM app_servicio.svc_mark_item(it.id, 'booking_' || v_when, 'client', NULL);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'booking', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$function$;

-- Mover una reunión mueve el vencimiento de su vuelta (también si se movió en Google).
CREATE OR REPLACE FUNCTION app_servicio.booking_round_moved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.start_at IS DISTINCT FROM OLD.start_at AND app_servicio.module_on(NEW.workspace_id) THEN
    BEGIN
      UPDATE app_servicio.service_items
         SET due_on = app_servicio.local_date(NEW.start_at, NEW.workspace_id), due_at = NEW.start_at
       WHERE booking_id = NEW.id AND parent_item_id IS NOT NULL AND status = 'pending';
    EXCEPTION WHEN OTHERS THEN
      PERFORM app_servicio.hook_failed(NEW.workspace_id, 'booking_moved', SQLSTATE || ' ' || SQLERRM, NEW.id);
    END;
  END IF;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS trg_app_servicio_booking_moved ON public.bookings;
CREATE TRIGGER trg_app_servicio_booking_moved AFTER UPDATE OF start_at ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION app_servicio.booking_round_moved();

-- ─── 5. La serie: pedirle a quien atiende que la fije, cortarla, y marcar las vueltas ───
-- La tarea «Fijar reuniones recurrentes con [cliente]» del paso (una abierta por paso). Nunca agenda nada.
CREATE OR REPLACE FUNCTION app_servicio.svc_series_request_fix(p_template_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  m app_servicio.service_items;
  s app_servicio.services;
  v_owner uuid;
  v_task uuid;
  v_ref text := 'svc_series_fix:' || p_template_id::text;
  v_title text;
BEGIN
  SELECT * INTO m FROM app_servicio.service_items WHERE id = p_template_id;
  IF m.id IS NULL OR NOT m.is_recurring_template THEN RETURN NULL; END IF;
  SELECT id INTO v_task FROM public.tasks
   WHERE workspace_id = m.workspace_id AND source = 'cx' AND source_ref = v_ref AND status <> 'completed' AND deleted_at IS NULL LIMIT 1;
  IF v_task IS NOT NULL THEN RETURN v_task; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = m.service_id;
  v_owner := CASE m.assignee WHEN 'user' THEN m.assignee_user_id ELSE s.owner_user_id END;
  v_title := left('Fijar reuniones recurrentes con ' || app_servicio.svc_client_label(s.id), 200);
  INSERT INTO public.tasks (workspace_id, title, description, status, priority, due_date, owner_id, contact_id, source, source_ref, created_by, service_id)
  VALUES (s.workspace_id, v_title,
          'Elegí el primer día y la hora: se crea un solo evento que se repite en tu Google Calendar, con Meet e invitación al cliente. «' || m.name || '».',
          'pending', 'normal', app_servicio.local_date(now(), s.workspace_id), v_owner, s.contact_id, 'cx', v_ref, NULL, s.id)
  RETURNING id INTO v_task;
  IF v_owner IS NOT NULL THEN
    PERFORM app_servicio.notify(s.workspace_id, v_owner, 'task_assigned', 'Tenés una tarea nueva', v_title, 'task', v_task,
                                jsonb_build_object('service_id', s.id));
  END IF;
  RETURN v_task;
END;
$function$;

-- Corta la serie de reuniones de un paso: queda terminada, la tarea «Fijar…» (si quedaba) se cierra, y un trabajo de la
-- cola corta el evento en Google y borra las reuniones futuras. Devuelve la serie cortada (o null si no había una activa).
CREATE OR REPLACE FUNCTION app_servicio.svc_end_meeting_series(p_template_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_id uuid; v_ws uuid;
BEGIN
  UPDATE public.tasks SET status = 'completed', completed_at = now()
   WHERE source = 'cx' AND source_ref = 'svc_series_fix:' || p_template_id::text AND status <> 'completed' AND deleted_at IS NULL;
  UPDATE app_servicio.meeting_series
     SET status = 'ended', ended_reason = p_reason, ended_at = now(),
         google_cleanup = CASE WHEN google_event_id IS NOT NULL THEN 'pending' ELSE 'none' END
   WHERE service_item_id = p_template_id AND status = 'active'
  RETURNING id, workspace_id INTO v_id, v_ws;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
  VALUES ('meeting_series_end', jsonb_build_object('series_id', v_id, 'workspace_id', v_ws), now(), 'meeting_series_end:' || v_id::text)
  ON CONFLICT DO NOTHING;
  PERFORM app_servicio.audit(v_ws, 'service_item', p_template_id, 'svc.meeting_series_ended',
    jsonb_build_object('series_id', v_id, 'reason', p_reason), 'system');
  RETURN v_id;
END;
$function$;

-- Marcar una vuelta de Reunión: asistida, no se presentó o perdida. Con la sesión: pide `services.items` y ver el servicio.
CREATE OR REPLACE FUNCTION app_servicio.svc_round_mark(p_item_id uuid, p_state text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  v_actor uuid := auth.uid();
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR it.parent_item_id IS NULL OR it.kind <> 'booking' THEN RAISE EXCEPTION 'No es una vuelta de una reunión' USING ERRCODE = 'SV046'; END IF;
  s := app_servicio.svc_get(it.service_id, true);
  PERFORM app_servicio.require_service(s, 'services.items');
  IF it.status <> 'pending' THEN RAISE EXCEPTION 'Esta vuelta ya está cerrada' USING ERRCODE = 'SV047'; END IF;
  IF p_state = 'attended' THEN
    UPDATE app_servicio.service_items SET round_state = 'attended' WHERE id = it.id;
    PERFORM app_servicio.svc_mark_item(it.id, 'manual', 'user', v_actor);
  ELSIF p_state = 'no_show' THEN
    IF it.booking_id IS NULL THEN RAISE EXCEPTION 'La vuelta no tiene una reunión agendada' USING ERRCODE = 'SV048'; END IF;
    UPDATE app_servicio.service_items SET round_state = 'no_show' WHERE id = it.id;
    UPDATE public.bookings SET status = 'no_show', status_changed_at = now(), status_changed_by = v_actor WHERE id = it.booking_id AND status_group = 'active';
  ELSIF p_state = 'lost' THEN
    -- Se cierra sin cumplirse: no cuenta para «N vueltas» y queda en el historial.
    UPDATE app_servicio.service_items
       SET status = 'completed', round_state = 'lost', completed_at = now(), completed_by_kind = 'user', completed_by = v_actor, completed_source = 'round_lost'
     WHERE id = it.id;
    UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = it.task_id AND status <> 'completed';
  ELSE
    RAISE EXCEPTION 'Estado desconocido' USING ERRCODE = 'SV046';
  END IF;
  PERFORM app_servicio.audit(it.workspace_id, 'service_item', it.id, 'svc.round_marked',
    jsonb_build_object('service_id', it.service_id, 'round', it.occurrence_index, 'state', p_state, 'booking_id', it.booking_id));
  PERFORM app_servicio.svc_generate_occurrences(it.service_id);
  PERFORM app_servicio.svc_compute_light(it.service_id);
  RETURN p_state;
END;
$function$;

-- ─── 6. El motor, la tarea de cada vuelta y terminar una serie a mano (sobre la 00522) ───
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
  v_series boolean; v_ms app_servicio.meeting_series; v_booking uuid; v_booking_at timestamptz;
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
    -- 00524: una Reunión «la fija el responsable»: sin serie fijada no se crean vueltas (nada se agenda solo) y, si la
    -- serie ya tendría que haber empezado, quien atiende recibe la tarea «Fijar reuniones recurrentes…». Con la serie
    -- fijada, las vueltas siguen las fechas de la serie (empiezan el primer día que eligió).
    v_series := m.kind = 'booking' AND COALESCE(m.ref ->> 'schedule', 'team') = 'series';
    v_ms := NULL;
    IF v_series THEN
      SELECT * INTO v_ms FROM app_servicio.meeting_series x WHERE x.service_item_id = m.id AND x.status = 'active';
      IF v_ms.id IS NULL THEN
        IF v_start <= v_today THEN PERFORM app_servicio.svc_series_request_fix(m.id); END IF;
        CONTINUE;
      END IF;
      v_start := app_servicio.local_date(v_ms.first_start_at, s.workspace_id);
    END IF;
    v_until := (v_win ->> 'until')::date;
    -- 00522: «después de N vueltas» cuenta las cumplidas. Al llegar a N, la serie termina; mientras tanto se siguen
    -- creando vueltas en sus fechas (las que no se cumplieron no cuentan).
    v_rec := m.recurrence;
    IF m.recurrence ->> 'until' = 'n_times' THEN
      -- 00524: una vuelta de Reunión dada por perdida se cierra, pero no cuenta como cumplida.
      SELECT count(*) INTO v_done FROM app_servicio.service_items c
       WHERE c.parent_item_id = m.id AND c.status = 'completed' AND c.round_state IS DISTINCT FROM 'lost';
      IF app_servicio.svc_series_reached(m.recurrence, v_done) THEN
        UPDATE app_servicio.service_items SET series_ended_at = now(), series_end_reason = 'n_times' WHERE id = m.id AND series_ended_at IS NULL;
        -- 00524: la serie de reuniones del paso se corta (y la tarea «Fijar…», si quedaba).
        IF m.kind = 'booking' THEN PERFORM app_servicio.svc_end_meeting_series(m.id, 'n_times'); END IF;
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
        IF m.kind = 'booking' THEN
          -- 00524: una vuelta de Reunión nace «por agendar»; en una serie fijada, se une a la próxima reunión de la serie
          -- que todavía no tiene vuelta.
          UPDATE app_servicio.service_items SET round_state = 'to_schedule' WHERE id = v_new;
          IF v_ms.id IS NOT NULL THEN
            v_booking := NULL;
            SELECT b.id, b.start_at INTO v_booking, v_booking_at FROM public.bookings b
             WHERE b.workspace_id = s.workspace_id AND b.metadata ->> 'series_id' = v_ms.id::text AND b.status_group = 'active'
               AND NOT EXISTS (SELECT 1 FROM app_servicio.service_items r WHERE r.booking_id = b.id)
             ORDER BY b.start_at LIMIT 1;
            IF v_booking IS NOT NULL THEN
              UPDATE app_servicio.service_items
                 SET booking_id = v_booking, round_state = 'scheduled',
                     due_on = app_servicio.local_date(v_booking_at, s.workspace_id), due_at = v_booking_at
               WHERE id = v_new;
            END IF;
          END IF;
        END IF;
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
  v_title text;
  v_ref text;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR it.task_id IS NOT NULL OR it.status = 'completed' OR it.is_recurring_template THEN RETURN; END IF;
  -- 00524: además de los pasos del equipo, la vuelta de una Reunión que agenda el equipo pide su tarea «Agendar…». Con
  -- una serie fijada (o si la agenda el cliente) no: la reunión ya está en la Agenda.
  IF NOT (it.kind = 'team_task'
          OR (it.kind = 'booking' AND it.parent_item_id IS NOT NULL AND it.assignee IN ('owner', 'user')
              AND COALESCE(it.ref ->> 'schedule', 'team') = 'team' AND it.booking_id IS NULL)) THEN RETURN; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  v_owner := CASE it.assignee WHEN 'user' THEN it.assignee_user_id ELSE s.owner_user_id END;
  v_title := it.name || CASE WHEN it.parent_item_id IS NOT NULL AND it.occurrence_index IS NOT NULL THEN ' · vuelta ' || it.occurrence_index ELSE '' END;
  v_ref := 'svc_item:' || it.id::text;
  IF it.kind = 'booking' THEN
    -- «Agendar [tipo] con [cliente] · vuelta N». La referencia es otra (`svc_round:`): completar esta tarea no da por
    -- cumplida la vuelta (se cumple al asistir); la tarea se cierra sola cuando la reunión queda agendada.
    v_title := 'Agendar ' || COALESCE((SELECT et.title FROM public.event_types et
                                        WHERE (it.ref ->> 'event_type_id') ~* '^[0-9a-f-]{36}$' AND et.id = (it.ref ->> 'event_type_id')::uuid), it.name)
               || ' con ' || app_servicio.svc_client_label(s.id) || ' · vuelta ' || it.occurrence_index;
    v_ref := 'svc_round:' || it.id::text;
  END IF;
  -- A4 (F148, F152): la tarea nace con su servicio y con los puntos del checklist del paso, sin tildar.
  INSERT INTO public.tasks (workspace_id, title, description, status, priority, due_date, owner_id, contact_id, source, source_ref, created_by,
                            service_id, checklist)
  VALUES (s.workspace_id,
          -- 00522: la tarea de una vuelta dice cuál es («… · vuelta 3»).
          left(v_title, 200),
          it.description, 'pending', 'normal',
          COALESCE(it.due_on, app_servicio.local_date(it.due_at, s.workspace_id)), v_owner, s.contact_id, 'cx', v_ref, NULL,
          s.id,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'text', left(btrim(c #>> '{}'), 200), 'done', false) ORDER BY o)
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(it.ref -> 'checklist') = 'array' THEN it.ref -> 'checklist' ELSE '[]'::jsonb END)
                           WITH ORDINALITY AS t(c, o)
                     WHERE jsonb_typeof(c) = 'string' AND btrim(c #>> '{}') <> '' AND o <= 30), '[]'::jsonb))
  RETURNING id INTO v_task;
  UPDATE app_servicio.service_items SET task_id = v_task WHERE id = it.id;
  IF v_owner IS NOT NULL THEN
    PERFORM app_servicio.notify(s.workspace_id, v_owner, 'task_assigned', 'Tenés una tarea nueva', left(v_title, 200), 'task', v_task,
                                jsonb_build_object('service_id', s.id));
  END IF;
END;
$function$;

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
  -- 00524: la serie de reuniones del paso se corta (la cola corta el evento en Google y borra las reuniones futuras).
  IF it.kind = 'booking' THEN PERFORM app_servicio.svc_end_meeting_series(it.id, 'manual'); END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.series_ended',
    jsonb_build_object('service_id', s.id, 'item_key', it.template_key, 'reason', 'manual'));
  RETURN jsonb_build_object('ended', true);
END;
$function$;

-- ─── 7. Pausa, fin del servicio y cambio de responsable: la serie se corta ───
-- Al pausar se borran sus reuniones futuras; al volver, quien atiende recibe otra vez la tarea de fijarla (el motor).
-- Si cambia el responsable y el paso está a cargo del responsable del servicio, la serie del anterior se corta y el
-- nuevo recibe la tarea. Con una persona fija, no cambia nada. Nunca hace fallar el cambio del servicio.
CREATE OR REPLACE FUNCTION app_servicio.services_meeting_series_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE t record;
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('paused', 'completed', 'cancelled', 'renewed') THEN
      FOR t IN SELECT ms.service_item_id FROM app_servicio.meeting_series ms WHERE ms.service_id = NEW.id AND ms.status = 'active' LOOP
        PERFORM app_servicio.svc_end_meeting_series(t.service_item_id, CASE NEW.status WHEN 'paused' THEN 'paused' ELSE 'service_end' END);
      END LOOP;
      IF NEW.status <> 'paused' THEN
        -- Las tareas abiertas de las vueltas de Reunión (las cierra como las del camino, 00370).
        UPDATE public.tasks tk SET status = 'completed', completed_at = now()
          FROM app_servicio.service_items i
         WHERE i.service_id = NEW.id AND i.task_id = tk.id AND tk.status <> 'completed' AND tk.source = 'cx' AND tk.source_ref = 'svc_round:' || i.id::text;
        UPDATE public.tasks tk SET status = 'completed', completed_at = now()
          FROM app_servicio.service_items i
         WHERE i.service_id = NEW.id AND i.is_recurring_template AND tk.workspace_id = NEW.workspace_id AND tk.source = 'cx'
           AND tk.source_ref = 'svc_series_fix:' || i.id::text AND tk.status <> 'completed';
      END IF;
    END IF;
    IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
      FOR t IN SELECT ms.service_item_id FROM app_servicio.meeting_series ms JOIN app_servicio.service_items i ON i.id = ms.service_item_id
                WHERE ms.service_id = NEW.id AND ms.status = 'active' AND i.assignee = 'owner' LOOP
        PERFORM app_servicio.svc_end_meeting_series(t.service_item_id, 'owner_changed');
      END LOOP;
      -- La tarea «Fijar…» abierta del anterior pasa al nuevo.
      UPDATE public.tasks tk SET owner_id = NEW.owner_user_id
        FROM app_servicio.service_items i
       WHERE i.service_id = NEW.id AND i.is_recurring_template AND i.assignee = 'owner'
         AND tk.workspace_id = NEW.workspace_id AND tk.source = 'cx' AND tk.source_ref = 'svc_series_fix:' || i.id::text AND tk.status <> 'completed';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'meeting_series', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS trg_app_servicio_meeting_series ON app_servicio.services;
CREATE TRIGGER trg_app_servicio_meeting_series AFTER UPDATE OF status, owner_user_id ON app_servicio.services
  FOR EACH ROW EXECUTE FUNCTION app_servicio.services_meeting_series_hook();

-- ─── 8. La regla del editor ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.journey_item_ref_problems(p_item jsonb, p_nm text, p_ws uuid, p_product uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  v_kind text := p_item ->> 'kind';
  v_ref jsonb := CASE WHEN jsonb_typeof(p_item -> 'ref') = 'object' THEN p_item -> 'ref' ELSE '{}'::jsonb END;
  v_co text := v_ref ->> 'complete_on';
  v_form jsonb;
  v_want text;
  v_grading boolean;
  v_ok boolean;
  v_link_kind boolean := v_kind = ANY (ARRAY['team_task','student_task','checkbox']);
  v_btn jsonb;
  v_label jsonb;
  v_url jsonb;
  v_url_ok boolean := false;
  v_url_bad boolean := false;
  v_lock jsonb;
  v_ev jsonb;
  v_tpls jsonb;
BEGIN
  IF v_kind = ANY (ARRAY['form','survey','contract','activity','quiz']) THEN
    IF NOT app_servicio.j_uuid(v_ref -> 'form_id') THEN
      v := v || format('«%s»: elegí el formulario', p_nm);
    ELSE
      IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (CASE v_kind
          WHEN 'form' THEN ARRAY['submitted','reviewed'] WHEN 'survey' THEN ARRAY['submitted','reviewed']
          WHEN 'contract' THEN ARRAY['submitted'] WHEN 'activity' THEN ARRAY['submitted','reviewed','passed']
          ELSE ARRAY['passed','finished'] END), false) THEN
        v := v || format('«%s»: elegí cuándo se completa', p_nm);
      END IF;
      IF p_ws IS NOT NULL THEN
        SELECT to_jsonb(f) INTO v_form FROM public.forms f WHERE f.id = (v_ref ->> 'form_id')::uuid AND f.workspace_id = p_ws;
        IF v_form IS NULL THEN
          v := v || format('«%s»: el formulario no existe', p_nm);
        ELSE
          v_want := CASE v_kind WHEN 'form' THEN 'custom' ELSE v_kind END;
          IF v_form ->> 'type' IS DISTINCT FROM v_want THEN v := v || format('«%s»: el formulario no es del tipo del paso', p_nm); END IF;
          IF v_kind IN ('quiz','activity') AND p_product IS NOT NULL AND (v_form ->> 'product_id') IS DISTINCT FROM p_product::text THEN
            v := v || CASE v_kind WHEN 'quiz' THEN 'la evaluación tiene que ser de este programa' ELSE 'la actividad tiene que ser de este programa' END;
          END IF;
          IF v_kind = 'activity' AND v_co = 'passed' THEN
            SELECT COALESCE((fv.definition #>> '{grading,enabled}')::boolean, false) INTO v_grading
              FROM public.form_versions fv WHERE fv.id = (v_form ->> 'current_version_id')::uuid;
            IF NOT COALESCE(v_grading, false) THEN v := v || format('«%s»: «al aprobar» necesita una actividad con calificación', p_nm); END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  ELSIF v_kind = 'booking' THEN
    IF NOT app_servicio.j_uuid(v_ref -> 'event_type_id') THEN
      v := v || format('«%s»: elegí el tipo de reunión', p_nm);
    ELSIF p_ws IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.event_types e WHERE e.id = (v_ref ->> 'event_type_id')::uuid AND e.workspace_id = p_ws) THEN
      v := v || format('«%s»: el tipo de reunión no existe', p_nm);
    END IF;
    IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (ARRAY['booked','attended','recorded']), false) THEN v := v || format('«%s»: elegí cuándo se completa', p_nm); END IF;
    -- 00524: cómo se agenda una Reunión que se repite (gemela de refProblems, journey-template.cases.json).
    IF v_ref ? 'schedule' AND jsonb_typeof(v_ref -> 'schedule') <> 'null' THEN
      IF NOT COALESCE(v_ref ->> 'schedule' = ANY (ARRAY['team','series']), false) THEN
        v := v || format('«%s»: elegí cómo se agenda', p_nm);
      ELSIF v_ref ->> 'schedule' = 'series' AND (p_item -> 'recurrence' IS NULL OR jsonb_typeof(p_item -> 'recurrence') = 'null') THEN
        v := v || format('«%s»: una serie de reuniones necesita que el paso se repita', p_nm);
      END IF;
    END IF;
  ELSIF v_kind IN ('program_item','open_module') THEN
    IF NOT app_servicio.j_uuid(v_ref -> 'program_item_id') THEN
      v := v || format('«%s»: elegí el módulo o la clase', p_nm);
    ELSIF p_product IS NOT NULL THEN
      v_ok := false;
      IF to_regclass('app_servicio.program_items') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM app_servicio.program_items WHERE id = $1 AND product_id = $2)'
          INTO v_ok USING (v_ref ->> 'program_item_id')::uuid, p_product;
      END IF;
      IF NOT v_ok THEN v := v || format('«%s»: el módulo o la clase no es de este programa', p_nm); END IF;
    END IF;
  ELSIF v_kind = 'certificate' THEN
    IF v_ref ? 'templates' THEN
      v_tpls := v_ref -> 'templates';
      IF NOT (CASE WHEN jsonb_typeof(v_tpls) = 'array' AND jsonb_array_length(v_tpls) BETWEEN 2 AND 5 THEN NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_tpls) WITH ORDINALITY AS t(c, o)
             WHERE (CASE WHEN jsonb_typeof(c) = 'object' AND app_servicio.j_uuid(c -> 'template_id') THEN
                          CASE WHEN o = jsonb_array_length(v_tpls)
                               THEN c -> 'else' = 'true'::jsonb AND (SELECT count(*) FROM jsonb_object_keys(c)) = 2
                               ELSE c ->> 'if' = 'on_time' AND jsonb_typeof(c -> 'item_key') = 'string'
                                    AND (c ->> 'item_key') ~ '^it_[a-z0-9]{6}$' AND (SELECT count(*) FROM jsonb_object_keys(c)) = 3 END
                        ELSE false END) IS NOT TRUE) ELSE false END) THEN
        v := v || format('«%s»: las plantillas del certificado no son válidas', p_nm);
      ELSIF p_ws IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_tpls) c WHERE NOT EXISTS (
              SELECT 1 FROM public.design_templates t WHERE t.id = (c ->> 'template_id')::uuid AND t.workspace_id = p_ws AND t.doc_type = 'certificado')) THEN
        v := v || format('«%s»: la plantilla no es de un certificado de este negocio', p_nm);
      END IF;
    ELSIF NOT app_servicio.j_uuid(v_ref -> 'template_id') THEN
      v := v || 'Elegí la plantilla del certificado'::text;
    ELSIF p_ws IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.design_templates t WHERE t.id = (v_ref ->> 'template_id')::uuid AND t.workspace_id = p_ws AND t.doc_type = 'certificado'
    ) THEN
      v := v || format('«%s»: la plantilla no es de un certificado de este negocio', p_nm);
    END IF;
  ELSIF v_kind = 'open_section' THEN
    IF NOT COALESCE(v_ref ->> 'section' = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN
      v := v || format('«%s»: elegí la sección', p_nm);
    END IF;
  END IF;
  IF v_ref ? 'button' THEN
    v_btn := v_ref -> 'button';
    IF jsonb_typeof(v_btn) IS DISTINCT FROM 'object' THEN
      v := v || format('«%s»: el botón no es válido', p_nm);
    ELSE
      v_label := v_btn -> 'label';
      IF v_label IS NOT NULL AND jsonb_typeof(v_label) <> 'null' AND v_label <> '""'::jsonb THEN
        IF jsonb_typeof(v_label) <> 'string' OR char_length(v_label #>> '{}') > 40 OR (v_label #>> '{}') ~ '[\r\n]' THEN
          v := v || format('«%s»: el texto del botón tiene hasta 40 caracteres, en una línea', p_nm);
        END IF;
      END IF;
      v_url := v_btn -> 'url';
      IF v_url IS NOT NULL AND jsonb_typeof(v_url) <> 'null' AND v_url <> '""'::jsonb THEN
        IF NOT v_link_kind THEN
          v := v || format('«%s»: este paso ya lleva a su destino', p_nm);
        ELSIF jsonb_typeof(v_url) <> 'string' OR (v_url #>> '{}') !~ '^https://\S+$' OR char_length(v_url #>> '{}') > 2000 THEN
          v := v || format('«%s»: el link del botón tiene que empezar con https:// y no llevar espacios', p_nm);
          v_url_bad := true;
        ELSE
          v_url_ok := true;
        END IF;
      END IF;
    END IF;
  END IF;
  IF p_item -> 'portal_button' = 'true'::jsonb THEN
    IF p_item -> 'visible_to_client' = 'false'::jsonb THEN
      v := v || format('«%s»: para mostrar el botón, el cliente tiene que ver el paso', p_nm);
    ELSIF v_link_kind AND NOT v_url_ok AND NOT v_url_bad THEN
      v := v || format('«%s»: pegá el link del botón', p_nm);
    END IF;
  END IF;
  IF v_ref ? 'show_response' THEN
    IF jsonb_typeof(v_ref -> 'show_response') <> 'boolean' THEN
      v := v || format('«%s»: «El cliente puede ver su respuesta» no es válido', p_nm);
    ELSIF NOT (v_kind = ANY (ARRAY['form','survey','activity','quiz','contract'])) THEN
      v := v || format('«%s»: «El cliente puede ver su respuesta» es solo para pasos con formulario', p_nm);
    END IF;
  END IF;
  IF v_co = 'recorded' AND v_kind <> 'booking' THEN
    v := v || format('«%s»: «cuando hay grabación» es solo para pasos Reunión', p_nm);
  END IF;
  IF v_ref ? 'lock' THEN
    v_lock := v_ref -> 'lock';
    IF NOT (
         (jsonb_typeof(v_lock) = 'object' AND jsonb_typeof(v_lock -> 'after_item_key') = 'string'
          AND (v_lock ->> 'after_item_key') ~ '^it_[a-z0-9]{6}$' AND (SELECT count(*) FROM jsonb_object_keys(v_lock)) = 1)
      OR (jsonb_typeof(v_lock) = 'object' AND COALESCE(v_lock ->> 'from' = ANY (ARRAY['service_created','service_start','phase_start']), false)
          AND app_servicio.j_int(v_lock -> 'days') AND app_servicio.j_num(v_lock -> 'days') BETWEEN 0 AND 365
          AND (SELECT count(*) FROM jsonb_object_keys(v_lock)) = 2)
    ) THEN
      v := v || format('«%s»: el bloqueo no es válido', p_nm);
    END IF;
  END IF;
  IF v_ref ? 'evidence' THEN
    v_ev := v_ref -> 'evidence';
    IF NOT (v_kind = ANY (ARRAY['team_task','student_task','checkbox'])) THEN
      v := v || format('«%s»: la evidencia es solo para tareas y casillas', p_nm);
    ELSIF jsonb_typeof(v_ev) IS DISTINCT FROM 'object' OR v_ev -> 'required' IS DISTINCT FROM 'true'::jsonb
       OR jsonb_typeof(v_ev -> 'kinds') IS DISTINCT FROM 'array' OR jsonb_array_length(v_ev -> 'kinds') = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_ev -> 'kinds') k WHERE NOT COALESCE(k #>> '{}' = ANY (ARRAY['file','link','note']), false) OR jsonb_typeof(k) <> 'string')
       OR (SELECT count(DISTINCT k #>> '{}') FROM jsonb_array_elements(v_ev -> 'kinds') k) <> jsonb_array_length(v_ev -> 'kinds') THEN
      v := v || format('«%s»: elegí qué evidencia pide', p_nm);
    END IF;
  END IF;
  IF v_ref ? 'checklist' THEN
    IF NOT (v_kind = ANY (ARRAY['team_task','student_task'])) THEN
      v := v || format('«%s»: el checklist es solo para tareas', p_nm);
    ELSIF jsonb_typeof(v_ref -> 'checklist') IS DISTINCT FROM 'array' OR jsonb_array_length(v_ref -> 'checklist') > 20
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_ref -> 'checklist') c
                  WHERE jsonb_typeof(c) <> 'string' OR btrim(c #>> '{}') = '' OR char_length(c #>> '{}') > 200) THEN
      v := v || format('«%s»: el checklist tiene hasta 20 puntos de hasta 200 caracteres', p_nm);
    END IF;
  END IF;
  RETURN v;
END;
$function$;

-- ─── Permisos ────────────────────────────────────────────────────────────────
-- Las funciones reescritas conservan los suyos. Las nuevas:
REVOKE ALL ON FUNCTION app_servicio.svc_client_label(uuid), app_servicio.booking_round_candidate(public.bookings),
  app_servicio.booking_round_moved(), app_servicio.svc_series_request_fix(uuid), app_servicio.svc_end_meeting_series(uuid, text),
  app_servicio.svc_round_mark(uuid, text), app_servicio.services_meeting_series_hook()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.svc_client_label(uuid), app_servicio.booking_round_candidate(public.bookings),
  app_servicio.svc_series_request_fix(uuid), app_servicio.svc_end_meeting_series(uuid, text)
TO service_role;
GRANT EXECUTE ON FUNCTION app_servicio.svc_round_mark(uuid, text) TO authenticated, service_role;
