-- ============================================================
-- 00344_whatsapp_communities
-- ============================================================
-- Comunidades de WhatsApp (noviembre 2026).
--
-- Una comunidad de WhatsApp es una "comunidad madre" (no tiene mensajes: solo
-- agrupa), un grupo de Avisos (con el MISMO nombre que la comunidad y todos
-- sus miembros; solo escriben los admins) y los demas grupos de la comunidad.
-- Hasta aca la lista de grupos de un numero era plana: el grupo de Avisos se
-- veia como si fuera la comunidad y los demas grupos quedaban mezclados, sin
-- decir de que comunidad eran.
--
-- La comunidad madre NO se guarda: no tiene mensajes y no se puede activar.
-- Cada grupo guardado lleva el JID de su comunidad y el nombre de la comunidad
-- (una copia, para mostrar "Comunidad > grupo" sin preguntarle a WhatsApp).
-- Lo refrescan la lista de Grupos de la tarjeta del numero y los avisos
-- GROUPS_UPSERT / GROUP_UPDATE de Evolution.
--
--   kind              'group' (un grupo) | 'announce' (el de Avisos de una comunidad)
--   parent_group_jid  el JID de la comunidad, o null si es un grupo suelto
--   community_subject el nombre de la comunidad (copia)
--   description       la descripcion del grupo
--   restrict          true = solo los admins editan el nombre, la foto y la descripcion
--   number_is_admin   si el numero es admin del grupo; null = no se sabe
--
-- Solo suma columnas: los permisos (RLS y GRANT de la 00280) no cambian, y
-- escribe solo el servidor, como siempre.
--
-- Aditiva: se aplica ANTES de desplegar el codigo que la usa (la bandeja y la
-- lista de grupos leen estas columnas).
--
-- Como volver atras:
--   DROP INDEX IF EXISTS public.idx_whatsapp_groups_parent;
--   ALTER TABLE public.whatsapp_groups
--     DROP COLUMN IF EXISTS kind, DROP COLUMN IF EXISTS parent_group_jid,
--     DROP COLUMN IF EXISTS community_subject, DROP COLUMN IF EXISTS description,
--     DROP COLUMN IF EXISTS restrict, DROP COLUMN IF EXISTS number_is_admin;
--
-- Idempotente.
-- ============================================================

ALTER TABLE public.whatsapp_groups
  ADD COLUMN IF NOT EXISTS kind              text NOT NULL DEFAULT 'group',
  ADD COLUMN IF NOT EXISTS parent_group_jid  text,
  ADD COLUMN IF NOT EXISTS community_subject text,
  ADD COLUMN IF NOT EXISTS description       text,
  ADD COLUMN IF NOT EXISTS restrict          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS number_is_admin   boolean;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_groups_kind_check') THEN
    ALTER TABLE public.whatsapp_groups ADD CONSTRAINT whatsapp_groups_kind_check
      CHECK (kind IN ('group', 'announce'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_groups_parent_jid_check') THEN
    ALTER TABLE public.whatsapp_groups ADD CONSTRAINT whatsapp_groups_parent_jid_check
      CHECK (parent_group_jid IS NULL OR parent_group_jid ~ '^[0-9]{6,}(-[0-9]+)?@g\.us$');
  END IF;
  -- El de Avisos siempre es de una comunidad.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_groups_announce_parent_check') THEN
    ALTER TABLE public.whatsapp_groups ADD CONSTRAINT whatsapp_groups_announce_parent_check
      CHECK (kind <> 'announce' OR parent_group_jid IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_groups_description_check') THEN
    ALTER TABLE public.whatsapp_groups ADD CONSTRAINT whatsapp_groups_description_check
      CHECK (description IS NULL OR char_length(description) <= 4000);
  END IF;
END $$;

COMMENT ON COLUMN public.whatsapp_groups.kind IS
  'group = un grupo; announce = el grupo de Avisos de una comunidad (00344).';
COMMENT ON COLUMN public.whatsapp_groups.parent_group_jid IS
  'El JID de la comunidad de WhatsApp a la que pertenece el grupo, o null si es un grupo suelto (00344).';
COMMENT ON COLUMN public.whatsapp_groups.community_subject IS
  'Copia del nombre de la comunidad, para mostrar "Comunidad > grupo" (00344).';
COMMENT ON COLUMN public.whatsapp_groups.number_is_admin IS
  'Si el numero es admin del grupo; null = no se sabe (00344).';

-- El filtro de la bandeja por comunidad.
CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_parent
  ON public.whatsapp_groups (workspace_id, parent_group_jid)
  WHERE parent_group_jid IS NOT NULL;
