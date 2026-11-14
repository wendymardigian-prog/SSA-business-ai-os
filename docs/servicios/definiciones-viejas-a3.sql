-- Definiciones de la base ANTES de la Corrida A3 (copiadas de produccion el 14/11/2026 con pg_get_functiondef).
-- Para volver atras una migracion de A3: correr las de esa migracion.

-- ── 00375 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.portal_form_before_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_type text;
  v_def jsonb;
BEGIN
  BEGIN
    SELECT f.type INTO v_type FROM public.forms f WHERE f.id = NEW.form_id;
    IF v_type IS NULL OR v_type NOT IN ('quiz', 'activity', 'terms') THEN RETURN NEW; END IF;
    IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NEW; END IF;
    NEW.context := 'portal';
    IF v_type = 'terms' THEN RETURN NEW; END IF;
    NEW.attempt := 1 + (SELECT count(*) FROM public.form_submissions fs WHERE fs.form_id = NEW.form_id AND fs.contact_id IS NOT DISTINCT FROM NEW.contact_id AND fs.status = 'received');
    IF v_type = 'quiz' THEN
      SELECT fv.definition INTO v_def FROM public.form_versions fv WHERE fv.id = NEW.form_version_id;
      NEW.grade := app_servicio.quiz_grade_plan(jsonb_build_object('settings', COALESCE(v_def -> 'quiz', '{}'::jsonb), 'answers', COALESCE(NEW.answers, '{}'::jsonb), 'attempt', NEW.attempt));
      NEW.review_status := 'graded';
    ELSE
      NEW.review_status := 'pending';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'portal_form_before_hook: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.submission_review(p_submission_id uuid, p_status text, p_grade_value jsonb, p_comment text, p_internal_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  fs record;
  v_type text;
  v_product uuid;
  v_grading jsonb;
  v_grade jsonb;
  v_passed boolean;
  sv record;
  v_prev_system text;
BEGIN
  SELECT * INTO fs FROM public.form_submissions WHERE id = p_submission_id FOR UPDATE;
  IF fs.id IS NULL THEN RAISE EXCEPTION 'No existe la entrega' USING ERRCODE = 'EV002'; END IF;
  SELECT f.type, f.product_id INTO v_type, v_product FROM public.forms f WHERE f.id = fs.form_id;
  IF v_type <> 'activity' THEN RAISE EXCEPTION 'Solo se revisan actividades' USING ERRCODE = 'EV002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (
       public.has_permission(fs.workspace_id, 'submissions.review')
       AND EXISTS (SELECT 1 FROM app_servicio.services s WHERE s.contact_id = fs.contact_id AND s.product_id = v_product AND app_servicio.can_see_service_row(s))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF p_status NOT IN ('reviewed', 'needs_changes') THEN RAISE EXCEPTION 'Elegí Revisada o A corregir' USING ERRCODE = 'EV001'; END IF;
  SELECT fv.definition -> 'grading' INTO v_grading FROM public.form_versions fv WHERE fv.id = fs.form_version_id;
  IF COALESCE((v_grading ->> 'enabled')::boolean, false) AND p_status = 'reviewed' THEN
    v_passed := app_servicio.grading_passed(v_grading ->> 'scale', p_grade_value, v_grading -> 'pass_at');
    IF v_passed IS NULL THEN RAISE EXCEPTION 'Ese valor no es de la escala' USING ERRCODE = 'EV001'; END IF;
    v_grade := jsonb_build_object('scale', v_grading ->> 'scale', 'value', p_grade_value, 'passed', v_passed);
  END IF;
  UPDATE public.form_submissions SET review_status = p_status, review_comment = NULLIF(btrim(COALESCE(p_comment, '')), ''),
         internal_note = NULLIF(btrim(COALESCE(p_internal_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now(),
         grade = COALESCE(v_grade, grade), updated_at = now()
   WHERE id = fs.id;
  PERFORM app_servicio.audit(fs.workspace_id, 'form_submission', fs.id, 'svc.submission_reviewed', jsonb_build_object('status', p_status, 'passed', v_passed));
  v_prev_system := COALESCE(current_setting('app_servicio.system', true), '');
  PERFORM app_servicio.as_system();
  IF p_status = 'reviewed' THEN
    PERFORM app_servicio.svc_complete_portal_form(fs.workspace_id, fs.contact_id, fs.form_id, 'activity',
      CASE WHEN v_passed IS NULL OR v_passed THEN ARRAY['reviewed', 'passed'] ELSE ARRAY['reviewed'] END, 'activity_review');
  END IF;
  FOR sv IN SELECT id FROM app_servicio.services WHERE contact_id = fs.contact_id AND product_id = v_product AND status IN ('active', 'paused') LOOP
    PERFORM app_servicio.emit_service(sv.id, 'task_submission_reviewed', jsonb_build_object('form_id', fs.form_id, 'submission_id', fs.id, 'status', p_status, 'passed', v_passed));
  END LOOP;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN jsonb_build_object('status', p_status, 'passed', v_passed);
END;
$$;
ALTER TABLE public.form_submissions DROP CONSTRAINT IF EXISTS form_submissions_review_status_check;
ALTER TABLE public.form_submissions ADD CONSTRAINT form_submissions_review_status_check CHECK (review_status IS NULL OR review_status IN ('pending', 'graded', 'reviewed', 'needs_changes'));

-- ── 00376 ──────────────────────────────────────────────
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
      -- A4 (F146): «cuando se complete otro paso» solo puede esperar a uno ANTERIOR (sin ciclos).
      IF jsonb_typeof(it -> 'ref' -> 'lock') = 'object' AND (it -> 'ref' -> 'lock' ->> 'after_item_key') ~ '^it_[a-z0-9]{6}$'
         AND NOT ((it -> 'ref' -> 'lock' ->> 'after_item_key') = ANY (v_before)) THEN
        v := v || format('«%s»: un paso solo puede esperar a uno anterior', v_nm);
      END IF;

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
  -- A4 (00369).
  v_lock jsonb;
  v_ev jsonb;
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
  -- ── Servicios A4 (00369): bloqueo, evidencia, checklist y «cuando hay grabacion». Mismo orden que a4RefProblems (TS). ──
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

CREATE OR REPLACE FUNCTION app_servicio.journey_recurrence_problems(p_item jsonb, p_nm text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  r jsonb := p_item -> 'recurrence';
BEGIN
  IF r IS NULL OR jsonb_typeof(r) = 'null' THEN RETURN v; END IF;
  IF jsonb_typeof(r) <> 'object' THEN RETURN ARRAY[format('«%s»: la repetición no es válida', p_nm)]; END IF;
  IF NOT COALESCE(r ->> 'every' = ANY (ARRAY['day','week','n_days']), false) THEN v := v || format('«%s»: elegí cada cuánto se repite', p_nm); END IF;
  IF r ->> 'every' = 'n_days' AND NOT (app_servicio.j_int(r -> 'n') AND app_servicio.j_num(r -> 'n') BETWEEN 1 AND 365) THEN
    v := v || format('«%s»: elegí cada cuántos días se repite', p_nm);
  END IF;
  IF NOT COALESCE(r ->> 'until' = ANY (ARRAY['phase_end','service_end','n_days','n_times']), false) THEN v := v || format('«%s»: elegí hasta cuándo se repite', p_nm); END IF;
  IF r ->> 'until' IN ('n_days','n_times') AND NOT (app_servicio.j_int(r -> 'n_until') AND app_servicio.j_num(r -> 'n_until') BETWEEN 1 AND 1000) THEN
    v := v || format('«%s»: elegí cuántas veces o días', p_nm);
  END IF;
  RETURN v;
END;
$$;

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
  -- A4 (F146, F147): «Completar un paso» de una automatizacion respeta el bloqueo y la evidencia (SV033 / SV034).
  -- Lo que hizo el cliente (formulario, agenda, grabacion, programa) se completa igual y queda anotado.
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

-- ── 00377 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.validate_program_portal_settings(p jsonb, p_product_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  k text; t jsonb; c jsonb; sp jsonb; a jsonb;
  v_keys text[] := ARRAY[]::text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','sections','terms','community','affiliates','assistant']);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'sections' THEN
    IF jsonb_typeof(p -> 'sections') <> 'object' THEN v := v || 'las secciones no son válidas'::text;
    ELSE
      FOR k IN SELECT key FROM jsonb_object_keys(p -> 'sections') WITH ORDINALITY AS t(key, ord) ORDER BY ord LOOP
        IF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates','fame','projects']), false) THEN v := v || ('sección desconocida: ' || k);
        ELSIF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN v := v || 'Todavía no está disponible'::text;
        ELSIF jsonb_typeof(p -> 'sections' -> k) <> 'boolean' THEN v := v || (k || ': tiene que ser sí o no');
        END IF;
      END LOOP;
    END IF;
  END IF;
  IF p ? 'terms' THEN
    t := p -> 'terms';
    IF jsonb_typeof(t) <> 'object' THEN v := v || 'los términos no son válidos'::text;
    ELSE
      v := v || app_servicio.unknown_keys(t, ARRAY['enabled','form_id','ask_again_on_change']);
      IF t -> 'enabled' = 'true'::jsonb AND NOT app_servicio.j_uuid(t -> 'form_id') THEN v := v || 'cargá los términos antes de prenderlos'::text; END IF;
    END IF;
  END IF;
  IF p ? 'community' THEN
    c := p -> 'community';
    IF jsonb_typeof(c) <> 'object' THEN v := v || 'la comunidad no es válida'::text;
    ELSE
      v := v || app_servicio.unknown_keys(c, ARRAY['lesson_comments','spaces']);
      IF c ? 'spaces' THEN
        IF jsonb_typeof(c -> 'spaces') <> 'array' THEN v := v || 'los espacios no son válidos'::text;
        ELSE
          FOR sp IN SELECT x FROM jsonb_array_elements(c -> 'spaces') x LOOP
            IF jsonb_typeof(sp) <> 'object' OR jsonb_typeof(sp -> 'key') IS DISTINCT FROM 'string' OR (sp ->> 'key') !~ '^[a-z0-9_]{1,40}$'
               OR jsonb_typeof(sp -> 'name') IS DISTINCT FROM 'string' OR btrim(sp ->> 'name') = '' THEN
              v := v || 'hay un espacio sin nombre o con una clave inválida'::text;
              CONTINUE;
            END IF;
            IF (sp ->> 'key') = ANY (v_keys) THEN v := v || format('el espacio %s está repetido', sp ->> 'key'); END IF;
            v_keys := v_keys || (sp ->> 'key');
          END LOOP;
        END IF;
      END IF;
    END IF;
  END IF;
  IF p ? 'affiliates' THEN
    a := p -> 'affiliates';
    IF jsonb_typeof(a) <> 'object' OR (a ? 'visible_link_keys' AND NOT (jsonb_typeof(a -> 'visible_link_keys') = 'array'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a -> 'visible_link_keys') x WHERE jsonb_typeof(x) <> 'string' OR (x #>> '{}') !~ '^lk_[a-z0-9]{6}$'))) THEN
      v := v || 'los links de afiliados no son válidos'::text;
    END IF;
  END IF;
  IF p ? 'assistant' THEN
    a := p -> 'assistant';
    IF jsonb_typeof(a) <> 'object' THEN v := v || 'el asistente no es válido'::text;
    ELSE
      v := v || app_servicio.unknown_keys(a, ARRAY['excluded_kb_ids','monthly_limit_usd_per_student','credits_per_usd','credits_name','suggestions']);
      IF a ? 'monthly_limit_usd_per_student' AND NOT (jsonb_typeof(a -> 'monthly_limit_usd_per_student') = 'number'
         AND app_servicio.j_num(a -> 'monthly_limit_usd_per_student') BETWEEN 0 AND 10000) THEN
        v := v || 'el límite por estudiante va de 0 a 10.000 dólares'::text;
      END IF;
      IF a ? 'credits_per_usd' AND NOT (app_servicio.j_int(a -> 'credits_per_usd') AND app_servicio.j_num(a -> 'credits_per_usd') BETWEEN 1 AND 100000) THEN
        v := v || 'los créditos por dólar tienen que ser un número entero positivo'::text;
      END IF;
    END IF;
  END IF;
  RETURN v;
END;
$$;
