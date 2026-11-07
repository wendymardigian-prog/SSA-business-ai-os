-- ============================================================================
-- 00313 — La media del chat y los adjuntos de email: se leen con el alcance de la conversacion
-- ============================================================================
-- Seguridad (noviembre 2026). Hasta aca las politicas de lectura de los buckets `chat-media` (00102) y
-- `email-attachments` (00087) solo pedian ser miembro del workspace del PRIMER segmento del path.
-- Asi un Member con alcance "solo lo asignado" podia firmar (y bajar) los audios, fotos y adjuntos de
-- chats que la bandeja no le muestra: alcanzaba con conocer o adivinar el path.
--
-- Ahora la lectura sigue la misma regla que la bandeja. Las formas de path que se escriben hoy
-- (relevadas en el codigo, no hay otras):
--
--   chat-media
--     <ws>/<conversacion>/<mensaje>-<n>.<ext>   lo que llega (lib/inbound-media.ts, mediaPath)
--     <ws>/<conversacion>/out-<uuid>.<ext>      lo que se sube desde el composer (lib/actions/chat-upload.ts)
--     <ws>/<conversacion>/sticker-<uuid>.webp   un sticker copiado a la conversacion (lib/stickers/library.ts)
--     <ws>/<conversacion>/library-<uuid>.<ext>  un recurso copiado a la conversacion (lib/response-assets/send-copy.ts)
--        -> can_see_conversation de ESA conversacion (del mismo workspace).
--     <ws>/groups/<grupo>/<archivo>             grupos de WhatsApp (lib/whatsapp-groups/rules.ts, groupMediaFolder)
--        -> can_see_whatsapp_group de ese grupo (del mismo workspace).
--     <ws>/library/<archivo>                    la banca de recursos (lib/actions/response-assets.ts)
--     <ws>/stickers/<archivo>                   la biblioteca de stickers (lib/stickers/format.ts)
--        -> carpetas compartidas del negocio: cualquier miembro, como antes.
--
--   email-attachments
--     <ws>/<id del email de Resend>/<n>-<nombre>  (lib/email/inbound.ts, storeAttachments)
--        -> el mensaje con ese `platform_message_id` en ese workspace, y can_see_conversation de su
--           conversacion. Un correo automatico (sin conversacion) solo lo ve Owner/Admin.
--
-- Owner y Admin siguen viendo todo lo de su workspace (camino corto, sin buscar la conversacion).
-- Cualquier otra forma de path, para un Member, NO se lee: ante la duda, lo mas angosto.
--
-- Costo: la politica corre una vez por fila al listar. Hoy solo listan el servidor (service role, que
-- no pasa por RLS) y la descarga firma de a un archivo (`/api/v1/chat-media`, `/api/v1/email-attachments`,
-- con el cliente del usuario). Para un Member son dos chequeos de pertenencia y una busqueda por clave
-- primaria (conversacion o grupo); para el email, una por el indice nuevo (workspace, platform_message_id).
--
-- Escribir y borrar siguen siendo del servidor: no hay politicas de INSERT/UPDATE/DELETE (no cambia).
-- Aditiva e idempotente: puede ir antes o despues del deploy (el codigo no cambia por esto).
--
-- LAS POLITICAS VIEJAS, letra por letra (leidas de la base el 7/11/2026), para volver atras:
--
--   DROP POLICY IF EXISTS "chat_media_select" ON storage.objects;
--   CREATE POLICY "chat_media_select" ON storage.objects
--     FOR SELECT USING (
--       bucket_id = 'chat-media'
--       AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
--     );
--
--   DROP POLICY IF EXISTS "email_attachments_select" ON storage.objects;
--   CREATE POLICY "email_attachments_select" ON storage.objects
--     FOR SELECT USING (
--       bucket_id = 'email-attachments'
--       AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
--     );
--
--   DROP FUNCTION IF EXISTS public.can_read_chat_media(text);
--   DROP FUNCTION IF EXISTS public.can_read_email_attachment(text);
--   DROP INDEX IF EXISTS public.idx_messages_workspace_platform_message_id;
--
-- Como probarla (con un Member de alcance "solo lo asignado" y la app corriendo):
--   - un audio de un chat asignado a el se escucha; uno de un chat que no ve da 404 en /api/v1/chat-media;
--   - los recursos y stickers del negocio se siguen viendo;
--   - un adjunto de email de una conversacion que no ve da 404 en /api/v1/email-attachments;
--   - Owner y Admin, igual que antes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. chat-media
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_read_chat_media(p_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_uuid  constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_parts text[];
  v_ws    uuid;
  v_conv  public.conversations;
  v_group uuid;
BEGIN
  IF p_name IS NULL THEN
    RETURN false;
  END IF;
  v_parts := string_to_array(p_name, '/');
  -- Un path invalido nunca hace fallar la consulta (un cast roto tumbaria el listado entero): no se lee.
  IF cardinality(v_parts) < 3 OR v_parts[1] !~* v_uuid THEN
    RETURN false;
  END IF;
  v_ws := v_parts[1]::uuid;

  IF NOT public.is_workspace_member(v_ws) THEN
    RETURN false;
  END IF;
  IF public.is_workspace_admin(v_ws) THEN
    RETURN true;
  END IF;

  -- Las carpetas compartidas del negocio: la banca de recursos y la biblioteca de stickers.
  IF cardinality(v_parts) = 3 AND v_parts[2] IN ('library', 'stickers') THEN
    RETURN true;
  END IF;

  -- Un grupo de WhatsApp: <ws>/groups/<grupo>/<archivo>.
  IF cardinality(v_parts) = 4 AND v_parts[2] = 'groups' AND v_parts[3] ~* v_uuid THEN
    v_group := v_parts[3]::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_groups g WHERE g.id = v_group AND g.workspace_id = v_ws) THEN
      RETURN false;
    END IF;
    RETURN COALESCE(public.can_see_whatsapp_group(v_group), false);
  END IF;

  -- Una conversacion: <ws>/<conversacion>/<archivo>.
  IF cardinality(v_parts) = 3 AND v_parts[2] ~* v_uuid THEN
    SELECT * INTO v_conv FROM public.conversations c WHERE c.id = v_parts[2]::uuid AND c.workspace_id = v_ws;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    RETURN COALESCE(public.can_see_conversation(v_conv), false);
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.can_read_chat_media(text) IS
  'Lectura de un archivo de chat-media (00313): Owner/Admin todo su workspace; un Member, lo de una conversacion que ve (can_see_conversation), un grupo que ve (can_see_whatsapp_group) o las carpetas compartidas library/ y stickers/. Nunca NULL.';

REVOKE ALL ON FUNCTION public.can_read_chat_media(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_chat_media(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "chat_media_select" ON storage.objects;
CREATE POLICY "chat_media_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND public.can_read_chat_media(name)
  );

-- ----------------------------------------------------------------------------
-- 2. email-attachments
-- ----------------------------------------------------------------------------

-- El mensaje se busca por (workspace, id del email): el indice unico que ya existe empieza por la
-- conversacion, que la politica no conoce.
CREATE INDEX IF NOT EXISTS idx_messages_workspace_platform_message_id
  ON public.messages (workspace_id, platform_message_id)
  WHERE platform_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.can_read_email_attachment(p_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_uuid  constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_parts text[];
  v_ws    uuid;
BEGIN
  IF p_name IS NULL THEN
    RETURN false;
  END IF;
  v_parts := string_to_array(p_name, '/');
  IF cardinality(v_parts) < 3 OR v_parts[1] !~* v_uuid THEN
    RETURN false;
  END IF;
  v_ws := v_parts[1]::uuid;

  IF NOT public.is_workspace_member(v_ws) THEN
    RETURN false;
  END IF;
  IF public.is_workspace_admin(v_ws) THEN
    RETURN true;
  END IF;

  -- <ws>/<id del email>/<n>-<nombre>: el mensaje que trajo ese email, en una conversacion que ve.
  IF cardinality(v_parts) <> 3 OR v_parts[2] = '' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = v_ws
      AND m.platform_message_id = v_parts[2]
      AND c.workspace_id = v_ws
      AND COALESCE(public.can_see_conversation(c), false)
  );
END;
$$;

COMMENT ON FUNCTION public.can_read_email_attachment(text) IS
  'Lectura de un adjunto de email (00313): Owner/Admin todo su workspace; un Member, solo los adjuntos de un email de una conversacion que ve (can_see_conversation). Nunca NULL.';

REVOKE ALL ON FUNCTION public.can_read_email_attachment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_email_attachment(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "email_attachments_select" ON storage.objects;
CREATE POLICY "email_attachments_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'email-attachments'
    AND public.can_read_email_attachment(name)
  );
