-- ============================================================
-- 00262_conversation_last_message
--
-- La lista de la bandeja mostraba el ultimo mensaje DEL LEAD, no el ultimo
-- de la conversacion: `last_message_at` / `last_message_preview` los
-- escribian solo algunos caminos (el envio manual, el agente, el entrante).
-- Lo que sale por ManyChat (eco `origin = 'external'`), los flows y las
-- secuencias no los tocaban, asi que una charla que ya habiamos respondido
-- parecia sin responder. Y no habia forma de saber si el ultimo fue nuestro.
--
-- 1. `conversations.last_message_direction` ('inbound' | 'outbound').
-- 2. Un trigger en `messages` que mantiene la fecha, el preview y la
--    direccion con el ULTIMO mensaje que de verdad existe: cualquier entrante
--    y cualquier saliente que salio (ni `failed` ni `pending`). Un mensaje mas
--    viejo que el ultimo (un backfill de historial) no la mueve para atras.
--    Va en EXCEPTION WHEN OTHERS: nunca puede tumbar el insert de un mensaje.
-- 3. `private.message_preview_text`: la gemela simplificada de
--    `previewForMessage` (lib/message-preview.ts): texto, transcripcion o la
--    etiqueta del primer adjunto. Las etiquetas son las de `LABELS` en
--    lib/messages/attachments.ts (lib/inbox/last-message-sql.test.ts las
--    compara). Los formatos viejos de adjuntos que no se reconocen dicen
--    "Adjunto". Los caminos de TypeScript que ya escriben el preview siguen
--    igual (escriben lo mismo o algo mejor).
-- 4. `messages.send_error`: el motivo de un envio que no salio, aparte del
--    texto. Antes el motivo PISABA el texto y al recargar se perdia lo que la
--    persona habia escrito.
-- 5. Backfill de la direccion, la fecha y el preview.
--
-- Aditiva e idempotente.
-- ============================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_message_direction text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_last_message_direction_check'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_last_message_direction_check
      CHECK (last_message_direction IS NULL OR last_message_direction IN ('inbound', 'outbound'));
  END IF;
END $$;

COMMENT ON COLUMN public.conversations.last_message_direction IS
  'Si el ultimo mensaje de la conversacion fue del contacto (inbound) o nuestro (outbound). Lo mantiene el trigger messages_zz_last_message (00262).';

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS send_error text;

COMMENT ON COLUMN public.messages.send_error IS
  'Por que no salio un envio (status failed), en castellano. El texto queda con lo que se quiso mandar (00262).';

-- ------------------------------------------------------------
-- El preview de un mensaje
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.attachment_preview_label(p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_kind
    WHEN 'image' THEN '📷 Imagen'
    WHEN 'video' THEN '🎬 Video'
    WHEN 'audio' THEN '🎵 Audio'
    WHEN 'voice' THEN '🎤 Nota de voz'
    WHEN 'sticker' THEN 'Sticker'
    WHEN 'gif' THEN 'GIF'
    WHEN 'document' THEN '📄 Documento'
    WHEN 'location' THEN '📍 Ubicación'
    WHEN 'contact' THEN '👤 Contacto'
    WHEN 'poll' THEN '📊 Encuesta'
    WHEN 'share' THEN '🔗 Publicación compartida'
    WHEN 'link' THEN '🔗 Link'
    WHEN 'story_reply' THEN 'Respuesta a una historia'
    ELSE 'Adjunto'
  END;
$$;

CREATE OR REPLACE FUNCTION private.message_preview_text(p_text text, p_transcript text, p_attachments jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_first jsonb;
BEGIN
  IF COALESCE(p_text, '') <> '' THEN
    RETURN left(p_text, 100);
  END IF;
  IF COALESCE(p_transcript, '') <> '' THEN
    RETURN left(p_transcript, 100);
  END IF;
  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) = 'null' THEN
    RETURN '';
  END IF;

  -- Forma nueva: { v: 2, items: [...] }.
  IF jsonb_typeof(p_attachments) = 'object' AND p_attachments->>'v' = '2' THEN
    v_first := p_attachments->'items'->0;
    IF v_first IS NULL THEN
      RETURN '';
    END IF;
    RETURN private.attachment_preview_label(v_first->>'kind');
  END IF;

  -- Zernio y lo que registra un flow: [{ type, url }].
  IF jsonb_typeof(p_attachments) = 'array' THEN
    v_first := p_attachments->0;
    IF v_first IS NULL THEN
      RETURN '';
    END IF;
    RETURN private.attachment_preview_label(v_first->>'type');
  END IF;

  RETURN 'Adjunto';
END;
$$;

REVOKE ALL ON FUNCTION private.attachment_preview_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.message_preview_text(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.attachment_preview_label(text) TO service_role;
GRANT EXECUTE ON FUNCTION private.message_preview_text(text, text, jsonb) TO service_role;

-- ------------------------------------------------------------
-- El trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_refresh_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    UPDATE public.conversations c
    SET last_message_at = NEW.created_at,
        last_message_direction = NEW.direction::text,
        last_message_preview = private.message_preview_text(NEW.text, NEW.transcript, NEW.attachments)
    WHERE c.id = NEW.conversation_id
      AND (c.last_message_at IS NULL OR NEW.created_at >= c.last_message_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'messages_refresh_last_message: no pude actualizar la conversacion % (%)', NEW.conversation_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.messages_refresh_last_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_zz_last_message ON public.messages;
CREATE TRIGGER messages_zz_last_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM 'failed' AND NEW.status IS DISTINCT FROM 'pending')
  EXECUTE FUNCTION public.messages_refresh_last_message();

-- Un envio que se reintenta y sale (failed -> pending -> sent) pasa a ser el
-- ultimo mensaje recien ahi.
DROP TRIGGER IF EXISTS messages_zz_last_message_update ON public.messages;
CREATE TRIGGER messages_zz_last_message_update
  AFTER UPDATE OF status ON public.messages
  FOR EACH ROW
  WHEN (
    OLD.status IN ('failed', 'pending')
    AND NEW.status IS DISTINCT FROM 'failed'
    AND NEW.status IS DISTINCT FROM 'pending'
  )
  EXECUTE FUNCTION public.messages_refresh_last_message();

-- ------------------------------------------------------------
-- Backfill
-- ------------------------------------------------------------
-- La fecha no se mueve para atras (algunos caminos guardan un instante unos
-- milisegundos posterior al del mensaje). El preview se reemplaza cuando el
-- ultimo es nuestro o tiene texto; en un entrante sin texto se deja el que
-- escribio TypeScript, que entiende todos los formatos de adjuntos.
WITH last AS (
  SELECT DISTINCT ON (m.conversation_id)
         m.conversation_id, m.direction, m.created_at, m.text, m.transcript, m.attachments
  FROM public.messages m
  WHERE m.status IS DISTINCT FROM 'failed'
    AND m.status IS DISTINCT FROM 'pending'
  ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
)
UPDATE public.conversations c
SET last_message_direction = last.direction::text,
    last_message_at = GREATEST(c.last_message_at, last.created_at),
    last_message_preview = CASE
      WHEN last.direction = 'outbound' OR COALESCE(last.text, '') <> ''
        THEN private.message_preview_text(last.text, last.transcript, last.attachments)
      ELSE c.last_message_preview
    END
FROM last
WHERE c.id = last.conversation_id
  AND (
    c.last_message_direction IS DISTINCT FROM last.direction::text
    OR c.last_message_at IS NULL
    OR c.last_message_at < last.created_at
    OR (
      (last.direction = 'outbound' OR COALESCE(last.text, '') <> '')
      AND c.last_message_preview IS DISTINCT FROM private.message_preview_text(last.text, last.transcript, last.attachments)
    )
  );
