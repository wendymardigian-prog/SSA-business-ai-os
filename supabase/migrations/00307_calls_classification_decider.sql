-- 00307_calls_classification_decider (6/11/2026)
--
-- Etapa 5 de Grabaciones, primera parte: de `call_type_*` solo seguian en uso "que regla decidio"
-- y "con cuanta seguridad decidio la IA". Pasan a columnas propias, asi la 00308 puede borrar toda
-- esa familia sin perder lo que la pantalla muestra.
--
--   `classification_rule`: el nombre de la regla que decidio, o la que marco el no show. Cuando
--   decidieron la reunion o el area de la conexion queda vacia: eso ya lo dice `classification_source`.
--   `classification_confidence`: la seguridad de la IA, de 0 a 1.
--
-- Tambien deja `classification_source = 'human'` en lo que una persona eligio y hasta ahora solo
-- decia `call_type_source`: esa marca es la que impide pisar lo elegido a mano.
--
-- Aditiva: va ANTES de desplegar el codigo, que escribe y lee estas columnas.
--
-- Para volver atras:
--   ALTER TABLE public.calls DROP COLUMN IF EXISTS classification_rule, DROP COLUMN IF EXISTS classification_confidence;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS classification_rule text,
  ADD COLUMN IF NOT EXISTS classification_confidence numeric(3, 2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_classification_confidence_check') THEN
    ALTER TABLE public.calls
      ADD CONSTRAINT calls_classification_confidence_check
      CHECK (classification_confidence IS NULL OR (classification_confidence >= 0 AND classification_confidence <= 1));
  END IF;
END $$;

COMMENT ON COLUMN public.calls.classification_rule IS
  'La regla que decidio el area y el tipo, o la que marco el no show.';
COMMENT ON COLUMN public.calls.classification_confidence IS
  'La seguridad de la IA al clasificar, de 0 a 1. Vacia si no decidio la IA.';

UPDATE public.calls
   SET classification_source = 'human'
 WHERE call_type_source = 'human'
   AND classification_source IS DISTINCT FROM 'human';

UPDATE public.calls
   SET classification_rule = CASE WHEN classification_source IN ('booking', 'connection', 'human') THEN NULL ELSE call_type_rule END,
       classification_confidence = call_type_confidence
 WHERE classification_rule IS NULL
   AND classification_confidence IS NULL
   AND (call_type_rule IS NOT NULL OR call_type_confidence IS NOT NULL);
