-- ============================================================
-- MIGRACION 00035 — ARREGLAR LA RECURSION EN LOS VALORES DE CAMPOS CUSTOM
-- ============================================================
-- Guardar el valor de un campo personalizado fallaba con:
--
--   infinite recursion detected in policy for relation "contact_custom_fields"
--
-- La policy de SELECT que venia del fork consulta la propia tabla adentro de
-- su propia condicion:
--
--   exists (select 1 from contacts c
--           join contact_custom_fields ccf on ccf.contact_id = c.id
--           where c.id = contact_custom_fields.contact_id and ...)
--
-- Ese JOIN no aportaba nada —la condicion ya ata la fila por contact_id— pero
-- obliga a Postgres a evaluar la policy de contact_custom_fields para poder
-- evaluar la policy de contact_custom_fields.
--
-- Es un bug que estaba desde el fork y que nunca se habia podido alcanzar:
-- hasta este bloque no existia forma de definir un campo personalizado, asi
-- que jamas se leyo ni se escribio un valor. Aparecio apenas la pantalla nueva
-- hizo posible cargar el primero.
--
-- La version correcta delega en la visibilidad del contacto y nada mas. Una
-- subconsulta adentro de una POLICY si pasa por la RLS de la tabla que
-- consulta, asi que "existe el contacto" ya significa "este usuario puede ver
-- el contacto", con el scope de leads incluido. Es el mismo mecanismo que la
-- 00023 documenta para contact_notes.
-- ============================================================

DROP POLICY IF EXISTS "Users can view contact custom fields" ON public.contact_custom_fields;
DROP POLICY IF EXISTS "Users can manage contact custom fields" ON public.contact_custom_fields;
DROP POLICY IF EXISTS "contact_custom_fields_select" ON public.contact_custom_fields;
DROP POLICY IF EXISTS "contact_custom_fields_write" ON public.contact_custom_fields;

CREATE POLICY "contact_custom_fields_select" ON public.contact_custom_fields
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_custom_fields.contact_id)
  );

-- Escribir un valor es parte de trabajar el contacto, asi que lo puede hacer
-- cualquiera que lo vea. Definir QUE campos existen es otra cosa, y esa si es
-- de Owner/Admin (migracion 00034).
CREATE POLICY "contact_custom_fields_write" ON public.contact_custom_fields
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_custom_fields.contact_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_custom_fields.contact_id)
  );
