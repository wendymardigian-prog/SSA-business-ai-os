-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00333_app_servicio_engine  (Servicios v12, Corrida A1 · S04 · bloque SV1)
-- ============================================================================
-- El motor del servicio: crear (la UNICA entrada a services), copiar el camino, abrir fases,
-- completar y destildar pasos, plazos, repeticiones, avance, semaforo (con el de los items, F24),
-- extender, pausar y reanudar, responsable, completar, cancelar, confirmar y descartar.
--
-- Las reglas puras son funciones IMMUTABLE gemelas de lib/services/engine-rules.ts y comparten sus
-- casos (*.cases.json): svc_rule_met, svc_renewal_plan, svc_due_date, svc_phase_should_advance,
-- svc_occurrence_dates, svc_light, svc_extend_plan, svc_resume_plan, svc_owner_pick_plan y
-- svc_conditions_match (gemela de lib/assignment/conditions.ts).
--
-- Quien llama: las funciones que puede llamar una sesion (authenticated) piden su clave adentro y
-- respetan el alcance (can_see_service). Las llamadas del sistema (triggers, cron) marcan la
-- transaccion con app_servicio.as_system() y no piden clave.
--
-- Los accesos al portal (svc_grant_initial_access, svc_open_access, svc_cut_access,
-- svc_shift_access, svc_suspend_for_pause) quedan aca como puntos VACIOS: los reemplaza la 00338
-- (S09, bloque AC) con CREATE OR REPLACE. Abrir un modulo a una persona (svc_open_module) lo
-- reemplaza la 00339 (S10). Emitir el certificado de un paso lo encola un job (bloque CE).
--
-- Aditiva (funciones nuevas). Va ANTES de desplegar el codigo.
--
-- Cómo volver atrás: DROP de cada funcion app_servicio.svc_* creada aca y de
--   app_servicio.svc_progress_trigger (con su trigger trg_svc_items_progress en service_items).
-- Riesgo: medio.
-- ============================================================================

-- ─── 0. Ayudas ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.ws_tz(p_workspace_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(NULLIF((SELECT w.timezone FROM public.workspaces w WHERE w.id = p_workspace_id), ''), 'UTC');
$$;
CREATE OR REPLACE FUNCTION app_servicio.today_in(p_workspace_id uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (now() AT TIME ZONE app_servicio.ws_tz(p_workspace_id))::date;
$$;
CREATE OR REPLACE FUNCTION app_servicio.local_date(p_ts timestamptz, p_workspace_id uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_ts IS NULL THEN NULL ELSE (p_ts AT TIME ZONE app_servicio.ws_tz(p_workspace_id))::date END;
$$;
-- Las 23:59:59 de un dia en una zona.
CREATE OR REPLACE FUNCTION app_servicio.end_of_day(p_day date, p_tz text)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT ((p_day + 1)::timestamp AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'UTC')) - interval '1 second';
$$;

-- El sistema (triggers, cron) marca la transaccion: las funciones no piden clave.
CREATE OR REPLACE FUNCTION app_servicio.as_system()
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  SELECT set_config('app_servicio.system', 'on', true);
$$;
CREATE OR REPLACE FUNCTION app_servicio.is_system()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT auth.uid() IS NULL OR COALESCE(current_setting('app_servicio.system', true), '') = 'on';
$$;

CREATE OR REPLACE FUNCTION app_servicio.audit(p_workspace_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_changes jsonb, p_actor text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := COALESCE(p_actor, CASE WHEN app_servicio.is_system() THEN 'system' ELSE 'user' END);
BEGIN
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type, actor_label)
  VALUES (p_workspace_id, p_entity_type, p_entity_id, p_action, p_changes,
          CASE WHEN v_actor = 'user' THEN auth.uid() END,
          CASE WHEN v_actor = 'client' THEN 'system' ELSE v_actor END,
          CASE WHEN v_actor = 'client' THEN 'cliente' END);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.notify(p_workspace_id uuid, p_recipient uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_recipient IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (workspace_id, type, title, body, entity_type, entity_id, metadata, recipient_id)
  VALUES (p_workspace_id, p_type, p_title, p_body, p_entity_type, p_entity_id, COALESCE(p_metadata, '{}'::jsonb), p_recipient);
END;
$$;
CREATE OR REPLACE FUNCTION app_servicio.notify_admins(p_workspace_id uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT m.user_id FROM public.workspace_members m WHERE m.workspace_id = p_workspace_id AND m.role IN ('owner', 'admin') LOOP
    PERFORM app_servicio.notify(p_workspace_id, r.user_id, p_type, p_title, p_body, p_entity_type, p_entity_id, p_metadata);
  END LOOP;
END;
$$;

-- Un evento de Automatizaciones. Solo escalares, nunca booking_id. Nunca hace fallar lo que lo origina.
CREATE OR REPLACE FUNCTION app_servicio.emit(p_service app_servicio.services, p_event text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT app_servicio.module_on(p_service.workspace_id) THEN RETURN; END IF;
  PERFORM public.emit_automation_event(p_service.workspace_id, p_event, p_service.contact_id,
    jsonb_build_object('service_id', p_service.id, 'product_id', p_service.product_id, 'variant_id', p_service.product_variant_id,
                       'service_status', p_service.status) || COALESCE(p_extra, '{}'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'app_servicio.emit %: %', p_event, SQLERRM;
END;
$$;

-- Permiso de una sesion sobre un servicio: la clave y ver el servicio. El sistema pasa.
CREATE OR REPLACE FUNCTION app_servicio.require_service(p_service app_servicio.services, p_key text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF app_servicio.is_system() THEN RETURN; END IF;
  IF NOT public.has_permission(p_service.workspace_id, p_key) OR NOT app_servicio.can_see_service_row(p_service) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_get(p_service_id uuid, p_lock boolean DEFAULT false)
RETURNS app_servicio.services LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  IF p_lock THEN
    SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id FOR UPDATE;
  ELSE
    SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  END IF;
  IF s.id IS NULL THEN RAISE EXCEPTION 'No existe el servicio' USING ERRCODE = 'SV002'; END IF;
  RETURN s;
END;
$$;

-- ─── 1. Reglas puras (gemelas de lib/services/engine-rules.ts) ──────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_rule_met(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p ->> 'rule'
    WHEN 'any_payment' THEN COALESCE((p ->> 'hasAnyPaid')::boolean, false) AND COALESCE((p ->> 'collectedCents')::numeric, 0) > 0
    WHEN 'non_reservation' THEN COALESCE((p ->> 'hasNonReservationPaid')::boolean, false)
    WHEN 'percent' THEN COALESCE((p ->> 'totalCents')::numeric, 0) > 0 AND (p ->> 'value') IS NOT NULL
      AND (p ->> 'collectedCents')::numeric * 100 >= (p ->> 'value')::numeric * (p ->> 'totalCents')::numeric
    WHEN 'amount' THEN (p ->> 'value') IS NOT NULL AND COALESCE((p ->> 'collectedCents')::numeric, 0) >= (p ->> 'value')::numeric
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_renewal_plan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  prev jsonb := p -> 'prev';
  v_today date := (p ->> 'today')::date;
  v_status text; v_running boolean; v_ended date; v_ends date;
BEGIN
  IF prev IS NULL OR jsonb_typeof(prev) = 'null' OR prev ->> 'status' IN ('cancelled', 'pending_confirmation') THEN
    RETURN jsonb_build_object('action', 'new', 'startsOn', NULL);
  END IF;
  v_status := prev ->> 'status';
  v_running := v_status IN ('active', 'paused');
  v_ends := (prev ->> 'endsOn')::date;
  v_ended := COALESCE((prev ->> 'endedOn')::date, v_ends);
  IF NOT v_running AND v_ended IS NOT NULL AND (v_today - v_ended) > 60 THEN
    RETURN jsonb_build_object('action', 'recovery', 'startsOn', NULL);
  END IF;
  IF p ->> 'renewal' = 'extend' THEN RETURN jsonb_build_object('action', 'extend', 'startsOn', NULL); END IF;
  IF p ->> 'renewal' = 'ask' THEN RETURN jsonb_build_object('action', 'ask', 'startsOn', NULL); END IF;
  RETURN jsonb_build_object('action', 'new_linked', 'startsOn',
    CASE WHEN v_running AND v_ends IS NOT NULL AND v_ends >= v_today THEN to_char(v_ends + 1, 'YYYY-MM-DD') END);
END;
$$;

-- anchors: {serviceCreated, serviceStart, phaseStart, itemCompleted} (fechas YYYY-MM-DD)
CREATE OR REPLACE FUNCTION app_servicio.svc_due_date(p_rule jsonb, p_anchors jsonb)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_rule IS NULL OR jsonb_typeof(p_rule) <> 'object' THEN NULL ELSE
    (CASE p_rule ->> 'from'
      WHEN 'service_created' THEN (p_anchors ->> 'serviceCreated')::date
      WHEN 'service_start' THEN (p_anchors ->> 'serviceStart')::date
      WHEN 'phase_start' THEN (p_anchors ->> 'phaseStart')::date
      WHEN 'item_completed' THEN (p_anchors ->> 'itemCompleted')::date
     END) + COALESCE((p_rule ->> 'days')::integer, 0) END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_phase_should_advance(p_advance text, p_req_total integer, p_req_done integer, p_all_total integer, p_all_done integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_advance WHEN 'auto' THEN p_req_done >= p_req_total WHEN 'auto_all' THEN p_all_done >= p_all_total ELSE false END;
$$;

-- Las repeticiones que ya llegaron (occursOn <= p_upto). Devuelve [{index, occursOn, dueOn}].
CREATE OR REPLACE FUNCTION app_servicio.svc_occurrence_dates(p_recurrence jsonb, p_start date, p_phase_end date, p_service_end date, p_upto date)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_step integer := CASE p_recurrence ->> 'every' WHEN 'day' THEN 1 WHEN 'week' THEN 7
                       ELSE GREATEST(1, COALESCE((p_recurrence ->> 'n')::integer, 1)) END;
  v_limit date := CASE p_recurrence ->> 'until'
                    WHEN 'phase_end' THEN p_phase_end WHEN 'service_end' THEN p_service_end
                    WHEN 'n_days' THEN p_start + (GREATEST(1, COALESCE((p_recurrence ->> 'n_until')::integer, 1)) - 1) END;
  v_max integer := CASE WHEN p_recurrence ->> 'until' = 'n_times' THEN GREATEST(1, COALESCE((p_recurrence ->> 'n_until')::integer, 1)) ELSE 1000 END;
  v_out jsonb := '[]'::jsonb;
  v_day date;
  k integer;
BEGIN
  IF p_start IS NULL THEN RETURN v_out; END IF;
  FOR k IN 0 .. v_max - 1 LOOP
    v_day := p_start + k * v_step;
    EXIT WHEN v_limit IS NOT NULL AND v_day > v_limit;
    EXIT WHEN v_day > p_upto;
    v_out := v_out || jsonb_build_array(jsonb_build_object('index', k + 1, 'occursOn', to_char(v_day, 'YYYY-MM-DD'),
                                                           'dueOn', to_char(v_day + v_step - 1, 'YYYY-MM-DD')));
  END LOOP;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_day_word(n integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN n = 1 THEN '1 día' ELSE n::text || ' días' END;
$$;

-- El semaforo (F24). Entrada con la misma forma que LightInput de TS.
CREATE OR REPLACE FUNCTION app_servicio.svc_light(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_best_color text := 'green'; v_best_reason text := NULL;
  v_rank_best integer := 0;
  ph jsonb := p -> 'phase';
  lt jsonb := p -> 'late';
  it jsonb;
  v_d integer; v_color text; v_since integer; v_word text; v_reason text;
  w_color text := NULL; w_d integer; w_reason text;
  v_days integer; v_yd integer; v_rd integer; v_od integer; v_red integer; v_cnt integer;
  found_colors text[] := ARRAY[]::text[]; found_reasons text[] := ARRAY[]::text[];
  i integer;
BEGIN
  IF COALESCE((p ->> 'grey')::boolean, false) THEN RETURN jsonb_build_object('color', 'grey', 'reason', NULL); END IF;
  -- 1. Fase
  IF ph IS NOT NULL AND jsonb_typeof(ph) = 'object' THEN
    v_days := (ph ->> 'daysIn')::integer; v_yd := (ph ->> 'yellowDay')::integer; v_rd := (ph ->> 'redDay')::integer;
    IF v_rd IS NOT NULL AND v_days >= v_rd THEN
      found_colors := found_colors || 'red'::text; found_reasons := found_reasons || format('Fase %s · lleva %s · rojo desde el día %s', ph ->> 'name', app_servicio.svc_day_word(v_days), v_rd);
    ELSIF v_yd IS NOT NULL AND v_days >= v_yd THEN
      found_colors := found_colors || 'yellow'::text; found_reasons := found_reasons || format('Fase %s · lleva %s · amarillo desde el día %s', ph ->> 'name', app_servicio.svc_day_word(v_days), v_yd);
    END IF;
  END IF;
  -- 2. Pagos
  IF (p ->> 'oldestOverdueDays') IS NOT NULL THEN
    v_od := (p ->> 'oldestOverdueDays')::integer; v_red := (p ->> 'overdueRedDays')::integer;
    found_colors := found_colors || CASE WHEN v_od > v_red THEN 'red' ELSE 'yellow' END;
    found_reasons := found_reasons || format('Pago vencido hace %s', app_servicio.svc_day_word(v_od));
  END IF;
  -- 3. Entregas atrasadas
  IF lt IS NOT NULL AND jsonb_typeof(lt) = 'object' AND COALESCE((lt ->> 'enabled')::boolean, false) AND (lt ->> 'count')::integer > 0 THEN
    v_cnt := (lt ->> 'count')::integer;
    v_reason := format('%s %s en %s', v_cnt, CASE WHEN v_cnt = 1 THEN 'entrega atrasada' ELSE 'entregas atrasadas' END, lt ->> 'phaseName');
    IF v_cnt >= (lt ->> 'redAt')::integer THEN found_colors := found_colors || 'red'::text; found_reasons := found_reasons || v_reason;
    ELSIF v_cnt >= (lt ->> 'yellowAt')::integer THEN found_colors := found_colors || 'yellow'::text; found_reasons := found_reasons || v_reason;
    END IF;
  END IF;
  -- 4. Items vencidos con su regla
  FOR it IN SELECT x FROM jsonb_array_elements(COALESCE(p -> 'items', '[]'::jsonb)) x LOOP
    v_d := (it ->> 'daysOverdue')::integer;
    v_color := NULL; v_since := NULL;
    IF (it ->> 'redAfter') IS NOT NULL AND v_d >= (it ->> 'redAfter')::integer THEN v_color := 'red'; v_since := (it ->> 'redAfter')::integer;
    ELSIF (it ->> 'yellowAfter') IS NOT NULL AND v_d >= (it ->> 'yellowAfter')::integer THEN v_color := 'yellow'; v_since := (it ->> 'yellowAfter')::integer;
    END IF;
    CONTINUE WHEN v_color IS NULL;
    v_word := CASE v_color WHEN 'red' THEN 'rojo' ELSE 'amarillo' END;
    v_reason := CASE WHEN v_d = 0 THEN format('Ítem vence hoy: %s · %s desde el día %s', it ->> 'name', v_word, v_since)
                ELSE format('Ítem vencido hace %s: %s · %s desde el día %s', app_servicio.svc_day_word(v_d), it ->> 'name', v_word, v_since) END;
    IF w_color IS NULL
       OR (CASE v_color WHEN 'red' THEN 2 ELSE 1 END) > (CASE w_color WHEN 'red' THEN 2 ELSE 1 END)
       OR ((CASE v_color WHEN 'red' THEN 2 ELSE 1 END) = (CASE w_color WHEN 'red' THEN 2 ELSE 1 END) AND v_d > w_d) THEN
      w_color := v_color; w_d := v_d; w_reason := v_reason;
    END IF;
  END LOOP;
  IF w_color IS NOT NULL THEN found_colors := found_colors || w_color; found_reasons := found_reasons || w_reason; END IF;
  -- Gana el peor; con empate, el primero.
  FOR i IN 1 .. COALESCE(array_length(found_colors, 1), 0) LOOP
    IF (CASE found_colors[i] WHEN 'red' THEN 2 WHEN 'yellow' THEN 1 ELSE 0 END) > v_rank_best THEN
      v_rank_best := CASE found_colors[i] WHEN 'red' THEN 2 WHEN 'yellow' THEN 1 ELSE 0 END;
      v_best_color := found_colors[i]; v_best_reason := found_reasons[i];
    END IF;
  END LOOP;
  RETURN jsonb_build_object('color', v_best_color, 'reason', v_best_reason);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_extend_plan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_status text := p ->> 'status';
  v_today date := (p ->> 'today')::date;
  v_ends date := (p ->> 'endsOn')::date;
  v_n integer := (p ->> 'n')::integer;
  v_from text; v_base date; v_new date;
BEGIN
  IF NOT COALESCE(v_status = ANY (ARRAY['active','paused','completed']), false) THEN RETURN jsonb_build_object('ok', false, 'error', 'SV030'); END IF;
  IF p ->> 'mode' = 'end_date' THEN
    IF (p ->> 'endOn') IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SV032'); END IF;
    v_new := (p ->> 'endOn')::date;
  ELSE
    IF v_n IS NULL OR v_n < 1 THEN RETURN jsonb_build_object('ok', false, 'error', 'SV032'); END IF;
    v_from := COALESCE(p ->> 'from', CASE WHEN v_status IN ('active','paused') AND v_ends IS NOT NULL THEN 'current_end' ELSE 'today' END);
    v_base := CASE WHEN v_from = 'current_end' AND v_ends IS NOT NULL THEN v_ends ELSE v_today END;
    v_new := CASE p ->> 'unit' WHEN 'months' THEN (v_base + make_interval(months => v_n))::date
                               WHEN 'weeks' THEN v_base + v_n * 7 ELSE v_base + v_n END;
  END IF;
  IF v_new <= v_today THEN RETURN jsonb_build_object('ok', false, 'error', 'SV031'); END IF;
  RETURN jsonb_build_object('ok', true, 'newEnd', to_char(v_new, 'YYYY-MM-DD'), 'reactivate', v_status = 'completed');
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_resume_plan(p_paused_at timestamptz, p_now timestamptz, p_shift_days integer)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_shift_days IS NOT NULL THEN GREATEST(0, p_shift_days)
              ELSE GREATEST(0, ceil(extract(epoch FROM (p_now - p_paused_at)) / 86400.0)::integer) END;
$$;

-- El responsable (F96). Entrada con la forma de OwnerPickInput de TS.
CREATE OR REPLACE FUNCTION app_servicio.svc_owner_pick_rr(p jsonb, p_members jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT m FROM jsonb_array_elements_text(COALESCE(p_members, '[]'::jsonb)) m
  WHERE (p -> 'activeMembers') ? m
  ORDER BY COALESCE((p -> 'activeCounts' ->> m)::integer, 0), COALESCE(p -> 'lastAssignedAt' ->> m, ''), m
  LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION app_servicio.svc_owner_pick_plan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v text;
  live jsonb := COALESCE(p -> 'activeMembers', '[]'::jsonb);
BEGIN
  CASE p ->> 'mode'
    WHEN 'fixed' THEN v := CASE WHEN live ? (p ->> 'userId') THEN p ->> 'userId' END;
    WHEN 'round_robin' THEN v := app_servicio.svc_owner_pick_rr(p, p -> 'members');
    WHEN 'previous' THEN v := CASE WHEN live ? (p ->> 'previousOwner') THEN p ->> 'previousOwner' END;
    WHEN 'conditions' THEN
      v := CASE WHEN live ? (p ->> 'conditionUserId') THEN p ->> 'conditionUserId' END;
      IF v IS NULL AND jsonb_typeof(p -> 'conditionMembers') = 'array' THEN v := app_servicio.svc_owner_pick_rr(p, p -> 'conditionMembers'); END IF;
      IF v IS NULL AND jsonb_array_length(COALESCE(p -> 'members', '[]'::jsonb)) > 0 THEN v := app_servicio.svc_owner_pick_rr(p, p -> 'members'); END IF;
    ELSE v := NULL;
  END CASE;
  IF v IS NOT NULL THEN RETURN jsonb_build_object('userId', v, 'usedFallback', false); END IF;
  RETURN jsonb_build_object('userId', CASE WHEN live ? (p ->> 'fallback') THEN p ->> 'fallback' END, 'usedFallback', true);
END;
$$;

-- El arbol de condiciones (gemela de lib/assignment/conditions.ts).
CREATE OR REPLACE FUNCTION app_servicio.svc_condition_eval(p_c jsonb, p_ctx jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_c ->> 'operator'
    WHEN 'is' THEN a = e
    WHEN 'is_not' THEN a <> e
    WHEN 'contains' THEN e <> '' AND position(e IN a) > 0
    WHEN 'not_contains' THEN e <> '' AND position(e IN a) = 0
    WHEN 'starts_with' THEN e <> '' AND left(a, length(e)) = e
    WHEN 'is_empty' THEN a = ''
    WHEN 'is_not_empty' THEN a <> ''
    ELSE false END
  FROM (SELECT lower(btrim(COALESCE(p_ctx ->> (p_c ->> 'field'), ''))) AS a, lower(btrim(COALESCE(p_c ->> 'value', ''))) AS e) t;
$$;
CREATE OR REPLACE FUNCTION app_servicio.svc_conditions_match(p_tree jsonb, p_ctx jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_results boolean[] := ARRAY[]::boolean[];
  c jsonb; g jsonb; v_group boolean[];
  v_root text := COALESCE(p_tree ->> 'rootConjunction', 'and');
BEGIN
  FOR c IN SELECT x FROM jsonb_array_elements(COALESCE(p_tree -> 'conditions', '[]'::jsonb)) x LOOP
    v_results := v_results || app_servicio.svc_condition_eval(c, p_ctx);
  END LOOP;
  FOR g IN SELECT x FROM jsonb_array_elements(COALESCE(p_tree -> 'groups', '[]'::jsonb)) x LOOP
    CONTINUE WHEN jsonb_array_length(COALESCE(g -> 'conditions', '[]'::jsonb)) = 0;
    SELECT array_agg(app_servicio.svc_condition_eval(x, p_ctx)) INTO v_group FROM jsonb_array_elements(g -> 'conditions') x;
    v_results := v_results || CASE WHEN g ->> 'conjunction' = 'or' THEN true = ANY (v_group) ELSE NOT (false = ANY (v_group)) END;
  END LOOP;
  IF COALESCE(array_length(v_results, 1), 0) = 0 THEN RETURN false; END IF;
  RETURN CASE WHEN v_root = 'or' THEN true = ANY (v_results) ELSE NOT (false = ANY (v_results)) END;
END;
$$;

-- El contexto del contacto para las condiciones (gemela parcial de buildAssignmentContext: pais,
-- email, telefono, canal y primer/ultimo toque de la atribucion canonica).
CREATE OR REPLACE FUNCTION app_servicio.svc_contact_context(p_contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.contacts;
  v jsonb := '{}'::jsonb;
  f text; t jsonb; pre text;
  v_channel text;
BEGIN
  SELECT * INTO c FROM public.contacts WHERE id = p_contact_id;
  IF c.id IS NULL THEN RETURN v; END IF;
  FOREACH pre IN ARRAY ARRAY['first', 'last'] LOOP
    t := c.attribution -> (pre || '_touch');
    FOREACH f IN ARRAY ARRAY['source','medium','campaign','content','term','ad_id','adset_id','campaign_id','fbclid','gclid','ttclid',
                             'referrer_url','landing_page','origin','social_post_id','content_post_id'] LOOP
      v := v || jsonb_build_object(pre || '_' || f, COALESCE(t ->> f, ''));
    END LOOP;
    v := v || jsonb_build_object(pre || '_combined', lower(concat_ws('|', COALESCE(t ->> 'source', ''), COALESCE(t ->> 'medium', ''),
      COALESCE(t ->> 'campaign', ''), COALESCE(t ->> 'content', ''), COALESCE(t ->> 'term', ''))));
  END LOOP;
  SELECT ch.platform INTO v_channel FROM public.conversations cv JOIN public.channels ch ON ch.id = cv.channel_id
   WHERE cv.contact_id = p_contact_id ORDER BY cv.last_message_at DESC NULLS LAST LIMIT 1;
  RETURN v || jsonb_build_object('country', btrim(COALESCE(c.country, '')), 'channel', COALESCE(v_channel, ''),
    'has_email', CASE WHEN btrim(COALESCE(c.email, '')) <> '' THEN 'true' ELSE 'false' END,
    'has_phone', CASE WHEN btrim(COALESCE(c.phone, '')) <> '' OR btrim(COALESCE(c.whatsapp_phone, '')) <> '' THEN 'true' ELSE 'false' END);
END;
$$;

-- Elige al responsable de un servicio nuevo con la regla de su variante.
CREATE OR REPLACE FUNCTION app_servicio.svc_pick_owner(p_variant_id uuid, p_contact_id uuid, p_previous_owner uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_var public.product_variants;
  o jsonb;
  v_live jsonb; v_counts jsonb; v_last jsonb;
  v_ctx jsonb; r jsonb; v_cond_user text := NULL; v_cond_members jsonb := NULL;
BEGIN
  SELECT * INTO v_var FROM public.product_variants WHERE id = p_variant_id;
  o := COALESCE(v_var.service_settings -> 'owner', '{}'::jsonb);
  SELECT COALESCE(jsonb_agg(m.user_id::text), '[]'::jsonb) INTO v_live FROM public.workspace_members m WHERE m.workspace_id = v_var.workspace_id;
  SELECT COALESCE(jsonb_object_agg(owner_user_id::text, n), '{}'::jsonb) INTO v_counts
    FROM (SELECT s.owner_user_id, count(*) n FROM app_servicio.services s
          WHERE s.product_id = v_var.product_id AND s.status IN ('active','paused') AND s.owner_user_id IS NOT NULL GROUP BY 1) t;
  SELECT COALESCE(jsonb_object_agg(owner_user_id::text, last_at), '{}'::jsonb) INTO v_last
    FROM (SELECT s.owner_user_id, to_char(max(s.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') last_at FROM app_servicio.services s
          WHERE s.product_id = v_var.product_id AND s.owner_user_id IS NOT NULL GROUP BY 1) t;
  IF o ->> 'mode' = 'conditions' THEN
    v_ctx := app_servicio.svc_contact_context(p_contact_id);
    FOR r IN SELECT x FROM jsonb_array_elements(COALESCE(o -> 'conditions', '[]'::jsonb)) x LOOP
      CONTINUE WHEN COALESCE((r ->> 'is_active')::boolean, true) = false;
      IF app_servicio.svc_conditions_match(r -> 'conditions', v_ctx) THEN
        IF r #>> '{destination,type}' = 'user' THEN v_cond_user := r #>> '{destination,user_id}';
        ELSIF r #>> '{destination,type}' = 'round_robin' THEN v_cond_members := r #> '{destination,members}';
        END IF;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  RETURN app_servicio.svc_owner_pick_plan(jsonb_build_object(
    'mode', o ->> 'mode', 'userId', o ->> 'user_id', 'members', COALESCE(o -> 'members', '[]'::jsonb),
    'activeCounts', v_counts, 'lastAssignedAt', v_last, 'conditionUserId', v_cond_user, 'conditionMembers', v_cond_members,
    'previousOwner', p_previous_owner::text, 'fallback', o ->> 'fallback_user_id', 'activeMembers', v_live));
END;
$$;

-- ─── 2. Puntos vacios que completan otros bloques ───────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_grant_initial_access(p_service_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN; END; $$;
CREATE OR REPLACE FUNCTION app_servicio.svc_open_access(p_service_id uuid, p_section text, p_scope text, p_source text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN; END; $$;
-- p_reason: cancelled | refunded | completed | renewed
CREATE OR REPLACE FUNCTION app_servicio.svc_cut_access(p_service_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN; END; $$;
CREATE OR REPLACE FUNCTION app_servicio.svc_shift_access(p_service_id uuid, p_days integer, p_new_end date, p_extend_own boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN 0; END; $$;
CREATE OR REPLACE FUNCTION app_servicio.svc_suspend_for_pause(p_service_id uuid, p_suspend boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN; END; $$;
CREATE OR REPLACE FUNCTION app_servicio.svc_open_module(p_service_id uuid, p_program_item_id uuid, p_source text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN; END; $$;

-- ─── 3. Plazos ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_compute_due(p_item_id uuid)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  ph app_servicio.service_phases;
  v_done timestamptz;
  v_due date;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id;
  IF it.id IS NULL OR it.due_rule IS NULL OR it.parent_item_id IS NOT NULL OR it.is_recurring_template THEN RETURN NULL; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = it.phase_id;
  IF it.due_rule ->> 'from' = 'item_completed' THEN
    SELECT o.completed_at INTO v_done FROM app_servicio.service_items o
     WHERE o.service_id = it.service_id AND o.template_key = it.due_rule ->> 'item_key' AND o.parent_item_id IS NULL AND o.status = 'completed';
  END IF;
  v_due := app_servicio.svc_due_date(it.due_rule, jsonb_build_object(
    'serviceCreated', app_servicio.local_date(s.created_at, s.workspace_id),
    'serviceStart', s.starts_on,
    'phaseStart', app_servicio.local_date(ph.started_at, s.workspace_id),
    'itemCompleted', app_servicio.local_date(v_done, s.workspace_id)));
  UPDATE app_servicio.service_items SET due_on = v_due WHERE id = p_item_id AND due_on IS DISTINCT FROM v_due;
  IF it.task_id IS NOT NULL THEN
    UPDATE public.tasks SET due_date = v_due WHERE id = it.task_id AND status <> 'completed' AND due_date IS DISTINCT FROM v_due;
  END IF;
  RETURN v_due;
END;
$$;

-- ─── 4. Tareas del equipo (F20) ─────────────────────────────────────────────
-- Un paso "del equipo" crea UNA tarea al abrirse su fase (o crearse su repeticion). Una sola vez:
-- service_items.task_id se escribe bajo el candado del servicio.
CREATE OR REPLACE FUNCTION app_servicio.svc_ensure_task(p_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  INSERT INTO public.tasks (workspace_id, title, description, status, priority, due_date, owner_id, contact_id, source, source_ref, created_by)
  VALUES (s.workspace_id, left(it.name, 200), it.description, 'pending', 'normal',
          COALESCE(it.due_on, app_servicio.local_date(it.due_at, s.workspace_id)), v_owner, s.contact_id, 'cx', 'svc_item:' || it.id::text, NULL)
  RETURNING id INTO v_task;
  UPDATE app_servicio.service_items SET task_id = v_task WHERE id = it.id;
  IF v_owner IS NOT NULL THEN
    PERFORM app_servicio.notify(s.workspace_id, v_owner, 'task_assigned', 'Tenés una tarea nueva', it.name, 'task', v_task,
                                jsonb_build_object('service_id', s.id));
  END IF;
END;
$$;

-- ─── 5. Repeticiones (F21) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_generate_occurrences(p_service_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  m app_servicio.service_items;
  ph app_servicio.service_phases;
  v_tz text; v_student_tz text; v_today date; v_start date; v_phase_start date;
  v_occ jsonb; o jsonb; v_created integer := 0; v_new uuid;
  v_grace integer;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR s.status <> 'active' OR NOT app_servicio.module_on(s.workspace_id) THEN RETURN 0; END IF;
  v_tz := app_servicio.ws_tz(s.workspace_id);
  -- Las repeticiones que hace el estudiante usan SU zona (con la del negocio de respaldo).
  SELECT COALESCE(NULLIF(c.timezone, ''), v_tz) INTO v_student_tz FROM public.contacts c WHERE c.id = s.contact_id;
  v_today := (now() AT TIME ZONE v_student_tz)::date;
  FOR m IN SELECT i.* FROM app_servicio.service_items i JOIN app_servicio.service_phases p ON p.id = i.phase_id
            WHERE i.service_id = p_service_id AND i.is_recurring_template AND p.status = 'in_progress' LOOP
    SELECT * INTO ph FROM app_servicio.service_phases WHERE id = m.phase_id;
    v_phase_start := app_servicio.local_date(ph.started_at, s.workspace_id);
    v_start := COALESCE(app_servicio.svc_due_date(m.recurrence -> 'from', jsonb_build_object(
                 'serviceCreated', app_servicio.local_date(s.created_at, s.workspace_id), 'serviceStart', s.starts_on,
                 'phaseStart', v_phase_start)), v_phase_start);
    v_occ := app_servicio.svc_occurrence_dates(m.recurrence, v_start,
               CASE WHEN ph.duration_days IS NOT NULL THEN v_phase_start + ph.duration_days - 1 END, s.ends_on, v_today);
    v_grace := COALESCE((m.late ->> 'grace_hours')::integer, 0);
    FOR o IN SELECT x FROM jsonb_array_elements(v_occ) x LOOP
      INSERT INTO app_servicio.service_items (workspace_id, service_id, phase_id, template_key, kind, name, description, required, assignee,
        assignee_user_id, visible_to_client, portal_button, ref, late, reminders, parent_item_id, occurrence_index, position,
        yellow_after_days, red_after_days, due_on, due_at)
      VALUES (s.workspace_id, s.id, m.phase_id, m.template_key, m.kind, m.name, m.description, m.required, m.assignee,
        m.assignee_user_id, m.visible_to_client, m.portal_button, m.ref, m.late, m.reminders, m.id, (o ->> 'index')::integer,
        m.position, m.yellow_after_days, m.red_after_days, (o ->> 'dueOn')::date,
        app_servicio.end_of_day((o ->> 'dueOn')::date, v_student_tz) + make_interval(hours => v_grace))
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
$$;

-- ─── 6. Copiar el camino y abrir fases (F14, F16, F19, F22) ─────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_instantiate_journey(p_service_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_tpl jsonb;
  ph jsonb; it jsonb;
  v_phase_id uuid;
  v_pos integer := 0; v_ipos integer;
  v_first uuid := NULL;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF EXISTS (SELECT 1 FROM app_servicio.service_phases WHERE service_id = p_service_id) THEN RETURN 0; END IF;
  SELECT pv.journey_template INTO v_tpl FROM public.product_variants pv WHERE pv.id = s.product_variant_id;
  FOR ph IN SELECT x FROM jsonb_array_elements(COALESCE(v_tpl -> 'phases', '[]'::jsonb)) x LOOP
    v_pos := v_pos + 1;
    INSERT INTO app_servicio.service_phases (workspace_id, service_id, template_key, name, position, status, duration_days, yellow_day, red_day,
      advance, challenge, late_light)
    VALUES (s.workspace_id, s.id, ph ->> 'key', ph ->> 'name', v_pos, 'pending', (ph ->> 'duration_days')::integer, (ph ->> 'yellow_day')::integer,
      (ph ->> 'red_day')::integer, COALESCE(ph ->> 'advance', 'auto'), NULLIF(ph -> 'challenge', 'null'::jsonb), NULLIF(ph -> 'late_light', 'null'::jsonb))
    RETURNING id INTO v_phase_id;
    IF v_first IS NULL THEN v_first := v_phase_id; END IF;
    v_ipos := 0;
    FOR it IN SELECT x FROM jsonb_array_elements(COALESCE(ph -> 'items', '[]'::jsonb)) x LOOP
      v_ipos := v_ipos + 1;
      INSERT INTO app_servicio.service_items (workspace_id, service_id, phase_id, template_key, kind, name, description, required, assignee,
        assignee_user_id, visible_to_client, portal_button, ref, due_rule, recurrence, late, reminders, is_recurring_template, position,
        yellow_after_days, red_after_days)
      VALUES (s.workspace_id, s.id, v_phase_id, it ->> 'key', it ->> 'kind', it ->> 'name', it ->> 'description', COALESCE((it ->> 'required')::boolean, true),
        COALESCE(it ->> 'assignee', 'student'), (it ->> 'assignee_user_id')::uuid, COALESCE((it ->> 'visible_to_client')::boolean, true),
        COALESCE((it ->> 'portal_button')::boolean, false), COALESCE(NULLIF(it -> 'ref', 'null'::jsonb), '{}'::jsonb),
        NULLIF(it -> 'due_rule', 'null'::jsonb), NULLIF(it -> 'recurrence', 'null'::jsonb), NULLIF(it -> 'late', 'null'::jsonb),
        NULLIF(it -> 'reminders', 'null'::jsonb), (it -> 'recurrence') IS NOT NULL AND jsonb_typeof(it -> 'recurrence') = 'object', v_ipos,
        (it #>> '{light,yellow_after_days}')::integer, (it #>> '{light,red_after_days}')::integer);
    END LOOP;
  END LOOP;
  -- La primera fase se abre si el servicio ya empezo; si empieza en el futuro, la abre el cron ese dia.
  IF v_first IS NOT NULL AND (s.starts_on IS NULL OR s.starts_on <= app_servicio.today_in(s.workspace_id)) THEN
    PERFORM app_servicio.svc_open_phase(v_first);
  END IF;
  RETURN v_pos;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_open_phase(p_phase_id uuid, p_force boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ph app_servicio.service_phases;
  s app_servicio.services;
  it record;
  v_start text;
BEGIN
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = p_phase_id FOR UPDATE;
  IF ph.id IS NULL OR ph.status <> 'pending' THEN RETURN; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = ph.service_id;
  -- La fase Reto que arranca el estudiante, una automatizacion o una fecha fija futura queda esperando.
  IF NOT p_force AND ph.challenge IS NOT NULL AND COALESCE((ph.challenge ->> 'enabled')::boolean, false) THEN
    v_start := ph.challenge ->> 'start';
    IF v_start IN ('student', 'automation')
       OR (v_start = 'fixed_date' AND (ph.challenge ->> 'fixed_date')::date > app_servicio.today_in(s.workspace_id)) THEN
      UPDATE app_servicio.service_phases SET awaiting_start = true WHERE id = ph.id;
      RETURN;
    END IF;
  END IF;
  UPDATE app_servicio.service_phases SET status = 'in_progress', started_at = now(), awaiting_start = false WHERE id = ph.id;
  FOR it IN SELECT id FROM app_servicio.service_items WHERE phase_id = ph.id AND parent_item_id IS NULL AND NOT is_recurring_template LOOP
    PERFORM app_servicio.svc_compute_due(it.id);
    PERFORM app_servicio.svc_ensure_task(it.id);
  END LOOP;
  -- Los pasos de fases todavia no abiertas que dependen del inicio del servicio tambien se calculan.
  PERFORM app_servicio.svc_generate_occurrences(s.id);
  PERFORM app_servicio.audit(s.workspace_id, 'service_phase', ph.id, 'svc.phase_started', jsonb_build_object('service_id', s.id, 'phase_key', ph.template_key));
  PERFORM app_servicio.emit(s, 'service_phase_started', jsonb_build_object('phase_key', ph.template_key));
  IF ph.challenge IS NOT NULL AND COALESCE((ph.challenge ->> 'enabled')::boolean, false) THEN
    PERFORM app_servicio.emit(s, 'challenge_started', jsonb_build_object('phase_key', ph.template_key));
  END IF;
  PERFORM app_servicio.svc_check_open_items(ph.id);
  PERFORM app_servicio.svc_try_advance_phase(s.id);
END;
$$;

-- "Se abre una seccion" y "Se abre un modulo o clase" se completan solos cuando estan completos todos
-- los pasos anteriores de su fase (F19, F100).
CREATE OR REPLACE FUNCTION app_servicio.svc_check_open_items(p_phase_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it app_servicio.service_items;
BEGIN
  FOR it IN SELECT i.* FROM app_servicio.service_items i
             WHERE i.phase_id = p_phase_id AND i.status = 'pending' AND i.kind IN ('open_section', 'open_module') AND i.parent_item_id IS NULL
             ORDER BY i.position LOOP
    IF NOT EXISTS (SELECT 1 FROM app_servicio.service_items o
                   WHERE o.phase_id = p_phase_id AND o.position < it.position AND o.status <> 'completed' AND NOT o.is_recurring_template) THEN
      IF it.kind = 'open_section' THEN
        PERFORM app_servicio.svc_open_access(it.service_id, it.ref ->> 'section', COALESCE(it.ref ->> 'scope', 'product'), 'journey_item');
      ELSE
        PERFORM app_servicio.svc_open_module(it.service_id, (it.ref ->> 'program_item_id')::uuid, 'journey_item');
      END IF;
      PERFORM app_servicio.svc_mark_item(it.id, 'auto', 'system', NULL);
    END IF;
  END LOOP;
END;
$$;

-- ─── 7. Completar y destildar pasos ─────────────────────────────────────────
-- El nucleo (sin permisos): lo usan la accion de una persona, los triggers y el cron.
CREATE OR REPLACE FUNCTION app_servicio.svc_mark_item(p_item_id uuid, p_source text, p_by_kind text, p_by uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  ph app_servicio.service_phases;
  d record;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR it.status = 'completed' OR it.is_recurring_template THEN RETURN false; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = it.phase_id;
  UPDATE app_servicio.service_items
     SET status = 'completed', completed_at = now(), completed_by_kind = p_by_kind, completed_by = p_by, completed_source = p_source
   WHERE id = it.id;
  IF it.task_id IS NOT NULL THEN
    UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = it.task_id AND status <> 'completed';
  END IF;
  -- Los pasos que vencen "al completar este" ya tienen fecha.
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
$$;

-- Una persona tilda un paso: services.items con su alcance (own = los pasos a su cargo).
CREATE OR REPLACE FUNCTION app_servicio.svc_complete_item(p_item_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id;
  IF it.id IS NULL THEN RAISE EXCEPTION 'No existe el paso' USING ERRCODE = 'SV002'; END IF;
  s := app_servicio.svc_get(it.service_id);
  PERFORM app_servicio.svc_require_item(s, it);
  RETURN app_servicio.svc_mark_item(it.id, 'manual', 'user', auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_require_item(s app_servicio.services, it app_servicio.service_items)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF app_servicio.is_system() THEN RETURN; END IF;
  IF NOT public.has_permission(s.workspace_id, 'services.items') OR NOT app_servicio.can_see_service_row(s) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF public.permission_scope(s.workspace_id, 'services') <> 'all'
     AND NOT ((it.assignee = 'owner' AND s.owner_user_id = auth.uid()) OR (it.assignee = 'user' AND it.assignee_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Este paso no está a tu cargo' USING ERRCODE = 'SV004';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_uncomplete_item(p_item_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  ph app_servicio.service_phases;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'No existe el paso' USING ERRCODE = 'SV002'; END IF;
  s := app_servicio.svc_get(it.service_id);
  PERFORM app_servicio.svc_require_item(s, it);
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = it.phase_id;
  IF ph.status = 'completed' THEN
    RAISE EXCEPTION 'Un paso de una fase cerrada no se destilda' USING ERRCODE = 'SV020';
  END IF;
  IF it.status <> 'completed' THEN RETURN false; END IF;
  UPDATE app_servicio.service_items SET status = 'pending', completed_at = NULL, completed_by_kind = NULL, completed_by = NULL, completed_source = NULL
   WHERE id = it.id;
  IF it.task_id IS NOT NULL THEN
    UPDATE public.tasks SET status = 'pending', completed_at = NULL WHERE id = it.task_id AND status = 'completed';
  END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.item_uncompleted', jsonb_build_object('service_id', s.id, 'item_key', it.template_key));
  PERFORM app_servicio.svc_compute_light(s.id);
  RETURN true;
END;
$$;

-- ─── 8. Avance de fase (F16) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_try_advance_phase(p_service_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  ph app_servicio.service_phases;
  v_next uuid;
  rt integer; rd integer; at integer; ad integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('svc_advance:' || p_service_id::text, 0));
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.status <> 'active' THEN RETURN false; END IF;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE service_id = p_service_id AND status = 'in_progress';
  IF ph.id IS NULL THEN RETURN false; END IF;
  SELECT count(*) FILTER (WHERE required), count(*) FILTER (WHERE required AND status = 'completed'),
         count(*), count(*) FILTER (WHERE status = 'completed')
    INTO rt, rd, at, ad
    FROM app_servicio.service_items WHERE phase_id = ph.id AND NOT is_recurring_template;
  IF NOT app_servicio.svc_phase_should_advance(ph.advance, rt, rd, at, ad) THEN RETURN false; END IF;
  UPDATE app_servicio.service_phases SET status = 'completed', completed_at = now(), completed_via = 'auto' WHERE id = ph.id;
  PERFORM app_servicio.audit(s.workspace_id, 'service_phase', ph.id, 'svc.phase_completed', jsonb_build_object('service_id', s.id, 'phase_key', ph.template_key));
  PERFORM app_servicio.emit(s, 'service_phase_completed', jsonb_build_object('phase_key', ph.template_key));
  IF ph.challenge IS NOT NULL AND COALESCE((ph.challenge ->> 'enabled')::boolean, false) THEN
    PERFORM app_servicio.emit(s, 'challenge_completed', jsonb_build_object('phase_key', ph.template_key));
  END IF;
  SELECT id INTO v_next FROM app_servicio.service_phases WHERE service_id = p_service_id AND status = 'pending' AND position > ph.position ORDER BY position LIMIT 1;
  IF v_next IS NULL THEN
    PERFORM app_servicio.svc_finish(p_service_id, 'Completó el camino');
  ELSE
    PERFORM app_servicio.svc_open_phase(v_next);
  END IF;
  RETURN true;
END;
$$;

-- El nucleo de "cambiar de fase a mano" (sin permisos): lo usan la accion y la carga inicial.
CREATE OR REPLACE FUNCTION app_servicio.svc_move_core(p_service_id uuid, p_phase_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  target app_servicio.service_phases;
  cur app_servicio.service_phases;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  SELECT * INTO target FROM app_servicio.service_phases WHERE id = p_phase_id AND service_id = p_service_id;
  IF target.id IS NULL THEN RAISE EXCEPTION 'No existe la fase' USING ERRCODE = 'SV002'; END IF;
  SELECT * INTO cur FROM app_servicio.service_phases WHERE service_id = p_service_id AND status = 'in_progress';
  IF cur.id = target.id THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('svc_advance:' || p_service_id::text, 0));
  -- Las salteadas (y la actual) quedan completadas como "movidas a mano"; las posteriores vuelven a pendiente.
  UPDATE app_servicio.service_phases SET status = 'completed', completed_at = now(), completed_via = 'manual_move', awaiting_start = false
   WHERE service_id = p_service_id AND position < target.position AND status <> 'completed';
  UPDATE app_servicio.service_phases SET status = 'pending', started_at = NULL, completed_at = NULL, completed_via = NULL
   WHERE service_id = p_service_id AND position > target.position AND status <> 'pending';
  IF target.status <> 'pending' THEN
    UPDATE app_servicio.service_phases SET status = 'pending', started_at = NULL, completed_at = NULL, completed_via = NULL WHERE id = target.id;
  END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.phase_moved',
    jsonb_build_object('from_phase', cur.template_key, 'to_phase', target.template_key, 'reason', p_reason));
  PERFORM app_servicio.svc_open_phase(target.id, true);
  PERFORM app_servicio.svc_compute_light(s.id);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_move_to_phase(p_service_id uuid, p_phase_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.change_phase');
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016'; END IF;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'El servicio no está activo' USING ERRCODE = 'SV017'; END IF;
  PERFORM app_servicio.svc_move_core(p_service_id, p_phase_id, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_start_challenge(p_service_id uuid, p_actor text DEFAULT 'team')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  ph app_servicio.service_phases;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  IF p_actor = 'team' THEN PERFORM app_servicio.require_service(s, 'services.change_phase'); END IF;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE service_id = p_service_id AND awaiting_start ORDER BY position LIMIT 1;
  IF ph.id IS NULL OR s.status <> 'active' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM app_servicio.service_phases WHERE service_id = p_service_id AND status = 'in_progress') THEN RETURN false; END IF;
  PERFORM app_servicio.svc_open_phase(ph.id, true);
  RETURN true;
END;
$$;

-- ─── 9. Avance y semaforo ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_progress_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_service uuid := COALESCE(NEW.service_id, OLD.service_id);
  v_total integer; v_done integer;
BEGIN
  SELECT count(*) FILTER (WHERE required AND NOT is_recurring_template),
         count(*) FILTER (WHERE required AND NOT is_recurring_template AND status = 'completed')
    INTO v_total, v_done FROM app_servicio.service_items WHERE service_id = v_service;
  UPDATE app_servicio.services
     SET progress_pct = CASE WHEN v_total = 0 THEN NULL ELSE round(v_done * 100.0 / v_total, 2) END
   WHERE id = v_service AND progress_pct IS DISTINCT FROM CASE WHEN v_total = 0 THEN NULL ELSE round(v_done * 100.0 / v_total, 2) END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_svc_items_progress ON app_servicio.service_items;
CREATE TRIGGER trg_svc_items_progress
  AFTER INSERT OR UPDATE OF status, required OR DELETE ON app_servicio.service_items
  FOR EACH ROW EXECUTE FUNCTION app_servicio.svc_progress_trigger();

CREATE OR REPLACE FUNCTION app_servicio.svc_compute_light(p_service_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  ph app_servicio.service_phases;
  v_today date;
  v_grey boolean;
  v_phase jsonb := NULL; v_late jsonb := NULL; v_items jsonb;
  v_overdue integer := NULL; v_red_days integer;
  v_result jsonb;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  v_today := app_servicio.today_in(s.workspace_id);
  SELECT * INTO ph FROM app_servicio.service_phases WHERE service_id = s.id AND status = 'in_progress';
  v_grey := s.status <> 'active' OR s.is_test OR (s.starts_on IS NOT NULL AND s.starts_on > v_today);
  IF NOT v_grey THEN
    IF ph.id IS NOT NULL THEN
      v_phase := jsonb_build_object('name', ph.name, 'daysIn', v_today - app_servicio.local_date(ph.started_at, s.workspace_id),
                                    'yellowDay', ph.yellow_day, 'redDay', ph.red_day);
      IF ph.late_light IS NOT NULL THEN
        v_late := jsonb_build_object('enabled', COALESCE((ph.late_light ->> 'enabled')::boolean, false),
          'yellowAt', COALESCE((ph.late_light ->> 'yellow_at')::integer, 1), 'redAt', COALESCE((ph.late_light ->> 'red_at')::integer, 3),
          'phaseName', ph.name,
          'count', (SELECT count(*) FROM app_servicio.service_items i WHERE i.phase_id = ph.id AND i.parent_item_id IS NOT NULL
                     AND i.status = 'pending' AND i.due_at < now()));
      END IF;
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', i.name,
               'daysOverdue', v_today - COALESCE(i.due_on, app_servicio.local_date(i.due_at, s.workspace_id)),
               'yellowAfter', i.yellow_after_days, 'redAfter', i.red_after_days)), '[]'::jsonb)
        INTO v_items
        FROM app_servicio.service_items i
       WHERE i.phase_id = ph.id AND i.status = 'pending' AND NOT i.is_recurring_template
         AND (i.yellow_after_days IS NOT NULL OR i.red_after_days IS NOT NULL)
         AND COALESCE(i.due_on, app_servicio.local_date(i.due_at, s.workspace_id)) <= v_today;
    END IF;
    IF s.sale_id IS NOT NULL THEN
      SELECT max(v_today - p.due_date) INTO v_overdue FROM public.payments p
       WHERE p.sale_id = s.sale_id AND p.status = 'overdue' AND p.due_date IS NOT NULL;
    END IF;
    SELECT COALESCE((pv.service_settings #>> '{light,overdue_red_days}')::integer, 15) INTO v_red_days
      FROM public.product_variants pv WHERE pv.id = s.product_variant_id;
  END IF;
  v_result := app_servicio.svc_light(jsonb_build_object('grey', v_grey, 'phase', v_phase, 'oldestOverdueDays', v_overdue,
    'overdueRedDays', COALESCE(v_red_days, 15), 'late', v_late, 'items', COALESCE(v_items, '[]'::jsonb)));
  IF s.light IS DISTINCT FROM (v_result ->> 'color') OR s.light_reason IS DISTINCT FROM (v_result ->> 'reason') THEN
    UPDATE app_servicio.services SET light = v_result ->> 'color', light_reason = v_result ->> 'reason', light_at = now() WHERE id = s.id;
    IF s.light IS DISTINCT FROM (v_result ->> 'color') THEN
      PERFORM app_servicio.emit(s, 'service_light_changed', jsonb_build_object('light', v_result ->> 'color', 'previous_light', s.light));
    END IF;
  END IF;
  RETURN v_result;
END;
$$;

-- ─── 10. Crear (la UNICA entrada a services, F8) ────────────────────────────
-- p: {workspace_id?, contact_id, product_id?, variant_id, sale_id?, origin, origin_reason?, status?, starts_on?,
--     ends_on?, owner_user_id?, previous_service_id?, flags?, off_rule?}
CREATE OR REPLACE FUNCTION app_servicio.svc_create_service(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_contact public.contacts;
  v_var public.product_variants;
  v_product public.products;
  v_sale public.sales;
  v_existing uuid;
  v_origin text := COALESCE(p ->> 'origin', 'manual');
  v_status text := COALESCE(p ->> 'status', 'active');
  v_reason text := nullif(btrim(p ->> 'origin_reason'), '');
  v_start date; v_end date; v_owner uuid; v_pick jsonb;
  v_id uuid;
  s app_servicio.services;
BEGIN
  SELECT * INTO v_contact FROM public.contacts WHERE id = (p ->> 'contact_id')::uuid;
  IF v_contact.id IS NULL THEN RAISE EXCEPTION 'No existe el contacto' USING ERRCODE = 'SV002'; END IF;
  IF p ? 'workspace_id' AND (p ->> 'workspace_id')::uuid <> v_contact.workspace_id THEN RAISE EXCEPTION 'El contacto es de otro negocio' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() THEN
    IF NOT public.is_workspace_member(v_contact.workspace_id) OR NOT public.has_permission(v_contact.workspace_id, 'services.create') THEN
      RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
    END IF;
  END IF;
  IF NOT COALESCE(v_origin = ANY (ARRAY['sale','courtesy','test','manual','recovery']), false) THEN
    RAISE EXCEPTION 'Origen desconocido' USING ERRCODE = 'SV012';
  END IF;
  SELECT * INTO v_var FROM public.product_variants WHERE id = (p ->> 'variant_id')::uuid AND workspace_id = v_contact.workspace_id;
  IF v_var.id IS NULL THEN RAISE EXCEPTION 'Elegí la variante' USING ERRCODE = 'SV012'; END IF;
  SELECT * INTO v_product FROM public.products WHERE id = v_var.product_id;
  IF p ? 'sale_id' AND (p ->> 'sale_id') IS NOT NULL THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = (p ->> 'sale_id')::uuid AND workspace_id = v_contact.workspace_id;
    IF v_sale.id IS NULL OR v_sale.contact_id <> v_contact.id THEN RAISE EXCEPTION 'La venta no es de este contacto' USING ERRCODE = 'SV002'; END IF;
    SELECT id INTO v_existing FROM app_servicio.services WHERE sale_id = v_sale.id;
    IF v_existing IS NOT NULL THEN
      RAISE EXCEPTION 'Esta venta ya tiene su servicio' USING ERRCODE = 'SV013', DETAIL = v_existing::text;
    END IF;
  ELSIF v_reason IS NULL THEN
    RAISE EXCEPTION 'Sin venta, escribí el motivo' USING ERRCODE = 'SV012';
  END IF;
  -- Crear desde una venta que no cumple la regla pide su clave y motivo (F95).
  IF COALESCE((p ->> 'off_rule')::boolean, false) AND NOT app_servicio.is_system() THEN
    IF NOT public.has_permission(v_contact.workspace_id, 'services.create_off_rule') THEN
      RAISE EXCEPTION 'No tenés permiso para crear un servicio fuera de la regla' USING ERRCODE = 'SV004';
    END IF;
    IF v_reason IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV014'; END IF;
  END IF;

  -- Fechas (F9): un Evento empieza en su fecha; si no, la que llega o hoy.
  v_start := COALESCE((p ->> 'starts_on')::date,
                      CASE WHEN v_product.product_type = 'evento' THEN v_var.event_date END,
                      app_servicio.today_in(v_contact.workspace_id));
  v_end := COALESCE((p ->> 'ends_on')::date, CASE v_var.duration_type
             WHEN 'days' THEN v_start + v_var.duration_value - 1
             WHEN 'weeks' THEN v_start + v_var.duration_value * 7 - 1
             WHEN 'months' THEN (v_start + make_interval(months => v_var.duration_value))::date - 1
             ELSE NULL END);
  v_owner := (p ->> 'owner_user_id')::uuid;
  IF v_owner IS NULL AND v_status <> 'pending_confirmation' THEN
    v_pick := app_servicio.svc_pick_owner(v_var.id, v_contact.id,
      (SELECT owner_user_id FROM app_servicio.services WHERE id = (p ->> 'previous_service_id')::uuid));
    v_owner := (v_pick ->> 'userId')::uuid;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'Elegí el responsable' USING ERRCODE = 'SV015'; END IF;
  ELSIF v_owner IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = v_contact.workspace_id AND m.user_id = v_owner) THEN
    RAISE EXCEPTION 'El responsable no es del equipo' USING ERRCODE = 'SV015';
  END IF;

  BEGIN
    INSERT INTO app_servicio.services (workspace_id, contact_id, product_id, product_variant_id, sale_id, origin, origin_reason, previous_service_id,
      status, starts_on, ends_on, owner_user_id, product_snapshot, price_cents, currency, is_test, flags, created_by)
    VALUES (v_contact.workspace_id, v_contact.id, v_var.product_id, v_var.id, v_sale.id, v_origin, v_reason, (p ->> 'previous_service_id')::uuid,
      v_status, v_start, v_end, v_owner,
      jsonb_build_object('product_name', v_product.name, 'product_type', v_product.product_type, 'variant_name', v_var.name,
                         'duration_type', v_var.duration_type, 'duration_value', v_var.duration_value, 'event_date', v_var.event_date),
      CASE WHEN v_sale.id IS NOT NULL THEN round(v_sale.final_amount * 100)::bigint ELSE round(v_var.price * 100)::bigint END,
      COALESCE(v_sale.currency, 'USD'), v_origin = 'test',
      COALESCE(p -> 'flags', '{}'::jsonb) || CASE WHEN v_pick IS NOT NULL AND (v_pick ->> 'usedFallback')::boolean THEN '{"owner_fallback": true}'::jsonb ELSE '{}'::jsonb END,
      auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing FROM app_servicio.services WHERE sale_id = v_sale.id;
    RAISE EXCEPTION 'Esta venta ya tiene su servicio' USING ERRCODE = 'SV013', DETAIL = COALESCE(v_existing::text, '');
  END;
  SELECT * INTO s FROM app_servicio.services WHERE id = v_id;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.created',
    jsonb_build_object('origin', v_origin, 'status', v_status, 'sale_id', v_sale.id, 'variant_id', v_var.id, 'reason', v_reason));
  IF v_pick IS NOT NULL AND (v_pick ->> 'usedFallback')::boolean THEN
    PERFORM app_servicio.notify_admins(s.workspace_id, 'svc_owner_fallback', 'Servicio a nombre del respaldo',
      'La regla del responsable no encontró a nadie activo: el servicio quedó a nombre de la persona de respaldo.', 'service', s.id);
  END IF;
  IF v_status = 'active' THEN
    PERFORM app_servicio.svc_activate(s.id);
    -- Carga inicial (F99): empieza en la fase indicada; las anteriores quedan "movidas a mano".
    IF nullif(btrim(p ->> 'start_phase_name'), '') IS NOT NULL THEN
      PERFORM app_servicio.svc_move_core(s.id, ph.id, 'Carga inicial')
        FROM app_servicio.service_phases ph
       WHERE ph.service_id = s.id AND lower(btrim(ph.name)) = lower(btrim(p ->> 'start_phase_name')) AND ph.status = 'pending'
       LIMIT 1;
    END IF;
  END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = v_id;
  PERFORM app_servicio.emit(s, 'service_created', jsonb_build_object('origin', v_origin));
  RETURN v_id;
END;
$$;

-- Al pasar a activo (crear activo o confirmar): copia el camino, da los accesos, semaforo.
CREATE OR REPLACE FUNCTION app_servicio.svc_activate(p_service_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  PERFORM app_servicio.svc_instantiate_journey(p_service_id);
  PERFORM app_servicio.svc_grant_initial_access(p_service_id);
  PERFORM app_servicio.svc_compute_light(p_service_id);
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.starts_on IS NULL OR s.starts_on <= app_servicio.today_in(s.workspace_id) THEN
    PERFORM app_servicio.emit(s, 'service_started');
    UPDATE app_servicio.services SET flags = flags || '{"started_emitted": true}'::jsonb WHERE id = p_service_id;
  END IF;
END;
$$;

-- ─── 11. Confirmar y descartar (F7) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_confirm_service(p_service_id uuid, p_start_on date, p_owner_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_var public.product_variants;
  v_start date; v_end date; v_owner uuid;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.confirm');
  IF s.status <> 'pending_confirmation' THEN RAISE EXCEPTION 'Este servicio no está por confirmar' USING ERRCODE = 'SV010'; END IF;
  SELECT * INTO v_var FROM public.product_variants WHERE id = s.product_variant_id;
  v_start := COALESCE(p_start_on, s.starts_on, app_servicio.today_in(s.workspace_id));
  v_end := CASE WHEN s.ends_on IS NOT NULL AND s.starts_on IS NOT NULL THEN v_start + (s.ends_on - s.starts_on) ELSE CASE v_var.duration_type
             WHEN 'days' THEN v_start + v_var.duration_value - 1
             WHEN 'weeks' THEN v_start + v_var.duration_value * 7 - 1
             WHEN 'months' THEN (v_start + make_interval(months => v_var.duration_value))::date - 1
             ELSE NULL END END;
  v_owner := COALESCE(p_owner_id, s.owner_user_id, (app_servicio.svc_pick_owner(s.product_variant_id, s.contact_id) ->> 'userId')::uuid);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Elegí el responsable' USING ERRCODE = 'SV015'; END IF;
  UPDATE app_servicio.services SET status = 'active', starts_on = v_start, ends_on = v_end, owner_user_id = v_owner,
    flags = flags - 'renewal_choice_pending' WHERE id = s.id;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.confirmed', jsonb_build_object('starts_on', v_start, 'owner_user_id', v_owner));
  PERFORM app_servicio.svc_activate(s.id);
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.emit(s, 'service_status_changed', jsonb_build_object('previous_status', 'pending_confirmation'));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_discard_service(p_service_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.confirm');
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV011'; END IF;
  IF s.status <> 'pending_confirmation' THEN RAISE EXCEPTION 'Este servicio no está por confirmar' USING ERRCODE = 'SV010'; END IF;
  UPDATE app_servicio.services SET status = 'cancelled', cancel_reason = p_reason, cancelled_at = now() WHERE id = s.id;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.discarded', jsonb_build_object('reason', p_reason));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.emit(s, 'service_status_changed', jsonb_build_object('previous_status', 'pending_confirmation'));
END;
$$;

-- ─── 12. Terminar, completar y cancelar (F10, F11, F38) ─────────────────────
-- Termino natural del camino o completado a mano.
CREATE OR REPLACE FUNCTION app_servicio.svc_finish(p_service_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_prev text;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id FOR UPDATE;
  IF s.status NOT IN ('active', 'paused') THEN RETURN; END IF;
  v_prev := s.status;
  UPDATE app_servicio.services SET status = 'completed', completed_at = now(), paused_at = NULL, pause_cut_access = NULL, pause_resume_on = NULL
   WHERE id = s.id;
  PERFORM app_servicio.svc_cut_access(s.id, 'completed');
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.completed', jsonb_build_object('reason', p_reason));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.svc_compute_light(s.id);
  PERFORM app_servicio.emit(s, 'service_status_changed', jsonb_build_object('previous_status', v_prev));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_complete(p_service_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'services.complete');
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016'; END IF;
  IF s.status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'El servicio no está activo' USING ERRCODE = 'SV017'; END IF;
  PERFORM app_servicio.svc_finish(p_service_id, p_reason);
END;
$$;

-- Cancelar corta TODOS los accesos, tambien los extras (F38).
CREATE OR REPLACE FUNCTION app_servicio.svc_cancel_core(p_service_id uuid, p_reason text, p_cut text DEFAULT 'cancelled')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_prev text;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id FOR UPDATE;
  IF s.status IN ('cancelled', 'renewed') THEN RETURN; END IF;
  v_prev := s.status;
  UPDATE app_servicio.services SET status = 'cancelled', cancel_reason = p_reason, cancelled_at = now() WHERE id = s.id;
  PERFORM app_servicio.svc_cut_access(s.id, p_cut);
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.cancelled', jsonb_build_object('reason', p_reason, 'previous_status', v_prev));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.svc_compute_light(s.id);
  PERFORM app_servicio.emit(s, 'service_status_changed', jsonb_build_object('previous_status', v_prev));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_cancel(p_service_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'services.cancel');
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016'; END IF;
  IF s.status IN ('cancelled', 'renewed') THEN RAISE EXCEPTION 'El servicio ya está cerrado' USING ERRCODE = 'SV017'; END IF;
  PERFORM app_servicio.svc_cancel_core(p_service_id, p_reason, 'cancelled');
END;
$$;

-- ─── 13. Responsable (F11, F96) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_set_owner_core(p_service_id uuid, p_user_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = s.workspace_id AND m.user_id = p_user_id) THEN
    RAISE EXCEPTION 'El responsable no es del equipo' USING ERRCODE = 'SV015';
  END IF;
  IF s.owner_user_id IS NOT DISTINCT FROM p_user_id THEN RETURN; END IF;
  UPDATE app_servicio.services SET owner_user_id = p_user_id, flags = flags - 'owner_fallback' - 'owner_departed' WHERE id = s.id;
  -- Las tareas abiertas de los pasos "del responsable" pasan a la persona nueva.
  UPDATE public.tasks t SET owner_id = p_user_id
    FROM app_servicio.service_items i
   WHERE i.service_id = s.id AND i.task_id = t.id AND i.assignee = 'owner' AND t.status <> 'completed';
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.owner_changed',
    jsonb_build_object('old', s.owner_user_id, 'new', p_user_id, 'reason', p_reason));
  PERFORM app_servicio.notify(s.workspace_id, p_user_id, 'svc_owner_assigned', 'Tenés un servicio a cargo',
    COALESCE(s.product_snapshot ->> 'product_name', ''), 'service', s.id);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_set_owner(p_service_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'services.change_owner');
  PERFORM app_servicio.svc_set_owner_core(p_service_id, p_user_id, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_bulk_set_owner(p_service_ids uuid[], p_user_id uuid, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  s app_servicio.services;
  n integer := 0;
BEGIN
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016'; END IF;
  FOREACH v_id IN ARRAY p_service_ids LOOP
    s := app_servicio.svc_get(v_id);
    PERFORM app_servicio.require_service(s, 'services.change_owner');
    PERFORM app_servicio.svc_set_owner_core(v_id, p_user_id, p_reason);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- ─── 14. Extender (F93, F115) ───────────────────────────────────────────────
-- p: {mode: end_date|period, end_on?, n?, unit?, from?, kind: bonus|compensation|courtesy|purchase, reason, sale_id?, extend_own?}
CREATE OR REPLACE FUNCTION app_servicio.svc_extend(p_service_id uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_plan jsonb;
  v_new date;
  v_shifted integer;
  v_prev text;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.extend');
  IF nullif(btrim(p ->> 'reason'), '') IS NULL AND COALESCE(p ->> 'kind', '') <> 'purchase' THEN
    RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016';
  END IF;
  v_plan := app_servicio.svc_extend_plan(jsonb_build_object('status', s.status, 'endsOn', s.ends_on, 'today', app_servicio.today_in(s.workspace_id),
    'mode', p ->> 'mode', 'endOn', p ->> 'end_on', 'n', (p ->> 'n')::integer, 'unit', COALESCE(p ->> 'unit', 'days'), 'from', p ->> 'from'));
  IF NOT (v_plan ->> 'ok')::boolean THEN
    RAISE EXCEPTION '%', CASE v_plan ->> 'error'
      WHEN 'SV030' THEN 'Este servicio no se puede extender' WHEN 'SV031' THEN 'La fecha nueva tiene que ser posterior a hoy'
      ELSE 'Elegí hasta cuándo' END USING ERRCODE = v_plan ->> 'error';
  END IF;
  v_new := (v_plan ->> 'newEnd')::date;
  v_prev := s.status;
  UPDATE app_servicio.services
     SET ends_on = v_new,
         status = CASE WHEN (v_plan ->> 'reactivate')::boolean THEN 'active' ELSE status END,
         completed_at = CASE WHEN (v_plan ->> 'reactivate')::boolean THEN NULL ELSE completed_at END,
         extension_sale_ids = CASE WHEN (p ->> 'sale_id') IS NOT NULL AND NOT ((p ->> 'sale_id')::uuid = ANY (extension_sale_ids))
                                   THEN extension_sale_ids || (p ->> 'sale_id')::uuid ELSE extension_sale_ids END
   WHERE id = s.id;
  v_shifted := app_servicio.svc_shift_access(s.id, 0, v_new, COALESCE((p ->> 'extend_own')::boolean, false));
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.extended',
    jsonb_build_object('old_end', s.ends_on, 'new_end', v_new, 'kind', COALESCE(p ->> 'kind', 'bonus'), 'reason', p ->> 'reason',
                       'sale_id', p ->> 'sale_id', 'reactivated', (v_plan ->> 'reactivate')::boolean, 'accesses', v_shifted));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.svc_compute_light(s.id);
  PERFORM app_servicio.emit(s, 'service_extended', jsonb_build_object('new_end', v_new, 'kind', COALESCE(p ->> 'kind', 'bonus')));
  IF v_prev <> s.status THEN PERFORM app_servicio.emit(s, 'service_status_changed', jsonb_build_object('previous_status', v_prev)); END IF;
  RETURN jsonb_build_object('ends_on', v_new, 'reactivated', (v_plan ->> 'reactivate')::boolean, 'accesses', v_shifted);
END;
$$;

-- "Revertir la extension" de una venta (F115): vuelve ends_on a la fecha anterior a esa extension.
CREATE OR REPLACE FUNCTION app_servicio.svc_revert_extension(p_service_id uuid, p_sale_id uuid)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_old date;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.extend');
  IF NOT (p_sale_id = ANY (s.extension_sale_ids)) THEN RAISE EXCEPTION 'Esa venta no extendió este servicio' USING ERRCODE = 'SV002'; END IF;
  SELECT (a.changes ->> 'old_end')::date INTO v_old FROM public.audit_log a
   WHERE a.entity_type = 'service' AND a.entity_id = s.id AND a.action = 'svc.extended' AND a.changes ->> 'sale_id' = p_sale_id::text
   ORDER BY a.performed_at DESC LIMIT 1;
  UPDATE app_servicio.services SET ends_on = v_old, extension_sale_ids = array_remove(extension_sale_ids, p_sale_id) WHERE id = s.id;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.extension_reverted', jsonb_build_object('sale_id', p_sale_id, 'old_end', s.ends_on, 'new_end', v_old));
  RETURN v_old;
END;
$$;

-- ─── 15. Pausar y reanudar (F94) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_pause(p_service_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_cut boolean := COALESCE((p ->> 'cut_access')::boolean, true);
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.pause');
  IF nullif(btrim(p ->> 'reason'), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'SV016'; END IF;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'Solo se pausa un servicio activo' USING ERRCODE = 'SV017'; END IF;
  UPDATE app_servicio.services SET status = 'paused', paused_at = now(), pause_cut_access = v_cut, pause_resume_on = (p ->> 'resume_on')::date
   WHERE id = s.id;
  IF v_cut THEN PERFORM app_servicio.svc_suspend_for_pause(s.id, true); END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.paused',
    jsonb_build_object('reason', p ->> 'reason', 'cut_access', v_cut, 'resume_on', p ->> 'resume_on'));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  PERFORM app_servicio.svc_compute_light(s.id);
  PERFORM app_servicio.emit(s, 'service_paused');
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_resume(p_service_id uuid, p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  n integer;
  v_items integer; v_tasks integer; v_access integer;
  v_old_end date;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.pause');
  IF s.status <> 'paused' THEN RAISE EXCEPTION 'El servicio no está pausado' USING ERRCODE = 'SV017'; END IF;
  n := app_servicio.svc_resume_plan(s.paused_at, now(), (p ->> 'shift_days')::integer);
  v_old_end := s.ends_on;
  UPDATE app_servicio.services
     SET status = 'active', ends_on = CASE WHEN ends_on IS NULL THEN NULL ELSE ends_on + n END, paused_days = paused_days + n,
         paused_at = NULL, pause_cut_access = NULL, pause_resume_on = NULL
   WHERE id = s.id;
  -- Se corren los vencimientos pendientes y las tareas abiertas de esos pasos.
  UPDATE app_servicio.service_items SET due_on = due_on + n, due_at = due_at + make_interval(days => n)
   WHERE service_id = s.id AND status = 'pending' AND (due_on IS NOT NULL OR due_at IS NOT NULL);
  GET DIAGNOSTICS v_items = ROW_COUNT;
  UPDATE public.tasks t SET due_date = t.due_date + n
    FROM app_servicio.service_items i
   WHERE i.service_id = s.id AND i.task_id = t.id AND t.status <> 'completed' AND t.due_date IS NOT NULL;
  GET DIAGNOSTICS v_tasks = ROW_COUNT;
  -- La fase en curso no cuenta los dias de pausa.
  UPDATE app_servicio.service_phases SET started_at = started_at + make_interval(days => n) WHERE service_id = s.id AND status = 'in_progress';
  v_access := app_servicio.svc_shift_access(s.id, n, NULL, false);
  PERFORM app_servicio.svc_suspend_for_pause(s.id, false);
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.resumed',
    jsonb_build_object('shift_days', n, 'old_end', v_old_end, 'items', v_items, 'tasks', v_tasks, 'accesses', v_access));
  SELECT * INTO s FROM app_servicio.services WHERE id = s.id;
  -- Un Reto con fecha fija que cayo durante la pausa se abre al reanudar.
  PERFORM app_servicio.svc_open_due_challenges(s.id);
  PERFORM app_servicio.svc_generate_occurrences(s.id);
  PERFORM app_servicio.svc_compute_light(s.id);
  PERFORM app_servicio.emit(s, 'service_resumed', jsonb_build_object('shift_days', n));
  RETURN jsonb_build_object('shift_days', n, 'ends_on', s.ends_on, 'items', v_items, 'tasks', v_tasks, 'accesses', v_access);
END;
$$;

-- Abre los Retos de fecha fija que ya llegaron (cron diario y al reanudar).
CREATE OR REPLACE FUNCTION app_servicio.svc_open_due_challenges(p_service_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ph app_servicio.service_phases;
  s app_servicio.services;
  n integer := 0;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.status <> 'active' THEN RETURN 0; END IF;
  FOR ph IN SELECT * FROM app_servicio.service_phases WHERE service_id = p_service_id AND awaiting_start AND status = 'pending'
             AND challenge ->> 'start' = 'fixed_date' AND (challenge ->> 'fixed_date')::date <= app_servicio.today_in(s.workspace_id) LOOP
    IF NOT EXISTS (SELECT 1 FROM app_servicio.service_phases WHERE service_id = p_service_id AND status = 'in_progress') THEN
      PERFORM app_servicio.svc_open_phase(ph.id, true);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- ─── 16. Permisos de ejecucion ──────────────────────────────────────────────
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app_servicio' AND p.proname IN (
              'ws_tz','today_in','local_date','end_of_day','as_system','is_system','audit','notify','notify_admins','emit','require_service','svc_get',
              'svc_rule_met','svc_renewal_plan','svc_due_date','svc_phase_should_advance','svc_occurrence_dates','svc_day_word','svc_light',
              'svc_extend_plan','svc_resume_plan','svc_owner_pick_rr','svc_owner_pick_plan','svc_condition_eval','svc_conditions_match',
              'svc_contact_context','svc_pick_owner','svc_grant_initial_access','svc_open_access','svc_cut_access','svc_shift_access',
              'svc_suspend_for_pause','svc_open_module','svc_compute_due','svc_ensure_task','svc_generate_occurrences','svc_instantiate_journey',
              'svc_open_phase','svc_check_open_items','svc_mark_item','svc_complete_item','svc_require_item','svc_uncomplete_item',
              'svc_try_advance_phase','svc_move_core','svc_move_to_phase','svc_start_challenge','svc_progress_trigger','svc_compute_light','svc_create_service',
              'svc_activate','svc_confirm_service','svc_discard_service','svc_finish','svc_complete','svc_cancel_core','svc_cancel',
              'svc_set_owner_core','svc_set_owner','svc_bulk_set_owner','svc_extend','svc_revert_extension','svc_pause','svc_resume',
              'svc_open_due_challenges') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;

-- Lo que puede llamar una sesion (piden su clave adentro) y las reglas puras (para la pantalla).
GRANT EXECUTE ON FUNCTION
  app_servicio.svc_create_service(jsonb),
  app_servicio.svc_confirm_service(uuid, date, uuid),
  app_servicio.svc_discard_service(uuid, text),
  app_servicio.svc_complete_item(uuid),
  app_servicio.svc_uncomplete_item(uuid),
  app_servicio.svc_move_to_phase(uuid, uuid, text),
  app_servicio.svc_start_challenge(uuid, text),
  app_servicio.svc_complete(uuid, text),
  app_servicio.svc_cancel(uuid, text),
  app_servicio.svc_set_owner(uuid, uuid),
  app_servicio.svc_bulk_set_owner(uuid[], uuid, text),
  app_servicio.svc_extend(uuid, jsonb),
  app_servicio.svc_revert_extension(uuid, uuid),
  app_servicio.svc_pause(uuid, jsonb),
  app_servicio.svc_resume(uuid, jsonb),
  app_servicio.svc_rule_met(jsonb),
  app_servicio.svc_renewal_plan(jsonb),
  app_servicio.svc_due_date(jsonb, jsonb),
  app_servicio.svc_phase_should_advance(text, integer, integer, integer, integer),
  app_servicio.svc_occurrence_dates(jsonb, date, date, date, date),
  app_servicio.svc_light(jsonb),
  app_servicio.svc_extend_plan(jsonb),
  app_servicio.svc_resume_plan(timestamptz, timestamptz, integer),
  app_servicio.svc_owner_pick_plan(jsonb),
  app_servicio.svc_conditions_match(jsonb, jsonb),
  app_servicio.svc_day_word(integer),
  app_servicio.svc_owner_pick_rr(jsonb, jsonb),
  app_servicio.svc_condition_eval(jsonb, jsonb)
TO authenticated;
