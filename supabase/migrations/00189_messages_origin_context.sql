-- ============================================================================
-- 00189 — Contexto de origen de un mensaje: `messages.origin_context`  (M4 del Extra L)
-- ============================================================================
-- Un mensaje entrante puede llegar de una respuesta a una historia, de una mencion en una historia
-- o de un anuncio (el `referral` de Zernio y el `externalAdReply` de WhatsApp). Hoy esos datos solo
-- viajaban al toque de atribucion y el mensaje no guardaba nada: no todo mensaje es un toque, y las
-- automatizaciones necesitan leerlos ("solo si vino de un anuncio").
--
-- Es una lista blanca armada por `lib/messages/origin-context.ts`:
--   { story_reply?: {story_id, story_url}, story_mention?: true,
--     ad?: {ad_id, ctwa_clid, source_type, source_url, title, ref, post_id, platform},
--     quoted_message_id? }
-- ADITIVA: una columna nueva, nula en los mensajes viejos (no hay backfill: el `referral` viejo no
-- se guardo nunca). El codigo viejo no la lee ni la escribe.
--
-- Como volver atras:
--   ALTER TABLE public.messages DROP COLUMN IF EXISTS origin_context;
-- Riesgo: bajo.
-- ============================================================================

SET search_path = '';

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS origin_context jsonb;

COMMENT ON COLUMN public.messages.origin_context IS
  'De donde vino un mensaje entrante: respuesta o mencion en una historia, anuncio (lista blanca, lib/messages/origin-context.ts). Null si no vino de ninguno.';
