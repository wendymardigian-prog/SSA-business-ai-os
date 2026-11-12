-- ============================================================
-- 00362_svc_set_dates.sql
-- ============================================================
-- Servicios A2 (F130.3): «Más… › Editar fechas y plazo» de la ficha del servicio. Hasta ahora las fechas solo las
-- cambiaban svc_activate (al confirmar), svc_extend (el fin, hacia adelante) y svc_resume (corre el fin): no habia
-- forma de corregir un inicio o acortar un plazo.
--
--   * svc_dates_plan(p jsonb)            la regla, pura (IMMUTABLE). Gemela de `datesEditPlan`
--                                        (lib/services/set-dates.ts) con `set-dates.cases.json`: motivo obligatorio
--                                        (SV016), fin igual o posterior al inicio (SV040), algo tiene que cambiar
--                                        (SV041), un servicio terminado no se edita (SV042), el inicio es obligatorio
--                                        (SV043).
--   * svc_set_dates(servicio, p jsonb)   pide `services.extend` (la clave que ya mueve el fin) y que quien la llama
--                                        vea el servicio. Guarda inicio y fin, recalcula los plazos de los pasos
--                                        pendientes anclados al inicio (svc_compute_due, que ya existe y tambien
--                                        mueve su tarea), lleva los accesos «hasta el fin del servicio» al fin nuevo
--                                        (para los dos lados), recalcula el semaforo y deja el cambio con el motivo en
--                                        el historial (`svc.dates_changed`).
--
-- Aditiva: dos funciones nuevas, sin tablas ni columnas, sin tocar ninguna funcion existente. Puede ir antes o
-- despues del codigo (sin ella, «Editar fechas y plazo» responde un error claro).
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS app_servicio.svc_set_dates(uuid, jsonb);
--   DROP FUNCTION IF EXISTS app_servicio.svc_dates_plan(jsonb);
-- ============================================================

CREATE OR REPLACE FUNCTION app_servicio.svc_dates_plan(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_old_start date;
  v_old_end date;
  v_start date;
  v_end date;
BEGIN
  IF COALESCE(p ->> 'status', '') IN ('completed', 'cancelled', 'renewed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SV042');
  END IF;
  IF nullif(btrim(COALESCE(p ->> 'reason', '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SV016');
  END IF;
  -- Una fecha valida es AAAA-MM-DD; lo demas cuenta como vacio (igual que la gemela).
  v_start := CASE WHEN COALESCE(p ->> 'startsOn', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p ->> 'startsOn')::date END;
  IF v_start IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SV043'); END IF;
  v_end := CASE WHEN COALESCE(p ->> 'endsOn', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p ->> 'endsOn')::date END;
  v_old_start := CASE WHEN COALESCE(p ->> 'oldStartsOn', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p ->> 'oldStartsOn')::date END;
  v_old_end := CASE WHEN COALESCE(p ->> 'oldEndsOn', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p ->> 'oldEndsOn')::date END;
  IF v_end IS NOT NULL AND v_end < v_start THEN RETURN jsonb_build_object('ok', false, 'error', 'SV040'); END IF;
  IF v_start = v_old_start AND v_end IS NOT DISTINCT FROM v_old_end THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SV041');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'startShiftDays', CASE WHEN v_old_start IS NULL THEN NULL ELSE v_start - v_old_start END,
    'durationDays', CASE WHEN v_end IS NULL THEN NULL ELSE v_end - v_start + 1 END);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_set_dates(p_service_id uuid, p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  s app_servicio.services;
  v_plan jsonb;
  v_start date;
  v_end date;
  v_items integer := 0;
  v_access integer := 0;
  it record;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.extend');
  v_plan := app_servicio.svc_dates_plan(jsonb_build_object(
    'status', s.status, 'oldStartsOn', s.starts_on, 'oldEndsOn', s.ends_on,
    'startsOn', p ->> 'starts_on', 'endsOn', p ->> 'ends_on', 'reason', p ->> 'reason'));
  IF NOT (v_plan ->> 'ok')::boolean THEN
    RAISE EXCEPTION '%', CASE v_plan ->> 'error'
      WHEN 'SV016' THEN 'Escribí el motivo'
      WHEN 'SV040' THEN 'La fecha de fin tiene que ser igual o posterior al inicio'
      WHEN 'SV041' THEN 'No cambiaste ninguna fecha'
      WHEN 'SV042' THEN 'Este servicio ya terminó: sus fechas no se cambian'
      ELSE 'Elegí la fecha de inicio' END USING ERRCODE = v_plan ->> 'error';
  END IF;
  v_start := (p ->> 'starts_on')::date;
  v_end := CASE WHEN COALESCE(p ->> 'ends_on', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p ->> 'ends_on')::date END;

  UPDATE app_servicio.services SET starts_on = v_start, ends_on = v_end, updated_at = now() WHERE id = s.id;

  -- Los plazos de los pasos pendientes que cuentan desde el inicio del servicio (svc_compute_due lee el inicio nuevo).
  FOR it IN
    SELECT i.id FROM app_servicio.service_items i
     WHERE i.service_id = s.id AND i.status = 'pending' AND i.parent_item_id IS NULL AND NOT i.is_recurring_template
       AND i.due_rule ->> 'from' = 'service_start'
  LOOP
    PERFORM app_servicio.svc_compute_due(it.id);
    v_items := v_items + 1;
  END LOOP;

  -- Los accesos que duran «lo que dure el servicio» terminan con el fin nuevo (para adelante o para atras).
  IF v_end IS NOT NULL AND v_end IS DISTINCT FROM s.ends_on THEN
    UPDATE app_servicio_portal.portal_access
       SET ends_at = app_servicio.end_of_day(v_end, app_servicio.ws_tz(s.workspace_id)), updated_at = now()
     WHERE service_id = s.id AND revoked_at IS NULL AND until_type = 'service';
    GET DIAGNOSTICS v_access = ROW_COUNT;
  END IF;

  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.dates_changed',
    jsonb_build_object('old_start', s.starts_on, 'new_start', v_start, 'old_end', s.ends_on, 'new_end', v_end,
                       'duration_days', v_plan -> 'durationDays', 'reason', btrim(p ->> 'reason'),
                       'items_recalculated', v_items, 'accesses', v_access));
  PERFORM app_servicio.svc_compute_light(s.id);
  RETURN jsonb_build_object('starts_on', v_start, 'ends_on', v_end, 'items_recalculated', v_items, 'accesses', v_access);
END;
$$;

REVOKE ALL ON FUNCTION app_servicio.svc_dates_plan(jsonb), app_servicio.svc_set_dates(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.svc_dates_plan(jsonb), app_servicio.svc_set_dates(uuid, jsonb) TO authenticated, service_role;
