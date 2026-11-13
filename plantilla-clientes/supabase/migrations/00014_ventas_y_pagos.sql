-- ============================================================================
-- Ventas, pagos y afiliados
--
-- Las ventas y sus pagos (la plata en centimos, siempre USD), el estado de la venta
-- derivado de sus pagos, la comision del procesador congelada al cobrar, los eventos de
-- automatizacion por cada cambio, los links de cada producto y los afiliados (la asignacion
-- sale solo del link o de una persona con permiso). Las escribe solo el servidor; la app lee
-- con las reglas de acceso (can_see_sale).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sales (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  product_snapshot jsonb NOT NULL,
  base_amount numeric(12,2) NOT NULL,
  discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
  final_amount numeric(12,2) NOT NULL,
  discount_reason text,
  currency text DEFAULT 'USD'::text NOT NULL,
  status text NOT NULL,
  financing_type text NOT NULL,
  subscription_interval text,
  sale_date date NOT NULL,
  setter_id uuid,
  vendedor_id uuid,
  attribution jsonb,
  attribution_touch_id uuid,
  attribution_type text DEFAULT 'none'::text NOT NULL,
  booking_id uuid,
  service_starts_at date,
  notes text,
  plan_unbalanced boolean DEFAULT false NOT NULL,
  cancelled_at timestamp with time zone,
  cancelled_by uuid,
  cancellation_reason text,
  subscription_cancelled_at timestamp with time zone,
  subscription_cancel_reason text,
  refunded_at timestamp with time zone,
  opportunity_stage text,
  stage_entered_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  product_variant_id uuid NOT NULL,
  affiliate_user_id uuid,
  affiliate_contact_id uuid,
  affiliate_kind text,
  CONSTRAINT sales_pkey PRIMARY KEY (id),
  CONSTRAINT sales_affiliate_kind_check CHECK (((affiliate_kind IS NULL) OR (affiliate_kind = ANY (ARRAY['originated'::text, 'influenced'::text])))),
  CONSTRAINT sales_affiliate_not_buyer CHECK (((affiliate_contact_id IS NULL) OR (affiliate_contact_id <> contact_id))),
  CONSTRAINT sales_affiliate_one CHECK ((num_nonnulls(affiliate_user_id, affiliate_contact_id) <= 1)),
  CONSTRAINT sales_amounts_check CHECK (((base_amount >= (0)::numeric) AND (discount_amount >= (0)::numeric) AND (final_amount = (base_amount - discount_amount)) AND (final_amount >= (0)::numeric))),
  CONSTRAINT sales_attribution_none_check CHECK (((attribution_type = 'none'::text) = (attribution IS NULL))),
  CONSTRAINT sales_attribution_type_check CHECK ((attribution_type = ANY (ARRAY['last_touch'::text, 'manual'::text, 'none'::text]))),
  CONSTRAINT sales_currency_check CHECK ((currency = 'USD'::text)),
  CONSTRAINT sales_financing_check CHECK ((financing_type = ANY (ARRAY['full'::text, 'reservation_balance'::text, 'installments'::text, 'reservation_installments'::text, 'subscription'::text]))),
  CONSTRAINT sales_interval_check CHECK ((((financing_type = 'subscription'::text) AND (subscription_interval IS NOT NULL) AND (subscription_interval = ANY (ARRAY['monthly'::text, 'quarterly'::text, 'yearly'::text]))) OR ((financing_type <> 'subscription'::text) AND (subscription_interval IS NULL)))),
  CONSTRAINT sales_status_check CHECK ((status = ANY (ARRAY['pending_payment'::text, 'reserved'::text, 'paid'::text, 'overdue'::text, 'subscription_active'::text, 'cancelled'::text, 'refunded'::text, 'disputed'::text, 'subscription_cancelled'::text]))),
  CONSTRAINT sales_affiliate_contact_id_fkey FOREIGN KEY (affiliate_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT sales_affiliate_user_id_fkey FOREIGN KEY (affiliate_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT sales_attribution_touch_id_fkey FOREIGN KEY (attribution_touch_id) REFERENCES public.contact_touches(id) ON DELETE SET NULL,
  CONSTRAINT sales_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL,
  CONSTRAINT sales_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT sales_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE RESTRICT,
  CONSTRAINT sales_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT sales_product_variant_id_fkey FOREIGN KEY (product_variant_id) REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  CONSTRAINT sales_setter_id_fkey FOREIGN KEY (setter_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT sales_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT sales_vendedor_id_fkey FOREIGN KEY (vendedor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT sales_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.sales IS 'Ventas (Etapa 5, 00162). Nada se borra: se cancelan. La atribucion es una COPIA CONGELADA del toque (no cambia cuando el contacto recibe toques nuevos).';
COMMENT ON COLUMN public.sales.attribution IS 'Copia congelada del toque: {touch_id, occurred_at, source, medium, campaign, content, term, ad_id, ..., extras}. NULL si attribution_type = none.';
COMMENT ON COLUMN public.sales.service_starts_at IS 'Reservada para CX: en esta fase solo se carga y se edita.';
COMMENT ON COLUMN public.sales.opportunity_stage IS 'Reservada sin uso (pipeline futuro).';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.sales FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  type text NOT NULL,
  amount numeric(12,2) NOT NULL,
  currency text DEFAULT 'USD'::text NOT NULL,
  status text NOT NULL,
  due_date date,
  original_due_date date,
  reschedule_count integer DEFAULT 0 NOT NULL,
  paid_at timestamp with time zone,
  paid_on date,
  delay_days integer GENERATED ALWAYS AS ((paid_on - original_due_date)) STORED,
  payment_method text,
  payment_option_snapshot jsonb,
  provider_fee_amount numeric(12,2),
  receipt_path text,
  notes text,
  reschedule_reason text,
  uncollectible_reason text,
  refund_reason text,
  revert_reason text,
  refund_of_payment_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  provider_fee_percent numeric(6,3),
  provider_fee_fixed numeric(12,2),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_amount_sign_check CHECK ((((type = 'refund'::text) AND (amount < (0)::numeric)) OR ((type <> 'refund'::text) AND (amount > (0)::numeric)))),
  CONSTRAINT payments_currency_check CHECK ((currency = 'USD'::text)),
  CONSTRAINT payments_fee_only_paid_check CHECK (((status = 'paid'::text) OR (provider_fee_amount IS NULL))),
  CONSTRAINT payments_fee_spec_only_paid_check CHECK (((status = 'paid'::text) OR ((provider_fee_percent IS NULL) AND (provider_fee_fixed IS NULL)))),
  CONSTRAINT payments_no_refunded_status_phase1 CHECK ((status <> 'refunded'::text)),
  CONSTRAINT payments_paid_fields_check CHECK (((status <> 'paid'::text) OR ((paid_at IS NOT NULL) AND (paid_on IS NOT NULL)))),
  CONSTRAINT payments_refund_fee_check CHECK (((type <> 'refund'::text) OR (provider_fee_amount IS NULL) OR (provider_fee_amount = (0)::numeric))),
  CONSTRAINT payments_refund_fee_spec_check CHECK (((type <> 'refund'::text) OR ((provider_fee_percent IS NULL) AND (provider_fee_fixed IS NULL)))),
  CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'paid'::text, 'overdue'::text, 'uncollectible'::text, 'refunded'::text, 'cancelled'::text]))),
  CONSTRAINT payments_type_check CHECK ((type = ANY (ARRAY['full'::text, 'reservation'::text, 'installment'::text, 'refund'::text]))),
  CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT payments_refund_of_payment_id_fkey FOREIGN KEY (refund_of_payment_id) REFERENCES public.payments(id) ON DELETE SET NULL,
  CONSTRAINT payments_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE RESTRICT,
  CONSTRAINT payments_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT payments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.payments IS 'Pagos de una venta (00162). Un reembolso es OTRA fila (type refund, monto negativo, status paid): el pago original no cambia de estado.';
COMMENT ON COLUMN public.payments.paid_on IS 'Fecha LOCAL del cobro (en la zona del workspace), escrita por el servidor junto con paid_at. delay_days se calcula sobre ella.';
COMMENT ON COLUMN public.payments.provider_fee_amount IS 'Comision del proveedor CONGELADA al cobrar. La suma Gastos por metodo y por mes (indice abajo).';
COMMENT ON COLUMN public.payments.provider_fee_percent IS 'Porcentaje del procesador con el que se calculo la comision al cobrar (congelado).';
COMMENT ON COLUMN public.payments.provider_fee_fixed IS 'Fijo en USD del procesador con el que se calculo la comision al cobrar (congelado).';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.payments FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.affiliates_daily()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT c.id, c.workspace_id, c.affiliate_user_id, c.affiliate_contact_id, c.affiliate_kind, c.affiliate_expires_at
      FROM public.contacts c
     WHERE c.affiliate_expires_at IS NOT NULL AND c.affiliate_expires_at < now()
       AND (c.affiliate_user_id IS NOT NULL OR c.affiliate_contact_id IS NOT NULL)
     ORDER BY c.affiliate_expires_at
     LIMIT 2000
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM set_config('app.affiliates_internal', 'on', true);
      UPDATE public.contacts SET affiliate_user_id = NULL, affiliate_contact_id = NULL, affiliate_kind = NULL,
             affiliate_assigned_at = NULL, affiliate_expires_at = NULL, affiliate_source = NULL
       WHERE id = r.id;
      PERFORM set_config('app.affiliates_internal', 'off', true);
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (r.workspace_id, 'contact', r.id, 'affiliate.expired',
              jsonb_build_object('affiliate', jsonb_build_object('old', COALESCE(r.affiliate_user_id::text, r.affiliate_contact_id::text), 'new', NULL)), 'system', 'afiliados');
      -- Una vez por contacto y vencimiento: la asignacion ya quedo vacia, la proxima corrida no la vuelve a ver.
      PERFORM public.emit_automation_event(r.workspace_id, 'affiliate_assignment_expired', r.id,
        jsonb_build_object('affiliate_type', CASE WHEN r.affiliate_user_id IS NOT NULL THEN 'user' ELSE 'contact' END,
                           'affiliate_id', COALESCE(r.affiliate_user_id::text, r.affiliate_contact_id::text), 'affiliate_kind', r.affiliate_kind));
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'affiliates_daily: %', SQLERRM;
    END;
  END LOOP;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION private.affiliates_daily() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.affiliates_daily() TO service_role;

CREATE OR REPLACE FUNCTION private.enqueue_meta_capi_purchase()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_event_id uuid;
BEGIN
  BEGIN
    IF NEW.status = 'paid' AND NEW.type <> 'refund' AND COALESCE(NEW.amount, 0) > 0
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid')
       AND EXISTS (
         SELECT 1 FROM public.integration_configs ic
          WHERE ic.workspace_id = NEW.workspace_id
            AND ic.type = 'meta'
            AND ic.provider = 'meta_capi'
            AND ic.is_active
            AND COALESCE(ic.config ->> 'pixel_id', '') <> ''
            AND ic.config ->> 'purchase_enabled' = 'true'
       ) THEN
      INSERT INTO public.meta_capi_events (workspace_id, event_name, event_id, source_type, source_id, event_time, params)
      VALUES (NEW.workspace_id, 'Purchase', 'payment.' || NEW.id::text, 'payment', NEW.id, COALESCE(NEW.paid_at, now()),
              jsonb_build_object('value', NEW.amount, 'currency', NEW.currency))
      ON CONFLICT (workspace_id, event_name, event_id) DO NOTHING
      RETURNING id INTO v_event_id;

      IF v_event_id IS NOT NULL THEN
        INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
        VALUES ('meta_capi_send', jsonb_build_object('eventLogId', v_event_id, 'attempt', 1), now(), 'meta_capi:' || v_event_id::text)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_meta_capi_purchase: no pude encolar el pago %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.enqueue_meta_capi_purchase() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.enqueue_payments_overdue_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws record;
  v_local timestamp;
  v_day date;
  v_enqueued integer := 0;
BEGIN
  FOR v_ws IN
    SELECT w.id, COALESCE(w.timezone, 'UTC') AS tz, COALESCE(w.overdue_grace_days, 0) AS grace
    FROM public.workspaces w
  LOOP
    BEGIN
      v_local := now() AT TIME ZONE v_ws.tz;
      v_day := v_local::date;

      -- Antes de las 03:00 locales no se encola nada.
      CONTINUE WHEN extract(hour FROM v_local) < 3;

      -- Sin pagos candidatos no hay trabajo que dejar.
      CONTINUE WHEN NOT EXISTS (
        SELECT 1
        FROM public.payments p
        JOIN public.sales s ON s.id = p.sale_id
        WHERE p.workspace_id = v_ws.id
          AND p.status = 'scheduled'
          AND p.due_date IS NOT NULL
          AND p.due_date < v_day - v_ws.grace
          AND s.status NOT IN ('cancelled', 'refunded', 'disputed', 'subscription_cancelled')
      );

      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES (
        'payments_overdue_sweep',
        jsonb_build_object('workspace_id', v_ws.id, 'local_date', v_day::text),
        now(),
        'overdue:' || v_ws.id::text || ':' || v_day::text
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_payments_overdue_sweep: no pude encolar el workspace %: %', v_ws.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_enqueued;
END;
$function$;
REVOKE ALL ON FUNCTION private.enqueue_payments_overdue_sweep() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.payments_fee_spec_from_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Fuera de un cobro (o en un reembolso) el porcentaje y el fijo no existen.
  IF NEW.status <> 'paid' OR NEW.type = 'refund' THEN
    NEW.provider_fee_percent := NULL;
    NEW.provider_fee_fixed := NULL;
    RETURN NEW;
  END IF;

  -- Cobrado y sin los dos valores: salen de la foto del metodo al cobrar.
  IF NEW.provider_fee_percent IS NULL AND NEW.provider_fee_fixed IS NULL AND NEW.payment_option_snapshot IS NOT NULL THEN
    NEW.provider_fee_percent := NULLIF(NEW.payment_option_snapshot ->> 'provider_fee_percent', '')::numeric;
    NEW.provider_fee_fixed := NULLIF(NEW.payment_option_snapshot ->> 'provider_fee_fixed', '')::numeric;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Esto nunca tumba un cobro: sin los dos valores, el pago sigue valido (solo falta el desglose).
  RAISE WARNING 'payments_fee_spec_from_snapshot: %', SQLERRM;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.payments_fee_spec_from_snapshot() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.payments_mark_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM 'paid' OR coalesce(NEW.amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'paid' THEN
    RETURN NULL;
  END IF;

  BEGIN
    UPDATE public.contacts ct
    SET is_customer = true,
        customer_marked_by = NULL,
        customer_marked_at = now(),
        customer_source = 'sale'
    FROM public.sales s
    WHERE s.id = NEW.sale_id
      AND ct.id = s.contact_id
      AND ct.workspace_id = NEW.workspace_id
      AND ct.deleted_at IS NULL
      AND NOT ct.is_customer;
  EXCEPTION WHEN OTHERS THEN
    -- Marcar al cliente nunca puede costar el pago.
    RAISE WARNING 'payments_mark_customer: no pude marcar al cliente del pago %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.payments_mark_customer() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.payments_validate_method()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.payment_method IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.workspaces w, jsonb_array_elements(w.payment_methods) AS m
     WHERE w.id = NEW.workspace_id
       AND m ->> 'key' = NEW.payment_method
  ) THEN
    RAISE EXCEPTION 'El metodo de pago % no existe en este negocio', NEW.payment_method
      USING ERRCODE = 'PM001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.payments_validate_method() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.ads_crm_metrics(p_level text, p_since date, p_until date, p_ad_account_id text DEFAULT NULL::text, p_workspace_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(object_id text, leads_first integer, leads_total integer, leads_with_booking integer, bookings integer, bookings_attended integer, sales integer, revenue_cents bigint, cash_cents bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_col       text;
  v_cat_table text;
  v_cat_col   text;
  v_tz        text;
  v_lo        timestamptz;
  v_hi        timestamptz;
  v_sql       text;
BEGIN
  v_col := CASE p_level
    WHEN 'campaign' THEN 'meta_campaign_id'
    WHEN 'adset'    THEN 'meta_adset_id'
    WHEN 'ad'       THEN 'meta_ad_id'
  END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'ads_crm_metrics: nivel invalido (%)', p_level USING ERRCODE = '22023';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until < p_since THEN
    RAISE EXCEPTION 'ads_crm_metrics: rango de fechas invalido' USING ERRCODE = '22023';
  END IF;
  IF p_workspace_id IS NULL THEN
    RETURN;
  END IF;

  -- El workspace tiene que ser visible para quien llama (RLS); si no, no hay nada que mostrar.
  SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');

  -- Las fechas civiles del workspace, a un rango UTC [desde, hasta).
  v_lo := p_since::timestamp AT TIME ZONE v_tz;
  v_hi := (p_until + 1)::timestamp AT TIME ZONE v_tz;

  v_cat_table := CASE p_level WHEN 'campaign' THEN 'meta_campaigns' WHEN 'adset' THEN 'meta_adsets' ELSE 'meta_ads' END;
  v_cat_col   := CASE p_level WHEN 'campaign' THEN 'campaign_id'    WHEN 'adset' THEN 'adset_id'    ELSE 'ad_id' END;

  -- La columna del nivel sale de una lista fija (nunca del pedido): %I la cita como identificador.
  v_sql := format($q$
    WITH
    first_leads AS (
      SELECT c.attribution -> 'first_touch' ->> %1$L AS obj, count(*)::int AS n
        FROM public.contacts c
       WHERE c.workspace_id = $1 AND c.deleted_at IS NULL
         AND c.created_at >= $2 AND c.created_at < $3
         AND c.attribution -> 'first_touch' ->> %1$L IS NOT NULL
       GROUP BY 1
    ),
    total_leads AS (
      SELECT t.%2$I AS obj, count(DISTINCT t.contact_id)::int AS n
        FROM public.contact_touches t
        JOIN public.contacts c ON c.id = t.contact_id AND c.deleted_at IS NULL
       WHERE t.workspace_id = $1 AND t.%2$I IS NOT NULL
         AND t.occurred_at >= $2 AND t.occurred_at < $3
       GROUP BY 1
    ),
    bk AS (
      SELECT b.id, b.contact_id, b.status_group,
             coalesce(
               (SELECT t.%2$I FROM public.contact_touches t
                 WHERE t.workspace_id = $1 AND t.dedupe_key = 'booking:' || b.id::text AND t.%2$I IS NOT NULL
                 LIMIT 1),
               (SELECT t.%2$I FROM public.contact_touches t
                 WHERE t.contact_id = b.contact_id AND t.%2$I IS NOT NULL AND t.occurred_at <= b.created_at
                 ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
                 LIMIT 1)
             ) AS obj
        FROM public.bookings b
       WHERE b.workspace_id = $1 AND b.created_at >= $2 AND b.created_at < $3
         AND b.slot_released_at IS NULL
    ),
    booking_agg AS (
      SELECT obj,
             count(*)::int AS bookings,
             (count(*) FILTER (WHERE status_group = 'outcome'))::int AS attended,
             count(DISTINCT contact_id)::int AS leads
        FROM bk WHERE obj IS NOT NULL GROUP BY obj
    ),
    sale_agg AS (
      SELECT t.%2$I AS obj,
             count(*)::int AS sales,
             coalesce(sum(round(s.final_amount * 100)), 0)::bigint AS revenue
        FROM public.sales s
        JOIN public.contact_touches t ON t.id = s.attribution_touch_id
       WHERE s.workspace_id = $1 AND s.sale_date >= $4 AND s.sale_date <= $5
         AND s.status NOT IN ('cancelled', 'refunded')
         AND t.%2$I IS NOT NULL
       GROUP BY 1
    ),
    cash_agg AS (
      SELECT t.%2$I AS obj, coalesce(sum(round(p.amount * 100)), 0)::bigint AS cash
        FROM public.payments p
        JOIN public.sales s ON s.id = p.sale_id
        JOIN public.contact_touches t ON t.id = s.attribution_touch_id
       WHERE p.workspace_id = $1 AND p.status = 'paid'
         AND p.paid_on >= $4 AND p.paid_on <= $5
         AND t.%2$I IS NOT NULL
       GROUP BY 1
    ),
    objs AS (
      SELECT obj FROM first_leads UNION SELECT obj FROM total_leads UNION SELECT obj FROM booking_agg
      UNION SELECT obj FROM sale_agg UNION SELECT obj FROM cash_agg
    )
    SELECT o.obj,
           coalesce(f.n, 0), coalesce(tl.n, 0), coalesce(ba.leads, 0),
           coalesce(ba.bookings, 0), coalesce(ba.attended, 0),
           coalesce(sa.sales, 0), coalesce(sa.revenue, 0)::bigint, coalesce(ca.cash, 0)::bigint
      FROM objs o
      LEFT JOIN first_leads f ON f.obj = o.obj
      LEFT JOIN total_leads tl ON tl.obj = o.obj
      LEFT JOIN booking_agg ba ON ba.obj = o.obj
      LEFT JOIN sale_agg sa ON sa.obj = o.obj
      LEFT JOIN cash_agg ca ON ca.obj = o.obj
     WHERE $6::text IS NULL OR o.obj IN (
             SELECT x.%3$I FROM public.%4$I x WHERE x.workspace_id = $1 AND x.ad_account_id = $6
           )
     ORDER BY o.obj
  $q$, v_col, v_col, v_cat_col, v_cat_table);

  RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.ads_crm_metrics(p_level text, p_since date, p_until date, p_ad_account_id text, p_workspace_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.affiliate_assign_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  s jsonb := CASE WHEN jsonb_typeof(p -> 'settings') = 'object' THEN p -> 'settings' ELSE '{}'::jsonb END;
  v_months integer := CASE WHEN (s -> 'originated') ? 'months' THEN NULLIF(s #>> '{originated,months}', '')::integer ELSE 12 END;
  v_orig_replace text := COALESCE(s #>> '{originated,replace}', 'keep');
  v_days integer := COALESCE((s #>> '{influenced,days}')::integer, 90);
  v_renew boolean := COALESCE((s #>> '{influenced,renew_on_click}')::boolean, true);
  v_infl_replace text := COALESCE(s #>> '{influenced,replace}', 'keep');
  v_ref jsonb := CASE WHEN jsonb_typeof(p -> 'ref') = 'object' THEN p -> 'ref' ELSE NULL END;
  v_cur jsonb := CASE WHEN jsonb_typeof(p -> 'current') = 'object' THEN p -> 'current' ELSE NULL END;
  v_touched timestamptz := (p ->> 'touchedAt')::timestamptz;
  v_now timestamptz := (p ->> 'now')::timestamptz;
  v_kind text;
  v_rule text;
  v_fmt text := 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
BEGIN
  IF v_ref IS NULL THEN RETURN jsonb_build_object('action', 'none', 'reason', 'no_code'); END IF;
  IF v_ref ->> 'type' = 'contact' AND v_ref ->> 'id' = p ->> 'contactId' THEN RETURN jsonb_build_object('action', 'none', 'reason', 'own_code'); END IF;
  IF COALESCE((p ->> 'isCustomer')::boolean, false) THEN RETURN jsonb_build_object('action', 'none', 'reason', 'customer'); END IF;
  v_kind := CASE WHEN COALESCE((p ->> 'isFirstTouch')::boolean, false) AND (p ->> 'contactCreatedAt')::timestamptz >= v_touched - interval '10 minutes'
                 THEN 'originated' ELSE 'influenced' END;
  IF v_cur IS NOT NULL AND jsonb_typeof(v_cur -> 'expiresAt') <> 'null' AND (v_cur ->> 'expiresAt')::timestamptz < v_now THEN
    v_cur := NULL;
  END IF;
  IF v_cur IS NULL THEN
    RETURN jsonb_build_object('action', 'assign', 'kind', v_kind, 'expiresAt',
      CASE WHEN v_kind = 'originated' THEN
             CASE WHEN v_months IS NULL THEN NULL ELSE to_jsonb(to_char((v_touched + make_interval(months => v_months)) AT TIME ZONE 'UTC', v_fmt)) END
           ELSE to_jsonb(to_char((v_touched + make_interval(days => v_days)) AT TIME ZONE 'UTC', v_fmt)) END);
  END IF;
  IF v_cur #>> '{affiliate,type}' = v_ref ->> 'type' AND v_cur #>> '{affiliate,id}' = v_ref ->> 'id' THEN
    IF v_cur ->> 'kind' = 'influenced' AND v_renew THEN
      RETURN jsonb_build_object('action', 'renew', 'expiresAt', to_char((v_touched + make_interval(days => v_days)) AT TIME ZONE 'UTC', v_fmt));
    END IF;
    RETURN jsonb_build_object('action', 'touch', 'reason', 'same_affiliate');
  END IF;
  v_rule := CASE WHEN v_cur ->> 'kind' = 'originated' THEN v_orig_replace ELSE v_infl_replace END;
  IF v_rule = 'keep' THEN RETURN jsonb_build_object('action', 'none', 'reason', 'keep'); END IF;
  IF v_rule = 'last_if_not_bought' AND COALESCE((p ->> 'hasSale')::boolean, false) THEN RETURN jsonb_build_object('action', 'none', 'reason', 'bought'); END IF;
  RETURN jsonb_build_object('action', 'replace', 'kind', 'influenced', 'expiresAt', to_char((v_touched + make_interval(days => v_days)) AT TIME ZONE 'UTC', v_fmt));
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_assign_plan(p jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.affiliate_assign(p_contact_id uuid, p_code text, p_touched_at timestamp with time zone, p_touch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  c public.contacts;
  v_ref jsonb;
  v_settings jsonb;
  v_plan jsonb;
  v_first boolean;
  v_has_sale boolean;
  v_customer boolean;
  v_action text;
BEGIN
  SELECT * INTO c FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF c.id IS NULL OR c.deleted_at IS NOT NULL OR p_code IS NULL OR p_code !~* '^[a-z0-9]{4,24}$' THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'no_code');
  END IF;
  v_ref := public.affiliate_by_code(c.workspace_id, p_code);
  SELECT w.affiliate_settings INTO v_settings FROM public.workspaces w WHERE w.id = c.workspace_id;
  v_first := NOT EXISTS (SELECT 1 FROM public.contact_touches t WHERE t.contact_id = c.id AND t.id <> COALESCE(p_touch_id, gen_random_uuid())
                           AND (t.occurred_at < p_touched_at OR (t.occurred_at = p_touched_at AND t.created_at < now())));
  v_has_sale := EXISTS (SELECT 1 FROM public.sales s WHERE s.contact_id = c.id AND s.status NOT IN ('cancelled'));
  v_customer := COALESCE(c.is_customer, false) OR EXISTS (
    SELECT 1 FROM public.payments pm JOIN public.sales s ON s.id = pm.sale_id
     WHERE s.contact_id = c.id AND pm.status = 'paid' AND pm.amount > 0 AND pm.paid_at < p_touched_at);
  v_plan := public.affiliate_assign_plan(jsonb_build_object(
    'settings', COALESCE(v_settings, '{}'::jsonb), 'ref', v_ref, 'contactId', c.id, 'touchedAt', p_touched_at,
    'contactCreatedAt', c.created_at, 'isFirstTouch', v_first, 'isCustomer', v_customer, 'hasSale', v_has_sale, 'now', now(),
    'current', CASE WHEN c.affiliate_user_id IS NULL AND c.affiliate_contact_id IS NULL THEN NULL ELSE jsonb_build_object(
      'affiliate', CASE WHEN c.affiliate_user_id IS NOT NULL THEN jsonb_build_object('type', 'user', 'id', c.affiliate_user_id)
                        ELSE jsonb_build_object('type', 'contact', 'id', c.affiliate_contact_id) END,
      'kind', c.affiliate_kind, 'assignedAt', c.affiliate_assigned_at, 'expiresAt', c.affiliate_expires_at) END));
  v_action := v_plan ->> 'action';
  IF v_action = 'none' THEN RETURN v_plan; END IF;
  PERFORM set_config('app.affiliates_internal', 'on', true);
  IF v_action IN ('assign', 'replace') THEN
    UPDATE public.contacts SET
      affiliate_user_id = CASE WHEN v_ref ->> 'type' = 'user' THEN (v_ref ->> 'id')::uuid END,
      affiliate_contact_id = CASE WHEN v_ref ->> 'type' = 'contact' THEN (v_ref ->> 'id')::uuid END,
      affiliate_kind = v_plan ->> 'kind',
      affiliate_assigned_at = p_touched_at,
      affiliate_expires_at = NULLIF(v_plan ->> 'expiresAt', '')::timestamptz,
      affiliate_last_ref_at = p_touched_at,
      affiliate_source = 'link'
    WHERE id = c.id;
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, actor_type, actor_label)
    VALUES (c.workspace_id, 'contact', c.id, CASE v_action WHEN 'assign' THEN 'affiliate.assigned' ELSE 'affiliate.replaced' END,
            jsonb_build_object('affiliate', jsonb_build_object('old', CASE WHEN c.affiliate_user_id IS NOT NULL THEN c.affiliate_user_id::text ELSE c.affiliate_contact_id::text END, 'new', v_ref ->> 'id')),
            jsonb_build_object('kind', v_plan ->> 'kind', 'expires_at', v_plan ->> 'expiresAt', 'touch_id', p_touch_id, 'source', 'link'), 'system', 'afiliados');
    PERFORM public.emit_automation_event(c.workspace_id, 'affiliate_lead_created', c.id,
      jsonb_build_object('affiliate_type', v_ref ->> 'type', 'affiliate_id', v_ref ->> 'id', 'affiliate_kind', v_plan ->> 'kind'));
  ELSIF v_action = 'renew' THEN
    UPDATE public.contacts SET affiliate_expires_at = (v_plan ->> 'expiresAt')::timestamptz, affiliate_last_ref_at = p_touched_at WHERE id = c.id;
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, actor_type, actor_label)
    VALUES (c.workspace_id, 'contact', c.id, 'affiliate.renewed',
            jsonb_build_object('affiliate_expires_at', jsonb_build_object('old', c.affiliate_expires_at, 'new', v_plan ->> 'expiresAt')),
            jsonb_build_object('touch_id', p_touch_id), 'system', 'afiliados');
  ELSE
    UPDATE public.contacts SET affiliate_last_ref_at = p_touched_at WHERE id = c.id;
  END IF;
  PERFORM set_config('app.affiliates_internal', 'off', true);
  RETURN v_plan;
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_assign(p_contact_id uuid, p_code text, p_touched_at timestamp with time zone, p_touch_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.affiliate_by_code(p_workspace_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object('type', 'user', 'id', m.user_id) FROM public.workspace_members m WHERE m.workspace_id = p_workspace_id AND m.affiliate_code = lower(p_code) LIMIT 1),
    (SELECT jsonb_build_object('type', 'contact', 'id', c.id) FROM public.contacts c WHERE c.workspace_id = p_workspace_id AND c.affiliate_code = lower(p_code) AND c.deleted_at IS NULL LIMIT 1));
$function$;
REVOKE ALL ON FUNCTION public.affiliate_by_code(p_workspace_id uuid, p_code text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.affiliate_codes_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Solo una funcion del sistema (la fusion de contactos) mueve un codigo; nadie lo cambia.
  IF TG_OP = 'UPDATE' AND OLD.affiliate_code IS NOT NULL AND NEW.affiliate_code IS DISTINCT FROM OLD.affiliate_code
     AND COALESCE(current_setting('app.affiliates_internal', true), '') <> 'on' THEN
    RAISE EXCEPTION 'El código de afiliado no cambia nunca.' USING ERRCODE = 'AF004';
  END IF;
  IF NEW.affiliate_code IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'contacts' THEN
    IF EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = NEW.workspace_id AND m.affiliate_code = NEW.affiliate_code) THEN
      RAISE EXCEPTION 'Ese código ya lo usa alguien del equipo.' USING ERRCODE = 'AF001';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.contacts c WHERE c.workspace_id = NEW.workspace_id AND c.affiliate_code = NEW.affiliate_code) THEN
      RAISE EXCEPTION 'Ese código ya lo usa un contacto.' USING ERRCODE = 'AF001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_codes_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.affiliate_contact_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF public.affiliate_internal() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.affiliate_code := NULL; NEW.affiliate_user_id := NULL; NEW.affiliate_contact_id := NULL; NEW.affiliate_kind := NULL;
    NEW.affiliate_assigned_at := NULL; NEW.affiliate_expires_at := NULL; NEW.affiliate_last_ref_at := NULL; NEW.affiliate_source := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.affiliate_code, NEW.affiliate_user_id, NEW.affiliate_contact_id, NEW.affiliate_kind, NEW.affiliate_assigned_at,
      NEW.affiliate_expires_at, NEW.affiliate_last_ref_at, NEW.affiliate_source)
     IS DISTINCT FROM
     (OLD.affiliate_code, OLD.affiliate_user_id, OLD.affiliate_contact_id, OLD.affiliate_kind, OLD.affiliate_assigned_at,
      OLD.affiliate_expires_at, OLD.affiliate_last_ref_at, OLD.affiliate_source) THEN
    RAISE EXCEPTION 'El afiliado se cambia desde la ficha (con su permiso).' USING ERRCODE = 'AF010';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_contact_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.affiliate_ensure_code(p_workspace_id uuid, p_kind text, p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_code text;
  v_base text;
  v_try text;
  n integer := 0;
BEGIN
  IF p_kind NOT IN ('member', 'contact') THEN RAISE EXCEPTION 'Tipo de afiliado desconocido' USING ERRCODE = 'AF002'; END IF;
  IF auth.uid() IS NOT NULL THEN
    IF p_kind = 'member' AND NOT (p_id = auth.uid() AND public.has_permission(p_workspace_id, 'affiliates.use'))
       AND NOT public.has_permission(p_workspace_id, 'affiliates.external') THEN
      RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'AF010';
    END IF;
    IF p_kind = 'contact' AND NOT public.has_permission(p_workspace_id, 'affiliates.external') THEN
      RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'AF010';
    END IF;
  END IF;
  IF p_kind = 'member' THEN
    SELECT m.affiliate_code INTO v_code FROM public.workspace_members m WHERE m.workspace_id = p_workspace_id AND m.user_id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No es del equipo' USING ERRCODE = 'AF002'; END IF;
    SELECT COALESCE(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1), 'equipo') INTO v_base FROM auth.users u WHERE u.id = p_id;
  ELSE
    SELECT c.affiliate_code, COALESCE(NULLIF(c.display_name, ''), split_part(c.email, '@', 1), 'afiliado') INTO v_code, v_base
      FROM public.contacts c WHERE c.workspace_id = p_workspace_id AND c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe el contacto' USING ERRCODE = 'AF002'; END IF;
  END IF;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  v_base := left(regexp_replace(lower(translate(COALESCE(v_base, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')), '[^a-z0-9]', '', 'g'), 12);
  IF length(v_base) < 2 THEN v_base := 'af' || v_base; END IF;
  LOOP
    n := n + 1;
    v_try := v_base || substr(md5(random()::text || clock_timestamp()::text), 1, CASE WHEN n > 20 THEN 4 ELSE 2 END);
    IF length(v_try) < 4 THEN v_try := rpad(v_try, 4, '0'); END IF;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p_workspace_id AND m.affiliate_code = v_try)
          AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.workspace_id = p_workspace_id AND c.affiliate_code = v_try);
    IF n > 60 THEN RAISE EXCEPTION 'No pude armar un código libre' USING ERRCODE = 'AF002'; END IF;
  END LOOP;
  PERFORM set_config('app.affiliates_internal', 'on', true);
  IF p_kind = 'member' THEN
    UPDATE public.workspace_members SET affiliate_code = v_try WHERE workspace_id = p_workspace_id AND user_id = p_id;
  ELSE
    UPDATE public.contacts SET affiliate_code = v_try WHERE id = p_id;
  END IF;
  PERFORM set_config('app.affiliates_internal', 'off', true);
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by)
  VALUES (p_workspace_id, CASE p_kind WHEN 'member' THEN 'workspace_member' ELSE 'contact' END, p_id, 'affiliate.code_created',
          jsonb_build_object('affiliate_code', jsonb_build_object('old', NULL, 'new', v_try)), auth.uid());
  RETURN v_try;
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_ensure_code(p_workspace_id uuid, p_kind text, p_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.affiliate_internal()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT current_user NOT IN ('authenticated', 'anon') OR COALESCE(current_setting('app.affiliates_internal', true), '') = 'on';
$function$;
REVOKE ALL ON FUNCTION public.affiliate_internal() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.affiliate_ref_of_touch(t public.contact_touches)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT lower(COALESCE(
    substring(t.entry_url from '[?&]ref=([A-Za-z0-9]{4,24})(?:[&#]|$)'),
    NULLIF(t.raw #>> '{utm,ref}', ''),
    NULLIF(t.raw ->> 'ref', ''),
    substring(t.landing_page from '[?&]ref=([A-Za-z0-9]{4,24})(?:[&#]|$)')));
$function$;
REVOKE ALL ON FUNCTION public.affiliate_ref_of_touch(t public.contact_touches) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.affiliate_sale_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF public.affiliate_internal() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.affiliate_user_id := NULL; NEW.affiliate_contact_id := NULL; NEW.affiliate_kind := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.affiliate_user_id, NEW.affiliate_contact_id, NEW.affiliate_kind) IS DISTINCT FROM (OLD.affiliate_user_id, OLD.affiliate_contact_id, OLD.affiliate_kind) THEN
    RAISE EXCEPTION 'El afiliado de la venta lo cambia quien tiene el permiso.' USING ERRCODE = 'AF010';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_sale_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.affiliate_set_contact(p_contact_id uuid, p_affiliate jsonb, p_kind text, p_expires_at timestamp with time zone, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  c public.contacts;
BEGIN
  SELECT * INTO c FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'No existe el contacto' USING ERRCODE = 'AF002'; END IF;
  IF auth.uid() IS NOT NULL AND NOT (public.has_permission(c.workspace_id, 'affiliates.assign') AND public.can_see_contact(c)) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'AF010';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'AF011'; END IF;
  IF p_affiliate IS NOT NULL AND (p_affiliate ->> 'type') = 'contact' AND (p_affiliate ->> 'id')::uuid = c.id THEN
    RAISE EXCEPTION 'Un contacto no puede ser su propio afiliado' USING ERRCODE = 'AF012';
  END IF;
  IF p_affiliate IS NOT NULL AND (p_affiliate ->> 'type') = 'user'
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = c.workspace_id AND m.user_id = (p_affiliate ->> 'id')::uuid) THEN
    RAISE EXCEPTION 'Esa persona no es del equipo' USING ERRCODE = 'AF002';
  END IF;
  IF p_affiliate IS NOT NULL AND (p_affiliate ->> 'type') = 'contact'
     AND NOT EXISTS (SELECT 1 FROM public.contacts x WHERE x.workspace_id = c.workspace_id AND x.id = (p_affiliate ->> 'id')::uuid AND x.affiliate_code IS NOT NULL) THEN
    RAISE EXCEPTION 'Ese contacto no es afiliado' USING ERRCODE = 'AF002';
  END IF;
  PERFORM set_config('app.affiliates_internal', 'on', true);
  UPDATE public.contacts SET
    affiliate_user_id = CASE WHEN p_affiliate ->> 'type' = 'user' THEN (p_affiliate ->> 'id')::uuid END,
    affiliate_contact_id = CASE WHEN p_affiliate ->> 'type' = 'contact' THEN (p_affiliate ->> 'id')::uuid END,
    affiliate_kind = CASE WHEN p_affiliate IS NULL THEN NULL ELSE COALESCE(p_kind, 'influenced') END,
    affiliate_assigned_at = CASE WHEN p_affiliate IS NULL THEN NULL ELSE now() END,
    affiliate_expires_at = CASE WHEN p_affiliate IS NULL THEN NULL ELSE p_expires_at END,
    affiliate_source = CASE WHEN p_affiliate IS NULL THEN NULL ELSE 'manual' END
  WHERE id = c.id;
  PERFORM set_config('app.affiliates_internal', 'off', true);
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (c.workspace_id, 'contact', c.id, CASE WHEN p_affiliate IS NULL THEN 'affiliate.removed' ELSE 'affiliate.assigned' END,
          jsonb_build_object('affiliate', jsonb_build_object('old', COALESCE(c.affiliate_user_id::text, c.affiliate_contact_id::text), 'new', p_affiliate ->> 'id')),
          jsonb_build_object('reason', btrim(p_reason), 'kind', p_kind, 'expires_at', p_expires_at, 'source', 'manual'), auth.uid());
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_set_contact(p_contact_id uuid, p_affiliate jsonb, p_kind text, p_expires_at timestamp with time zone, p_reason text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.affiliate_set_sale(p_sale_id uuid, p_affiliate jsonb, p_kind text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s public.sales;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'No existe la venta' USING ERRCODE = 'AF002'; END IF;
  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.has_permission(s.workspace_id, 'affiliates.assign') AND public.can_see_sale(s)) THEN
      RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'AF010';
    END IF;
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'AF011'; END IF;
  END IF;
  IF p_affiliate IS NOT NULL AND (p_affiliate ->> 'type') = 'contact' AND (p_affiliate ->> 'id')::uuid = s.contact_id THEN
    RAISE EXCEPTION 'El afiliado no puede ser el que compra' USING ERRCODE = 'AF012';
  END IF;
  PERFORM set_config('app.affiliates_internal', 'on', true);
  UPDATE public.sales SET
    affiliate_user_id = CASE WHEN p_affiliate ->> 'type' = 'user' THEN (p_affiliate ->> 'id')::uuid END,
    affiliate_contact_id = CASE WHEN p_affiliate ->> 'type' = 'contact' THEN (p_affiliate ->> 'id')::uuid END,
    affiliate_kind = CASE WHEN p_affiliate IS NULL THEN NULL ELSE COALESCE(p_kind, 'influenced') END
  WHERE id = s.id;
  PERFORM set_config('app.affiliates_internal', 'off', true);
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (s.workspace_id, 'sale', s.id, 'affiliate.sale_set',
          jsonb_build_object('affiliate', jsonb_build_object('old', COALESCE(s.affiliate_user_id::text, s.affiliate_contact_id::text), 'new', p_affiliate ->> 'id')),
          jsonb_build_object('reason', NULLIF(btrim(COALESCE(p_reason, '')), ''), 'kind', p_kind), auth.uid());
  IF p_affiliate IS NOT NULL AND s.affiliate_user_id IS NULL AND s.affiliate_contact_id IS NULL THEN
    PERFORM public.emit_automation_event(s.workspace_id, 'affiliate_sale_created', s.contact_id,
      jsonb_build_object('sale_id', s.id, 'affiliate_type', p_affiliate ->> 'type', 'affiliate_id', p_affiliate ->> 'id', 'affiliate_kind', COALESCE(p_kind, 'influenced')));
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_set_sale(p_sale_id uuid, p_affiliate jsonb, p_kind text, p_reason text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.affiliate_settings_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF public.affiliate_internal() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.affiliate_settings := '{}'::jsonb; NEW.affiliate_settings_rev := 0;
    RETURN NEW;
  END IF;
  IF NEW.affiliate_settings IS DISTINCT FROM OLD.affiliate_settings OR NEW.affiliate_settings_rev IS DISTINCT FROM OLD.affiliate_settings_rev THEN
    RAISE EXCEPTION 'Las reglas de afiliados se guardan desde Afiliados › Reglas.' USING ERRCODE = 'AF010';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_settings_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.affiliate_settings_save(p_workspace_id uuid, p_settings jsonb, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.workspaces;
  v_problems text[];
BEGIN
  SELECT * INTO v_row FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'No existe el negocio' USING ERRCODE = 'AF002'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_permission(p_workspace_id, 'affiliates.settings') THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'AF010';
  END IF;
  IF v_row.affiliate_settings_rev <> p_rev THEN
    RETURN jsonb_build_object('status', 'conflict', 'rev', v_row.affiliate_settings_rev, 'current', v_row.affiliate_settings);
  END IF;
  v_problems := public.validate_affiliate_settings(p_settings);
  IF cardinality(v_problems) > 0 THEN RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems)); END IF;
  PERFORM set_config('app.affiliates_internal', 'on', true);
  UPDATE public.workspaces SET affiliate_settings = p_settings, affiliate_settings_rev = affiliate_settings_rev + 1 WHERE id = p_workspace_id;
  PERFORM set_config('app.affiliates_internal', 'off', true);
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by)
  VALUES (p_workspace_id, 'workspace', p_workspace_id, 'affiliate.settings_saved',
          jsonb_build_object('affiliate_settings', jsonb_build_object('old', v_row.affiliate_settings, 'new', p_settings)), auth.uid());
  RETURN jsonb_build_object('status', 'ok', 'rev', v_row.affiliate_settings_rev + 1);
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_settings_save(p_workspace_id uuid, p_settings jsonb, p_rev integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.affiliate_touch_hook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_code text;
BEGIN
  BEGIN
    v_code := public.affiliate_ref_of_touch(NEW);
    IF v_code IS NOT NULL AND v_code ~ '^[a-z0-9]{4,24}$' AND NEW.contact_id IS NOT NULL THEN
      PERFORM public.affiliate_assign(NEW.contact_id, v_code, COALESCE(NEW.occurred_at, now()), NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'affiliate_touch_hook: %', SQLERRM;
    BEGIN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (NEW.workspace_id, 'contact', NEW.contact_id, 'affiliate.hook_failed', jsonb_build_object('error', left(SQLSTATE || ' ' || SQLERRM, 300)), 'system', 'afiliados');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'affiliate_touch_hook (audit): %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_touch_hook() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_see_sale(s public.sales)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.is_workspace_member(s.workspace_id)
     AND (
       public.is_workspace_admin(s.workspace_id)
       OR s.setter_id = auth.uid()
       OR s.vendedor_id = auth.uid()
       OR (
         public.has_permission(s.workspace_id, 'sales.view')
         AND public.permission_scope(s.workspace_id, 'sales') = 'all'
       )
     );
$function$;
REVOKE ALL ON FUNCTION public.can_see_sale(s public.sales) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_see_sale_id(p_sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.sales s WHERE s.id = p_sale_id AND public.can_see_sale(s));
$function$;
REVOKE ALL ON FUNCTION public.can_see_sale_id(p_sale_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.cancel_sale(p_sale_id uuid, p_reason text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s public.sales%ROWTYPE;
  v_cancelled int;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF s.status = 'cancelled' THEN RAISE EXCEPTION 'already_cancelled'; END IF;
  IF s.status IN ('refunded', 'disputed') THEN RAISE EXCEPTION 'not_editable:%', s.status; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  -- Primero la venta: `cancelled` es un estado escrito, asi que el recalculo que dispara
  -- cada pago al anularse lo respeta y no la devuelve a un estado derivado.
  UPDATE public.sales
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor_id,
         cancellation_reason = btrim(p_reason), updated_by = p_actor_id
   WHERE id = p_sale_id;

  UPDATE public.payments SET status = 'cancelled', updated_by = p_actor_id
   WHERE sale_id = p_sale_id AND status IN ('scheduled', 'overdue');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type)
  VALUES (s.workspace_id, 'sale', p_sale_id, 'sale.cancelled',
          jsonb_build_object('status', jsonb_build_object('old', s.status, 'new', 'cancelled')),
          jsonb_build_object('reason', btrim(p_reason), 'payments_cancelled', v_cancelled), p_actor_id, 'user');

  RETURN jsonb_build_object('sale_id', p_sale_id, 'payments_cancelled', v_cancelled);
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_sale(p_sale_id uuid, p_reason text, p_actor_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_sale(p_payload jsonb, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid := (p_payload ->> 'workspace_id')::uuid;
  v_contact uuid := (p_payload ->> 'contact_id')::uuid;
  v_variant_id uuid := (p_payload ->> 'product_variant_id')::uuid;
  v_base numeric := (p_payload ->> 'base_amount')::numeric;
  v_discount numeric := COALESCE((p_payload ->> 'discount_amount')::numeric, 0);
  v_final numeric := v_base - COALESCE((p_payload ->> 'discount_amount')::numeric, 0);
  v_financing text := p_payload ->> 'financing_type';
  v_payments jsonb := COALESCE(p_payload -> 'payments', '[]'::jsonb);
  v_attr_req jsonb := COALESCE(p_payload -> 'attribution', '{"mode":"last_touch"}'::jsonb);
  v_mode text;
  v_touch public.contact_touches%ROWTYPE;
  v_attribution jsonb := NULL;
  v_attr_type text := 'none';
  v_attr_touch_id uuid := NULL;
  v_variant public.product_variants%ROWTYPE;
  v_tz text;
  v_today date;
  v_sale_date date := (p_payload ->> 'sale_date')::date;
  v_booking uuid := NULLIF(p_payload ->> 'booking_id', '')::uuid;
  v_status text;
  v_sale public.sales%ROWTYPE;
  v_change uuid := gen_random_uuid();
  v_scheduled_sum_cents bigint;
  p jsonb;
BEGIN
  IF v_ws IS NULL OR v_contact IS NULL OR v_variant_id IS NULL OR v_base IS NULL OR v_financing IS NULL THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;
  IF jsonb_typeof(v_payments) <> 'array' OR jsonb_array_length(v_payments) = 0 THEN
    RAISE EXCEPTION 'invalid_payload:payments';
  END IF;

  -- El contacto es de este workspace y no esta en la papelera.
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = v_contact AND c.workspace_id = v_ws AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_contact';
  END IF;

  -- La variante se puede vender (no archivada, de un producto activo) y su precio sigue siendo el que se mostro
  -- (si no: price_changed + el precio de hoy).
  SELECT * INTO v_variant FROM public.product_variants WHERE id = v_variant_id AND workspace_id = v_ws;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_variant'; END IF;
  IF v_variant.archived_at IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM public.products pr WHERE pr.id = v_variant.product_id AND pr.workspace_id = v_ws AND pr.status = 'active'
  ) THEN
    RAISE EXCEPTION 'invalid_variant';
  END IF;
  IF v_variant.price IS DISTINCT FROM (p_payload -> 'product_snapshot' ->> 'price')::numeric THEN
    RAISE EXCEPTION 'price_changed:%', v_variant.price;
  END IF;

  -- Fecha de la venta: no futura, en la zona del workspace.
  SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = v_ws;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'UTC'))::date;
  IF v_sale_date IS NULL OR v_sale_date > v_today THEN RAISE EXCEPTION 'invalid_sale_date'; END IF;

  -- La agenda de origen: del MISMO contacto y ya pasada.
  IF v_booking IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.id = v_booking AND b.workspace_id = v_ws AND b.contact_id = v_contact AND b.start_at < now()
  ) THEN
    RAISE EXCEPTION 'invalid_booking';
  END IF;

  -- El cuadre, otra vez, en centimos: lo programado y cobrado (sin reembolsos) suma EXACTO el final.
  IF v_financing <> 'subscription' THEN
    SELECT COALESCE(sum(round((x ->> 'amount')::numeric * 100)), 0)::bigint INTO v_scheduled_sum_cents
      FROM jsonb_array_elements(v_payments) x WHERE x ->> 'type' <> 'refund';
    IF v_scheduled_sum_cents <> round(v_final * 100)::bigint THEN
      RAISE EXCEPTION 'plan_unbalanced:%', (round(v_final * 100)::bigint - v_scheduled_sum_cents);
    END IF;
  END IF;

  -- La atribucion se resuelve ACA, dentro de la transaccion: con `last_touch` es el toque
  -- mas reciente AL GUARDAR (no el que mostraba el asistente).
  v_mode := COALESCE(v_attr_req ->> 'mode', 'last_touch');
  IF v_mode = 'touch' THEN
    SELECT * INTO v_touch FROM public.contact_touches
     WHERE id = NULLIF(v_attr_req ->> 'touch_id', '')::uuid AND contact_id = v_contact AND workspace_id = v_ws;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_touch'; END IF;
    v_attribution := public.sale_attribution_from_touch(v_touch);
    v_attr_type := 'manual';
    v_attr_touch_id := v_touch.id;
  ELSIF v_mode = 'manual' THEN
    v_attribution := v_attr_req -> 'manual';
    IF v_attribution IS NULL OR jsonb_typeof(v_attribution) <> 'object' THEN RAISE EXCEPTION 'invalid_manual'; END IF;
    v_attr_type := 'manual';
    v_attr_touch_id := NULLIF(v_attribution ->> 'touch_id', '')::uuid;
  ELSE
    SELECT * INTO v_touch FROM public.contact_touches
     WHERE contact_id = v_contact AND workspace_id = v_ws
     ORDER BY occurred_at DESC, id DESC LIMIT 1;
    IF FOUND THEN
      v_attribution := public.sale_attribution_from_touch(v_touch);
      v_attr_type := 'last_touch';
      v_attr_touch_id := v_touch.id;
    ELSE
      -- Sin filas de toque: el ultimo de contacts.attribution (forma canonica), sin touch_id.
      SELECT NULLIF(jsonb_strip_nulls(jsonb_build_object(
               'occurred_at', c.attribution -> 'last_touch' ->> 'occurred_at',
               'source', c.attribution -> 'last_touch' ->> 'source',
               'medium', c.attribution -> 'last_touch' ->> 'medium',
               'campaign', c.attribution -> 'last_touch' ->> 'campaign',
               'content', c.attribution -> 'last_touch' ->> 'content',
               'term', c.attribution -> 'last_touch' ->> 'term',
               'ad_id', c.attribution -> 'last_touch' ->> 'ad_id',
               'adset_id', c.attribution -> 'last_touch' ->> 'adset_id',
               'campaign_id', c.attribution -> 'last_touch' ->> 'campaign_id',
               'fbclid', c.attribution -> 'last_touch' ->> 'fbclid',
               'gclid', c.attribution -> 'last_touch' ->> 'gclid',
               'ttclid', c.attribution -> 'last_touch' ->> 'ttclid',
               'li_fat_id', c.attribution -> 'last_touch' ->> 'li_fat_id',
               'ctwa_clid', c.attribution -> 'last_touch' ->> 'ctwa_clid',
               'referrer_url', c.attribution -> 'last_touch' ->> 'referrer_url',
               'landing_page', c.attribution -> 'last_touch' ->> 'landing_page')), '{}'::jsonb)
        INTO v_attribution
        FROM public.contacts c WHERE c.id = v_contact;
      IF v_attribution IS NOT NULL THEN v_attr_type := 'last_touch'; END IF;
    END IF;
  END IF;

  -- El estado, calculado UNA vez a partir de lo que se va a crear.
  v_status := public.derive_sale_status(NULL, v_financing, v_final, v_payments);

  INSERT INTO public.sales (
    workspace_id, contact_id, product_variant_id, product_snapshot, base_amount, discount_amount, final_amount,
    discount_reason, status, financing_type, subscription_interval, sale_date, setter_id, vendedor_id,
    attribution, attribution_touch_id, attribution_type, booking_id, service_starts_at, notes, created_by, updated_by
  ) VALUES (
    v_ws, v_contact, v_variant_id, p_payload -> 'product_snapshot', v_base, v_discount, v_final,
    NULLIF(btrim(p_payload ->> 'discount_reason'), ''), v_status, v_financing,
    NULLIF(p_payload ->> 'subscription_interval', ''), v_sale_date,
    NULLIF(p_payload ->> 'setter_id', '')::uuid, NULLIF(p_payload ->> 'vendedor_id', '')::uuid,
    v_attribution, v_attr_touch_id, v_attr_type, v_booking,
    NULLIF(p_payload ->> 'service_starts_at', '')::date, NULLIF(btrim(p_payload ->> 'notes'), ''),
    p_actor_id, p_actor_id
  ) RETURNING * INTO v_sale;

  -- Los pagos del plan, SIN recalcular el estado fila por fila (ya esta calculado).
  PERFORM set_config('ssa.suppress_sale_refresh', 'on', true);
  FOR p IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
    INSERT INTO public.payments (
      workspace_id, sale_id, type, amount, status, due_date, paid_at, paid_on, payment_method,
      payment_option_snapshot, provider_fee_amount, notes, created_by, updated_by
    ) VALUES (
      v_ws, v_sale.id, p ->> 'type', (p ->> 'amount')::numeric, p ->> 'status',
      NULLIF(p ->> 'due_date', '')::date, NULLIF(p ->> 'paid_at', '')::timestamptz, NULLIF(p ->> 'paid_on', '')::date,
      NULLIF(p ->> 'payment_method', ''), p -> 'payment_option_snapshot',
      NULLIF(p ->> 'provider_fee_amount', '')::numeric, NULLIF(btrim(p ->> 'notes'), ''), p_actor_id, p_actor_id
    );
  END LOOP;
  PERFORM set_config('ssa.suppress_sale_refresh', '', true);

  -- Eventos de la venta: sale_created y sale_status_changed (from null) con el MISMO change_id.
  PERFORM public.emit_sales_event(v_ws, 'sale_created', v_contact,
    public.sales_event_payload(v_sale) || jsonb_build_object('change_id', v_change));
  PERFORM public.emit_sales_event(v_ws, 'sale_status_changed', v_contact,
    public.sales_event_payload(v_sale) || jsonb_build_object('change_id', v_change, 'to_status', v_status));

  -- Auditoria: la venta y cada pago cobrado, con actor persona.
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type)
  VALUES (v_ws, 'sale', v_sale.id, 'sale.created', NULL,
          jsonb_build_object('final_amount', v_final, 'financing_type', v_financing, 'status', v_status,
                             'attribution_type', v_attr_type, 'payments', jsonb_array_length(v_payments)),
          p_actor_id, 'user');
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type)
  SELECT v_ws, 'payment', pay.id, 'payment.paid', NULL,
         jsonb_build_object('amount', pay.amount, 'payment_method', pay.payment_method, 'sale_id', v_sale.id),
         p_actor_id, 'user'
    FROM public.payments pay WHERE pay.sale_id = v_sale.id AND pay.status = 'paid';

  RETURN jsonb_build_object('sale_id', v_sale.id, 'status', v_status, 'attribution_type', v_attr_type);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_sale(p_payload jsonb, p_actor_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.derive_sale_status(p_current_status text, p_financing_type text, p_final_amount numeric, p_payments jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_paid_cents bigint := 0;
  v_overdue boolean := false;
  v_reservation_paid boolean := false;
  p jsonb;
BEGIN
  IF p_current_status IN ('cancelled', 'refunded', 'disputed', 'subscription_cancelled') THEN
    RETURN p_current_status;
  END IF;

  IF p_financing_type = 'subscription' THEN
    RETURN 'subscription_active';
  END IF;

  FOR p IN SELECT * FROM jsonb_array_elements(COALESCE(p_payments, '[]'::jsonb)) LOOP
    IF p ->> 'status' = 'overdue' THEN v_overdue := true; END IF;
    IF p ->> 'status' = 'paid' THEN
      v_paid_cents := v_paid_cents + round(COALESCE((p ->> 'amount')::numeric, 0) * 100)::bigint;
      IF p ->> 'type' = 'reservation' THEN v_reservation_paid := true; END IF;
    END IF;
  END LOOP;

  IF v_overdue THEN RETURN 'overdue'; END IF;
  IF round(COALESCE(p_final_amount, 0) * 100)::bigint - v_paid_cents <= 0 THEN RETURN 'paid'; END IF;
  IF v_reservation_paid THEN RETURN 'reserved'; END IF;
  RETURN 'pending_payment';
END;
$function$;
REVOKE ALL ON FUNCTION public.derive_sale_status(p_current_status text, p_financing_type text, p_final_amount numeric, p_payments jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.emit_sales_event(p_workspace_id uuid, p_event_type text, p_contact_id uuid, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.emit_automation_event(
    p_workspace_id,
    p_event_type,
    p_contact_id,
    CASE WHEN p_payload ? 'change_id' THEN p_payload
         ELSE p_payload || jsonb_build_object('change_id', gen_random_uuid()) END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.emit_sales_event(p_workspace_id uuid, p_event_type text, p_contact_id uuid, p_payload jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.find_contact_by_phone_or_email(p_workspace_id uuid, p_phone text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_found jsonb;
BEGIN
  v_found := private.contact_identity_lookup(
    p_workspace_id,
    private.contact_normalize_identity(jsonb_build_object('phone', p_phone, 'email', p_email))
  );
  RETURN jsonb_build_object(
    'contact_id', v_found -> 'contact_id',
    'matched_by', v_found -> 'matched_by',
    'conflict_contact_id', v_found -> 'conflict_contact_id'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.find_contact_by_phone_or_email(p_workspace_id uuid, p_phone text, p_email text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.payments_emit_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contact uuid;
  v_change uuid := gen_random_uuid();
  v_tz text;
  v_payload jsonb;
  v_scope text;
  v_net_cents bigint;
BEGIN
  SELECT s.contact_id INTO v_contact FROM public.sales s WHERE s.id = NEW.sale_id;
  IF v_contact IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    v_payload := public.payments_event_payload(NEW) || jsonb_build_object('change_id', v_change);

    IF NEW.type = 'refund' THEN
      -- total = el reembolso deja lo cobrado neto en cero (o menos); si no, parcial.
      SELECT COALESCE(sum(round(p.amount * 100)), 0)::bigint INTO v_net_cents
        FROM public.payments p WHERE p.sale_id = NEW.sale_id AND p.status = 'paid';
      v_scope := CASE WHEN v_net_cents <= 0 THEN 'total' ELSE 'partial' END;
      v_payload := v_payload || jsonb_build_object('refund_scope', v_scope);
    END IF;

    PERFORM public.emit_sales_event(NEW.workspace_id, 'payment_created', v_contact, v_payload);

    IF NEW.status = 'paid' THEN
      PERFORM public.emit_sales_event(
        NEW.workspace_id, 'payment_status_changed', v_contact,
        v_payload || jsonb_build_object('to_status', 'paid', 'delay_days', NEW.delay_days));
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = NEW.workspace_id;
    v_payload := public.payments_event_payload(NEW) || jsonb_build_object(
      'change_id', v_change,
      'from_status', OLD.status,
      'to_status', NEW.status);
    IF NEW.delay_days IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object('delay_days', NEW.delay_days);
    END IF;
    IF NEW.status = 'overdue' AND NEW.due_date IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object(
        'days_overdue', GREATEST((now() AT TIME ZONE COALESCE(v_tz, 'UTC'))::date - NEW.due_date, 0));
    END IF;
    PERFORM public.emit_sales_event(NEW.workspace_id, 'payment_status_changed', v_contact, v_payload);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.payments_emit_events() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.payments_event_payload(p public.payments)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'payment_id', p.id,
    'sale_id', p.sale_id,
    'contact_id', (SELECT s.contact_id FROM public.sales s WHERE s.id = p.sale_id),
    'product_id', (SELECT s.product_snapshot ->> 'product_id' FROM public.sales s WHERE s.id = p.sale_id),
    'payment_type', p.type,
    'payment_method', p.payment_method,
    'amount', p.amount,
    'status', p.status
  ));
$function$;

CREATE OR REPLACE FUNCTION public.payments_protect_original_due_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_due_date := COALESCE(NEW.original_due_date, NEW.due_date);
  ELSE
    NEW.original_due_date := OLD.original_due_date;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.payments_refresh_sale_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF current_setting('ssa.suppress_sale_refresh', true) = 'on' THEN
    RETURN NEW;
  END IF;
  PERFORM public.refresh_sale_status(NEW.sale_id, gen_random_uuid());
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.payments_refresh_sale_status() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.product_links_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF public.affiliate_internal() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.links := '{"v":1,"items":[]}'::jsonb; NEW.links_rev := 0;
    RETURN NEW;
  END IF;
  IF NEW.links IS DISTINCT FROM OLD.links OR NEW.links_rev IS DISTINCT FROM OLD.links_rev THEN
    RAISE EXCEPTION 'Los links se guardan desde la tarjeta Links del producto.' USING ERRCODE = 'AF010';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.product_links_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.product_links_save(p_product_id uuid, p_links jsonb, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row public.products;
  v_problems text[];
BEGIN
  SELECT * INTO v_row FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'AF002'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_permission(v_row.workspace_id, 'product_links.manage') THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'AF010';
  END IF;
  IF v_row.links_rev <> p_rev THEN
    RETURN jsonb_build_object('status', 'conflict', 'rev', v_row.links_rev, 'current', v_row.links);
  END IF;
  v_problems := public.validate_product_links(p_links, ARRAY(SELECT id FROM public.product_variants WHERE product_id = p_product_id));
  IF cardinality(v_problems) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  PERFORM set_config('app.affiliates_internal', 'on', true);
  UPDATE public.products SET links = p_links, links_rev = links_rev + 1 WHERE id = p_product_id;
  PERFORM set_config('app.affiliates_internal', 'off', true);
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by)
  VALUES (v_row.workspace_id, 'product', p_product_id, 'product.links_saved',
          jsonb_build_object('links', jsonb_build_object('old', v_row.links, 'new', p_links)), auth.uid());
  RETURN jsonb_build_object('status', 'ok', 'rev', v_row.links_rev + 1);
END;
$function$;
REVOKE ALL ON FUNCTION public.product_links_save(p_product_id uuid, p_links jsonb, p_rev integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.refresh_sale_status(p_sale_id uuid, p_change_id uuid DEFAULT gen_random_uuid())
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s public.sales%ROWTYPE;
  v_payments jsonb;
  v_next text;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', p.type, 'status', p.status, 'amount', p.amount)), '[]'::jsonb)
    INTO v_payments FROM public.payments p WHERE p.sale_id = p_sale_id;

  v_next := public.derive_sale_status(s.status, s.financing_type, s.final_amount, v_payments);

  IF v_next IS DISTINCT FROM s.status THEN
    PERFORM set_config('ssa.sale_change_id', p_change_id::text, true);
    UPDATE public.sales SET status = v_next WHERE id = p_sale_id;
    PERFORM set_config('ssa.sale_change_id', '', true);
  END IF;
  RETURN v_next;
END;
$function$;
REVOKE ALL ON FUNCTION public.refresh_sale_status(p_sale_id uuid, p_change_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sale_attribution_from_touch(t public.contact_touches)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_out jsonb;
  v_extras jsonb;
BEGIN
  v_out := jsonb_strip_nulls(jsonb_build_object(
    'touch_id', t.id,
    'occurred_at', t.occurred_at,
    'source', NULLIF(btrim(t.source), ''),
    'medium', NULLIF(btrim(t.medium), ''),
    'campaign', NULLIF(btrim(t.campaign), ''),
    'content', NULLIF(btrim(t.content_label), ''),
    'term', NULLIF(btrim(t.term), ''),
    'ad_id', NULLIF(btrim(t.ad_id), ''),
    'adset_id', NULLIF(btrim(t.adset_id), ''),
    'campaign_id', NULLIF(btrim(t.campaign_id), ''),
    'fbclid', NULLIF(btrim(t.fbclid), ''),
    'gclid', NULLIF(btrim(t.gclid), ''),
    'ttclid', NULLIF(btrim(t.ttclid), ''),
    'li_fat_id', NULLIF(btrim(t.li_fat_id), ''),
    'ctwa_clid', NULLIF(btrim(t.ctwa_clid), ''),
    'referrer_url', NULLIF(btrim(t.referrer_url), ''),
    'landing_page', NULLIF(btrim(t.landing_page), '')
  ));

  -- Las claves de raw que no tienen columna (v1.1, §0.0.4); se omite si no hay ninguna.
  SELECT jsonb_object_agg(k, v) INTO v_extras
    FROM (
      SELECT k, NULLIF(btrim(t.raw ->> k), '') AS v
        FROM unnest(ARRAY['utm_id','gbraid','wbraid','msclkid','twclid','sccid','epik','rdt_cid',
                          'placement','fbp','fbc','ga_client_id','page_url']) AS k
    ) x
   WHERE v IS NOT NULL;
  IF v_extras IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('extras', v_extras);
  END IF;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sales_emit_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_change uuid;
  v_payload jsonb;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  BEGIN
    v_change := NULLIF(current_setting('ssa.sale_change_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_change := NULL;
  END;
  v_change := COALESCE(v_change, gen_random_uuid());

  v_payload := public.sales_event_payload(NEW) || jsonb_build_object(
    'change_id', v_change, 'from_status', OLD.status, 'to_status', NEW.status);
  IF NEW.status = 'cancelled' AND NEW.cancellation_reason IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('reason', NEW.cancellation_reason);
  END IF;

  PERFORM public.emit_sales_event(NEW.workspace_id, 'sale_status_changed', NEW.contact_id, v_payload);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.sales_emit_status_change() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sales_event_payload(s public.sales)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'sale_id', s.id,
    'contact_id', s.contact_id,
    'product_id', s.product_snapshot ->> 'product_id',
    'variant_id', s.product_snapshot ->> 'variant_id',
    'vendedor_id', s.vendedor_id,
    'setter_id', s.setter_id,
    'financing_type', s.financing_type,
    'final_amount', s.final_amount,
    'attribution_type', s.attribution_type,
    'utm_source', s.attribution ->> 'source',
    'utm_medium', s.attribution ->> 'medium',
    'utm_campaign', s.attribution ->> 'campaign'
  ));
$function$;

CREATE OR REPLACE FUNCTION public.validate_affiliate_settings(p jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN ARRAY['las reglas no son válidas']; END IF;
  IF p ? 'originated' THEN
    IF jsonb_typeof(p -> 'originated') <> 'object' THEN v := v || 'la regla de «lo trajo» no es válida'::text;
    ELSE
      IF (p -> 'originated') ? 'months' AND jsonb_typeof(p #> '{originated,months}') <> 'null'
         AND NOT (jsonb_typeof(p #> '{originated,months}') = 'number' AND (p #>> '{originated,months}')::numeric BETWEEN 1 AND 120 AND (p #>> '{originated,months}')::numeric = trunc((p #>> '{originated,months}')::numeric)) THEN
        v := v || '«lo trajo» dura de 1 a 120 meses (o de por vida)'::text;
      END IF;
      IF (p -> 'originated') ? 'replace' AND NOT COALESCE((p #>> '{originated,replace}') = ANY (ARRAY['keep','last','last_if_not_bought']), false) THEN
        v := v || 'elegí qué pasa con otro afiliado sobre un «lo trajo»'::text;
      END IF;
    END IF;
  END IF;
  IF p ? 'influenced' THEN
    IF jsonb_typeof(p -> 'influenced') <> 'object' THEN v := v || 'la regla de «influyó» no es válida'::text;
    ELSE
      IF (p -> 'influenced') ? 'days' AND NOT (jsonb_typeof(p #> '{influenced,days}') = 'number' AND (p #>> '{influenced,days}')::numeric BETWEEN 1 AND 3650 AND (p #>> '{influenced,days}')::numeric = trunc((p #>> '{influenced,days}')::numeric)) THEN
        v := v || '«influyó» dura de 1 a 3650 días'::text;
      END IF;
      IF (p -> 'influenced') ? 'renew_on_click' AND jsonb_typeof(p #> '{influenced,renew_on_click}') <> 'boolean' THEN
        v := v || '«un clic nuevo corre la fecha» tiene que ser sí o no'::text;
      END IF;
      IF (p -> 'influenced') ? 'replace' AND NOT COALESCE((p #>> '{influenced,replace}') = ANY (ARRAY['keep','last','last_if_not_bought']), false) THEN
        v := v || 'elegí qué pasa con otro afiliado sobre un «influyó»'::text;
      END IF;
    END IF;
  END IF;
  IF p ? 'counts' AND (jsonb_typeof(p -> 'counts') <> 'object' OR ((p -> 'counts') ? 'first_purchase_only' AND jsonb_typeof(p #> '{counts,first_purchase_only}') <> 'boolean')) THEN
    v := v || '«solo la primera compra» tiene que ser sí o no'::text;
  END IF;
  IF p ? 'show_lead_names' AND NOT COALESCE((p ->> 'show_lead_names') = ANY (ARRAY['first_name_initial','full','hidden']), false) THEN
    v := v || 'elegí cómo se ven los nombres de los referidos'::text;
  END IF;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.validate_affiliate_settings(p jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.validate_product_links(p jsonb, p_variant_ids uuid[])
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  it jsonb;
  v_keys text[] := ARRAY[]::text[];
  v_name text;
  v_label text;
  v_field text;
  v_kinds text[];
  v_lbl text;
  v_hit jsonb;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN ARRAY['los links no son válidos']; END IF;
  IF p -> 'v' IS DISTINCT FROM '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF jsonb_typeof(p -> 'items') IS DISTINCT FROM 'array' THEN RETURN v || 'faltan los links'::text; END IF;
  FOR it IN SELECT x FROM jsonb_array_elements(p -> 'items') x LOOP
    IF jsonb_typeof(it) IS DISTINCT FROM 'object' THEN v := v || 'hay un link que no es válido'::text; CONTINUE; END IF;
    v_name := CASE WHEN jsonb_typeof(it -> 'name') = 'string' THEN btrim(it ->> 'name') ELSE '' END;
    v_label := COALESCE(NULLIF(v_name, ''), 'un link');
    IF NOT (jsonb_typeof(it -> 'key') = 'string' AND (it ->> 'key') ~ '^lk_[a-z0-9]{6}$') THEN
      v := v || format('«%s»: la clave no es válida', v_label);
    ELSIF (it ->> 'key') = ANY (v_keys) THEN
      v := v || format('la clave %s está repetida', it ->> 'key');
    ELSE
      v_keys := v_keys || (it ->> 'key');
    END IF;
    IF v_name = '' THEN v := v || 'hay un link sin nombre'::text; END IF;
    IF NOT COALESCE((it ->> 'kind') = ANY (ARRAY['product_page','landing','registration_form','booking','checkout','other']), false) THEN
      v := v || format('«%s»: elegí el tipo', v_label);
    END IF;
    IF NOT (jsonb_typeof(it -> 'url') = 'string' AND (it ->> 'url') ~* '^https://[^\s/$.?#].[^\s]*$') THEN
      v := v || format('«%s»: el link tiene que empezar con https://', v_label);
    END IF;
    IF jsonb_typeof(it -> 'active') IS DISTINCT FROM 'boolean' THEN v := v || format('«%s»: «Activo» tiene que ser sí o no', v_label); END IF;
    IF it ? 'valid_until' AND jsonb_typeof(it -> 'valid_until') <> 'null'
       AND NOT (jsonb_typeof(it -> 'valid_until') = 'string' AND (it ->> 'valid_until') ~ '^\d{4}-\d{2}-\d{2}$') THEN
      v := v || format('«%s»: la fecha de vigencia no es válida', v_label);
    END IF;
    IF it ? 'variant_id' AND jsonb_typeof(it -> 'variant_id') <> 'null' THEN
      IF NOT (jsonb_typeof(it -> 'variant_id') = 'string' AND (it ->> 'variant_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
        v := v || format('«%s»: la variante no es válida', v_label);
      ELSIF p_variant_ids IS NOT NULL AND NOT ((it ->> 'variant_id')::uuid = ANY (p_variant_ids)) THEN
        v := v || format('«%s»: la variante tiene que ser de este producto', v_label);
      END IF;
    END IF;
  END LOOP;
  FOREACH v_field IN ARRAY ARRAY['primary_learn', 'primary_convert'] LOOP
    CONTINUE WHEN NOT (p ? v_field) OR jsonb_typeof(p -> v_field) = 'null';
    v_kinds := CASE v_field WHEN 'primary_learn' THEN ARRAY['product_page','landing'] ELSE ARRAY['booking','checkout'] END;
    v_lbl := CASE v_field WHEN 'primary_learn' THEN 'para conocer' ELSE 'para convertir' END;
    SELECT x INTO v_hit FROM jsonb_array_elements(p -> 'items') x
     WHERE jsonb_typeof(x) = 'object' AND x ->> 'key' = p ->> v_field LIMIT 1;
    IF v_hit IS NULL OR jsonb_typeof(p -> v_field) <> 'string' THEN
      v := v || format('el principal %s no es uno de los links', v_lbl);
    ELSIF NOT COALESCE((v_hit ->> 'kind') = ANY (v_kinds), false) THEN
      v := v || format('el principal %s no puede ser de ese tipo', v_lbl);
    END IF;
    v_hit := NULL;
  END LOOP;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.validate_product_links(p jsonb, p_variant_ids uuid[]) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.workspace_payment_method(p_workspace uuid, p_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT m
    FROM public.workspaces w, jsonb_array_elements(w.payment_methods) AS m
   WHERE w.id = p_workspace
     AND m ->> 'key' = p_key
     AND (COALESCE(auth.role(), '') = 'service_role' OR public.is_workspace_member(p_workspace))
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.workspace_payment_method(p_workspace uuid, p_key text) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_payments_fee_by_method ON public.payments USING btree (workspace_id, payment_method, paid_at) WHERE (status = 'paid'::text);

CREATE INDEX IF NOT EXISTS idx_payments_sale ON public.payments USING btree (sale_id);

CREATE INDEX IF NOT EXISTS idx_payments_ws_paid_at ON public.payments USING btree (workspace_id, paid_at);

CREATE INDEX IF NOT EXISTS idx_payments_ws_paid_on ON public.payments USING btree (workspace_id, paid_on) WHERE (status = 'paid'::text);

CREATE INDEX IF NOT EXISTS idx_payments_ws_status_due ON public.payments USING btree (workspace_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_sales_affiliate_contact ON public.sales USING btree (affiliate_contact_id) WHERE (affiliate_contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_sales_affiliate_user ON public.sales USING btree (workspace_id, affiliate_user_id) WHERE (affiliate_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_sales_attr_campaign ON public.sales USING btree (workspace_id, ((attribution ->> 'campaign'::text)));

CREATE INDEX IF NOT EXISTS idx_sales_attr_source ON public.sales USING btree (workspace_id, ((attribution ->> 'source'::text)));

CREATE INDEX IF NOT EXISTS idx_sales_booking ON public.sales USING btree (booking_id) WHERE (booking_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_sales_contact_created ON public.sales USING btree (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_setter ON public.sales USING btree (setter_id);

CREATE INDEX IF NOT EXISTS idx_sales_variant ON public.sales USING btree (product_variant_id);

CREATE INDEX IF NOT EXISTS idx_sales_vendedor ON public.sales USING btree (vendedor_id);

CREATE INDEX IF NOT EXISTS idx_sales_ws_created ON public.sales USING btree (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_ws_sale_date ON public.sales USING btree (workspace_id, sale_date);

CREATE INDEX IF NOT EXISTS idx_sales_ws_status_created ON public.sales USING btree (workspace_id, status, created_at DESC);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER trg_affiliate_touch AFTER INSERT ON public.contact_touches FOR EACH ROW EXECUTE FUNCTION public.affiliate_touch_hook();

CREATE OR REPLACE TRIGGER trg_affiliate_codes BEFORE INSERT OR UPDATE OF affiliate_code ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.affiliate_codes_guard();

CREATE OR REPLACE TRIGGER trg_affiliate_contact_guard BEFORE INSERT OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.affiliate_contact_guard();

CREATE OR REPLACE TRIGGER payments_emit_status_change AFTER INSERT OR UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_emit_events();

CREATE OR REPLACE TRIGGER payments_enqueue_meta_capi_purchase AFTER INSERT OR UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION private.enqueue_meta_capi_purchase();

CREATE OR REPLACE TRIGGER payments_fee_spec_from_snapshot BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.payments_fee_spec_from_snapshot();

CREATE OR REPLACE TRIGGER payments_mark_customer AFTER INSERT OR UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION private.payments_mark_customer();

CREATE OR REPLACE TRIGGER payments_protect_original_due_date BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_protect_original_due_date();

CREATE OR REPLACE TRIGGER payments_refresh_sale_status AFTER INSERT OR UPDATE OF status, amount, type ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_refresh_sale_status();

CREATE OR REPLACE TRIGGER payments_validate_method BEFORE INSERT OR UPDATE OF payment_method ON public.payments FOR EACH ROW EXECUTE FUNCTION private.payments_validate_method();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER trg_product_links_guard BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.product_links_guard();

CREATE OR REPLACE TRIGGER sales_emit_status_change AFTER UPDATE OF status ON public.sales FOR EACH ROW EXECUTE FUNCTION public.sales_emit_status_change();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER trg_affiliate_sale_guard BEFORE INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.affiliate_sale_guard();

CREATE OR REPLACE TRIGGER trg_affiliate_codes BEFORE INSERT OR UPDATE OF affiliate_code ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION public.affiliate_codes_guard();

CREATE OR REPLACE TRIGGER trg_affiliate_settings_guard BEFORE INSERT OR UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.affiliate_settings_guard();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY audit_log_select_sales ON public.audit_log FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND (((entity_type = 'sale'::text) AND public.can_see_sale_id(entity_id)) OR ((entity_type = 'payment'::text) AND (EXISTS ( SELECT 1
   FROM public.payments p
  WHERE ((p.id = audit_log.entity_id) AND public.can_see_sale_id(p.sale_id))))) OR (entity_type = ANY (ARRAY['product'::text, 'product_variant'::text, 'product_version'::text])))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY payments_select ON public.payments FOR SELECT TO public
    USING (public.can_see_sale_id(sale_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY sales_select ON public.sales FOR SELECT TO public
    USING (public.can_see_sale(sales.*));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
