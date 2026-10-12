-- ============================================================
-- 00160_products_absorb_content_offers.sql
--
-- Ventas, Fase 1 · B1 · F3: el catalogo de Ventas ABSORBE `content_offers`.
-- RIESGO ALTO: modifica estructura y datos que Contenido usa todos los dias.
--
-- Hoy "Productos" es la tabla `content_offers` (3 filas). Ventas la reemplaza
-- para que no haya dos pantallas "Productos". Cada fila pasa a ser un producto
-- CON EL MISMO ID, con una variante "Estandar" y su version 1 con el precio que
-- tenia. Como el id no cambia, las ideas y piezas siguen apuntando a su
-- producto sin reescribir nada: lo unico que cambia es a que tabla apunta la FK
-- (`content_ideas.offer_id` y `content_posts.offer_id`).
--
-- Que hace, en orden (todo en UNA transaccion: si algo falla, no queda nada):
--   1. Copia cada fila de content_offers a `products` (mismo id, mismo estado,
--      mismo archived_at, product_type 'otro').
--   2. Crea la variante "Estandar" (lifetime, pago unico) de cada producto migrado
--      que no tenga variantes.
--   3. Crea la version 1: con precio -> ACTIVA con ese precio; sin precio ->
--      BORRADOR con precio 0 y la nota "Migrado sin precio: carga el precio y
--      publica".
--   4. Deja un PUENTE (trigger en content_offers): mientras la tabla vieja
--      conviva, lo que el codigo viejo cree o cambie ahi se copia a `products`
--      con el mismo id. Sin el puente, crear un producto desde la pantalla vieja
--      entre esta migracion y el deploy rompia la clasificacion de Contenido.
--   5. Mueve las dos FK a `products(id) ON DELETE SET NULL`.
--
-- NO borra nada: `content_offers` queda intacta, sin uso. El DROP esta escrito
-- aparte (docs/pendientes/drop_content_offers.sql) y NO se aplica aca.
--
-- Idempotente: aplicarla dos veces no duplica productos, variantes ni versiones.
--
-- ------------------------------------------------------------
-- CONSULTAS DE CONTROL (tienen que dar 0 / lo esperado, ver el DO del final):
--
--   SELECT count(*) FROM public.content_offers o
--     LEFT JOIN public.products p ON p.id = o.id
--    WHERE p.id IS NULL OR p.status <> o.status
--       OR p.archived_at IS DISTINCT FROM o.archived_at OR p.name <> o.name;      -- 0
--   SELECT count(*) FROM public.product_versions WHERE status = 'active';           -- = ofertas con precio
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname IN ('content_ideas_offer_id_fkey','content_posts_offer_id_fkey'); -- REFERENCES products
--
-- COMO VOLVER ATRAS (script de vuelta; content_offers conserva sus filas):
--
--   BEGIN;
--   ALTER TABLE public.content_ideas DROP CONSTRAINT IF EXISTS content_ideas_offer_id_fkey;
--   ALTER TABLE public.content_posts DROP CONSTRAINT IF EXISTS content_posts_offer_id_fkey;
--   -- Productos creados DESPUES de esta migracion y referenciados por ideas o piezas:
--   INSERT INTO public.content_offers (id, workspace_id, name, price_usd, status, archived_at, created_by, created_at)
--   SELECT p.id, p.workspace_id, p.name,
--          (SELECT v.price FROM public.product_versions v
--             JOIN public.product_variants pv ON pv.id = v.product_variant_id
--            WHERE pv.product_id = p.id AND v.status = 'active'
--            ORDER BY pv.display_order LIMIT 1),
--          p.status, p.archived_at, p.created_by, p.created_at
--     FROM public.products p
--    WHERE p.id IN (SELECT offer_id FROM public.content_ideas WHERE offer_id IS NOT NULL
--                   UNION SELECT offer_id FROM public.content_posts WHERE offer_id IS NOT NULL)
--   ON CONFLICT (id) DO NOTHING;
--   ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_offer_id_fkey
--     FOREIGN KEY (offer_id) REFERENCES public.content_offers(id) ON DELETE SET NULL;
--   ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_offer_id_fkey
--     FOREIGN KEY (offer_id) REFERENCES public.content_offers(id) ON DELETE SET NULL;
--   DROP TRIGGER IF EXISTS content_offers_bridge ON public.content_offers;
--   DROP FUNCTION IF EXISTS public.content_offers_bridge_to_products();
--   COMMIT;
--   -- y desplegar el codigo anterior (la pantalla vieja). Las tablas nuevas pueden
--   -- quedar: nadie las lee.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Cada oferta pasa a ser un producto, con el MISMO id
-- ------------------------------------------------------------

INSERT INTO public.products (id, workspace_id, name, product_type, status, archived_at, created_by, created_at)
SELECT o.id, o.workspace_id, o.name, 'otro', o.status, o.archived_at, o.created_by, o.created_at
  FROM public.content_offers o
 WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = o.id);

-- ------------------------------------------------------------
-- 2. La variante "Estandar" de cada producto migrado que no tenga variantes
-- ------------------------------------------------------------

INSERT INTO public.product_variants (workspace_id, product_id, name, duration_type, billing_type, display_order, created_by)
SELECT p.workspace_id, p.id, 'Estándar', 'lifetime', 'one_time', 0, p.created_by
  FROM public.products p
 WHERE p.id IN (SELECT o.id FROM public.content_offers o)
   AND NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id);

-- ------------------------------------------------------------
-- 3. La version 1 de cada variante migrada que no tenga versiones
-- ------------------------------------------------------------

INSERT INTO public.product_versions
  (workspace_id, product_variant_id, version_number, price, currency, change_notes, status, published_at, published_by, created_by)
SELECT v.workspace_id,
       v.id,
       1,
       COALESCE(o.price_usd, 0),
       'USD',
       CASE WHEN o.price_usd IS NOT NULL THEN 'Migrado de Productos (content_offers)'
            ELSE 'Migrado sin precio: cargá el precio y publicá' END,
       CASE WHEN o.price_usd IS NOT NULL THEN 'active' ELSE 'draft' END,
       CASE WHEN o.price_usd IS NOT NULL THEN now() END,
       CASE WHEN o.price_usd IS NOT NULL THEN o.created_by END,
       o.created_by
  FROM public.product_variants v
  JOIN public.content_offers o ON o.id = v.product_id
 WHERE NOT EXISTS (SELECT 1 FROM public.product_versions x WHERE x.product_variant_id = v.id);

-- ------------------------------------------------------------
-- 4. El puente: lo que el codigo viejo cree o cambie en content_offers se copia
--    a products. Existe solo mientras conviva la tabla; el borrado diferido
--    (docs/pendientes/drop_content_offers.sql) lo borra.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.content_offers_bridge_to_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_variant uuid;
  v_version uuid;
  v_active_price numeric;
  v_next int;
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

  -- El precio: si cambio (o no habia version vigente), una version nueva publicada.
  SELECT v.price INTO v_active_price
    FROM public.product_versions v
   WHERE v.product_variant_id = v_variant AND v.status = 'active';

  IF NEW.price_usd IS NOT NULL AND (v_active_price IS NULL OR v_active_price <> NEW.price_usd) THEN
    SELECT COALESCE(MAX(v.version_number), 0) + 1 INTO v_next
      FROM public.product_versions v WHERE v.product_variant_id = v_variant;

    INSERT INTO public.product_versions
      (workspace_id, product_variant_id, version_number, price, change_notes, status, created_by)
    VALUES
      (NEW.workspace_id, v_variant, v_next, NEW.price_usd, 'Cambio desde la pantalla anterior de Productos', 'draft', NEW.created_by)
    RETURNING id INTO v_version;

    PERFORM public.publish_product_version(v_version, NEW.created_by);
  ELSIF NEW.price_usd IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_versions v WHERE v.product_variant_id = v_variant
  ) THEN
    INSERT INTO public.product_versions
      (workspace_id, product_variant_id, version_number, price, change_notes, status, created_by)
    VALUES
      (NEW.workspace_id, v_variant, 1, 0, 'Migrado sin precio: cargá el precio y publicá', 'draft', NEW.created_by);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.content_offers_bridge_to_products() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS content_offers_bridge ON public.content_offers;
CREATE TRIGGER content_offers_bridge
  AFTER INSERT OR UPDATE ON public.content_offers
  FOR EACH ROW EXECUTE FUNCTION public.content_offers_bridge_to_products();

-- ------------------------------------------------------------
-- 5. Las dos FK pasan a apuntar a products (mismos ids: nada se reescribe)
-- ------------------------------------------------------------

ALTER TABLE public.content_ideas DROP CONSTRAINT IF EXISTS content_ideas_offer_id_fkey;
ALTER TABLE public.content_ideas
  ADD CONSTRAINT content_ideas_offer_id_fkey
  FOREIGN KEY (offer_id) REFERENCES public.products(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.content_ideas VALIDATE CONSTRAINT content_ideas_offer_id_fkey;

ALTER TABLE public.content_posts DROP CONSTRAINT IF EXISTS content_posts_offer_id_fkey;
ALTER TABLE public.content_posts
  ADD CONSTRAINT content_posts_offer_id_fkey
  FOREIGN KEY (offer_id) REFERENCES public.products(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.content_posts VALIDATE CONSTRAINT content_posts_offer_id_fkey;

COMMENT ON TABLE public.content_offers IS
  'SIN USO desde la 00160: la reemplaza `products` (los productos conservan el id). Un puente (trigger content_offers_bridge) copia a products lo que el codigo viejo escriba aca. Se borra con el DROP diferido (docs/pendientes/drop_content_offers.sql).';

-- ------------------------------------------------------------
-- 6. Control: si alguna oferta quedo sin producto, TODO se deshace.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing
    FROM public.content_offers o
    LEFT JOIN public.products p ON p.id = o.id
   WHERE p.id IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION '00160: % oferta(s) de content_offers quedaron sin su producto; se deshace todo', v_missing;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.content_ideas i
     WHERE i.offer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = i.offer_id)
  ) OR EXISTS (
    SELECT 1 FROM public.content_posts c
     WHERE c.offer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = c.offer_id)
  ) THEN
    RAISE EXCEPTION '00160: hay ideas o piezas con un offer_id que no existe en products; se deshace todo';
  END IF;
END $$;
