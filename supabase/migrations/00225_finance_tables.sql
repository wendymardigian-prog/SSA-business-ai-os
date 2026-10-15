-- ============================================================================
-- 00225 — Gastos, proveedores y recurrentes (Extra I, bloque G1, GF1)
-- ============================================================================
-- Tablas NUEVAS (aditiva): `vendors`, `recurring_expenses`, `expenses`. Y una columna en `workspaces`:
-- `finance_settings` (jsonb) con las 12 categorias de gasto precargadas y los gastos automaticos apagados.
-- No hay tablas de categorias ni de configuracion (decision del Extra I): categorias y automaticos viven en
-- ese jsonb y se leen con la sesion de cualquier miembro (no son datos sensibles); se escriben SOLO por
-- Server Action con el cliente de servicio, despues de `expenses.manage`.
--
--   1. workspaces.finance_settings (jsonb): { expense_categories, processor_fees, meta_ads, auto_close_days }.
--   2. vendors: proveedores (con `user_id`: una persona del equipo para liquidar comisiones).
--   3. recurring_expenses: plantillas de gastos que se repiten.
--   4. expenses: cada salida de plata. `category_key` (texto) valida contra el jsonb (trigger, EX001).
--      Origenes: manual, recurring, processor_fee, meta_ads, adjustment y commission_payout.
--   5. Triggers:
--        - expenses_validate_category (EX001): la categoria existe en la configuracion del workspace y, si
--          quien escribe es una PERSONA, no esta archivada (el trabajo diario puede generar con una archivada);
--        - expenses_guard: un pagado no cambia monto ni fechas; un anulado no se edita (salvo la reactivacion
--          de un automatico que el sistema anulo por quedar en cero); un automatico no se edita a mano; una
--          liquidacion de comisiones no cambia monto ni persona; origen, plantilla y ajuste no cambian nunca;
--          una persona solo da de alta gastos manuales o ajustes.
--   6. RLS: SELECT con `expenses.view`; INSERT/UPDATE con `expenses.manage`; sin DELETE (nada se borra).
--
-- Indices unicos de idempotencia (la verdad la dan los indices, no un SELECT previo):
--   - (recurring_expense_id, scheduled_date): un anulado sigue ocupando su fecha;
--   - (workspace_id, auto_key): un automatico por metodo/cuenta y mes.
--
-- Como volver atras (las tablas estan vacias al aplicar esta migracion):
--   DROP TABLE IF EXISTS public.expenses; DROP TABLE IF EXISTS public.recurring_expenses; DROP TABLE IF EXISTS public.vendors;
--   DROP FUNCTION IF EXISTS private.expenses_validate_category(); DROP FUNCTION IF EXISTS private.expenses_guard();
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS finance_settings;
-- Riesgo: bajo. Nada existente cambia; el codigo viejo ignora las tablas y la columna.
-- ============================================================================

SET search_path = '';

-- 1. Configuracion de Finanzas ---------------------------------------------------------------------------
-- El default es el mismo que `defaultFinanceSettings()` (lib/finance/settings.ts): un test los compara.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS finance_settings jsonb NOT NULL DEFAULT '{"expense_categories":[{"key":"ads_meta","name":"Publicidad (Meta)","color":"#2563eb","group":"adquisicion","system":true,"archived_at":null},{"key":"marketing","name":"Marketing y contenido","color":"#7c3aed","group":"adquisicion","system":true,"archived_at":null},{"key":"sales_team","name":"Equipo de ventas","color":"#db2777","group":"adquisicion","system":true,"archived_at":null},{"key":"commissions","name":"Comisiones del equipo","color":"#e11d48","group":"adquisicion","system":true,"archived_at":null},{"key":"delivery_team","name":"Equipo de entrega","color":"#0d9488","group":"entrega","system":true,"archived_at":null},{"key":"delivery_tools","name":"Herramientas de entrega","color":"#16a34a","group":"entrega","system":true,"archived_at":null},{"key":"software","name":"Software y suscripciones","color":"#ca8a04","group":"operacion","system":true,"archived_at":null},{"key":"processor_fees","name":"Comisiones de procesador","color":"#ea580c","group":"operacion","system":true,"archived_at":null},{"key":"professional","name":"Contabilidad y legal","color":"#4f46e5","group":"operacion","system":true,"archived_at":null},{"key":"admin_team","name":"Equipo administrativo","color":"#0891b2","group":"operacion","system":true,"archived_at":null},{"key":"taxes","name":"Impuestos","color":"#64748b","group":"otro","system":true,"archived_at":null},{"key":"other","name":"Otros","color":"#78716c","group":"otro","system":true,"archived_at":null}],"processor_fees":{},"meta_ads":{},"auto_close_days":3}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_finance_settings_check' AND conrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_finance_settings_check
      CHECK (jsonb_typeof(finance_settings) = 'object' AND COALESCE(jsonb_typeof(finance_settings -> 'expense_categories'), '') = 'array');
  END IF;
END $$;

COMMENT ON COLUMN public.workspaces.finance_settings IS
  'Configuracion de Finanzas: { expense_categories:[{key,name,color,group,system,archived_at}], processor_fees:{}, meta_ads:{}, auto_close_days }. La key de una categoria no cambia nunca; no se borran, se archivan. Se escribe solo por Server Action (expenses.manage).';

-- 2. Proveedores -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  country text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  email text CHECK (email IS NULL OR char_length(email) <= 200),
  payment_details text CHECK (payment_details IS NULL OR char_length(payment_details) <= 1000),
  terms text CHECK (terms IS NULL OR char_length(terms) <= 200),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  -- Una persona del equipo (liquidaciones de comisiones). Su nombre sale del miembro.
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_active_name ON public.vendors (workspace_id, lower(btrim(name))) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_user ON public.vendors (workspace_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_workspace_archived ON public.vendors (workspace_id, archived_at);

-- 3. Plantillas recurrentes ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  concept text NOT NULL CHECK (char_length(btrim(concept)) BETWEEN 1 AND 200),
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  category_key text NOT NULL,
  amount_type text NOT NULL CHECK (amount_type IN ('fixed', 'variable')),
  amount numeric(12,2),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  charge_mode text NOT NULL CHECK (charge_mode IN ('automatic', 'manual')),
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'yearly')),
  weekly_day smallint CHECK (weekly_day BETWEEN 0 AND 6),
  weekly_interval smallint CHECK (weekly_interval BETWEEN 1 AND 52),
  monthly_day smallint CHECK (monthly_day BETWEEN 1 AND 31),
  yearly_month smallint CHECK (yearly_month BETWEEN 1 AND 12),
  yearly_day smallint CHECK (yearly_day BETWEEN 1 AND 31),
  start_date date NOT NULL,
  end_date date,
  lead_days smallint NOT NULL DEFAULT 0 CHECK (lead_days BETWEEN 0 AND 60),
  is_active boolean NOT NULL DEFAULT true,
  paused_at timestamptz,
  -- Desde que fecha de pago genera el trabajo diario. Se pone en hoy al crear, al reactivar y al editar.
  generation_anchor date NOT NULL,
  responsible_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_end_after_start CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT recurring_fixed_needs_amount CHECK (amount_type <> 'fixed' OR (amount IS NOT NULL AND amount > 0)),
  CONSTRAINT recurring_variable_amount CHECK (amount_type <> 'variable' OR amount IS NULL OR amount > 0),
  CONSTRAINT recurring_automatic_no_lead CHECK (charge_mode <> 'automatic' OR lead_days = 0),
  CONSTRAINT recurring_frequency_fields CHECK (
    (frequency = 'weekly'   AND weekly_day IS NOT NULL AND weekly_interval IS NOT NULL AND monthly_day IS NULL AND yearly_month IS NULL AND yearly_day IS NULL) OR
    (frequency = 'biweekly' AND weekly_day IS NULL AND weekly_interval IS NULL AND monthly_day IS NULL AND yearly_month IS NULL AND yearly_day IS NULL) OR
    (frequency = 'monthly'  AND weekly_day IS NULL AND weekly_interval IS NULL AND monthly_day IS NOT NULL AND yearly_month IS NULL AND yearly_day IS NULL) OR
    (frequency = 'yearly'   AND weekly_day IS NULL AND weekly_interval IS NULL AND monthly_day IS NULL AND yearly_month IS NOT NULL AND yearly_day IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_workspace_active ON public.recurring_expenses (workspace_id, is_active);

-- 4. Gastos --------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  concept text NOT NULL CHECK (char_length(btrim(concept)) BETWEEN 1 AND 200),
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  category_key text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  status text NOT NULL CHECK (status IN ('por_revisar', 'programado', 'vencido', 'pagado', 'anulado')),
  scheduled_date date NOT NULL,
  paid_date date,
  paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  origin text NOT NULL CHECK (origin IN ('manual', 'recurring', 'processor_fee', 'meta_ads', 'adjustment', 'commission_payout')),
  recurring_expense_id uuid REFERENCES public.recurring_expenses(id) ON DELETE RESTRICT,
  auto_key text,
  source_ref jsonb,
  auto_drift_amount numeric(12,2),
  auto_drift_detected_at timestamptz,
  auto_drift_resolved_at timestamptz,
  adjusts_expense_id uuid REFERENCES public.expenses(id) ON DELETE RESTRICT,
  receipt_path text,
  receipt_name text,
  responsible_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  void_reason text,
  void_kind text CHECK (void_kind IS NULL OR void_kind IN ('manual', 'auto_zero')),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Pagado si y solo si tiene fecha de pago efectiva.
  CONSTRAINT expenses_paid_iff_date CHECK ((status = 'pagado') = (paid_date IS NOT NULL)),
  CONSTRAINT expenses_void_fields CHECK ((status = 'anulado') = (voided_at IS NOT NULL AND void_reason IS NOT NULL AND void_kind IS NOT NULL)),
  -- Cero solo en Por revisar (o en un anulado que lo era); negativo solo en un ajuste.
  CONSTRAINT expenses_amount_rules CHECK (
    (origin = 'adjustment' AND amount <> 0) OR
    (origin <> 'adjustment' AND amount >= 0 AND (amount > 0 OR status IN ('por_revisar', 'anulado')))
  ),
  CONSTRAINT expenses_recurring_origin CHECK ((origin = 'recurring') = (recurring_expense_id IS NOT NULL)),
  CONSTRAINT expenses_auto_key_origin CHECK ((origin IN ('processor_fee', 'meta_ads')) = (auto_key IS NOT NULL)),
  CONSTRAINT expenses_adjustment_origin CHECK ((origin = 'adjustment') = (adjusts_expense_id IS NOT NULL)),
  -- Una liquidacion por persona siempre tiene a la persona como proveedor; la unica excepcion es el modo «un solo gasto».
  CONSTRAINT expenses_payout_vendor CHECK (origin <> 'commission_payout' OR vendor_id IS NOT NULL OR COALESCE(source_ref ->> 'mode', '') = 'single')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_recurring_date ON public.expenses (recurring_expense_id, scheduled_date) WHERE recurring_expense_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_auto_key ON public.expenses (workspace_id, auto_key) WHERE auto_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_status_date ON public.expenses (workspace_id, status, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_expenses_paid ON public.expenses (workspace_id, paid_date) WHERE status = 'pagado';
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses (workspace_id, category_key);
CREATE INDEX IF NOT EXISTS idx_expenses_vendor ON public.expenses (workspace_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_expenses_adjusts ON public.expenses (adjusts_expense_id) WHERE adjusts_expense_id IS NOT NULL;

COMMENT ON TABLE public.expenses IS 'Gastos del negocio. Nada se borra: se anula. La plata es USD. Ver docs/finanzas.md.';

-- 5. Triggers ------------------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS vendors_updated_at ON public.vendors;
CREATE TRIGGER vendors_updated_at BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS recurring_expenses_updated_at ON public.recurring_expenses;
CREATE TRIGGER recurring_expenses_updated_at BEFORE UPDATE ON public.recurring_expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS expenses_updated_at ON public.expenses;
CREATE TRIGGER expenses_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- La categoria tiene que existir en la configuracion del workspace; una PERSONA no puede elegir una archivada.
CREATE OR REPLACE FUNCTION private.expenses_validate_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cat jsonb;
BEGIN
  SELECT c INTO v_cat
    FROM public.workspaces w, jsonb_array_elements(w.finance_settings -> 'expense_categories') AS c
   WHERE w.id = NEW.workspace_id
     AND c ->> 'key' = NEW.category_key
   LIMIT 1;
  IF v_cat IS NULL THEN
    RAISE EXCEPTION 'La categoria % no existe en este negocio', NEW.category_key USING ERRCODE = 'EX001';
  END IF;
  IF COALESCE(auth.role(), '') = 'authenticated'
     AND v_cat ->> 'archived_at' IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.category_key IS DISTINCT FROM OLD.category_key) THEN
    RAISE EXCEPTION 'La categoria % esta archivada', NEW.category_key USING ERRCODE = 'EX001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.expenses_validate_category() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS expenses_validate_category ON public.expenses;
CREATE TRIGGER expenses_validate_category
  BEFORE INSERT OR UPDATE OF category_key ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION private.expenses_validate_category();

DROP TRIGGER IF EXISTS recurring_expenses_validate_category ON public.recurring_expenses;
CREATE TRIGGER recurring_expenses_validate_category
  BEFORE INSERT OR UPDATE OF category_key ON public.recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION private.expenses_validate_category();

-- Las protecciones que valen para CUALQUIER cliente (tambien una persona con la consola).
-- «Una persona» = una sesion con rol `authenticated`; el servicio y el SQL directo son «el sistema».
CREATE OR REPLACE FUNCTION private.expenses_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user boolean := COALESCE(auth.role(), '') = 'authenticated';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_user AND NEW.origin NOT IN ('manual', 'adjustment') THEN
      RAISE EXCEPTION 'Una persona solo da de alta gastos manuales o ajustes' USING ERRCODE = 'EX002';
    END IF;
    RETURN NEW;
  END IF;

  -- Lo que no cambia nunca.
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.recurring_expense_id IS DISTINCT FROM OLD.recurring_expense_id
     OR NEW.adjusts_expense_id IS DISTINCT FROM OLD.adjusts_expense_id THEN
    RAISE EXCEPTION 'El origen de un gasto no se cambia' USING ERRCODE = 'EX002';
  END IF;
  IF v_user AND NEW.auto_key IS DISTINCT FROM OLD.auto_key THEN
    RAISE EXCEPTION 'La clave de un gasto automatico no se cambia' USING ERRCODE = 'EX002';
  END IF;

  -- Un anulado es final: solo el sistema reactiva el que el mismo sistema anulo por quedar en cero.
  IF OLD.status = 'anulado' AND NOT (NOT v_user AND OLD.void_kind = 'auto_zero') THEN
    RAISE EXCEPTION 'Un gasto anulado no se edita' USING ERRCODE = 'EX002';
  END IF;

  -- Un pagado no cambia monto ni fechas: se revierte primero.
  IF OLD.status = 'pagado' AND NEW.status = 'pagado'
     AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.paid_date IS DISTINCT FROM OLD.paid_date OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date) THEN
    RAISE EXCEPTION 'Revertí el pago primero para cambiar el monto o las fechas' USING ERRCODE = 'EX002';
  END IF;

  -- Un automatico no pagado lo recalcula el sistema.
  IF v_user AND OLD.origin IN ('processor_fee', 'meta_ads') AND OLD.status <> 'pagado'
     AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.concept IS DISTINCT FROM OLD.concept) THEN
    RAISE EXCEPTION 'Este monto lo calcula el sistema todos los dias' USING ERRCODE = 'EX002';
  END IF;

  -- El monto de una liquidacion es la suma de sus comisiones: para cambiarlo se anula y se genera de nuevo.
  IF v_user AND OLD.origin = 'commission_payout'
     AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id OR NEW.source_ref IS DISTINCT FROM OLD.source_ref) THEN
    RAISE EXCEPTION 'El monto de una liquidacion de comisiones no se cambia: anulala y generala de nuevo' USING ERRCODE = 'EX002';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.expenses_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS expenses_guard ON public.expenses;
CREATE TRIGGER expenses_guard
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION private.expenses_guard();

-- 6. RLS: sin DELETE (nada se borra) --------------------------------------------------------------------------
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  p record;
BEGIN
  -- Cada tabla nace SOLO con sus politicas: se borran las que hubiera con otro nombre.
  FOREACH t IN ARRAY ARRAY['vendors', 'recurring_expenses', 'expenses'] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((select public.has_permission(workspace_id, 'expenses.view')))$f$, t || '_select', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((select public.has_permission(workspace_id, 'expenses.manage')))$f$, t || '_insert', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((select public.has_permission(workspace_id, 'expenses.manage'))) WITH CHECK ((select public.has_permission(workspace_id, 'expenses.manage')))$f$, t || '_update', t);
  END LOOP;
END $$;

REVOKE ALL ON public.vendors, public.recurring_expenses, public.expenses FROM anon;
REVOKE DELETE ON public.vendors, public.recurring_expenses, public.expenses FROM authenticated;

-- Permisos explicitos (un proyecto nuevo no da acceso por defecto): la app lee, crea y edita con la sesion (la RLS decide
-- quien) y nunca borra; el servidor puede todo.
GRANT SELECT, INSERT, UPDATE ON public.vendors TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.recurring_expenses TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.expenses TO authenticated;
GRANT ALL ON public.vendors TO service_role;
GRANT ALL ON public.recurring_expenses TO service_role;
GRANT ALL ON public.expenses TO service_role;
