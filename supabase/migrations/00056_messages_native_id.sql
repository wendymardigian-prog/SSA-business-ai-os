-- ============================================================================
-- 00056 — Guardar tambien el id nativo de la plataforma
-- ============================================================================
-- `platform_message_id` guarda el id de ZERNIO. Es lo correcto y no cambia: es
-- el que devuelve la API al enviar, el que usa la bandeja al leer y el unico
-- que trae el endpoint de historial, asi que es el que hace funcionar al indice
-- unico que evita los duplicados.
--
-- Pero el webhook trae DOS ids y hasta ahora se tiraba uno: `message.id` (el de
-- Zernio) y `message.platformMessageId` (el que Meta le dio al mensaje en
-- Instagram). Ese segundo es el unico handle que sirve para hablar con Meta
-- —un pedido de borrado, un reclamo de soporte, una verificacion— y NO se puede
-- recuperar despues: el endpoint de historial no lo devuelve, asi que lo que no
-- se guarde cuando entra el webhook se pierde para siempre.
--
-- Por eso va en su propia columna y no adentro de `attachments`: attachments es
-- la lista de media que la bandeja recorre para pintar imagenes, y meterle un
-- metadato que no es un adjunto obliga a filtrarlo en cada lectura. Una columna
-- nullable cuesta menos y se explica sola.
--
-- Queda en null en dos casos, los dos esperados:
--   - Los mensajes que trae el backfill, porque la API no lo devuelve.
--   - Los de WhatsApp, donde el id de Evolution ya es el nativo y esta en
--     platform_message_id.
--
-- Sin indice: no se busca por esta columna, se la consulta cuando ya se tiene
-- el mensaje. El dia que haya que buscar al reves, se agrega.
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS platform_native_message_id text;

COMMENT ON COLUMN public.messages.platform_native_message_id IS
  'Id que le dio la plataforma al mensaje (Instagram via Meta), distinto del de platform_message_id, que es el de Zernio. Solo lo trae el webhook en vivo: el endpoint de historial no lo devuelve, asi que los mensajes del backfill lo tienen en null. Es el handle para pedidos de borrado o soporte contra Meta.';
