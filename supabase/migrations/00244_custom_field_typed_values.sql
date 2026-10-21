-- ============================================================
-- 00244_custom_field_typed_values
-- ============================================================
-- Los valores de los campos personalizados se guardan como texto
-- (`contact_custom_fields.value`). Comparar "mas de 3 viajeros" sobre texto
-- es alfabetico: "10" < "9". Esta migracion suma dos columnas derivadas que
-- llena un trigger:
--
--   value_number numeric  -- el valor como numero, si el campo es `number`
--   value_date   date     -- el valor como fecha,  si el campo es `date`
--
-- La conversion NUNCA lanza: lo que no se puede convertir queda en NULL. Un
-- valor viejo cargado a mano ("3 personas") no rompe un insert ni un update.
-- La app normaliza los valores nuevos antes de guardarlos
-- (`normalizeCustomValue`, lib/custom-fields.ts): numero con punto decimal,
-- fecha AAAA-MM-DD. La conversion de aca acepta ademas la coma decimal y
-- DD/MM/AAAA, por los valores que ya estaban.
--
-- El backfill escribe solo las columnas nuevas: `value` no cambia, asi que
-- el trigger `contact_custom_fields_automation` (00039) no emite ningun
-- `field_changed` (compara OLD.value con NEW.value).
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS contact_custom_fields_typed ON public.contact_custom_fields;
--   DROP FUNCTION IF EXISTS private.contact_custom_fields_typed();
--   DROP FUNCTION IF EXISTS private.custom_value_number(text);
--   DROP FUNCTION IF EXISTS private.custom_value_date(text);
--   ALTER TABLE public.contact_custom_fields DROP COLUMN IF EXISTS value_number,
--                                            DROP COLUMN IF EXISTS value_date;
--
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE y DROP TRIGGER IF EXISTS.
-- ============================================================

ALTER TABLE public.contact_custom_fields ADD COLUMN IF NOT EXISTS value_number numeric;
ALTER TABLE public.contact_custom_fields ADD COLUMN IF NOT EXISTS value_date date;

CREATE SCHEMA IF NOT EXISTS private;

-- "3", "3.5", "3,5", "-2". Con los dos separadores, el ultimo es el decimal.
CREATE OR REPLACE FUNCTION private.custom_value_number(p_raw text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v text := regexp_replace(coalesce(p_raw, ''), '\s', '', 'g');
  v_comma int;
  v_dot int;
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;
  v_comma := length(v) - position(',' IN reverse(v)) + 1;
  v_dot   := length(v) - position('.' IN reverse(v)) + 1;
  IF position(',' IN v) > 0 AND position('.' IN v) > 0 THEN
    IF v_comma > v_dot THEN
      v := replace(replace(v, '.', ''), ',', '.');
    ELSE
      v := replace(v, ',', '');
    END IF;
  ELSIF position(',' IN v) > 0 THEN
    v := replace(v, ',', '.');
  END IF;
  IF v !~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)$' THEN
    RETURN NULL;
  END IF;
  RETURN v::numeric;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- "AAAA-MM-DD" (tambien al principio de una fecha con hora) o "DD/MM/AAAA".
CREATE OR REPLACE FUNCTION private.custom_value_date(p_raw text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v text := btrim(coalesce(p_raw, ''));
  m text[];
BEGIN
  m := regexp_match(v, '^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})($|[T ])');
  IF m IS NOT NULL THEN
    RETURN make_date(m[1]::int, m[2]::int, m[3]::int);
  END IF;
  m := regexp_match(v, '^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})$');
  IF m IS NOT NULL THEN
    RETURN make_date(m[3]::int, m[2]::int, m[1]::int);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- make_date con un dia que no existe (31/02) lanza: queda NULL.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.custom_value_number(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.custom_value_date(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.contact_custom_fields_typed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_type text;
BEGIN
  SELECT type INTO v_type FROM public.custom_field_definitions WHERE id = NEW.field_id;
  NEW.value_number := CASE WHEN v_type = 'number' THEN private.custom_value_number(NEW.value) END;
  NEW.value_date   := CASE WHEN v_type = 'date'   THEN private.custom_value_date(NEW.value)   END;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca tumba el guardado de un valor.
  RAISE WARNING 'contact_custom_fields_typed: %', SQLERRM;
  NEW.value_number := NULL;
  NEW.value_date := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.contact_custom_fields_typed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contact_custom_fields_typed ON public.contact_custom_fields;
CREATE TRIGGER contact_custom_fields_typed
  BEFORE INSERT OR UPDATE OF value, field_id ON public.contact_custom_fields
  FOR EACH ROW EXECUTE FUNCTION private.contact_custom_fields_typed();

-- Backfill: solo las columnas nuevas (no cambia `value`, no emite eventos).
UPDATE public.contact_custom_fields cf
   SET value_number = CASE WHEN d.type = 'number' THEN private.custom_value_number(cf.value) END,
       value_date   = CASE WHEN d.type = 'date'   THEN private.custom_value_date(cf.value)   END
  FROM public.custom_field_definitions d
 WHERE d.id = cf.field_id
   AND d.type IN ('number', 'date');

CREATE INDEX IF NOT EXISTS idx_contact_custom_fields_number
  ON public.contact_custom_fields (field_id, value_number)
  WHERE value_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_custom_fields_date
  ON public.contact_custom_fields (field_id, value_date)
  WHERE value_date IS NOT NULL;
