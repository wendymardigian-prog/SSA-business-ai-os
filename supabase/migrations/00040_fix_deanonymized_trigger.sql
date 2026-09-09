-- ============================================================
-- MIGRACION 00040 — ARREGLO: EL AVISO DE "CONTACTO IDENTIFICADO" NO DISPARABA
-- ============================================================
-- La migracion 00039 dejo un trigger sobre `AFTER UPDATE OF is_anonymous` para
-- avisar cuando un contacto que habia entrado sin datos (por ejemplo, un DM de
-- alguien cuyo perfil Instagram no expone) se completa y pasa a ser un lead de
-- verdad.
--
-- Ese trigger nunca se iba a disparar. `is_anonymous` es una columna GENERATED
-- ALWAYS (migracion 00032): la calcula la base a partir del nombre, el mail, el
-- telefono y el usuario de Instagram. Postgres dispara `UPDATE OF <columna>`
-- cuando esa columna aparece en el SET del UPDATE, y una columna generada nunca
-- puede aparecer ahi. El trigger se creaba sin error y no hacia nada.
--
-- Se escucha, entonces, a las columnas que la alimentan. La condicion sigue
-- siendo la misma —era anonimo y dejo de serlo— y esa se evalua igual sobre
-- OLD/NEW, donde el valor generado si esta disponible.
-- ============================================================

DROP TRIGGER IF EXISTS contacts_automation_deanonymized ON public.contacts;

CREATE TRIGGER contacts_automation_deanonymized
  AFTER UPDATE OF display_name, email, secondary_email, phone, whatsapp_phone, instagram_username
  ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_deanonymized();

COMMENT ON FUNCTION public.contacts_emit_deanonymized() IS
  'Emite contact_created cuando un contacto anonimo se completa. Escucha las columnas que alimentan is_anonymous, porque una columna generada nunca aparece en el SET de un UPDATE y un trigger UPDATE OF sobre ella no dispara nunca.';
