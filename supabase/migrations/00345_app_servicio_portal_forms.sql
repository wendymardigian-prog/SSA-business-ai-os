-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00345_app_servicio_portal_forms  (Servicios v12, Corrida A1 · S11 · bloque EV)
-- ============================================================================
-- 1. `forms.type` suma `terms` (terminos al entrar, F113), `quiz` (Evaluacion: la corrige el sistema) y `activity`
--    (Actividad: con calificacion opcional). El CHECK se redefine partiendo del VIGENTE en la base (leido con
--    pg_get_constraintdef el 8/11/2026):
--      CHECK ((type = ANY (ARRAY['custom'::text, 'survey'::text, 'contract'::text, 'eod'::text])))
--    `forms.product_id` (obligatorio para esos tres, CHECK). La pantalla de Formularios y la pagina publica no los
--    muestran (lo hace el codigo: `isPublicFormType`; `get_public_form` no se toca).
-- 2. Columnas de revision en `form_submissions` (F54-F56): `grade`, `attempt`, `review_status`, `review_comment`,
--    `internal_note`, `reviewed_by`, `reviewed_at` y `context` ('portal').
-- 3. Gemelas puras: `quiz_grade_plan(jsonb)` (lib/program/quiz.ts), `grading_passed(text, jsonb, jsonb)`
--    (lib/program/grading.ts) y `portal_terms_plan(jsonb)` (lib/program/terms.ts).
-- 4. Triggers sobre `form_submissions` SOLO para quiz y activity (los demas tipos salen al principio): antes de
--    guardar, el intento y la nota (de la VERSION respondida); despues, los eventos y los pasos del camino segun
--    `complete_on`. Nunca tumban la respuesta (EXCEPTION). `submission_hook` de la 00335 NO se toca: sigue con
--    custom y survey.
-- 5. `submission_review(...)` (F56, `submissions.review` con el alcance de los servicios) y `portal_terms_pending`.
--
-- Aditiva + amplia un CHECK (solo suma valores; aborta si hubiera filas que el CHECK nuevo no acepte, que no puede
-- haber). Puede ir antes o despues del codigo.
--
-- Cómo volver atrás (solo si no hay formularios de los tipos nuevos):
--   DROP TRIGGER IF EXISTS trg_app_servicio_portal_form_before ON public.form_submissions;
--   DROP TRIGGER IF EXISTS trg_app_servicio_portal_form_after ON public.form_submissions;
--   ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_portal_product_check;
--   ALTER TABLE public.forms DROP CONSTRAINT forms_type_check;
--   ALTER TABLE public.forms ADD CONSTRAINT forms_type_check CHECK ((type = ANY (ARRAY['custom'::text, 'survey'::text, 'contract'::text, 'eod'::text])));
--   ALTER TABLE public.forms DROP COLUMN IF EXISTS product_id;
--   ALTER TABLE public.form_submissions DROP COLUMN IF EXISTS grade, ... (las ocho columnas de abajo);
--   DROP FUNCTION de cada funcion nueva.
--
-- Riesgo: medio (dos triggers nuevos sobre form_submissions; salen enseguida para los tipos de siempre).
-- ============================================================================

-- ─── 1. Tipos y producto ────────────────────────────────────────────────────
ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_type_check;
ALTER TABLE public.forms ADD CONSTRAINT forms_type_check CHECK (type = ANY (ARRAY['custom'::text, 'survey'::text, 'contract'::text, 'eod'::text, 'terms'::text, 'quiz'::text, 'activity'::text]));
ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS product_id uuid NULL REFERENCES public.products(id) ON DELETE CASCADE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forms_portal_product_check' AND conrelid = 'public.forms'::regclass) THEN
    ALTER TABLE public.forms ADD CONSTRAINT forms_portal_product_check CHECK (type NOT IN ('terms', 'quiz', 'activity') OR product_id IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_forms_product ON public.forms (product_id) WHERE product_id IS NOT NULL;
COMMENT ON COLUMN public.forms.product_id IS 'Servicios v12 (F52, F113): el programa de un formulario del portal (terms, quiz, activity). NULL en los demas.';

-- ─── 2. La revision de una respuesta ────────────────────────────────────────
ALTER TABLE public.form_submissions ADD COLUMN IF NOT EXISTS grade jsonb NULL;
ALTER TABLE public.form_submissions ADD COLUMN IF NOT EXISTS attempt integer NULL;
ALTER TABLE public.form_submissions ADD COLUMN IF NOT EXISTS review_status text NULL;
ALTER TABLE public.form_submissions ADD COLUMN IF NOT EXISTS review_comment text NULL;
ALTER TABLE public.form_submissions ADD COLUMN IF NOT EXISTS internal_note text NULL;
ALTER TABLE public.form_submissions ADD COLUMN IF NOT EXISTS reviewed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.form_submissions ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL;
ALTER TABLE public.form_submissions ADD COLUMN IF NOT EXISTS context text NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_submissions_review_status_check' AND conrelid = 'public.form_submissions'::regclass) THEN
    ALTER TABLE public.form_submissions ADD CONSTRAINT form_submissions_review_status_check CHECK (review_status IS NULL OR review_status IN ('pending', 'graded', 'reviewed', 'needs_changes'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_submissions_context_check' AND conrelid = 'public.form_submissions'::regclass) THEN
    ALTER TABLE public.form_submissions ADD CONSTRAINT form_submissions_context_check CHECK (context IS NULL OR context IN ('portal'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_form_submissions_review ON public.form_submissions (workspace_id, review_status) WHERE review_status IS NOT NULL;
COMMENT ON COLUMN public.form_submissions.internal_note IS 'Servicios v12 (F56): nota interna del equipo. Ninguna funcion del portal la devuelve.';

-- ─── 3. Gemelas puras ───────────────────────────────────────────────────────
-- Gemela de gradeQuiz. Entrada: {settings, answers, attempt}.
CREATE OR REPLACE FUNCTION app_servicio.quiz_grade_plan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  qs jsonb := COALESCE(p #> '{settings,questions}', '{}'::jsonb);
  ans jsonb := COALESCE(p -> 'answers', '{}'::jsonb);
  v_key text;
  q jsonb;
  v_points numeric;
  v_given text[];
  v_correct text[];
  v_exact boolean;
  v_got numeric;
  v_hits integer;
  v_total numeric := 0;
  v_earned numeric := 0;
  v_per jsonb := '{}'::jsonb;
  v_pct numeric;
  v_pass numeric := COALESCE(CASE WHEN jsonb_typeof(p #> '{settings,pass_pct}') = 'number' THEN (p #>> '{settings,pass_pct}')::numeric END, 70);
  v_attempts integer := COALESCE(CASE WHEN jsonb_typeof(p #> '{settings,attempts}') = 'number' AND (p #>> '{settings,attempts}')::numeric > 0 THEN (p #>> '{settings,attempts}')::numeric::integer END, 1);
BEGIN
  FOR v_key IN SELECT k FROM jsonb_object_keys(qs) k ORDER BY k COLLATE "C" LOOP
    q := qs -> v_key;
    v_points := CASE WHEN jsonb_typeof(q -> 'points') = 'number' AND (q ->> 'points')::numeric > 0 THEN (q ->> 'points')::numeric ELSE 0 END;
    v_total := v_total + v_points;
    v_given := CASE jsonb_typeof(ans -> v_key)
      WHEN 'array' THEN ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(ans -> v_key) x)
      WHEN 'string' THEN CASE WHEN ans ->> v_key <> '' THEN ARRAY[ans ->> v_key] ELSE ARRAY[]::text[] END
      ELSE ARRAY[]::text[] END;
    v_correct := ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(COALESCE(q -> 'correct', '[]'::jsonb)) x);
    v_exact := v_given <@ v_correct AND v_correct <@ v_given;
    v_got := 0;
    IF v_exact THEN
      v_got := v_points;
    ELSIF COALESCE((q ->> 'partial')::boolean, false) AND cardinality(v_correct) > 0 THEN
      v_hits := (SELECT count(*) FROM unnest(v_given) g WHERE g = ANY (v_correct));
      v_got := GREATEST(0, round(v_points * (v_hits - (cardinality(v_given) - v_hits)) / cardinality(v_correct), 2));
    END IF;
    v_earned := v_earned + v_got;
    v_per := v_per || jsonb_build_object(v_key, jsonb_build_object('earned', v_got, 'points', v_points, 'correct', v_exact));
  END LOOP;
  v_pct := CASE WHEN v_total > 0 THEN round(v_earned / v_total * 100, 2) ELSE 0 END;
  RETURN jsonb_build_object('total', round(v_total, 2), 'earned', round(v_earned, 2), 'pct', v_pct, 'passed', v_pct >= v_pass,
                            'counted', COALESCE((p ->> 'attempt')::integer, 1) <= v_attempts, 'per_question', v_per);
END;
$$;

-- Gemela de passedFor. NULL = el valor no es de la escala.
CREATE OR REPLACE FUNCTION app_servicio.grading_passed(p_scale text, p_value jsonb, p_pass_at jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  words text[] := ARRAY['muy_malo', 'malo', 'regular', 'bueno', 'muy_bueno', 'excelente'];
  lo integer; hi integer; v numeric; at numeric; i integer; j integer;
BEGIN
  IF p_scale = 'pass' THEN
    IF jsonb_typeof(p_value) = 'string' AND p_value #>> '{}' IN ('approved', 'not_approved') THEN RETURN p_value #>> '{}' = 'approved'; END IF;
    RETURN NULL;
  END IF;
  IF p_scale = 'words' THEN
    IF jsonb_typeof(p_value) <> 'string' OR NOT (p_value #>> '{}' = ANY (words)) THEN RETURN NULL; END IF;
    i := array_position(words, p_value #>> '{}');
    j := CASE WHEN jsonb_typeof(p_pass_at) = 'string' AND p_pass_at #>> '{}' = ANY (words) THEN array_position(words, p_pass_at #>> '{}') ELSE 4 END;
    RETURN i >= j;
  END IF;
  IF p_scale = 'stars' THEN lo := 1; hi := 5; at := 3;
  ELSIF p_scale = 'n10' THEN lo := 1; hi := 10; at := 6;
  ELSIF p_scale = 'n100' THEN lo := 1; hi := 100; at := 70;
  ELSE RETURN NULL; END IF;
  IF jsonb_typeof(p_value) <> 'number' THEN RETURN NULL; END IF;
  v := (p_value #>> '{}')::numeric;
  IF v <> trunc(v) OR v < lo OR v > hi THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_pass_at) = 'number' THEN at := (p_pass_at #>> '{}')::numeric; END IF;
  RETURN v >= at;
END;
$$;

-- Gemela de termsPending. Entrada: {enabled, formId, askAgainOnChange, variantsAsk, acceptedVersionIds, currentVersionId}.
CREATE OR REPLACE FUNCTION app_servicio.portal_terms_plan(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT COALESCE((p ->> 'enabled')::boolean, false) OR NULLIF(p ->> 'formId', '') IS NULL THEN false
    WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p -> 'variantsAsk', '[]'::jsonb)) x WHERE x = 'true'::jsonb) THEN false
    WHEN jsonb_array_length(COALESCE(p -> 'acceptedVersionIds', '[]'::jsonb)) = 0 THEN true
    WHEN COALESCE((p ->> 'askAgainOnChange')::boolean, false) AND NULLIF(p ->> 'currentVersionId', '') IS NOT NULL
         AND NOT (COALESCE(p -> 'acceptedVersionIds', '[]'::jsonb) ? (p ->> 'currentVersionId')) THEN true
    ELSE false END;
$$;

-- Si una persona tiene que aceptar los terminos de un programa antes de entrar (F113).
CREATE OR REPLACE FUNCTION app_servicio.portal_terms_pending(p_contact_id uuid, p_product_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t jsonb;
  v_form uuid;
BEGIN
  SELECT pr.portal_settings -> 'terms' INTO t FROM public.products pr WHERE pr.id = p_product_id;
  v_form := NULLIF(t ->> 'form_id', '')::uuid;
  RETURN app_servicio.portal_terms_plan(jsonb_build_object(
    'enabled', COALESCE((t ->> 'enabled')::boolean, false),
    'formId', v_form,
    'askAgainOnChange', COALESCE((t ->> 'ask_again_on_change')::boolean, true),
    'variantsAsk', COALESCE((SELECT jsonb_agg(COALESCE((v.portal_settings ->> 'ask_terms')::boolean, true))
                               FROM app_servicio.services s JOIN public.product_variants v ON v.id = s.product_variant_id
                              WHERE s.contact_id = p_contact_id AND s.product_id = p_product_id AND s.status IN ('active', 'paused')), '[]'::jsonb),
    'acceptedVersionIds', COALESCE((SELECT jsonb_agg(DISTINCT fs.form_version_id::text) FROM public.form_submissions fs
                                    WHERE fs.form_id = v_form AND fs.contact_id = p_contact_id AND fs.status = 'received'), '[]'::jsonb),
    'currentVersionId', (SELECT fv.id::text FROM public.form_versions fv WHERE fv.form_id = v_form ORDER BY fv.version_number DESC LIMIT 1)));
END;
$$;

-- ─── 4. Antes y despues de guardar una evaluacion o una actividad ───────────
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
DROP TRIGGER IF EXISTS trg_app_servicio_portal_form_before ON public.form_submissions;
CREATE TRIGGER trg_app_servicio_portal_form_before BEFORE INSERT ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION app_servicio.portal_form_before_hook();

-- Completa los pasos del camino de un formulario del portal segun lo que ya se cumplio (`complete_on`).
CREATE OR REPLACE FUNCTION app_servicio.svc_complete_portal_form(p_workspace_id uuid, p_contact_id uuid, p_form_id uuid, p_kind text, p_met text[], p_source text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it record;
  n integer := 0;
BEGIN
  FOR it IN
    SELECT i.id FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
     WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.status IN ('active', 'paused') AND i.status = 'pending'
       AND NOT i.is_recurring_template AND i.kind = p_kind AND i.ref ->> 'form_id' = p_form_id::text
       AND COALESCE(i.ref ->> 'complete_on', CASE p_kind WHEN 'quiz' THEN 'passed' ELSE 'submitted' END) = ANY (p_met)
  LOOP
    PERFORM app_servicio.svc_mark_item(it.id, p_source, 'client', NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.portal_form_after_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_type text;
  v_product uuid;
  sv record;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NEW.context IS DISTINCT FROM 'portal' OR NEW.contact_id IS NULL OR NEW.status <> 'received' THEN RETURN NULL; END IF;
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    SELECT f.type, f.product_id INTO v_type, v_product FROM public.forms f WHERE f.id = NEW.form_id;
    IF v_type = 'quiz' THEN
      PERFORM app_servicio.svc_complete_portal_form(NEW.workspace_id, NEW.contact_id, NEW.form_id, 'quiz',
        CASE WHEN COALESCE((NEW.grade ->> 'passed')::boolean, false) AND COALESCE((NEW.grade ->> 'counted')::boolean, true) THEN ARRAY['finished', 'passed'] ELSE ARRAY['finished'] END,
        'quiz_submission');
    ELSIF v_type = 'activity' THEN
      PERFORM app_servicio.svc_complete_portal_form(NEW.workspace_id, NEW.contact_id, NEW.form_id, 'activity', ARRAY['submitted'], 'activity_submission');
    END IF;
    FOR sv IN SELECT id FROM app_servicio.services WHERE contact_id = NEW.contact_id AND product_id = v_product AND status IN ('active', 'paused') LOOP
      IF v_type = 'activity' THEN
        PERFORM app_servicio.emit_service(sv.id, 'task_submission_received', jsonb_build_object('form_id', NEW.form_id, 'submission_id', NEW.id));
      ELSIF v_type = 'quiz' AND COALESCE((NEW.grade ->> 'counted')::boolean, true) THEN
        PERFORM app_servicio.emit_service(sv.id, CASE WHEN COALESCE((NEW.grade ->> 'passed')::boolean, false) THEN 'quiz_passed' ELSE 'quiz_failed' END,
          jsonb_build_object('form_id', NEW.form_id, 'submission_id', NEW.id, 'pct', NEW.grade -> 'pct'));
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'portal_form', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_portal_form_after ON public.form_submissions;
CREATE TRIGGER trg_app_servicio_portal_form_after AFTER INSERT ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION app_servicio.portal_form_after_hook();

-- ─── 5. Revisar una entrega (F56) ───────────────────────────────────────────
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

-- ─── 6. Permisos de ejecucion ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio.quiz_grade_plan(jsonb), app_servicio.grading_passed(text, jsonb, jsonb), app_servicio.portal_terms_plan(jsonb),
  app_servicio.portal_terms_pending(uuid, uuid), app_servicio.portal_form_before_hook(), app_servicio.svc_complete_portal_form(uuid, uuid, uuid, text, text[], text),
  app_servicio.portal_form_after_hook(), app_servicio.submission_review(uuid, text, jsonb, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio.quiz_grade_plan(jsonb), app_servicio.grading_passed(text, jsonb, jsonb), app_servicio.portal_terms_plan(jsonb),
  app_servicio.portal_terms_pending(uuid, uuid), app_servicio.svc_complete_portal_form(uuid, uuid, uuid, text, text[], text),
  app_servicio.submission_review(uuid, text, jsonb, text, text)
TO service_role;
GRANT EXECUTE ON FUNCTION app_servicio.submission_review(uuid, text, jsonb, text, text) TO authenticated;
