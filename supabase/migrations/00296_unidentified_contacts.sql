-- ============================================================
-- MIGRACION 00296 — UN CONTACTO SIN DATOS QUEDA OCULTO HASTA SABER QUIEN ES
-- ============================================================
-- ManyChat le escribe a cada seguidor nuevo y Zernio avisa ese mensaje (el eco).
-- Instagram todavia no da el nombre ni el usuario de esa persona, asi que el
-- contacto nace con el id de la plataforma como nombre ("1127362606826154"). En
-- produccion son 667 de 2806, entran 40 a 70 por dia y nadie los trabajo.
--
-- El sistema ya sabe ocultar a quien no se puede reconocer: `is_anonymous` (00032)
-- lo saca de la lista de Contactos y de la asignacion, y `contact_created` recien
-- se emite cuando se identifica. Pero la marca no reconocia un numero como "sin
-- nombre" (la 00284 lo dejo afuera a proposito). Los toques ya viven en el
-- contacto: cuando la persona escribe se completa la misma fila y no hay nada
-- que mover ni fusionar.
--
-- Cambios, en este orden:
--   1. Se completan los contactos cuyo usuario ya conocemos por un comentario. Va
--      ANTES de cambiar la marca: asi quien ya emitio `contact_created` por tener
--      un numero como nombre no lo vuelve a emitir por este backfill.
--   2. `is_anonymous` suma un nombre de solo digitos.
--   3. `conversations.contact_wrote_at`: cuando escribio la persona por primera
--      vez. La mantiene un trigger de `messages`, que nunca tumba un mensaje.
--   4. `conversation_is_silent_outreach`: campo calculado para la bandeja. La
--      persona nunca escribio y su contacto es anonimo.
--
-- NO cambia: find_or_link_contact, record_contact_touch, merge_contacts ni
-- ninguna funcion protegida. `is_placeholder_name` (00284) tampoco.
--
-- Va ANTES de desplegar el codigo: la bandeja lee el campo calculado.
--
-- Definicion anterior de la columna (00032), para volver atras:
--
--   DROP INDEX IF EXISTS public.idx_contacts_identified;
--   ALTER TABLE public.contacts DROP COLUMN IF EXISTS is_anonymous;
--   ALTER TABLE public.contacts
--     ADD COLUMN is_anonymous boolean
--     GENERATED ALWAYS AS (
--       lower(btrim(coalesce(display_name, ''))) IN (
--         '', 'instagram user', 'facebook user', 'whatsapp user', 'unknown commenter'
--       )
--       AND email IS NULL
--       AND secondary_email IS NULL
--       AND phone IS NULL
--       AND whatsapp_phone IS NULL
--       AND instagram_username IS NULL
--     ) STORED;
--   CREATE INDEX IF NOT EXISTS idx_contacts_identified
--     ON public.contacts(workspace_id, last_interaction_at DESC)
--     WHERE deleted_at IS NULL AND NOT is_anonymous;
-- ============================================================

-- ------------------------------------------------------------
-- 1. Completar con lo que ya sabemos por los comentarios
-- ------------------------------------------------------------
-- El id del autor de un comentario es el mismo con el que la persona escribe por
-- DM. Se toma el comentario mas reciente. No se escribe un @ que ya es de otro
-- contacto vivo, ni uno que le tocaria a dos contactos: identificar mal a alguien
-- es peor que dejarlo oculto. Solo cuando el nombre es un relleno, asi que nunca
-- se pisa lo que escribio una persona.
WITH candidatos AS (
  SELECT DISTINCT ON (c.id)
    c.id,
    c.workspace_id,
    lower(regexp_replace(btrim(spc.author_username), '^@+', '')) AS usuario,
    NULLIF(btrim(spc.author_name), '') AS nombre
  FROM public.contacts c
  JOIN public.contact_channels cc ON cc.contact_id = c.id
  JOIN public.channels ch ON ch.id = cc.channel_id AND ch.platform = 'instagram'
  JOIN public.social_post_comments spc
    ON spc.workspace_id = c.workspace_id
   AND spc.platform = 'instagram'
   AND spc.author_external_id = cc.platform_sender_id
   AND NOT spc.is_own
   AND spc.deleted_at IS NULL
   AND NULLIF(btrim(spc.author_username), '') IS NOT NULL
  WHERE c.deleted_at IS NULL
    AND c.instagram_username IS NULL
    AND public.is_placeholder_name(c.display_name)
  ORDER BY c.id, spc.commented_at DESC NULLS LAST, spc.created_at DESC
),
unicos AS (
  SELECT cand.*, count(*) OVER (PARTITION BY cand.workspace_id, cand.usuario) AS repetidos
  FROM candidatos cand
)
UPDATE public.contacts c
SET
  instagram_username = u.usuario,
  display_name = CASE
    WHEN u.nombre IS NOT NULL AND NOT public.is_placeholder_name(u.nombre) THEN u.nombre
    ELSE '@' || u.usuario
  END
FROM unicos u
WHERE c.id = u.id
  AND u.repetidos = 1
  AND u.usuario ~ '^[a-z0-9._]+$'
  AND NOT EXISTS (
    SELECT 1
    FROM public.contacts otro
    WHERE otro.workspace_id = c.workspace_id
      AND otro.id <> c.id
      AND otro.deleted_at IS NULL
      AND lower(otro.instagram_username) = u.usuario
  );

-- ------------------------------------------------------------
-- 2. La marca reconoce un numero como "sin nombre"
-- ------------------------------------------------------------
-- La expresion de una columna generada no se edita (antes de PG17): se borra y se
-- crea. Agregarla reescribe la tabla sin disparar triggers de fila, asi que no se
-- emite ningun evento ni cambia ningun `updated_at`. La expresion es la misma de
-- `ID_NAME_PATTERN` (lib/contacts/anonymous.ts) y va inline por el mismo motivo
-- que en la 00032: el test la compara.
DROP INDEX IF EXISTS public.idx_contacts_identified;

ALTER TABLE public.contacts DROP COLUMN IF EXISTS is_anonymous;

ALTER TABLE public.contacts
  ADD COLUMN is_anonymous boolean
  GENERATED ALWAYS AS (
    (
      lower(btrim(coalesce(display_name, ''))) IN (
        '', 'instagram user', 'facebook user', 'whatsapp user', 'unknown commenter'
      )
      OR btrim(coalesce(display_name, '')) ~ '^\+?[0-9]{8,}$'
    )
    AND email IS NULL
    AND secondary_email IS NULL
    AND phone IS NULL
    AND whatsapp_phone IS NULL
    AND instagram_username IS NULL
  ) STORED;

COMMENT ON COLUMN public.contacts.is_anonymous IS
  'true cuando no hay con que reconocer a la persona: sin nombre propio (vacio, un relleno de la plataforma o un id numerico) y sin ningun dato de contacto. Es sobre la identidad, no sobre el trabajo hecho: un contacto con tags y vendedor asignado sigue siendo anonimo. La calcula la base, asi que se apaga sola cuando el contacto se enriquece.';

CREATE INDEX IF NOT EXISTS idx_contacts_identified
  ON public.contacts(workspace_id, last_interaction_at DESC)
  WHERE deleted_at IS NULL AND NOT is_anonymous;

-- ------------------------------------------------------------
-- 3. Cuando escribio la persona por primera vez
-- ------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS contact_wrote_at timestamptz;

COMMENT ON COLUMN public.conversations.contact_wrote_at IS
  'Cuando escribio la persona por primera vez en esta conversacion. Null = nunca escribio, o escribio antes de que se guardaran los mensajes entrantes. La mantiene el trigger messages_zz_contact_wrote (00296); no depende de la retencion de mensajes.';

CREATE INDEX IF NOT EXISTS idx_conversations_never_wrote
  ON public.conversations(workspace_id)
  WHERE contact_wrote_at IS NULL AND deleted_at IS NULL;

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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'messages_mark_contact_wrote: no pude actualizar la conversacion % (%)', NEW.conversation_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.messages_mark_contact_wrote() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.messages_mark_contact_wrote() IS
  'Anota en la conversacion cuando escribio la persona (00296). Nunca tumba el insert de un mensaje.';

-- Tambien al mover un mensaje de conversacion: es lo que hace merge_contacts cuando
-- dos contactos fusionados tenian un chat en el mismo canal.
DROP TRIGGER IF EXISTS messages_zz_contact_wrote ON public.messages;
CREATE TRIGGER messages_zz_contact_wrote
  AFTER INSERT OR UPDATE OF conversation_id ON public.messages
  FOR EACH ROW
  WHEN (NEW.direction = 'inbound')
  EXECUTE FUNCTION public.messages_mark_contact_wrote();

-- Backfill sin tocar `updated_at`: no cambia el orden ni la fecha de ningun chat.
-- Idempotente: solo mira las conversaciones que todavia no tienen el dato.
ALTER TABLE public.conversations DISABLE TRIGGER set_updated_at;

UPDATE public.conversations cv
SET contact_wrote_at = primero.at
FROM (
  SELECT m.conversation_id, min(m.created_at) AS at
  FROM public.messages m
  WHERE m.direction = 'inbound'
  GROUP BY m.conversation_id
) primero
WHERE primero.conversation_id = cv.id
  AND cv.contact_wrote_at IS NULL;

ALTER TABLE public.conversations ENABLE TRIGGER set_updated_at;

-- ------------------------------------------------------------
-- 4. El campo calculado de la bandeja
-- ------------------------------------------------------------
-- PostgREST no puede combinar con OR una columna propia y una de la tabla embebida
-- (mismo motivo que `conversation_people`, 00255). SECURITY INVOKER: lee el contacto
-- con la RLS de quien mira; si no lo puede ver, la conversacion no se oculta. La
-- columna va primero para no leer el contacto de quien ya escribio.
CREATE OR REPLACE FUNCTION public.conversation_is_silent_outreach(conv public.conversations)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT conv.contact_wrote_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = conv.contact_id AND c.is_anonymous
    )
$$;

COMMENT ON FUNCTION public.conversation_is_silent_outreach(public.conversations) IS
  'true si le escribio el negocio o una automatizacion, la persona nunca respondio y no se sabe quien es (00296). La bandeja las oculta por defecto. Nunca devuelve NULL.';

REVOKE ALL ON FUNCTION public.conversation_is_silent_outreach(public.conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_is_silent_outreach(public.conversations) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
