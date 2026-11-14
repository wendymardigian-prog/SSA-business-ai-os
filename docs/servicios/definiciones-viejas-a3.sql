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
