-- ============================================================
-- 00265_conversation_last_message_fix
--
-- Corrige la 00262 (el ultimo mensaje de la conversacion) y suma el "no leido".
--
-- 1. El bug de la 00262. Un mensaje entrante pasa primero por
--    `increment_unread`, que anota `last_message_at = now()`, y RECIEN DESPUES
--    se guarda con la hora del proveedor, unos segundos mas vieja. El trigger
--    lo comparaba contra `last_message_at`, lo veia "mas viejo que el ultimo" y
--    no cambiaba la direccion: la lista decia "Vos: 😉" con un mensaje del
--    contacto. Ahora el trigger mira cual es DE VERDAD el ultimo mensaje
--    guardado (por `created_at`, desempatando por `id`) y la direccion y el
--    preview salen siempre de ese. La fecha nunca se mueve para atras.
--
-- 2. El "no leido" con ManyChat. ManyChat contesta 2 o 3 segundos despues del
--    contacto y su eco suele llegar ANTES que el mensaje del contacto: el eco
--    apagaba el no leido y despues el mensaje (mas viejo) lo volvia a prender.
--    Ahora, al guardar cualquier mensaje, si el ultimo de la conversacion es una
--    respuesta nuestra, el no leido queda en cero. "Nuestra" es la misma regla
--    que `outboundCountsAsAnswered` (lib/inbox/unread.ts): la escribio una
--    persona en la app (o aprobo un borrador) o salio de afuera de la app
--    (ManyChat, la app de Instagram). Una automatizacion de ESTA app (flow,
--    secuencia, difusion, agente) no cuenta: nadie lo leyo todavia.
--
-- 3. Backfill: la direccion, el preview y el no leido de las conversaciones
--    que ya quedaron mal.
--
-- Definicion anterior de public.messages_refresh_last_message() (00262), para
-- volver atras:
--
--   CREATE OR REPLACE FUNCTION public.messages_refresh_last_message()
--   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
--   AS $$
--   BEGIN
--     BEGIN
--       UPDATE public.conversations c
--       SET last_message_at = NEW.created_at,
--           last_message_direction = NEW.direction::text,
--           last_message_preview = private.message_preview_text(NEW.text, NEW.transcript, NEW.attachments)
--       WHERE c.id = NEW.conversation_id
--         AND (c.last_message_at IS NULL OR NEW.created_at >= c.last_message_at);
--     EXCEPTION WHEN OTHERS THEN
--       RAISE WARNING 'messages_refresh_last_message: no pude actualizar la conversacion % (%)', NEW.conversation_id, SQLERRM;
--     END;
--     RETURN NEW;
--   END;
--   $$;
--
-- Los dos triggers (messages_zz_last_message y messages_zz_last_message_update)
-- no cambian: siguen llamando a esta funcion.
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.messages_refresh_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_last record;
BEGIN
  BEGIN
    -- El ultimo mensaje que existe de verdad (ni fallido ni en vuelo). Incluye
    -- al que se acaba de guardar.
    SELECT m.id, m.direction::text AS direction, m.created_at, m.origin::text AS origin, m.sent_by_user_id,
           m.text, m.transcript, m.attachments
    INTO v_last
    FROM public.messages m
    WHERE m.conversation_id = NEW.conversation_id
      AND m.status IS DISTINCT FROM 'failed'
      AND m.status IS DISTINCT FROM 'pending'
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1;

    IF v_last.id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Fecha, direccion y preview salen SIEMPRE del ultimo mensaje, no del que
    -- se acaba de guardar: `increment_unread` escribe el preview del entrante
    -- aunque ya haya una respuesta mas nueva (el eco de ManyChat que llego
    -- antes), y esto lo vuelve a dejar bien. La fecha nunca va para atras.
    UPDATE public.conversations c
    SET last_message_at = GREATEST(c.last_message_at, v_last.created_at),
        last_message_direction = v_last.direction,
        last_message_preview = private.message_preview_text(v_last.text, v_last.transcript, v_last.attachments)
    WHERE c.id = NEW.conversation_id
      AND (
        c.last_message_at IS NULL
        OR c.last_message_at < v_last.created_at
        OR c.last_message_direction IS DISTINCT FROM v_last.direction
        OR c.last_message_preview IS DISTINCT FROM private.message_preview_text(v_last.text, v_last.transcript, v_last.attachments)
      );

    -- El no leido: si lo ultimo que se dijo es nuestro, no hay nada sin leer.
    -- Vale tambien cuando el que se acaba de guardar es un entrante mas viejo
    -- que esa respuesta (llego tarde).
    IF v_last.direction = 'outbound'
       AND (v_last.sent_by_user_id IS NOT NULL OR v_last.origin IN ('user', 'external')) THEN
      UPDATE public.conversations c
      SET unread_count = 0
      WHERE c.id = NEW.conversation_id
        AND c.unread_count > 0;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'messages_refresh_last_message: no pude actualizar la conversacion % (%)', NEW.conversation_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.messages_refresh_last_message() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Backfill
-- ------------------------------------------------------------
WITH last AS (
  SELECT DISTINCT ON (m.conversation_id)
         m.conversation_id, m.direction::text AS direction, m.created_at, m.text, m.transcript, m.attachments,
         m.origin::text AS origin, m.sent_by_user_id
  FROM public.messages m
  WHERE m.status IS DISTINCT FROM 'failed'
    AND m.status IS DISTINCT FROM 'pending'
  ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
)
UPDATE public.conversations c
SET last_message_direction = last.direction,
    last_message_at = GREATEST(c.last_message_at, last.created_at),
    last_message_preview = CASE
      WHEN last.direction = 'outbound' OR COALESCE(last.text, '') <> ''
        THEN private.message_preview_text(last.text, last.transcript, last.attachments)
      ELSE c.last_message_preview
    END,
    unread_count = CASE
      WHEN last.direction = 'outbound' AND (last.sent_by_user_id IS NOT NULL OR last.origin IN ('user', 'external'))
        THEN 0
      ELSE c.unread_count
    END
FROM last
WHERE c.id = last.conversation_id
  AND (
    c.last_message_direction IS DISTINCT FROM last.direction
    OR (
      (last.direction = 'outbound' OR COALESCE(last.text, '') <> '')
      AND c.last_message_preview IS DISTINCT FROM private.message_preview_text(last.text, last.transcript, last.attachments)
    )
    OR (
      c.unread_count > 0
      AND last.direction = 'outbound'
      AND (last.sent_by_user_id IS NOT NULL OR last.origin IN ('user', 'external'))
    )
  );
