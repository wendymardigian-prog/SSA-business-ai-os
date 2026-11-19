-- ============================================================================
-- 00406 — Formularios: categorías tipo etiqueta
-- ============================================================================
--
-- Decisión de producto (18/11/2026): los formularios se ordenan con categorías libres, como las automatizaciones (00254): se
-- escriben a mano o se eligen de las que ya usan los demás formularios, varias por formulario, y la lista se filtra
-- por ellas. No hay catálogo aparte: viven en la columna; renombrar o quitar una reescribe las filas que la tienen
-- (Server Actions con `forms.manage`, cliente de servicio, como el resto de las escrituras de `forms`).
--
--   forms.categories   text[] NOT NULL DEFAULT '{}' (hasta 10; la app normaliza: `lib/categories.ts`).
--
-- Aditiva e idempotente: aplicar ANTES del deploy (la lista pide la columna). Sin cambios de RLS.
-- ============================================================================

ALTER TABLE public.forms
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';

-- Hasta 10 categorías por formulario (la app normaliza y recorta; esto es la red).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'forms_categories_max'
  ) THEN
    ALTER TABLE public.forms
      ADD CONSTRAINT forms_categories_max CHECK (cardinality(categories) <= 10);
  END IF;
END $$;

-- El filtro de la lista: "formularios con esta categoría" (`categories @> array[...]`).
CREATE INDEX IF NOT EXISTS idx_forms_categories
  ON public.forms USING gin (categories);

COMMENT ON COLUMN public.forms.categories IS
  'Categorías libres del formulario (como etiquetas), hasta 10. Las normaliza lib/categories.ts.';
