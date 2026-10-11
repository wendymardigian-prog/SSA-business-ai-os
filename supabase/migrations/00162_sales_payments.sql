-- ============================================================
-- 00162_sales_payments.sql
--
-- Ventas, Fase 1 · B3 · F17: las tablas `sales` y `payments`, quien ve cada
-- venta, el estado derivado, los eventos por cambio de estado y la creacion de
-- una venta en UNA transaccion.
--
-- Aditiva e idempotente, con UNA excepcion que se nombra aca porque toca una
-- funcion en uso: `purge_soft_deleted` (la purga diaria de 30 dias) se redefine
-- para NO borrar un contacto que tiene ventas. Sin eso, la FK
-- `sales.contact_id ... ON DELETE RESTRICT` haria fallar `DELETE FROM contacts`
-- todos los dias (y con eso la purga entera) en cuanto un contacto con una
-- venta cumpliera sus 30 dias en la papelera. La definicion anterior esta
-- copiada completa abajo, por si hay que volver atras.
--
-- Como se escribe (§3.2 del plano): `sales` y `payments` NO tienen policy de
-- INSERT, UPDATE ni DELETE. Todo se escribe con el cliente de servicio desde
-- Server Actions que ya pasaron `requirePermission` y el chequeo de alcance
-- (`has_permission` en SQL no conoce al Member de sistema, cuyos permisos viven
-- en el codigo). Las funciones que escriben son solo para `service_role`.
--
-- Un cambio de estado = UN evento, emitido desde la base (triggers), con
-- `from_status`, `to_status` y `change_id`. Ningun payload lleva `booking_id`
-- (el cron de automatizaciones trata como "reserva" a todo lo que lo trae).
--
-- Como volver atras (si nadie creo ventas todavia):
--   DROP FUNCTION IF EXISTS public.create_sale(jsonb, uuid), public.cancel_sale(uuid, text, uuid),
--     public.refresh_sale_status(uuid, uuid), public.derive_sale_status(text, text, numeric, jsonb),
--     public.emit_sales_event(uuid, text, uuid, jsonb), public.can_see_sale_id(uuid),
--     public.can_see_sale(public.sales);
--   DROP TABLE IF EXISTS public.payments, public.sales;
--   DROP INDEX IF EXISTS public.idx_scheduled_jobs_payment;
--   -- y volver a la purga anterior (definicion al final de esta cabecera).
--
-- DEFINICION ANTERIOR DE public.purge_soft_deleted(integer), tal como estaba antes:
--
--   CREATE OR REPLACE FUNCTION public.purge_soft_deleted(p_retention_days integer DEFAULT 30)
--    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
--   DECLARE
--     v_cutoff timestamptz := now() - make_interval(days => GREATEST(p_retention_days, 0));
--     v_contacts integer := 0; v_notes integer := 0; v_convs integer := 0; v_assets integer := 0;
--     v_schedules integer := 0; v_ooo integer := 0; v_events integer := 0;
--   BEGIN
--     DELETE FROM public.contacts WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
--     GET DIAGNOSTICS v_contacts = ROW_COUNT;
--     DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
--     GET DIAGNOSTICS v_convs = ROW_COUNT;
--     DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
--     GET DIAGNOSTICS v_notes = ROW_COUNT;
--     DELETE FROM public.response_assets WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
--     GET DIAGNOSTICS v_assets = ROW_COUNT;
--     DELETE FROM public.availability_schedules WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
--     GET DIAGNOSTICS v_schedules = ROW_COUNT;
--     DELETE FROM public.out_of_office WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
--     GET DIAGNOSTICS v_ooo = ROW_COUNT;
--     IF to_regclass('public.bookings') IS NULL THEN
--       DELETE FROM public.event_types WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
--     ELSE
--       EXECUTE ' DELETE FROM public.event_types e WHERE e.deleted_at IS NOT NULL AND e.deleted_at < $1
--         AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.event_type_id = e.id) ' USING v_cutoff;
--     END IF;
--     GET DIAGNOSTICS v_events = ROW_COUNT;
--     RETURN jsonb_build_object('cutoff', v_cutoff, 'contacts', v_contacts, 'conversations', v_convs,
--       'contact_notes', v_notes, 'response_assets', v_assets, 'availability_schedules', v_schedules,
--       'out_of_office', v_ooo, 'event_types', v_events);
--   END; $function$;
-- ============================================================

-- ------------------------------------------------------------
-- 1. sales
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sales (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id               uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id                 uuid NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  product_version_id         uuid NOT NULL REFERENCES public.product_versions(id) ON DELETE RESTRICT,
  product_snapshot           jsonb NOT NULL,
  base_amount                numeric(12,2) NOT NULL,
  discount_amount            numeric(12,2) NOT NULL DEFAULT 0,
  final_amount               numeric(12,2) NOT NULL,
  discount_reason            text,
  currency                   text NOT NULL DEFAULT 'USD',
  status                     text NOT NULL,
  financing_type             text NOT NULL,
  subscription_interval      text,
  sale_date                  date NOT NULL,
  setter_id                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  vendedor_id                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  attribution                jsonb,
  attribution_touch_id       uuid REFERENCES public.contact_touches(id) ON DELETE SET NULL,
  attribution_type           text NOT NULL DEFAULT 'none',
  booking_id                 uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  service_starts_at          date,
  notes                      text,
  plan_unbalanced            boolean NOT NULL DEFAULT false,
  cancelled_at               timestamptz,
  cancelled_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancellation_reason        text,
  subscription_cancelled_at  timestamptz,
  subscription_cancel_reason text,
  refunded_at                timestamptz,
  opportunity_stage          text,
  stage_entered_at           timestamptz,
  created_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sales IS
  'Ventas (Etapa 5, 00162). Nada se borra: se cancelan. La atribucion es una COPIA CONGELADA del toque (no cambia cuando el contacto recibe toques nuevos).';
COMMENT ON COLUMN public.sales.attribution IS
  'Copia congelada del toque: {touch_id, occurred_at, source, medium, campaign, content, term, ad_id, ..., extras}. NULL si attribution_type = none.';
COMMENT ON COLUMN public.sales.service_starts_at IS
  'Reservada para CX: en esta fase solo se carga y se edita.';
COMMENT ON COLUMN public.sales.opportunity_stage IS 'Reservada sin uso (pipeline futuro).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_currency_check') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_currency_check CHECK (currency = 'USD');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_status_check') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_status_check CHECK (status IN (
      'pending_payment', 'reserved', 'paid', 'overdue', 'subscription_active',
      'cancelled', 'refunded', 'disputed', 'subscription_cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_financing_check') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_financing_check CHECK (financing_type IN (
      'full', 'reservation_balance', 'installments', 'reservation_installments', 'subscription'));
  END IF;
  -- Ojo con NULL IN (...): da NULL y un CHECK deja pasar un NULL. Por eso IS NOT NULL explicito.
  ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_interval_check;
  ALTER TABLE public.sales ADD CONSTRAINT sales_interval_check CHECK (
    (financing_type = 'subscription' AND subscription_interval IS NOT NULL
       AND subscription_interval IN ('monthly', 'quarterly', 'yearly'))
    OR (financing_type <> 'subscription' AND subscription_interval IS NULL));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_amounts_check') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_amounts_check CHECK (
      base_amount >= 0 AND discount_amount >= 0
      AND final_amount = base_amount - discount_amount AND final_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_attribution_type_check') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_attribution_type_check
      CHECK (attribution_type IN ('last_touch', 'manual', 'none'));
  END IF;
  -- Sin atribucion <=> no hay copia. (IS NULL da un booleano limpio: no hay NULL que deje pasar al CHECK.)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_attribution_none_check') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_attribution_none_check
      CHECK ((attribution_type = 'none') = (attribution IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_ws_created ON public.sales (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_ws_status_created ON public.sales (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_contact_created ON public.sales (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_version ON public.sales (product_version_id);
CREATE INDEX IF NOT EXISTS idx_sales_vendedor ON public.sales (vendedor_id);
CREATE INDEX IF NOT EXISTS idx_sales_setter ON public.sales (setter_id);
CREATE INDEX IF NOT EXISTS idx_sales_booking ON public.sales (booking_id) WHERE booking_id IS NOT NULL;
-- Los filtros del listado y las condiciones de flujo por UTM.
CREATE INDEX IF NOT EXISTS idx_sales_attr_source ON public.sales (workspace_id, ((attribution ->> 'source')));
CREATE INDEX IF NOT EXISTS idx_sales_attr_campaign ON public.sales (workspace_id, ((attribution ->> 'campaign')));

DROP TRIGGER IF EXISTS set_updated_at ON public.sales;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 2. payments
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sale_id                 uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  type                    text NOT NULL,
  amount                  numeric(12,2) NOT NULL,
  currency                text NOT NULL DEFAULT 'USD',
  status                  text NOT NULL,
  due_date                date,
  original_due_date       date,
  reschedule_count        int NOT NULL DEFAULT 0,
  paid_at                 timestamptz,
  paid_on                 date,
  delay_days              int GENERATED ALWAYS AS (paid_on - original_due_date) STORED,
  payment_method          text,
  payment_option_snapshot jsonb,
  provider_fee_amount     numeric(12,2),
  receipt_path            text,
  notes                   text,
  reschedule_reason       text,
  uncollectible_reason    text,
  refund_reason           text,
  revert_reason           text,
  refund_of_payment_id    uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payments IS
  'Pagos de una venta (00162). Un reembolso es OTRA fila (type refund, monto negativo, status paid): el pago original no cambia de estado.';
COMMENT ON COLUMN public.payments.paid_on IS
  'Fecha LOCAL del cobro (en la zona del workspace), escrita por el servidor junto con paid_at. delay_days se calcula sobre ella.';
COMMENT ON COLUMN public.payments.provider_fee_amount IS
  'Comision del proveedor CONGELADA al cobrar. La suma Gastos por metodo y por mes (indice abajo).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_currency_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_currency_check CHECK (currency = 'USD');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_type_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_type_check
      CHECK (type IN ('full', 'reservation', 'installment', 'refund'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
      CHECK (status IN ('scheduled', 'paid', 'overdue', 'uncollectible', 'refunded', 'cancelled'));
  END IF;
  -- En la Fase 1 un reembolso NO cambia el estado del pago original: es otra fila.
  -- El valor 'refunded' queda para la Fase 2 (se quita este CHECK con una migracion aditiva).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_no_refunded_status_phase1') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_no_refunded_status_phase1 CHECK (status <> 'refunded');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_sign_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_amount_sign_check
      CHECK ((type = 'refund' AND amount < 0) OR (type <> 'refund' AND amount > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_paid_fields_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_paid_fields_check
      CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND paid_on IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_fee_only_paid_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_fee_only_paid_check
      CHECK (status = 'paid' OR provider_fee_amount IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_refund_fee_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_refund_fee_check
      CHECK (type <> 'refund' OR provider_fee_amount IS NULL OR provider_fee_amount = 0);
  END IF;
  -- Las mismas 5 claves de lib/sales/payment-methods.ts (un test de paridad lee esta migracion).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_method_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_method_check
      CHECK (payment_method IS NULL OR payment_method IN ('whop', 'transferencia_cr', 'transferencia_usa', 'wise', 'binance'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_sale ON public.payments (sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_ws_status_due ON public.payments (workspace_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_payments_ws_paid_at ON public.payments (workspace_id, paid_at);
-- El que usa Gastos: comisiones por metodo y por mes, solo de lo cobrado.
CREATE INDEX IF NOT EXISTS idx_payments_fee_by_method
  ON public.payments (workspace_id, payment_method, paid_at) WHERE status = 'paid';

-- Los relativos de un pago (recordatorios) se cancelan por `payload->>'payment_id'`.
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_payment
  ON public.scheduled_jobs ((payload ->> 'payment_id')) WHERE payload ? 'payment_id';

DROP TRIGGER IF EXISTS set_updated_at ON public.payments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- original_due_date se escribe UNA vez (al crear, = due_date) y no cambia nunca:
-- reprogramar mueve due_date, y el desfase se sigue midiendo contra la original.
CREATE OR REPLACE FUNCTION public.payments_protect_original_due_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_due_date := COALESCE(NEW.original_due_date, NEW.due_date);
  ELSE
    NEW.original_due_date := OLD.original_due_date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_protect_original_due_date ON public.payments;
CREATE TRIGGER payments_protect_original_due_date
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_protect_original_due_date();

-- ------------------------------------------------------------
-- 3. Quien ve una venta (mismo patron que can_see_booking, 00099)
-- ------------------------------------------------------------
-- Administrador, o setter, o vendedor, o `sales.view` con alcance `all`. NO depende
-- de has_permission para el caso "lo mio": un Member de sistema nunca tiene sus
-- claves en la base (viven en el codigo).

CREATE OR REPLACE FUNCTION public.can_see_sale(s public.sales)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.can_see_sale(public.sales) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_sale(public.sales) TO authenticated, service_role;

-- La misma regla a partir del id (la usan `payments` y `audit_log`).
CREATE OR REPLACE FUNCTION public.can_see_sale_id(p_sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.sales s WHERE s.id = p_sale_id AND public.can_see_sale(s));
$$;

REVOKE ALL ON FUNCTION public.can_see_sale_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_sale_id(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. RLS: solo lectura para quien corresponde. Sin INSERT/UPDATE/DELETE.
-- ------------------------------------------------------------

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_select" ON public.sales;
CREATE POLICY "sales_select" ON public.sales FOR SELECT USING (public.can_see_sale(sales));

DROP POLICY IF EXISTS "payments_select" ON public.payments;
CREATE POLICY "payments_select" ON public.payments FOR SELECT USING (public.can_see_sale_id(sale_id));

-- ------------------------------------------------------------
-- 5. El estado derivado (espejo de lib/sales/sale-status.ts; un test de paridad
--    corre los mismos casos contra las dos)
-- ------------------------------------------------------------
-- Los 4 estados ESCRITOS ganan y no se derivan (cancelled, refunded, disputed,
-- subscription_cancelled). Los 5 derivados, por precedencia:
--   1. subscription_active  si es suscripcion
--   2. overdue              si hay al menos un pago overdue
--   3. paid                 si el saldo (final - cobrado neto) <= 0, EN CENTIMOS
--   4. reserved             si hay una reserva cobrada y queda saldo
--   5. pending_payment
-- Un `uncollectible` NO baja el saldo: una venta con un incobrable nunca llega a paid.

CREATE OR REPLACE FUNCTION public.derive_sale_status(
  p_current_status text,
  p_financing_type text,
  p_final_amount numeric,
  p_payments jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.derive_sale_status(text, text, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derive_sale_status(text, text, numeric, jsonb) TO service_role;

-- ------------------------------------------------------------
-- 6. Eventos de automatizacion (una sola puerta)
-- ------------------------------------------------------------
-- Llama a emit_automation_event (la que ya usa todo el sistema) y agrega el
-- `change_id` si el payload no lo trae. Solo escalares: el cron aplana el payload
-- con String(v) y un objeto anidado saldria como "[object Object]".

CREATE OR REPLACE FUNCTION public.emit_sales_event(
  p_workspace_id uuid,
  p_event_type text,
  p_contact_id uuid,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.emit_automation_event(
    p_workspace_id,
    p_event_type,
    p_contact_id,
    CASE WHEN p_payload ? 'change_id' THEN p_payload
         ELSE p_payload || jsonb_build_object('change_id', gen_random_uuid()) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.emit_sales_event(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_sales_event(uuid, text, uuid, jsonb) TO service_role;

-- Lo que llevan los eventos de una venta (escalares; sin `booking_id`).
CREATE OR REPLACE FUNCTION public.sales_event_payload(s public.sales)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
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
$$;

-- Los eventos de un pago.
CREATE OR REPLACE FUNCTION public.payments_event_payload(p public.payments)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
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
$$;

-- ------------------------------------------------------------
-- 7. Triggers de eventos
-- ------------------------------------------------------------

-- Pagos: payment_created al insertar, y payment_status_changed (a) al nacer cobrado
-- (from null) o (b) cada vez que cambia el estado. El que nace cobrado emite los dos
-- con el MISMO change_id: un flujo con "Pago creado" y "Pago cobrado" corre una vez.
CREATE OR REPLACE FUNCTION public.payments_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.payments_emit_events() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_emit_status_change ON public.payments;
CREATE TRIGGER payments_emit_status_change
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_emit_events();

-- Ventas: UN evento cuando cambia `sales.status`, sea derivado (lo escribe
-- refresh_sale_status) o escrito (cancelar, reembolso total, cancelar suscripcion).
-- El alta NO pasa por aca: create_sale emite sus eventos (con el estado `from null`).
-- `ssa.sale_change_id` lo deja refresh_sale_status para que el evento lleve su change_id.
CREATE OR REPLACE FUNCTION public.sales_emit_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.sales_emit_status_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_emit_status_change ON public.sales;
CREATE TRIGGER sales_emit_status_change
  AFTER UPDATE OF status ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sales_emit_status_change();

-- ------------------------------------------------------------
-- 8. Recalcular el estado de una venta
-- ------------------------------------------------------------
-- Bloquea la venta, lee sus pagos, deriva el estado y, SOLO si cambio, lo escribe
-- (el trigger de arriba emite el evento, una sola vez). Devuelve el estado.

CREATE OR REPLACE FUNCTION public.refresh_sale_status(p_sale_id uuid, p_change_id uuid DEFAULT gen_random_uuid())
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.refresh_sale_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_sale_status(uuid, uuid) TO service_role;

-- Un pago que se inserta o cambia de estado, monto o tipo recalcula la venta, salvo
-- dentro de create_sale (que calcula el estado UNA vez: `ssa.suppress_sale_refresh`).
CREATE OR REPLACE FUNCTION public.payments_refresh_sale_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('ssa.suppress_sale_refresh', true) = 'on' THEN
    RETURN NEW;
  END IF;
  PERFORM public.refresh_sale_status(NEW.sale_id, gen_random_uuid());
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.payments_refresh_sale_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_refresh_sale_status ON public.payments;
CREATE TRIGGER payments_refresh_sale_status
  AFTER INSERT OR UPDATE OF status, amount, type ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_refresh_sale_status();

-- ------------------------------------------------------------
-- 9. La copia congelada de un toque (la misma forma que lib/sales/attribution.ts)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sale_attribution_from_touch(t public.contact_touches)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
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
$$;

-- ------------------------------------------------------------
-- 10. Crear una venta en UNA transaccion
-- ------------------------------------------------------------
-- El servidor ya valido con Zod, resolvio permisos y alcance, releyo el catalogo y
-- armo el payload. Aca se vuelve a comprobar lo que la base puede comprobar (la
-- version sigue activa y con el mismo precio, el cuadre, el contacto, la agenda) y
-- se escribe TODO o NADA: venta + pagos + estado (calculado UNA vez) + eventos +
-- auditoria. Los errores salen como `RAISE EXCEPTION '<codigo>[:detalle]'`.

CREATE OR REPLACE FUNCTION public.create_sale(p_payload jsonb, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws uuid := (p_payload ->> 'workspace_id')::uuid;
  v_contact uuid := (p_payload ->> 'contact_id')::uuid;
  v_version_id uuid := (p_payload ->> 'product_version_id')::uuid;
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
  v_version public.product_versions%ROWTYPE;
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
  IF v_ws IS NULL OR v_contact IS NULL OR v_version_id IS NULL OR v_base IS NULL OR v_financing IS NULL THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;
  IF jsonb_typeof(v_payments) <> 'array' OR jsonb_array_length(v_payments) = 0 THEN
    RAISE EXCEPTION 'invalid_payload:payments';
  END IF;

  -- El contacto es de este workspace y no esta en la papelera.
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = v_contact AND c.workspace_id = v_ws AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_contact';
  END IF;

  -- La version sigue activa y con el mismo precio que se mostro (si no: version_changed + precio nuevo).
  SELECT * INTO v_version FROM public.product_versions WHERE id = v_version_id AND workspace_id = v_ws;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_version'; END IF;
  IF v_version.status <> 'active' OR v_version.price IS DISTINCT FROM (p_payload -> 'product_snapshot' ->> 'price')::numeric THEN
    RAISE EXCEPTION 'version_changed:%', COALESCE((
      SELECT a.price FROM public.product_versions a
       WHERE a.product_variant_id = v_version.product_variant_id AND a.status = 'active'), 0);
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
    workspace_id, contact_id, product_version_id, product_snapshot, base_amount, discount_amount, final_amount,
    discount_reason, status, financing_type, subscription_interval, sale_date, setter_id, vendedor_id,
    attribution, attribution_touch_id, attribution_type, booking_id, service_starts_at, notes, created_by, updated_by
  ) VALUES (
    v_ws, v_contact, v_version_id, p_payload -> 'product_snapshot', v_base, v_discount, v_final,
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
$$;

REVOKE ALL ON FUNCTION public.create_sale(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale(jsonb, uuid) TO service_role;

-- ------------------------------------------------------------
-- 11. Cancelar una venta (definitivo): pagos programados y morosos pasan a anulado,
--     los cobrados se conservan, la venta pasa a cancelled. Todo en una transaccion.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_sale(p_sale_id uuid, p_reason text, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.cancel_sale(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, text, uuid) TO service_role;

-- ------------------------------------------------------------
-- 12. La purga de 30 dias NO borra un contacto con ventas
-- ------------------------------------------------------------
-- Es la definicion de siempre; lo unico nuevo es el NOT EXISTS sobre `sales` en la primera
-- sentencia. Las ventas no se purgan nunca: el contacto de una venta se queda en la papelera.

CREATE OR REPLACE FUNCTION public.purge_soft_deleted(p_retention_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_cutoff     timestamptz := now() - make_interval(days => GREATEST(p_retention_days, 0));
  v_contacts   integer := 0;
  v_notes      integer := 0;
  v_convs      integer := 0;
  v_assets     integer := 0;
  v_schedules  integer := 0;
  v_ooo        integer := 0;
  v_events     integer := 0;
BEGIN
  DELETE FROM public.contacts c
   WHERE c.deleted_at IS NOT NULL AND c.deleted_at < v_cutoff
     AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.contact_id = c.id);
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_convs = ROW_COUNT;

  DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.response_assets WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_assets = ROW_COUNT;

  DELETE FROM public.availability_schedules WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_schedules = ROW_COUNT;

  DELETE FROM public.out_of_office WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_ooo = ROW_COUNT;

  -- Un evento con agendas NO se purga: la agenda guarda su historia y apunta
  -- al evento. (bookings llega en la 00099; antes de eso la condicion de
  -- existencia da falso y se purgan todos los borrados.)
  IF to_regclass('public.bookings') IS NULL THEN
    DELETE FROM public.event_types WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  ELSE
    EXECUTE '
      DELETE FROM public.event_types e
      WHERE e.deleted_at IS NOT NULL AND e.deleted_at < $1
        AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.event_type_id = e.id)
    ' USING v_cutoff;
  END IF;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_assets', v_assets,
    'availability_schedules', v_schedules,
    'out_of_office', v_ooo,
    'event_types', v_events
  );
END;
$function$;
