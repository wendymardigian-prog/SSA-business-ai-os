-- ============================================================
-- 00348_whatsapp_daily_messages
-- ============================================================
-- El grafico diario de un numero de WhatsApp (noviembre 2026): cuantos
-- mensajes salieron y entraron por dia, y los que salieron separados por
-- quien los mando. Es lo que hay que mirar para no hacer que WhatsApp bloquee
-- el numero (WhatsApp mide lo que SALE).
--
-- Una sola funcion de lectura que cuenta en la base (traer los mensajes a la
-- app para contarlos seria traer miles por mes). Por dia, en la zona que se
-- pide (la de quien mira):
--
--   received   mensajes que entraron en chats privados (los de grupos no:
--              un grupo de 700 personas taparia todo lo demas)
--   automation salieron por un flujo, una secuencia o un broadcast
--   agent      el agente de IA en envio directo
--   approved   un borrador del agente aprobado por una persona
--   human      escritos por una persona desde el sistema
--   external   desde fuera del sistema (el celular, ManyChat, otra app)
--
-- Lo que salio cuenta igual sea a una persona o a un grupo (para WhatsApp es
-- lo mismo). Un envio fallido o que todavia no salio no cuenta. Los mismos
-- criterios que `public.chat_reply_is_human` (00261): `origin = 'agent'` con
-- `sent_by_user_id` es un borrador aprobado; sin persona, envio directo.
--
-- Solo `service_role`: la llama el servidor DESPUES de chequear
-- `channels.manage`, con el workspace de la sesion. Devuelve solo cuentas.
--
-- Aditiva. Como volver atras:
--   DROP FUNCTION IF EXISTS public.whatsapp_channel_daily_messages(uuid, uuid, timestamptz, text);
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.whatsapp_channel_daily_messages(
  p_workspace_id uuid,
  p_channel_id   uuid,
  p_since        timestamptz,
  p_time_zone    text
)
RETURNS TABLE (
  day        date,
  received   integer,
  automation integer,
  agent      integer,
  approved   integer,
  human      integer,
  external   integer
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH chat AS (
    SELECT
      (m.created_at AT TIME ZONE p_time_zone)::date AS day,
      m.direction,
      CASE
        WHEN m.direction <> 'outbound' THEN NULL
        WHEN m.origin IN ('flow', 'sequence', 'broadcast') THEN 'automation'
        WHEN m.origin = 'agent' AND m.sent_by_user_id IS NOT NULL THEN 'approved'
        WHEN m.origin = 'agent' THEN 'agent'
        WHEN m.origin = 'user' THEN 'human'
        ELSE 'external'
      END AS who
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE c.channel_id = p_channel_id
      AND c.workspace_id = p_workspace_id
      AND m.created_at >= p_since
      AND (m.direction = 'inbound' OR coalesce(m.status, 'sent') NOT IN ('failed', 'pending'))
  ),
  grp AS (
    SELECT
      (gm.created_at AT TIME ZONE p_time_zone)::date AS day,
      CASE gm.origin WHEN 'flow' THEN 'automation' WHEN 'app' THEN 'human' ELSE 'external' END AS who
    FROM public.whatsapp_group_messages gm
    JOIN public.whatsapp_groups g ON g.id = gm.group_id
    WHERE g.channel_id = p_channel_id
      AND g.workspace_id = p_workspace_id
      AND gm.direction = 'outbound'
      AND gm.status = 'sent'
      AND gm.created_at >= p_since
  ),
  all_rows AS (
    SELECT day, direction, who FROM chat
    UNION ALL
    SELECT day, 'outbound', who FROM grp
  )
  SELECT
    day,
    count(*) FILTER (WHERE direction = 'inbound')::integer,
    count(*) FILTER (WHERE who = 'automation')::integer,
    count(*) FILTER (WHERE who = 'agent')::integer,
    count(*) FILTER (WHERE who = 'approved')::integer,
    count(*) FILTER (WHERE who = 'human')::integer,
    count(*) FILTER (WHERE who = 'external')::integer
  FROM all_rows
  GROUP BY day
  ORDER BY day;
$$;

COMMENT ON FUNCTION public.whatsapp_channel_daily_messages(uuid, uuid, timestamptz, text) IS
  'Mensajes por dia de un numero de WhatsApp: recibidos en chats y enviados por quien los mando (00348). Solo service_role.';

REVOKE ALL ON FUNCTION public.whatsapp_channel_daily_messages(uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_channel_daily_messages(uuid, uuid, timestamptz, text) TO service_role;
