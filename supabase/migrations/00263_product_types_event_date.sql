-- ============================================================
-- 00263_product_types_event_date
--
-- Tipos de producto nuevos y la fecha fija de un evento.
--
-- 1. `products.product_type` admite 'evento' y 'producto'. Por ahora sigue
--    admitiendo 'otro': la 00264 pasa los 'otro' a 'producto' y lo saca,
--    DESPUES de desplegar el codigo que ya no lo ofrece.
-- 2. `product_variants.event_date` (date): la fecha fija de cada variante de
--    un evento. Los demas tipos no tienen fecha: la duracion empieza el dia
--    que compra cada cliente (`sales.service_starts_at`). Que un evento la
--    tenga lo exige el servidor (`parseVariantInput`), no la base: el tipo
--    vive en otra tabla y un producto puede cambiar de tipo despues.
--
-- Aditiva e idempotente: se aplica ANTES de desplegar (el codigo nuevo lee y
-- escribe `event_date`). El historial del catalogo (trigger `catalog_audit`,
-- 00170) registra la columna nueva solo, sin tocarlo.
--
-- La definicion vieja del CHECK (00159), para volver atras:
--   CHECK (product_type IN ('programa', 'mentoria', 'curso', 'servicio', 'otro'))
-- ============================================================

ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS event_date date;

COMMENT ON COLUMN public.product_variants.event_date IS
  'La fecha fija de un evento (00263). Null en los demas tipos: su duracion empieza el dia que compra cada cliente.';

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_type_check;
ALTER TABLE public.products ADD CONSTRAINT products_type_check
  CHECK (product_type IN ('programa', 'mentoria', 'curso', 'evento', 'servicio', 'producto', 'otro'));
