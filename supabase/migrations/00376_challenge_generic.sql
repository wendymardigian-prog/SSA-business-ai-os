-- ============================================================
-- 00376_challenge_generic.sql
-- ============================================================
-- Servicios A3, F127 (decisión 470): Reto genérico. Ninguna tabla ni columna nueva: todo vive en `service_phases.challenge`,
-- `service_items.recurrence`, `service_items.late` y `ref` (jsonb que ya existen).
--
--   1. Reglas para aceptar (`challenge.acceptance`, solo con start = student). `svc_start_challenge_accepting` (solo
--      servidor; la llama el portal en B2) guarda `challenge.accepted = {at, by_contact, items, text_hash}` y queda en el
--      historial. `svc_start_challenge` con actor 'student' es solo del servidor y pide la aceptación (SV037).
--   2. Anclas nuevas de la repetición: `from` = {from: …|phase_end|item_completed, phase_key?, item_key?, days};
--      `until` suma item_completed (+ item_key) y phase_end de otra fase (+ phase_key); `max_days` es un tope.
--      `svc_recurrence_window` (gemela recurrenceWindow) y `svc_occurrence_dates` (+ item_completed y max_days).
--      Una repetición se crea solo mientras su fase está abierta (no se crean fechas anteriores a su inicio).
--   3. `late.early` (por defecto no se adelanta) y `late.grace_days`: `svc_late_plan` (gemela latePlan); `svc_mark_item`
--      lo exige a lo que carga el ESTUDIANTE en una repetición con `late` (SV035 / SV036). El equipo completa igual.
--   4. Una repetición con required = false no cuenta para `late_light` ni para el semáforo del paso (`svc_compute_light`).
--   5. Control semanal `challenge.weekly = {min, video, number_field_key?, link_field_key?, stuck_field_key?}`:
--      `svc_challenge_weeks_plan` (gemela challengeWeeks) y la lectura `svc_challenge_view` para la ficha. El campo
--      «trabado» (decisión de producto, 14/11) marca los días con algo escrito.
--   6. `challenge.start_by = {from: service_start|service_created, days}`: `svc_challenge_start_by`; el cron diario
--      (`svc_open_due_challenges`, que ya llama svc_daily_run) avisa UNA vez al responsable al pasarse. No bloquea.
--   7. Certificado según si llegó a tiempo: `ref.templates` en el paso de certificado (validación acá; elegir la
--      plantilla es código, certificateTemplatePick).
--   Validación del camino: `journey_challenge_problems`, `journey_recurrence_problems` (+ late), `journey_item_cross_problems`,
--   `journey_item_ref_problems` (certificado) y `validate_journey_template`. Gemela: lib/services/journey-template.ts;
--   casos en journey-template.cases.json, recurrence.cases.json y challenge.cases.json.
--
-- Antes de aplicarla (14/11/2026, producción): 4 caminos guardados, ninguno con reto, repetición ni atraso; 0 moldes,
-- 0 repeticiones y 0 fases con reto en los servicios. Ninguna validación ni fecha cambia para lo que ya existe.
--
-- Como volver atras: las definiciones viejas de las nueve funciones que reescribe están en
-- docs/servicios/definiciones-viejas-a3.sql (§00376). Las funciones nuevas se pueden dejar, o:
--   DROP FUNCTION IF EXISTS app_servicio.journey_challenge_problems(jsonb, text), app_servicio.journey_item_cross_problems(jsonb, text, text, text[], text[]),
--     app_servicio.svc_recurrence_window(jsonb, jsonb), app_servicio.svc_late_plan(jsonb, date, date, timestamp),
--     app_servicio.svc_challenge_weeks_plan(jsonb), app_servicio.svc_challenge_start_by(jsonb, date, date),
--     app_servicio.svc_start_challenge_accepting(uuid, integer[], uuid), app_servicio.svc_challenge_view(uuid);

-- ─── 1. Validación del camino: Reto, repeticiones, atraso y referencias (gemelas en journey-template.ts) ───
-- F127.1, F127.5, F127.6: las reglas para aceptar, el control semanal (con el campo «trabado») y la fecha límite.
CREATE OR REPLACE FUNCTION app_servicio.journey_challenge_problems(ch jsonb, p_label text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  a jsonb := ch -> 'acceptance';
  w jsonb := ch -> 'weekly';
  sb jsonb := ch -> 'start_by';
  k text;
  v_bad boolean;
BEGIN
  IF a IS NOT NULL AND jsonb_typeof(a) <> 'null' THEN
    IF jsonb_typeof(a) <> 'object' THEN
      v := v || format('«%s»: las reglas para aceptar no son válidas', p_label);
    ELSE
      IF ch ->> 'start' IS DISTINCT FROM 'student' THEN v := v || format('«%s»: las reglas para aceptar son solo si lo empieza el estudiante', p_label); END IF;
      IF a -> 'enabled' = 'true'::jsonb THEN
        IF (CASE WHEN jsonb_typeof(a -> 'items') = 'array' AND jsonb_array_length(a -> 'items') BETWEEN 1 AND 20 THEN NOT EXISTS (
                  SELECT 1 FROM jsonb_array_elements(a -> 'items') x
                   WHERE jsonb_typeof(x) <> 'string' OR btrim(x #>> '{}', E' \t\r\n') = '' OR char_length(x #>> '{}') > 300) ELSE false END) IS NOT TRUE THEN
          v := v || format('«%s»: las reglas tienen de 1 a 20 puntos de hasta 300 caracteres', p_label);
        END IF;
      END IF;
      IF (a ? 'description' AND jsonb_typeof(a -> 'description') <> 'null'
          AND NOT (jsonb_typeof(a -> 'description') = 'string' AND char_length(a ->> 'description') <= 2000))
         OR (a ? 'button_label' AND jsonb_typeof(a -> 'button_label') <> 'null'
          AND NOT (jsonb_typeof(a -> 'button_label') = 'string' AND char_length(a ->> 'button_label') <= 40 AND (a ->> 'button_label') !~ E'[\\r\\n]')) THEN
        v := v || format('«%s»: el texto de las reglas o del botón es muy largo', p_label);
      END IF;
    END IF;
  END IF;
  IF w IS NOT NULL AND jsonb_typeof(w) <> 'null' THEN
    v_bad := jsonb_typeof(w) <> 'object';
    IF NOT v_bad THEN
      v_bad := (w ? 'min' AND jsonb_typeof(w -> 'min') <> 'null'
                AND NOT (CASE WHEN jsonb_typeof(w -> 'min') = 'number' THEN (w ->> 'min')::numeric BETWEEN 0 AND 1000 ELSE false END))
            OR (w ? 'video' AND jsonb_typeof(w -> 'video') <> 'boolean');
      FOREACH k IN ARRAY ARRAY['number_field_key', 'link_field_key', 'stuck_field_key'] LOOP
        IF w ? k AND jsonb_typeof(w -> k) <> 'null' AND NOT (jsonb_typeof(w -> k) = 'string' AND (w ->> k) ~ '^[a-z][a-z0-9_]{0,39}$') THEN v_bad := true; END IF;
      END LOOP;
    END IF;
    IF v_bad THEN v := v || format('«%s»: el control semanal no es válido', p_label); END IF;
  END IF;
  IF sb IS NOT NULL AND jsonb_typeof(sb) <> 'null' THEN
    IF (CASE WHEN jsonb_typeof(sb) = 'object' THEN COALESCE(sb ->> 'from' = ANY (ARRAY['service_start','service_created']), false)
                 AND app_servicio.j_int(sb -> 'days') AND app_servicio.j_num(sb -> 'days') BETWEEN 0 AND 3650 ELSE false END) IS NOT TRUE THEN
      v := v || format('«%s»: la fecha límite para empezar no es válida', p_label);
    END IF;
  END IF;
  RETURN v;
END;
$$;

-- F127.2 y F127.3: anclas nuevas de la repetición y el atraso (`late`). Lo de antes, igual y en el mismo orden.
CREATE OR REPLACE FUNCTION app_servicio.journey_recurrence_problems(p_item jsonb, p_nm text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
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
      IF NOT COALESCE(r ->> 'every' = ANY (ARRAY['day','week','n_days']), false) THEN v := v || format('«%s»: elegí cada cuánto se repite', p_nm); END IF;
      IF r ->> 'every' = 'n_days' AND NOT (app_servicio.j_int(r -> 'n') AND app_servicio.j_num(r -> 'n') BETWEEN 1 AND 365) THEN
        v := v || format('«%s»: elegí cada cuántos días se repite', p_nm);
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
$$;

-- F127: las fases y pasos que nombran la repetición y el certificado existen (y no son los suyos). Gemela de crossRefProblems.
CREATE OR REPLACE FUNCTION app_servicio.journey_item_cross_problems(p_item jsonb, p_nm text, p_phase text, p_phases text[], p_items text[])
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  r jsonb := CASE WHEN jsonb_typeof(p_item -> 'recurrence') = 'object' THEN p_item -> 'recurrence' END;
  f jsonb;
  ref jsonb := CASE WHEN jsonb_typeof(p_item -> 'ref') = 'object' THEN p_item -> 'ref' END;
BEGIN
  f := CASE WHEN jsonb_typeof(r -> 'from') = 'object' THEN r -> 'from' END;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[CASE WHEN jsonb_typeof(f -> 'phase_key') = 'string' THEN f ->> 'phase_key' END,
                                        CASE WHEN jsonb_typeof(r -> 'phase_key') = 'string' THEN r ->> 'phase_key' END]) k
              WHERE k ~ '^ph_[a-z0-9]{6}$' AND (NOT (k = ANY (p_phases)) OR k IS NOT DISTINCT FROM p_phase)) THEN
    v := v || format('«%s»: la fase de la repetición tiene que ser otra fase del camino', p_nm);
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[CASE WHEN jsonb_typeof(f -> 'item_key') = 'string' THEN f ->> 'item_key' END,
                                        CASE WHEN r ->> 'until' = 'item_completed' AND jsonb_typeof(r -> 'item_key') = 'string' THEN r ->> 'item_key' END]) k
              WHERE k ~ '^it_[a-z0-9]{6}$' AND (NOT (k = ANY (p_items)) OR k IS NOT DISTINCT FROM (p_item ->> 'key'))) THEN
    v := v || format('«%s»: el paso de la repetición tiene que ser otro paso del camino', p_nm);
  END IF;
  IF p_item ->> 'kind' = 'certificate' AND jsonb_typeof(ref -> 'templates') = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(ref -> 'templates') c
                  WHERE jsonb_typeof(c -> 'item_key') = 'string' AND (c ->> 'item_key') ~ '^it_[a-z0-9]{6}$' AND NOT ((c ->> 'item_key') = ANY (p_items))) THEN
    v := v || format('«%s»: el paso del certificado no existe', p_nm);
  END IF;
  RETURN v;
END;
$$;

-- El camino completo y los pasos (lo de siempre igual; F127 suma el Reto, las referencias y el certificado).
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
  -- F127 (00376)
  v_all_phases text[] := ARRAY[]::text[];
  v_all_items text[] := ARRAY[]::text[];
  v_ph_key text;
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
  -- F127: las repeticiones y el certificado pueden nombrar cualquier fase o paso del camino (no solo los anteriores).
  SELECT COALESCE(array_agg(x ->> 'key'), ARRAY[]::text[]) INTO v_all_phases
    FROM jsonb_array_elements(p -> 'phases') x WHERE jsonb_typeof(x) = 'object' AND jsonb_typeof(x -> 'key') = 'string';
  SELECT COALESCE(array_agg(i ->> 'key'), ARRAY[]::text[]) INTO v_all_items
    FROM jsonb_array_elements(p -> 'phases') x,
         jsonb_array_elements(CASE WHEN jsonb_typeof(x) = 'object' AND jsonb_typeof(x -> 'items') = 'array' THEN x -> 'items' ELSE '[]'::jsonb END) i
   WHERE jsonb_typeof(i) = 'object' AND jsonb_typeof(i -> 'key') = 'string';

  FOR ph IN SELECT x FROM jsonb_array_elements(p -> 'phases') x LOOP
    IF jsonb_typeof(ph) <> 'object' THEN v := v || 'hay una fase que no es válida'::text; CONTINUE; END IF;
    v := v || app_servicio.unknown_keys(ph, ARRAY['key','name','duration_days','yellow_day','red_day','advance','challenge','late_light','items']);
    v_key := CASE WHEN jsonb_typeof(ph -> 'key') = 'string' THEN ph ->> 'key' END;
    IF v_key IS NULL OR v_key !~ '^ph_[a-z0-9]{6}$' THEN v := v || 'hay una fase con una clave inválida'::text;
    ELSIF v_key = ANY (v_phase_keys) THEN v := v || format('la clave %s está repetida', v_key);
    ELSE v_phase_keys := v_phase_keys || v_key;
    END IF;
    v_ph_key := CASE WHEN jsonb_typeof(ph -> 'key') = 'string' THEN ph ->> 'key' END;
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
        v := v || app_servicio.journey_challenge_problems(ch, v_label);
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
      v := v || app_servicio.journey_item_cross_problems(it, v_nm, v_ph_key, v_all_phases, v_all_items);
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
  -- F127 (00376).
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
    -- F127.7: [{if: on_time, item_key, template_id}, …, {else: true, template_id}] (mismo orden que refProblems, TS).
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

-- ─── 2. Reglas puras del Reto (gemelas en lib/services/challenge.ts, challenge.cases.json) ─────────────
-- F127.2: desde y hasta cuándo se repite. p_anchors = {serviceCreated, serviceStart, serviceEnd, phaseStart, phaseEnd,
-- phases: {clave: {start, end}}, items: {clave: fecha en que se completó}}.
CREATE OR REPLACE FUNCTION app_servicio.svc_recurrence_window(p_recurrence jsonb, p_anchors jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  r jsonb := COALESCE(p_recurrence, '{}'::jsonb);
  f jsonb := CASE WHEN jsonb_typeof(p_recurrence -> 'from') = 'object' THEN p_recurrence -> 'from' END;
  pk text; ik text; rpk text;
  v_base date; v_start date; v_until date;
BEGIN
  IF f IS NULL THEN
    v_start := (p_anchors ->> 'phaseStart')::date;
  ELSE
    pk := CASE WHEN jsonb_typeof(f -> 'phase_key') = 'string' AND (f ->> 'phase_key') <> '' THEN f ->> 'phase_key' END;
    ik := CASE WHEN jsonb_typeof(f -> 'item_key') = 'string' THEN f ->> 'item_key' END;
    v_base := CASE f ->> 'from'
      WHEN 'service_created' THEN (p_anchors ->> 'serviceCreated')::date
      WHEN 'service_start' THEN (p_anchors ->> 'serviceStart')::date
      WHEN 'phase_start' THEN CASE WHEN pk IS NOT NULL THEN (p_anchors #>> ARRAY['phases', pk, 'start'])::date ELSE (p_anchors ->> 'phaseStart')::date END
      WHEN 'phase_end' THEN CASE WHEN pk IS NOT NULL THEN (p_anchors #>> ARRAY['phases', pk, 'end'])::date ELSE (p_anchors ->> 'phaseEnd')::date END
      WHEN 'item_completed' THEN (p_anchors #>> ARRAY['items', ik])::date
    END;
    v_start := v_base + CASE WHEN app_servicio.j_int(f -> 'days') THEN (f ->> 'days')::integer ELSE 0 END;
    -- Las anclas de siempre (sin phase_key) sin fecha arrancan con su fase, como antes de F127.
    IF v_start IS NULL AND pk IS NULL AND f ->> 'from' IN ('service_created','service_start','phase_start') THEN
      v_start := (p_anchors ->> 'phaseStart')::date;
    END IF;
  END IF;
  IF v_start IS NULL THEN RETURN jsonb_build_object('start', NULL, 'until', NULL); END IF;
  rpk := CASE WHEN jsonb_typeof(r -> 'phase_key') = 'string' AND (r ->> 'phase_key') <> '' THEN r ->> 'phase_key' END;
  v_until := CASE r ->> 'until'
    WHEN 'phase_end' THEN CASE WHEN rpk IS NOT NULL THEN (p_anchors #>> ARRAY['phases', rpk, 'end'])::date ELSE (p_anchors ->> 'phaseEnd')::date END
    WHEN 'service_end' THEN (p_anchors ->> 'serviceEnd')::date
    WHEN 'n_days' THEN v_start + GREATEST(1, CASE WHEN jsonb_typeof(r -> 'n_until') = 'number' THEN (r ->> 'n_until')::numeric::integer ELSE 1 END) - 1
    WHEN 'item_completed' THEN (p_anchors #>> ARRAY['items', CASE WHEN jsonb_typeof(r -> 'item_key') = 'string' THEN r ->> 'item_key' END])::date
  END;
  IF app_servicio.j_int(r -> 'max_days') AND (r ->> 'max_days')::integer >= 1 THEN
    v_until := LEAST(v_until, v_start + (r ->> 'max_days')::integer - 1);
  END IF;
  RETURN jsonb_build_object('start', to_char(v_start, 'YYYY-MM-DD'), 'until', to_char(v_until, 'YYYY-MM-DD'));
END;
$$;

-- F127.3: si una repetición se puede completar ahora (p_now = hora local del estudiante).
CREATE OR REPLACE FUNCTION app_servicio.svc_late_plan(p_late jsonb, p_occurs date, p_due date, p_now timestamp)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_gh numeric; v_deadline timestamp;
BEGIN
  IF p_late IS NULL OR jsonb_typeof(p_late) <> 'object' THEN RETURN jsonb_build_object('ok', true, 'late', false); END IF;
  IF p_late -> 'early' IS DISTINCT FROM 'true'::jsonb AND p_now::date < p_occurs THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SV035', 'message', 'Todavía no se puede cargar');
  END IF;
  v_gh := CASE WHEN jsonb_typeof(p_late -> 'grace_hours') = 'number' AND (p_late ->> 'grace_hours')::numeric > 0 THEN (p_late ->> 'grace_hours')::numeric ELSE 0 END;
  v_deadline := (p_due + 1)::timestamp + make_interval(secs => v_gh * 3600);
  IF p_now < v_deadline THEN RETURN jsonb_build_object('ok', true, 'late', false); END IF;
  IF p_late -> 'accept' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SV036', 'message', 'Ya pasó el plazo para cargarlo');
  END IF;
  IF app_servicio.j_int(p_late -> 'grace_days') AND (p_late ->> 'grace_days')::integer >= 0
     AND p_now >= v_deadline + make_interval(days => (p_late ->> 'grace_days')::integer) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SV036', 'message', 'Ya pasó el plazo para cargarlo');
  END IF;
  RETURN jsonb_build_object('ok', true, 'late', true);
END;
$$;

-- F127.5: el control semanal. p = {startOn, today, days, min, video, rows: [{on, number, link, stuck}]}.
CREATE OR REPLACE FUNCTION app_servicio.svc_challenge_weeks_plan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_start date := (p ->> 'startOn')::date;
  v_today date := (p ->> 'today')::date;
  v_days integer := CASE WHEN jsonb_typeof(p -> 'days') = 'number' AND (p ->> 'days')::numeric > 0 THEN (p ->> 'days')::numeric::integer END;
  v_min numeric := CASE WHEN jsonb_typeof(p -> 'min') = 'number' THEN (p ->> 'min')::numeric END;
  v_video boolean := p -> 'video' = 'true'::jsonb;
  v_rows jsonb := CASE WHEN jsonb_typeof(p -> 'rows') = 'array' THEN p -> 'rows' ELSE '[]'::jsonb END;
  v_last date; v_from date; v_to date; v_short boolean; v_finished boolean;
  v_total numeric; v_has_video boolean; v_missing boolean; v_below boolean; v_stuck jsonb;
  v_out jsonb := '[]'::jsonb;
  w integer;
BEGIN
  v_last := CASE WHEN v_days IS NOT NULL THEN v_start + v_days - 1 WHEN v_today < v_start THEN v_start ELSE v_today END;
  FOR w IN 1 .. 200 LOOP
    v_from := v_start + (w - 1) * 7;
    EXIT WHEN v_from > v_last;
    v_to := v_from + 6;
    v_short := v_to > v_last;
    IF v_short THEN v_to := v_last; END IF;
    SELECT trim_scale(round(COALESCE(sum((x ->> 'number')::numeric) FILTER (WHERE jsonb_typeof(x -> 'number') = 'number'), 0), 2)),
           COALESCE(bool_or(jsonb_typeof(x -> 'link') = 'string' AND btrim(x ->> 'link', E' \t\r\n') <> ''), false),
           COALESCE(jsonb_agg(jsonb_build_object('on', x ->> 'on', 'text', btrim(x ->> 'stuck', E' \t\r\n')) ORDER BY o)
                      FILTER (WHERE jsonb_typeof(x -> 'stuck') = 'string' AND btrim(x ->> 'stuck', E' \t\r\n') <> ''), '[]'::jsonb)
      INTO v_total, v_has_video, v_stuck
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(x, o)
     WHERE (x ->> 'on')::date BETWEEN v_from AND v_to;
    v_finished := v_today > v_to;
    v_missing := v_video AND NOT v_short AND v_finished AND NOT v_has_video;
    v_below := NOT v_short AND v_finished AND v_min IS NOT NULL AND v_min > 0 AND v_total < v_min;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'week', w, 'from', to_char(v_from, 'YYYY-MM-DD'), 'to', to_char(v_to, 'YYYY-MM-DD'), 'total', v_total, 'video', v_has_video,
      'below', v_below OR v_missing, 'missingVideo', v_missing, 'current', v_today BETWEEN v_from AND v_to, 'future', v_today < v_from,
      'stuck', v_stuck));
  END LOOP;
  RETURN v_out;
END;
$$;

-- F127.6: la fecha límite para empezar el Reto.
CREATE OR REPLACE FUNCTION app_servicio.svc_challenge_start_by(p_start_by jsonb, p_service_start date, p_service_created date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(p_start_by) = 'object' AND app_servicio.j_int(p_start_by -> 'days') AND (p_start_by ->> 'days')::integer >= 0
              THEN (CASE p_start_by ->> 'from' WHEN 'service_start' THEN p_service_start WHEN 'service_created' THEN p_service_created END)
                   + (p_start_by ->> 'days')::integer END;
$$;

-- ─── 3. Fechas de las repeticiones: `until = item_completed` (resuelto en p_phase_end) y `max_days` ────────
CREATE OR REPLACE FUNCTION app_servicio.svc_occurrence_dates(p_recurrence jsonb, p_start date, p_phase_end date, p_service_end date, p_upto date)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_step integer := CASE p_recurrence ->> 'every' WHEN 'day' THEN 1 WHEN 'week' THEN 7
                       ELSE GREATEST(1, COALESCE((p_recurrence ->> 'n')::integer, 1)) END;
  v_limit date := CASE p_recurrence ->> 'until'
                    WHEN 'phase_end' THEN p_phase_end WHEN 'item_completed' THEN p_phase_end WHEN 'service_end' THEN p_service_end
                    WHEN 'n_days' THEN p_start + (GREATEST(1, COALESCE((p_recurrence ->> 'n_until')::integer, 1)) - 1) END;
  v_max integer := CASE WHEN p_recurrence ->> 'until' = 'n_times' THEN GREATEST(1, COALESCE((p_recurrence ->> 'n_until')::integer, 1)) ELSE 1000 END;
  v_out jsonb := '[]'::jsonb;
  v_day date;
  k integer;
BEGIN
  IF p_start IS NULL THEN RETURN v_out; END IF;
  IF app_servicio.j_int(p_recurrence -> 'max_days') AND (p_recurrence ->> 'max_days')::integer >= 1 THEN
    v_limit := LEAST(v_limit, p_start + (p_recurrence ->> 'max_days')::integer - 1);
  END IF;
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

-- ─── 4. Generar repeticiones: anclas nuevas y «solo mientras su fase está abierta» ─────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_generate_occurrences(p_service_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  m app_servicio.service_items;
  ph app_servicio.service_phases;
  v_tz text; v_student_tz text; v_today date; v_start date; v_until date; v_phase_start date;
  v_occ jsonb; o jsonb; v_created integer := 0; v_new uuid;
  v_grace integer;
  v_phases jsonb; v_items jsonb; v_win jsonb;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR s.status <> 'active' OR NOT app_servicio.module_on(s.workspace_id) THEN RETURN 0; END IF;
  v_tz := app_servicio.ws_tz(s.workspace_id);
  -- Las repeticiones que hace el estudiante usan SU zona (con la del negocio de respaldo).
  SELECT COALESCE(NULLIF(c.timezone, ''), v_tz) INTO v_student_tz FROM public.contacts c WHERE c.id = s.contact_id;
  v_student_tz := COALESCE(v_student_tz, v_tz);
  v_today := (now() AT TIME ZONE v_student_tz)::date;
  -- F127.2: las anclas de otras fases y de pasos completados.
  SELECT COALESCE(jsonb_object_agg(p.template_key, jsonb_build_object(
           'start', to_char(app_servicio.local_date(p.started_at, s.workspace_id), 'YYYY-MM-DD'),
           'end', to_char(app_servicio.local_date(p.completed_at, s.workspace_id), 'YYYY-MM-DD'))), '{}'::jsonb)
    INTO v_phases FROM app_servicio.service_phases p WHERE p.service_id = s.id AND p.template_key IS NOT NULL;
  SELECT COALESCE(jsonb_object_agg(i.template_key, to_char(app_servicio.local_date(i.completed_at, s.workspace_id), 'YYYY-MM-DD')), '{}'::jsonb)
    INTO v_items FROM app_servicio.service_items i
   WHERE i.service_id = s.id AND i.parent_item_id IS NULL AND NOT i.is_recurring_template AND i.template_key IS NOT NULL;
  FOR m IN SELECT i.* FROM app_servicio.service_items i JOIN app_servicio.service_phases p ON p.id = i.phase_id
            WHERE i.service_id = p_service_id AND i.is_recurring_template AND p.status = 'in_progress' LOOP
    SELECT * INTO ph FROM app_servicio.service_phases WHERE id = m.phase_id;
    v_phase_start := app_servicio.local_date(ph.started_at, s.workspace_id);
    v_win := app_servicio.svc_recurrence_window(m.recurrence, jsonb_build_object(
      'serviceCreated', app_servicio.local_date(s.created_at, s.workspace_id), 'serviceStart', s.starts_on, 'serviceEnd', s.ends_on,
      'phaseStart', v_phase_start, 'phaseEnd', CASE WHEN ph.duration_days IS NOT NULL THEN v_phase_start + ph.duration_days - 1 END,
      'phases', v_phases, 'items', v_items));
    v_start := (v_win ->> 'start')::date;
    CONTINUE WHEN v_start IS NULL;
    v_until := (v_win ->> 'until')::date;
    v_occ := app_servicio.svc_occurrence_dates(m.recurrence, v_start, v_until, v_until, v_today);
    v_grace := COALESCE((m.late ->> 'grace_hours')::integer, 0);
    FOR o IN SELECT x FROM jsonb_array_elements(v_occ) x LOOP
      -- Un paso solo crea repeticiones mientras su fase está abierta, aunque el ancla caiga antes.
      CONTINUE WHEN v_phase_start IS NOT NULL AND (o ->> 'occursOn')::date < v_phase_start;
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

-- ─── 5. Completar: una repetición que carga el estudiante respeta «sin adelantar» y la gracia (SV035 / SV036) ──
CREATE OR REPLACE FUNCTION app_servicio.svc_mark_item(p_item_id uuid, p_source text, p_by_kind text, p_by uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  -- A3 (F127.3): solo lo que carga el estudiante, solo en una repetición con `late` configurado. El equipo completa igual.
  IF p_by_kind = 'client' AND it.parent_item_id IS NOT NULL AND jsonb_typeof(it.late) = 'object' AND it.due_on IS NOT NULL THEN
    SELECT i.recurrence INTO v_rec FROM app_servicio.service_items i WHERE i.id = it.parent_item_id;
    v_step := CASE v_rec ->> 'every' WHEN 'day' THEN 1 WHEN 'week' THEN 7 ELSE GREATEST(1, COALESCE((v_rec ->> 'n')::integer, 1)) END;
    SELECT NULLIF(c.timezone, '') INTO v_tz FROM public.contacts c WHERE c.id = s.contact_id;
    v_tz := COALESCE(v_tz, app_servicio.ws_tz(s.workspace_id));
    v_plan := app_servicio.svc_late_plan(it.late, it.due_on - v_step + 1, it.due_on, (now() AT TIME ZONE v_tz));
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

-- ─── 6. Semáforo: una repetición no obligatoria no cuenta (F127.4) ───────────────────────────────────
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
                     AND i.required AND i.status = 'pending' AND i.due_at < now()));
      END IF;
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', i.name,
               'daysOverdue', v_today - COALESCE(i.due_on, app_servicio.local_date(i.due_at, s.workspace_id)),
               'yellowAfter', i.yellow_after_days, 'redAfter', i.red_after_days)), '[]'::jsonb)
        INTO v_items
        FROM app_servicio.service_items i
       WHERE i.phase_id = ph.id AND i.status = 'pending' AND NOT i.is_recurring_template
         AND (i.parent_item_id IS NULL OR i.required)
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

-- ─── 7. Empezar el Reto: con reglas, el estudiante las acepta (F127.1) ──────────────────────────────
-- p_actor: 'team' (pide services.change_phase), 'automation' (como antes) o 'student' (solo el servidor; con reglas,
-- hace falta haberlas aceptado con svc_start_challenge_accepting).
CREATE OR REPLACE FUNCTION app_servicio.svc_start_challenge(p_service_id uuid, p_actor text DEFAULT 'team')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  ph app_servicio.service_phases;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  IF p_actor = 'team' THEN PERFORM app_servicio.require_service(s, 'services.change_phase'); END IF;
  IF p_actor = 'student' AND NOT app_servicio.is_system() THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE service_id = p_service_id AND awaiting_start ORDER BY position LIMIT 1;
  IF ph.id IS NULL OR s.status <> 'active' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM app_servicio.service_phases WHERE service_id = p_service_id AND status = 'in_progress') THEN RETURN false; END IF;
  IF p_actor = 'student' AND ph.challenge -> 'acceptance' -> 'enabled' = 'true'::jsonb AND NOT (ph.challenge ? 'accepted') THEN
    RAISE EXCEPTION 'Para empezar, aceptá las reglas del Reto' USING ERRCODE = 'SV037';
  END IF;
  PERFORM app_servicio.svc_open_phase(ph.id, true);
  RETURN true;
END;
$$;

-- El estudiante acepta las reglas y empieza (lo llama el portal en B2, con el cliente de servicio). Guarda la aceptación
-- en service_phases.challenge.accepted = {at, by_contact, items, text_hash} (sin columnas) y queda en el historial.
CREATE OR REPLACE FUNCTION app_servicio.svc_start_challenge_accepting(p_service_id uuid, p_accepted integer[], p_by_contact uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  ph app_servicio.service_phases;
  v_acc jsonb; n integer; v_prev text; v_ok boolean;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  IF p_by_contact IS DISTINCT FROM s.contact_id THEN RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004'; END IF;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE service_id = p_service_id AND awaiting_start ORDER BY position LIMIT 1 FOR UPDATE;
  IF ph.id IS NULL OR s.status <> 'active' THEN RETURN false; END IF;
  v_acc := ph.challenge -> 'acceptance';
  IF v_acc -> 'enabled' = 'true'::jsonb AND jsonb_typeof(v_acc -> 'items') = 'array' THEN
    n := jsonb_array_length(v_acc -> 'items');
    IF p_accepted IS NULL OR (SELECT count(DISTINCT x) FROM unnest(p_accepted) x WHERE x BETWEEN 0 AND n - 1) <> n THEN
      RAISE EXCEPTION 'Para empezar, aceptá todas las reglas del Reto' USING ERRCODE = 'SV037';
    END IF;
    UPDATE app_servicio.service_phases
       SET challenge = challenge || jsonb_build_object('accepted', jsonb_build_object('at', now(), 'by_contact', p_by_contact,
                         'items', v_acc -> 'items', 'text_hash', md5((v_acc -> 'items')::text)))
     WHERE id = ph.id;
    PERFORM app_servicio.audit(s.workspace_id, 'service_phase', ph.id, 'svc.challenge_accepted',
      jsonb_build_object('service_id', s.id, 'phase_key', ph.template_key, 'items', n, 'text_hash', md5((v_acc -> 'items')::text)), 'client');
  END IF;
  v_prev := COALESCE(current_setting('app_servicio.system', true), '');
  PERFORM app_servicio.as_system();
  v_ok := app_servicio.svc_start_challenge(p_service_id, 'student');
  PERFORM set_config('app_servicio.system', v_prev, true);
  RETURN v_ok;
END;
$$;

-- ─── 8. El cron diario: Retos con fecha fija y aviso al pasarse la fecha límite (F127.6) ───────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_open_due_challenges(p_service_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ph app_servicio.service_phases;
  s app_servicio.services;
  n integer := 0;
  v_by date;
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
  -- F127.6: no bloquea empezar; avisa UNA vez al responsable y queda en el historial.
  BEGIN
    FOR ph IN SELECT * FROM app_servicio.service_phases WHERE service_id = p_service_id AND awaiting_start AND status = 'pending'
               AND jsonb_typeof(challenge -> 'start_by') = 'object' LOOP
      v_by := app_servicio.svc_challenge_start_by(ph.challenge -> 'start_by', s.starts_on, app_servicio.local_date(s.created_at, s.workspace_id));
      IF v_by IS NOT NULL AND v_by < app_servicio.today_in(s.workspace_id)
         AND NOT EXISTS (SELECT 1 FROM public.audit_log a WHERE a.entity_type = 'service_phase' AND a.entity_id = ph.id AND a.action = 'svc.challenge_start_overdue') THEN
        PERFORM app_servicio.notify(s.workspace_id, s.owner_user_id, 'svc_challenge_start_overdue', 'Un cliente no empezó el Reto',
          format('Tenía hasta el %s para empezar «%s».', to_char(v_by, 'DD/MM/YYYY'), ph.name), 'service', s.id, jsonb_build_object('service_id', s.id));
        PERFORM app_servicio.audit(s.workspace_id, 'service_phase', ph.id, 'svc.challenge_start_overdue',
          jsonb_build_object('service_id', s.id, 'start_by', v_by), 'system');
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(s.workspace_id, 'challenge_start_by', SQLSTATE || ' ' || SQLERRM, s.id);
  END;
  RETURN n;
END;
$$;

-- ─── 9. Lectura para la ficha: el bloque Reto (F127.1, F127.5, F127.6) ───────────────────────────────
-- Las respuestas de cada repetición de la fase Reto: el campo número, el link y el «trabado» (los que marca
-- challenge.weekly). Sin tablas: sale de form_submissions. Mira el alcance de quien la pide (como las de la 00361).
CREATE OR REPLACE FUNCTION app_servicio.svc_challenge_view(p_service_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
           'on', to_char(i.due_on - CASE m.recurrence ->> 'every' WHEN 'day' THEN 1 WHEN 'week' THEN 7 ELSE GREATEST(1, COALESCE((m.recurrence ->> 'n')::integer, 1)) END + 1, 'YYYY-MM-DD'),
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
$$;

-- ─── 10. Permisos ───────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio.journey_challenge_problems(jsonb, text), app_servicio.journey_recurrence_problems(jsonb, text),
  app_servicio.journey_item_cross_problems(jsonb, text, text, text[], text[]),
  app_servicio.svc_recurrence_window(jsonb, jsonb), app_servicio.svc_late_plan(jsonb, date, date, timestamp),
  app_servicio.svc_challenge_weeks_plan(jsonb), app_servicio.svc_challenge_start_by(jsonb, date, date),
  app_servicio.svc_occurrence_dates(jsonb, date, date, date, date), app_servicio.svc_generate_occurrences(uuid),
  app_servicio.svc_mark_item(uuid, text, text, uuid), app_servicio.svc_compute_light(uuid),
  app_servicio.svc_start_challenge(uuid, text), app_servicio.svc_start_challenge_accepting(uuid, integer[], uuid),
  app_servicio.svc_open_due_challenges(uuid), app_servicio.svc_challenge_view(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio.journey_challenge_problems(jsonb, text), app_servicio.journey_recurrence_problems(jsonb, text),
  app_servicio.journey_item_cross_problems(jsonb, text, text, text[], text[]),
  app_servicio.svc_recurrence_window(jsonb, jsonb), app_servicio.svc_late_plan(jsonb, date, date, timestamp),
  app_servicio.svc_challenge_weeks_plan(jsonb), app_servicio.svc_challenge_start_by(jsonb, date, date),
  app_servicio.svc_occurrence_dates(jsonb, date, date, date, date), app_servicio.svc_generate_occurrences(uuid),
  app_servicio.svc_mark_item(uuid, text, text, uuid), app_servicio.svc_compute_light(uuid),
  app_servicio.svc_start_challenge(uuid, text), app_servicio.svc_start_challenge_accepting(uuid, integer[], uuid),
  app_servicio.svc_open_due_challenges(uuid), app_servicio.svc_challenge_view(uuid)
TO service_role;
-- Como antes de la 00376: la sesión usa svc_occurrence_dates y svc_start_challenge (con su permiso adentro). Suma la
-- lectura del Reto (mira el alcance adentro, como service_classroom) y las reglas puras.
GRANT EXECUTE ON FUNCTION
  app_servicio.svc_occurrence_dates(jsonb, date, date, date, date), app_servicio.svc_start_challenge(uuid, text),
  app_servicio.svc_challenge_view(uuid),
  app_servicio.svc_recurrence_window(jsonb, jsonb), app_servicio.svc_late_plan(jsonb, date, date, timestamp),
  app_servicio.svc_challenge_weeks_plan(jsonb), app_servicio.svc_challenge_start_by(jsonb, date, date)
TO authenticated;
