-- ============================================================
-- 00264_product_types_drop_guarantee
--
-- BORRA. Se aplica DESPUES de desplegar el codigo que ya no ofrece 'otro' ni
-- lee ni escribe la garantia (y despues de la 00263).
--
-- 1. Los productos de tipo 'otro' pasan a 'producto' (el historial del
--    catalogo lo anota, con actor `system`), el CHECK deja de admitir 'otro'
--    y el valor por defecto pasa a 'producto'.
-- 2. Se borra la garantia de las variantes: el CHECK
--    `product_variants_guarantee_check` y las columnas
--    `guarantee_duration_type` / `guarantee_duration_value`. Aborta si alguna
--    variante tuviera una garantia cargada (el 24/10/2026 no habia ninguna).
--    Las ventas viejas conservan las claves de garantia dentro de su
--    `product_snapshot` (jsonb): no se tocan.
--
-- Consultas de seguridad (tienen que dar 0 antes de aplicar):
--   select count(*) from public.product_variants
--    where guarantee_duration_type is not null or guarantee_duration_value is not null;
--
-- Para volver atras (definiciones de la 00159):
--   ALTER TABLE public.products ALTER COLUMN product_type SET DEFAULT 'otro';
--   ALTER TABLE public.product_variants ADD COLUMN guarantee_duration_type text;
--   ALTER TABLE public.product_variants ADD COLUMN guarantee_duration_value int;
--   ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_guarantee_check
--     CHECK (
--       (guarantee_duration_type IS NULL AND guarantee_duration_value IS NULL)
--       OR (guarantee_duration_type IS NOT NULL AND guarantee_duration_type IN ('days', 'weeks', 'months')
--           AND guarantee_duration_value IS NOT NULL AND guarantee_duration_value > 0)
--     );
--   (y el CHECK de tipos de la 00263, con 'otro')
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'product_variants' AND column_name = 'guarantee_duration_type'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.product_variants
       WHERE guarantee_duration_type IS NOT NULL OR guarantee_duration_value IS NOT NULL
    ) THEN
      RAISE EXCEPTION '00264: hay variantes con garantia cargada; respaldarlas antes de borrar las columnas';
    END IF;
  END IF;
END $$;

UPDATE public.products SET product_type = 'producto' WHERE product_type = 'otro';

ALTER TABLE public.products ALTER COLUMN product_type SET DEFAULT 'producto';
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_type_check;
ALTER TABLE public.products ADD CONSTRAINT products_type_check
  CHECK (product_type IN ('programa', 'mentoria', 'curso', 'evento', 'servicio', 'producto'));

ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_guarantee_check;
ALTER TABLE public.product_variants DROP COLUMN IF EXISTS guarantee_duration_type;
ALTER TABLE public.product_variants DROP COLUMN IF EXISTS guarantee_duration_value;
