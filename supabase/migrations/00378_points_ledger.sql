-- ============================================================
-- 00378_points_ledger.sql
-- ============================================================
-- Servicios A3, F129 (decisión 468; F245 a F249 del portal): los puntos, los datos y las reglas.
--
--   * Tabla nueva APROBADA `app_servicio_portal.points_ledger`: una fila por movimiento, con índice único
--     (contact_id, product_id, source_key) para que nada sume dos veces. `point_group` (cont, act, camino, clases, com,
--     proy, ref, equipo), `points` con signo, `local_day` (el día en la zona del estudiante: topes y gráfico). La escribe
--     solo `award_points` / `revoke_points` / el ajuste a mano (00379). Esquema cerrado: solo service_role.
--   * Columna `app_servicio.program_items.points jsonb NULL` ({submit, pass}): el valor propio de una actividad o evaluación.
--   * `products.portal_settings.points = {enabled, values, caps, levels, ranking}`: SIN la clave (o con enabled distinto
--     de true) los puntos están APAGADOS en el programa (condición de producto, 14/11).
--   * En el camino: `points` de la fase y `ref.points` del paso (validate_journey_template).
--   * Gemelas puras (lib/portal-points/rules.ts, points.cases.json): points_for, points_daily_cap, level_of,
--     points_settings_problems.
--   * `merge_contacts_hook` une los puntos de los dos contactos (sin duplicar).
--
-- Como volver atras: validate_journey_template (00376), validate_program_portal_settings (00377) y merge_contacts_hook
-- (00353) viejas en docs/servicios/definiciones-viejas-a3.sql (§00378). Lo demás:
--   DROP TABLE IF EXISTS app_servicio_portal.points_ledger; ALTER TABLE app_servicio.program_items DROP COLUMN IF EXISTS points;
--   DROP FUNCTION IF EXISTS app_servicio.points_for(text, jsonb, integer), app_servicio.points_daily_cap(text, jsonb),
--     app_servicio.level_of(integer, jsonb), app_servicio.points_settings_problems(jsonb);

-- ─── 1. La tabla ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio_portal.points_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  service_id    uuid NULL REFERENCES app_servicio.services(id) ON DELETE SET NULL,
  source_key    text NOT NULL,
  point_group   text NOT NULL,
  points        integer NOT NULL,
  reason        text NULL,
  local_day     date NOT NULL,
  created_by    uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT points_ledger_unique UNIQUE (contact_id, product_id, source_key),
  CONSTRAINT points_ledger_source_check CHECK (source_key ~ '^[a-z_]+:' AND char_length(source_key) <= 200),
  CONSTRAINT points_ledger_group_check CHECK (point_group IN ('cont', 'act', 'camino', 'clases', 'com', 'proy', 'ref', 'equipo')),
  CONSTRAINT points_ledger_points_check CHECK (points BETWEEN -100000 AND 100000),
  CONSTRAINT points_ledger_reason_check CHECK (reason IS NULL OR char_length(reason) <= 300)
);
CREATE INDEX IF NOT EXISTS points_ledger_product_day ON app_servicio_portal.points_ledger (product_id, local_day);
CREATE INDEX IF NOT EXISTS points_ledger_contact_product ON app_servicio_portal.points_ledger (contact_id, product_id, created_at DESC);
ALTER TABLE app_servicio_portal.points_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_servicio_portal.points_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_servicio_portal.points_ledger TO service_role;

-- ─── 2. El valor propio de una actividad o evaluación ───────────────────────
ALTER TABLE app_servicio.program_items ADD COLUMN IF NOT EXISTS points jsonb NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'program_items_points_check') THEN
    ALTER TABLE app_servicio.program_items ADD CONSTRAINT program_items_points_check CHECK (
      points IS NULL OR (jsonb_typeof(points) = 'object'
        AND (points - 'submit' - 'pass') = '{}'::jsonb
        AND (NOT points ? 'submit' OR jsonb_typeof(points -> 'submit') = 'null' OR (jsonb_typeof(points -> 'submit') = 'number' AND (points ->> 'submit') ~ '^\d+$' AND (points ->> 'submit')::numeric <= 10000))
        AND (NOT points ? 'pass' OR jsonb_typeof(points -> 'pass') = 'null' OR (jsonb_typeof(points -> 'pass') = 'number' AND (points ->> 'pass') ~ '^\d+$' AND (points ->> 'pass')::numeric <= 10000))));
  END IF;
END $$;

-- ─── 3. Reglas puras (gemelas de lib/portal-points/rules.ts) ────────────────
CREATE OR REPLACE FUNCTION app_servicio.points_event_default(p_event text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_event
    WHEN 'lesson' THEN '{"group":"cont","points":1}' WHEN 'module' THEN '{"group":"cont","points":1}' WHEN 'all_content' THEN '{"group":"cont","points":10}'
    WHEN 'step' THEN '{"group":"camino","points":10}' WHEN 'phase' THEN '{"group":"camino","points":20}' WHEN 'journey' THEN '{"group":"camino","points":100}'
    WHEN 'submit' THEN '{"group":"act","points":5}' WHEN 'pass' THEN '{"group":"act","points":10}' WHEN 'quiz_pass' THEN '{"group":"act","points":5}'
    WHEN 'attendance' THEN '{"group":"clases","points":5}'
    WHEN 'post' THEN '{"group":"com","points":2}' WHEN 'comment' THEN '{"group":"com","points":1}' WHEN 'like' THEN '{"group":"com","points":1}'
    WHEN 'ref_lead' THEN '{"group":"ref","points":10}' WHEN 'ref_booking' THEN '{"group":"ref","points":25}' WHEN 'ref_sale' THEN '{"group":"ref","points":100}'
  END::jsonb;
$$;

CREATE OR REPLACE FUNCTION app_servicio.points_for(p_event text, p_settings jsonb, p_override integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  e jsonb := app_servicio.points_event_default(p_event);
  v jsonb;
BEGIN
  IF e IS NULL THEN RETURN jsonb_build_object('points', 0, 'group', NULL); END IF;
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' OR p_settings -> 'enabled' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN jsonb_build_object('points', 0, 'group', e ->> 'group');
  END IF;
  IF p_override IS NOT NULL AND p_override BETWEEN 0 AND 10000 THEN RETURN jsonb_build_object('points', p_override, 'group', e ->> 'group'); END IF;
  v := p_settings -> 'values' -> p_event;
  IF app_servicio.j_int(v) AND app_servicio.j_num(v) BETWEEN 0 AND 10000 THEN
    RETURN jsonb_build_object('points', (v #>> '{}')::integer, 'group', e ->> 'group');
  END IF;
  RETURN jsonb_build_object('points', (e ->> 'points')::integer, 'group', e ->> 'group');
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.points_daily_cap(p_event text, p_settings jsonb)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_event NOT IN ('post', 'comment') THEN NULL
              WHEN jsonb_typeof(p_settings -> 'caps') = 'object' AND (p_settings -> 'caps') ? p_event THEN
                CASE WHEN jsonb_typeof(p_settings -> 'caps' -> p_event) = 'null' THEN NULL
                     WHEN app_servicio.j_int(p_settings -> 'caps' -> p_event) AND app_servicio.j_num(p_settings -> 'caps' -> p_event) >= 0
                       THEN (p_settings -> 'caps' ->> p_event)::integer
                     ELSE CASE p_event WHEN 'post' THEN 1 ELSE 10 END END
              ELSE CASE p_event WHEN 'post' THEN 1 ELSE 10 END END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.level_of(p_total integer, p_levels jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  ls jsonb := CASE WHEN jsonb_typeof(p_levels) = 'array' AND jsonb_array_length(p_levels) = 9 THEN p_levels ELSE
    '[{"name":"Explorador","min":0},{"name":"Aprendiz","min":10},{"name":"Constructor","min":30},{"name":"Builder","min":60},{"name":"Builder Pro","min":100},{"name":"Arquitecto","min":160},{"name":"Experto","min":250},{"name":"Maestro","min":400},{"name":"Leyenda","min":600}]'::jsonb END;
  i integer := 0;
  k integer;
BEGIN
  FOR k IN 0 .. 8 LOOP
    IF COALESCE(p_total, 0) >= (ls -> k ->> 'min')::numeric THEN i := k; END IF;
  END LOOP;
  RETURN jsonb_build_object('level', i + 1, 'name', ls -> i ->> 'name', 'min', (ls -> i ->> 'min')::integer,
                            'next', CASE WHEN i < 8 THEN (ls -> (i + 1) ->> 'min')::integer END);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.points_settings_problems(p jsonb)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  out text[] := ARRAY[]::text[];
  k text; x jsonb; i integer;
  v_ok boolean;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN RETURN out; END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['los puntos no son válidos']; END IF;
  FOR k IN SELECT key FROM jsonb_object_keys(p) WITH ORDINALITY AS t(key, ord) ORDER BY ord LOOP
    IF NOT (k = ANY (ARRAY['enabled','values','caps','levels','ranking'])) THEN out := out || ('clave desconocida: ' || k); END IF;
  END LOOP;
  IF p ? 'enabled' AND jsonb_typeof(p -> 'enabled') <> 'boolean' THEN out := out || 'prender los puntos tiene que ser sí o no'::text; END IF;
  IF p ? 'values' AND (jsonb_typeof(p -> 'values') <> 'object' OR EXISTS (
       SELECT 1 FROM jsonb_each(p -> 'values') e
        WHERE app_servicio.points_event_default(e.key) IS NULL OR NOT (app_servicio.j_int(e.value) AND app_servicio.j_num(e.value) BETWEEN 0 AND 10000))) THEN
    out := out || 'cada valor de puntos va de 0 a 10.000'::text;
  END IF;
  IF p ? 'caps' AND (jsonb_typeof(p -> 'caps') <> 'object' OR EXISTS (
       SELECT 1 FROM jsonb_each(p -> 'caps') e
        WHERE e.key NOT IN ('post', 'comment') OR NOT (jsonb_typeof(e.value) = 'null' OR (app_servicio.j_int(e.value) AND app_servicio.j_num(e.value) BETWEEN 0 AND 100)))) THEN
    out := out || 'los topes por día van de 0 a 100, o sin tope'::text;
  END IF;
  IF p ? 'levels' THEN
    v_ok := jsonb_typeof(p -> 'levels') = 'array' AND jsonb_array_length(p -> 'levels') = 9;
    IF v_ok THEN
      FOR i IN 0 .. 8 LOOP
        x := p -> 'levels' -> i;
        IF NOT (jsonb_typeof(x) = 'object' AND jsonb_typeof(x -> 'name') = 'string' AND btrim(x ->> 'name') <> '' AND char_length(x ->> 'name') <= 40
                AND app_servicio.j_int(x -> 'min')
                AND (CASE WHEN i = 0 THEN (x ->> 'min')::numeric = 0 ELSE (x ->> 'min')::numeric > (p -> 'levels' -> (i - 1) ->> 'min')::numeric END)) THEN
          v_ok := false;
        END IF;
      END LOOP;
    END IF;
    IF NOT v_ok THEN out := out || 'los 9 niveles necesitan nombre y un mínimo que crezca, empezando en 0'::text; END IF;
  END IF;
  IF p ? 'ranking' AND (jsonb_typeof(p -> 'ranking') <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p -> 'ranking') k2 WHERE k2 <> 'visible')
       OR ((p -> 'ranking') ? 'visible' AND jsonb_typeof(p -> 'ranking' -> 'visible') <> 'boolean')) THEN
    out := out || 'el ranking no es válido'::text;
  END IF;
  RETURN out;
END;
$$;

-- ─── 4. Validaciones que suman los puntos ────────────────────────────────────
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
    v := v || app_servicio.unknown_keys(ph, ARRAY['key','name','duration_days','yellow_day','red_day','advance','challenge','late_light','points','items']);
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
    -- F129: «Puntos al completarlo» de la fase.
    IF ph ? 'points' AND jsonb_typeof(ph -> 'points') <> 'null' AND NOT (app_servicio.j_int(ph -> 'points') AND app_servicio.j_num(ph -> 'points') BETWEEN 0 AND 10000) THEN
      v := v || format('«%s»: los puntos tienen que ser un número entero de 0 a 10.000', v_label);
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
      -- F129: «Puntos al completarlo» del paso (en un paso que se repite, vale por cada repetición).
      IF jsonb_typeof(it -> 'ref') = 'object' AND (it -> 'ref') ? 'points' AND jsonb_typeof(it -> 'ref' -> 'points') <> 'null'
         AND NOT (app_servicio.j_int(it -> 'ref' -> 'points') AND app_servicio.j_num(it -> 'ref' -> 'points') BETWEEN 0 AND 10000) THEN
        v := v || format('«%s»: los puntos tienen que ser un número entero de 0 a 10.000', v_nm);
      END IF;
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
  v := v || app_servicio.unknown_keys(p, ARRAY['v','sections','terms','community','affiliates','assistant','notifications','points']);
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
  -- A3 (F128): los avisos del programa. Sin la clave, el resumen semanal está APAGADO (condición de producto, 14/11).
  IF p ? 'notifications' THEN
    a := p -> 'notifications';
    IF jsonb_typeof(a) <> 'object' THEN v := v || 'los avisos no son válidos'::text;
    ELSE
      v := v || app_servicio.unknown_keys(a, ARRAY['weekly_digest','due_today_email']);
      IF (a ? 'weekly_digest' AND jsonb_typeof(a -> 'weekly_digest') <> 'boolean') OR (a ? 'due_today_email' AND jsonb_typeof(a -> 'due_today_email') <> 'boolean') THEN
        v := v || 'los avisos tienen que ser sí o no'::text;
      END IF;
    END IF;
  END IF;
  -- A3 (F129): los puntos. Sin la clave, APAGADOS (condición de producto, 14/11).
  IF p ? 'points' THEN v := v || app_servicio.points_settings_problems(p -> 'points'); END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.merge_contacts_hook(p_main uuid, p_duplicate uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_out jsonb := '{}'::jsonb;
  n integer;
  acc_main uuid;
  acc_dup uuid;
  dupe record;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.contacts WHERE id = p_main;
  -- Servicios: los dos quedan (si son del mismo producto y estan activos, se avisa).
  UPDATE app_servicio.services SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('services', n);
  FOR dupe IN SELECT product_id, count(*) c FROM app_servicio.services WHERE contact_id = p_main AND status IN ('active', 'paused') GROUP BY product_id HAVING count(*) > 1 LOOP
    PERFORM app_servicio.notify_admins(v_ws, 'svc_merge_two_services', 'Dos servicios del mismo producto',
      'Al unir dos contactos quedaron dos servicios activos del mismo producto. Revisá si hay que cancelar uno.', 'contact', p_main,
      jsonb_build_object('product_id', dupe.product_id));
  END LOOP;
  -- La cuenta del portal: si los dos tienen, queda la del principal; la otra se suspende y sus sesiones se revocan.
  SELECT id INTO acc_main FROM app_servicio_portal.portal_accounts WHERE contact_id = p_main;
  SELECT id INTO acc_dup FROM app_servicio_portal.portal_accounts WHERE contact_id = p_duplicate;
  IF acc_dup IS NOT NULL THEN
    IF acc_main IS NULL THEN
      UPDATE app_servicio_portal.portal_accounts SET contact_id = p_main, updated_at = now() WHERE id = acc_dup;
      v_out := v_out || jsonb_build_object('portal_accounts', 1);
    ELSE
      UPDATE app_servicio_portal.portal_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE account_id = acc_dup;
      UPDATE app_servicio_portal.portal_accounts SET status = 'suspended', suspended_at = COALESCE(suspended_at, now()),
             suspended_reason = 'Se unió con otro contacto', updated_at = now() WHERE id = acc_dup;
      v_out := v_out || jsonb_build_object('portal_accounts_suspended', 1);
    END IF;
  END IF;
  UPDATE app_servicio_portal.portal_sessions SET preview_contact_id = p_main WHERE preview_contact_id = p_duplicate;
  UPDATE app_servicio_portal.portal_access SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('portal_access', n);
  -- Avance: si los dos vieron la misma clase, queda la fecha mas vieja.
  UPDATE app_servicio_portal.program_progress m
     SET viewed_at = LEAST(m.viewed_at, d.viewed_at), completed_at = LEAST(m.completed_at, d.completed_at),
         unlocked_at = LEAST(m.unlocked_at, d.unlocked_at), last_position_seconds = GREATEST(m.last_position_seconds, d.last_position_seconds), updated_at = now()
    FROM app_servicio_portal.program_progress d
   WHERE m.contact_id = p_main AND d.contact_id = p_duplicate AND d.program_item_id = m.program_item_id;
  DELETE FROM app_servicio_portal.program_progress d
   WHERE d.contact_id = p_duplicate AND EXISTS (SELECT 1 FROM app_servicio_portal.program_progress m WHERE m.contact_id = p_main AND m.program_item_id = d.program_item_id);
  UPDATE app_servicio_portal.program_progress SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('program_progress', n);
  -- Asistencia: una por sesion y fecha.
  DELETE FROM app_servicio_portal.live_attendance d
   WHERE d.contact_id = p_duplicate AND d.removed_at IS NULL
     AND EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance m WHERE m.contact_id = p_main AND m.live_session_id = d.live_session_id
                   AND m.occurs_on = d.occurs_on AND m.removed_at IS NULL);
  UPDATE app_servicio_portal.live_attendance SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('live_attendance', n);
  UPDATE app_servicio.link_clicks SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('link_clicks', n);
  -- Comunidad: los posts pasan al principal; una reaccion repetida queda una.
  UPDATE app_servicio_portal.community_posts SET author_contact_id = p_main WHERE author_contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('community_posts', n);
  DELETE FROM app_servicio_portal.community_reactions d
   WHERE d.contact_id = p_duplicate
     AND EXISTS (SELECT 1 FROM app_servicio_portal.community_reactions m WHERE m.contact_id = p_main AND m.post_id = d.post_id AND m.kind = d.kind);
  UPDATE app_servicio_portal.community_reactions SET contact_id = p_main WHERE contact_id = p_duplicate;
  -- Las conversaciones con el tutor.
  UPDATE public.ai_threads SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate AND channel = 'portal';
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('ai_threads_portal', n);
  -- A3 (00378): los puntos. Si los dos sumaron por lo mismo en el mismo programa, queda la del principal.
  DELETE FROM app_servicio_portal.points_ledger d
   WHERE d.contact_id = p_duplicate
     AND EXISTS (SELECT 1 FROM app_servicio_portal.points_ledger m WHERE m.contact_id = p_main AND m.product_id = d.product_id AND m.source_key = d.source_key);
  UPDATE app_servicio_portal.points_ledger SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('points_ledger', n);
  -- La extension de proyectos (Corrida C), si existe.
  IF to_regprocedure('app_servicio_proyectos.merge_contacts_hook(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT app_servicio_proyectos.merge_contacts_hook($1, $2)' INTO dupe USING p_main, p_duplicate;
  END IF;
  RETURN v_out;
END;
$$;

-- ─── 5. Permisos ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION app_servicio.points_event_default(text), app_servicio.points_for(text, jsonb, integer),
  app_servicio.points_daily_cap(text, jsonb), app_servicio.level_of(integer, jsonb), app_servicio.points_settings_problems(jsonb)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.points_event_default(text), app_servicio.points_for(text, jsonb, integer),
  app_servicio.points_daily_cap(text, jsonb), app_servicio.level_of(integer, jsonb), app_servicio.points_settings_problems(jsonb)
TO authenticated, service_role;
