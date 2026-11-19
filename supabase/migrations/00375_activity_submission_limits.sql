-- ============================================================
-- 00375_activity_submission_limits.sql
-- ============================================================
-- Servicios A3, F126 (decisión 469): entregas de actividades.
--
--   * `form_versions.definition.submission = {before_review, after_review}` (0, N o null = sin límite). Una actividad
--     SIN `submission` sigue como antes: sin límites, sin reemplazos y se revisa cualquier entrega (condición de producto,
--     14/11). El editor escribe los valores por defecto ({before_review: null, after_review: 2}) al guardarla.
--   * `review_status` suma 'superseded' (la entrega pendiente que se reemplazó antes de la primera revisión). Ninguna
--     fila existente cambia: el CHECK solo agranda la lista.
--   * `app_servicio.submission_plan(jsonb)`: gemela pura de `submissionPlan` (lib/program/submission-limits.ts), con
--     `submission-limits.cases.json` contra las dos.
--   * `portal_form_before_hook`: con límites, la base rechaza una entrega de más (EV003), una ya aprobada (EV004) o una
--     nueva mientras la anterior espera la revisión (EV005), y marca 'superseded' la que se reemplaza. Es una guardia a
--     propósito, como SV003: frena la entrega (§18, «la base rechaza, no solo la pantalla»). Lo demás del enganche sigue
--     sin poder tumbar el INSERT (si algo falla al calcular, se comporta como antes).
--   * `submission_review`: con límites, solo revisa la ÚLTIMA entrega de esa persona (EV006). «Pedir otra entrega» es
--     `needs_changes` (sin cambios: siempre habilita una más).
--
-- No toca funciones protegidas de Formularios (`submit_form_response`, `get_public_form`, `publish_form_version`).
--
-- Como volver atras: las dos funciones y el CHECK viejos estan en docs/servicios/definiciones-viejas-a3.sql (§00375).
-- La funcion nueva se puede dejar o: DROP FUNCTION IF EXISTS app_servicio.submission_plan(jsonb);
-- (Antes de restaurar el CHECK viejo: UPDATE public.form_submissions SET review_status = 'pending' WHERE review_status = 'superseded'.)

-- ─── 1. El estado «reemplazada» ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_submissions_review_status_check'
                 AND pg_get_constraintdef(oid) LIKE '%superseded%') THEN
    ALTER TABLE public.form_submissions DROP CONSTRAINT IF EXISTS form_submissions_review_status_check;
    ALTER TABLE public.form_submissions ADD CONSTRAINT form_submissions_review_status_check
      CHECK (review_status IS NULL OR review_status IN ('pending', 'graded', 'reviewed', 'needs_changes', 'superseded'));
  END IF;
END $$;

-- ─── 2. La regla (gemela de submissionPlan) ─────────────────────────────────
-- p = {limits: {before_review, after_review} | null, history: [{id, status, passed}] de la más vieja a la más nueva}
CREATE OR REPLACE FUNCTION app_servicio.submission_plan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  l jsonb := p -> 'limits';
  h jsonb := COALESCE(p -> 'history', '[]'::jsonb);
  v_before integer;
  v_after integer;
  live jsonb := '[]'::jsonb;
  x jsonb;
  last jsonb;
  v_reviewed_ever boolean := false;
  v_used integer := 0;
  i integer;
BEGIN
  IF l IS NULL OR jsonb_typeof(l) <> 'object' THEN RETURN jsonb_build_object('ok', true, 'supersede', NULL); END IF;
  v_before := CASE WHEN jsonb_typeof(l -> 'before_review') = 'number' AND (l ->> 'before_review') ~ '^\d+$' AND (l ->> 'before_review')::numeric <= 100
                   THEN (l ->> 'before_review')::integer END;
  v_after := CASE WHEN jsonb_typeof(l -> 'after_review') = 'number' AND (l ->> 'after_review') ~ '^\d+$' AND (l ->> 'after_review')::numeric <= 100
                  THEN (l ->> 'after_review')::integer END;
  IF jsonb_typeof(h) <> 'array' THEN h := '[]'::jsonb; END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(h) e LOOP
    IF x ->> 'status' IS DISTINCT FROM 'superseded' THEN
      live := live || jsonb_build_array(x);
      IF x ->> 'status' IN ('reviewed', 'needs_changes') THEN v_reviewed_ever := true; END IF;
    END IF;
  END LOOP;
  IF jsonb_array_length(live) = 0 THEN RETURN jsonb_build_object('ok', true, 'supersede', NULL); END IF;
  last := live -> (jsonb_array_length(live) - 1);

  IF last ->> 'status' IS NULL OR last ->> 'status' = 'pending' THEN
    IF v_reviewed_ever THEN
      RETURN jsonb_build_object('ok', false, 'code', 'EV005', 'message', 'Tu entrega está esperando la revisión');
    END IF;
    IF v_before IS NOT NULL AND jsonb_array_length(h) - jsonb_array_length(live) >= v_before THEN
      RETURN jsonb_build_object('ok', false, 'code', 'EV003', 'message', 'Ya usaste todas las correcciones antes de la revisión');
    END IF;
    RETURN jsonb_build_object('ok', true, 'supersede', last ->> 'id');
  END IF;
  IF last ->> 'status' = 'needs_changes' THEN RETURN jsonb_build_object('ok', true, 'supersede', NULL); END IF;
  IF last ->> 'status' = 'reviewed' THEN
    IF last -> 'passed' IS DISTINCT FROM 'false'::jsonb THEN
      RETURN jsonb_build_object('ok', false, 'code', 'EV004', 'message', 'Esta entrega ya está aprobada');
    END IF;
    FOR i IN 1 .. jsonb_array_length(live) - 1 LOOP
      IF live -> (i - 1) ->> 'status' = 'reviewed' AND live -> (i - 1) -> 'passed' = 'false'::jsonb THEN v_used := v_used + 1; END IF;
    END LOOP;
    IF v_after IS NOT NULL AND v_used >= v_after THEN
      RETURN jsonb_build_object('ok', false, 'code', 'EV003', 'message', 'Ya no quedan entregas nuevas para esta actividad');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'supersede', NULL);
END;
$$;

-- ─── 3. El enganche antes de guardar la entrega ─────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.portal_form_before_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_type text;
  v_def jsonb;
  v_plan jsonb;
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
      -- F126: los límites de la versión que se está entregando. Sin `submission`, como antes.
      SELECT fv.definition INTO v_def FROM public.form_versions fv WHERE fv.id = NEW.form_version_id;
      IF NEW.contact_id IS NOT NULL AND jsonb_typeof(v_def -> 'submission') = 'object' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('svc_submission:' || NEW.form_id::text || ':' || NEW.contact_id::text, 0));
        -- Con el candado, el número de intento queda firme: ordena las entregas (en una misma transacción la fecha empata).
        NEW.attempt := 1 + (SELECT count(*) FROM public.form_submissions fs WHERE fs.form_id = NEW.form_id AND fs.contact_id = NEW.contact_id AND fs.status = 'received');
        v_plan := app_servicio.submission_plan(jsonb_build_object(
          'limits', v_def -> 'submission',
          'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', fs.id, 'status', fs.review_status, 'passed', fs.grade -> 'passed') ORDER BY COALESCE(fs.attempt, 0), fs.created_at, fs.id)
                                 FROM public.form_submissions fs
                                WHERE fs.form_id = NEW.form_id AND fs.contact_id = NEW.contact_id AND fs.status = 'received'), '[]'::jsonb)));
        IF (v_plan ->> 'ok')::boolean AND v_plan ->> 'supersede' IS NOT NULL THEN
          UPDATE public.form_submissions SET review_status = 'superseded', updated_at = now()
           WHERE id = (v_plan ->> 'supersede')::uuid AND review_status = 'pending';
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'portal_form_before_hook: %', SQLERRM;
    v_plan := NULL;
  END;
  -- La guardia va fuera del bloque que se traga los errores: es la única forma de frenar la entrega.
  IF v_plan IS NOT NULL AND NOT (v_plan ->> 'ok')::boolean THEN
    RAISE EXCEPTION '%', v_plan ->> 'message' USING ERRCODE = v_plan ->> 'code';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 4. Revisar una entrega: con límites, solo la última ────────────────────
CREATE OR REPLACE FUNCTION app_servicio.submission_review(p_submission_id uuid, p_status text, p_grade_value jsonb, p_comment text, p_internal_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  fs record;
  v_type text;
  v_product uuid;
  v_grading jsonb;
  v_def jsonb;
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
  SELECT fv.definition INTO v_def FROM public.form_versions fv WHERE fv.id = fs.form_version_id;
  v_grading := v_def -> 'grading';
  -- F126: con límites configurados, solo se revisa la última entrega de esa persona (ni una reemplazada ni una vieja).
  IF jsonb_typeof(v_def -> 'submission') = 'object' AND (
       fs.review_status = 'superseded'
       OR EXISTS (SELECT 1 FROM public.form_submissions o
                   WHERE o.form_id = fs.form_id AND o.contact_id IS NOT DISTINCT FROM fs.contact_id AND o.status = 'received'
                     AND o.id <> fs.id AND o.review_status IS DISTINCT FROM 'superseded'
                     AND (COALESCE(o.attempt, 0), o.created_at, o.id) > (COALESCE(fs.attempt, 0), fs.created_at, fs.id))) THEN
    RAISE EXCEPTION 'Solo se revisa la última entrega' USING ERRCODE = 'EV006';
  END IF;
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

-- ─── 5. Permisos ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION app_servicio.submission_plan(jsonb), app_servicio.portal_form_before_hook(),
  app_servicio.submission_review(uuid, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.submission_plan(jsonb), app_servicio.submission_review(uuid, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION app_servicio.submission_review(uuid, text, jsonb, text, text) TO authenticated;
