-- ============================================================
-- 00349_whatsapp_daily_messages_broadcast
-- ============================================================
-- El grafico diario de un numero de WhatsApp separa los BROADCASTS de las
-- demas automatizaciones (pedido del 8/11/2026). Misma funcion que la 00348,
-- con una columna mas: `broadcast` (`messages.origin = 'broadcast'`), y
-- `automation` queda para flujos y secuencias.
--
-- Cambiar las columnas que devuelve una funcion obliga a borrarla y crearla
-- de nuevo (CREATE OR REPLACE no puede). Mismos permisos: solo service_role.
--
-- Aditiva (una funcion de lectura). Va ANTES de desplegar el codigo: el
-- grafico lee la columna nueva.
--
-- Como volver atras: volver a correr la 00348 (despues de
--   DROP FUNCTION IF EXISTS public.whatsapp_channel_daily_messages(uuid, uuid, timestamptz, text);).
--
-- Idempotente.
-- ============================================================

DROP FUNCTION IF EXISTS public.whatsapp_channel_daily_messages(uuid, uuid, timestamptz, text);

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
  broadcast  integer,
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
        WHEN m.origin = 'broadcast' THEN 'broadcast'
        WHEN m.origin IN ('flow', 'sequence') THEN 'automation'
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
    count(*) FILTER (WHERE who = 'broadcast')::integer,
    count(*) FILTER (WHERE who = 'agent')::integer,
    count(*) FILTER (WHERE who = 'approved')::integer,
    count(*) FILTER (WHERE who = 'human')::integer,
    count(*) FILTER (WHERE who = 'external')::integer
  FROM all_rows
  GROUP BY day
  ORDER BY day;
$$;

COMMENT ON FUNCTION public.whatsapp_channel_daily_messages(uuid, uuid, timestamptz, text) IS
  'Mensajes por dia de un numero de WhatsApp: recibidos en chats y enviados por quien los mando (00349). Solo service_role.';

REVOKE ALL ON FUNCTION public.whatsapp_channel_daily_messages(uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_channel_daily_messages(uuid, uuid, timestamptz, text) TO service_role;
