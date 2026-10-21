-- ============================================================
-- 00246_contact_interest_product
-- ============================================================
-- El producto que le interesa a un contacto, con su variante opcional.
--
--   contacts.interest_product_id  -> products(id)
--   contacts.interest_variant_id  -> product_variants(id)  (opcional)
--
-- Los productos y las variantes no se borran (se archivan), y el FK lo
-- respalda: un producto que un contacto tiene de interes no se puede borrar
-- (NO ACTION, el default). Es NO ACTION y no RESTRICT a proposito: se revisa al
-- final de la sentencia, asi borrar un workspace entero (que se lleva por
-- cascade sus contactos Y sus productos) no choca en el medio. El cambio lo escribe la app con el cliente
-- de quien edita (RLS de contactos, `contacts.edit`); el trigger de abajo
-- valida la forma venga de donde venga:
--   - la variante tiene que ser DE ESE producto;
--   - producto y variante tienen que ser del mismo workspace que el contacto;
--   - una variante sin producto no tiene sentido.
-- Un producto archivado se puede CONSERVAR (el contacto ya lo tenia), pero la
-- app no lo ofrece para elegir.
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS contacts_interest_check ON public.contacts;
--   DROP FUNCTION IF EXISTS private.contacts_interest_check();
--   ALTER TABLE public.contacts DROP COLUMN IF EXISTS interest_variant_id,
--                               DROP COLUMN IF EXISTS interest_product_id;
--
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE y DROP TRIGGER IF EXISTS.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS interest_product_id uuid REFERENCES public.products(id);
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS interest_variant_id uuid REFERENCES public.product_variants(id);

CREATE INDEX IF NOT EXISTS idx_contacts_interest_product
  ON public.contacts (workspace_id, interest_product_id)
  WHERE deleted_at IS NULL AND interest_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_interest_variant
  ON public.contacts (interest_variant_id)
  WHERE interest_variant_id IS NOT NULL;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.contacts_interest_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product_ws uuid;
  v_variant_product uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.interest_product_id IS NOT DISTINCT FROM OLD.interest_product_id
     AND NEW.interest_variant_id IS NOT DISTINCT FROM OLD.interest_variant_id THEN
    RETURN NEW;
  END IF;

  IF NEW.interest_variant_id IS NOT NULL AND NEW.interest_product_id IS NULL THEN
    RAISE EXCEPTION 'Una variante de interes necesita su producto' USING ERRCODE = 'CI001';
  END IF;

  IF NEW.interest_product_id IS NOT NULL THEN
    SELECT workspace_id INTO v_product_ws FROM public.products WHERE id = NEW.interest_product_id;
    IF v_product_ws IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'El producto de interes no es de este workspace' USING ERRCODE = 'CI002';
    END IF;
  END IF;

  IF NEW.interest_variant_id IS NOT NULL THEN
    SELECT product_id INTO v_variant_product FROM public.product_variants WHERE id = NEW.interest_variant_id;
    IF v_variant_product IS DISTINCT FROM NEW.interest_product_id THEN
      RAISE EXCEPTION 'La variante de interes no es de ese producto' USING ERRCODE = 'CI003';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.contacts_interest_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contacts_interest_check ON public.contacts;
CREATE TRIGGER contacts_interest_check
  BEFORE INSERT OR UPDATE OF interest_product_id, interest_variant_id ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION private.contacts_interest_check();
