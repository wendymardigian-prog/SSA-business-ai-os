-- ============================================================
-- 00169_variant_price_drop_versions.sql
--
-- Ventas, Fase 1 · el precio vive en la VARIANTE y desaparece `product_versions`.
--
-- Por que: la venta ya guarda una copia congelada del producto y de su precio
-- (`sales.product_snapshot`), y el historial de cambios vive en `audit_log`
-- (00170). Una tabla de versiones aparte no sumaba nada que no estuviera en esos
-- dos lugares. Se pierde, a proposito: preparar un precio en borrador y publicarlo
-- despues. Un cambio de precio es inmediato y queda en el historial.
--
-- Que hace, en orden (todo en UNA transaccion):
--   1. `product_variants.price` (USD, >= 0; 0 = "sin precio", no se puede vender),
--      con el precio de la version ACTIVA de cada variante.
--   2. `sales.product_variant_id` (FK RESTRICT, NOT NULL) reemplaza a
--      `sales.product_version_id`; se rellena desde la version de cada venta.
--   3. `create_sale` compara el precio de la VARIANTE con el que mostro el asistente
--      (`price_changed:<precio de hoy>`) y rechaza una variante archivada o de un
--      producto inactivo (`invalid_variant`). Partio de la definicion vigente en la
--      base (md5 bc7b29e3da3501d7039016c541c6fbcd); solo cambian las lineas de la
--      variante (ver `lib/sales/create-sale-variant-diff.test.ts`).
--   4. El puente `content_offers_bridge_to_products()` (00160) deja de crear
--      versiones: copia el precio a la variante. Tiene que seguir andando porque
--      produccion (main) todavia escribe en `content_offers` hasta que se despliegue
--      esta rama (md5 vigente dbf13b08f9242cad404cba1064b6813e).
--   5. Borra `product_versions` con sus triggers y sus funciones.
--
-- No toca datos de Contenido ni de Formularios. Hoy: 3 versiones (3000, 6000, 12000)
-- y 0 ventas. Respaldo previo: docs/ventas/respaldo-product-versions.json.
--
-- Idempotente: aplicarla dos veces no rompe nada.
--
-- ------------------------------------------------------------
-- CONSULTAS DE CONTROL (despues de aplicar):
--
--   SELECT to_regclass('public.product_versions');                                    -- null
--   SELECT count(*) FROM public.product_variants WHERE price > 0;                     -- = variantes con precio (3)
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='sales' AND column_name LIKE 'product_%'; -- product_snapshot, product_variant_id
--   SELECT count(*) FROM pg_proc WHERE proname IN ('publish_product_version',
--     'product_versions_assign_number','product_versions_protect');                   -- 0
--
-- COMO VOLVER ATRAS (la tabla es irreversible; se rearma desde el respaldo):
--
--   1. Recrear `product_versions` y sus dos funciones con la definicion de la 00159.
--   2. Reinsertar las filas de docs/ventas/respaldo-product-versions.json.
--   3. ALTER TABLE public.sales ADD COLUMN product_version_id uuid REFERENCES public.product_versions(id) ON DELETE RESTRICT;
--      y rellenarla (con 0 ventas no hay nada que rellenar).
--   4. Restaurar `create_sale` y el puente con estas definiciones (las de antes):
--
-- create_sale (antes):
--   CREATE OR REPLACE FUNCTION public.create_sale(p_payload jsonb, p_actor_id uuid)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_ws uuid := (p_payload ->> 'workspace_id')::uuid;
--     v_contact uuid := (p_payload ->> 'contact_id')::uuid;
--     v_version_id uuid := (p_payload ->> 'product_version_id')::uuid;
--     v_base numeric := (p_payload ->> 'base_amount')::numeric;
--     v_discount numeric := COALESCE((p_payload ->> 'discount_amount')::numeric, 0);
--     v_final numeric := v_base - COALESCE((p_payload ->> 'discount_amount')::numeric, 0);
--     v_financing text := p_payload ->> 'financing_type';
--     v_payments jsonb := COALESCE(p_payload -> 'payments', '[]'::jsonb);
--     v_attr_req jsonb := COALESCE(p_payload -> 'attribution', '{"mode":"last_touch"}'::jsonb);
--     v_mode text;
--     v_touch public.contact_touches%ROWTYPE;
--     v_attribution jsonb := NULL;
--     v_attr_type text := 'none';
--     v_attr_touch_id uuid := NULL;
--     v_version public.product_versions%ROWTYPE;
--     v_tz text;
--     v_today date;
--     v_sale_date date := (p_payload ->> 'sale_date')::date;
--     v_booking uuid := NULLIF(p_payload ->> 'booking_id', '')::uuid;
--     v_status text;
--     v_sale public.sales%ROWTYPE;
--     v_change uuid := gen_random_uuid();
--     v_scheduled_sum_cents bigint;
--     p jsonb;
--   BEGIN
--     IF v_ws IS NULL OR v_contact IS NULL OR v_version_id IS NULL OR v_base IS NULL OR v_financing IS NULL THEN
--       RAISE EXCEPTION 'invalid_payload';
--     END IF;
--     IF jsonb_typeof(v_payments) <> 'array' OR jsonb_array_length(v_payments) = 0 THEN
--       RAISE EXCEPTION 'invalid_payload:payments';
--     END IF;
--
--     -- El contacto es de este workspace y no esta en la papelera.
--     IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = v_contact AND c.workspace_id = v_ws AND c.deleted_at IS NULL) THEN
--       RAISE EXCEPTION 'invalid_contact';
--     END IF;
--
--     -- La version sigue activa y con el mismo precio que se mostro (si no: version_changed + precio nuevo).
--     SELECT * INTO v_version FROM public.product_versions WHERE id = v_version_id AND workspace_id = v_ws;
--     IF NOT FOUND THEN RAISE EXCEPTION 'invalid_version'; END IF;
--     IF v_version.status <> 'active' OR v_version.price IS DISTINCT FROM (p_payload -> 'product_snapshot' ->> 'price')::numeric THEN
--       RAISE EXCEPTION 'version_changed:%', COALESCE((
--         SELECT a.price FROM public.product_versions a
--          WHERE a.product_variant_id = v_version.product_variant_id AND a.status = 'active'), 0);
--     END IF;
--
--     -- Fecha de la venta: no futura, en la zona del workspace.
--     SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = v_ws;
--     v_today := (now() AT TIME ZONE COALESCE(v_tz, 'UTC'))::date;
--     IF v_sale_date IS NULL OR v_sale_date > v_today THEN RAISE EXCEPTION 'invalid_sale_date'; END IF;
--
--     -- La agenda de origen: del MISMO contacto y ya pasada.
--     IF v_booking IS NOT NULL AND NOT EXISTS (
--       SELECT 1 FROM public.bookings b
--        WHERE b.id = v_booking AND b.workspace_id = v_ws AND b.contact_id = v_contact AND b.start_at < now()
--     ) THEN
--       RAISE EXCEPTION 'invalid_booking';
--     END IF;
--
--     -- El cuadre, otra vez, en centimos: lo programado y cobrado (sin reembolsos) suma EXACTO el final.
--     IF v_financing <> 'subscription' THEN
--       SELECT COALESCE(sum(round((x ->> 'amount')::numeric * 100)), 0)::bigint INTO v_scheduled_sum_cents
--         FROM jsonb_array_elements(v_payments) x WHERE x ->> 'type' <> 'refund';
--       IF v_scheduled_sum_cents <> round(v_final * 100)::bigint THEN
--         RAISE EXCEPTION 'plan_unbalanced:%', (round(v_final * 100)::bigint - v_scheduled_sum_cents);
--       END IF;
--     END IF;
--
--     -- La atribucion se resuelve ACA, dentro de la transaccion: con `last_touch` es el toque
--     -- mas reciente AL GUARDAR (no el que mostraba el asistente).
--     v_mode := COALESCE(v_attr_req ->> 'mode', 'last_touch');
--     IF v_mode = 'touch' THEN
--       SELECT * INTO v_touch FROM public.contact_touches
--        WHERE id = NULLIF(v_attr_req ->> 'touch_id', '')::uuid AND contact_id = v_contact AND workspace_id = v_ws;
--       IF NOT FOUND THEN RAISE EXCEPTION 'invalid_touch'; END IF;
--       v_attribution := public.sale_attribution_from_touch(v_touch);
--       v_attr_type := 'manual';
--       v_attr_touch_id := v_touch.id;
--     ELSIF v_mode = 'manual' THEN
--       v_attribution := v_attr_req -> 'manual';
--       IF v_attribution IS NULL OR jsonb_typeof(v_attribution) <> 'object' THEN RAISE EXCEPTION 'invalid_manual'; END IF;
--       v_attr_type := 'manual';
--       v_attr_touch_id := NULLIF(v_attribution ->> 'touch_id', '')::uuid;
--     ELSE
--       SELECT * INTO v_touch FROM public.contact_touches
--        WHERE contact_id = v_contact AND workspace_id = v_ws
--        ORDER BY occurred_at DESC, id DESC LIMIT 1;
--       IF FOUND THEN
--         v_attribution := public.sale_attribution_from_touch(v_touch);
--         v_attr_type := 'last_touch';
--         v_attr_touch_id := v_touch.id;
--       ELSE
--         -- Sin filas de toque: el ultimo de contacts.attribution (forma canonica), sin touch_id.
--         SELECT NULLIF(jsonb_strip_nulls(jsonb_build_object(
--                  'occurred_at', c.attribution -> 'last_touch' ->> 'occurred_at',
--                  'source', c.attribution -> 'last_touch' ->> 'source',
--                  'medium', c.attribution -> 'last_touch' ->> 'medium',
--                  'campaign', c.attribution -> 'last_touch' ->> 'campaign',
--                  'content', c.attribution -> 'last_touch' ->> 'content',
--                  'term', c.attribution -> 'last_touch' ->> 'term',
--                  'ad_id', c.attribution -> 'last_touch' ->> 'ad_id',
--                  'adset_id', c.attribution -> 'last_touch' ->> 'adset_id',
--                  'campaign_id', c.attribution -> 'last_touch' ->> 'campaign_id',
--                  'fbclid', c.attribution -> 'last_touch' ->> 'fbclid',
--                  'gclid', c.attribution -> 'last_touch' ->> 'gclid',
--                  'ttclid', c.attribution -> 'last_touch' ->> 'ttclid',
--                  'li_fat_id', c.attribution -> 'last_touch' ->> 'li_fat_id',
--                  'ctwa_clid', c.attribution -> 'last_touch' ->> 'ctwa_clid',
--                  'referrer_url', c.attribution -> 'last_touch' ->> 'referrer_url',
--                  'landing_page', c.attribution -> 'last_touch' ->> 'landing_page')), '{}'::jsonb)
--           INTO v_attribution
--           FROM public.contacts c WHERE c.id = v_contact;
--         IF v_attribution IS NOT NULL THEN v_attr_type := 'last_touch'; END IF;
--       END IF;
--     END IF;
--
--     -- El estado, calculado UNA vez a partir de lo que se va a crear.
--     v_status := public.derive_sale_status(NULL, v_financing, v_final, v_payments);
--
--     INSERT INTO public.sales (
--       workspace_id, contact_id, product_version_id, product_snapshot, base_amount, discount_amount, final_amount,
--       discount_reason, status, financing_type, subscription_interval, sale_date, setter_id, vendedor_id,
--       attribution, attribution_touch_id, attribution_type, booking_id, service_starts_at, notes, created_by, updated_by
--     ) VALUES (
--       v_ws, v_contact, v_version_id, p_payload -> 'product_snapshot', v_base, v_discount, v_final,
--       NULLIF(btrim(p_payload ->> 'discount_reason'), ''), v_status, v_financing,
--       NULLIF(p_payload ->> 'subscription_interval', ''), v_sale_date,
--       NULLIF(p_payload ->> 'setter_id', '')::uuid, NULLIF(p_payload ->> 'vendedor_id', '')::uuid,
--       v_attribution, v_attr_touch_id, v_attr_type, v_booking,
--       NULLIF(p_payload ->> 'service_starts_at', '')::date, NULLIF(btrim(p_payload ->> 'notes'), ''),
--       p_actor_id, p_actor_id
--     ) RETURNING * INTO v_sale;
--
--     -- Los pagos del plan, SIN recalcular el estado fila por fila (ya esta calculado).
--     PERFORM set_config('ssa.suppress_sale_refresh', 'on', true);
--     FOR p IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
--       INSERT INTO public.payments (
--         workspace_id, sale_id, type, amount, status, due_date, paid_at, paid_on, payment_method,
--         payment_option_snapshot, provider_fee_amount, notes, created_by, updated_by
--       ) VALUES (
--         v_ws, v_sale.id, p ->> 'type', (p ->> 'amount')::numeric, p ->> 'status',
--         NULLIF(p ->> 'due_date', '')::date, NULLIF(p ->> 'paid_at', '')::timestamptz, NULLIF(p ->> 'paid_on', '')::date,
--         NULLIF(p ->> 'payment_method', ''), p -> 'payment_option_snapshot',
--         NULLIF(p ->> 'provider_fee_amount', '')::numeric, NULLIF(btrim(p ->> 'notes'), ''), p_actor_id, p_actor_id
--       );
--     END LOOP;
--     PERFORM set_config('ssa.suppress_sale_refresh', '', true);
--
--     -- Eventos de la venta: sale_created y sale_status_changed (from null) con el MISMO change_id.
--     PERFORM public.emit_sales_event(v_ws, 'sale_created', v_contact,
--       public.sales_event_payload(v_sale) || jsonb_build_object('change_id', v_change));
--     PERFORM public.emit_sales_event(v_ws, 'sale_status_changed', v_contact,
--       public.sales_event_payload(v_sale) || jsonb_build_object('change_id', v_change, 'to_status', v_status));
--
--     -- Auditoria: la venta y cada pago cobrado, con actor persona.
--     INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type)
--     VALUES (v_ws, 'sale', v_sale.id, 'sale.created', NULL,
--             jsonb_build_object('final_amount', v_final, 'financing_type', v_financing, 'status', v_status,
--                                'attribution_type', v_attr_type, 'payments', jsonb_array_length(v_payments)),
--             p_actor_id, 'user');
--     INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by, actor_type)
--     SELECT v_ws, 'payment', pay.id, 'payment.paid', NULL,
--            jsonb_build_object('amount', pay.amount, 'payment_method', pay.payment_method, 'sale_id', v_sale.id),
--            p_actor_id, 'user'
--       FROM public.payments pay WHERE pay.sale_id = v_sale.id AND pay.status = 'paid';
--
--     RETURN jsonb_build_object('sale_id', v_sale.id, 'status', v_status, 'attribution_type', v_attr_type);
--   END;
--   $function$
--   ;
--
-- content_offers_bridge_to_products (antes):
--   CREATE OR REPLACE FUNCTION public.content_offers_bridge_to_products()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_variant uuid;
--     v_version uuid;
--     v_active_price numeric;
--     v_next int;
--   BEGIN
--     -- El producto: alta, o cambio de nombre / estado / archivado.
--     INSERT INTO public.products (id, workspace_id, name, product_type, status, archived_at, created_by, created_at)
--     VALUES (NEW.id, NEW.workspace_id, NEW.name, 'otro', NEW.status, NEW.archived_at, NEW.created_by, NEW.created_at)
--     ON CONFLICT (id) DO UPDATE
--        SET name = EXCLUDED.name,
--            status = EXCLUDED.status,
--            archived_at = EXCLUDED.archived_at;
--
--     -- Su variante por defecto ("Estandar"), si todavia no tiene ninguna.
--     SELECT v.id INTO v_variant
--       FROM public.product_variants v
--      WHERE v.product_id = NEW.id AND v.archived_at IS NULL
--      ORDER BY v.display_order, v.created_at
--      LIMIT 1;
--
--     IF v_variant IS NULL THEN
--       INSERT INTO public.product_variants (workspace_id, product_id, name, duration_type, billing_type, display_order, created_by)
--       VALUES (NEW.workspace_id, NEW.id, 'Estándar', 'lifetime', 'one_time', 0, NEW.created_by)
--       RETURNING id INTO v_variant;
--     END IF;
--
--     -- El precio: si cambio (o no habia version vigente), una version nueva publicada.
--     SELECT v.price INTO v_active_price
--       FROM public.product_versions v
--      WHERE v.product_variant_id = v_variant AND v.status = 'active';
--
--     IF NEW.price_usd IS NOT NULL AND (v_active_price IS NULL OR v_active_price <> NEW.price_usd) THEN
--       SELECT COALESCE(MAX(v.version_number), 0) + 1 INTO v_next
--         FROM public.product_versions v WHERE v.product_variant_id = v_variant;
--
--       INSERT INTO public.product_versions
--         (workspace_id, product_variant_id, version_number, price, change_notes, status, created_by)
--       VALUES
--         (NEW.workspace_id, v_variant, v_next, NEW.price_usd, 'Cambio desde la pantalla anterior de Productos', 'draft', NEW.created_by)
--       RETURNING id INTO v_version;
--
--       PERFORM public.publish_product_version(v_version, NEW.created_by);
--     ELSIF NEW.price_usd IS NULL AND NOT EXISTS (
--       SELECT 1 FROM public.product_versions v WHERE v.product_variant_id = v_variant
--     ) THEN
--       INSERT INTO public.product_versions
--         (workspace_id, product_variant_id, version_number, price, change_notes, status, created_by)
--       VALUES
--         (NEW.workspace_id, v_variant, 1, 0, 'Migrado sin precio: cargá el precio y publicá', 'draft', NEW.created_by);
--     END IF;
--
--     RETURN NEW;
--   END;
--   $function$
--   ;
-- ============================================================

-- ------------------------------------------------------------
-- 1. El precio en la variante
-- ------------------------------------------------------------

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS price numeric(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_price_check') THEN
    ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_price_check CHECK (price >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.product_variants.price IS
  'Precio de la variante, siempre en USD. 0 = sin precio (no se puede vender). Cada cambio queda en audit_log (00170).';

COMMENT ON TABLE public.product_variants IS
  'Como se vende un producto: duracion, garantia, facturacion y PRECIO. El historial de cambios vive en audit_log.';

-- El precio vigente de cada variante = el de su version activa (si todavia existe la tabla).
DO $$
BEGIN
  IF to_regclass('public.product_versions') IS NOT NULL THEN
    UPDATE public.product_variants pv
       SET price = a.price
      FROM public.product_versions a
     WHERE a.product_variant_id = pv.id
       AND a.status = 'active'
       AND pv.price IS DISTINCT FROM a.price;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. La venta apunta a la variante
-- ------------------------------------------------------------

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS product_variant_id uuid REFERENCES public.product_variants(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'product_version_id') THEN
    UPDATE public.sales s
       SET product_variant_id = v.product_variant_id
      FROM public.product_versions v
     WHERE v.id = s.product_version_id
       AND s.product_variant_id IS NULL;
  END IF;
END $$;

ALTER TABLE public.sales ALTER COLUMN product_variant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_variant ON public.sales (product_variant_id);
DROP INDEX IF EXISTS public.idx_sales_version;
ALTER TABLE public.sales DROP COLUMN IF EXISTS product_version_id;

-- ------------------------------------------------------------
-- 3. create_sale (definicion vigente + lo de la variante)
-- ------------------------------------------------------------

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
$function$
;

-- ------------------------------------------------------------
-- 4. El puente de content_offers copia el precio a la variante
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.content_offers_bridge_to_products()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_variant uuid;
BEGIN
  -- El producto: alta, o cambio de nombre / estado / archivado.
  INSERT INTO public.products (id, workspace_id, name, product_type, status, archived_at, created_by, created_at)
  VALUES (NEW.id, NEW.workspace_id, NEW.name, 'otro', NEW.status, NEW.archived_at, NEW.created_by, NEW.created_at)
  ON CONFLICT (id) DO UPDATE
     SET name = EXCLUDED.name,
         status = EXCLUDED.status,
         archived_at = EXCLUDED.archived_at;

  -- Su variante por defecto ("Estandar"), si todavia no tiene ninguna.
  SELECT v.id INTO v_variant
    FROM public.product_variants v
   WHERE v.product_id = NEW.id AND v.archived_at IS NULL
   ORDER BY v.display_order, v.created_at
   LIMIT 1;

  IF v_variant IS NULL THEN
    INSERT INTO public.product_variants (workspace_id, product_id, name, duration_type, billing_type, display_order, created_by)
    VALUES (NEW.workspace_id, NEW.id, 'Estándar', 'lifetime', 'one_time', 0, NEW.created_by)
    RETURNING id INTO v_variant;
  END IF;

  -- El precio: lo que el codigo viejo cambia en content_offers se copia a la variante por defecto.
  IF NEW.price_usd IS NOT NULL THEN
    UPDATE public.product_variants
       SET price = NEW.price_usd
     WHERE id = v_variant AND price IS DISTINCT FROM NEW.price_usd;
  END IF;

  RETURN NEW;
END;
$function$
;

-- ------------------------------------------------------------
-- 5. Adios product_versions
-- ------------------------------------------------------------

DROP TABLE IF EXISTS public.product_versions;
DROP FUNCTION IF EXISTS public.publish_product_version(uuid, uuid);
DROP FUNCTION IF EXISTS public.product_versions_assign_number();
DROP FUNCTION IF EXISTS public.product_versions_protect();
