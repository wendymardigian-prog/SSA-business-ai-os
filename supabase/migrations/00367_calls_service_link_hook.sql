-- ============================================================
-- 00367_calls_service_link_hook.sql
-- ============================================================
-- Servicios A4 (plano: A4-M6), F135, F138 y F139:
--
--   1. `app_servicio.svc_call_link_plan(jsonb)`: a que servicio queda unida una reunion. PURA. Gemela de
--      `callLinkPlan` (lib/services/call-link.ts), con los casos de `call-link.cases.json` (vitest y
--      `verify-services --bloque a4`).
--   2. `app_servicio.call_link_hook()`: AFTER INSERT OR UPDATE OF contact_id, booking_id, area_id, category_id,
--      recorded_at ON public.calls. Sale al principio con el modulo apagado, declara `record` (no tipos del modulo)
--      y va en EXCEPTION WHEN OTHERS -> `hook_failed`: NUNCA tumba la ingesta de Fathom ni la clasificacion.
--      Nunca pisa `service_link = 'manual'`. Deja «Por revisar» con el aviso `call_service_review` una vez por
--      reunion, y anota cada cambio en `audit_log` (`call.service_linked`).
--   3. El paso Reunion que se completa «cuando hay grabacion» (`complete_on = 'recorded'`, F138): lo completa el
--      mismo enganche al quedar vinculada, con `completed_source = 'call'`, salvo «no se presento». Si el paso es de
--      una fase que todavia no empezo, nace completo (como F17/F18: se miran todas las fases no terminadas).
--   4. El barrido horario de reuniones sin grabacion (F139): `private.enqueue_call_missing_recording()` encola un
--      job `call_missing_recording_sweep` por negocio con el modulo prendido y por hora (cron SQL directo, minuto 41,
--      como `svc-daily`; no pasa por call_app_cron). La regla vive en lib/calls/missing-recording.ts.
--
-- Aditiva: un trigger nuevo sobre una tabla en uso, funciones nuevas y un cron. Como volver atras:
--   DROP TRIGGER IF EXISTS trg_app_servicio_call_link ON public.calls;
--   DROP FUNCTION IF EXISTS app_servicio.call_link_hook();
--   DROP FUNCTION IF EXISTS app_servicio.svc_call_link_apply(uuid);
--   DROP FUNCTION IF EXISTS app_servicio.svc_call_complete_recorded(uuid);
--   DROP FUNCTION IF EXISTS app_servicio.svc_call_link_plan(jsonb);
--   SELECT cron.unschedule('call-missing-recording') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'call-missing-recording');
--   DROP FUNCTION IF EXISTS private.enqueue_call_missing_recording(timestamptz);
-- No cambia datos por si sola: las reuniones que ya existen siguen sin servicio hasta que algo las toque.

-- ─── 1. La regla (pura) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_call_link_plan(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_area text := p ->> 'area_key';
  v_type text := p ->> 'type_key';
  v_day text := p ->> 'recorded_on';
  v_et text := p ->> 'event_type_id';
  v_service boolean;
  v_covering jsonb := '[]'::jsonb;
  v_bytype jsonb := '[]'::jsonb;
  c jsonb;
BEGIN
  IF p ->> 'current_link' = 'manual' THEN
    RETURN jsonb_build_object('action', 'keep');
  END IF;
  -- COALESCE en cada parte: con area y tipo vacios, una comparacion con NULL daria NULL y dejaria pasar la reunion.
  v_service := COALESCE(v_type, '') <> 'servicio.clase'
    AND (COALESCE(v_area, '') = 'servicio' OR COALESCE(v_type, '') LIKE 'servicio.%');
  IF NOT COALESCE((p ->> 'has_contact')::boolean, false) OR NOT v_service THEN
    RETURN jsonb_build_object('action', 'set', 'service_id', NULL, 'link', NULL);
  END IF;
  IF NULLIF(p ->> 'booking_item_service_id', '') IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'set', 'service_id', p ->> 'booking_item_service_id', 'link', 'booking');
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p -> 'candidates', '[]'::jsonb)) LOOP
    CONTINUE WHEN c ->> 'status' = 'cancelled';
    IF c ->> 'status' <> 'pending_confirmation' THEN
      CONTINUE WHEN NULLIF(c ->> 'starts_on', '') IS NOT NULL AND (c ->> 'starts_on') > v_day;
      CONTINUE WHEN NULLIF(c ->> 'ends_on', '') IS NOT NULL AND v_day > (c ->> 'ends_on');
    END IF;
    v_covering := v_covering || jsonb_build_array(c);
  END LOOP;
  IF jsonb_array_length(v_covering) = 1 THEN
    RETURN jsonb_build_object('action', 'set', 'service_id', v_covering -> 0 ->> 'id', 'link', 'auto');
  END IF;
  IF jsonb_array_length(v_covering) = 0 THEN
    RETURN jsonb_build_object('action', 'set', 'service_id', NULL, 'link', NULL);
  END IF;
  IF v_et IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_bytype
    FROM jsonb_array_elements(v_covering) AS e
    WHERE COALESCE(e -> 'booking_event_type_ids', '[]'::jsonb) ? v_et;
    IF jsonb_array_length(v_bytype) = 1 THEN
      RETURN jsonb_build_object('action', 'set', 'service_id', v_bytype -> 0 ->> 'id', 'link', 'auto');
    END IF;
  END IF;
  RETURN jsonb_build_object('action', 'set', 'service_id', NULL, 'link', 'review');
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_call_link_plan(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.svc_call_link_plan(jsonb) TO service_role;

-- ─── 3. El paso «cuando hay grabacion» ──────────────────────────────────────
-- Completa los pasos Reunion con complete_on = 'recorded' del servicio vinculado que corresponden a esta grabacion:
-- la agenda es del tipo de reunion del paso, o trae el `svc_item` de ese paso. Nunca con «no se presento».
CREATE OR REPLACE FUNCTION app_servicio.svc_call_complete_recorded(p_call_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_call record;
  v_booking record;
  v_item record;
  v_svc_item text;
  v_n integer := 0;
BEGIN
  SELECT c.id, c.workspace_id, c.contact_id, c.booking_id, c.service_id, c.no_show
    INTO v_call FROM public.calls c WHERE c.id = p_call_id;
  IF v_call.id IS NULL OR v_call.service_id IS NULL OR v_call.booking_id IS NULL OR COALESCE(v_call.no_show, false) THEN
    RETURN 0;
  END IF;
  SELECT b.event_type_id, b.status, b.utm INTO v_booking FROM public.bookings b WHERE b.id = v_call.booking_id;
  IF v_booking.event_type_id IS NULL OR v_booking.status = 'no_show' THEN RETURN 0; END IF;
  v_svc_item := CASE WHEN (v_booking.utm ->> 'svc_item') ~* '^[0-9a-f-]{36}$' THEN v_booking.utm ->> 'svc_item' END;
  FOR v_item IN
    SELECT i.id
      FROM app_servicio.service_items i
      JOIN app_servicio.services s ON s.id = i.service_id
      JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
     WHERE s.id = v_call.service_id AND s.workspace_id = v_call.workspace_id AND s.contact_id = v_call.contact_id
       AND s.status = 'active' AND i.status = 'pending' AND NOT i.is_recurring_template AND i.kind = 'booking'
       AND i.ref ->> 'complete_on' = 'recorded' AND ph.status <> 'completed'
       AND (i.ref ->> 'event_type_id' = v_booking.event_type_id::text OR i.id::text = v_svc_item)
     ORDER BY (ph.status = 'in_progress') DESC, ph.position, i.position
     LIMIT 1
  LOOP
    IF app_servicio.svc_mark_item(v_item.id, 'call', 'system', NULL) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_call_complete_recorded(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.svc_call_complete_recorded(uuid) TO service_role;

-- ─── 2. Juntar los datos, decidir y aplicar ─────────────────────────────────
-- Devuelve el plan aplicado. Lo usan el enganche y el boton «Vincular las reuniones de este servicio».
CREATE OR REPLACE FUNCTION app_servicio.svc_call_link_apply(p_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_call record;
  v_tz text;
  v_area text;
  v_type text;
  v_et uuid;
  v_svc_item uuid;
  v_item_service uuid;
  v_candidates jsonb;
  v_plan jsonb;
  v_new_service uuid;
  v_new_link text;
  r record;
BEGIN
  SELECT c.id, c.workspace_id, c.contact_id, c.booking_id, c.area_id, c.category_id, c.recorded_at,
         c.service_id, c.service_link, c.recorded_by_user_id
    INTO v_call FROM public.calls c WHERE c.id = p_call_id;
  IF v_call.id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(w.timezone, 'UTC') INTO v_tz FROM public.workspaces w WHERE w.id = v_call.workspace_id;
  SELECT bc.system_key INTO v_area FROM public.booking_categories bc WHERE bc.id = v_call.area_id;
  SELECT bc.system_key INTO v_type FROM public.booking_categories bc WHERE bc.id = v_call.category_id;

  IF v_call.booking_id IS NOT NULL THEN
    SELECT b.event_type_id,
           CASE WHEN (b.utm ->> 'svc_item') ~* '^[0-9a-f-]{36}$' THEN (b.utm ->> 'svc_item')::uuid END
      INTO v_et, v_svc_item
      FROM public.bookings b WHERE b.id = v_call.booking_id;
  END IF;
  IF v_svc_item IS NOT NULL AND v_call.contact_id IS NOT NULL THEN
    SELECT i.service_id INTO v_item_service
      FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
     WHERE i.id = v_svc_item AND s.contact_id = v_call.contact_id AND s.workspace_id = v_call.workspace_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'status', s.status, 'starts_on', s.starts_on, 'ends_on', s.ends_on,
           'booking_event_type_ids', COALESCE((
             SELECT jsonb_agg(DISTINCT it -> 'ref' ->> 'event_type_id')
               FROM jsonb_array_elements(COALESCE(pv.journey_template -> 'phases', '[]'::jsonb)) AS ph,
                    jsonb_array_elements(COALESCE(ph -> 'items', '[]'::jsonb)) AS it
              WHERE it ->> 'kind' = 'booking' AND (it -> 'ref' ->> 'event_type_id') IS NOT NULL), '[]'::jsonb)
         )), '[]'::jsonb)
    INTO v_candidates
    FROM app_servicio.services s
    LEFT JOIN public.product_variants pv ON pv.id = s.product_variant_id
   WHERE s.workspace_id = v_call.workspace_id AND s.contact_id = v_call.contact_id AND v_call.contact_id IS NOT NULL;

  v_plan := app_servicio.svc_call_link_plan(jsonb_build_object(
    'current_link', v_call.service_link,
    'has_contact', v_call.contact_id IS NOT NULL,
    'area_key', v_area,
    'type_key', v_type,
    'booking_item_service_id', v_item_service,
    'recorded_on', ((COALESCE(v_call.recorded_at, now())) AT TIME ZONE v_tz)::date::text,
    'event_type_id', v_et,
    'candidates', v_candidates));

  IF v_plan ->> 'action' = 'set' THEN
    v_new_service := NULLIF(v_plan ->> 'service_id', '')::uuid;
    v_new_link := v_plan ->> 'link';
    IF v_new_service IS DISTINCT FROM v_call.service_id OR v_new_link IS DISTINCT FROM v_call.service_link THEN
      UPDATE public.calls SET service_id = v_new_service, service_link = v_new_link WHERE id = v_call.id;
      PERFORM app_servicio.audit(v_call.workspace_id, 'call', v_call.id, 'call.service_linked',
        jsonb_build_object('service_id', jsonb_build_object('old', v_call.service_id, 'new', v_new_service),
                           'service_link', jsonb_build_object('old', v_call.service_link, 'new', v_new_link)), 'system');
      -- «Por revisar»: un aviso por reunion a quien la grabo y a los responsables de los servicios posibles.
      IF v_new_link = 'review' AND NOT EXISTS (
        SELECT 1 FROM public.notifications n WHERE n.type = 'call_service_review' AND n.entity_id = v_call.id
      ) THEN
        FOR r IN
          SELECT DISTINCT u AS uid FROM (
            SELECT v_call.recorded_by_user_id AS u
            UNION
            SELECT s.owner_user_id FROM app_servicio.services s
             WHERE s.workspace_id = v_call.workspace_id AND s.contact_id = v_call.contact_id AND s.status <> 'cancelled'
          ) x WHERE u IS NOT NULL
        LOOP
          PERFORM app_servicio.notify(v_call.workspace_id, r.uid, 'call_service_review', 'Una reunión quedó por revisar',
            'El cliente tiene más de un servicio posible: elegí a cuál pertenece la reunión.', 'call', v_call.id, '{}'::jsonb);
        END LOOP;
      END IF;
    END IF;
  END IF;

  PERFORM app_servicio.svc_call_complete_recorded(v_call.id);
  RETURN v_plan;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_call_link_apply(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.svc_call_link_apply(uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.call_link_hook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- `record` y no tipos del modulo: un tipo se resuelve al ENTRAR a la funcion, antes del bloque que atrapa los
  -- errores, y un problema con una tabla del modulo haria fallar la ingesta de BAIOS.
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    PERFORM app_servicio.svc_call_link_apply(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'call', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.call_link_hook() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_app_servicio_call_link ON public.calls;
CREATE TRIGGER trg_app_servicio_call_link
  AFTER INSERT OR UPDATE OF contact_id, booking_id, area_id, category_id, recorded_at ON public.calls
  FOR EACH ROW EXECUTE FUNCTION app_servicio.call_link_hook();

-- ─── 4. El barrido horario de reuniones sin grabacion (F139) ────────────────
CREATE OR REPLACE FUNCTION private.enqueue_call_missing_recording(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws record;
  v_key text;
  v_n integer := 0;
BEGIN
  FOR v_ws IN SELECT w.id FROM public.workspaces w WHERE w.services_enabled IS TRUE LOOP
    BEGIN
      v_key := 'call_missing_recording:' || v_ws.id::text || ':' || to_char(p_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24');
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.scheduled_jobs j WHERE j.dedupe_key = v_key);
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES ('call_missing_recording_sweep', jsonb_build_object('workspace_id', v_ws.id), p_now, v_key)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      IF FOUND THEN v_n := v_n + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_call_missing_recording: no pude encolar el negocio %: %', v_ws.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_call_missing_recording(timestamptz) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'call-missing-recording') THEN PERFORM cron.unschedule('call-missing-recording'); END IF;
  PERFORM cron.schedule('call-missing-recording', '41 * * * *', $c$SELECT private.enqueue_call_missing_recording()$c$);
END $$;
