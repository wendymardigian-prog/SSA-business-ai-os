-- 00163_sales_form_fks.sql
-- Ventas, Bloque 3 (F26b): `form_submissions.sale_id` y `contract_signatures.sale_id` pasan de
-- "uuid suelto" (lo dejaron así las 00150 y 00157, a la espera de Ventas) a una clave foránea a
-- `sales`.
--
--   form_submissions.sale_id    ON DELETE SET NULL: una respuesta de formulario sobrevive aunque
--                               la venta desaparezca (nada borra ventas hoy, pero la regla es esa).
--   contract_signatures.sale_id sin acción (NO ACTION): la firma es evidencia legal y un trigger
--                               (`contract_signatures_protect`) impide cambiarla, así que una
--                               venta con firmas NO se puede borrar. Al borrar un workspace, la
--                               cascada se lleva las firmas en la misma sentencia y no estorba.
--
-- Más un índice parcial por cada una, para listar las firmas y respuestas de una venta.
--
-- ABORTA si hay filas con un `sale_id` que no existe en `sales` (hoy: 0). Idempotente.
--
-- Vuelta atrás:
--   ALTER TABLE public.form_submissions    DROP CONSTRAINT IF EXISTS form_submissions_sale_id_fkey;
--   ALTER TABLE public.contract_signatures DROP CONSTRAINT IF EXISTS contract_signatures_sale_id_fkey;
--   DROP INDEX IF EXISTS public.form_submissions_sale_idx;
--   DROP INDEX IF EXISTS public.contract_signatures_sale_idx;

DO $$
DECLARE
  v_fs integer;
  v_cs integer;
BEGIN
  SELECT count(*) INTO v_fs FROM public.form_submissions f
   WHERE f.sale_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.id = f.sale_id);
  SELECT count(*) INTO v_cs FROM public.contract_signatures c
   WHERE c.sale_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.id = c.sale_id);
  IF v_fs > 0 OR v_cs > 0 THEN
    RAISE EXCEPTION '00163: hay % respuestas y % firmas con un sale_id que no existe en sales; revisarlas antes de agregar la clave', v_fs, v_cs;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_submissions_sale_id_fkey') THEN
    ALTER TABLE public.form_submissions
      ADD CONSTRAINT form_submissions_sale_id_fkey
      FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_signatures_sale_id_fkey') THEN
    ALTER TABLE public.contract_signatures
      ADD CONSTRAINT contract_signatures_sale_id_fkey
      FOREIGN KEY (sale_id) REFERENCES public.sales(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS form_submissions_sale_idx
  ON public.form_submissions (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contract_signatures_sale_idx
  ON public.contract_signatures (sale_id) WHERE sale_id IS NOT NULL;
