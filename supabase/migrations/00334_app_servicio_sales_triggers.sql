-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00334_app_servicio_sales_triggers  (Servicios v12, Corrida A1 · S05 · bloque SV1)
-- ============================================================================
-- Los enganches sobre Ventas:
-- 1. `trg_app_servicio_payment` (AFTER INSERT OR UPDATE OF status ON payments):
--    - un pago que queda `paid` llama a `svc_evaluate_auto_creation` (F6, F9, F115): crea el servicio,
--      lo deja por confirmar, crea uno enlazado, extiende el que ya tiene o no hace nada, segun la
--      `service_settings` de LA VARIANTE de la venta (`sales.product_variant_id`, NOT NULL);
--    - un pago que deja de estar `paid` despues de creado el servicio: el servicio queda, se anota
--      `svc.payment_reverted` y se avisa (F10);
--    - un cambio de un pago a/desde `overdue` recalcula el semaforo (F24).
-- 2. `trg_app_servicio_sale` (AFTER UPDATE ON sales):
--    - venta `cancelled` → cancela su servicio (tambien el por confirmar) y corta todos los accesos;
--      `refunded` → lo cancela con motivo "reembolso" (F10);
--    - un servicio completado queda completado y avisa; una venta de extension avisa con
--      "Revertir la extension" (F115);
--    - una venta editada despues (producto, variante o contacto) no cambia el servicio: aviso
--      "La venta cambió: revisá el servicio".
-- 3. `svc_sale_facts` (lo cobrado, en centimos) y `svc_rule_check` (si la venta cumple la regla, con el
--    motivo; F95), sobre la regla pura `svc_rule_met`.
--
-- NUNCA hacen fallar el pago ni la venta: todo va en EXCEPTION WHEN OTHERS → RAISE WARNING + una fila
-- `svc.hook_failed` en audit_log (sin datos personales) + aviso a Owner y Admin. Con el modulo apagado
-- en el negocio, salen sin hacer nada.
--
-- Modifica logica existente (triggers nuevos sobre tablas de Ventas en uso). Riesgo ALTO.
-- Va ANTES de desplegar el codigo.
--
-- Cómo volver atrás:
--   DROP TRIGGER IF EXISTS trg_app_servicio_payment ON public.payments;
--   DROP TRIGGER IF EXISTS trg_app_servicio_sale ON public.sales;
--   DROP FUNCTION IF EXISTS app_servicio.payment_hook(), app_servicio.sale_hook(),
--     app_servicio.svc_evaluate_auto_creation(uuid), app_servicio.svc_rule_check(uuid), app_servicio.svc_sale_facts(uuid),
--     app_servicio.hook_failed(uuid, text, text, uuid);
-- Los triggers que ya existian sobre payments y sales (ver docs/servicios/punto-de-partida.json) no se tocan.
-- ============================================================================

-- Anota que un enganche fallo, sin datos personales, y avisa.
CREATE OR REPLACE FUNCTION app_servicio.hook_failed(p_workspace_id uuid, p_hook text, p_error text, p_entity_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE WARNING 'app_servicio %: %', p_hook, p_error;
  BEGIN
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
    VALUES (p_workspace_id, 'service_hook', COALESCE(p_entity_id, p_workspace_id), 'svc.hook_failed',
            jsonb_build_object('hook', p_hook, 'error', left(p_error, 300)), 'system', 'servicios');
    PERFORM app_servicio.notify_admins(p_workspace_id, 'svc_hook_failed', 'Algo del módulo de Servicios no se pudo hacer solo',
      'Revisalo a mano. El detalle quedó en la actividad.', 'service_hook', p_entity_id, jsonb_build_object('hook', p_hook));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_servicio.hook_failed: %', SQLERRM;
  END;
END;
$$;

-- Lo cobrado de una venta, en centimos: pagos paid que no son reembolso, menos los reembolsos paid.
CREATE OR REPLACE FUNCTION app_servicio.svc_sale_facts(p_sale_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'collectedCents', COALESCE(sum(round(p.amount * 100)) FILTER (WHERE p.status = 'paid' AND p.type <> 'refund'), 0)
                    - COALESCE(sum(abs(round(p.amount * 100))) FILTER (WHERE p.status = 'paid' AND p.type = 'refund'), 0),
    'totalCents', (SELECT round(s.final_amount * 100) FROM public.sales s WHERE s.id = p_sale_id),
    'hasNonReservationPaid', COALESCE(bool_or(p.status = 'paid' AND p.type NOT IN ('reservation', 'refund')), false),
    'hasAnyPaid', COALESCE(bool_or(p.status = 'paid' AND p.type <> 'refund'), false),
    'lastPaidAt', max(p.paid_at) FILTER (WHERE p.status = 'paid' AND p.type <> 'refund'))
  FROM public.payments p WHERE p.sale_id = p_sale_id;
$$;

-- Si la venta cumple la regla de su variante, con el motivo (F95). {met, reason, mode, variant_id}
-- reason: met | no_rule | already_has_service | before_enabled | only_reservation | below_percent |
--         below_amount | no_payment
CREATE OR REPLACE FUNCTION app_servicio.svc_rule_check(p_sale_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sale public.sales;
  v_settings jsonb;
  v_facts jsonb;
  v_rule text;
  v_input jsonb;
  v_enabled timestamptz;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'No existe la venta' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_sale.workspace_id) AND public.can_see_sale(v_sale)) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  SELECT pv.service_settings INTO v_settings FROM public.product_variants pv WHERE pv.id = v_sale.product_variant_id;
  IF COALESCE(v_settings ->> 'mode', 'none') = 'none' THEN
    RETURN jsonb_build_object('met', false, 'reason', 'no_rule', 'mode', 'none', 'variant_id', v_sale.product_variant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM app_servicio.services s WHERE s.sale_id = p_sale_id OR p_sale_id = ANY (s.extension_sale_ids)) THEN
    RETURN jsonb_build_object('met', false, 'reason', 'already_has_service', 'mode', v_settings ->> 'mode', 'variant_id', v_sale.product_variant_id);
  END IF;
  v_facts := app_servicio.svc_sale_facts(p_sale_id);
  v_rule := v_settings #>> '{when,rule}';
  v_enabled := (v_settings #>> '{when,enabled_at}')::timestamptz;
  IF NOT (v_facts ->> 'hasAnyPaid')::boolean THEN
    RETURN jsonb_build_object('met', false, 'reason', 'no_payment', 'mode', v_settings ->> 'mode', 'variant_id', v_sale.product_variant_id);
  END IF;
  IF v_enabled IS NOT NULL AND (v_facts ->> 'lastPaidAt')::timestamptz < v_enabled THEN
    RETURN jsonb_build_object('met', false, 'reason', 'before_enabled', 'mode', v_settings ->> 'mode', 'variant_id', v_sale.product_variant_id);
  END IF;
  v_input := v_facts || jsonb_build_object('rule', v_rule, 'value', v_settings #> '{when,value}');
  IF app_servicio.svc_rule_met(v_input) THEN
    RETURN jsonb_build_object('met', true, 'reason', 'met', 'mode', v_settings ->> 'mode', 'variant_id', v_sale.product_variant_id);
  END IF;
  RETURN jsonb_build_object('met', false, 'mode', v_settings ->> 'mode', 'variant_id', v_sale.product_variant_id, 'reason',
    CASE v_rule WHEN 'non_reservation' THEN 'only_reservation' WHEN 'percent' THEN 'below_percent' WHEN 'amount' THEN 'below_amount' ELSE 'no_payment' END);
END;
$$;

-- La creacion automatica al cobrar (F6, F9, F115). La llama el trigger de payments.
CREATE OR REPLACE FUNCTION app_servicio.svc_evaluate_auto_creation(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pay public.payments;
  v_sale public.sales;
  v_var public.product_variants;
  v_settings jsonb;
  v_check jsonb;
  v_prev app_servicio.services;
  v_target app_servicio.services;
  v_plan jsonb;
  v_pay_day date;
  v_start date;
  v_status text;
  v_flags jsonb := '{}'::jsonb;
  v_id uuid;
  v_n integer; v_unit text; v_base date; v_new_end date;
  v_fallback uuid;
BEGIN
  PERFORM app_servicio.as_system();
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id;
  IF v_pay.id IS NULL OR v_pay.status <> 'paid' OR v_pay.type = 'refund' THEN RETURN jsonb_build_object('action', 'none'); END IF;
  IF NOT app_servicio.module_on(v_pay.workspace_id) THEN RETURN jsonb_build_object('action', 'module_off'); END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = v_pay.sale_id;
  SELECT * INTO v_var FROM public.product_variants WHERE id = v_sale.product_variant_id;
  v_settings := v_var.service_settings;
  IF COALESCE(v_settings ->> 'mode', 'none') = 'none' THEN RETURN jsonb_build_object('action', 'none'); END IF;
  -- Corregir o resincronizar un pago viejo nunca crea un servicio (F6, regla 2).
  IF (v_settings #>> '{when,enabled_at}') IS NOT NULL AND COALESCE(v_pay.paid_at, now()) < (v_settings #>> '{when,enabled_at}')::timestamptz THEN
    RETURN jsonb_build_object('action', 'before_enabled');
  END IF;
  v_check := app_servicio.svc_rule_check(v_sale.id);
  IF NOT (v_check ->> 'met')::boolean THEN RETURN jsonb_build_object('action', 'none', 'reason', v_check ->> 'reason'); END IF;
  v_pay_day := COALESCE(v_pay.paid_on, app_servicio.local_date(v_pay.paid_at, v_pay.workspace_id), app_servicio.today_in(v_pay.workspace_id));

  IF v_settings ->> 'mode' = 'create' THEN
    v_start := CASE COALESCE(v_settings ->> 'start', 'payment_date')
      WHEN 'payment_date' THEN v_pay_day
      WHEN 'sale_date' THEN COALESCE(v_sale.service_starts_at, v_sale.sale_date)
      ELSE NULL END;
    v_status := CASE WHEN COALESCE((v_settings ->> 'confirm')::boolean, false) OR v_settings ->> 'start' = 'manual' THEN 'pending_confirmation' ELSE 'active' END;
    -- El servicio previo del mismo producto (el mas reciente que no se cancelo).
    SELECT * INTO v_prev FROM app_servicio.services s
     WHERE s.contact_id = v_sale.contact_id AND s.product_id = v_var.product_id AND s.status NOT IN ('cancelled', 'pending_confirmation')
     ORDER BY COALESCE(s.ends_on, 'infinity'::date) DESC, s.created_at DESC LIMIT 1;
    v_plan := app_servicio.svc_renewal_plan(jsonb_build_object('renewal', COALESCE(v_settings ->> 'renewal', 'new_linked'),
      'today', v_pay_day, 'prev', CASE WHEN v_prev.id IS NULL THEN NULL ELSE jsonb_build_object('status', v_prev.status, 'endsOn', v_prev.ends_on,
      'endedOn', COALESCE(app_servicio.local_date(v_prev.completed_at, v_prev.workspace_id), v_prev.ends_on)) END));
    -- ¿Venta repetida? (mismo producto y variante, activo que empezo hace menos de 7 dias)
    IF v_prev.id IS NOT NULL AND v_prev.status = 'active' AND v_prev.product_variant_id = v_var.id
       AND v_prev.starts_on IS NOT NULL AND v_pay_day - v_prev.starts_on < 7 THEN
      v_status := 'pending_confirmation';
      v_flags := v_flags || jsonb_build_object('possible_duplicate', true);
    END IF;
    CASE v_plan ->> 'action'
      WHEN 'extend' THEN
        v_n := v_var.duration_value;
        IF v_var.duration_type = 'lifetime' OR v_n IS NULL THEN RETURN jsonb_build_object('action', 'none', 'reason', 'lifetime'); END IF;
        PERFORM app_servicio.svc_extend(v_prev.id, jsonb_build_object('mode', 'period', 'n', v_n, 'unit', v_var.duration_type,
          'kind', 'purchase', 'sale_id', v_sale.id, 'reason', 'Compró otra vez'));
        RETURN jsonb_build_object('action', 'extended', 'service_id', v_prev.id);
      WHEN 'ask' THEN
        v_status := 'pending_confirmation';
        v_flags := v_flags || jsonb_build_object('renewal_choice_pending', true);
        v_id := app_servicio.svc_create_service(jsonb_build_object('contact_id', v_sale.contact_id, 'variant_id', v_var.id, 'sale_id', v_sale.id,
          'origin', 'sale', 'status', v_status, 'starts_on', v_start, 'previous_service_id', v_prev.id, 'flags', v_flags));
      WHEN 'new_linked' THEN
        v_id := app_servicio.svc_create_service(jsonb_build_object('contact_id', v_sale.contact_id, 'variant_id', v_var.id, 'sale_id', v_sale.id,
          'origin', 'sale', 'status', v_status, 'starts_on', COALESCE((v_plan ->> 'startsOn')::date, v_start), 'previous_service_id', v_prev.id,
          'owner_user_id', CASE WHEN v_settings #>> '{owner,mode}' = 'previous' OR v_prev.status IN ('active','paused') THEN v_prev.owner_user_id END,
          'flags', v_flags || CASE WHEN (v_plan ->> 'startsOn') IS NOT NULL THEN '{"renews_previous": true}'::jsonb ELSE '{}'::jsonb END));
      WHEN 'recovery' THEN
        v_id := app_servicio.svc_create_service(jsonb_build_object('contact_id', v_sale.contact_id, 'variant_id', v_var.id, 'sale_id', v_sale.id,
          'origin', 'recovery', 'origin_reason', 'Volvió a comprar', 'status', v_status, 'starts_on', v_start, 'previous_service_id', v_prev.id, 'flags', v_flags));
      ELSE
        v_id := app_servicio.svc_create_service(jsonb_build_object('contact_id', v_sale.contact_id, 'variant_id', v_var.id, 'sale_id', v_sale.id,
          'origin', 'sale', 'status', v_status, 'starts_on', v_start, 'flags', v_flags));
    END CASE;
    RETURN jsonb_build_object('action', 'created', 'service_id', v_id, 'status', v_status);
  END IF;

  -- mode = extend (renovaciones, F115): extiende el servicio del contacto del mismo producto.
  SELECT * INTO v_target FROM app_servicio.services s
   WHERE s.contact_id = v_sale.contact_id AND s.product_id = v_var.product_id AND s.status IN ('active', 'paused', 'completed')
     AND (jsonb_typeof(v_settings #> '{extend,target_variant_ids}') IS DISTINCT FROM 'array'
          OR s.product_variant_id::text IN (SELECT jsonb_array_elements_text(v_settings #> '{extend,target_variant_ids}')))
   ORDER BY s.ends_on DESC NULLS FIRST, s.created_at DESC LIMIT 1;
  IF v_target.id IS NOT NULL THEN
    v_n := (v_settings #>> '{extend,n}')::integer;
    v_unit := COALESCE(v_settings #>> '{extend,unit}', 'months');
    v_base := CASE WHEN v_target.status IN ('active', 'paused') AND v_target.ends_on IS NOT NULL THEN v_target.ends_on ELSE v_pay_day END;
    v_new_end := CASE v_unit WHEN 'months' THEN (v_base + make_interval(months => v_n))::date WHEN 'weeks' THEN v_base + v_n * 7 ELSE v_base + v_n END;
    PERFORM app_servicio.svc_extend(v_target.id, jsonb_build_object('mode', 'end_date', 'end_on', v_new_end, 'kind', 'purchase',
      'sale_id', v_sale.id, 'reason', 'Renovación', 'extend_own', COALESCE((v_settings #>> '{extend,extend_accesses}')::boolean, false)));
    RETURN jsonb_build_object('action', 'extended', 'service_id', v_target.id);
  END IF;
  -- Sin servicio para extender: la variante de respaldo (por confirmar, por defecto, o activo).
  v_fallback := (v_settings #>> '{extend,fallback_variant_id}')::uuid;
  v_status := CASE WHEN COALESCE(v_settings #>> '{extend,if_no_service}', 'confirm') = 'create' THEN 'active' ELSE 'pending_confirmation' END;
  v_id := app_servicio.svc_create_service(jsonb_build_object('contact_id', v_sale.contact_id, 'variant_id', v_fallback, 'sale_id', v_sale.id,
    'origin', 'sale', 'status', v_status, 'starts_on', v_pay_day, 'flags', jsonb_build_object('renewal_without_previous', true)));
  PERFORM app_servicio.notify_admins(v_sale.workspace_id, 'svc_renewal_without_previous', 'Compró una renovación sin servicio anterior',
    'Se creó el servicio con la variante de respaldo. Revisalo.', 'service', v_id);
  RETURN jsonb_build_object('action', 'created_fallback', 'service_id', v_id, 'status', v_status);
END;
$$;

-- El trigger de payments. Nunca hace fallar el pago.
CREATE OR REPLACE FUNCTION app_servicio.payment_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s record;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
      BEGIN
        PERFORM app_servicio.svc_evaluate_auto_creation(NEW.id);
      EXCEPTION
        WHEN SQLSTATE 'SV013' THEN NULL;  -- otro pago de la misma venta lo creo en el mismo instante
      END;
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'paid' AND NEW.status <> 'paid' AND NEW.type <> 'refund' THEN
      -- Un cobro revertido despues de creado el servicio: el servicio queda (F10).
      FOR s IN SELECT * FROM app_servicio.services WHERE sale_id = NEW.sale_id AND status NOT IN ('cancelled') LOOP
        PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.payment_reverted', jsonb_build_object('payment_id', NEW.id), 'system');
        PERFORM app_servicio.notify(s.workspace_id, s.owner_user_id, 'svc_payment_reverted', 'Se revirtió un pago de un servicio',
          'El servicio sigue igual. Revisá la venta.', 'service', s.id);
        PERFORM app_servicio.notify_admins(s.workspace_id, 'svc_payment_reverted', 'Se revirtió un pago de un servicio',
          'El servicio sigue igual. Revisá la venta.', 'service', s.id);
      END LOOP;
    END IF;
    -- Un pago que entra o sale de mora cambia el semaforo.
    IF TG_OP = 'UPDATE' AND (OLD.status = 'overdue' OR NEW.status = 'overdue') AND OLD.status IS DISTINCT FROM NEW.status THEN
      FOR s IN SELECT id FROM app_servicio.services WHERE sale_id = NEW.sale_id LOOP
        PERFORM app_servicio.svc_compute_light(s.id);
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'payment', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  -- La marca de "sistema" vale solo mientras corre el enganche.
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_servicio_payment ON public.payments;
CREATE TRIGGER trg_app_servicio_payment
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION app_servicio.payment_hook();

-- El trigger de sales. Nunca hace fallar la venta.
CREATE OR REPLACE FUNCTION app_servicio.sale_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  -- `record` y no el tipo de la tabla del modulo: un tipo se resuelve al ENTRAR a la funcion, antes del bloque que
  -- atrapa los errores, y un problema con la tabla haria fallar la operacion de BAIOS (verify-services, sv2).
  s record;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('cancelled', 'refunded') THEN
      FOR s IN SELECT * FROM app_servicio.services WHERE sale_id = NEW.id LOOP
        IF s.status = 'completed' THEN
          PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.sale_closed_after_completion', jsonb_build_object('sale_status', NEW.status), 'system');
          PERFORM app_servicio.notify_admins(s.workspace_id, 'svc_sale_closed', 'Se canceló la venta de un servicio completado',
            'El servicio queda completado. Revisalo si hace falta.', 'service', s.id);
        ELSIF s.status NOT IN ('cancelled', 'renewed') THEN
          PERFORM app_servicio.svc_cancel_core(s.id,
            CASE WHEN NEW.status = 'refunded' THEN 'reembolso' ELSE COALESCE(nullif(btrim(NEW.cancellation_reason), ''), 'Venta cancelada') END,
            CASE WHEN NEW.status = 'refunded' THEN 'refunded' ELSE 'cancelled' END);
        END IF;
      END LOOP;
      -- Una venta que extendio un servicio no se revierte sola (F115): aviso con "Revertir la extension".
      FOR s IN SELECT * FROM app_servicio.services WHERE NEW.id = ANY (extension_sale_ids) LOOP
        PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.extension_sale_closed', jsonb_build_object('sale_id', NEW.id, 'sale_status', NEW.status), 'system');
        PERFORM app_servicio.notify_admins(s.workspace_id, 'svc_extension_sale_closed', 'Se canceló una venta que extendió un servicio',
          'Podés revertir la extensión desde la ficha del servicio.', 'service', s.id, jsonb_build_object('sale_id', NEW.id));
      END LOOP;
    END IF;
    -- La venta cambio despues: el servicio no cambia solo (F10, §14f).
    IF NEW.product_variant_id IS DISTINCT FROM OLD.product_variant_id OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
       OR (NEW.product_snapshot ->> 'product_id') IS DISTINCT FROM (OLD.product_snapshot ->> 'product_id') THEN
      FOR s IN SELECT * FROM app_servicio.services WHERE sale_id = NEW.id AND status NOT IN ('cancelled') LOOP
        UPDATE app_servicio.services SET flags = flags || '{"sale_changed": true}'::jsonb WHERE id = s.id;
        PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.sale_changed', jsonb_build_object('sale_id', NEW.id), 'system');
        PERFORM app_servicio.notify(s.workspace_id, s.owner_user_id, 'svc_sale_changed', 'La venta cambió: revisá el servicio',
          COALESCE(s.product_snapshot ->> 'product_name', ''), 'service', s.id);
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'sale', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_servicio_sale ON public.sales;
CREATE TRIGGER trg_app_servicio_sale
  AFTER UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION app_servicio.sale_hook();

REVOKE ALL ON FUNCTION app_servicio.hook_failed(uuid, text, text, uuid), app_servicio.svc_sale_facts(uuid), app_servicio.svc_rule_check(uuid),
  app_servicio.svc_evaluate_auto_creation(uuid), app_servicio.payment_hook(), app_servicio.sale_hook() FROM public, anon;
GRANT EXECUTE ON FUNCTION app_servicio.hook_failed(uuid, text, text, uuid), app_servicio.svc_sale_facts(uuid),
  app_servicio.svc_evaluate_auto_creation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION app_servicio.svc_rule_check(uuid) TO authenticated, service_role;
