-- ============================================================================
-- 00178 — Formularios: el tipo `eod` (reporte de fin de dia) y su configuracion
-- ============================================================================
-- Suma 'eod' al CHECK de `forms.type` y la columna `forms.eod_config jsonb` (la valida
-- `lib/eod/config.ts`), obligatoria cuando el tipo es 'eod' (mismo patron que
-- `forms_survey_config_required` y `forms_contract_config_required` de la 00150).
-- SOLO SUMA: la lista vieja se leyo de la base viva al escribir esta migracion (12/10/2026).
-- `lib/eod/migrations.test.ts` lee ESTE archivo y exige los tres tipos viejos + 'eod'.
--
-- Definicion VIEJA del CHECK, para volver atras:
--   forms_type_check: CHECK ((type = ANY (ARRAY['custom'::text, 'survey'::text, 'contract'::text])))
--
-- Como volver atras:
--   (antes) DELETE FROM public.forms WHERE type = 'eod';   -- o archivarlos y cambiarles el tipo
--   ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_eod_config_required;
--   ALTER TABLE public.forms DROP COLUMN IF EXISTS eod_config;
--   ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_type_check;
--   ALTER TABLE public.forms ADD CONSTRAINT forms_type_check
--     CHECK (type = ANY (ARRAY['custom'::text, 'survey'::text, 'contract'::text]));
-- Riesgo: bajo (aditiva; ninguna fila existente cambia).
-- ============================================================================

SET search_path = '';

ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_type_check;
ALTER TABLE public.forms ADD CONSTRAINT forms_type_check
  CHECK (type = ANY (ARRAY[
    'custom'::text,
    'survey'::text,
    'contract'::text,
    'eod'::text
  ]));

ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS eod_config jsonb;

COMMENT ON COLUMN public.forms.eod_config IS
  'Solo un reporte de fin de dia (type = eod): variante, rol, audiencia, modo de reporte, dias hacia atras, avisos y recordatorio. La valida lib/eod/config.ts; la variante no cambia despues de crear.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.forms'::regclass AND conname = 'forms_eod_config_required'
  ) THEN
    ALTER TABLE public.forms ADD CONSTRAINT forms_eod_config_required
      CHECK ((type <> 'eod'::text) OR (eod_config IS NOT NULL));
  END IF;
END $$;
