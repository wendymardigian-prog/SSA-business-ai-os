-- ============================================================================
-- 00343_affiliates  (Servicios v12, Corrida A1 · S13 · bloque AF) — BAIOS, sin tablas nuevas
-- ============================================================================
-- Afiliados y links de producto (F70-F75, F103-F107). Es de BAIOS: funciona con el modulo de Servicios apagado.
--  1. `products.links` + `links_rev` y `public.validate_product_links` (gemela de lib/affiliates/product-links.ts).
--  2. `workspaces.affiliate_settings` + `affiliate_settings_rev`.
--  3. Codigos: `workspace_members.affiliate_code` y `contacts.affiliate_code`, unicos por negocio ENTRE las dos (AF001)
--     y que no cambian nunca (AF004). `public.affiliate_ensure_code`.
--  4. Afiliado del contacto (`contacts.affiliate_*`) y de la venta (`sales.affiliate_*`), con guardas: solo los
--     escriben las funciones de este modulo o el servidor (AF010).
--  5. Comisiones: `commissions.contact_id`, `commissions.edited_manually`, `vendors.contact_id`; en las reglas
--     `on_departure` y `when_also_seller`; la condicion `affiliate_kinds`; el destinatario `sale_affiliate`.
--     Reescribe `commission_facts`, `private.commission_failed_dimension`, `private.cm_sale_person`,
--     `commission_payee`, `generate_commissions_for_payment` y `revert_commissions_for_payment` (definiciones
--     vigentes copiadas de la base; las viejas completas en la cabecera de abajo).
--  6. `public.affiliate_assign_plan` (gemela de lib/affiliates/assign.ts) y `public.affiliate_assign`; el trigger
--     `trg_affiliate_touch` sobre `contact_touches` (nunca hace fallar el toque).
--  7. `merge_contacts` (copia de la vigente) mueve las referencias de afiliado.
--  8. CHECK de `triggers.type` + 3 disparadores; `private.member_permission_keys()` + `affiliates.use`.
--  9. El cron diario `affiliates-daily` por SQL directo (vence asignaciones; emite `affiliate_assignment_expired`).
--
-- Va ANTES de desplegar el codigo. Aditiva salvo las reescrituras del punto 5 y 7.
-- Riesgo: alto (comisiones y fusion). Las huellas viejas: commission_payee ffe87f41..., generate_commissions_for_payment
-- 3660acdd..., merge_contacts 7f27d943..., revert_commissions_for_payment 452c233b..., commission_failed_dimension
-- f946371b... (punto de partida y lectura del 8/11).
--
-- Como volver atras (en este orden):
--   1. Reponer las definiciones viejas, completas y leidas de la base el 8/11/2026, que estan en
--      docs/servicios/definiciones-viejas-00343.sql (fuera de la migracion para que ningun lector de migraciones las tome
--      como la definicion vigente).
--   2. SELECT cron.unschedule('affiliates-daily');
--   3. DROP TRIGGER IF EXISTS trg_affiliate_touch ON public.contact_touches;
--      DROP TRIGGER IF EXISTS trg_affiliate_codes ON public.workspace_members;
--      DROP TRIGGER IF EXISTS trg_affiliate_codes ON public.contacts;
--      DROP TRIGGER IF EXISTS trg_affiliate_contact_guard ON public.contacts;
--      DROP TRIGGER IF EXISTS trg_affiliate_sale_guard ON public.sales;
--      DROP TRIGGER IF EXISTS trg_product_links_guard ON public.products;
--      DROP TRIGGER IF EXISTS trg_affiliate_settings_guard ON public.workspaces;
--   4. DROP FUNCTION IF EXISTS (las de esta migracion: ver la lista de GRANT al final).
--   5. Los CHECK de triggers.type y member_permission_keys: reponer los de la 00336 y la 00330.
--   6. ALTER TABLE ... DROP COLUMN IF EXISTS de las columnas nuevas (products.links, links_rev,
--      workspaces.affiliate_settings, affiliate_settings_rev, workspace_members.affiliate_code, contacts.affiliate_*,
--      sales.affiliate_*, commissions.contact_id, edited_manually, vendors.contact_id, commission_rules.on_departure,
--      when_also_seller). Nada de eso tiene datos hasta que alguien use la pantalla.
-- ============================================================================

-- ─── 1. Columnas ────────────────────────────────────────────────────────────
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '{"v":1,"items":[]}'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS links_rev integer NOT NULL DEFAULT 0;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS affiliate_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS affiliate_settings_rev integer NOT NULL DEFAULT 0;

ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS affiliate_code text NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS affiliate_code text NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS affiliate_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS affiliate_contact_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS affiliate_kind text NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS affiliate_assigned_at timestamptz NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS affiliate_expires_at timestamptz NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS affiliate_last_ref_at timestamptz NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS affiliate_source text NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS affiliate_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS affiliate_contact_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS affiliate_kind text NULL;

ALTER TABLE public.commissions ADD COLUMN IF NOT EXISTS contact_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.commissions ADD COLUMN IF NOT EXISTS edited_manually boolean NOT NULL DEFAULT false;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS contact_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.commission_rules ADD COLUMN IF NOT EXISTS on_departure text NOT NULL DEFAULT 'keep';
ALTER TABLE public.commission_rules ADD COLUMN IF NOT EXISTS when_also_seller text NOT NULL DEFAULT 'both';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_affiliate_code_format') THEN
    ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_affiliate_code_format CHECK (affiliate_code IS NULL OR affiliate_code ~ '^[a-z0-9]{4,24}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_affiliate_code_format') THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_affiliate_code_format CHECK (affiliate_code IS NULL OR affiliate_code ~ '^[a-z0-9]{4,24}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_affiliate_one') THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_affiliate_one CHECK (num_nonnulls(affiliate_user_id, affiliate_contact_id) <= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_affiliate_not_self') THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_affiliate_not_self CHECK (affiliate_contact_id IS NULL OR affiliate_contact_id <> id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_affiliate_kind_check') THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_affiliate_kind_check CHECK (affiliate_kind IS NULL OR affiliate_kind IN ('originated', 'influenced'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_affiliate_source_check') THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_affiliate_source_check CHECK (affiliate_source IS NULL OR affiliate_source IN ('link', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_affiliate_one') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_affiliate_one CHECK (num_nonnulls(affiliate_user_id, affiliate_contact_id) <= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_affiliate_not_buyer') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_affiliate_not_buyer CHECK (affiliate_contact_id IS NULL OR affiliate_contact_id <> contact_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_affiliate_kind_check') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_affiliate_kind_check CHECK (affiliate_kind IS NULL OR affiliate_kind IN ('originated', 'influenced'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commissions_one_payee') THEN
    ALTER TABLE public.commissions ADD CONSTRAINT commissions_one_payee CHECK (NOT (user_id IS NOT NULL AND contact_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rules_on_departure_check') THEN
    ALTER TABLE public.commission_rules ADD CONSTRAINT commission_rules_on_departure_check CHECK (on_departure IN ('keep', 'stop', 'reassign'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rules_when_also_seller_check') THEN
    ALTER TABLE public.commission_rules ADD CONSTRAINT commission_rules_when_also_seller_check CHECK (when_also_seller IN ('both', 'max'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_members_affiliate_code ON public.workspace_members (workspace_id, affiliate_code) WHERE affiliate_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_affiliate_code ON public.contacts (workspace_id, affiliate_code) WHERE affiliate_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_affiliate_user ON public.contacts (workspace_id, affiliate_user_id) WHERE affiliate_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_affiliate_contact ON public.contacts (affiliate_contact_id) WHERE affiliate_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_affiliate_expires ON public.contacts (affiliate_expires_at) WHERE affiliate_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_affiliate_user ON public.sales (workspace_id, affiliate_user_id) WHERE affiliate_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_affiliate_contact ON public.sales (affiliate_contact_id) WHERE affiliate_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commissions_contact ON public.commissions (contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_contact ON public.vendors (workspace_id, contact_id) WHERE contact_id IS NOT NULL;

COMMENT ON COLUMN public.products.links IS 'Los links del producto (F70). Forma en lib/affiliates/product-links.ts; se guarda entero con product_links_save.';
COMMENT ON COLUMN public.workspaces.affiliate_settings IS 'Las reglas de afiliados (F72). {} = los defaults de lib/affiliates/assign.ts.';
COMMENT ON COLUMN public.contacts.affiliate_code IS 'El codigo de afiliado de un contacto (F71). Unico por negocio con workspace_members.affiliate_code; no cambia nunca.';
COMMENT ON COLUMN public.commissions.edited_manually IS 'La comision la edito una persona (F107): la generacion y la reversion no la pisan.';

-- ─── 2. Los codigos: unicos ENTRE las dos tablas y para siempre ─────────────
CREATE OR REPLACE FUNCTION public.affiliate_codes_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;
DROP TRIGGER IF EXISTS trg_affiliate_codes ON public.workspace_members;
CREATE TRIGGER trg_affiliate_codes BEFORE INSERT OR UPDATE OF affiliate_code ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_codes_guard();
DROP TRIGGER IF EXISTS trg_affiliate_codes ON public.contacts;
CREATE TRIGGER trg_affiliate_codes BEFORE INSERT OR UPDATE OF affiliate_code ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_codes_guard();

-- ─── 3. Guardas: el afiliado, los links y las reglas los escriben solo las funciones o el servidor ─────
-- Una sesion (`authenticated`/`anon`) no cambia estas columnas directo; las funciones de abajo marcan la transaccion.
CREATE OR REPLACE FUNCTION public.affiliate_internal()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT current_user NOT IN ('authenticated', 'anon') OR COALESCE(current_setting('app.affiliates_internal', true), '') = 'on';
$$;

CREATE OR REPLACE FUNCTION public.affiliate_contact_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
$$;
DROP TRIGGER IF EXISTS trg_affiliate_contact_guard ON public.contacts;
CREATE TRIGGER trg_affiliate_contact_guard BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_contact_guard();

CREATE OR REPLACE FUNCTION public.affiliate_sale_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
$$;
DROP TRIGGER IF EXISTS trg_affiliate_sale_guard ON public.sales;
CREATE TRIGGER trg_affiliate_sale_guard BEFORE INSERT OR UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_sale_guard();

CREATE OR REPLACE FUNCTION public.product_links_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
$$;
DROP TRIGGER IF EXISTS trg_product_links_guard ON public.products;
CREATE TRIGGER trg_product_links_guard BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.product_links_guard();

CREATE OR REPLACE FUNCTION public.affiliate_settings_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
$$;
DROP TRIGGER IF EXISTS trg_affiliate_settings_guard ON public.workspaces;
CREATE TRIGGER trg_affiliate_settings_guard BEFORE INSERT OR UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_settings_guard();

-- ─── 4. Los links del producto (F70): validacion (gemela de lib/affiliates/product-links.ts) y guardado ─────
CREATE OR REPLACE FUNCTION public.validate_product_links(p jsonb, p_variant_ids uuid[])
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = '' AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.product_links_save(p_product_id uuid, p_links jsonb, p_rev integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

-- ─── 5. Las reglas de afiliados (F72) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_affiliate_settings(p jsonb)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.affiliate_settings_save(p_workspace_id uuid, p_settings jsonb, p_rev integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

-- ─── 6. El codigo de un afiliado (F71): se genera una vez y no cambia ───────
-- p_kind: 'member' (p_id = user_id) o 'contact' (p_id = contact_id). Nombre + 2 caracteres al azar, sin chocar.
CREATE OR REPLACE FUNCTION public.affiliate_ensure_code(p_workspace_id uuid, p_kind text, p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

-- ─── 7. La asignacion (F72): plan puro (gemela de lib/affiliates/assign.ts) y aplicacion ───────────────────────
-- Entrada con la forma de AssignInput de TS. Salida con la forma de AssignPlan.
CREATE OR REPLACE FUNCTION public.affiliate_assign_plan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
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
$$;

-- Quien es el duenio de un codigo en un negocio: {type, id} o NULL.
CREATE OR REPLACE FUNCTION public.affiliate_by_code(p_workspace_id uuid, p_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('type', 'user', 'id', m.user_id) FROM public.workspace_members m WHERE m.workspace_id = p_workspace_id AND m.affiliate_code = lower(p_code) LIMIT 1),
    (SELECT jsonb_build_object('type', 'contact', 'id', c.id) FROM public.contacts c WHERE c.workspace_id = p_workspace_id AND c.affiliate_code = lower(p_code) AND c.deleted_at IS NULL LIMIT 1));
$$;

-- Aplica el plan a un contacto. La llama el trigger de toques (como sistema). Nunca lanza por un dato raro: devuelve
-- el plan aplicado.
CREATE OR REPLACE FUNCTION public.affiliate_assign(p_contact_id uuid, p_code text, p_touched_at timestamptz, p_touch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

-- El `ref` de un toque (F72, D22): `record_contact_touch` esta protegida, asi que el ref se busca despues, en la URL de
-- entrada, en las UTM de la agenda o en la pagina de llegada. Nunca hace fallar el toque.
CREATE OR REPLACE FUNCTION public.affiliate_ref_of_touch(t public.contact_touches)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT lower(COALESCE(
    substring(t.entry_url from '[?&]ref=([A-Za-z0-9]{4,24})(?:[&#]|$)'),
    NULLIF(t.raw #>> '{utm,ref}', ''),
    NULLIF(t.raw ->> 'ref', ''),
    substring(t.landing_page from '[?&]ref=([A-Za-z0-9]{4,24})(?:[&#]|$)')));
$$;

CREATE OR REPLACE FUNCTION public.affiliate_touch_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;
DROP TRIGGER IF EXISTS trg_affiliate_touch ON public.contact_touches;
CREATE TRIGGER trg_affiliate_touch AFTER INSERT ON public.contact_touches
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_touch_hook();

-- Asignar, cambiar o quitar a mano (F104): con affiliates.assign y motivo.
CREATE OR REPLACE FUNCTION public.affiliate_set_contact(p_contact_id uuid, p_affiliate jsonb, p_kind text, p_expires_at timestamptz, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

-- El afiliado de una venta (F74 y F104). Al crear la venta lo escribe el servidor (sin motivo); cambiarlo despues pide
-- affiliates.assign y motivo, y vale para los pagos que se cobren desde ese momento.
CREATE OR REPLACE FUNCTION public.affiliate_set_sale(p_sale_id uuid, p_affiliate jsonb, p_kind text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

-- ─── 8. Comisiones (F75, F105, F107): definiciones vigentes copiadas de la base, con lo de afiliados ───────────
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

CREATE OR REPLACE FUNCTION private.commission_failed_dimension(p_rule commission_rules, p_facts jsonb, p_payee text)
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

CREATE OR REPLACE FUNCTION public.commission_payee(p_role jsonb, p_rule commission_rules, p_facts jsonb)
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

-- «Pagar solo la mayor» (F75): si el afiliado de la venta es tambien su vendedor o setter y la regla del rol Afiliado
-- dice `max`, de las comisiones de esa persona en este pago se genera solo la mayor (en un empate, la del otro rol).
-- Gemela de applyWhenAlsoSeller (lib/commissions/rules.ts). Entrada: lo evaluado de cada rol activo.
CREATE OR REPLACE FUNCTION public.commission_apply_max(p_evals jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
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
$$;

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

-- Editar o anular una comision a mano (F107): solo pendiente y sin gasto, con motivo. El guard de comisiones no deja
-- cambiar el monto: se anula la vieja y se genera una nueva marcada `edited_manually`. Como toda escritura de
-- comisiones, la hace el servidor: solo `service_role` la ejecuta; la Server Action exige commissions.edit (CM020)
-- y pasa quien la hizo (`p_actor`).
CREATE OR REPLACE FUNCTION public.commission_edit(p_commission_id uuid, p_patch jsonb, p_reason text, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

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

-- El guard de los roles de comision acepta el destinatario nuevo (copia de la vigente, una linea).
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

-- ─── 9. La fusion de contactos mueve las referencias de afiliado (copia de la vigente) ─────────────────────────
CREATE OR REPLACE FUNCTION public.merge_contacts(p_workspace_id uuid, p_main uuid, p_duplicate uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_main public.contacts%ROWTYPE;
  v_dup public.contacts%ROWTYPE;
  v_moved jsonb := '{}'::jsonb;
  v_n integer;
  v_conv record;
  v_merged_convs uuid[] := '{}';
  v_convs_merged integer := 0;
  v_msgs_moved integer := 0;
  v_msgs_left integer := 0;
  v_notes text;
  v_table text;
  -- Pipeline (00245): el estado de cada rol despues de fusionar, y el ultimo.
  v_setter text;
  v_setter_at timestamptz;
  v_setter_by_agent boolean;
  v_closer text;
  v_closer_at timestamptz;
  v_last_role text;
  v_last text;
  v_last_at timestamptz;
BEGIN
  IF p_workspace_id IS NULL OR p_main IS NULL OR p_duplicate IS NULL THEN
    RAISE EXCEPTION 'merge_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_main = p_duplicate THEN
    RAISE EXCEPTION 'merge_same_contact' USING ERRCODE = '22023';
  END IF;

  -- Las dos filas, bloqueadas en un orden fijo (sin interbloqueos entre dos fusiones).
  PERFORM 1 FROM public.contacts WHERE id IN (p_main, p_duplicate) ORDER BY id FOR UPDATE;
  SELECT * INTO v_main FROM public.contacts WHERE id = p_main;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_dup FROM public.contacts WHERE id = p_duplicate;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_main.workspace_id <> p_workspace_id OR v_dup.workspace_id <> p_workspace_id THEN
    RAISE EXCEPTION 'merge_workspace_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_main.deleted_at IS NOT NULL OR v_dup.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'merge_deleted' USING ERRCODE = '22023';
  END IF;

  -- El duplicado sale de circulacion PRIMERO: asi, si hay indices unicos por telefono o email sobre los contactos vivos,
  -- rellenar los datos vacios del principal no choca con el duplicado.
  UPDATE public.contacts
     SET deleted_at = now(),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('merged_into', p_main)
   WHERE id = p_duplicate;

  -- Canales vinculados (unico por canal + remitente: los remitentes son distintos, no choca).
  UPDATE public.contact_channels SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_channels', v_n);

  -- Conversaciones: UNA por canal y contacto. Si el principal ya tiene una en ese canal, los mensajes de la del
  -- duplicado pasan a la del principal (los que repiten el id del mensaje de la plataforma se quedan donde estan y se
  -- cuentan), se recalcula su resumen y la del duplicado queda vacia y con borrado logico.
  FOR v_conv IN
    SELECT d.id AS dup_conv, m.id AS main_conv
      FROM public.conversations d
      JOIN public.conversations m ON m.channel_id = d.channel_id AND m.contact_id = p_main
     WHERE d.contact_id = p_duplicate
     ORDER BY d.id
  LOOP
    -- Un solo borrador abierto por conversacion: si el principal ya tiene uno, el del duplicado se descarta.
    IF EXISTS (SELECT 1 FROM public.agent_drafts WHERE conversation_id = v_conv.main_conv AND status IN ('pending', 'sending', 'failed')) THEN
      UPDATE public.agent_drafts SET status = 'discarded'
       WHERE conversation_id = v_conv.dup_conv AND status IN ('pending', 'sending', 'failed');
    END IF;
    UPDATE public.agent_drafts SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;

    UPDATE public.messages msg SET conversation_id = v_conv.main_conv
     WHERE msg.conversation_id = v_conv.dup_conv
       AND (msg.platform_message_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.messages o
              WHERE o.conversation_id = v_conv.main_conv AND o.platform_message_id = msg.platform_message_id));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_msgs_moved := v_msgs_moved + v_n;
    SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_conv.dup_conv;
    v_msgs_left := v_msgs_left + v_n;

    UPDATE public.conversations m SET
      last_message_preview = CASE WHEN d.last_message_at IS NOT NULL AND (m.last_message_at IS NULL OR d.last_message_at > m.last_message_at)
                                  THEN d.last_message_preview ELSE m.last_message_preview END,
      last_message_at = GREATEST(m.last_message_at, d.last_message_at),
      unread_count = COALESCE(m.unread_count, 0) + COALESCE(d.unread_count, 0),
      status = CASE WHEN m.status = 'open' OR d.status = 'open' THEN 'open' ELSE m.status END,
      assigned_to = COALESCE(m.assigned_to, d.assigned_to),
      needs_human_reason = CASE WHEN NOT COALESCE(m.needs_human, false) AND COALESCE(d.needs_human, false) THEN d.needs_human_reason ELSE m.needs_human_reason END,
      needs_human_at = CASE WHEN NOT COALESCE(m.needs_human, false) AND COALESCE(d.needs_human, false) THEN d.needs_human_at ELSE m.needs_human_at END,
      needs_human = COALESCE(m.needs_human, false) OR COALESCE(d.needs_human, false),
      deleted_at = CASE WHEN m.deleted_at IS NOT NULL AND d.deleted_at IS NULL THEN NULL ELSE m.deleted_at END
     FROM public.conversations d
    WHERE m.id = v_conv.main_conv AND d.id = v_conv.dup_conv;

    UPDATE public.agent_runs SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;
    UPDATE public.tasks SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;
    UPDATE public.conversations SET deleted_at = COALESCE(deleted_at, now()), unread_count = 0 WHERE id = v_conv.dup_conv;

    v_merged_convs := v_merged_convs || v_conv.dup_conv;
    v_convs_merged := v_convs_merged + 1;
  END LOOP;

  -- Las demas conversaciones se mueven enteras.
  UPDATE public.conversations SET contact_id = p_main
   WHERE contact_id = p_duplicate AND NOT (id = ANY (v_merged_convs));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('conversations', v_n, 'conversations_merged', v_convs_merged, 'messages_moved', v_msgs_moved, 'messages_left', v_msgs_left);

  -- Etiquetas: se mueven las que el principal no tiene (PK contact_id + tag_id).
  UPDATE public.contact_tags SET contact_id = p_main
   WHERE contact_id = p_duplicate
     AND NOT EXISTS (SELECT 1 FROM public.contact_tags o WHERE o.contact_id = p_main AND o.tag_id = public.contact_tags.tag_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_tags', v_n);

  -- Campos personalizados: en uno que ambos tienen, gana el del principal.
  UPDATE public.contact_custom_fields SET contact_id = p_main
   WHERE contact_id = p_duplicate
     AND NOT EXISTS (SELECT 1 FROM public.contact_custom_fields o WHERE o.contact_id = p_main AND o.field_id = public.contact_custom_fields.field_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_custom_fields', v_n);

  -- Secuencias: una inscripcion viva por secuencia. Si el principal ya esta activo o pausado en esa secuencia, la viva del
  -- duplicado se cancela (con el motivo); el resto se mueve.
  UPDATE public.sequence_enrollments d SET status = 'cancelled', paused_reason = 'fusion de contactos', next_step_at = NULL, locked_at = NULL
   WHERE d.contact_id = p_duplicate AND d.status IN ('active', 'paused')
     AND EXISTS (SELECT 1 FROM public.sequence_enrollments m WHERE m.contact_id = p_main AND m.sequence_id = d.sequence_id AND m.status IN ('active', 'paused'));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sequence_enrollments_cancelled', v_n);
  UPDATE public.sequence_enrollments SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sequence_enrollments', v_n);

  -- Sesiones de flujo: las activas del duplicado se mueven, salvo que el principal ya tenga una activa del mismo flujo (la
  -- del duplicado se cancela). El historial se mueve siempre.
  UPDATE public.flow_sessions d SET status = 'cancelled'
   WHERE d.contact_id = p_duplicate AND d.status = 'active'
     AND EXISTS (SELECT 1 FROM public.flow_sessions m WHERE m.contact_id = p_main AND m.status = 'active' AND m.flow_id = d.flow_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('flow_sessions_cancelled', v_n);
  UPDATE public.flow_sessions SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('flow_sessions', v_n);

  -- Eventos de automatizacion: los pendientes del duplicado NO se mueven (podrian disparar otra vez un flujo para el
  -- principal): se marcan como cancelados. Los ya procesados (historial) se mueven.
  UPDATE public.automation_events SET processed_at = now(), error = 'fusion de contactos'
   WHERE contact_id = p_duplicate AND processed_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('automation_events_cancelled', v_n);
  UPDATE public.automation_events SET contact_id = p_main
   WHERE contact_id = p_duplicate AND processed_at IS NOT NULL AND error IS DISTINCT FROM 'fusion de contactos';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('automation_events', v_n);

  -- Tareas: si los dos tienen un seguimiento para la misma fecha, el del duplicado pasa como tarea normal (sin la clave).
  UPDATE public.tasks d SET source_ref = NULL
   WHERE d.contact_id = p_duplicate AND d.source_ref LIKE 'followup:%' AND d.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.tasks m WHERE m.workspace_id = d.workspace_id AND m.contact_id = p_main AND m.source_ref = d.source_ref AND m.deleted_at IS NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('tasks_detached', v_n);
  UPDATE public.tasks SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('tasks', v_n);

  -- Toques de atribucion: se mueven todos y la atribucion del principal se recalcula con TODOS (primer y ultimo toque).
  UPDATE public.contact_touches SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_touches', v_n);
  IF v_n > 0 THEN PERFORM private.refresh_contact_attribution(p_main); END IF;

  -- Pipeline (00245): el historial de estados del duplicado pasa al principal (los cambios siguen siendo de quien los hizo).
  UPDATE public.contact_status_changes SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_status_changes', v_n);

  -- Formularios: "una vez por contacto" guarda `contact:<id>`; la respuesta que se mueve pasa a `contact:<principal>` salvo
  -- que el principal ya tenga una para ese formulario (el indice unico no deja dos).
  UPDATE public.form_submissions fs SET once_key = 'contact:' || p_main::text
   WHERE fs.contact_id = p_duplicate AND fs.once_key = 'contact:' || p_duplicate::text
     AND NOT EXISTS (SELECT 1 FROM public.form_submissions o WHERE o.form_id = fs.form_id AND o.once_key = 'contact:' || p_main::text AND o.status <> 'spam' AND fs.status <> 'spam');
  UPDATE public.form_submissions SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('form_submissions', v_n);

  -- Lo que solo cambia de dueno (sin indices unicos que dependan del contacto). Las ventas llevan sus pagos; las agendas y
  -- las llamadas no cambian de estado ni de monto.
  FOREACH v_table IN ARRAY ARRAY[
    'agent_drafts', 'agent_runs', 'analytics_events', 'bookings', 'broadcast_recipients', 'calls', 'contact_notes',
    'contract_signatures', 'email_log', 'inbound_webhooks', 'sales', 'social_post_comments', 'trigger_fires'
  ] LOOP
    EXECUTE format('UPDATE public.%I SET contact_id = $1 WHERE contact_id = $2', v_table) USING p_main, p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_moved := v_moved || jsonb_build_object(v_table, v_n);
  END LOOP;

  -- Afiliados (00343, F71-F75): lo que apuntaba al duplicado pasa al principal. Un contacto no es su propio afiliado
  -- ni el afiliado de su propia venta: en esos casos queda vacio. El codigo se mueve si el principal no tiene.
  PERFORM set_config('app.affiliates_internal', 'on', true);
  UPDATE public.contacts SET affiliate_contact_id = NULL, affiliate_kind = NULL, affiliate_assigned_at = NULL, affiliate_expires_at = NULL, affiliate_source = NULL
   WHERE id = p_main AND affiliate_contact_id = p_duplicate;
  UPDATE public.contacts SET affiliate_contact_id = p_main WHERE affiliate_contact_id = p_duplicate AND id <> p_main;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('affiliate_contacts', v_n);
  UPDATE public.sales SET affiliate_contact_id = NULL, affiliate_kind = NULL WHERE affiliate_contact_id = p_duplicate AND contact_id = p_main;
  UPDATE public.sales SET affiliate_contact_id = p_main WHERE affiliate_contact_id = p_duplicate;
  UPDATE public.commissions SET contact_id = p_main WHERE contact_id = p_duplicate;
  IF EXISTS (SELECT 1 FROM public.vendors WHERE workspace_id = p_workspace_id AND contact_id = p_main) THEN
    UPDATE public.vendors SET contact_id = NULL WHERE workspace_id = p_workspace_id AND contact_id = p_duplicate;
  ELSE
    UPDATE public.vendors SET contact_id = p_main WHERE workspace_id = p_workspace_id AND contact_id = p_duplicate;
  END IF;
  IF (SELECT affiliate_code FROM public.contacts WHERE id = p_main) IS NULL AND v_dup.affiliate_code IS NOT NULL THEN
    UPDATE public.contacts SET affiliate_code = NULL WHERE id = p_duplicate;
    UPDATE public.contacts SET affiliate_code = v_dup.affiliate_code WHERE id = p_main;
  END IF;
  IF (SELECT affiliate_user_id IS NULL AND affiliate_contact_id IS NULL FROM public.contacts WHERE id = p_main)
     AND (v_dup.affiliate_user_id IS NOT NULL OR (v_dup.affiliate_contact_id IS NOT NULL AND v_dup.affiliate_contact_id <> p_main)) THEN
    UPDATE public.contacts SET affiliate_user_id = v_dup.affiliate_user_id, affiliate_contact_id = v_dup.affiliate_contact_id,
      affiliate_kind = v_dup.affiliate_kind, affiliate_assigned_at = v_dup.affiliate_assigned_at, affiliate_expires_at = v_dup.affiliate_expires_at,
      affiliate_last_ref_at = v_dup.affiliate_last_ref_at, affiliate_source = v_dup.affiliate_source
     WHERE id = p_main;
  END IF;
  PERFORM set_config('app.affiliates_internal', 'off', true);

  -- Los contactos que el duplicado habia referido pasan a ser referidos por el principal.
  UPDATE public.contacts SET referred_by_contact_id = NULL WHERE id = p_main AND referred_by_contact_id = p_duplicate;
  UPDATE public.contacts SET referred_by_contact_id = p_main WHERE referred_by_contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('referred_contacts', v_n);

  -- Los datos de identidad que el principal tiene vacios se completan con los del duplicado (nunca al reves), mas la fecha
  -- del proximo seguimiento.
  UPDATE public.contacts SET
    display_name = CASE WHEN NULLIF(btrim(COALESCE(display_name, '')), '') IS NULL THEN COALESCE(v_dup.display_name, display_name) ELSE display_name END,
    email = CASE WHEN NULLIF(btrim(COALESCE(email, '')), '') IS NULL THEN COALESCE(v_dup.email, email) ELSE email END,
    secondary_email = CASE WHEN NULLIF(btrim(COALESCE(secondary_email, '')), '') IS NULL THEN COALESCE(v_dup.secondary_email, secondary_email) ELSE secondary_email END,
    phone = CASE WHEN NULLIF(btrim(COALESCE(phone, '')), '') IS NULL THEN COALESCE(v_dup.phone, phone) ELSE phone END,
    whatsapp_phone = CASE WHEN NULLIF(btrim(COALESCE(whatsapp_phone, '')), '') IS NULL THEN COALESCE(v_dup.whatsapp_phone, whatsapp_phone) ELSE whatsapp_phone END,
    country = CASE WHEN NULLIF(btrim(COALESCE(country, '')), '') IS NULL THEN COALESCE(v_dup.country, country) ELSE country END,
    instagram_username = CASE WHEN NULLIF(btrim(COALESCE(instagram_username, '')), '') IS NULL THEN COALESCE(v_dup.instagram_username, instagram_username) ELSE instagram_username END,
    tiktok_username = CASE WHEN NULLIF(btrim(COALESCE(tiktok_username, '')), '') IS NULL THEN COALESCE(v_dup.tiktok_username, tiktok_username) ELSE tiktok_username END,
    twitter_username = CASE WHEN NULLIF(btrim(COALESCE(twitter_username, '')), '') IS NULL THEN COALESCE(v_dup.twitter_username, twitter_username) ELSE twitter_username END,
    facebook_id = CASE WHEN NULLIF(btrim(COALESCE(facebook_id, '')), '') IS NULL THEN COALESCE(v_dup.facebook_id, facebook_id) ELSE facebook_id END,
    youtube_channel_id = CASE WHEN NULLIF(btrim(COALESCE(youtube_channel_id, '')), '') IS NULL THEN COALESCE(v_dup.youtube_channel_id, youtube_channel_id) ELSE youtube_channel_id END,
    linkedin_profile_url = CASE WHEN NULLIF(btrim(COALESCE(linkedin_profile_url, '')), '') IS NULL THEN COALESCE(v_dup.linkedin_profile_url, linkedin_profile_url) ELSE linkedin_profile_url END,
    setter_id = COALESCE(setter_id, v_dup.setter_id),
    vendedor_id = COALESCE(vendedor_id, v_dup.vendedor_id),
    next_followup_date = COALESCE(next_followup_date, v_dup.next_followup_date),
    -- Producto de interes (00246): gana el del principal; si no tiene, el del duplicado con SU variante.
    interest_variant_id = CASE WHEN interest_product_id IS NULL THEN v_dup.interest_variant_id ELSE interest_variant_id END,
    interest_product_id = COALESCE(interest_product_id, v_dup.interest_product_id)
   WHERE id = p_main;

  -- Pipeline (00245): el estado de cada rol es el del principal; si no tiene, el del duplicado. El ultimo se recalcula
  -- con la misma regla que `set_contact_status` (el mas reciente; empatados, el del vendedor). Las columnas de estado solo
  -- se escriben con la marca de transaccion (`contacts_status_guard`).
  IF v_main.setter_status IS NOT NULL THEN
    v_setter := v_main.setter_status; v_setter_at := v_main.setter_status_at; v_setter_by_agent := v_main.setter_status_by_agent;
  ELSE
    v_setter := v_dup.setter_status; v_setter_at := v_dup.setter_status_at; v_setter_by_agent := COALESCE(v_dup.setter_status_by_agent, false);
  END IF;
  IF v_main.closer_status IS NOT NULL THEN
    v_closer := v_main.closer_status; v_closer_at := v_main.closer_status_at;
  ELSE
    v_closer := v_dup.closer_status; v_closer_at := v_dup.closer_status_at;
  END IF;
  IF v_closer IS NOT NULL AND (v_setter IS NULL OR v_closer_at >= v_setter_at) THEN
    v_last_role := 'closer'; v_last := v_closer; v_last_at := v_closer_at;
  ELSIF v_setter IS NOT NULL THEN
    v_last_role := 'setter'; v_last := v_setter; v_last_at := v_setter_at;
  ELSE
    v_last_role := NULL; v_last := NULL; v_last_at := NULL;
  END IF;
  IF v_setter IS DISTINCT FROM v_main.setter_status OR v_closer IS DISTINCT FROM v_main.closer_status THEN
    PERFORM set_config('app.contact_status_internal', 'on', true);
    UPDATE public.contacts SET
      setter_status = v_setter, setter_status_at = v_setter_at, setter_status_by_agent = COALESCE(v_setter_by_agent, false),
      closer_status = v_closer, closer_status_at = v_closer_at,
      last_status_role = v_last_role, last_status = v_last, last_status_at = v_last_at
     WHERE id = p_main;
    PERFORM set_config('app.contact_status_internal', 'off', true);
  END IF;

  -- Las notas de los dos se juntan (dos textos de personas distintas sobre el mismo lead: quedarse con uno tira el otro).
  v_notes := concat_ws(E'\n\n---\n\n', NULLIF(btrim(COALESCE(v_main.notes, '')), ''), NULLIF(btrim(COALESCE(v_dup.notes, '')), ''));
  IF v_notes <> '' AND v_notes IS DISTINCT FROM btrim(COALESCE(v_main.notes, '')) THEN
    UPDATE public.contacts SET notes = v_notes WHERE id = p_main;
  END IF;

  -- La sugerencia de vinculacion ya no corresponde.
  UPDATE public.contacts SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb), '{link_suggestions}',
      COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(metadata -> 'link_suggestions') s WHERE s ->> 'contact_id' IS DISTINCT FROM p_duplicate::text), '[]'::jsonb))
   WHERE id = p_main AND jsonb_typeof(metadata -> 'link_suggestions') = 'array';

  -- El historial del contacto principal, en la misma transaccion (sin datos sensibles: solo cuentas).
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (p_workspace_id, 'contact', p_main, 'link', NULL,
          jsonb_build_object('merged_from', p_duplicate, 'automatic', false, 'moved', v_moved), p_actor);

  RETURN jsonb_build_object('ok', true, 'main', p_main, 'duplicate', p_duplicate, 'moved', v_moved);
END;
$function$;

-- ─── 10. CHECK de triggers.type: los vigentes (leidos de la base) + los 3 de afiliados ───────────────────────────
-- Anterior (leido de la base el 8/11/2026): CHECK ((type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text, 'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text, 'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text, 'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text, 'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text, 'task_completed'::text, 'task_overdue'::text, 'whatsapp_group_joined'::text, 'whatsapp_group_reaction'::text, 'whatsapp_group_poll_vote'::text, 'service_created'::text, 'service_started'::text, 'service_ending_soon'::text, 'service_status_changed'::text, 'service_extended'::text, 'service_paused'::text, 'service_resumed'::text, 'service_phase_started'::text, 'service_phase_completed'::text, 'service_item_completed'::text, 'service_item_overdue'::text, 'service_light_changed'::text, 'program_lesson_completed'::text, 'program_module_completed'::text, 'quiz_passed'::text, 'quiz_failed'::text, 'task_submission_received'::text, 'task_submission_reviewed'::text, 'live_session_missed'::text, 'challenge_started'::text, 'challenge_occurrence_due_soon'::text, 'challenge_occurrence_overdue'::text, 'challenge_completed'::text, 'certificate_issued'::text, 'portal_access_expiring'::text, 'portal_access_expired'::text])))
ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text, 'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text, 'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text, 'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text, 'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text, 'task_completed'::text, 'task_overdue'::text, 'whatsapp_group_joined'::text, 'whatsapp_group_reaction'::text, 'whatsapp_group_poll_vote'::text, 'service_created'::text, 'service_started'::text, 'service_ending_soon'::text, 'service_status_changed'::text, 'service_extended'::text, 'service_paused'::text, 'service_resumed'::text, 'service_phase_started'::text, 'service_phase_completed'::text, 'service_item_completed'::text, 'service_item_overdue'::text, 'service_light_changed'::text, 'program_lesson_completed'::text, 'program_module_completed'::text, 'quiz_passed'::text, 'quiz_failed'::text, 'task_submission_received'::text, 'task_submission_reviewed'::text, 'live_session_missed'::text, 'challenge_started'::text, 'challenge_occurrence_due_soon'::text, 'challenge_occurrence_overdue'::text, 'challenge_completed'::text, 'certificate_issued'::text, 'portal_access_expiring'::text, 'portal_access_expired'::text, 'affiliate_lead_created'::text, 'affiliate_sale_created'::text, 'affiliate_assignment_expired'::text]));

-- ─── 11. La lista del Member suma affiliates.use (cambio aprobado M11; lo copia la gemela TS) ───────────────────
CREATE OR REPLACE FUNCTION private.member_permission_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT ARRAY[
    'dashboards.chat.view',
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
    'commissions.view',
    'designer.view',
    'designer.edit',
    'services.view',
    'services.items',
    'portal.view_as', 'affiliates.use'
  ]::text[]
$function$;

-- ─── 12. El vencimiento diario (F72): por SQL directo, sin ruta de app/api/cron ──────────────────────────────────
CREATE OR REPLACE FUNCTION private.affiliates_daily()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('affiliates-daily') FROM cron.job WHERE jobname = 'affiliates-daily';
    PERFORM cron.schedule('affiliates-daily', '15 * * * *', 'SELECT private.affiliates_daily();');
  END IF;
END $$;

-- ─── 13. Permisos de ejecucion ──────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.affiliate_codes_guard(), public.affiliate_contact_guard(), public.affiliate_sale_guard(), public.product_links_guard(),
  public.affiliate_settings_guard(), public.affiliate_touch_hook(), public.affiliate_internal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_product_links(jsonb, uuid[]), public.validate_affiliate_settings(jsonb), public.affiliate_assign_plan(jsonb),
  public.affiliate_by_code(uuid, text), public.affiliate_assign(uuid, text, timestamptz, uuid), public.affiliate_ref_of_touch(public.contact_touches),
  public.product_links_save(uuid, jsonb, integer), public.affiliate_settings_save(uuid, jsonb, integer), public.affiliate_ensure_code(uuid, text, uuid),
  public.affiliate_set_contact(uuid, jsonb, text, timestamptz, text), public.affiliate_set_sale(uuid, jsonb, text, text),
  public.commission_apply_max(jsonb), public.commission_edit(uuid, jsonb, text, uuid), private.affiliates_daily() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_product_links(jsonb, uuid[]), public.validate_affiliate_settings(jsonb), public.affiliate_assign_plan(jsonb),
  public.affiliate_by_code(uuid, text), public.affiliate_assign(uuid, text, timestamptz, uuid), public.affiliate_ref_of_touch(public.contact_touches),
  public.product_links_save(uuid, jsonb, integer), public.affiliate_settings_save(uuid, jsonb, integer), public.affiliate_ensure_code(uuid, text, uuid),
  public.affiliate_set_contact(uuid, jsonb, text, timestamptz, text), public.affiliate_set_sale(uuid, jsonb, text, text),
  public.commission_apply_max(jsonb), public.commission_edit(uuid, jsonb, text, uuid), private.affiliates_daily(), public.affiliate_internal() TO service_role;
-- Con la sesion (cada una mira el permiso adentro): guardar links y reglas, el codigo propio y asignar a mano.
GRANT EXECUTE ON FUNCTION public.product_links_save(uuid, jsonb, integer), public.affiliate_settings_save(uuid, jsonb, integer),
  public.affiliate_ensure_code(uuid, text, uuid), public.affiliate_set_contact(uuid, jsonb, text, timestamptz, text),
  public.affiliate_set_sale(uuid, jsonb, text, text), public.affiliate_internal() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.affiliate_assign(uuid, text, timestamptz, uuid), public.commission_edit(uuid, jsonb, text, uuid), private.affiliates_daily() FROM authenticated;

