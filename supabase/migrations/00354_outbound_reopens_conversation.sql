-- ============================================================
-- 00354_outbound_reopens_conversation.sql
-- ============================================================
-- Un mensaje que mandamos nosotros reabre una conversacion cerrada.
--
-- Hasta hoy una conversacion solo se reabria cuando el contacto escribia
-- (`lib/inbound.ts`). Un broadcast, una automatizacion, una secuencia o el
-- agente mandaban el mensaje, quedaba guardado como ultimo mensaje, pero la
-- conversacion seguia `closed` y la bandeja (que muestra "Abiertas" por
-- defecto) no la mostraba. Paso con los broadcasts de WhatsApp a chats
-- importados del historial, que nacen cerrados.
--
-- La regla, una sola para todo lo que sale (la decide la base, venga de donde
-- venga el envio):
--   - un mensaje SALIENTE que salio (ni `failed` ni `pending`),
--   - recien enviado (creado hace menos de 10 minutos): lo importado del
--     historial trae su fecha vieja y no reabre nada,
--   - en una conversacion `closed` que se cerro ANTES de ese mensaje: "respondo
--     y cierro" sigue dejandola cerrada.
-- Una conversacion pospuesta (`snoozed`) no se toca. `closed_at` se conserva
-- al reabrir, igual que cuando reabre un entrante (comentario de la 00067).
--
-- Nunca tumba el insert de un mensaje (EXCEPTION WHEN OTHERS).
--
-- Al final reabre las conversaciones de broadcasts que ya salieron con la
-- conversacion cerrada (la misma regla, sin el limite de 10 minutos).
--
-- Aditiva: una funcion y dos triggers nuevos. Puede ir antes o despues del
-- codigo (no hay codigo que la necesite).
-- ============================================================

CREATE OR REPLACE FUNCTION public.messages_reopen_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    IF NEW.direction::text = 'outbound'
       AND NEW.created_at >= now() - interval '10 minutes' THEN
      UPDATE public.conversations c
      SET status = 'open'
      WHERE c.id = NEW.conversation_id
        AND c.status = 'closed'
        AND c.deleted_at IS NULL
        AND (c.closed_at IS NULL OR c.closed_at <= NEW.created_at);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'messages_reopen_conversation: no pude reabrir la conversacion % (%)', NEW.conversation_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.messages_reopen_conversation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_zzz_reopen_conversation ON public.messages;
CREATE TRIGGER messages_zzz_reopen_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW
  WHEN (
    NEW.direction::text = 'outbound'
    AND NEW.status IS DISTINCT FROM 'failed'
    AND NEW.status IS DISTINCT FROM 'pending'
  )
  EXECUTE FUNCTION public.messages_reopen_conversation();

-- Un envio que se guardo `pending` y salio despues (o un reintento que salio).
DROP TRIGGER IF EXISTS messages_zzz_reopen_conversation_update ON public.messages;
CREATE TRIGGER messages_zzz_reopen_conversation_update
  AFTER UPDATE OF status ON public.messages
  FOR EACH ROW
  WHEN (
    NEW.direction::text = 'outbound'
    AND OLD.status IN ('failed', 'pending')
    AND NEW.status IS DISTINCT FROM 'failed'
    AND NEW.status IS DISTINCT FROM 'pending'
  )
  EXECUTE FUNCTION public.messages_reopen_conversation();

-- ------------------------------------------------------------
-- Lo que ya salio: las conversaciones de broadcasts que quedaron cerradas.
-- ------------------------------------------------------------
UPDATE public.conversations c
SET status = 'open'
WHERE c.status = 'closed'
  AND c.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.broadcast_recipients r
    WHERE r.conversation_id = c.id
      AND r.status = 'sent'
      AND (c.closed_at IS NULL OR c.closed_at <= r.sent_at)
  );
