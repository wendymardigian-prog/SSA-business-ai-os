-- ============================================================================
-- 00231 — Comisiones (Extra I, bloque CM1, F50 a F54; y la base de CM2 en F60)
-- ============================================================================
-- Quien cobra que comision por cada pago cobrado. Lo que agrega:
--
--   1. `workspaces.commission_settings` (jsonb): los ROLES de comision (vendedor, setter, contenido y pauta precargados;
--      el negocio crea los suyos) con a quien se le paga cada uno (`payee`). Un trigger impide borrar un rol, cambiar su
--      `key` o su `payee`, o cambiar el `system` de un precargado (CM002).
--   2. `commission_rules` (las reglas, por rol y orden) y `commissions` (lo ganado, con foto de la regla, la base y la
--      atribucion). Nada se borra: las reglas se archivan, las comisiones se anulan.
--   3. `private.commission_role_valid` + triggers: el rol de una regla o comision tiene que existir (y estar activo al
--      crear una regla): CM001.
--   4. `can_see_commission` (siempre true/false, nunca NULL) y la RLS: solo SELECT para `authenticated`; escribe el servidor.
--   5. El motor, en SQL, gemelo del de TypeScript (`lib/commissions/rules.ts`, con `rules.cases.json` y
--      `content-owner.cases.json` corriendo contra las dos): `commission_content_owner`, `commission_facts`,
--      `commission_rule_matches`, `commission_pick_rule`, `commission_payee`, `commission_base_cents`,
--      `commission_amount_cents`.
--   6. `generate_commissions_for_payment` y `revert_commissions_for_payment` (idempotentes), y `create_commission_payout`
--      (convierte comisiones en gastos de liquidacion, con candado por fila).
--   7. `commissions_guard` y `expenses_release_commissions`. ESTE ULTIMO ES LA EXCEPCION a la regla «lo automatico nunca
--      tumba lo que lo origina»: si no puede liberar las comisiones de un gasto de liquidacion que se anula, la anulacion
--      FALLA (si no, quedarian comisiones atadas a un gasto anulado).
--   8. `private.enqueue_commissions_for_payment()`: la FUNCION del trigger que encola la generacion y la reversion cuando un
--      pago entra o sale de `paid`. El trigger en si es la 00235 (despues del merge). Envuelta en EXCEPTION: un cobro nunca
--      falla por esto.
--   9. `private.member_permission_keys()` se redefine: la lista vigente (00208) + `commissions.view` (M9: el Member ve sus
--      propias comisiones, nada mas).
--
-- NO se tocan: `create_sale`, `record_contact_touch`, `find_or_link_contact`, `create_booking`, `submit_form_response`,
-- `find_contact_for_form`, `find_or_create_contact`, `resolve_meta_match` (sus huellas md5 no cambian), ni `audit_log_select`.
--
-- Definicion vieja de `private.member_permission_keys()` (00208), copiada letra por letra para volver atras:
--   CREATE OR REPLACE FUNCTION private.member_permission_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO ''
--   AS $$ SELECT ARRAY['dashboards.chat.view','inbox.instagram.view','inbox.instagram.reply','inbox.whatsapp.view',
--     'inbox.whatsapp.reply','inbox.email.view','inbox.email.reply','contacts.view','contacts.edit','contacts.assign','flows.view',
--     'flows.edit','flows.publish','sequences.view','agents.view','content.view','content.create','scheduling.use','bookings.view',
--     'bookings.manage','calls.view','forms.view','sales.view','sales.manage','payments.manage','tasks.view','tasks.edit']::text[] $$;
--
-- Como volver atras (en este orden):
--   DROP TRIGGER IF EXISTS expenses_release_commissions ON public.expenses;
--   DROP FUNCTION IF EXISTS private.expenses_release_commissions();
--   DROP FUNCTION IF EXISTS private.enqueue_commissions_for_payment();
--   DROP FUNCTION IF EXISTS public.create_commission_payout(uuid, uuid[], text, date, jsonb, text, uuid, date);
--   DROP FUNCTION IF EXISTS public.revert_commissions_for_payment(uuid);
--   DROP FUNCTION IF EXISTS public.generate_commissions_for_payment(uuid);
--   DROP FUNCTION IF EXISTS public.commission_amount_cents(public.commission_rules, jsonb);
--   DROP FUNCTION IF EXISTS public.commission_base_cents(public.commission_rules, jsonb);
--   DROP FUNCTION IF EXISTS public.commission_payee(jsonb, public.commission_rules, jsonb);
--   DROP FUNCTION IF EXISTS public.commission_pick_rule(uuid, jsonb, text);
--   DROP FUNCTION IF EXISTS public.commission_rule_matches(public.commission_rules, jsonb, text);
--   DROP FUNCTION IF EXISTS public.commission_facts(uuid);
--   DROP FUNCTION IF EXISTS public.commission_content_owner(uuid, uuid, uuid);
--   DROP TABLE IF EXISTS public.commissions;  (y despues public.commission_rules)
--   DROP FUNCTION IF EXISTS public.can_see_commission(public.commissions);
--   DROP TRIGGER IF EXISTS workspaces_commission_settings_guard ON public.workspaces;
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS commission_settings;
--   (recrear private.member_permission_keys() con la definicion de arriba)
-- Riesgo: medio-alto. Tablas y funciones nuevas; lo unico existente que cambia es la lista del Member (+ una clave).
-- ============================================================================

SET search_path = '';

-- 1. Los roles de comision ----------------------------------------------------------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS commission_settings jsonb NOT NULL
  DEFAULT '{"roles":[
    {"key":"vendedor","name":"Vendedor","payee":"sale_vendedor","active":true,"system":true,"created_at":"2026-10-15T00:00:00.000Z"},
    {"key":"setter","name":"Setter","payee":"sale_setter","active":true,"system":true,"created_at":"2026-10-15T00:00:00.000Z"},
    {"key":"contenido","name":"Contenido","payee":"content_assignee","active":true,"system":true,"created_at":"2026-10-15T00:00:00.000Z"},
    {"key":"pauta","name":"Pauta","payee":"fixed","active":true,"system":true,"created_at":"2026-10-15T00:00:00.000Z"}
  ]}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_commission_settings_check' AND conrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE public.workspaces
      ADD CONSTRAINT workspaces_commission_settings_check
      CHECK (COALESCE(jsonb_typeof(commission_settings) = 'object' AND jsonb_typeof(commission_settings -> 'roles') = 'array', false));
  END IF;
END $$;

-- Un rol existente no se borra, no cambia de `key` ni de `payee`, y un precargado sigue siendo precargado. Una `key`
-- nueva tiene que tener la forma ^[a-z0-9_]{2,40}$ y no repetirse.
CREATE OR REPLACE FUNCTION private.commission_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
     WHERE (n ->> 'payee') NOT IN ('sale_vendedor', 'sale_setter', 'content_assignee', 'fixed') OR (n ->> 'payee') IS NULL
  ) THEN
    RAISE EXCEPTION 'A quien se le paga un rol de comision no es valido.' USING ERRCODE = 'CM002';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.commission_settings_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS workspaces_commission_settings_guard ON public.workspaces;
CREATE TRIGGER workspaces_commission_settings_guard
  BEFORE UPDATE OF commission_settings ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION private.commission_settings_guard();

-- ¿El rol existe en este workspace (y, si se pide, esta activo)?
CREATE OR REPLACE FUNCTION private.commission_role_valid(p_workspace_id uuid, p_role text, p_require_active boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT bool_or(r ->> 'key' = p_role AND (NOT p_require_active OR COALESCE((r ->> 'active')::boolean, false)))
      FROM public.workspaces w, jsonb_array_elements(w.commission_settings -> 'roles') r
     WHERE w.id = p_workspace_id
  ), false);
$$;

REVOKE ALL ON FUNCTION private.commission_role_valid(uuid, text, boolean) FROM PUBLIC, anon, authenticated;

-- 2. Las reglas ---------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  role text NOT NULL,
  position integer NOT NULL CHECK (position >= 1),
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
  calc_type text NOT NULL CHECK (calc_type IN ('percent', 'fixed')),
  rate numeric(6,3),
  fixed_amount numeric(12,2),
  base text NOT NULL DEFAULT 'gross' CHECK (base IN ('gross', 'net_of_fees')),
  beneficiary_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  hold_days smallint NOT NULL DEFAULT 0 CHECK (hold_days BETWEEN 0 AND 365),
  valid_from date,
  valid_until date,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_rules_rate CHECK (calc_type <> 'percent' OR (rate IS NOT NULL AND rate > 0 AND rate <= 100)),
  CONSTRAINT commission_rules_fixed CHECK (calc_type <> 'fixed' OR (fixed_amount IS NOT NULL AND fixed_amount > 0)),
  CONSTRAINT commission_rules_validity CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from),
  -- Una posicion por rol entre las reglas vivas; DIFERIDA para poder renumerar 1..N en una transaccion.
  CONSTRAINT uq_commission_rules_position EXCLUDE USING btree (workspace_id WITH =, role WITH =, position WITH =)
    WHERE (archived_at IS NULL) DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE public.commission_rules IS 'Reglas de comision por rol. Se escriben solo desde el servidor. Nada se borra: se archivan.';

CREATE INDEX IF NOT EXISTS idx_commission_rules_pick
  ON public.commission_rules (workspace_id, role, position)
  WHERE archived_at IS NULL AND is_active;

DROP TRIGGER IF EXISTS set_updated_at ON public.commission_rules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.commission_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION private.commission_rules_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION private.commission_rules_validate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS commission_rules_validate ON public.commission_rules;
CREATE TRIGGER commission_rules_validate
  BEFORE INSERT OR UPDATE OF role, beneficiary_user_id ON public.commission_rules
  FOR EACH ROW EXECUTE FUNCTION private.commission_rules_validate();

-- 3. Las comisiones -----------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('earned', 'adjustment')),
  role text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.payments(id),
  sale_id uuid REFERENCES public.sales(id),
  rule_id uuid REFERENCES public.commission_rules(id),
  rule_snapshot jsonb,
  base_amount numeric(12,2),
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  attribution_touch_id uuid REFERENCES public.contact_touches(id) ON DELETE SET NULL,
  attribution_snapshot jsonb,
  paid_on date,
  available_on date NOT NULL,
  expense_id uuid REFERENCES public.expenses(id),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commissions_earned_shape CHECK (
    kind <> 'earned' OR (role IS NOT NULL AND payment_id IS NOT NULL AND sale_id IS NOT NULL AND rule_id IS NOT NULL AND amount >= 0)
  ),
  CONSTRAINT commissions_adjustment_shape CHECK (
    kind <> 'adjustment' OR (amount <> 0 AND rule_id IS NULL AND notes IS NOT NULL AND btrim(notes) <> '')
  ),
  CONSTRAINT commissions_void_reason CHECK (voided_at IS NULL OR (void_reason IS NOT NULL AND btrim(void_reason) <> ''))
);

COMMENT ON TABLE public.commissions IS 'Lo ganado por cada persona (kind earned) y los ajustes a mano (adjustment). La app solo lee; escribe el servidor. El estado de pago se lee del gasto, nunca se copia.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_commissions_payment_role
  ON public.commissions (payment_id, role)
  WHERE kind = 'earned' AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_commissions_user_paid ON public.commissions (workspace_id, user_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_commissions_expense ON public.commissions (workspace_id, expense_id);
CREATE INDEX IF NOT EXISTS idx_commissions_sale ON public.commissions (workspace_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_commissions_paid_live ON public.commissions (workspace_id, paid_on DESC) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_commissions_payment ON public.commissions (payment_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.commissions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.commissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- El rol de una comision tiene que existir (puede estar desactivado: se conserva la clave).
CREATE OR REPLACE FUNCTION private.commissions_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.role IS DISTINCT FROM OLD.role)
     AND NOT private.commission_role_valid(NEW.workspace_id, NEW.role, false) THEN
    RAISE EXCEPTION 'El rol "%" no existe.', NEW.role USING ERRCODE = 'CM001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.commissions_validate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS commissions_validate ON public.commissions;
CREATE TRIGGER commissions_validate
  BEFORE INSERT OR UPDATE OF role ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION private.commissions_validate();

-- Las protecciones que valen para CUALQUIER cliente. Una persona (rol `authenticated`) no escribe; el servicio no
-- cambia lo que define una comision ni la suelta de un gasto ya pagado.
CREATE OR REPLACE FUNCTION private.commissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION private.commissions_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS commissions_guard ON public.commissions;
CREATE TRIGGER commissions_guard
  BEFORE UPDATE ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION private.commissions_guard();

-- 4. Quien ve una comision ----------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_see_commission(c public.commissions)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.can_see_commission(public.commissions) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_commission(public.commissions) TO authenticated, service_role;

ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['commission_rules', 'commissions'] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

CREATE POLICY commissions_select ON public.commissions
  FOR SELECT TO authenticated USING ((select public.can_see_commission(commissions)));

CREATE POLICY commission_rules_select ON public.commission_rules
  FOR SELECT TO authenticated USING (
    (select public.is_workspace_admin(workspace_id))
    OR (select public.has_permission(workspace_id, 'commissions.manage'))
    OR (
      (select public.has_permission(workspace_id, 'commissions.view'))
      AND (select public.permission_scope(workspace_id, 'commissions')) = 'all'
    )
  );

-- Solo lectura para la app: ni INSERT, ni UPDATE, ni DELETE (escribe el servidor con el cliente de servicio).
REVOKE ALL ON public.commission_rules, public.commissions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.commission_rules, public.commissions FROM authenticated;

-- Permisos explicitos (un proyecto nuevo no da acceso por defecto): la sesion solo LEE (la RLS decide quien); el servidor puede todo.
GRANT SELECT ON public.commission_rules TO authenticated;
GRANT SELECT ON public.commissions TO authenticated;
GRANT ALL ON public.commission_rules TO service_role;
GRANT ALL ON public.commissions TO service_role;

-- 5. El motor ---------------------------------------------------------------------------------------------------------

-- Un jsonb array de textos → text[] (cualquier otra cosa es una lista vacia).
CREATE OR REPLACE FUNCTION private.cm_list(p_json jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN jsonb_typeof(p_json) = 'array'
              THEN COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_json)), ARRAY[]::text[])
              ELSE ARRAY[]::text[] END;
$$;

-- Sin mayusculas ni espacios de mas; los UTM a veces llegan codificados (gemela de `norm` en rules.ts).
CREATE OR REPLACE FUNCTION private.cm_norm(p_value text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT lower(btrim(COALESCE(private.meta_url_decode(p_value), '')));
$$;

-- Una lista vacia no limita; con valores, el dato tiene que estar.
CREATE OR REPLACE FUNCTION private.cm_in_list(p_values text[], p_actual text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT cardinality(p_values) = 0 OR (p_actual IS NOT NULL AND p_actual = ANY (p_values));
$$;

REVOKE ALL ON FUNCTION private.cm_list(jsonb), private.cm_norm(text), private.cm_in_list(text[], text) FROM PUBLIC, anon, authenticated;

-- Quien es el responsable de lo que genero una venta (gemela de `contentOwner`, F43).
CREATE OR REPLACE FUNCTION public.commission_content_owner(p_social_post_id uuid, p_content_post_id uuid, p_workspace uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- Los hechos de un pago (F51): lo unico que el motor mira.
CREATE OR REPLACE FUNCTION public.commission_facts(p_payment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
      'contact_id', s.contact_id
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
$$;

-- La persona de la venta (o de la pieza) que corresponde al `payee`; con `fixed` no hay.
CREATE OR REPLACE FUNCTION private.cm_sale_person(p_payee text, p_facts jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_payee
    WHEN 'sale_vendedor' THEN p_facts -> 'sale' ->> 'vendedor_id'
    WHEN 'sale_setter' THEN p_facts -> 'sale' ->> 'setter_id'
    WHEN 'content_assignee' THEN p_facts ->> 'content_assignee_id'
    ELSE NULL END;
$$;

-- La primera dimension que NO se cumple (null = la regla matchea). Mismo recorrido que `firstFailedDimension`.
CREATE OR REPLACE FUNCTION private.commission_failed_dimension(p_rule public.commission_rules, p_facts jsonb, p_payee text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.commission_rule_matches(p_rule public.commission_rules, p_facts jsonb, p_payee text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT private.commission_failed_dimension(p_rule, p_facts, p_payee) IS NULL;
$$;

-- La primera regla (por `position`) del rol, activa, no archivada y que matchea; o null.
CREATE OR REPLACE FUNCTION public.commission_pick_rule(p_workspace uuid, p_facts jsonb, p_role text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- A quien se le paga (gemela de `payeeFor`). `p_role` es el jsonb del rol (`{key, payee, ...}`).
CREATE OR REPLACE FUNCTION public.commission_payee(p_role jsonb, p_rule public.commission_rules, p_facts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
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
  ELSIF v_payee = 'fixed' THEN
    RETURN jsonb_build_object('applies', v_override IS NOT NULL, 'user_id', v_override);
  END IF;
  RETURN jsonb_build_object('applies', false, 'user_id', NULL);
END;
$$;

-- La base en centavos: cobrado, o cobrado menos el fee del procesador (nunca menor que 0).
CREATE OR REPLACE FUNCTION public.commission_base_cents(p_rule public.commission_rules, p_facts jsonb)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_rule.base = 'net_of_fees'
              THEN GREATEST(0, round(COALESCE((p_facts -> 'payment' ->> 'amount')::numeric, 0) * 100)::bigint
                               - round(COALESCE((p_facts -> 'payment' ->> 'fee_amount')::numeric, 0) * 100)::bigint)
              ELSE round(COALESCE((p_facts -> 'payment' ->> 'amount')::numeric, 0) * 100)::bigint END;
$$;

-- El monto en centavos. El porcentaje (hasta 3 decimales) se pasa a milesimas enteras; el medio centavo sube.
CREATE OR REPLACE FUNCTION public.commission_amount_cents(p_rule public.commission_rules, p_facts jsonb)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
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
$$;

-- 6. Generar, revertir y liquidar -----------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.cm_audit(p_workspace uuid, p_entity text, p_entity_id uuid, p_action text, p_changes jsonb, p_metadata jsonb, p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type, actor_label)
  VALUES (p_workspace, p_entity, p_entity_id, p_action, p_changes, p_metadata, p_actor,
          CASE WHEN p_actor IS NULL THEN 'system' ELSE 'user' END,
          CASE WHEN p_actor IS NULL THEN 'Comisiones' ELSE NULL END);
$$;

REVOKE ALL ON FUNCTION private.cm_audit(uuid, text, uuid, text, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_commissions_for_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
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
  v_id uuid;
  v_touch jsonb;
  v_created int := 0;
  v_created_ids jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_title text;
  v_ad_name text;
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
    v_base := public.commission_base_cents(v_rule, v_facts);
    v_user := NULLIF(v_payee ->> 'user_id', '')::uuid;
    v_id := NULL;

    INSERT INTO public.commissions (
      workspace_id, kind, role, user_id, payment_id, sale_id, rule_id, rule_snapshot, base_amount, amount,
      attribution_touch_id, attribution_snapshot, paid_on, available_on
    ) VALUES (
      p.workspace_id, 'earned', v_role ->> 'key', v_user, p.id, p.sale_id, v_rule.id,
      jsonb_build_object('name', v_rule.name, 'role', v_rule.role, 'calc_type', v_rule.calc_type, 'rate', v_rule.rate,
                         'fixed_amount', v_rule.fixed_amount, 'base', v_rule.base, 'conditions', v_rule.conditions, 'position', v_rule.position),
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
        jsonb_build_object('role', v_role ->> 'key', 'payment_id', p.id, 'sale_id', p.sale_id, 'rule_id', v_rule.id, 'user_id', v_user));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'created_ids', v_created_ids, 'skipped_roles', v_skipped);
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_commissions_for_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
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
    SELECT c.id, c.expense_id, c.workspace_id FROM public.commissions c
     WHERE c.payment_id = p_payment_id AND c.kind = 'earned' AND c.voided_at IS NULL
     ORDER BY c.id FOR UPDATE
  LOOP
    IF r.expense_id IS NULL THEN
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
$$;

CREATE OR REPLACE FUNCTION public.create_commission_payout(
  p_workspace uuid,
  p_commission_ids uuid[],
  p_mode text,
  p_scheduled_date date,
  p_concepts jsonb,
  p_notes text,
  p_actor uuid,
  p_today date
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- Al anular el gasto de una liquidacion, sus comisiones vuelven a Pendiente. EXCEPCION a la regla «lo automatico nunca
-- tumba lo que lo origina»: si esto falla, la anulacion FALLA (quedarian comisiones atadas a un gasto anulado).
CREATE OR REPLACE FUNCTION private.expenses_release_commissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION private.expenses_release_commissions() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS expenses_release_commissions ON public.expenses;
CREATE TRIGGER expenses_release_commissions
  AFTER UPDATE OF status ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION private.expenses_release_commissions();

-- La FUNCION del trigger de `payments` (el trigger es la 00235, despues del merge): encola la generacion cuando un pago
-- entra a `paid` y la reversion cuando sale. Envuelta en EXCEPTION: un cobro NUNCA falla por esto.
CREATE OR REPLACE FUNCTION private.enqueue_commissions_for_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION private.enqueue_commissions_for_payment() FROM PUBLIC, anon, authenticated;

-- 7. Permisos de las funciones: solo el servidor ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.commission_content_owner(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commission_facts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commission_rule_matches(public.commission_rules, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commission_pick_rule(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commission_payee(jsonb, public.commission_rules, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commission_base_cents(public.commission_rules, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commission_amount_cents(public.commission_rules, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_commissions_for_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_commissions_for_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_commission_payout(uuid, uuid[], text, date, jsonb, text, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.commission_failed_dimension(public.commission_rules, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cm_sale_person(text, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.commission_content_owner(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.commission_facts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.commission_rule_matches(public.commission_rules, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commission_pick_rule(uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commission_payee(jsonb, public.commission_rules, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.commission_base_cents(public.commission_rules, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.commission_amount_cents(public.commission_rules, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_commissions_for_payment(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_commissions_for_payment(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_commission_payout(uuid, uuid[], text, date, jsonb, text, uuid, date) TO service_role;

-- 8. M9: el Member ve sus propias comisiones --------------------------------------------------------------------------
-- La lista vigente (00208) + `commissions.view`. Tiene que ser igual a MEMBER_PERMISSION_KEYS (lib/auth/permissions.ts):
-- lo exige lib/auth/member-sql-parity.test.ts.

CREATE OR REPLACE FUNCTION private.member_permission_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT ARRAY[
    'dashboards.chat.view',
    'inbox.instagram.view',
    'inbox.instagram.reply',
    'inbox.whatsapp.view',
    'inbox.whatsapp.reply',
    'inbox.email.view',
    'inbox.email.reply',
    'contacts.view',
    'contacts.edit',
    'contacts.assign',
    'flows.view',
    'flows.edit',
    'flows.publish',
    'sequences.view',
    'agents.view',
    'content.view',
    'content.create',
    'scheduling.use',
    'bookings.view',
    'bookings.manage',
    'calls.view',
    'forms.view',
    'sales.view',
    'sales.manage',
    'payments.manage',
    'tasks.view',
    'tasks.edit',
    'commissions.view'
  ]::text[]
$function$;
