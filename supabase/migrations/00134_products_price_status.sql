-- ============================================================
-- 00134_products_price_status.sql
--
-- Las "ofertas" de contenido pasan a ser PRODUCTOS: cada uno con precio y
-- estado (activo, inactivo o discontinuado).
--
-- Se suma a `content_offers` y NO se renombra la tabla: renombrarla obligaria
-- a tocar `offer_id` en ideas y piezas, la funcion approve_content_idea_v2, los
-- indices y las policies de un saque, por un cambio de nombre que el usuario ve
-- en la pantalla y no en la base. En el codigo y en la documentacion
-- `content_offers` ES el catalogo de productos; el renombre de la tabla queda
-- para cuando se construya Ventas (Etapa 5), que es quien la va a usar.
--
-- Aditiva e idempotente. Hoy la tabla esta vacia en produccion: no hay nada
-- que migrar, pero el backfill de abajo cubre un clon con datos.
--
-- Precio: siempre en USD. Puede ser NULL en la base (filas anteriores a esta
-- migracion), pero la accion y el formulario lo exigen para los nuevos.
--
-- Estado y archivado van juntos: un producto "inactivo" o "discontinuado" es
-- uno que ya no se ofrece al clasificar, que es justo lo que ya significaba
-- `archived_at` (sale del selector, libera el nombre, se sigue mostrando en lo
-- ya clasificado). El CHECK lo hace cumplir: no puede haber un producto activo
-- archivado ni uno inactivo sin archivar.
-- ============================================================

ALTER TABLE public.content_offers
  ADD COLUMN IF NOT EXISTS price_usd numeric(12,2),
  ADD COLUMN IF NOT EXISTS status    text NOT NULL DEFAULT 'active';

-- Backfill ANTES del CHECK de coherencia: lo que ya estaba archivado queda discontinuado.
UPDATE public.content_offers
   SET status = 'discontinued'
 WHERE archived_at IS NOT NULL
   AND status = 'active';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_offers_price_check') THEN
    ALTER TABLE public.content_offers ADD CONSTRAINT content_offers_price_check
      CHECK (price_usd IS NULL OR price_usd >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_offers_status_check') THEN
    ALTER TABLE public.content_offers ADD CONSTRAINT content_offers_status_check
      CHECK (status IN ('active', 'inactive', 'discontinued'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_offers_status_archived_check') THEN
    ALTER TABLE public.content_offers ADD CONSTRAINT content_offers_status_archived_check
      CHECK ((status = 'active') = (archived_at IS NULL));
  END IF;
END $$;

COMMENT ON TABLE public.content_offers IS
  'Catalogo de PRODUCTOS (lo que se vende) a los que apunta una idea o una pieza. Se llamaba "ofertas". Un producto no se borra: se pone inactivo o discontinuado.';
COMMENT ON COLUMN public.content_offers.price_usd IS
  'Precio del producto, siempre en USD. NULL solo en filas anteriores a la 00134.';
COMMENT ON COLUMN public.content_offers.status IS
  'active = se ofrece al clasificar; inactive = pausado; discontinued = dejo de venderse. Distinto de active <=> archived_at no es NULL (CHECK).';
