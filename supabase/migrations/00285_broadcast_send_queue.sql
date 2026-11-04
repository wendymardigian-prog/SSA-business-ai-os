-- ============================================================
-- 00285_broadcast_send_queue.sql
--
-- Broadcasts con canal, audiencia de Contactos, variantes y una COLA DE ENVIOS
-- con ritmo por numero (docs/broadcasts.md).
--
-- Hasta hoy un broadcast no tenia canal (el envio tomaba "el primero" de cada
-- contacto y mandaba siempre por Zernio), la audiencia era un filtro propio con
-- un bug (buscaba la etiqueta por nombre y guardaba el id) y no habia ritmo: 20
-- mensajes por minuto fijos, sin pasar por el tope del canal.
--
-- Esta migracion es ADITIVA y va ANTES de desplegar el codigo:
--
-- 1. `broadcasts` suma el canal, la audiencia (los MISMOS parametros de URL de
--    la lista de Contactos), las variantes del mensaje, el asunto de un email,
--    el ritmo propio y las marcas de pausa/cancelacion. `status` suma `paused`.
-- 2. `broadcast_recipients` son los items de la cola: el destino, la variante,
--    el motivo de un salteado, los reintentos y la conversacion. Un contacto
--    una sola vez por broadcast (indice unico).
-- 3. `channels.send_policy`: el techo de ritmo del numero (null = el de siempre,
--    `DEFAULT_WHATSAPP_POLICY` en lib/send-queue/pace.ts).
-- 4. `channel_send_lanes`: el "carril" de cada canal. `next_send_at` es cuando
--    puede salir el proximo mensaje; `claim_lane_slot` lo toma y lo corre en
--    UNA sentencia, asi dos despachadores a la vez mandan uno solo.
-- 5. RLS: leer pide `broadcasts.manage` (antes alcanzaba con ser miembro, y un
--    Member escribia la tabla directo aunque la pantalla se lo negaba, M6).
--    Escribir, solo el servidor (Server Actions con el cliente de servicio
--    despues del permiso, y el despachador).
--
-- Politicas viejas (00002 y 00009), para volver atras:
--   create policy "Users can view broadcasts in their workspaces" on broadcasts for select
--     using (is_workspace_member(workspace_id));
--   create policy "Users can manage broadcasts in their workspaces" on broadcasts for all
--     using (is_workspace_member(workspace_id));
--   create policy "Users can view broadcast recipients" on broadcast_recipients for select
--     using (exists (select 1 from broadcasts b where b.id = broadcast_recipients.broadcast_id
--       and is_workspace_member(b.workspace_id)));
--   CREATE POLICY "Users can insert broadcast recipients" ON broadcast_recipients FOR INSERT
--     WITH CHECK (EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id
--       AND is_workspace_member(b.workspace_id)));
--   CREATE POLICY "Users can update broadcast recipients" ON broadcast_recipients FOR UPDATE
--     USING (EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id
--       AND is_workspace_member(b.workspace_id)));
--
-- CHECK viejo de broadcasts.status (00001):
--   check (status in ('draft', 'scheduled', 'sending', 'completed', 'cancelled'))
--
-- Los jobs `send_broadcast` del sistema viejo que quedaran pendientes se
-- cancelan: el runner ya no los conoce (y nunca mandaban por WhatsApp ni email).
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. broadcasts
-- ------------------------------------------------------------
ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audience_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS include_phone_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS message_variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS email_subject text,
  ADD COLUMN IF NOT EXISTS skip_missing_variables boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pace jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS skipped integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_status_check' AND conrelid = 'public.broadcasts'::regclass) THEN
    ALTER TABLE public.broadcasts DROP CONSTRAINT broadcasts_status_check;
  END IF;
  ALTER TABLE public.broadcasts ADD CONSTRAINT broadcasts_status_check
    CHECK (status IN ('draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_variants_array' AND conrelid = 'public.broadcasts'::regclass) THEN
    ALTER TABLE public.broadcasts ADD CONSTRAINT broadcasts_variants_array
      CHECK (jsonb_typeof(message_variants) = 'array' AND jsonb_array_length(message_variants) <= 5);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_broadcasts_active
  ON public.broadcasts (channel_id, created_at)
  WHERE status IN ('scheduled', 'sending');

-- ------------------------------------------------------------
-- 2. broadcast_recipients (los items de la cola)
-- ------------------------------------------------------------
ALTER TABLE public.broadcast_recipients
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS target text,
  ADD COLUMN IF NOT EXISTS variant_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE public.broadcast_recipients r
SET workspace_id = b.workspace_id
FROM public.broadcasts b
WHERE b.id = r.broadcast_id AND r.workspace_id IS NULL;

DO $$
BEGIN
  -- Un estado sin CHECK desde la 00001; lo viejo ('pending', 'sending', 'sent', 'failed') entra.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcast_recipients_status_check') THEN
    ALTER TABLE public.broadcast_recipients ADD CONSTRAINT broadcast_recipients_status_check
      CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled'));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.broadcast_recipients
    GROUP BY broadcast_id, contact_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay contactos repetidos dentro de un mismo broadcast: revisarlos antes de crear el indice unico.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_recipients_contact
  ON public.broadcast_recipients (broadcast_id, contact_id);

-- El proximo de un broadcast (el despachador lo pide por broadcast).
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_pending
  ON public.broadcast_recipients (broadcast_id, next_attempt_at, id)
  WHERE status = 'pending';

-- Los topes por minuto, hora y dia de un canal cuentan lo que salio (o esta saliendo).
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_channel_sent
  ON public.broadcast_recipients (channel_id, sent_at)
  WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_sending
  ON public.broadcast_recipients (claimed_at)
  WHERE status = 'sending';

-- ------------------------------------------------------------
-- 3. El techo de ritmo de cada numero
-- ------------------------------------------------------------
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS send_policy jsonb;

-- ------------------------------------------------------------
-- 4. El carril de cada canal
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channel_send_lanes (
  channel_id uuid PRIMARY KEY REFERENCES public.channels(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  next_send_at timestamptz NOT NULL DEFAULT now(),
  consecutive_failures integer NOT NULL DEFAULT 0,
  paused_at timestamptz,
  paused_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.channel_send_lanes ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.channel_send_lanes TO service_role;
GRANT SELECT ON TABLE public.channel_send_lanes TO authenticated;
REVOKE ALL ON TABLE public.channel_send_lanes FROM anon;

DROP POLICY IF EXISTS channel_send_lanes_select ON public.channel_send_lanes;
CREATE POLICY channel_send_lanes_select ON public.channel_send_lanes
  FOR SELECT USING ((select public.has_permission(workspace_id, 'broadcasts.manage')));

-- ------------------------------------------------------------
-- 5. RLS de broadcasts y destinatarios
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view broadcasts in their workspaces" ON public.broadcasts;
DROP POLICY IF EXISTS "Users can manage broadcasts in their workspaces" ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_select ON public.broadcasts;
CREATE POLICY broadcasts_select ON public.broadcasts
  FOR SELECT USING ((select public.has_permission(workspace_id, 'broadcasts.manage')));

DROP POLICY IF EXISTS "Users can view broadcast recipients" ON public.broadcast_recipients;
DROP POLICY IF EXISTS "Users can insert broadcast recipients" ON public.broadcast_recipients;
DROP POLICY IF EXISTS "Users can update broadcast recipients" ON public.broadcast_recipients;
DROP POLICY IF EXISTS broadcast_recipients_select ON public.broadcast_recipients;
CREATE POLICY broadcast_recipients_select ON public.broadcast_recipients
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.broadcasts b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND (select public.has_permission(b.workspace_id, 'broadcasts.manage'))
    )
  );

-- ------------------------------------------------------------
-- 6. Tomar un lugar en el carril
-- ------------------------------------------------------------
-- Gana UNO: el que logra correr `next_send_at` mientras todavia estaba vencido.
-- `p_next` lo calcula el despachador con el ritmo (lib/send-queue/pace.ts).
CREATE OR REPLACE FUNCTION public.claim_lane_slot(p_channel_id uuid, p_next timestamptz)
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
    AND next_send_at <= now()
    AND paused_at IS NULL
  RETURNING true INTO v_ok;
  RETURN coalesce(v_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_lane_slot(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lane_slot(uuid, timestamptz) TO service_role;

-- El proximo destinatario de un broadcast, reservado (pending -> sending).
CREATE OR REPLACE FUNCTION public.claim_broadcast_recipient(p_broadcast_id uuid)
RETURNS SETOF public.broadcast_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.broadcast_recipients r
  SET status = 'sending', claimed_at = now()
  WHERE r.id = (
    SELECT x.id FROM public.broadcast_recipients x
    WHERE x.broadcast_id = p_broadcast_id
      AND x.status = 'pending'
      AND (x.next_attempt_at IS NULL OR x.next_attempt_at <= now())
    ORDER BY x.next_attempt_at NULLS FIRST, x.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING r.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_broadcast_recipient(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_recipient(uuid) TO service_role;

-- Los contadores salen de los destinatarios (no se suman de a uno: un reintento
-- o una pausa no los desfasan). Si no queda nada por mandar, el broadcast termina.
CREATE OR REPLACE FUNCTION public.refresh_broadcast_counts(p_broadcast_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sent integer;
  v_failed integer;
  v_skipped integer;
  v_open integer;
  v_status text;
BEGIN
  SELECT
    count(*) FILTER (WHERE status = 'sent'),
    count(*) FILTER (WHERE status = 'failed'),
    count(*) FILTER (WHERE status = 'skipped'),
    count(*) FILTER (WHERE status IN ('pending', 'sending'))
  INTO v_sent, v_failed, v_skipped, v_open
  FROM public.broadcast_recipients
  WHERE broadcast_id = p_broadcast_id;

  UPDATE public.broadcasts
  SET sent = v_sent,
      delivered = v_sent,
      failed = v_failed,
      skipped = v_skipped,
      status = CASE WHEN v_open = 0 AND status = 'sending' THEN 'completed' ELSE status END,
      completed_at = CASE WHEN v_open = 0 AND status = 'sending' THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = p_broadcast_id
  RETURNING status INTO v_status;

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_broadcast_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_broadcast_counts(uuid) TO service_role;

-- ------------------------------------------------------------
-- 7. Los jobs del sistema viejo
-- ------------------------------------------------------------
UPDATE public.scheduled_jobs
SET status = 'failed', last_error = 'broadcast del sistema viejo: reemplazado por la cola de envios (00285)'
WHERE type = 'send_broadcast' AND status IN ('pending', 'processing');
