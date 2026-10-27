-- ============================================================================
-- Catalogo de productos y asignacion de leads
--
-- El catalogo de productos y sus variantes (con su precio en USD). El historial de
-- cada cambio lo escribe la base en audit_log.
--
-- La asignacion automatica de leads: las reglas para elegir setter, vendedor y referido
-- de cada contacto. Algunos nombres internos dicen "sales": son de la asignacion
-- y se dejan asi a proposito.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.assignment_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  kind text NOT NULL,
  entity_type text DEFAULT 'contact'::text NOT NULL,
  mode text DEFAULT 'manual'::text NOT NULL,
  enabled_member_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  last_assigned_member_id uuid,
  condition_rules jsonb DEFAULT '[]'::jsonb NOT NULL,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT assignment_rules_pkey PRIMARY KEY (id),
  CONSTRAINT assignment_rules_conditions_array_check CHECK ((jsonb_typeof(condition_rules) = 'array'::text)),
  CONSTRAINT assignment_rules_entity_check CHECK ((entity_type = 'contact'::text)),
  CONSTRAINT assignment_rules_kind_check CHECK ((kind = ANY (ARRAY['setter'::text, 'vendedor'::text, 'referral'::text]))),
  CONSTRAINT assignment_rules_mode_check CHECK ((mode = ANY (ARRAY['manual'::text, 'round_robin'::text, 'condition_based'::text]))),
  CONSTRAINT assignment_rules_referral_mode_check CHECK (((kind <> 'referral'::text) OR (mode <> 'round_robin'::text))),
  CONSTRAINT assignment_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT assignment_rules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.assignment_rules ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.assignment_rules IS 'Reglas de asignacion automatica de un contacto: una fila por workspace y kind (setter, vendedor, referido). Arrancan en manual.';

CREATE TABLE IF NOT EXISTS public.products (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  product_type text DEFAULT 'producto'::text NOT NULL,
  display_order integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  archived_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
  CONSTRAINT products_status_archived_check CHECK (((status = 'active'::text) = (archived_at IS NULL))),
  CONSTRAINT products_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'discontinued'::text]))),
  CONSTRAINT products_type_check CHECK ((product_type = ANY (ARRAY['programa'::text, 'mentoria'::text, 'curso'::text, 'evento'::text, 'servicio'::text, 'producto'::text]))),
  CONSTRAINT products_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT products_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT products_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.products IS 'Catalogo de productos. Un producto no se borra: pasa a inactivo o discontinuado.';

CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  name text NOT NULL,
  duration_type text DEFAULT 'lifetime'::text NOT NULL,
  duration_value integer,
  billing_type text DEFAULT 'one_time'::text NOT NULL,
  billing_interval text,
  display_order integer DEFAULT 0 NOT NULL,
  archived_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  price numeric(12,2) DEFAULT 0 NOT NULL,
  event_date date,
  CONSTRAINT product_variants_pkey PRIMARY KEY (id),
  CONSTRAINT product_variants_billing_interval_check CHECK ((((billing_type = 'one_time'::text) AND (billing_interval IS NULL)) OR ((billing_type = 'recurring'::text) AND (billing_interval IS NOT NULL) AND (billing_interval = ANY (ARRAY['monthly'::text, 'quarterly'::text, 'yearly'::text]))))),
  CONSTRAINT product_variants_billing_type_check CHECK ((billing_type = ANY (ARRAY['one_time'::text, 'recurring'::text]))),
  CONSTRAINT product_variants_duration_type_check CHECK ((duration_type = ANY (ARRAY['days'::text, 'weeks'::text, 'months'::text, 'lifetime'::text]))),
  CONSTRAINT product_variants_duration_value_check CHECK ((((duration_type = 'lifetime'::text) AND (duration_value IS NULL)) OR ((duration_type <> 'lifetime'::text) AND (duration_value IS NOT NULL) AND (duration_value > 0)))),
  CONSTRAINT product_variants_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
  CONSTRAINT product_variants_price_check CHECK ((price >= (0)::numeric)),
  CONSTRAINT product_variants_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT,
  CONSTRAINT product_variants_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT product_variants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.product_variants IS 'Como se vende un producto: duracion, facturacion y PRECIO. El historial de cambios vive en audit_log.';
COMMENT ON COLUMN public.product_variants.price IS 'Precio de la variante, siempre en USD. 0 = sin precio. Cada cambio queda en audit_log.';
COMMENT ON COLUMN public.product_variants.event_date IS 'La fecha fija de un evento. Null en los demas tipos: su duracion empieza el dia que compra cada cliente.';

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.catalog_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_is_product boolean := TG_TABLE_NAME = 'products';
  v_entity text := CASE WHEN TG_TABLE_NAME = 'products' THEN 'product' ELSE 'product_variant' END;
  v_prefix text := CASE WHEN TG_TABLE_NAME = 'products' THEN 'product' ELSE 'variant' END;
  v_actor uuid;
  v_action text;
  v_changes jsonb;
  v_meta jsonb;
  v_row jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Borrar un workspace entero (cascade) se lleva sus productos: el workspace ya no existe
    -- y el historial tampoco tiene a donde escribirse.
    IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN
      RETURN OLD;
    END IF;
    v_actor := COALESCE(auth.uid(), OLD.updated_by, OLD.created_by);
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type, actor_label)
    VALUES (OLD.workspace_id, v_entity, OLD.id, v_prefix || '.deleted', NULL,
            jsonb_build_object('name', OLD.name),
            v_actor,
            CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
            CASE WHEN v_actor IS NULL THEN 'Sistema' END);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_actor := COALESCE(auth.uid(), NEW.created_by);
    -- Por jsonb y no por `NEW.price`: la misma funcion corre sobre dos tablas y cada una tiene sus columnas.
    v_row := to_jsonb(NEW);
    v_meta := CASE WHEN v_is_product
      THEN jsonb_build_object('name', v_row ->> 'name', 'product_type', v_row ->> 'product_type')
      ELSE jsonb_build_object('name', v_row ->> 'name', 'product_id', v_row ->> 'product_id', 'price', v_row -> 'price')
    END;
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type, actor_label)
    VALUES (NEW.workspace_id, v_entity, NEW.id, v_prefix || '.created', NULL, v_meta,
            v_actor,
            CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
            CASE WHEN v_actor IS NULL THEN 'Sistema' END);
    RETURN NEW;
  END IF;

  -- UPDATE: el diff campo por campo, sin `updated_at` ni `updated_by`.
  SELECT jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
    INTO v_changes
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
   WHERE n.value IS DISTINCT FROM o.value
     AND n.key NOT IN ('updated_at', 'updated_by');

  -- No cambio nada: no hay nada que contar.
  IF v_changes IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_is_product THEN
    IF v_changes ? 'status' OR v_changes ? 'archived_at' THEN
      v_action := 'product.status_changed';
      -- `archived_at` acompana siempre al estado (lo exige un CHECK): el cambio que se lee es el del estado.
      IF v_changes ? 'status' THEN v_changes := v_changes - 'archived_at'; END IF;
    ELSE
      v_action := 'product.updated';
    END IF;
  ELSE
    IF v_changes ? 'archived_at' THEN
      v_action := CASE WHEN NEW.archived_at IS NULL THEN 'variant.restored' ELSE 'variant.archived' END;
    ELSIF v_changes ? 'price' THEN
      v_action := 'variant.price_changed';
    ELSE
      v_action := 'variant.updated';
    END IF;
  END IF;

  v_actor := COALESCE(auth.uid(), NEW.updated_by);
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type, actor_label)
  VALUES (NEW.workspace_id, v_entity, NEW.id, v_action, v_changes, NULL,
          v_actor,
          CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
          CASE WHEN v_actor IS NULL THEN 'Sistema' END);
  RETURN NEW;
END;
$function$;
COMMENT ON FUNCTION public.catalog_audit() IS 'Escribe el historial (audit_log) de products y product_variants: alta, estado, precio, archivado y el resto de los campos.';
REVOKE ALL ON FUNCTION public.catalog_audit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contacts_enqueue_sales_eval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.assignment_rules r
       WHERE r.workspace_id = NEW.workspace_id AND r.mode <> 'manual'
    ) THEN
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES (
        'sales_contact_eval',
        jsonb_build_object('contact_id', NEW.id, 'workspace_id', NEW.workspace_id),
        now(),
        'sales_eval:' || NEW.id::text || ':' || md5(coalesce(NEW.attribution::text, ''))
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'contacts_enqueue_sales_eval: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.contacts_enqueue_sales_eval() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_sales_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.assignment_rules (workspace_id, kind, entity_type, mode)
  VALUES (NEW.id, 'setter', 'contact', 'manual'),
         (NEW.id, 'vendedor', 'contact', 'manual'),
         (NEW.id, 'referral', 'contact', 'manual')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants USING btree (product_id, archived_at, display_order);

CREATE INDEX IF NOT EXISTS idx_product_variants_ws ON public.product_variants USING btree (workspace_id);

CREATE INDEX IF NOT EXISTS idx_products_ws_status_order ON public.products USING btree (workspace_id, status, display_order);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_rules_kind ON public.assignment_rules USING btree (workspace_id, kind, entity_type);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_name ON public.products USING btree (workspace_id, lower(btrim(name))) WHERE (archived_at IS NULL);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.assignment_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER product_variants_audit AFTER INSERT OR DELETE OR UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.catalog_audit();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER products_audit AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.catalog_audit();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER seed_sales_defaults AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.seed_sales_defaults();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY assignment_rules_insert ON public.assignment_rules FOR INSERT TO public
    WITH CHECK (public.has_permission(workspace_id, 'assignment.manage'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY assignment_rules_select ON public.assignment_rules FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY assignment_rules_update ON public.assignment_rules FOR UPDATE TO public
    USING (public.has_permission(workspace_id, 'assignment.manage'::text))
    WITH CHECK (public.has_permission(workspace_id, 'assignment.manage'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY product_variants_insert ON public.product_variants FOR INSERT TO public
    WITH CHECK (public.has_permission(workspace_id, 'products.manage'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY product_variants_select ON public.product_variants FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY product_variants_update ON public.product_variants FOR UPDATE TO public
    USING (public.has_permission(workspace_id, 'products.manage'::text))
    WITH CHECK (public.has_permission(workspace_id, 'products.manage'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY products_insert ON public.products FOR INSERT TO public
    WITH CHECK (public.has_permission(workspace_id, 'products.manage'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY products_select ON public.products FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY products_update ON public.products FOR UPDATE TO public
    USING (public.has_permission(workspace_id, 'products.manage'::text))
    WITH CHECK (public.has_permission(workspace_id, 'products.manage'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
