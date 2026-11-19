-- 00420_whatsapp_send_queue.sql · Cola de WhatsApp de las automatizaciones (traída de RER-BAIOS, 18/11/2026).
--
-- Hasta acá la cola con ritmo por número (00285) la usaban solo los broadcasts: cada automatización mandaba su WhatsApp
-- al instante. Desde esta migración, los WhatsApp de las automatizaciones que NO arrancan porque el contacto escribió
-- (etiqueta, alta, formulario, fecha, webhook, ventas…) entran en `send_queue_items` y salen de a uno por el carril del
-- número (`channel_send_lanes`), con su espera al azar, su horario y sus topes. Decisiones de producto (18/11/2026):
--   - el ritmo es el del número (`channels.send_policy`), el mismo techo que los broadcasts;
--   - el 20 % del cupo de la hora queda para lo urgente, también frente a los broadcasts;
--   - lo que escribe el equipo a mano, desde el celular o el agente cuenta en el cupo, pero nunca se frena;
--   - el tope de automáticos por contacto y día viene APAGADO (`send_contact_caps` null).
--
-- Qué suma (todo aditivo e idempotente; nada se borra ni cambia de tipo):
--   1. `channel_send_lanes.bulk_paused_at` (pausar lo masivo de la cola de un número) y `undelivered_since` (desde cuándo
--      el número podía mandar, tenía pendientes y no entregó ninguno: la alerta de «dejó de entregar»).
--   2. La tabla `send_queue_items`. Sin `contact_id` a propósito: el destino es la conversación, el grupo o un número,
--      así que la fusión de contactos (`merge_contacts`) no cambia. RLS de solo lectura con `channels.manage`; escribe
--      solo el servidor.
--   3. Funciones del despachador (solo `service_role`): tomar el turno del carril con un reloj dado, tomar el próximo
--      envío por prioridad (SKIP LOCKED), liberar los programados, caducar lo vencido, contar el cupo del número
--      (`send_lane_counts`: TODO lo que sale por él), vaciar la cola de un número y contar lo automático de hoy a un
--      contacto o grupo (`send_contact_day_count`).
--   4. `workspaces.send_contact_caps` (null = sin tope) y `workspaces.send_lane_alert` (null = 30 minutos).
--
-- Va ANTES de desplegar el código: los pasos de WhatsApp, el despachador y la pantalla de la cola leen la tabla.
--
-- Volver atrás: DROP FUNCTION public.send_contact_day_count(uuid, uuid, uuid, text, timestamptz, boolean, uuid),
-- public.empty_send_queue(uuid, uuid, text), public.send_lane_counts(uuid, timestamptz, timestamptz),
-- public.expire_send_queue_items(timestamptz), public.release_scheduled_send_queue_items(timestamptz),
-- public.claim_send_queue_item(uuid, timestamptz, text[]), public.claim_lane_slot_at(uuid, timestamptz, timestamptz);
-- DROP TABLE public.send_queue_items; ALTER TABLE public.channel_send_lanes DROP COLUMN bulk_paused_at, DROP COLUMN
-- undelivered_since; ALTER TABLE public.workspaces DROP COLUMN send_contact_caps, DROP COLUMN send_lane_alert.

-- ------------------------------------------------------------
-- 1. El carril del número
-- ------------------------------------------------------------
ALTER TABLE public.channel_send_lanes ADD COLUMN IF NOT EXISTS bulk_paused_at timestamptz NULL;
ALTER TABLE public.channel_send_lanes ADD COLUMN IF NOT EXISTS undelivered_since timestamptz NULL;

COMMENT ON COLUMN public.channel_send_lanes.bulk_paused_at IS
  'Lo masivo de la cola de WhatsApp de este número está pausado (lo urgente y lo normal siguen). 00420.';
COMMENT ON COLUMN public.channel_send_lanes.undelivered_since IS
  'Desde cuándo el número podía mandar, tenía pendientes en la cola y no entregó ninguno. null = entregando o en espera legítima (horario, cupo). 00420.';

-- ------------------------------------------------------------
-- 2. La cola
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.send_queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  flow_id uuid NULL REFERENCES public.flows(id) ON DELETE SET NULL,
  flow_session_id uuid NULL REFERENCES public.flow_sessions(id) ON DELETE SET NULL,
  node_id text NULL,
  target_kind text NOT NULL,
  conversation_id uuid NULL REFERENCES public.conversations(id) ON DELETE SET NULL,
  whatsapp_group_id uuid NULL REFERENCES public.whatsapp_groups(id) ON DELETE SET NULL,
  to_number text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview text NULL,
  client_label text NULL,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'queued',
  reason_code text NULL,
  reason text NULL,
  anchor_at timestamptz NULL,
  schedule jsonb NULL,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NULL,
  claimed_at timestamptz NULL,
  error_kind text NULL,
  sent_at timestamptz NULL,
  platform_message_id text NULL,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.send_queue_items IS
  'Cola de WhatsApp de las automatizaciones: un envío por fila, con prioridad, caducidad, estado y motivo. Escribe solo el servidor. 00420.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'send_queue_items_status_check' AND conrelid = 'public.send_queue_items'::regclass) THEN
    ALTER TABLE public.send_queue_items ADD CONSTRAINT send_queue_items_status_check
      CHECK (status IN ('scheduled', 'queued', 'sending', 'sent', 'failed', 'overdue', 'expired', 'discarded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'send_queue_items_priority_check' AND conrelid = 'public.send_queue_items'::regclass) THEN
    ALTER TABLE public.send_queue_items ADD CONSTRAINT send_queue_items_priority_check
      CHECK (priority IN ('urgent', 'normal', 'bulk'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'send_queue_items_target_check' AND conrelid = 'public.send_queue_items'::regclass) THEN
    ALTER TABLE public.send_queue_items ADD CONSTRAINT send_queue_items_target_check
      CHECK (
        (target_kind = 'conversation' AND conversation_id IS NOT NULL)
        OR (target_kind = 'group' AND whatsapp_group_id IS NOT NULL)
        OR (target_kind = 'number' AND to_number IS NOT NULL AND length(to_number) BETWEEN 5 AND 64)
        -- La conversación o el grupo pueden desaparecer después (ON DELETE SET NULL): lo que ya terminó no se rompe.
        OR (status IN ('sent', 'failed', 'overdue', 'expired', 'discarded') AND target_kind IN ('conversation', 'group', 'number'))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'send_queue_items_error_kind_check' AND conrelid = 'public.send_queue_items'::regclass) THEN
    ALTER TABLE public.send_queue_items ADD CONSTRAINT send_queue_items_error_kind_check
      CHECK (error_kind IS NULL OR error_kind IN ('transport', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'send_queue_items_shape_check' AND conrelid = 'public.send_queue_items'::regclass) THEN
    ALTER TABLE public.send_queue_items ADD CONSTRAINT send_queue_items_shape_check
      CHECK (
        jsonb_typeof(payload) = 'object'
        AND attempts >= 0 AND attempts <= 10
        AND length(dedupe_key) BETWEEN 1 AND 500
        AND (reason IS NULL OR length(reason) <= 500)
        AND (reason_code IS NULL OR length(reason_code) <= 40)
        AND (preview IS NULL OR length(preview) <= 300)
        AND (client_label IS NULL OR length(client_label) <= 200)
        AND (schedule IS NULL OR jsonb_typeof(schedule) = 'object')
      );
  END IF;
END $$;

-- Un envío por automatización, paso, ejecución y destino (y, programado, por su ancla), en todos los estados.
CREATE UNIQUE INDEX IF NOT EXISTS uq_send_queue_items_dedupe ON public.send_queue_items (workspace_id, dedupe_key);
-- Lo que el despachador busca: lo abierto de un número, por prioridad y hora prevista.
CREATE INDEX IF NOT EXISTS idx_send_queue_items_open
  ON public.send_queue_items (channel_id, status, priority, scheduled_for)
  WHERE status IN ('scheduled', 'queued');
CREATE INDEX IF NOT EXISTS idx_send_queue_items_due
  ON public.send_queue_items (scheduled_for)
  WHERE status IN ('scheduled', 'queued');
CREATE INDEX IF NOT EXISTS idx_send_queue_items_expiry
  ON public.send_queue_items (expires_at)
  WHERE status IN ('scheduled', 'queued') AND expires_at IS NOT NULL;
-- El cupo del número: lo que salió a un número suelto, y lo que está saliendo.
CREATE INDEX IF NOT EXISTS idx_send_queue_items_channel_sent
  ON public.send_queue_items (channel_id, sent_at)
  WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_send_queue_items_sending
  ON public.send_queue_items (claimed_at)
  WHERE status = 'sending';
-- El tope por contacto y día.
CREATE INDEX IF NOT EXISTS idx_send_queue_items_conv_sent
  ON public.send_queue_items (conversation_id, sent_at)
  WHERE status IN ('sent', 'sending') AND conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_send_queue_items_group_sent
  ON public.send_queue_items (whatsapp_group_id, sent_at)
  WHERE status IN ('sent', 'sending') AND whatsapp_group_id IS NOT NULL;
-- La pantalla, el límite por ejecución y «Aplicar a los envíos programados».
CREATE INDEX IF NOT EXISTS idx_send_queue_items_ws_status ON public.send_queue_items (workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_send_queue_items_flow ON public.send_queue_items (flow_id, channel_id, scheduled_for);

ALTER TABLE public.send_queue_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.send_queue_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.send_queue_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.send_queue_items TO service_role;

DROP POLICY IF EXISTS send_queue_items_select ON public.send_queue_items;
CREATE POLICY send_queue_items_select ON public.send_queue_items
  FOR SELECT USING ((select public.has_permission(workspace_id, 'channels.manage')));

-- ------------------------------------------------------------
-- 3. Ajustes del negocio
-- ------------------------------------------------------------
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS send_contact_caps jsonb NULL;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS send_lane_alert jsonb NULL;

COMMENT ON COLUMN public.workspaces.send_contact_caps IS
  'Tope de WhatsApp automáticos (por la cola) al día por contacto y por grupo: {enabled, perContactDay, perGroupDay, urgentCounts}. null = apagado (decisión del 18/11/2026). 00420.';
COMMENT ON COLUMN public.workspaces.send_lane_alert IS
  'Alerta de un número que deja de entregar: {stalledMinutes}. null = 30 minutos con pendientes sin entregar ninguno. 00420.';

-- ------------------------------------------------------------
-- 4. Funciones del despachador (solo service_role)
-- ------------------------------------------------------------

-- Tomar el turno del carril con un reloj dado (como `claim_lane_slot`, 00285, pero con `p_now`: la cola se prueba con un
-- reloj simulado). Gana UNO: el que corre `next_send_at` mientras todavía estaba vencido.
CREATE OR REPLACE FUNCTION public.claim_lane_slot_at(p_channel_id uuid, p_now timestamptz, p_next timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.channel_send_lanes
  SET next_send_at = p_next, updated_at = now()
  WHERE channel_id = p_channel_id
    AND next_send_at <= p_now
    AND paused_at IS NULL
  RETURNING true INTO v_ok;
  RETURN coalesce(v_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_lane_slot_at(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lane_slot_at(uuid, timestamptz, timestamptz) TO service_role;

-- El próximo envío listo de un número (queued -> sending): urgente, normal y masivo, en ese orden; dentro de cada uno, el
-- que tenía la hora prevista antes. `p_priorities` dice cuáles pueden salir ahora (la reserva y la pausa de lo masivo las
-- decide el despachador).
CREATE OR REPLACE FUNCTION public.claim_send_queue_item(p_channel_id uuid, p_now timestamptz, p_priorities text[])
RETURNS SETOF public.send_queue_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.send_queue_items q
  SET status = 'sending', claimed_at = p_now, updated_at = now()
  WHERE q.id = (
    SELECT x.id FROM public.send_queue_items x
    WHERE x.channel_id = p_channel_id
      AND x.status = 'queued'
      AND x.scheduled_for <= p_now
      AND (x.next_attempt_at IS NULL OR x.next_attempt_at <= p_now)
      AND (x.expires_at IS NULL OR x.expires_at > p_now)
      AND x.priority = ANY (p_priorities)
    ORDER BY CASE x.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, x.scheduled_for, x.created_at, x.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_send_queue_item(uuid, timestamptz, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_send_queue_item(uuid, timestamptz, text[]) TO service_role;

-- Los programados cuya hora llegó pasan a la cola. Devuelve cuántos.
CREATE OR REPLACE FUNCTION public.release_scheduled_send_queue_items(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.send_queue_items
  SET status = 'queued', updated_at = now()
  WHERE status = 'scheduled' AND scheduled_for <= p_now;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.release_scheduled_send_queue_items(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_scheduled_send_queue_items(timestamptz) TO service_role;

-- Lo que pasó su caducidad sin salir queda caducado, con su motivo, y no se envía. Devuelve cuántos.
CREATE OR REPLACE FUNCTION public.expire_send_queue_items(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.send_queue_items
  SET status = 'expired',
      reason_code = 'expired',
      reason = 'No salió antes de su caducidad: no se envió.',
      updated_at = now()
  WHERE status IN ('scheduled', 'queued')
    AND expires_at IS NOT NULL
    AND expires_at <= p_now;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_send_queue_items(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_send_queue_items(timestamptz) TO service_role;

-- Para contar rápido lo que sale por los grupos de un número.
CREATE INDEX IF NOT EXISTS idx_wa_group_messages_out_sent
  ON public.whatsapp_group_messages (group_id, created_at)
  WHERE direction = 'outbound' AND status = 'sent';

-- El cupo usado de un número: lo que salió (o está saliendo) en el último minuto, la última hora y el día del negocio.
-- Cuenta TODO lo que sale por el número, porque el bloqueo lo sufre el número (decisión del 18/11/2026):
--   - los broadcasts (`broadcast_recipients`);
--   - la cola: lo que está saliendo ahora y lo que salió a un número suelto (eso no deja mensaje en una conversación);
--   - cada mensaje saliente de las conversaciones del número, menos los de broadcasts (ya contados): lo que escribe el
--     equipo, el celular, el agente, las secuencias y las automatizaciones (también lo que entregó la cola);
--   - lo que sale a los grupos del número.
-- Lo fallido y lo pendiente no cuenta.
CREATE OR REPLACE FUNCTION public.send_lane_counts(p_channel_id uuid, p_day_start timestamptz, p_now timestamptz)
RETURNS TABLE (last_minute integer, last_hour integer, today integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH ch AS (
    SELECT c.workspace_id, least(p_day_start, p_now - interval '1 hour') AS since
    FROM public.channels c
    WHERE c.id = p_channel_id
  ),
  out_rows AS (
    SELECT coalesce(r.sent_at, r.claimed_at) AS at
    FROM public.broadcast_recipients r, ch
    WHERE r.channel_id = p_channel_id
      AND ((r.status = 'sent' AND r.sent_at >= ch.since) OR (r.status = 'sending' AND r.claimed_at >= ch.since))
    UNION ALL
    SELECT coalesce(q.sent_at, q.claimed_at) AS at
    FROM public.send_queue_items q, ch
    WHERE q.channel_id = p_channel_id
      AND ((q.status = 'sent' AND q.target_kind = 'number' AND q.sent_at >= ch.since)
        OR (q.status = 'sending' AND q.claimed_at >= ch.since))
    UNION ALL
    SELECT m.created_at AS at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    CROSS JOIN ch
    WHERE m.workspace_id = ch.workspace_id
      AND m.direction = 'outbound'
      AND m.created_at >= ch.since
      AND c.channel_id = p_channel_id
      AND coalesce(m.origin, '') <> 'broadcast'
      AND coalesce(m.status, 'sent') NOT IN ('failed', 'pending')
    UNION ALL
    SELECT g.created_at AS at
    FROM public.whatsapp_group_messages g
    JOIN public.whatsapp_groups wg ON wg.id = g.group_id
    CROSS JOIN ch
    WHERE wg.channel_id = p_channel_id
      AND g.direction = 'outbound'
      AND g.status = 'sent'
      AND g.created_at >= ch.since
  )
  SELECT
    (count(*) FILTER (WHERE at > p_now - interval '1 minute' AND at <= p_now))::integer,
    (count(*) FILTER (WHERE at > p_now - interval '1 hour' AND at <= p_now))::integer,
    (count(*) FILTER (WHERE at >= p_day_start AND at <= p_now))::integer
  FROM out_rows;
$$;

REVOKE ALL ON FUNCTION public.send_lane_counts(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_lane_counts(uuid, timestamptz, timestamptz) TO service_role;

-- Vaciar la cola de un número: lo programado y lo que espera turno queda descartado con el motivo. Lo que está saliendo
-- en ese momento no se toca. Devuelve cuántos.
CREATE OR REPLACE FUNCTION public.empty_send_queue(p_workspace_id uuid, p_channel_id uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.send_queue_items
  SET status = 'discarded',
      reason_code = 'emptied',
      reason = left(coalesce(nullif(btrim(p_reason), ''), 'Se vació la cola del número.'), 500),
      updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND channel_id = p_channel_id
    AND status IN ('scheduled', 'queued');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.empty_send_queue(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.empty_send_queue(uuid, uuid, text) TO service_role;

-- Lo automático de la cola que ya salió hoy a un contacto (por sus conversaciones o por su número) o a un grupo, sumando
-- todas las automatizaciones y todos los números del negocio. Lo que sale al instante no pasa por la cola: no cuenta.
CREATE OR REPLACE FUNCTION public.send_contact_day_count(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_group_id uuid,
  p_phone text,
  p_day_start timestamptz,
  p_urgent_counts boolean,
  p_exclude uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::integer
  FROM public.send_queue_items q
  WHERE q.workspace_id = p_workspace_id
    AND q.id IS DISTINCT FROM p_exclude
    AND (p_urgent_counts OR q.priority <> 'urgent')
    AND ((q.status = 'sent' AND q.sent_at >= p_day_start) OR (q.status = 'sending' AND q.claimed_at >= p_day_start))
    AND (
      (p_group_id IS NOT NULL AND q.whatsapp_group_id = p_group_id)
      OR (p_group_id IS NULL AND p_contact_id IS NOT NULL AND q.conversation_id IN (
            SELECT c.id FROM public.conversations c WHERE c.contact_id = p_contact_id AND c.workspace_id = p_workspace_id))
      OR (p_group_id IS NULL AND p_phone IS NOT NULL AND p_phone <> ''
            AND q.target_kind = 'number'
            AND regexp_replace(coalesce(q.to_number, ''), '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g'))
    );
$$;

REVOKE ALL ON FUNCTION public.send_contact_day_count(uuid, uuid, uuid, text, timestamptz, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_contact_day_count(uuid, uuid, uuid, text, timestamptz, boolean, uuid) TO service_role;
