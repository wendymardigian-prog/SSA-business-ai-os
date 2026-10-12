-- ============================================================
-- 00159_sales_catalog.sql
--
-- Ventas, Fase 1 · B1 · F1: el catalogo de productos.
--
-- Tres tablas: `products` (lo que se vende), `product_variants` (como se
-- vende: duracion, garantia, facturacion) y `product_versions` (el PRECIO y
-- las condiciones vigentes). A lo sumo una version `active` por variante.
--
-- Aditiva e idempotente: no toca ninguna tabla existente salvo sumar
-- `workspaces.enabled_payment_methods`. La migracion que absorbe
-- `content_offers` es la 00160.
--
-- Escritura: solo con `settings.manage` (Owner y Admin; un rol personalizado
-- si la marco). Lectura: cualquier miembro (un Member necesita ver los
-- productos para cargar una venta). SIN policy de DELETE: nada se borra.
-- Un borrador de version si se puede borrar, pero solo desde el servidor
-- (service_role) y el trigger de abajo lo permite unicamente en borrador.
--
-- Como volver atras (solo si nadie la usa todavia):
--   DROP FUNCTION IF EXISTS public.publish_product_version(uuid, uuid);
--   DROP TABLE IF EXISTS public.product_versions, public.product_variants, public.products;
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS enabled_payment_methods;
-- ============================================================

-- ------------------------------------------------------------
-- 1. products
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  product_type  text NOT NULL DEFAULT 'otro',
  display_order int  NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'active',
  archived_at   timestamptz,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.products IS
  'Catalogo de productos (Ventas, 00159). Reemplaza a content_offers: los productos migrados conservan el id. Un producto no se borra: pasa a inactivo o discontinuado.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_name_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_type_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_type_check
      CHECK (product_type IN ('programa', 'mentoria', 'curso', 'servicio', 'otro'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_status_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_status_check
      CHECK (status IN ('active', 'inactive', 'discontinued'));
  END IF;
  -- Los mismos estados y la misma regla que content_offers (00134).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_status_archived_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_status_archived_check
      CHECK ((status = 'active') = (archived_at IS NULL));
  END IF;
END $$;

-- El nombre es unico entre los NO archivados (como content_offers).
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_name
  ON public.products (workspace_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_ws_status_order
  ON public.products (workspace_id, status, display_order);

-- ------------------------------------------------------------
-- 2. product_variants
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.product_variants (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id                uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  name                      text NOT NULL,
  duration_type             text NOT NULL DEFAULT 'lifetime',
  duration_value            int,
  guarantee_duration_type   text,
  guarantee_duration_value  int,
  billing_type              text NOT NULL DEFAULT 'one_time',
  billing_interval          text,
  display_order             int  NOT NULL DEFAULT 0,
  archived_at               timestamptz,
  created_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_variants IS
  'Como se vende un producto (duracion, garantia, facturacion). El precio vive en product_versions. CX va a sumar sus columnas aca en su propia migracion.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_name_check') THEN
    ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_duration_type_check') THEN
    ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_duration_type_check
      CHECK (duration_type IN ('days', 'weeks', 'months', 'lifetime'));
  END IF;
  -- lifetime => sin valor; si no, un valor positivo.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_duration_value_check') THEN
    ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_duration_value_check
      CHECK (
        (duration_type = 'lifetime' AND duration_value IS NULL)
        OR (duration_type <> 'lifetime' AND duration_value IS NOT NULL AND duration_value > 0)
      );
  END IF;
  -- Ojo con NULL IN (...): da NULL y un CHECK deja pasar un NULL. Por eso cada
  -- rama pide IS NOT NULL de forma explicita.
  ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_guarantee_check;
  ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_guarantee_check
    CHECK (
      (guarantee_duration_type IS NULL AND guarantee_duration_value IS NULL)
      OR (guarantee_duration_type IS NOT NULL AND guarantee_duration_type IN ('days', 'weeks', 'months')
          AND guarantee_duration_value IS NOT NULL AND guarantee_duration_value > 0)
    );
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_billing_type_check') THEN
    ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_billing_type_check
      CHECK (billing_type IN ('one_time', 'recurring'));
  END IF;
  -- recurring => intervalo obligatorio; one_time => sin intervalo.
  ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_billing_interval_check;
  ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_billing_interval_check
    CHECK (
      (billing_type = 'one_time' AND billing_interval IS NULL)
      OR (billing_type = 'recurring' AND billing_interval IS NOT NULL AND billing_interval IN ('monthly', 'quarterly', 'yearly'))
    );
END $$;

CREATE INDEX IF NOT EXISTS idx_product_variants_product
  ON public.product_variants (product_id, archived_at, display_order);
CREATE INDEX IF NOT EXISTS idx_product_variants_ws
  ON public.product_variants (workspace_id);

-- ------------------------------------------------------------
-- 3. product_versions
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.product_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_variant_id  uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  version_number      int  NOT NULL,
  price               numeric(12,2) NOT NULL,
  currency            text NOT NULL DEFAULT 'USD',
  change_notes        text,
  capabilities_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'draft',
  published_at        timestamptz,
  published_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deprecated_at       timestamptz,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_versions IS
  'El precio y las condiciones vigentes de una variante. Una version publicada no se edita nunca: se crea otra. A lo sumo una active por variante.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_versions_price_check') THEN
    ALTER TABLE public.product_versions ADD CONSTRAINT product_versions_price_check
      CHECK (price >= 0);
  END IF;
  -- Precio cero solo con notas del cambio (una cortesia o un error se explica).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_versions_zero_needs_notes_check') THEN
    ALTER TABLE public.product_versions ADD CONSTRAINT product_versions_zero_needs_notes_check
      CHECK (price > 0 OR (change_notes IS NOT NULL AND btrim(change_notes) <> ''));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_versions_currency_check') THEN
    ALTER TABLE public.product_versions ADD CONSTRAINT product_versions_currency_check
      CHECK (currency = 'USD');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_versions_status_check') THEN
    ALTER TABLE public.product_versions ADD CONSTRAINT product_versions_status_check
      CHECK (status IN ('draft', 'active', 'deprecated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_versions_number_check') THEN
    ALTER TABLE public.product_versions ADD CONSTRAINT product_versions_number_check
      CHECK (version_number >= 1);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_versions_number
  ON public.product_versions (product_variant_id, version_number);

-- Una sola version activa por variante.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_versions_active
  ON public.product_versions (product_variant_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_product_versions_ws
  ON public.product_versions (workspace_id);

-- El numero de version es autoincremental por variante: si el insert no lo trae, se calcula.
CREATE OR REPLACE FUNCTION public.product_versions_assign_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.version_number IS NULL THEN
    SELECT COALESCE(MAX(v.version_number), 0) + 1
      INTO NEW.version_number
      FROM public.product_versions v
     WHERE v.product_variant_id = NEW.product_variant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_versions_assign_number ON public.product_versions;
CREATE TRIGGER product_versions_assign_number
  BEFORE INSERT ON public.product_versions
  FOR EACH ROW EXECUTE FUNCTION public.product_versions_assign_number();

-- Una version publicada no se edita ni se borra, ni siquiera con el service role.
-- Transiciones validas: draft -> active, active -> deprecated. Un borrador se
-- edita y se borra libremente.
CREATE OR REPLACE FUNCTION public.product_versions_protect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Borrar un workspace entero (cascade) tiene que poder llevarse todo: en ese
    -- caso el workspace ya no existe cuando corre este trigger.
    IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN
      RETURN OLD;
    END IF;
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Una version publicada no se borra (version % de la variante %)', OLD.version_number, OLD.product_variant_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF NEW.product_variant_id IS DISTINCT FROM OLD.product_variant_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.price IS DISTINCT FROM OLD.price
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.change_notes IS DISTINCT FROM OLD.change_notes
     OR NEW.capabilities_config IS DISTINCT FROM OLD.capabilities_config
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'Una version publicada no se edita: crea una nueva'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'active' AND NEW.status = 'deprecated') THEN
    RAISE EXCEPTION 'Transicion de version invalida: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_versions_protect ON public.product_versions;
CREATE TRIGGER product_versions_protect
  BEFORE UPDATE OR DELETE ON public.product_versions
  FOR EACH ROW EXECUTE FUNCTION public.product_versions_protect();

-- ------------------------------------------------------------
-- 4. updated_at y RLS de las tres
-- ------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'product_variants', 'product_versions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()',
      t
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_select" ON public.%1$I FOR SELECT USING (public.is_workspace_member(workspace_id))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_insert" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_insert" ON public.%1$I FOR INSERT WITH CHECK (public.has_permission(workspace_id, ''settings.manage''))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_update" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_update" ON public.%1$I FOR UPDATE USING (public.has_permission(workspace_id, ''settings.manage'')) WITH CHECK (public.has_permission(workspace_id, ''settings.manage''))',
      t
    );

    -- Sin policy de DELETE, a proposito.
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_delete" ON public.%1$I', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5. Publicar una version, en UNA transaccion
-- ------------------------------------------------------------
-- La que estaba activa pasa a `deprecated` y la nueva a `active`. Solo el
-- servidor la llama (con el cliente de servicio, despues de requirePermission).
-- Devuelve la version publicada y la que se depreco (si habia).

CREATE OR REPLACE FUNCTION public.publish_product_version(p_version_id uuid, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version public.product_versions%ROWTYPE;
  v_prev_id uuid;
BEGIN
  SELECT * INTO v_version
    FROM public.product_versions
   WHERE id = p_version_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'version_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_version.status <> 'draft' THEN
    RAISE EXCEPTION 'version_not_draft' USING ERRCODE = 'check_violation';
  END IF;

  -- Bloquea la variante para que dos publicaciones simultaneas no choquen.
  PERFORM 1 FROM public.product_variants WHERE id = v_version.product_variant_id FOR UPDATE;

  UPDATE public.product_versions
     SET status = 'deprecated', deprecated_at = now()
   WHERE product_variant_id = v_version.product_variant_id
     AND status = 'active'
  RETURNING id INTO v_prev_id;

  UPDATE public.product_versions
     SET status = 'active', published_at = now(), published_by = p_actor_id
   WHERE id = p_version_id;

  RETURN jsonb_build_object('version_id', p_version_id, 'deprecated_version_id', v_prev_id);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_product_version(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_product_version(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.publish_product_version(uuid, uuid) IS
  'Publica un borrador: la activa pasa a deprecated y esta a active, en una transaccion. Solo service_role (00159).';

-- ------------------------------------------------------------
-- 6. Metodos de pago habilitados por workspace
-- ------------------------------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS enabled_payment_methods text[] NOT NULL
  DEFAULT ARRAY['whop', 'transferencia_cr', 'transferencia_usa', 'wise', 'binance']::text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_enabled_payment_methods_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_enabled_payment_methods_check
      CHECK (enabled_payment_methods <@ ARRAY['whop', 'transferencia_cr', 'transferencia_usa', 'wise', 'binance']::text[]);
  END IF;
END $$;

COMMENT ON COLUMN public.workspaces.enabled_payment_methods IS
  'Metodos de pago que ofrece el selector (la lista completa esta en lib/sales/payment-methods.ts). Un pago que ya usa uno deshabilitado lo sigue mostrando.';
