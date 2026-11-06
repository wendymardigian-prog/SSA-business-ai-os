-- ============================================================
-- MIGRACION 00298 — UN NUMERO COMO NOMBRE OCULTA SOLO A QUIEN NUNCA ESCRIBIO
-- ============================================================
-- La 00296 oculto a todo contacto con un id como nombre y sin datos. Eso incluyo
-- a personas del historial de WhatsApp que SI escribieron: WhatsApp solo da su id
-- (@lid), nunca lo va a completar solo, y pueden tener etiquetas y trabajo hecho.
-- Lo que se queria ocultar es a quien todavia no escribio: el seguidor al que le
-- mando un mensaje ManyChat.
--
-- Cambios:
--   1. `contacts.first_inbound_at`: cuando escribio la persona por primera vez,
--      por cualquier canal. Una columna generada no puede mirar otra tabla.
--   2. `is_anonymous`: un id como nombre cuenta solo sin `first_inbound_at`. Los
--      rellenos de la plataforma ("Instagram User") siguen como siempre.
--   3. `contacts_automation_deanonymized` escucha tambien la columna nueva: quien
--      escribe sin perfil pasa a ser visible y dispara `contact_created` una vez.
--   4. El trigger de `messages` escribe tambien en el contacto, y uno nuevo de
--      `conversations` cubre una conversacion que cambia de contacto (la fusion).
--
-- El backfill va ANTES de redefinir el trigger: esas personas ya estan en el
-- sistema y volver a mostrarlas no es "contacto creado". Ninguna fila cambia su
-- `updated_at`. NO cambia ninguna funcion protegida ni `merge_contacts`.
--
-- Va ANTES de desplegar el codigo. El codigo de antes no lee la columna nueva.
--
-- Para volver atras, la definicion de `is_anonymous` y su indice estan en la
-- 00296; ademas:
--   DROP TRIGGER IF EXISTS conversations_zz_contact_wrote ON public.conversations;
--   DROP FUNCTION IF EXISTS public.conversations_carry_contact_wrote();
--   DROP TRIGGER IF EXISTS contacts_automation_deanonymized ON public.contacts;
--   CREATE TRIGGER contacts_automation_deanonymized
--     AFTER UPDATE OF display_name, email, secondary_email, phone, whatsapp_phone, instagram_username
--     ON public.contacts
--     FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_deanonymized();
--   ALTER TABLE public.contacts DROP COLUMN IF EXISTS first_inbound_at;
--
-- Y `messages_mark_contact_wrote`, como quedo en la 00296:
--
--   CREATE OR REPLACE FUNCTION public.messages_mark_contact_wrote()
--   RETURNS trigger
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $$
--   BEGIN
--     BEGIN
--       UPDATE public.conversations
--       SET contact_wrote_at = NEW.created_at
--       WHERE id = NEW.conversation_id
--         AND (contact_wrote_at IS NULL OR contact_wrote_at > NEW.created_at);
--     EXCEPTION WHEN OTHERS THEN
--       RAISE WARNING 'messages_mark_contact_wrote: no pude actualizar la conversacion % (%)', NEW.conversation_id, SQLERRM;
--     END;
--     RETURN NEW;
--   END;
--   $$;
-- ============================================================

-- ------------------------------------------------------------
-- 1. La columna y el backfill
-- ------------------------------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS first_inbound_at timestamptz;

COMMENT ON COLUMN public.contacts.first_inbound_at IS
  'Cuando escribio la persona por primera vez, por cualquier canal. Null = nunca escribio, o escribio antes de que se guardaran los mensajes entrantes. La mantienen los triggers messages_zz_contact_wrote y conversations_zz_contact_wrote (00298).';

ALTER TABLE public.contacts DISABLE TRIGGER set_updated_at;

UPDATE public.contacts c
SET first_inbound_at = primero.at
FROM (
  SELECT cv.contact_id, min(cv.contact_wrote_at) AS at
  FROM public.conversations cv
  WHERE cv.contact_wrote_at IS NOT NULL
  GROUP BY cv.contact_id
) primero
WHERE primero.contact_id = c.id
  AND c.first_inbound_at IS NULL;

ALTER TABLE public.contacts ENABLE TRIGGER set_updated_at;

-- ------------------------------------------------------------
-- 2. La marca
-- ------------------------------------------------------------
-- Borrar y crear, igual que en la 00296. Reescribe la tabla sin disparar triggers
-- de fila: no se emite ningun evento ni cambia ningun `updated_at`.
DROP INDEX IF EXISTS public.idx_contacts_identified;

ALTER TABLE public.contacts DROP COLUMN IF EXISTS is_anonymous;

ALTER TABLE public.contacts
  ADD COLUMN is_anonymous boolean
  GENERATED ALWAYS AS (
    (
      lower(btrim(coalesce(display_name, ''))) IN (
        '', 'instagram user', 'facebook user', 'whatsapp user', 'unknown commenter'
      )
      OR (btrim(coalesce(display_name, '')) ~ '^\+?[0-9]{8,}$' AND first_inbound_at IS NULL)
    )
    AND email IS NULL
    AND secondary_email IS NULL
    AND phone IS NULL
    AND whatsapp_phone IS NULL
    AND instagram_username IS NULL
  ) STORED;

COMMENT ON COLUMN public.contacts.is_anonymous IS
  'true cuando no hay con que reconocer a la persona: sin ningun dato de contacto y con un nombre vacio, un relleno de la plataforma, o un id numerico si nunca escribio. Es sobre la identidad, no sobre el trabajo hecho: un contacto con tags y vendedor asignado sigue siendo anonimo. La calcula la base, asi que se apaga sola.';

CREATE INDEX IF NOT EXISTS idx_contacts_identified
  ON public.contacts(workspace_id, last_interaction_at DESC)
  WHERE deleted_at IS NULL AND NOT is_anonymous;

-- ------------------------------------------------------------
-- 3. "Contacto creado" al dejar de estar oculto
-- ------------------------------------------------------------
-- Una columna generada nunca aparece en el SET de un UPDATE (00040): hay que
-- escuchar las que la alimentan, y ahora son una mas.
DROP TRIGGER IF EXISTS contacts_automation_deanonymized ON public.contacts;

CREATE TRIGGER contacts_automation_deanonymized
  AFTER UPDATE OF display_name, email, secondary_email, phone, whatsapp_phone, instagram_username, first_inbound_at
  ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_deanonymized();

-- ------------------------------------------------------------
-- 4. Quien escribe
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_mark_contact_wrote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    UPDATE public.conversations
    SET contact_wrote_at = NEW.created_at
    WHERE id = NEW.conversation_id
      AND (contact_wrote_at IS NULL OR contact_wrote_at > NEW.created_at);

    UPDATE public.contacts c
    SET first_inbound_at = NEW.created_at
    FROM public.conversations cv
    WHERE cv.id = NEW.conversation_id
      AND c.id = cv.contact_id
      AND (c.first_inbound_at IS NULL OR c.first_inbound_at > NEW.created_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'messages_mark_contact_wrote: no pude actualizar la conversacion % (%)', NEW.conversation_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.messages_mark_contact_wrote() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.messages_mark_contact_wrote() IS
  'Anota en la conversacion y en el contacto cuando escribio la persona (00296, 00298). Nunca tumba el insert de un mensaje.';

-- Fusionar contactos cambia el contact_id de la conversacion sin tocar sus mensajes.
CREATE OR REPLACE FUNCTION public.conversations_carry_contact_wrote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    UPDATE public.contacts
    SET first_inbound_at = NEW.contact_wrote_at
    WHERE id = NEW.contact_id
      AND (first_inbound_at IS NULL OR first_inbound_at > NEW.contact_wrote_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conversations_carry_contact_wrote: no pude actualizar el contacto % (%)', NEW.contact_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.conversations_carry_contact_wrote() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conversations_carry_contact_wrote() IS
  'Una conversacion que cambia de contacto le lleva cuando escribio la persona (00298). Nunca tumba la fusion.';

DROP TRIGGER IF EXISTS conversations_zz_contact_wrote ON public.conversations;
CREATE TRIGGER conversations_zz_contact_wrote
  AFTER UPDATE OF contact_id ON public.conversations
  FOR EACH ROW
  WHEN (NEW.contact_wrote_at IS NOT NULL AND NEW.contact_id IS DISTINCT FROM OLD.contact_id)
  EXECUTE FUNCTION public.conversations_carry_contact_wrote();

NOTIFY pgrst, 'reload schema';
