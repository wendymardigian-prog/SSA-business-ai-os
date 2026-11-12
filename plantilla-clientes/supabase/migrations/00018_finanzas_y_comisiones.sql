-- ============================================================================
-- Finanzas y comisiones
--
-- Gastos (manuales, que se repiten y automaticos), proveedores y comisiones: una
-- comision por pago cobrado y rol, calculada con las reglas del negocio, y su liquidacion
-- como gasto. Nada se borra: se anula, se pausa o se archiva.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commission_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  "position" integer NOT NULL,
  conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
  calc_type text NOT NULL,
  rate numeric(6,3),
  fixed_amount numeric(12,2),
  base text DEFAULT 'gross'::text NOT NULL,
  beneficiary_user_id uuid,
  hold_days smallint DEFAULT 0 NOT NULL,
  valid_from date,
  valid_until date,
  is_active boolean DEFAULT true NOT NULL,
  archived_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  on_departure text DEFAULT 'keep'::text NOT NULL,
  when_also_seller text DEFAULT 'both'::text NOT NULL,
  CONSTRAINT commission_rules_pkey PRIMARY KEY (id),
  CONSTRAINT uq_commission_rules_position EXCLUDE USING btree (workspace_id WITH =, role WITH =, "position" WITH =) WHERE ((archived_at IS NULL)) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT commission_rules_base_check CHECK ((base = ANY (ARRAY['gross'::text, 'net_of_fees'::text]))),
  CONSTRAINT commission_rules_calc_type_check CHECK ((calc_type = ANY (ARRAY['percent'::text, 'fixed'::text]))),
  CONSTRAINT commission_rules_conditions_check CHECK ((jsonb_typeof(conditions) = 'object'::text)),
  CONSTRAINT commission_rules_fixed CHECK (((calc_type <> 'fixed'::text) OR ((fixed_amount IS NOT NULL) AND (fixed_amount > (0)::numeric)))),
  CONSTRAINT commission_rules_hold_days_check CHECK (((hold_days >= 0) AND (hold_days <= 365))),
  CONSTRAINT commission_rules_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
  CONSTRAINT commission_rules_on_departure_check CHECK ((on_departure = ANY (ARRAY['keep'::text, 'stop'::text, 'reassign'::text]))),
  CONSTRAINT commission_rules_position_check CHECK (("position" >= 1)),
  CONSTRAINT commission_rules_rate CHECK (((calc_type <> 'percent'::text) OR ((rate IS NOT NULL) AND (rate > (0)::numeric) AND (rate <= (100)::numeric)))),
  CONSTRAINT commission_rules_validity CHECK (((valid_from IS NULL) OR (valid_until IS NULL) OR (valid_until >= valid_from))),
  CONSTRAINT commission_rules_when_also_seller_check CHECK ((when_also_seller = ANY (ARRAY['both'::text, 'max'::text]))),
  CONSTRAINT commission_rules_beneficiary_user_id_fkey FOREIGN KEY (beneficiary_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT commission_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT commission_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT commission_rules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.commission_rules IS 'Reglas de comision por rol. Se escriben solo desde el servidor. Nada se borra: se archivan.';
REVOKE ALL ON TABLE public.commission_rules FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.commission_rules FROM authenticated;

CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  country text,
  email text,
  payment_details text,
  terms text,
  notes text,
  user_id uuid,
  archived_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  contact_id uuid,
  CONSTRAINT vendors_pkey PRIMARY KEY (id),
  CONSTRAINT vendors_country_check CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text))),
  CONSTRAINT vendors_email_check CHECK (((email IS NULL) OR (char_length(email) <= 200))),
  CONSTRAINT vendors_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
  CONSTRAINT vendors_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 2000))),
  CONSTRAINT vendors_payment_details_check CHECK (((payment_details IS NULL) OR (char_length(payment_details) <= 1000))),
  CONSTRAINT vendors_terms_check CHECK (((terms IS NULL) OR (char_length(terms) <= 200))),
  CONSTRAINT vendors_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT vendors_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT vendors_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT vendors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT vendors_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vendors FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.vendors FROM authenticated;

CREATE TABLE IF NOT EXISTS public.recurring_expenses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  concept text NOT NULL,
  vendor_id uuid,
  category_key text NOT NULL,
  amount_type text NOT NULL,
  amount numeric(12,2),
  currency text DEFAULT 'USD'::text NOT NULL,
  charge_mode text NOT NULL,
  frequency text NOT NULL,
  weekly_day smallint,
  weekly_interval smallint,
  monthly_day smallint,
  yearly_month smallint,
  yearly_day smallint,
  start_date date NOT NULL,
  end_date date,
  lead_days smallint DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  paused_at timestamp with time zone,
  generation_anchor date NOT NULL,
  responsible_id uuid,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT recurring_expenses_pkey PRIMARY KEY (id),
  CONSTRAINT recurring_automatic_no_lead CHECK (((charge_mode <> 'automatic'::text) OR (lead_days = 0))),
  CONSTRAINT recurring_end_after_start CHECK (((end_date IS NULL) OR (end_date >= start_date))),
  CONSTRAINT recurring_expenses_amount_type_check CHECK ((amount_type = ANY (ARRAY['fixed'::text, 'variable'::text]))),
  CONSTRAINT recurring_expenses_charge_mode_check CHECK ((charge_mode = ANY (ARRAY['automatic'::text, 'manual'::text]))),
  CONSTRAINT recurring_expenses_concept_check CHECK (((char_length(btrim(concept)) >= 1) AND (char_length(btrim(concept)) <= 200))),
  CONSTRAINT recurring_expenses_currency_check CHECK ((currency = 'USD'::text)),
  CONSTRAINT recurring_expenses_frequency_check CHECK ((frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'yearly'::text]))),
  CONSTRAINT recurring_expenses_lead_days_check CHECK (((lead_days >= 0) AND (lead_days <= 60))),
  CONSTRAINT recurring_expenses_monthly_day_check CHECK (((monthly_day >= 1) AND (monthly_day <= 31))),
  CONSTRAINT recurring_expenses_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 2000))),
  CONSTRAINT recurring_expenses_weekly_day_check CHECK (((weekly_day >= 0) AND (weekly_day <= 6))),
  CONSTRAINT recurring_expenses_weekly_interval_check CHECK (((weekly_interval >= 1) AND (weekly_interval <= 52))),
  CONSTRAINT recurring_expenses_yearly_day_check CHECK (((yearly_day >= 1) AND (yearly_day <= 31))),
  CONSTRAINT recurring_expenses_yearly_month_check CHECK (((yearly_month >= 1) AND (yearly_month <= 12))),
  CONSTRAINT recurring_fixed_needs_amount CHECK (((amount_type <> 'fixed'::text) OR ((amount IS NOT NULL) AND (amount > (0)::numeric)))),
  CONSTRAINT recurring_frequency_fields CHECK ((((frequency = 'weekly'::text) AND (weekly_day IS NOT NULL) AND (weekly_interval IS NOT NULL) AND (monthly_day IS NULL) AND (yearly_month IS NULL) AND (yearly_day IS NULL)) OR ((frequency = 'biweekly'::text) AND (weekly_day IS NULL) AND (weekly_interval IS NULL) AND (monthly_day IS NULL) AND (yearly_month IS NULL) AND (yearly_day IS NULL)) OR ((frequency = 'monthly'::text) AND (weekly_day IS NULL) AND (weekly_interval IS NULL) AND (monthly_day IS NOT NULL) AND (yearly_month IS NULL) AND (yearly_day IS NULL)) OR ((frequency = 'yearly'::text) AND (weekly_day IS NULL) AND (weekly_interval IS NULL) AND (monthly_day IS NULL) AND (yearly_month IS NOT NULL) AND (yearly_day IS NOT NULL)))),
  CONSTRAINT recurring_variable_amount CHECK (((amount_type <> 'variable'::text) OR (amount IS NULL) OR (amount > (0)::numeric))),
  CONSTRAINT recurring_expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT recurring_expenses_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT recurring_expenses_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT recurring_expenses_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE RESTRICT,
  CONSTRAINT recurring_expenses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recurring_expenses FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.recurring_expenses FROM authenticated;

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  concept text NOT NULL,
  vendor_id uuid,
  category_key text NOT NULL,
  amount numeric(12,2) DEFAULT 0 NOT NULL,
  currency text DEFAULT 'USD'::text NOT NULL,
  status text NOT NULL,
  scheduled_date date NOT NULL,
  paid_date date,
  paid_by uuid,
  origin text NOT NULL,
  recurring_expense_id uuid,
  auto_key text,
  source_ref jsonb,
  auto_drift_amount numeric(12,2),
  auto_drift_detected_at timestamp with time zone,
  auto_drift_resolved_at timestamp with time zone,
  adjusts_expense_id uuid,
  receipt_path text,
  receipt_name text,
  responsible_id uuid,
  notes text,
  void_reason text,
  void_kind text,
  voided_at timestamp with time zone,
  voided_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT expenses_pkey PRIMARY KEY (id),
  CONSTRAINT expenses_adjustment_origin CHECK (((origin = 'adjustment'::text) = (adjusts_expense_id IS NOT NULL))),
  CONSTRAINT expenses_amount_rules CHECK ((((origin = 'adjustment'::text) AND (amount <> (0)::numeric)) OR ((origin <> 'adjustment'::text) AND (amount >= (0)::numeric) AND ((amount > (0)::numeric) OR (status = ANY (ARRAY['por_revisar'::text, 'anulado'::text])))))),
  CONSTRAINT expenses_auto_key_origin CHECK (((origin = ANY (ARRAY['processor_fee'::text, 'meta_ads'::text])) = (auto_key IS NOT NULL))),
  CONSTRAINT expenses_concept_check CHECK (((char_length(btrim(concept)) >= 1) AND (char_length(btrim(concept)) <= 200))),
  CONSTRAINT expenses_currency_check CHECK ((currency = 'USD'::text)),
  CONSTRAINT expenses_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 2000))),
  CONSTRAINT expenses_origin_check CHECK ((origin = ANY (ARRAY['manual'::text, 'recurring'::text, 'processor_fee'::text, 'meta_ads'::text, 'adjustment'::text, 'commission_payout'::text]))),
  CONSTRAINT expenses_paid_iff_date CHECK (((status = 'pagado'::text) = (paid_date IS NOT NULL))),
  CONSTRAINT expenses_payout_vendor CHECK (((origin <> 'commission_payout'::text) OR (vendor_id IS NOT NULL) OR (COALESCE((source_ref ->> 'mode'::text), ''::text) = 'single'::text))),
  CONSTRAINT expenses_recurring_origin CHECK (((origin = 'recurring'::text) = (recurring_expense_id IS NOT NULL))),
  CONSTRAINT expenses_status_check CHECK ((status = ANY (ARRAY['por_revisar'::text, 'programado'::text, 'vencido'::text, 'pagado'::text, 'anulado'::text]))),
  CONSTRAINT expenses_void_fields CHECK (((status = 'anulado'::text) = ((voided_at IS NOT NULL) AND (void_reason IS NOT NULL) AND (void_kind IS NOT NULL)))),
  CONSTRAINT expenses_void_kind_check CHECK (((void_kind IS NULL) OR (void_kind = ANY (ARRAY['manual'::text, 'auto_zero'::text])))),
  CONSTRAINT expenses_adjusts_expense_id_fkey FOREIGN KEY (adjusts_expense_id) REFERENCES public.expenses(id) ON DELETE RESTRICT,
  CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT expenses_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT expenses_recurring_expense_id_fkey FOREIGN KEY (recurring_expense_id) REFERENCES public.recurring_expenses(id) ON DELETE RESTRICT,
  CONSTRAINT expenses_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT expenses_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT expenses_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE RESTRICT,
  CONSTRAINT expenses_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT expenses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.expenses IS 'Gastos del negocio. Nada se borra: se anula. La plata es USD. Ver docs/finanzas.md.';
REVOKE ALL ON TABLE public.expenses FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.expenses FROM authenticated;

CREATE TABLE IF NOT EXISTS public.commissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  kind text NOT NULL,
  role text,
  user_id uuid,
  payment_id uuid,
  sale_id uuid,
  rule_id uuid,
  rule_snapshot jsonb,
  base_amount numeric(12,2),
  amount numeric(12,2) NOT NULL,
  currency text DEFAULT 'USD'::text NOT NULL,
  attribution_touch_id uuid,
  attribution_snapshot jsonb,
  paid_on date,
  available_on date NOT NULL,
  expense_id uuid,
  voided_at timestamp with time zone,
  voided_by uuid,
  void_reason text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  contact_id uuid,
  edited_manually boolean DEFAULT false NOT NULL,
  CONSTRAINT commissions_pkey PRIMARY KEY (id),
  CONSTRAINT commissions_adjustment_shape CHECK (((kind <> 'adjustment'::text) OR ((amount <> (0)::numeric) AND (rule_id IS NULL) AND (notes IS NOT NULL) AND (btrim(notes) <> ''::text)))),
  CONSTRAINT commissions_currency_check CHECK ((currency = 'USD'::text)),
  CONSTRAINT commissions_earned_shape CHECK (((kind <> 'earned'::text) OR ((role IS NOT NULL) AND (payment_id IS NOT NULL) AND (sale_id IS NOT NULL) AND (rule_id IS NOT NULL) AND (amount >= (0)::numeric)))),
  CONSTRAINT commissions_kind_check CHECK ((kind = ANY (ARRAY['earned'::text, 'adjustment'::text]))),
  CONSTRAINT commissions_one_payee CHECK ((NOT ((user_id IS NOT NULL) AND (contact_id IS NOT NULL)))),
  CONSTRAINT commissions_void_reason CHECK (((voided_at IS NULL) OR ((void_reason IS NOT NULL) AND (btrim(void_reason) <> ''::text)))),
  CONSTRAINT commissions_attribution_touch_id_fkey FOREIGN KEY (attribution_touch_id) REFERENCES public.contact_touches(id) ON DELETE SET NULL,
  CONSTRAINT commissions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT commissions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT commissions_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id),
  CONSTRAINT commissions_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id),
  CONSTRAINT commissions_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.commission_rules(id),
  CONSTRAINT commissions_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id),
  CONSTRAINT commissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT commissions_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT commissions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.commissions IS 'Lo ganado por cada persona (kind earned) y los ajustes a mano (adjustment). La app solo lee; escribe el servidor. El estado de pago se lee del gasto, nunca se copia.';
COMMENT ON COLUMN public.commissions.edited_manually IS 'La comision la edito una persona (F107): la generacion y la reversion no la pisan.';
REVOKE ALL ON TABLE public.commissions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.commissions FROM authenticated;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.cm_audit(p_workspace uuid, p_entity text, p_entity_id uuid, p_action text, p_changes jsonb, p_metadata jsonb, p_actor uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type, actor_label)
  VALUES (p_workspace, p_entity, p_entity_id, p_action, p_changes, p_metadata, p_actor,
          CASE WHEN p_actor IS NULL THEN 'system' ELSE 'user' END,
          CASE WHEN p_actor IS NULL THEN 'Comisiones' ELSE NULL END);
$function$;
REVOKE ALL ON FUNCTION private.cm_audit(p_workspace uuid, p_entity text, p_entity_id uuid, p_action text, p_changes jsonb, p_metadata jsonb, p_actor uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cm_in_list(p_values text[], p_actual text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT cardinality(p_values) = 0 OR (p_actual IS NOT NULL AND p_actual = ANY (p_values));
$function$;
REVOKE ALL ON FUNCTION private.cm_in_list(p_values text[], p_actual text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cm_list(p_json jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN jsonb_typeof(p_json) = 'array'
              THEN COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_json)), ARRAY[]::text[])
              ELSE ARRAY[]::text[] END;
$function$;
REVOKE ALL ON FUNCTION private.cm_list(p_json jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cm_norm(p_value text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT lower(btrim(COALESCE(private.meta_url_decode(p_value), '')));
$function$;
REVOKE ALL ON FUNCTION private.cm_norm(p_value text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.cm_sale_person(p_payee text, p_facts jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_payee
    WHEN 'sale_vendedor' THEN p_facts -> 'sale' ->> 'vendedor_id'
    WHEN 'sale_setter' THEN p_facts -> 'sale' ->> 'setter_id'
    WHEN 'content_assignee' THEN p_facts ->> 'content_assignee_id'
    WHEN 'sale_affiliate' THEN p_facts -> 'sale' ->> 'affiliate_user_id'
    ELSE NULL END;
$function$;
REVOKE ALL ON FUNCTION private.cm_sale_person(p_payee text, p_facts jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.commission_failed_dimension(p_rule public.commission_rules, p_facts jsonb, p_payee text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  c jsonb := CASE WHEN jsonb_typeof(p_rule.conditions) = 'object' THEN p_rule.conditions ELSE '{}'::jsonb END;
  f_sale jsonb := COALESCE(p_facts -> 'sale', '{}'::jsonb);
  f_pay jsonb := COALESCE(p_facts -> 'payment', '{}'::jsonb);
  touch jsonb := CASE WHEN jsonb_typeof(p_facts -> 'touch') = 'object' THEN p_facts -> 'touch' ELSE NULL END;
  v_vals text[];
  v_actual text;
  v_dim text;
  v_cond jsonb;
  v_num int;
  v_from numeric;
  v_to numeric;
  v_cents bigint;
  v_paid_on date;
BEGIN
  v_vals := private.cm_list(c -> 'user_ids');
  IF cardinality(v_vals) > 0 AND p_payee <> 'fixed' AND NOT private.cm_in_list(v_vals, private.cm_sale_person(p_payee, p_facts)) THEN RETURN 'user_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'vendedor_ids'), f_sale ->> 'vendedor_id') THEN RETURN 'vendedor_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'setter_ids'), f_sale ->> 'setter_id') THEN RETURN 'setter_ids'; END IF;
  -- Afiliados (00343, F75): el tipo de asignacion de la venta (lo trajo / influyo). Sin afiliado, no se cumple.
  IF NOT private.cm_in_list(private.cm_list(c -> 'affiliate_kinds'), f_sale ->> 'affiliate_kind') THEN RETURN 'affiliate_kinds'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'product_ids'), f_sale ->> 'product_id') THEN RETURN 'product_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'variant_ids'), f_sale ->> 'variant_id') THEN RETURN 'variant_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'financing_types'), f_sale ->> 'financing_type') THEN RETURN 'financing_types'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'payment_methods'), f_pay ->> 'method') THEN RETURN 'payment_methods'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'payment_types'), f_pay ->> 'type') THEN RETURN 'payment_types'; END IF;
  -- Sin toque (o un toque sin canal) el canal es `direct`.
  IF NOT private.cm_in_list(private.cm_list(c -> 'channels'), COALESCE(NULLIF(touch ->> 'channel', ''), 'direct')) THEN RETURN 'channels'; END IF;

  v_vals := ARRAY(SELECT private.cm_norm(x) FROM unnest(private.cm_list(c -> 'platforms')) x WHERE private.cm_norm(x) <> '');
  IF cardinality(v_vals) > 0 AND NOT (private.cm_norm(touch ->> 'source') = ANY (v_vals)) THEN RETURN 'platforms'; END IF;

  IF NOT private.cm_in_list(private.cm_list(c -> 'content_post_ids'), touch ->> 'content_post_id') THEN RETURN 'content_post_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'meta_campaign_ids'), touch ->> 'meta_campaign_id') THEN RETURN 'meta_campaign_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'meta_ad_ids'), touch ->> 'meta_ad_id') THEN RETURN 'meta_ad_ids'; END IF;

  FOREACH v_dim IN ARRAY ARRAY['source', 'medium', 'campaign', 'content', 'term'] LOOP
    v_cond := c -> 'utm' -> v_dim;
    v_vals := ARRAY(SELECT private.cm_norm(x) FROM unnest(private.cm_list(v_cond -> 'values')) x WHERE private.cm_norm(x) <> '');
    CONTINUE WHEN cardinality(v_vals) = 0; -- dimension vacia = cualquiera
    v_actual := CASE WHEN touch IS NULL THEN '' ELSE private.cm_norm(touch ->> v_dim) END;
    IF v_actual = '' THEN RETURN 'utm.' || v_dim; END IF;
    IF (v_cond ->> 'op') = 'contains' THEN
      IF NOT EXISTS (SELECT 1 FROM unnest(v_vals) v WHERE position(v IN v_actual) > 0) THEN RETURN 'utm.' || v_dim; END IF;
    ELSE
      IF NOT (v_actual = ANY (v_vals)) THEN RETURN 'utm.' || v_dim; END IF;
    END IF;
  END LOOP;

  IF jsonb_typeof(c -> 'payment_number') = 'object' THEN
    v_num := COALESCE((f_pay ->> 'number')::int, 0);
    IF jsonb_typeof(c -> 'payment_number' -> 'from') = 'number' AND v_num < (c -> 'payment_number' ->> 'from')::numeric THEN RETURN 'payment_number'; END IF;
    IF jsonb_typeof(c -> 'payment_number' -> 'to') = 'number' AND v_num > (c -> 'payment_number' ->> 'to')::numeric THEN RETURN 'payment_number'; END IF;
  END IF;

  IF jsonb_typeof(c -> 'sale_amount') = 'object' THEN
    v_cents := round(COALESCE((f_sale ->> 'final_amount')::numeric, 0) * 100)::bigint;
    IF jsonb_typeof(c -> 'sale_amount' -> 'min') = 'number' THEN
      v_from := round((c -> 'sale_amount' ->> 'min')::numeric * 100);
      IF v_cents < v_from THEN RETURN 'sale_amount'; END IF;
    END IF;
    IF jsonb_typeof(c -> 'sale_amount' -> 'max') = 'number' THEN
      v_to := round((c -> 'sale_amount' ->> 'max')::numeric * 100);
      IF v_cents > v_to THEN RETURN 'sale_amount'; END IF;
    END IF;
  END IF;

  v_paid_on := NULLIF(f_pay ->> 'paid_on', '')::date;
  IF v_paid_on IS NOT NULL THEN
    IF p_rule.valid_from IS NOT NULL AND v_paid_on < p_rule.valid_from THEN RETURN 'validity'; END IF;
    IF p_rule.valid_until IS NOT NULL AND v_paid_on > p_rule.valid_until THEN RETURN 'validity'; END IF;
  END IF;

  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.commission_failed_dimension(p_rule public.commission_rules, p_facts jsonb, p_payee text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.commission_role_valid(p_workspace_id uuid, p_role text, p_require_active boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((
    SELECT bool_or(r ->> 'key' = p_role AND (NOT p_require_active OR COALESCE((r ->> 'active')::boolean, false)))
      FROM public.workspaces w, jsonb_array_elements(w.commission_settings -> 'roles') r
     WHERE w.id = p_workspace_id
  ), false);
$function$;
REVOKE ALL ON FUNCTION private.commission_role_valid(p_workspace_id uuid, p_role text, p_require_active boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.commission_rules_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_payee text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT private.commission_role_valid(NEW.workspace_id, NEW.role, true) THEN
      RAISE EXCEPTION 'El rol "%" no existe o esta desactivado.', NEW.role USING ERRCODE = 'CM001';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT r ->> 'payee' INTO v_payee
      FROM public.workspaces w, jsonb_array_elements(w.commission_settings -> 'roles') r
     WHERE w.id = NEW.workspace_id AND r ->> 'key' = NEW.role;
    IF v_payee = 'fixed' AND NEW.beneficiary_user_id IS NULL THEN
      RAISE EXCEPTION 'Una regla de un rol de persona fija necesita la persona.' USING ERRCODE = 'CM001';
    END IF;
  END IF;

  IF NEW.beneficiary_user_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.beneficiary_user_id IS DISTINCT FROM OLD.beneficiary_user_id)
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.beneficiary_user_id) THEN
    RAISE EXCEPTION 'La persona de la regla tiene que ser parte del equipo.' USING ERRCODE = 'CM001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.commission_rules_validate() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.commission_settings_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_keys text[];
BEGIN
  IF NEW.commission_settings IS NOT DISTINCT FROM OLD.commission_settings THEN
    RETURN NEW;
  END IF;

  FOR v_old IN SELECT * FROM jsonb_array_elements(OLD.commission_settings -> 'roles') LOOP
    SELECT n INTO v_new FROM jsonb_array_elements(NEW.commission_settings -> 'roles') n WHERE n ->> 'key' = v_old ->> 'key' LIMIT 1;
    IF v_new IS NULL THEN
      RAISE EXCEPTION 'Un rol de comision no se borra: se desactiva (%).', v_old ->> 'key' USING ERRCODE = 'CM002';
    END IF;
    IF (v_new ->> 'payee') IS DISTINCT FROM (v_old ->> 'payee') THEN
      RAISE EXCEPTION 'A quien se le paga un rol de comision no se cambia (%).', v_old ->> 'key' USING ERRCODE = 'CM002';
    END IF;
    IF COALESCE(v_new ->> 'system', 'false') IS DISTINCT FROM COALESCE(v_old ->> 'system', 'false') THEN
      RAISE EXCEPTION 'Un rol precargado sigue siendo precargado (%).', v_old ->> 'key' USING ERRCODE = 'CM002';
    END IF;
  END LOOP;

  SELECT array_agg(n ->> 'key') INTO v_keys FROM jsonb_array_elements(NEW.commission_settings -> 'roles') n;
  IF EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE k IS NULL OR k !~ '^[a-z0-9_]{2,40}$') THEN
    RAISE EXCEPTION 'La clave de un rol de comision tiene que ser ^[a-z0-9_]{2,40}$.' USING ERRCODE = 'CM002';
  END IF;
  IF (SELECT count(*) FROM unnest(v_keys)) <> (SELECT count(DISTINCT k) FROM unnest(v_keys) k) THEN
    RAISE EXCEPTION 'Hay dos roles de comision con la misma clave.' USING ERRCODE = 'CM002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.commission_settings -> 'roles') n
     WHERE (n ->> 'payee') NOT IN ('sale_vendedor', 'sale_setter', 'content_assignee', 'fixed', 'sale_affiliate') OR (n ->> 'payee') IS NULL
  ) THEN
    RAISE EXCEPTION 'A quien se le paga un rol de comision no es valido.' USING ERRCODE = 'CM002';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.commission_settings_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.commissions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- Una persona (rol `authenticated`) no escribe. Una sola excepcion: el trigger que libera las comisiones de un gasto
  -- anulado (`expenses_release_commissions`) corre en nombre de quien anula el gasto y marca la transaccion con esta bandera.
  v_user boolean := COALESCE(auth.role(), '') = 'authenticated'
                    AND COALESCE(current_setting('app.commissions_internal', true), '') <> 'on';
  v_status text;
BEGIN
  IF v_user THEN
    RAISE EXCEPTION 'Las comisiones las escribe el servidor.' USING ERRCODE = 'CM003';
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.rule_id IS DISTINCT FROM OLD.rule_id THEN
    RAISE EXCEPTION 'Una comision no cambia de monto, pago, regla ni tipo: se anula y se genera de nuevo.' USING ERRCODE = 'CM003';
  END IF;
  IF OLD.expense_id IS NOT NULL AND NEW.expense_id IS DISTINCT FROM OLD.expense_id THEN
    SELECT e.status INTO v_status FROM public.expenses e WHERE e.id = OLD.expense_id;
    IF v_status = 'pagado' THEN
      RAISE EXCEPTION 'Una comision de un gasto pagado no se suelta.' USING ERRCODE = 'CM003';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.commissions_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.commissions_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.role IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.role IS DISTINCT FROM OLD.role)
     AND NOT private.commission_role_valid(NEW.workspace_id, NEW.role, false) THEN
    RAISE EXCEPTION 'El rol "%" no existe.', NEW.role USING ERRCODE = 'CM001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.commissions_validate() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.enqueue_commissions_for_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  BEGIN
    IF NEW.status = 'paid' AND NEW.type <> 'refund' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES ('commissions_payment', jsonb_build_object('payment_id', NEW.id, 'action', 'generate'), now(),
              'commissions:gen:' || NEW.id::text || ':' || COALESCE(extract(epoch FROM NEW.paid_at)::text, '0'))
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'paid' AND NEW.status <> 'paid' AND OLD.type <> 'refund' THEN
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES ('commissions_payment', jsonb_build_object('payment_id', NEW.id, 'action', 'revert'), now(),
              'commissions:rev:' || NEW.id::text || ':' || extract(epoch FROM now())::text)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_commissions_for_payment: no pude encolar el pago %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.enqueue_commissions_for_payment() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.enqueue_finance_daily(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws record;
  v_local timestamp;
  v_day date;
  v_key text;
  v_enqueued integer := 0;
BEGIN
  FOR v_ws IN SELECT w.id, COALESCE(w.timezone, 'UTC') AS tz FROM public.workspaces w LOOP
    BEGIN
      BEGIN
        v_local := p_now AT TIME ZONE v_ws.tz;
      EXCEPTION WHEN OTHERS THEN
        -- Una zona guardada invalida no frena a nadie: ese workspace corre en UTC.
        v_local := p_now AT TIME ZONE 'UTC';
      END;
      v_day := v_local::date;
      CONTINUE WHEN v_local::time < time '03:00';

      v_key := 'finance_daily:' || v_ws.id::text || ':' || v_day::text;
      -- «Una vez por dia»: se mira si existe en CUALQUIER estado, no solo pendiente.
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.scheduled_jobs j WHERE j.dedupe_key = v_key);

      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES (
        'finance_daily',
        jsonb_build_object('workspace_id', v_ws.id, 'local_date', v_day::text),
        p_now,
        v_key
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;

      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_finance_daily: no pude encolar el workspace %: %', v_ws.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_enqueued;
END;
$function$;
REVOKE ALL ON FUNCTION private.enqueue_finance_daily(p_now timestamp with time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.expenses_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION private.expenses_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.expenses_release_commissions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r record;
BEGIN
  IF NEW.status = 'anulado' AND OLD.status IS DISTINCT FROM 'anulado' AND NEW.origin = 'commission_payout' THEN
    PERFORM set_config('app.commissions_internal', 'on', true);
    FOR r IN SELECT c.id, c.workspace_id FROM public.commissions c WHERE c.expense_id = NEW.id ORDER BY c.id FOR UPDATE LOOP
      UPDATE public.commissions SET expense_id = NULL WHERE id = r.id;
      PERFORM private.cm_audit(r.workspace_id, 'commission', r.id, 'commission.payout_released', NULL, jsonb_build_object('expense_id', NEW.id));
    END LOOP;
    PERFORM set_config('app.commissions_internal', 'off', true);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.expenses_release_commissions() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.expenses_validate_category()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION private.expenses_validate_category() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.can_see_commission(c public.commissions)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(
    public.is_workspace_member(c.workspace_id)
    AND (
      public.is_workspace_admin(c.workspace_id)
      OR (
        public.has_permission(c.workspace_id, 'commissions.view')
        AND (
          public.permission_scope(c.workspace_id, 'commissions') = 'all'
          OR c.user_id = auth.uid()
        )
      )
    ),
    false
  );
$function$;
REVOKE ALL ON FUNCTION public.can_see_commission(c public.commissions) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.commission_amount_cents(p_rule public.commission_rules, p_facts jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_base bigint := public.commission_base_cents(p_rule, p_facts);
  v_milli bigint;
BEGIN
  IF p_rule.calc_type = 'fixed' THEN
    RETURN round(COALESCE(p_rule.fixed_amount, 0) * 100)::bigint;
  END IF;
  v_milli := GREATEST(0, round(COALESCE(p_rule.rate, 0) * 1000))::bigint;
  RETURN ((GREATEST(0, v_base) * v_milli * 2 + 100000) / (2 * 100000));
END;
$function$;
REVOKE ALL ON FUNCTION public.commission_amount_cents(p_rule public.commission_rules, p_facts jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commission_apply_max(p_evals jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_out jsonb := COALESCE(p_evals, '[]'::jsonb);
  e jsonb;
  i integer;
  j integer;
  v_other bigint;
BEGIN
  FOR i IN 0 .. jsonb_array_length(v_out) - 1 LOOP
    e := v_out -> i;
    CONTINUE WHEN NOT (e ->> 'payee' = 'sale_affiliate' AND COALESCE((e ->> 'applies')::boolean, false)
                       AND e ->> 'whenAlsoSeller' = 'max' AND NULLIF(e ->> 'userId', '') IS NOT NULL);
    v_other := NULL;
    FOR j IN 0 .. jsonb_array_length(v_out) - 1 LOOP
      CONTINUE WHEN j = i;
      IF (v_out -> j ->> 'payee') IN ('sale_vendedor', 'sale_setter') AND COALESCE((v_out -> j ->> 'applies')::boolean, false)
         AND v_out -> j ->> 'userId' = e ->> 'userId' THEN
        v_other := GREATEST(COALESCE(v_other, 0), (v_out -> j ->> 'amountCents')::bigint);
      END IF;
    END LOOP;
    CONTINUE WHEN v_other IS NULL;
    IF (e ->> 'amountCents')::bigint <= v_other THEN
      v_out := jsonb_set(v_out, ARRAY[i::text], (e || jsonb_build_object('applies', false, 'reason', 'max_other')));
    ELSE
      FOR j IN 0 .. jsonb_array_length(v_out) - 1 LOOP
        CONTINUE WHEN j = i;
        IF (v_out -> j ->> 'payee') IN ('sale_vendedor', 'sale_setter') AND v_out -> j ->> 'userId' = e ->> 'userId' THEN
          v_out := jsonb_set(v_out, ARRAY[j::text], ((v_out -> j) || jsonb_build_object('applies', false, 'reason', 'max_other')));
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.commission_apply_max(p_evals jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.commission_base_cents(p_rule public.commission_rules, p_facts jsonb)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_rule.base = 'net_of_fees'
              THEN GREATEST(0, round(COALESCE((p_facts -> 'payment' ->> 'amount')::numeric, 0) * 100)::bigint
                               - round(COALESCE((p_facts -> 'payment' ->> 'fee_amount')::numeric, 0) * 100)::bigint)
              ELSE round(COALESCE((p_facts -> 'payment' ->> 'amount')::numeric, 0) * 100)::bigint END;
$function$;
REVOKE ALL ON FUNCTION public.commission_base_cents(p_rule public.commission_rules, p_facts jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commission_content_owner(p_social_post_id uuid, p_content_post_id uuid, p_workspace uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_found boolean;
  v_owner uuid;
  v_pub_piece uuid;
  v_pub_owner uuid;
BEGIN
  IF p_content_post_id IS NOT NULL THEN
    SELECT true, c.assigned_to INTO v_found, v_owner FROM public.content_posts c WHERE c.id = p_content_post_id AND c.workspace_id = p_workspace;
    IF COALESCE(v_found, false) THEN
      RETURN v_owner;
    END IF;
  END IF;
  IF p_social_post_id IS NOT NULL THEN
    v_found := false;
    SELECT true, s.content_post_id, s.assigned_to INTO v_found, v_pub_piece, v_pub_owner
      FROM public.social_posts s WHERE s.id = p_social_post_id AND s.workspace_id = p_workspace;
    IF COALESCE(v_found, false) THEN
      IF v_pub_piece IS NOT NULL THEN
        v_found := false;
        SELECT true, c.assigned_to INTO v_found, v_owner FROM public.content_posts c WHERE c.id = v_pub_piece AND c.workspace_id = p_workspace;
        IF COALESCE(v_found, false) THEN
          RETURN v_owner;
        END IF;
      END IF;
      RETURN v_pub_owner;
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.commission_content_owner(p_social_post_id uuid, p_content_post_id uuid, p_workspace uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commission_edit(p_commission_id uuid, p_patch jsonb, p_reason text, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  c public.commissions;
  v_new uuid;
  v_void boolean := COALESCE((p_patch ->> 'void')::boolean, false);
  v_amount numeric := COALESCE(NULLIF(p_patch ->> 'amount', '')::numeric, NULL);
BEGIN
  SELECT * INTO c FROM public.commissions WHERE id = p_commission_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'No existe la comisión' USING ERRCODE = 'CM002'; END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'CM021'; END IF;
  IF c.expense_id IS NOT NULL OR c.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Una comisión que ya está en un gasto (o anulada) no se edita: se corrige con un ajuste.' USING ERRCODE = 'CM022';
  END IF;
  IF NOT v_void AND (v_amount IS NULL OR v_amount <= 0) THEN RAISE EXCEPTION 'El monto tiene que ser mayor a cero' USING ERRCODE = 'CM021'; END IF;
  UPDATE public.commissions SET voided_at = now(), voided_by = p_actor, void_reason = btrim(p_reason) WHERE id = c.id;
  IF v_void THEN
    PERFORM private.cm_audit(c.workspace_id, 'commission', c.id, 'commission.voided',
      jsonb_build_object('void_reason', jsonb_build_object('old', NULL, 'new', btrim(p_reason))), jsonb_build_object('manual', true), p_actor);
    RETURN NULL;
  END IF;
  INSERT INTO public.commissions (workspace_id, kind, role, user_id, contact_id, payment_id, sale_id, rule_id, rule_snapshot, base_amount, amount,
                                  attribution_touch_id, attribution_snapshot, paid_on, available_on, notes, created_by, edited_manually)
  VALUES (c.workspace_id, c.kind, COALESCE(NULLIF(p_patch ->> 'role', ''), c.role),
          CASE WHEN p_patch ? 'user_id' OR p_patch ? 'contact_id' THEN NULLIF(p_patch ->> 'user_id', '')::uuid ELSE c.user_id END,
          CASE WHEN p_patch ? 'user_id' OR p_patch ? 'contact_id' THEN NULLIF(p_patch ->> 'contact_id', '')::uuid ELSE c.contact_id END,
          c.payment_id, c.sale_id, c.rule_id, c.rule_snapshot, c.base_amount, v_amount,
          c.attribution_touch_id, c.attribution_snapshot, c.paid_on, c.available_on, btrim(p_reason), p_actor, true)
  RETURNING id INTO v_new;
  PERFORM private.cm_audit(c.workspace_id, 'commission', v_new, 'commission.edited',
    jsonb_build_object('amount', jsonb_build_object('old', c.amount, 'new', v_amount),
                       'user_id', jsonb_build_object('old', c.user_id, 'new', NULLIF(p_patch ->> 'user_id', '')),
                       'contact_id', jsonb_build_object('old', c.contact_id, 'new', NULLIF(p_patch ->> 'contact_id', ''))),
    jsonb_build_object('reason', btrim(p_reason), 'replaces', c.id), p_actor);
  RETURN v_new;
END;
$function$;
REVOKE ALL ON FUNCTION public.commission_edit(p_commission_id uuid, p_patch jsonb, p_reason text, p_actor uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commission_facts(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'payment', jsonb_build_object(
      'id', p.id,
      'type', p.type,
      'amount', p.amount,
      'paid_on', p.paid_on,
      'method', p.payment_method,
      'fee_amount', p.provider_fee_amount,
      'number', COALESCE((
        SELECT ranked.n FROM (
          SELECT x.id, row_number() OVER (ORDER BY COALESCE(x.original_due_date, x.due_date) NULLS LAST, x.created_at, x.id) AS n
            FROM public.payments x
           WHERE x.sale_id = p.sale_id AND x.type <> 'refund' AND x.status <> 'cancelled'
        ) ranked WHERE ranked.id = p.id
      ), 1)
    ),
    'sale', jsonb_build_object(
      'id', s.id,
      'status', s.status,
      'financing_type', s.financing_type,
      'final_amount', s.final_amount,
      'product_id', COALESCE(pv.product_id::text, NULLIF(s.product_snapshot ->> 'product_id', '')),
      'variant_id', s.product_variant_id,
      'setter_id', s.setter_id,
      'vendedor_id', s.vendedor_id,
      'contact_id', s.contact_id,
      -- Afiliados (00343, F75).
      'affiliate_user_id', s.affiliate_user_id,
      'affiliate_contact_id', s.affiliate_contact_id,
      'affiliate_kind', s.affiliate_kind
    ),
    'touch', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', t.id,
      'channel', t.channel,
      'source', t.source,
      'medium', NULLIF(btrim(private.meta_url_decode(t.medium)), ''),
      'campaign', NULLIF(btrim(private.meta_url_decode(t.campaign)), ''),
      'content', NULLIF(btrim(private.meta_url_decode(t.content_label)), ''),
      'term', NULLIF(btrim(private.meta_url_decode(t.term)), ''),
      'content_post_id', t.content_post_id,
      'social_post_id', t.social_post_id,
      'meta_ad_id', t.meta_ad_id,
      'meta_adset_id', t.meta_adset_id,
      'meta_campaign_id', t.meta_campaign_id
    ) END,
    'content_assignee_id', CASE
      WHEN t.id IS NOT NULL AND (t.content_post_id IS NOT NULL OR t.social_post_id IS NOT NULL)
        THEN public.commission_content_owner(t.social_post_id, t.content_post_id, s.workspace_id)
      ELSE NULL END
  )
  FROM public.payments p
  JOIN public.sales s ON s.id = p.sale_id
  LEFT JOIN public.product_variants pv ON pv.id = s.product_variant_id
  LEFT JOIN public.contact_touches t ON t.id = s.attribution_touch_id
  WHERE p.id = p_payment_id;
$function$;
REVOKE ALL ON FUNCTION public.commission_facts(p_payment_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commission_payee(p_role jsonb, p_rule public.commission_rules, p_facts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_payee text := p_role ->> 'payee';
  v_override uuid := p_rule.beneficiary_user_id;
  v_touch jsonb := CASE WHEN jsonb_typeof(p_facts -> 'touch') = 'object' THEN p_facts -> 'touch' ELSE NULL END;
  v_user text;
BEGIN
  IF v_payee IN ('sale_vendedor', 'sale_setter') THEN
    v_user := COALESCE(v_override::text, private.cm_sale_person(v_payee, p_facts));
    RETURN jsonb_build_object('applies', v_user IS NOT NULL, 'user_id', v_user);
  ELSIF v_payee = 'content_assignee' THEN
    IF v_touch IS NULL OR (NULLIF(v_touch ->> 'content_post_id', '') IS NULL AND NULLIF(v_touch ->> 'social_post_id', '') IS NULL) THEN
      RETURN jsonb_build_object('applies', false, 'user_id', NULL);
    END IF;
    RETURN jsonb_build_object('applies', true, 'user_id', COALESCE(v_override::text, NULLIF(p_facts ->> 'content_assignee_id', '')));
  ELSIF v_payee = 'sale_affiliate' THEN
    -- Afiliados (00343, F75): del equipo (user_id) o un contacto (contact_id). Sin afiliado en la venta, no aplica.
    IF v_override IS NOT NULL THEN
      RETURN jsonb_build_object('applies', true, 'user_id', v_override);
    END IF;
    IF NULLIF(p_facts -> 'sale' ->> 'affiliate_user_id', '') IS NOT NULL THEN
      RETURN jsonb_build_object('applies', true, 'user_id', p_facts -> 'sale' ->> 'affiliate_user_id');
    END IF;
    IF NULLIF(p_facts -> 'sale' ->> 'affiliate_contact_id', '') IS NOT NULL THEN
      RETURN jsonb_build_object('applies', true, 'user_id', NULL, 'contact_id', p_facts -> 'sale' ->> 'affiliate_contact_id');
    END IF;
    RETURN jsonb_build_object('applies', false, 'user_id', NULL);
  ELSIF v_payee = 'fixed' THEN
    RETURN jsonb_build_object('applies', v_override IS NOT NULL, 'user_id', v_override);
  END IF;
  RETURN jsonb_build_object('applies', false, 'user_id', NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.commission_payee(p_role jsonb, p_rule public.commission_rules, p_facts jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commission_pick_rule(p_workspace uuid, p_facts jsonb, p_role text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_payee text;
  r public.commission_rules;
BEGIN
  SELECT x ->> 'payee' INTO v_payee
    FROM public.workspaces w, jsonb_array_elements(w.commission_settings -> 'roles') x
   WHERE w.id = p_workspace AND x ->> 'key' = p_role;
  IF v_payee IS NULL THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT * FROM public.commission_rules
     WHERE workspace_id = p_workspace AND role = p_role AND is_active AND archived_at IS NULL
     ORDER BY position, created_at, id
  LOOP
    IF public.commission_rule_matches(r, p_facts, v_payee) THEN
      RETURN r.id;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.commission_pick_rule(p_workspace uuid, p_facts jsonb, p_role text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commission_rule_matches(p_rule public.commission_rules, p_facts jsonb, p_payee text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT private.commission_failed_dimension(p_rule, p_facts, p_payee) IS NULL;
$function$;
REVOKE ALL ON FUNCTION public.commission_rule_matches(p_rule public.commission_rules, p_facts jsonb, p_payee text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_commission_payout(p_workspace uuid, p_commission_ids uuid[], p_mode text, p_scheduled_date date, p_concepts jsonb, p_notes text, p_actor uuid, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_excluded jsonb := '[]'::jsonb;
  v_expenses jsonb := '[]'::jsonb;
  r record;
  g record;
  v_total numeric;
  v_ids uuid[];
  v_vendor uuid;
  v_concept text;
  v_name text;
  v_exp uuid;
  v_status text;
  v_eligible uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_mode NOT IN ('per_person', 'single') THEN
    RAISE EXCEPTION 'Modo de liquidacion invalido: %', p_mode;
  END IF;
  IF p_scheduled_date IS NULL OR p_today IS NULL OR p_scheduled_date < p_today - 60 THEN
    RAISE EXCEPTION 'La fecha programada no puede ser anterior a hace 60 dias.';
  END IF;
  IF p_commission_ids IS NULL OR cardinality(p_commission_ids) = 0 THEN
    RETURN jsonb_build_object('expenses', '[]'::jsonb, 'excluded', '[]'::jsonb);
  END IF;

  -- Las pedidas que no son de este workspace.
  FOR r IN SELECT u AS id FROM unnest(p_commission_ids) u WHERE NOT EXISTS (SELECT 1 FROM public.commissions c WHERE c.id = u AND c.workspace_id = p_workspace) LOOP
    v_excluded := v_excluded || jsonb_build_object('id', r.id, 'reason', 'not_found');
  END LOOP;

  -- Candado por fila, en orden fijo (dos llamadas a la vez no se cruzan).
  FOR r IN
    SELECT c.id, c.user_id, c.amount, c.voided_at, c.expense_id, c.available_on
      FROM public.commissions c
     WHERE c.workspace_id = p_workspace AND c.id = ANY (p_commission_ids)
     ORDER BY c.id FOR UPDATE
  LOOP
    IF r.voided_at IS NOT NULL THEN
      v_excluded := v_excluded || jsonb_build_object('id', r.id, 'reason', 'voided');
    ELSIF r.expense_id IS NOT NULL THEN
      v_excluded := v_excluded || jsonb_build_object('id', r.id, 'reason', 'already_in_expense');
    ELSIF r.user_id IS NULL THEN
      v_excluded := v_excluded || jsonb_build_object('id', r.id, 'reason', 'no_person');
    ELSIF r.available_on > p_today THEN
      v_excluded := v_excluded || jsonb_build_object('id', r.id, 'reason', 'held');
    ELSE
      v_eligible := v_eligible || r.id;
    END IF;
  END LOOP;

  v_status := CASE WHEN p_scheduled_date >= p_today THEN 'programado' ELSE 'vencido' END;

  FOR g IN
    SELECT CASE WHEN p_mode = 'per_person' THEN c.user_id ELSE NULL END AS user_id,
           sum(c.amount) AS total, array_agg(c.id ORDER BY c.id) AS ids
      FROM public.commissions c
     WHERE c.id = ANY (v_eligible)
     GROUP BY CASE WHEN p_mode = 'per_person' THEN c.user_id ELSE NULL END
     ORDER BY 1 NULLS LAST
  LOOP
    v_total := g.total;
    v_ids := g.ids;
    IF v_total <= 0 THEN
      FOR r IN SELECT u AS id FROM unnest(v_ids) u LOOP
        v_excluded := v_excluded || jsonb_build_object('id', r.id, 'reason', 'non_positive_total');
      END LOOP;
      CONTINUE;
    END IF;

    v_vendor := NULL;
    IF p_mode = 'per_person' THEN
      SELECT v.id INTO v_vendor FROM public.vendors v WHERE v.workspace_id = p_workspace AND v.user_id = g.user_id;
      IF v_vendor IS NULL THEN
        SELECT COALESCE(NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''), NULLIF(btrim(u.email), ''), 'Persona del equipo') INTO v_name
          FROM auth.users u WHERE u.id = g.user_id;
        v_name := left(COALESCE(v_name, 'Persona del equipo'), 120);
        -- Un proveedor activo con ese nombre que no es de la persona: se distingue.
        IF EXISTS (SELECT 1 FROM public.vendors v WHERE v.workspace_id = p_workspace AND archived_at IS NULL AND lower(btrim(v.name)) = lower(btrim(v_name))) THEN
          v_name := left(v_name, 105) || ' (equipo)';
        END IF;
        INSERT INTO public.vendors (workspace_id, name, user_id, created_by, updated_by)
        VALUES (p_workspace, v_name, g.user_id, p_actor, p_actor)
        RETURNING id INTO v_vendor;
      ELSE
        UPDATE public.vendors SET archived_at = NULL WHERE id = v_vendor AND archived_at IS NOT NULL;
      END IF;
    END IF;

    v_concept := COALESCE(NULLIF(btrim(CASE WHEN p_mode = 'per_person' THEN p_concepts ->> g.user_id::text ELSE p_concepts ->> 'single' END), ''), 'Comisiones');
    v_concept := left(v_concept, 200);

    INSERT INTO public.expenses (
      workspace_id, concept, vendor_id, category_key, amount, status, scheduled_date, origin, notes, source_ref, created_by, updated_by
    ) VALUES (
      p_workspace, v_concept, v_vendor, 'commissions', v_total, v_status, p_scheduled_date, 'commission_payout', NULLIF(btrim(p_notes), ''),
      jsonb_build_object('mode', CASE WHEN p_mode = 'per_person' THEN 'per_person' ELSE 'single' END, 'user_id', g.user_id, 'commission_ids', to_jsonb(v_ids), 'count', cardinality(v_ids)),
      p_actor, p_actor
    ) RETURNING id INTO v_exp;

    UPDATE public.commissions SET expense_id = v_exp WHERE id = ANY (v_ids);
    v_expenses := v_expenses || jsonb_build_object('id', v_exp, 'user_id', g.user_id, 'amount', v_total, 'count', cardinality(v_ids), 'commission_ids', to_jsonb(v_ids));
  END LOOP;

  RETURN jsonb_build_object('expenses', v_expenses, 'excluded', v_excluded);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_commission_payout(p_workspace uuid, p_commission_ids uuid[], p_mode text, p_scheduled_date date, p_concepts jsonb, p_notes text, p_actor uuid, p_today date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.decide_auto_expense_action(p_existing jsonb, p_total_cents bigint, p_ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.decide_auto_expense_action(p_existing jsonb, p_total_cents bigint, p_ctx jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_commissions_for_payment(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  p public.payments%ROWTYPE;
  v_facts jsonb;
  v_settings jsonb;
  v_role jsonb;
  v_rule public.commission_rules;
  v_rule_id uuid;
  v_payee jsonb;
  v_base bigint;
  v_amount bigint;
  v_user uuid;
  v_contact uuid;
  v_id uuid;
  v_touch jsonb;
  v_created int := 0;
  v_created_ids jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_title text;
  v_ad_name text;
  v_evals jsonb := '[]'::jsonb;
  e jsonb;
  r record;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', 'not_found');
  END IF;
  IF p.status <> 'paid' OR p.type = 'refund' THEN
    RETURN jsonb_build_object('skipped', 'not_paid');
  END IF;

  v_facts := public.commission_facts(p.id);
  v_touch := CASE WHEN jsonb_typeof(v_facts -> 'touch') = 'object' THEN v_facts -> 'touch' ELSE NULL END;
  SELECT w.commission_settings INTO v_settings FROM public.workspaces w WHERE w.id = p.workspace_id;

  IF v_touch IS NOT NULL THEN
    SELECT c.title INTO v_title FROM public.content_posts c WHERE c.id = NULLIF(v_touch ->> 'content_post_id', '')::uuid;
    SELECT a.name INTO v_ad_name FROM public.meta_ads a WHERE a.workspace_id = p.workspace_id AND a.ad_id = NULLIF(v_touch ->> 'meta_ad_id', '');
  END IF;

  -- 1. Se evalua cada rol activo (regla, destinatario, monto). 00343: en dos fases, para «pagar solo la mayor».
  FOR v_role IN SELECT * FROM jsonb_array_elements(COALESCE(v_settings -> 'roles', '[]'::jsonb)) LOOP
    CONTINUE WHEN COALESCE((v_role ->> 'active')::boolean, false) IS NOT TRUE;

    v_rule_id := public.commission_pick_rule(p.workspace_id, v_facts, v_role ->> 'key');
    IF v_rule_id IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('role', v_role ->> 'key', 'reason', 'no_rule');
      CONTINUE;
    END IF;
    SELECT * INTO v_rule FROM public.commission_rules WHERE id = v_rule_id;

    v_payee := public.commission_payee(v_role, v_rule, v_facts);
    IF NOT COALESCE((v_payee ->> 'applies')::boolean, false) THEN
      v_skipped := v_skipped || jsonb_build_object('role', v_role ->> 'key', 'reason', 'not_applicable');
      CONTINUE;
    END IF;

    v_amount := public.commission_amount_cents(v_rule, v_facts);
    IF v_amount <= 0 THEN
      v_skipped := v_skipped || jsonb_build_object('role', v_role ->> 'key', 'reason', 'zero_amount');
      CONTINUE;
    END IF;
    v_evals := v_evals || jsonb_build_object(
      'role', v_role ->> 'key', 'payee', v_role ->> 'payee', 'ruleId', v_rule.id, 'whenAlsoSeller', v_rule.when_also_seller,
      'applies', true, 'userId', v_payee ->> 'user_id', 'contactId', v_payee ->> 'contact_id',
      'amountCents', v_amount, 'baseCents', public.commission_base_cents(v_rule, v_facts));
  END LOOP;

  -- 2. «Pagar solo la mayor» (F75).
  v_evals := public.commission_apply_max(v_evals);

  -- 3. Se crean las que quedan; si la persona ya no esta en el equipo, decide la regla (F105).
  FOR e IN SELECT x FROM jsonb_array_elements(v_evals) x LOOP
    IF NOT COALESCE((e ->> 'applies')::boolean, false) THEN
      v_skipped := v_skipped || jsonb_build_object('role', e ->> 'role', 'reason', COALESCE(e ->> 'reason', 'not_applicable'));
      CONTINUE;
    END IF;
    SELECT * INTO v_rule FROM public.commission_rules WHERE id = (e ->> 'ruleId')::uuid;
    v_amount := (e ->> 'amountCents')::bigint;
    v_base := (e ->> 'baseCents')::bigint;
    v_user := NULLIF(e ->> 'userId', '')::uuid;
    v_contact := NULLIF(e ->> 'contactId', '')::uuid;

    IF v_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p.workspace_id AND m.user_id = v_user) THEN
      IF v_rule.on_departure = 'stop' THEN
        v_skipped := v_skipped || jsonb_build_object('role', e ->> 'role', 'reason', 'departed');
        PERFORM private.cm_audit(p.workspace_id, 'payment', p.id, 'commission.skipped_departed', NULL,
          jsonb_build_object('role', e ->> 'role', 'user_id', v_user, 'sale_id', p.sale_id, 'rule_id', v_rule.id));
        CONTINUE;
      ELSIF v_rule.on_departure = 'reassign' THEN
        FOR r IN SELECT m.user_id FROM public.workspace_members m WHERE m.workspace_id = p.workspace_id AND m.role IN ('owner', 'admin') LOOP
          INSERT INTO public.notifications (workspace_id, type, title, body, entity_type, entity_id, metadata, recipient_id)
          VALUES (p.workspace_id, 'commission_unassigned', 'Una comisión quedó sin persona',
                  'La persona del rol ya no está en el equipo: reasigná el rol en esa venta.', 'sale', p.sale_id,
                  jsonb_build_object('role', e ->> 'role', 'payment_id', p.id), r.user_id);
        END LOOP;
        v_user := NULL;
      END IF;
    END IF;

    v_id := NULL;
    INSERT INTO public.commissions (
      workspace_id, kind, role, user_id, contact_id, payment_id, sale_id, rule_id, rule_snapshot, base_amount, amount,
      attribution_touch_id, attribution_snapshot, paid_on, available_on
    ) VALUES (
      p.workspace_id, 'earned', e ->> 'role', v_user, v_contact, p.id, p.sale_id, v_rule.id,
      jsonb_build_object('name', v_rule.name, 'role', v_rule.role, 'calc_type', v_rule.calc_type, 'rate', v_rule.rate,
                         'fixed_amount', v_rule.fixed_amount, 'base', v_rule.base, 'conditions', v_rule.conditions, 'position', v_rule.position,
                         'on_departure', v_rule.on_departure, 'when_also_seller', v_rule.when_also_seller),
      v_base::numeric / 100, v_amount::numeric / 100,
      NULLIF(v_touch ->> 'id', '')::uuid,
      CASE WHEN v_touch IS NULL THEN NULL ELSE jsonb_build_object(
        'channel', v_touch ->> 'channel', 'source', v_touch ->> 'source', 'content_post_id', v_touch ->> 'content_post_id',
        'content_title', v_title, 'meta_ad_id', v_touch ->> 'meta_ad_id', 'ad_name', v_ad_name) END,
      p.paid_on, COALESCE(p.paid_on, CURRENT_DATE) + v_rule.hold_days
    )
    ON CONFLICT (payment_id, role) WHERE kind = 'earned' AND voided_at IS NULL DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NOT NULL THEN
      v_created := v_created + 1;
      v_created_ids := v_created_ids || to_jsonb(v_id);
      PERFORM private.cm_audit(p.workspace_id, 'commission', v_id, 'commission.generated',
        jsonb_build_object('amount', jsonb_build_object('old', NULL, 'new', v_amount::numeric / 100)),
        jsonb_build_object('role', e ->> 'role', 'payment_id', p.id, 'sale_id', p.sale_id, 'rule_id', v_rule.id, 'user_id', v_user, 'contact_id', v_contact));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'created_ids', v_created_ids, 'skipped_roles', v_skipped);
END;
$function$;
REVOKE ALL ON FUNCTION public.generate_commissions_for_payment(p_payment_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_expenses_overdue(p_workspace_id uuid, p_today date)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  WITH changed AS (
    UPDATE public.expenses e
       SET status = 'vencido'
     WHERE e.workspace_id = p_workspace_id
       AND e.status = 'programado'
       AND e.scheduled_date < p_today
    RETURNING e.id
  )
  SELECT id FROM changed;
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_expenses_overdue(p_workspace_id uuid, p_today date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.revert_commissions_for_payment(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_status text;
  v_ws uuid;
  v_voided jsonb := '[]'::jsonb;
  v_review jsonb := '[]'::jsonb;
  r record;
BEGIN
  SELECT status, workspace_id INTO v_status, v_ws FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', 'not_found');
  END IF;
  -- Si volvio a `paid` antes de que corra (carrera), no hay nada que revertir.
  IF v_status = 'paid' THEN
    RETURN jsonb_build_object('skipped', 'still_paid');
  END IF;

  FOR r IN
    SELECT c.id, c.expense_id, c.workspace_id, c.edited_manually FROM public.commissions c
     WHERE c.payment_id = p_payment_id AND c.kind = 'earned' AND c.voided_at IS NULL
     ORDER BY c.id FOR UPDATE
  LOOP
    -- Una comision editada a mano (00343, F107) no se toca sola: va a revisar.
    IF r.expense_id IS NULL AND NOT r.edited_manually THEN
      UPDATE public.commissions SET voided_at = now(), voided_by = NULL, void_reason = 'Se revirtió el cobro' WHERE id = r.id;
      v_voided := v_voided || to_jsonb(r.id);
      PERFORM private.cm_audit(r.workspace_id, 'commission', r.id, 'commission.voided',
        jsonb_build_object('void_reason', jsonb_build_object('old', NULL, 'new', 'Se revirtió el cobro')), jsonb_build_object('payment_id', p_payment_id));
    ELSE
      v_review := v_review || to_jsonb(r.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('voided', v_voided, 'needs_review', v_review);
END;
$function$;
REVOKE ALL ON FUNCTION public.revert_commissions_for_payment(p_payment_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_auto_expense(p_workspace uuid, p_auto_key text, p_origin text, p_total_cents bigint, p_concept text, p_month text, p_vendor_id uuid, p_category_key text, p_charge_mode text, p_source_ref jsonb, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.upsert_auto_expense(p_workspace uuid, p_auto_key text, p_origin text, p_total_cents bigint, p_concept text, p_month text, p_vendor_id uuid, p_category_key text, p_charge_mode text, p_source_ref jsonb, p_today date) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_commission_rules_pick ON public.commission_rules USING btree (workspace_id, role, "position") WHERE ((archived_at IS NULL) AND is_active);

CREATE INDEX IF NOT EXISTS idx_commissions_contact ON public.commissions USING btree (contact_id) WHERE (contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_commissions_expense ON public.commissions USING btree (workspace_id, expense_id);

CREATE INDEX IF NOT EXISTS idx_commissions_paid_live ON public.commissions USING btree (workspace_id, paid_on DESC) WHERE (voided_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_commissions_payment ON public.commissions USING btree (payment_id);

CREATE INDEX IF NOT EXISTS idx_commissions_sale ON public.commissions USING btree (workspace_id, sale_id);

CREATE INDEX IF NOT EXISTS idx_commissions_user_paid ON public.commissions USING btree (workspace_id, user_id, paid_on DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_adjusts ON public.expenses USING btree (adjusts_expense_id) WHERE (adjusts_expense_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses USING btree (workspace_id, category_key);

CREATE INDEX IF NOT EXISTS idx_expenses_paid ON public.expenses USING btree (workspace_id, paid_date) WHERE (status = 'pagado'::text);

CREATE INDEX IF NOT EXISTS idx_expenses_status_date ON public.expenses USING btree (workspace_id, status, scheduled_date);

CREATE INDEX IF NOT EXISTS idx_expenses_vendor ON public.expenses USING btree (workspace_id, vendor_id);

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_workspace_active ON public.recurring_expenses USING btree (workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_vendors_workspace_archived ON public.vendors USING btree (workspace_id, archived_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commissions_payment_role ON public.commissions USING btree (payment_id, role) WHERE ((kind = 'earned'::text) AND (voided_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_auto_key ON public.expenses USING btree (workspace_id, auto_key) WHERE (auto_key IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_recurring_date ON public.expenses USING btree (recurring_expense_id, scheduled_date) WHERE (recurring_expense_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_active_name ON public.vendors USING btree (workspace_id, lower(btrim(name))) WHERE (archived_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_contact ON public.vendors USING btree (workspace_id, contact_id) WHERE (contact_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_user ON public.vendors USING btree (workspace_id, user_id) WHERE (user_id IS NOT NULL);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER commission_rules_validate BEFORE INSERT OR UPDATE OF role, beneficiary_user_id ON public.commission_rules FOR EACH ROW EXECUTE FUNCTION private.commission_rules_validate();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.commission_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER commissions_guard BEFORE UPDATE ON public.commissions FOR EACH ROW EXECUTE FUNCTION private.commissions_guard();

CREATE OR REPLACE TRIGGER commissions_validate BEFORE INSERT OR UPDATE OF role ON public.commissions FOR EACH ROW EXECUTE FUNCTION private.commissions_validate();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.commissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER expenses_guard BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.expenses_guard();

CREATE OR REPLACE TRIGGER expenses_release_commissions AFTER UPDATE OF status ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.expenses_release_commissions();

CREATE OR REPLACE TRIGGER expenses_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER expenses_validate_category BEFORE INSERT OR UPDATE OF category_key ON public.expenses FOR EACH ROW EXECUTE FUNCTION private.expenses_validate_category();

CREATE OR REPLACE TRIGGER payments_enqueue_commissions AFTER INSERT OR UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION private.enqueue_commissions_for_payment();

CREATE OR REPLACE TRIGGER recurring_expenses_updated_at BEFORE UPDATE ON public.recurring_expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER recurring_expenses_validate_category BEFORE INSERT OR UPDATE OF category_key ON public.recurring_expenses FOR EACH ROW EXECUTE FUNCTION private.expenses_validate_category();

CREATE OR REPLACE TRIGGER vendors_updated_at BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER workspaces_commission_settings_guard BEFORE UPDATE OF commission_settings ON public.workspaces FOR EACH ROW EXECUTE FUNCTION private.commission_settings_guard();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY audit_log_select_commissions ON public.audit_log FOR SELECT TO authenticated
    USING ((((entity_type = 'commission'::text) AND (EXISTS ( SELECT 1
   FROM public.commissions c
  WHERE ((c.id = audit_log.entity_id) AND ( SELECT public.can_see_commission(c.*) AS can_see_commission))))) OR ((entity_type = 'commission_rule'::text) AND (( SELECT public.is_workspace_admin(audit_log.workspace_id) AS is_workspace_admin) OR ( SELECT public.has_permission(audit_log.workspace_id, 'commissions.manage'::text) AS has_permission) OR (( SELECT public.has_permission(audit_log.workspace_id, 'commissions.view'::text) AS has_permission) AND (( SELECT public.permission_scope(audit_log.workspace_id, 'commissions'::text) AS permission_scope) = 'all'::text))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY commission_rules_select ON public.commission_rules FOR SELECT TO authenticated
    USING ((( SELECT public.is_workspace_admin(commission_rules.workspace_id) AS is_workspace_admin) OR ( SELECT public.has_permission(commission_rules.workspace_id, 'commissions.manage'::text) AS has_permission) OR (( SELECT public.has_permission(commission_rules.workspace_id, 'commissions.view'::text) AS has_permission) AND (( SELECT public.permission_scope(commission_rules.workspace_id, 'commissions'::text) AS permission_scope) = 'all'::text))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY commissions_select ON public.commissions FOR SELECT TO authenticated
    USING (( SELECT public.can_see_commission(commissions.*) AS can_see_commission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY expenses_insert ON public.expenses FOR INSERT TO authenticated
    WITH CHECK (( SELECT public.has_permission(expenses.workspace_id, 'expenses.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY expenses_select ON public.expenses FOR SELECT TO authenticated
    USING (( SELECT public.has_permission(expenses.workspace_id, 'expenses.view'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY expenses_update ON public.expenses FOR UPDATE TO authenticated
    USING (( SELECT public.has_permission(expenses.workspace_id, 'expenses.manage'::text) AS has_permission))
    WITH CHECK (( SELECT public.has_permission(expenses.workspace_id, 'expenses.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY recurring_expenses_insert ON public.recurring_expenses FOR INSERT TO authenticated
    WITH CHECK (( SELECT public.has_permission(recurring_expenses.workspace_id, 'expenses.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY recurring_expenses_select ON public.recurring_expenses FOR SELECT TO authenticated
    USING (( SELECT public.has_permission(recurring_expenses.workspace_id, 'expenses.view'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY recurring_expenses_update ON public.recurring_expenses FOR UPDATE TO authenticated
    USING (( SELECT public.has_permission(recurring_expenses.workspace_id, 'expenses.manage'::text) AS has_permission))
    WITH CHECK (( SELECT public.has_permission(recurring_expenses.workspace_id, 'expenses.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY vendors_insert ON public.vendors FOR INSERT TO authenticated
    WITH CHECK (( SELECT public.has_permission(vendors.workspace_id, 'expenses.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY vendors_select ON public.vendors FOR SELECT TO authenticated
    USING (( SELECT public.has_permission(vendors.workspace_id, 'expenses.view'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY vendors_update ON public.vendors FOR UPDATE TO authenticated
    USING (( SELECT public.has_permission(vendors.workspace_id, 'expenses.manage'::text) AS has_permission))
    WITH CHECK (( SELECT public.has_permission(vendors.workspace_id, 'expenses.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
