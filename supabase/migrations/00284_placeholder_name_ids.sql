-- ============================================================
-- MIGRACION 00284 — UN ID O UN @USUARIO COMO NOMBRE ES UN RELLENO
-- ============================================================
-- Cuando Instagram no le da a Zernio el perfil de una persona (alguien que
-- todavia no interactuo, una conversacion que empezo el negocio o ManyChat),
-- los receptores guardaban como nombre el id de la plataforma:
-- "1860383452043344". En produccion eran 325 de 1505 conversaciones.
--
-- El nombre real deberia reemplazarlo cuando la persona escribe:
-- find_or_link_contact (00202) pisa el nombre guardado si es un relleno. Pero
-- `is_placeholder_name` solo reconocia "Instagram User" y compania, asi que un
-- numero quedaba para siempre.
--
-- Cambios:
--   1. `is_placeholder_name` reconoce tambien un nombre que es solo digitos
--      (8 o mas, con "+" opcional: un id o un telefono) y uno que es un solo
--      "@usuario" (el respaldo nuevo de los receptores). Gemela:
--      `isPlaceholderName` en lib/contacts/anonymous.ts; el test de ese archivo
--      compara las dos expresiones.
--   2. Backfill: los contactos de Instagram cuyo nombre es su propio id y que
--      ya tienen el @usuario pasan a llamarse "@usuario".
--
-- NO cambia:
--   - find_or_link_contact (su huella sigue igual: llama a esta funcion).
--   - La columna generada `contacts.is_anonymous` (00032): tiene la lista
--     escrita inline a proposito y no usa esta funcion. Un contacto con un id
--     como nombre sigue sin contar como anonimo, igual que antes.
--
-- Definicion anterior (00031), para volver atras:
--
-- CREATE OR REPLACE FUNCTION public.is_placeholder_name(p_name text)
-- RETURNS boolean
-- LANGUAGE sql
-- IMMUTABLE
-- SET search_path = ''
-- AS $$
--   SELECT lower(btrim(coalesce(p_name, ''))) IN (
--     '', 'instagram user', 'facebook user', 'whatsapp user', 'unknown commenter'
--   );
-- $$;
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_placeholder_name(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT lower(btrim(coalesce(p_name, ''))) IN (
    '', 'instagram user', 'facebook user', 'whatsapp user', 'unknown commenter'
  )
  OR btrim(coalesce(p_name, '')) ~ '^\+?[0-9]{8,}$'
  OR btrim(coalesce(p_name, '')) ~ '^@[A-Za-z0-9._]+$';
$$;

REVOKE ALL ON FUNCTION public.is_placeholder_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_placeholder_name(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_placeholder_name(text) IS
  'true si el nombre es un relleno y no algo que escribio una persona: vacio, lo que manda la plataforma cuando no tiene el perfil ("Instagram User" y compania), un id o telefono (solo digitos) o un solo @usuario. Espejo de isPlaceholderName en lib/contacts/anonymous.ts.';

-- ------------------------------------------------------------
-- Backfill: el id como nombre pasa a "@usuario" cuando el usuario ya esta.
-- ------------------------------------------------------------
-- Solo cuando el nombre es EXACTAMENTE el id con el que ese contacto esta
-- vinculado a un canal de Instagram: asi nunca se toca un nombre que alguien
-- escribio. Idempotente: despues de correr, el nombre ya no es el id.
UPDATE public.contacts c
SET display_name = '@' || btrim(c.instagram_username)
WHERE c.instagram_username IS NOT NULL
  AND btrim(c.instagram_username) ~ '^[A-Za-z0-9._]+$'
  AND EXISTS (
    SELECT 1
    FROM public.contact_channels cc
    JOIN public.channels ch ON ch.id = cc.channel_id
    WHERE cc.contact_id = c.id
      AND ch.platform = 'instagram'
      AND cc.platform_sender_id = btrim(c.display_name)
  );
