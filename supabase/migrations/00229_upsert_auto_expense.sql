-- ============================================================================
-- 00229 — Gastos (G2, GF20/GF21/GF22): los gastos automaticos
-- ============================================================================
-- Dos funciones. La REGLA vive en la base (lo que se hace con un automatico segun lo que ya existe y el total
-- recalculado) y tiene su gemela pura en TypeScript (`decideAutoExpenseAction`, lib/finance/auto-expenses.ts): los
-- mismos casos (`lib/finance/auto-expenses.cases.json`) corren contra las dos.
--
--   1. public.decide_auto_expense_action(existing, total, ctx): la decision, pura (STABLE: castea texto a fecha). Los 8 casos de GF20.
--   2. public.upsert_auto_expense(...): en UNA transaccion, con un candado por clave y `SELECT ... FOR UPDATE`,
--      lee el gasto, decide y aplica. Si el pago de una persona gana la carrera, el recalculo ve «pagado» y solo
--      marca diferencia; si el recalculo gana, el pago congela el monto recien recalculado.
--
-- Un automatico por clave (`processor_fee:{metodo}:{AAAA-MM}` o `meta_ads:{cuenta}:{AAAA-MM}`): el indice unico
-- `(workspace_id, auto_key)` es la idempotencia. El monto SE RECALCULA ENTERO cada vez (la suma del mes), nunca
-- «se le suma lo nuevo». Lo pagado no se toca: la diferencia se marca (`auto_drift_*`) y se ajusta aparte.
-- Solo `service_role`. SECURITY DEFINER, `search_path = ''`.
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.upsert_auto_expense(uuid, text, text, bigint, text, text, uuid, text, text, jsonb, date);
--   DROP FUNCTION IF EXISTS public.decide_auto_expense_action(jsonb, bigint, jsonb);
-- Riesgo: bajo. Aditiva.
-- ============================================================================

SET search_path = '';

CREATE OR REPLACE FUNCTION public.decide_auto_expense_action(p_existing jsonb, p_total_cents bigint, p_ctx jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_total bigint := GREATEST(0, COALESCE(p_total_cents, 0));
  v_month text := p_ctx ->> 'month';
  v_today date := (p_ctx ->> 'todayLocal')::date;
  v_month_end date := ((v_month || '-01')::date + interval '1 month' - interval '1 day')::date;
  v_unpaid text := CASE WHEN p_ctx ->> 'chargeMode' = 'manual' AND v_month_end < v_today THEN 'vencido' ELSE 'programado' END;
  v_status text;
  v_amount bigint;
  v_adjust bigint;
  v_drift bigint;
  v_cur_drift bigint;
  v_open boolean;
BEGIN
  IF p_existing IS NULL OR jsonb_typeof(p_existing) = 'null' THEN
    IF v_total <= 0 THEN
      RETURN jsonb_build_object('kind', 'none');
    END IF;
    RETURN jsonb_build_object('kind', 'create', 'amountCents', v_total, 'status', v_unpaid, 'scheduledDate', v_month_end::text);
  END IF;

  v_status := p_existing ->> 'status';
  v_amount := (p_existing ->> 'amountCents')::bigint;

  IF v_status = 'anulado' THEN
    IF p_existing ->> 'voidKind' = 'auto_zero' AND v_total > 0 THEN
      RETURN jsonb_build_object('kind', 'reactivate', 'amountCents', v_total, 'status', v_unpaid);
    END IF;
    RETURN jsonb_build_object('kind', 'none');
  END IF;

  IF v_status = 'pagado' THEN
    SELECT COALESCE(sum(x::bigint), 0) INTO v_adjust FROM jsonb_array_elements_text(COALESCE(p_existing -> 'adjustmentsCents', '[]'::jsonb)) AS x;
    v_drift := v_total - (v_amount + v_adjust);
    v_cur_drift := (p_existing ->> 'driftCents')::bigint;
    IF v_drift = 0 THEN
      v_open := v_cur_drift IS NOT NULL AND v_cur_drift <> 0 AND NOT COALESCE((p_existing ->> 'driftResolved')::boolean, false);
      RETURN CASE WHEN v_open THEN jsonb_build_object('kind', 'clear_drift') ELSE jsonb_build_object('kind', 'none') END;
    END IF;
    IF v_cur_drift IS NOT NULL AND v_cur_drift = v_drift THEN
      RETURN jsonb_build_object('kind', 'none');
    END IF;
    RETURN jsonb_build_object('kind', 'mark_drift', 'driftCents', v_drift);
  END IF;

  -- programado, vencido o por_revisar
  IF v_total <= 0 THEN
    RETURN jsonb_build_object('kind', 'void_zero', 'voidKind', 'auto_zero');
  END IF;
  IF v_amount <> v_total THEN
    RETURN jsonb_build_object('kind', 'update_amount', 'amountCents', v_total);
  END IF;
  RETURN jsonb_build_object('kind', 'none');
END;
$$;

REVOKE ALL ON FUNCTION public.decide_auto_expense_action(jsonb, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_auto_expense_action(jsonb, bigint, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_auto_expense(
  p_workspace uuid,
  p_auto_key text,
  p_origin text,
  p_total_cents bigint,
  p_concept text,
  p_month text,
  p_vendor_id uuid,
  p_category_key text,
  p_charge_mode text,
  p_source_ref jsonb,
  p_today date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.expenses%ROWTYPE;
  v_existing jsonb;
  v_ctx jsonb := jsonb_build_object('todayLocal', p_today::text, 'month', p_month, 'chargeMode', p_charge_mode);
  v_action jsonb;
  v_kind text;
  v_reason text;
  v_new_id uuid;
BEGIN
  IF p_origin NOT IN ('processor_fee', 'meta_ads') THEN
    RAISE EXCEPTION 'origen invalido para un gasto automatico: %', p_origin;
  END IF;

  -- Un candado por clave: «FOR UPDATE» no bloquea una fila que todavia no existe, y dos corridas a la vez
  -- no deben crear dos gastos.
  PERFORM pg_advisory_xact_lock(hashtextextended('upsert_auto_expense:' || p_workspace::text || ':' || p_auto_key, 0));

  SELECT * INTO v_row FROM public.expenses WHERE workspace_id = p_workspace AND auto_key = p_auto_key FOR UPDATE;

  IF FOUND THEN
    v_existing := jsonb_build_object(
      'status', v_row.status,
      'amountCents', round(v_row.amount * 100)::bigint,
      'voidKind', v_row.void_kind,
      'driftCents', CASE WHEN v_row.auto_drift_amount IS NULL THEN NULL ELSE round(v_row.auto_drift_amount * 100)::bigint END,
      'driftResolved', v_row.auto_drift_resolved_at IS NOT NULL,
      'adjustmentsCents', COALESCE((
        SELECT jsonb_agg(round(a.amount * 100)::bigint ORDER BY a.created_at, a.id)
          FROM public.expenses a
         WHERE a.adjusts_expense_id = v_row.id AND a.status <> 'anulado'
      ), '[]'::jsonb)
    );
  END IF;

  v_action := public.decide_auto_expense_action(v_existing, p_total_cents, v_ctx);
  v_kind := v_action ->> 'kind';

  IF v_kind = 'create' THEN
    INSERT INTO public.expenses (
      workspace_id, concept, vendor_id, category_key, amount, status, scheduled_date, origin, auto_key, source_ref
    ) VALUES (
      p_workspace, p_concept, p_vendor_id, p_category_key, ((v_action ->> 'amountCents')::bigint)::numeric / 100,
      v_action ->> 'status', (v_action ->> 'scheduledDate')::date, p_origin, p_auto_key, p_source_ref
    ) RETURNING id INTO v_new_id;
    RETURN jsonb_build_object('action', 'create', 'expense_id', v_new_id, 'amount_cents', (v_action ->> 'amountCents')::bigint);

  ELSIF v_kind = 'update_amount' THEN
    UPDATE public.expenses SET amount = ((v_action ->> 'amountCents')::bigint)::numeric / 100, source_ref = p_source_ref WHERE id = v_row.id;
    RETURN jsonb_build_object('action', 'update_amount', 'expense_id', v_row.id, 'previous_amount_cents', round(v_row.amount * 100)::bigint, 'amount_cents', (v_action ->> 'amountCents')::bigint);

  ELSIF v_kind = 'void_zero' THEN
    v_reason := CASE WHEN p_origin = 'processor_fee' THEN 'La comisión del mes quedó en cero' ELSE 'La pauta del mes quedó en cero' END;
    UPDATE public.expenses
       SET status = 'anulado', void_reason = v_reason, void_kind = 'auto_zero', voided_at = now(), source_ref = p_source_ref
     WHERE id = v_row.id;
    RETURN jsonb_build_object('action', 'void_zero', 'expense_id', v_row.id);

  ELSIF v_kind = 'reactivate' THEN
    UPDATE public.expenses
       SET status = v_action ->> 'status', amount = ((v_action ->> 'amountCents')::bigint)::numeric / 100,
           void_reason = NULL, void_kind = NULL, voided_at = NULL, voided_by = NULL, source_ref = p_source_ref
     WHERE id = v_row.id;
    RETURN jsonb_build_object('action', 'reactivate', 'expense_id', v_row.id, 'amount_cents', (v_action ->> 'amountCents')::bigint);

  ELSIF v_kind = 'mark_drift' THEN
    UPDATE public.expenses
       SET auto_drift_amount = ((v_action ->> 'driftCents')::bigint)::numeric / 100, auto_drift_detected_at = now(), auto_drift_resolved_at = NULL
     WHERE id = v_row.id;
    RETURN jsonb_build_object('action', 'mark_drift', 'expense_id', v_row.id, 'drift_cents', (v_action ->> 'driftCents')::bigint);

  ELSIF v_kind = 'clear_drift' THEN
    UPDATE public.expenses SET auto_drift_amount = NULL, auto_drift_detected_at = NULL, auto_drift_resolved_at = NULL WHERE id = v_row.id;
    RETURN jsonb_build_object('action', 'clear_drift', 'expense_id', v_row.id);
  END IF;

  RETURN jsonb_build_object('action', 'none', 'expense_id', v_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_auto_expense(uuid, text, text, bigint, text, text, uuid, text, text, jsonb, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_auto_expense(uuid, text, text, bigint, text, text, uuid, text, text, jsonb, date) TO service_role;
