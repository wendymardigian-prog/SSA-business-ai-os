-- ============================================================
-- MIGRACION 00032 — MARCAR LOS CONTACTOS SIN DATOS DE CONTACTO (F2)
-- ============================================================
-- La bandeja crea un contacto por cada persona que escribe, tambien cuando
-- Instagram no dice quien es. Hoy 99 de 171 son asi: se llaman "Instagram
-- User", no tienen usuario, ni telefono, ni email. Hacen falta —la
-- conversacion cuelga de ellos— pero ensucian la lista de contactos, que es
-- donde se trabaja la cartera.
--
-- La marca se calcula en la base y no en cada consulta, por tres motivos:
--
-- 1. El predicado es una conjuncion de negaciones sobre seis columnas. Escrito
--    a mano en PostgREST son seis ramas de un `or`, y la lista de contactos ya
--    usa un `or` para la busqueda por texto. Dos `or` conviviendo en la misma
--    consulta es una forma cara de equivocarse.
-- 2. Una columna GENERATED se recalcula en cada UPDATE de la fila, asi que
--    cuando el enriquecimiento de la 00031 completa un @usuario, el contacto
--    deja de ser anonimo solo. No hay nada que mantener sincronizado.
-- 3. Un indice parcial sobre una columna booleana lo usa el planner sin
--    pensarlo; sobre seis ramas OR, es una apuesta.
--
-- Sobre "anonimo": es sobre la IDENTIDAD, no sobre el trabajo hecho. Un
-- contacto sin nombre pero con tags, notas y vendedor asignado sigue siendo
-- anonimo, porque sigue sin saberse quien es. Es lo correcto para el filtro:
-- lo que estorba en la lista es no poder reconocer a la persona.
--
-- Lo que hay que saber para el dia que esto cambie: la expresion de una
-- columna generada no se puede editar con ALTER (antes de PG17). Cambiarla es
-- DROP INDEX, DROP COLUMN, ADD COLUMN, CREATE INDEX. Por eso los placeholders
-- van escritos inline y no adentro de una funcion: si estuvieran en una
-- funcion, un CREATE OR REPLACE de esa funcion NO recalcularia los valores ya
-- guardados y la columna empezaria a mentir en silencio.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS is_anonymous boolean
  GENERATED ALWAYS AS (
    lower(btrim(coalesce(display_name, ''))) IN (
      '', 'instagram user', 'facebook user', 'whatsapp user', 'unknown commenter'
    )
    AND email IS NULL
    AND secondary_email IS NULL
    AND phone IS NULL
    AND whatsapp_phone IS NULL
    AND instagram_username IS NULL
  ) STORED;

COMMENT ON COLUMN public.contacts.is_anonymous IS
  'true cuando no hay con que reconocer a la persona: sin nombre propio (o con un relleno de la plataforma) y sin ningun dato de contacto. Es sobre la identidad, no sobre el trabajo hecho: un contacto con tags y vendedor asignado sigue siendo anonimo. La calcula la base, asi que se apaga sola cuando el contacto se enriquece.';

-- El filtro por defecto de la lista de contactos: los vivos que no son anonimos.
CREATE INDEX IF NOT EXISTS idx_contacts_identified
  ON public.contacts(workspace_id, last_interaction_at DESC)
  WHERE deleted_at IS NULL AND NOT is_anonymous;
