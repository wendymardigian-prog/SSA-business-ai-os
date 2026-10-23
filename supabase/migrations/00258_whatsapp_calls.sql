-- ============================================================
-- 00258_whatsapp_calls
-- ============================================================
-- Llamadas de WhatsApp en el chat (octubre 2026).
--
-- Evolution API (Baileys) NO puede hacer ni atender llamadas: su `offerCall`
-- esta comentado en el codigo de la 2.3.7 y devuelve un id falso. Lo que si
-- hace es avisar por webhook (evento CALL) cada vez que alguien llama: offer,
-- accept, reject, timeout, terminate. Con eso:
--   - la llamada queda en el hilo como una linea ("📞 Llamada de voz
--     perdida"), sin ser un mensaje (no alimenta al agente ni a los flujos);
--   - una perdida o rechazada suma un no leido y avisa al responsable.
--
-- No es la tabla `calls` (00145): esa es de Fathom (llamadas de venta
-- grabadas). Esta es solo el registro de las llamadas de WhatsApp.
--
-- `record_whatsapp_call` hace la transicion de estado en UNA sentencia
-- (INSERT ... ON CONFLICT ... DO UPDATE), asi dos eventos de la misma llamada
-- que llegan a la vez no se pisan, y devuelve si la llamada RECIEN quedo sin
-- atender (para avisar una sola vez). Transiciones:
--   (nueva)  offer/ringing -> ringing; accept -> answered; reject -> rejected;
--            timeout/terminate -> missed
--   ringing  accept -> answered; reject -> rejected; timeout/terminate -> missed
--   answered terminate -> answered (con ended_at); nada la saca de ahi
--   missed / rejected: finales
--
-- Sin `contact_id` a proposito: el contacto sale de la conversacion, y asi una
-- fusion de contactos (que muda las conversaciones) no necesita tocar esta
-- tabla (`merge_contacts` / CONTACT_MERGE_TABLES).
--
-- Escribe solo el servidor (el webhook, con el service role). La app lee con
-- la RLS: quien ve la conversacion ve sus llamadas.
--
-- Aditiva: se aplica ANTES de desplegar el codigo que la usa.
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.record_whatsapp_call(uuid, uuid, uuid, text, boolean, text, timestamptz);
--   DROP TABLE IF EXISTS public.whatsapp_calls;
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_calls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id       uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  platform_call_id text NOT NULL,
  is_video         boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'ringing',
  started_at       timestamptz NOT NULL DEFAULT now(),
  answered_at      timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_calls IS
  'Llamadas de WhatsApp recibidas (00258): lo que avisa Evolution por el evento CALL. Se ven en el hilo; no son mensajes. No confundir con calls (Fathom).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_calls_status_check') THEN
    ALTER TABLE public.whatsapp_calls ADD CONSTRAINT whatsapp_calls_status_check
      CHECK (status IN ('ringing', 'answered', 'missed', 'rejected'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_calls_channel_call
  ON public.whatsapp_calls (channel_id, platform_call_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_calls_conversation
  ON public.whatsapp_calls (conversation_id, started_at);

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_calls;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_calls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.whatsapp_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_calls_select" ON public.whatsapp_calls;
CREATE POLICY "whatsapp_calls_select" ON public.whatsapp_calls
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = whatsapp_calls.conversation_id
        AND public.can_see_conversation(c)
    )
  );

-- Sin policies de escritura: escribe el webhook con el service role.

REVOKE ALL ON public.whatsapp_calls FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_calls TO authenticated;
GRANT ALL ON public.whatsapp_calls TO service_role;

-- ------------------------------------------------------------
-- La transicion, atomica
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_whatsapp_call(
  p_workspace_id    uuid,
  p_channel_id      uuid,
  p_conversation_id uuid,
  p_call_id         text,
  p_is_video        boolean,
  p_event           text,
  p_at              timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_initial  text;
  v_previous text;
  v_row      public.whatsapp_calls%ROWTYPE;
BEGIN
  v_initial := CASE p_event
    WHEN 'accept' THEN 'answered'
    WHEN 'reject' THEN 'rejected'
    WHEN 'timeout' THEN 'missed'
    WHEN 'terminate' THEN 'missed'
    ELSE 'ringing'
  END;

  SELECT status INTO v_previous FROM public.whatsapp_calls
  WHERE channel_id = p_channel_id AND platform_call_id = p_call_id;

  INSERT INTO public.whatsapp_calls AS w (
    workspace_id, channel_id, conversation_id, platform_call_id, is_video, status, started_at,
    answered_at, ended_at
  ) VALUES (
    p_workspace_id, p_channel_id, p_conversation_id, p_call_id, coalesce(p_is_video, false), v_initial,
    coalesce(p_at, now()),
    CASE WHEN v_initial = 'answered' THEN coalesce(p_at, now()) END,
    CASE WHEN v_initial IN ('missed', 'rejected') THEN coalesce(p_at, now()) END
  )
  ON CONFLICT (channel_id, platform_call_id) DO UPDATE SET
    status = CASE
      WHEN w.status = 'ringing' AND p_event = 'accept' THEN 'answered'
      WHEN w.status = 'ringing' AND p_event = 'reject' THEN 'rejected'
      WHEN w.status = 'ringing' AND p_event IN ('timeout', 'terminate') THEN 'missed'
      ELSE w.status
    END,
    is_video = w.is_video OR coalesce(p_is_video, false),
    answered_at = CASE WHEN w.status = 'ringing' AND p_event = 'accept' THEN coalesce(p_at, now()) ELSE w.answered_at END,
    ended_at = CASE
      WHEN w.ended_at IS NOT NULL THEN w.ended_at
      WHEN p_event IN ('reject', 'timeout', 'terminate') AND w.status IN ('ringing', 'answered') THEN coalesce(p_at, now())
      ELSE w.ended_at
    END
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'previous', v_previous,
    'became_unanswered', v_row.status IN ('missed', 'rejected') AND coalesce(v_previous, 'ringing') = 'ringing'
  );
END;
$$;

COMMENT ON FUNCTION public.record_whatsapp_call(uuid, uuid, uuid, text, boolean, text, timestamptz) IS
  'Registra un evento CALL de Evolution (00258). Atomica; devuelve si la llamada recien quedo sin atender. Solo service_role.';

REVOKE ALL ON FUNCTION public.record_whatsapp_call(uuid, uuid, uuid, text, boolean, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_call(uuid, uuid, uuid, text, boolean, text, timestamptz) TO service_role;
