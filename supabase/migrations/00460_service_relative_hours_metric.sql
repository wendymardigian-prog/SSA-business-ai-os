-- @plantilla-quitar(servicios)
-- ============================================================
-- 00460_service_relative_hours_metric.sql
-- ============================================================
-- Disparadores traídos de RER-BAIOS (commits 1cd4377b y 3bff5852, 00420 y 00453 de allá), adaptados a SSA. ADITIVA.
--
--   1. `triggers.type` suma `service_metric_reached` («Una cifra del estudiante llega a…»). Parte de lo que la base
--      aceptaba el 18/11/2026 (pg_get_constraintdef, 71 tipos) y aborta si al aplicar acepta alguno que la lista no
--      trae (regla del 8/11: la 00321 pisó un valor por partir de un archivo viejo).
--   2. `app_servicio.trigger_anchor_fires`: un solo envío por AUTOMATIZACIÓN (flow_id), servicio y ocurrencia. Va por
--      `flow_id` y no por la fila de `triggers` porque republicar borra y vuelve a crear esas filas.
--   3. «Días u horas antes o después de…» EN HORAS (`service_relative` con `config.unit = 'hours'` y `offset_hours`
--      de −720 a 720). Lo emite `app_servicio.svc_relative_hours_tick`, desde el cron horario `svc-daily` que ya existe
--      (`private.enqueue_svc_daily`, SQL directo, sin llamar a la app: no suma cron ni guarda). Sale si su hora llegó
--      hace menos de 2 h: lo que nace vencido no se manda. El de DÍAS no cambia (sigue en `svc_daily_run`, 00372): el de
--      horas no guarda `offset_days`, así que `svc_relative_due` lo descarta solo.
--      Anclas: creación (created_at), inicio (00:00 del día de inicio en la zona del negocio), fin (24:00 del último
--      día), inicio de la fase elegida (started_at) y completar el paso elegido (completed_at). «Antes» solo con el
--      inicio y el fin. Servicios activos; con el fin y «después», también completados o renovados.
--      Gemela: `relativeHoursDue` (lib/services/relative-triggers.ts) con `relative-hours.cases.json`.
--   4. «Una cifra del estudiante llega a…» (`service_metric_reached`), parte de PUNTOS: un trigger de SENTENCIA en
--      `app_servicio_portal.points_ledger` (al insertar) suma los puntos del estudiante en el programa y, si el total
--      CRUZA el número de una automatización activa (antes por debajo, ahora igual o arriba), emite una vez por
--      automatización, servicio y número. Facturación y proyectos van en la 00461 (extensión de proyectos).
--      `svc_metric_fire` es la parte común; gemela de la regla: `metricCrossed` (lib/services/metric-trigger.ts).
--
-- Definición vieja de `private.enqueue_svc_daily` (la de la 00353, igual en la base el 18/11/2026): la de abajo sin el
-- bloque «En horas». Volver atrás:
--   DROP TRIGGER IF EXISTS points_ledger_metric_reached ON app_servicio_portal.points_ledger;
--   DROP FUNCTION IF EXISTS app_servicio.svc_metric_on_points(), app_servicio.svc_metric_fire(uuid, uuid, uuid, text, numeric, numeric),
--     app_servicio.svc_metric_crossed(numeric, numeric, numeric), app_servicio.svc_relative_hours_tick(uuid, timestamptz),
--     app_servicio.svc_relative_hours_due(timestamptz, integer, timestamptz);
--   enqueue_svc_daily con la definición de la 00353; DROP TABLE app_servicio.trigger_anchor_fires;
--   el CHECK sin `service_metric_reached` (borrando antes las filas de ese tipo, si hay).
-- Idempotente: CHECK solo si falta el tipo, IF NOT EXISTS, CREATE OR REPLACE y DROP TRIGGER IF EXISTS.
-- ============================================================

-- ─── 1. triggers.type + service_metric_reached ──────────────────────────────────────────────────────────────────────
-- La lista de abajo es la que la base aceptaba el 18/11/2026 (71 tipos: los de la 00372 + points_level_up +
-- service_upgrade_interest), leída con pg_get_constraintdef, + service_metric_reached. Guarda: si al aplicar la base
-- acepta algún tipo que esta lista no trae (otra migración sumó uno en el medio), se aborta sin tocar nada: hay que
-- sumarlo acá antes de aplicar. Si ya está el tipo nuevo, no hace nada.
DO $$
DECLARE
  v_def text;
  v_live text[];
  v_new text[] := ARRAY['keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword', 'new_contact', 'crm_event', 'inactivity', 'email_received', 'booking_created', 'booking_rescheduled', 'booking_cancelled', 'booking_updated', 'booking_ended', 'booking_status_changed', 'booking_before_start', 'booking_after_end', 'booking_after_created', 'call_analyzed', 'call_linked', 'form_submitted', 'survey_answered', 'contract_signed', 'sale_created', 'sale_status_changed', 'payment_created', 'payment_status_changed', 'payment_before_due', 'payment_after_due', 'eod_submitted', 'webhook_received', 'task_completed', 'task_overdue', 'whatsapp_group_joined', 'whatsapp_group_reaction', 'whatsapp_group_poll_vote', 'scheduled_time', 'affiliate_assignment_expired', 'affiliate_lead_created', 'affiliate_sale_created', 'certificate_issued', 'challenge_completed', 'challenge_occurrence_due_soon', 'challenge_occurrence_overdue', 'challenge_started', 'live_session_missed', 'portal_access_expired', 'portal_access_expiring', 'program_lesson_completed', 'program_module_completed', 'quiz_failed', 'quiz_passed', 'service_created', 'service_ending_soon', 'service_extended', 'service_item_completed', 'service_item_overdue', 'service_light_changed', 'service_paused', 'service_phase_completed', 'service_phase_started', 'service_resumed', 'service_started', 'service_status_changed', 'task_submission_received', 'task_submission_reviewed', 'service_relative', 'service_phase_periodic', 'points_level_up', 'service_upgrade_interest', 'service_metric_reached'];
  x text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.triggers'::regclass AND c.conname = 'triggers_type_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'No encuentro triggers_type_check'; END IF;
  SELECT array_agg(m[1]) INTO v_live FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS t(m);
  FOREACH x IN ARRAY COALESCE(v_live, ARRAY[]::text[]) LOOP
    IF NOT (x = ANY (v_new)) THEN
      RAISE EXCEPTION 'triggers_type_check acepta % y la lista nueva no: sumarlo antes de aplicar', x;
    END IF;
  END LOOP;
  IF 'service_metric_reached' = ANY (v_live) THEN RETURN; END IF;
  ALTER TABLE public.triggers DROP CONSTRAINT triggers_type_check;
  ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text, 'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text, 'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text, 'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text, 'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text, 'task_completed'::text, 'task_overdue'::text, 'whatsapp_group_joined'::text, 'whatsapp_group_reaction'::text, 'whatsapp_group_poll_vote'::text, 'scheduled_time'::text, 'affiliate_assignment_expired'::text, 'affiliate_lead_created'::text, 'affiliate_sale_created'::text, 'certificate_issued'::text, 'challenge_completed'::text, 'challenge_occurrence_due_soon'::text, 'challenge_occurrence_overdue'::text, 'challenge_started'::text, 'live_session_missed'::text, 'portal_access_expired'::text, 'portal_access_expiring'::text, 'program_lesson_completed'::text, 'program_module_completed'::text, 'quiz_failed'::text, 'quiz_passed'::text, 'service_created'::text, 'service_ending_soon'::text, 'service_extended'::text, 'service_item_completed'::text, 'service_item_overdue'::text, 'service_light_changed'::text, 'service_paused'::text, 'service_phase_completed'::text, 'service_phase_started'::text, 'service_resumed'::text, 'service_started'::text, 'service_status_changed'::text, 'task_submission_received'::text, 'task_submission_reviewed'::text, 'service_relative'::text, 'service_phase_periodic'::text, 'points_level_up'::text, 'service_upgrade_interest'::text, 'service_metric_reached'::text]));
END $$;

-- ─── 2. Un envío por automatización, servicio y ocurrencia ──────────────────────────────────────────────────────────
-- Solo la escribe el servidor (funciones SECURITY DEFINER): RLS prendida y sin políticas.
CREATE TABLE IF NOT EXISTS app_servicio.trigger_anchor_fires (
  flow_id      uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  service_id   uuid NOT NULL REFERENCES app_servicio.services(id) ON DELETE CASCADE,
  occurrence   text NOT NULL CHECK (char_length(occurrence) BETWEEN 1 AND 300),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  trigger_type text NOT NULL CHECK (trigger_type IN ('service_relative', 'service_metric_reached')),
  fired_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flow_id, service_id, occurrence)
);
CREATE INDEX IF NOT EXISTS trigger_anchor_fires_service_idx ON app_servicio.trigger_anchor_fires (service_id);
CREATE INDEX IF NOT EXISTS trigger_anchor_fires_workspace_idx ON app_servicio.trigger_anchor_fires (workspace_id, fired_at DESC);
ALTER TABLE app_servicio.trigger_anchor_fires ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_servicio.trigger_anchor_fires FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_servicio.trigger_anchor_fires TO service_role;

-- ─── 3. Relativo en horas ───────────────────────────────────────────────────────────────────────────────────────────
-- La regla (pura): ya llegó la hora y no pasaron más de 2 h. Gemela de relativeHoursDue.
CREATE OR REPLACE FUNCTION app_servicio.svc_relative_hours_due(p_anchor_at timestamptz, p_offset_hours integer, p_now timestamptz)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    abs(p_offset_hours) <= 720
    AND p_anchor_at + make_interval(hours => p_offset_hours) <= p_now
    AND p_anchor_at + make_interval(hours => p_offset_hours) > p_now - interval '2 hours',
    false);
$$;

-- El barrido de un negocio. Devuelve cuántos emitió. Cada disparador en su bloque: uno roto no frena a los demás.
CREATE OR REPLACE FUNCTION app_servicio.svc_relative_hours_tick(p_workspace_id uuid, p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tz text;
  t record;
  s app_servicio.services;
  v_anchor text;
  v_raw numeric;
  v_off integer;
  v_at timestamptz;
  v_occ text;
  v_n integer := 0;
BEGIN
  IF NOT app_servicio.module_on(p_workspace_id) THEN RETURN 0; END IF;
  v_tz := COALESCE(app_servicio.ws_tz(p_workspace_id), 'UTC');
  FOR t IN SELECT tr.id, tr.flow_id, COALESCE(tr.config, '{}'::jsonb) AS c FROM public.triggers tr
            WHERE tr.workspace_id = p_workspace_id AND tr.is_active AND tr.flow_id IS NOT NULL
              AND tr.type = 'service_relative' AND tr.config ->> 'unit' = 'hours' LOOP
    BEGIN
      v_anchor := t.c ->> 'anchor';
      CONTINUE WHEN v_anchor IS NULL OR v_anchor NOT IN ('service_created', 'service_start', 'service_end', 'phase_start', 'item_completed');
      CONTINUE WHEN jsonb_typeof(t.c -> 'offset_hours') IS DISTINCT FROM 'number';
      v_raw := (t.c ->> 'offset_hours')::numeric;
      CONTINUE WHEN v_raw <> trunc(v_raw) OR abs(v_raw) > 720;
      v_off := v_raw::integer;
      CONTINUE WHEN v_off < 0 AND v_anchor NOT IN ('service_start', 'service_end');
      CONTINUE WHEN v_anchor = 'phase_start' AND NULLIF(t.c ->> 'phase_key', '') IS NULL;
      CONTINUE WHEN v_anchor = 'item_completed' AND NULLIF(t.c ->> 'item_key', '') IS NULL;

      FOR s IN SELECT * FROM app_servicio.services sv
                WHERE sv.workspace_id = p_workspace_id AND NOT sv.is_test
                  AND (sv.status = 'active' OR (v_anchor = 'service_end' AND v_off >= 0 AND sv.status IN ('completed', 'renewed')))
                  AND (NULLIF(t.c ->> 'product_id', '') IS NULL OR sv.product_id::text = t.c ->> 'product_id')
                  AND (NULLIF(t.c ->> 'variant_id', '') IS NULL OR sv.product_variant_id::text = t.c ->> 'variant_id') LOOP
        v_at := CASE v_anchor
          WHEN 'service_created' THEN s.created_at
          WHEN 'service_start' THEN CASE WHEN s.starts_on IS NULL THEN NULL ELSE s.starts_on::timestamp AT TIME ZONE v_tz END
          WHEN 'service_end' THEN CASE WHEN s.ends_on IS NULL THEN NULL ELSE (s.ends_on + 1)::timestamp AT TIME ZONE v_tz END
          WHEN 'phase_start' THEN (SELECT ph.started_at FROM app_servicio.service_phases ph
                                    WHERE ph.service_id = s.id AND ph.template_key = t.c ->> 'phase_key' AND ph.started_at IS NOT NULL
                                    ORDER BY ph.started_at DESC LIMIT 1)
          WHEN 'item_completed' THEN (SELECT min(i.completed_at) FROM app_servicio.service_items i
                                       WHERE i.service_id = s.id AND i.template_key = t.c ->> 'item_key' AND i.status = 'completed')
        END;
        CONTINUE WHEN v_at IS NULL OR NOT app_servicio.svc_relative_hours_due(v_at, v_off, p_now);
        v_occ := 'rel:' || v_anchor || CASE v_anchor WHEN 'phase_start' THEN ':' || (t.c ->> 'phase_key')
                                                     WHEN 'item_completed' THEN ':' || (t.c ->> 'item_key') ELSE '' END;
        INSERT INTO app_servicio.trigger_anchor_fires (flow_id, service_id, occurrence, workspace_id, trigger_type)
        VALUES (t.flow_id, s.id, v_occ, p_workspace_id, 'service_relative') ON CONFLICT DO NOTHING;
        CONTINUE WHEN NOT FOUND;
        PERFORM app_servicio.emit(s, 'service_relative', jsonb_strip_nulls(jsonb_build_object(
          'flow_id', t.flow_id, 'trigger_id', t.id, 'occurrence', v_occ, 'anchor', v_anchor, 'unit', 'hours',
          'offset_hours', v_off, 'anchor_at', v_at, 'phase_key', NULLIF(t.c ->> 'phase_key', ''), 'item_key', NULLIF(t.c ->> 'item_key', ''))));
        v_n := v_n + 1;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'svc_relative_hours_tick: disparador %: %', t.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_relative_hours_due(timestamptz, integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_servicio.svc_relative_hours_tick(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.svc_relative_hours_due(timestamptz, integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION app_servicio.svc_relative_hours_tick(uuid, timestamptz) TO service_role;

-- El cron horario `svc-daily` (00353) suma los de horas: cada hora, sin esperar a las 02:00. Definición de la base el
-- 18/11/2026 + el bloque «En horas». Un fallo no frena el encolado del barrido diario.
CREATE OR REPLACE FUNCTION private.enqueue_svc_daily(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws record;
  v_local timestamp;
  v_key text;
  v_n integer := 0;
BEGIN
  FOR v_ws IN SELECT w.id, COALESCE(w.timezone, 'UTC') AS tz FROM public.workspaces w WHERE w.services_enabled IS TRUE LOOP
    -- En horas (00460): «X horas antes o después de…».
    BEGIN
      PERFORM app_servicio.svc_relative_hours_tick(v_ws.id, p_now);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_svc_daily: relativos en horas del negocio %: %', v_ws.id, SQLERRM;
    END;
    BEGIN
      BEGIN
        v_local := p_now AT TIME ZONE v_ws.tz;
      EXCEPTION WHEN OTHERS THEN
        v_local := p_now AT TIME ZONE 'UTC';
      END;
      CONTINUE WHEN v_local::time < time '02:00';
      v_key := 'svc_daily:' || v_ws.id::text || ':' || v_local::date::text;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.scheduled_jobs j WHERE j.dedupe_key = v_key);
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES ('svc_daily', jsonb_build_object('workspace_id', v_ws.id, 'local_date', v_local::date::text), p_now, v_key)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      IF FOUND THEN v_n := v_n + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_svc_daily: no pude encolar el negocio %: %', v_ws.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION private.enqueue_svc_daily(timestamptz) FROM PUBLIC, anon, authenticated;

-- ─── 4. «Una cifra del estudiante llega a…» ─────────────────────────────────────────────────────────────────────────
-- La regla (pura): el cambio cruza el número. Gemela de metricCrossed.
CREATE OR REPLACE FUNCTION app_servicio.svc_metric_crossed(p_before numeric, p_after numeric, p_threshold numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(p_threshold >= 1 AND p_before < p_threshold AND p_after >= p_threshold, false);
$$;

-- La parte común: para una cifra que pasó de `p_before` a `p_after` (en unidades de la base: puntos, centavos o
-- proyectos), emite en cada automatización activa cuyo número cruzó. El servicio es el del estudiante en ese programa
-- (no de prueba, ni cancelado ni sin confirmar; primero el activo y el más reciente). Devuelve cuántos emitió.
CREATE OR REPLACE FUNCTION app_servicio.svc_metric_fire(p_workspace_id uuid, p_contact_id uuid, p_product_id uuid, p_metric text, p_before numeric, p_after numeric)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t record;
  s app_servicio.services;
  v_raw numeric;
  v_threshold bigint;
  v_base numeric;
  v_occ text;
  v_n integer := 0;
BEGIN
  IF p_before IS NULL OR p_after IS NULL OR p_after <= p_before OR p_contact_id IS NULL OR p_product_id IS NULL THEN RETURN 0; END IF;
  IF p_metric IS NULL OR p_metric NOT IN ('points', 'revenue', 'real_projects') THEN RETURN 0; END IF;
  IF NOT app_servicio.module_on(p_workspace_id) THEN RETURN 0; END IF;
  FOR t IN SELECT tr.id, tr.flow_id, COALESCE(tr.config, '{}'::jsonb) AS c FROM public.triggers tr
            WHERE tr.workspace_id = p_workspace_id AND tr.is_active AND tr.flow_id IS NOT NULL
              AND tr.type = 'service_metric_reached' AND tr.config ->> 'metric' = p_metric LOOP
    BEGIN
      CONTINUE WHEN jsonb_typeof(t.c -> 'threshold') IS DISTINCT FROM 'number';
      v_raw := (t.c ->> 'threshold')::numeric;
      CONTINUE WHEN v_raw <> trunc(v_raw) OR v_raw < 1 OR v_raw > 100000000;
      v_threshold := v_raw::bigint;
      CONTINUE WHEN NULLIF(t.c ->> 'product_id', '') IS NOT NULL AND t.c ->> 'product_id' <> p_product_id::text;
      v_base := CASE WHEN p_metric = 'revenue' THEN v_threshold * 100 ELSE v_threshold END;
      CONTINUE WHEN NOT app_servicio.svc_metric_crossed(p_before, p_after, v_base);
      SELECT * INTO s FROM app_servicio.services sv
       WHERE sv.workspace_id = p_workspace_id AND sv.contact_id = p_contact_id AND sv.product_id = p_product_id
         AND NOT sv.is_test AND sv.status NOT IN ('cancelled', 'pending_confirmation')
         AND (NULLIF(t.c ->> 'variant_id', '') IS NULL OR sv.product_variant_id::text = t.c ->> 'variant_id')
       ORDER BY (sv.status = 'active') DESC, sv.starts_on DESC NULLS LAST, sv.created_at DESC
       LIMIT 1;
      CONTINUE WHEN s.id IS NULL;
      v_occ := 'metric:' || p_metric || ':' || v_threshold::text;
      INSERT INTO app_servicio.trigger_anchor_fires (flow_id, service_id, occurrence, workspace_id, trigger_type)
      VALUES (t.flow_id, s.id, v_occ, p_workspace_id, 'service_metric_reached') ON CONFLICT DO NOTHING;
      CONTINUE WHEN NOT FOUND;
      PERFORM app_servicio.emit(s, 'service_metric_reached', jsonb_build_object(
        'flow_id', t.flow_id, 'trigger_id', t.id, 'occurrence', v_occ, 'metric', p_metric, 'threshold', v_threshold,
        'value', CASE WHEN p_metric = 'revenue' THEN round(p_after / 100.0, 2) ELSE p_after END));
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'svc_metric_fire: disparador %: %', t.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_metric_crossed(numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_servicio.svc_metric_fire(uuid, uuid, uuid, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.svc_metric_crossed(numeric, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION app_servicio.svc_metric_fire(uuid, uuid, uuid, text, numeric, numeric) TO service_role;

-- Puntos: trigger de SENTENCIA (con la tabla de lo insertado), así varias filas de una vez cuentan juntas. El total
-- después es el del libro; el de antes, ese total menos lo que entró en la sentencia. Nunca hace fallar el insert.
CREATE OR REPLACE FUNCTION app_servicio.svc_metric_on_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r record;
  v_after numeric;
BEGIN
  FOR r IN SELECT n.workspace_id, n.contact_id, n.product_id, sum(n.points)::numeric AS delta FROM new_rows n
            WHERE EXISTS (SELECT 1 FROM public.triggers tr WHERE tr.workspace_id = n.workspace_id AND tr.is_active
                            AND tr.type = 'service_metric_reached' AND tr.config ->> 'metric' = 'points')
            GROUP BY n.workspace_id, n.contact_id, n.product_id
           HAVING sum(n.points) > 0 LOOP
    BEGIN
      SELECT COALESCE(sum(l.points), 0) INTO v_after FROM app_servicio_portal.points_ledger l
       WHERE l.contact_id = r.contact_id AND l.product_id = r.product_id;
      PERFORM app_servicio.svc_metric_fire(r.workspace_id, r.contact_id, r.product_id, 'points', v_after - r.delta, v_after);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'svc_metric_on_points: %', SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_metric_on_points() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS points_ledger_metric_reached ON app_servicio_portal.points_ledger;
CREATE TRIGGER points_ledger_metric_reached
  AFTER INSERT ON app_servicio_portal.points_ledger
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app_servicio.svc_metric_on_points();
