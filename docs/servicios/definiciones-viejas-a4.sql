-- Definiciones VIEJAS de las funciones que reescribe la Corrida A4 de Servicios (leidas de la base el 12/11/2026,
-- ANTES de aplicar la 00369). Para volver atras: correr este archivo entero (son CREATE OR REPLACE), o solo la
-- funcion que haga falta. Al lado de cada una, la migracion que la reescribe.

-- ---- app_servicio.journey_item_ref_problems (10137935...) · la reescribe la 00369 (M4) ----
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
  -- F125: el boton y «ver su respuesta».
  v_link_kind boolean := v_kind = ANY (ARRAY['team_task','student_task','checkbox']);
  v_btn jsonb;
  v_label jsonb;
  v_url jsonb;
  v_url_ok boolean := false;
  v_url_bad boolean := false;
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
    IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (ARRAY['booked','attended']), false) THEN v := v || format('«%s»: elegí cuándo se completa', p_nm); END IF;
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
    IF NOT app_servicio.j_uuid(v_ref -> 'template_id') THEN
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

  -- ── El boton del paso (F125). Mismo orden que buttonProblems (TS). ──
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
  RETURN v;
END;
$function$;

-- ---- app_servicio.validate_journey_template (a1941c31...) · la reescribe la 00369 (M4) ----
CREATE OR REPLACE FUNCTION app_servicio.validate_journey_template(p jsonb, p_variant_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  v_ws uuid; v_product uuid;
  ph jsonb; it jsonb; due jsonb; lt jsonb; ch jsonb; ll jsonb;
  v_phase_keys text[] := ARRAY[]::text[];
  v_item_keys text[] := ARRAY[]::text[];
  v_before text[] := ARRAY[]::text[];
  v_name text; v_label text; v_nm text; v_key text;
  y numeric; r numeric; d numeric;
  v_has_rule boolean;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['el camino tiene que ser un objeto']; END IF;
  IF p_variant_id IS NOT NULL THEN
    SELECT pv.workspace_id, pv.product_id INTO v_ws, v_product FROM public.product_variants pv WHERE pv.id = p_variant_id;
  END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','future_visibility','phases']);
  IF p -> 'v' IS DISTINCT FROM '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'future_visibility' AND NOT COALESCE(p ->> 'future_visibility' = ANY (ARRAY['names','names_and_descriptions','hidden']), false) THEN
    v := v || 'elegí qué ve el cliente de las fases que vienen'::text;
  END IF;
  IF jsonb_typeof(p -> 'phases') IS DISTINCT FROM 'array' THEN RETURN v || 'faltan las fases'::text; END IF;

  FOR ph IN SELECT x FROM jsonb_array_elements(p -> 'phases') x LOOP
    IF jsonb_typeof(ph) <> 'object' THEN v := v || 'hay una fase que no es válida'::text; CONTINUE; END IF;
    v := v || app_servicio.unknown_keys(ph, ARRAY['key','name','duration_days','yellow_day','red_day','advance','challenge','late_light','items']);
    v_key := CASE WHEN jsonb_typeof(ph -> 'key') = 'string' THEN ph ->> 'key' END;
    IF v_key IS NULL OR v_key !~ '^ph_[a-z0-9]{6}$' THEN v := v || 'hay una fase con una clave inválida'::text;
    ELSIF v_key = ANY (v_phase_keys) THEN v := v || format('la clave %s está repetida', v_key);
    ELSE v_phase_keys := v_phase_keys || v_key;
    END IF;
    v_name := CASE WHEN jsonb_typeof(ph -> 'name') = 'string' THEN btrim(ph ->> 'name') ELSE '' END;
    IF v_name = '' THEN v := v || 'hay una fase sin nombre'::text; END IF;
    v_label := CASE WHEN v_name = '' THEN 'la fase' ELSE v_name END;
    IF NOT (ph -> 'duration_days' IS NULL OR jsonb_typeof(ph -> 'duration_days') = 'null'
            OR (app_servicio.j_int(ph -> 'duration_days') AND app_servicio.j_num(ph -> 'duration_days') >= 0))
       OR app_servicio.j_num(ph -> 'duration_days') = 0 THEN
      v := v || format('«%s»: la duración tiene que ser mayor a cero', v_label);
    END IF;
    IF NOT (ph -> 'yellow_day' IS NULL OR jsonb_typeof(ph -> 'yellow_day') = 'null' OR (app_servicio.j_int(ph -> 'yellow_day') AND app_servicio.j_num(ph -> 'yellow_day') >= 0))
       OR NOT (ph -> 'red_day' IS NULL OR jsonb_typeof(ph -> 'red_day') = 'null' OR (app_servicio.j_int(ph -> 'red_day') AND app_servicio.j_num(ph -> 'red_day') >= 0)) THEN
      v := v || format('«%s»: los días de amarillo y rojo tienen que ser enteros', v_label);
    ELSE
      y := CASE WHEN app_servicio.j_int(ph -> 'yellow_day') THEN app_servicio.j_num(ph -> 'yellow_day') END;
      r := CASE WHEN app_servicio.j_int(ph -> 'red_day') THEN app_servicio.j_num(ph -> 'red_day') END;
      d := CASE WHEN app_servicio.j_int(ph -> 'duration_days') THEN app_servicio.j_num(ph -> 'duration_days') END;
      IF y IS NOT NULL AND r IS NOT NULL AND y >= r THEN v := v || format('«%s»: el amarillo tiene que ser antes que el rojo', v_label); END IF;
      IF r IS NOT NULL AND d IS NOT NULL AND r > d THEN v := v || format('«%s»: el rojo no puede pasar la duración de la fase', v_label); END IF;
    END IF;
    IF ph ? 'advance' AND NOT COALESCE(ph ->> 'advance' = ANY (ARRAY['auto','auto_all','manual']), false) THEN v := v || format('«%s»: elegí cómo avanza', v_label); END IF;
    ch := ph -> 'challenge';
    IF ch IS NOT NULL AND jsonb_typeof(ch) <> 'null' THEN
      IF jsonb_typeof(ch) <> 'object' THEN v := v || format('«%s»: el Reto no es válido', v_label);
      ELSIF ch -> 'enabled' = 'true'::jsonb THEN
        IF NOT COALESCE(ch ->> 'start' = ANY (ARRAY['previous_phase','student','automation','fixed_date']), false) THEN v := v || format('«%s»: elegí cómo empieza el Reto', v_label); END IF;
        IF ch ->> 'start' = 'fixed_date' AND NOT app_servicio.j_date(ch -> 'fixed_date') THEN v := v || format('«%s»: elegí la fecha del Reto', v_label); END IF;
      END IF;
    END IF;
    ll := ph -> 'late_light';
    IF ll IS NOT NULL AND jsonb_typeof(ll) <> 'null' THEN
      IF jsonb_typeof(ll) <> 'object' THEN v := v || format('«%s»: el semáforo por entregas no es válido', v_label);
      ELSIF ll -> 'enabled' = 'true'::jsonb AND NOT (
        app_servicio.j_int(ll -> 'yellow_at') AND app_servicio.j_num(ll -> 'yellow_at') >= 1
        AND app_servicio.j_int(ll -> 'red_at') AND app_servicio.j_num(ll -> 'red_at') >= app_servicio.j_num(ll -> 'yellow_at')) THEN
        v := v || format('«%s»: el rojo por entregas tiene que ser igual o mayor que el amarillo', v_label);
      END IF;
    END IF;
    IF jsonb_typeof(ph -> 'items') IS DISTINCT FROM 'array' THEN v := v || format('«%s»: faltan los pasos', v_label); CONTINUE; END IF;

    FOR it IN SELECT x FROM jsonb_array_elements(ph -> 'items') x LOOP
      IF jsonb_typeof(it) <> 'object' THEN v := v || format('«%s»: hay un paso que no es válido', v_label); CONTINUE; END IF;
      v_nm := CASE WHEN jsonb_typeof(it -> 'name') = 'string' THEN it ->> 'name' ELSE 'el paso' END;
      v := v || app_servicio.unknown_keys(it, ARRAY['key','kind','name','description','required','assignee','assignee_user_id','visible_to_client',
        'portal_button','ref','due_rule','light','recurrence','late','reminders']);
      v_key := CASE WHEN jsonb_typeof(it -> 'key') = 'string' THEN it ->> 'key' END;
      IF v_key IS NULL OR v_key !~ '^it_[a-z0-9]{6}$' THEN v := v || 'hay un paso con una clave inválida'::text;
      ELSIF v_key = ANY (v_item_keys) THEN v := v || format('la clave %s está repetida', v_key);
      ELSE v_item_keys := v_item_keys || v_key;
      END IF;
      IF NOT COALESCE(it ->> 'kind' = ANY (ARRAY['form','survey','contract','booking','quiz','activity','program_item','team_task','student_task',
          'certificate','open_section','open_module','checkbox']), false) THEN
        v := v || format('«%s»: tipo de paso desconocido', v_nm);
        CONTINUE;
      END IF;
      IF NOT (jsonb_typeof(it -> 'name') = 'string' AND btrim(it ->> 'name') <> '') THEN v := v || 'hay un paso sin nombre'::text; END IF;
      IF it ? 'assignee' AND NOT COALESCE(it ->> 'assignee' = ANY (ARRAY['student','owner','user']), false) THEN v := v || format('«%s»: elegí a cargo de quién está', v_nm); END IF;
      IF it ->> 'assignee' = 'user' AND NOT app_servicio.j_uuid(it -> 'assignee_user_id') THEN v := v || format('«%s»: elegí la persona a cargo', v_nm); END IF;
      v := v || app_servicio.journey_item_ref_problems(it, v_nm, v_ws, v_product);

      due := it -> 'due_rule';
      IF due IS NOT NULL AND jsonb_typeof(due) <> 'null' THEN
        IF jsonb_typeof(due) <> 'object' OR NOT COALESCE(due ->> 'from' = ANY (ARRAY['service_created','service_start','phase_start','item_completed']), false)
           OR NOT (app_servicio.j_int(due -> 'days') AND app_servicio.j_num(due -> 'days') BETWEEN 0 AND 3650) THEN
          v := v || format('«%s»: el plazo no es válido', v_nm);
        ELSIF due ->> 'from' = 'item_completed' THEN
          IF jsonb_typeof(due -> 'item_key') IS DISTINCT FROM 'string' OR NOT ((due ->> 'item_key') = ANY (v_before)) THEN
            v := v || 'un paso solo puede depender de uno anterior'::text;
          END IF;
        END IF;
      END IF;
      v := v || app_servicio.journey_recurrence_problems(it, v_nm);
      lt := it -> 'light';
      IF lt IS NOT NULL AND jsonb_typeof(lt) <> 'null' THEN
        IF jsonb_typeof(lt) <> 'object'
           OR NOT (lt -> 'yellow_after_days' IS NULL OR jsonb_typeof(lt -> 'yellow_after_days') = 'null' OR (app_servicio.j_int(lt -> 'yellow_after_days') AND app_servicio.j_num(lt -> 'yellow_after_days') >= 0))
           OR NOT (lt -> 'red_after_days' IS NULL OR jsonb_typeof(lt -> 'red_after_days') = 'null' OR (app_servicio.j_int(lt -> 'red_after_days') AND app_servicio.j_num(lt -> 'red_after_days') >= 0)) THEN
          v := v || format('«%s»: el semáforo del paso tiene que ser un número de días', v_nm);
        ELSE
          v_has_rule := (due IS NOT NULL AND jsonb_typeof(due) <> 'null') OR (it -> 'recurrence' IS NOT NULL AND jsonb_typeof(it -> 'recurrence') <> 'null');
          IF NOT v_has_rule THEN v := v || format('«%s»: el semáforo del paso necesita un plazo o que se repita', v_nm); END IF;
          IF app_servicio.j_int(lt -> 'yellow_after_days') AND app_servicio.j_int(lt -> 'red_after_days')
             AND app_servicio.j_num(lt -> 'red_after_days') < app_servicio.j_num(lt -> 'yellow_after_days') THEN
            v := v || format('«%s»: el rojo tiene que ser igual o mayor que el amarillo', v_nm);
          END IF;
        END IF;
      END IF;
      IF v_key IS NOT NULL THEN v_before := v_before || v_key; END IF;
    END LOOP;
  END LOOP;
  RETURN v;
END;
$function$;

-- ---- app_servicio.svc_complete_item (81f79ba7...) · la reescribe la 00369 (M4) ----
CREATE OR REPLACE FUNCTION app_servicio.svc_complete_item(p_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- ---- app_servicio.svc_ensure_task (06664a76...) · la reescribe la 00369 (M4) ----
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
$function$;

-- ---- app_servicio.svc_mark_item (b2e7a21e...) · la reescribe la 00369 (M4) ----
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
$function$;

-- ---- app_servicio.task_hook (47cd3472...) · la reescribe la 00370 (M5) ----
CREATE OR REPLACE FUNCTION app_servicio.task_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item uuid;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NEW.source <> 'cx' OR NEW.source_ref IS NULL OR NEW.source_ref NOT LIKE 'svc\_item:%' THEN RETURN NULL; END IF;
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    SELECT i.id INTO v_item FROM app_servicio.service_items i
     WHERE i.id = substr(NEW.source_ref, 10)::uuid AND i.workspace_id = NEW.workspace_id AND i.task_id = NEW.id;
    IF v_item IS NOT NULL THEN
      IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
        PERFORM app_servicio.svc_mark_item(v_item, 'task', 'user', NULL);
      ELSIF OLD.status = 'completed' AND NEW.status <> 'completed' THEN
        PERFORM app_servicio.svc_unmark_item(v_item);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'task', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$function$;

-- ---- app_servicio.svc_owner_pick_plan (cf7034b2...) · la reescribe la 00371 (M8) ----
CREATE OR REPLACE FUNCTION app_servicio.svc_owner_pick_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
$function$;

-- ---- app_servicio.svc_owner_pick_rr (b0875d40...) · la reescribe la 00371 (M8) ----
CREATE OR REPLACE FUNCTION app_servicio.svc_owner_pick_rr(p jsonb, p_members jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT m FROM jsonb_array_elements_text(COALESCE(p_members, '[]'::jsonb)) m
  WHERE (p -> 'activeMembers') ? m
  ORDER BY COALESCE((p -> 'activeCounts' ->> m)::integer, 0), COALESCE(p -> 'lastAssignedAt' ->> m, ''), m
  LIMIT 1;
$function$;

-- ---- app_servicio.svc_pick_owner (7cf953dd...) · la reescribe la 00371 (M8) ----
CREATE OR REPLACE FUNCTION app_servicio.svc_pick_owner(p_variant_id uuid, p_contact_id uuid, p_previous_owner uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- ---- app_servicio.svc_daily_run (78a2581c...) · la reescribe la 00372 (M7) ----
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
    FOR d IN SELECT DISTINCT (t.config ->> 'days')::integer FROM public.triggers t
              WHERE t.workspace_id = p_workspace_id AND t.type = 'service_ending_soon' AND t.is_active
                AND jsonb_typeof(t.config -> 'days') = 'number' AND (t.config ->> 'days')::integer BETWEEN 0 AND 365 LOOP
      FOR s IN SELECT * FROM app_servicio.services sv WHERE sv.workspace_id = p_workspace_id AND sv.status = 'active' AND NOT sv.is_test
                 AND sv.ends_on = v_today + d
                 AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'service_ending_soon'
                                   AND e.payload ->> 'service_id' = sv.id::text AND e.payload ->> 'days' = d::text) LOOP
        PERFORM app_servicio.emit(s, 'service_ending_soon', jsonb_build_object('days', d));
        n := n + 1;
      END LOOP;
    END LOOP;
    v_out := v_out || jsonb_build_object('ending_soon', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('ending_soon: ' || SQLERRM);
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
