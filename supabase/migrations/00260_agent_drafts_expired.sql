-- ============================================================================
-- 00260 — Borradores vencidos: un estado propio cuando la ventana se cierra
-- ============================================================================
-- Hasta acá, cuando la ventana de mensajería (24 h en Instagram) se cerraba con
-- un borrador del agente sin enviar, el barrido (private.sweep_agent_drafts,
-- 00070) solo anotaba window_missed_at y el borrador seguía "pendiente": la cola
-- y el aviso del dashboard decían "67 esperando aprobación" cuando 62 ya no se
-- podían enviar (23/10/2026).
--
-- Ahora el borrador pasa a 'expired'. NO es 'discarded': descartar es una
-- decisión de una persona, vencer no; las métricas los cuentan distinto (el
-- resultado "Ventana perdida" de chat_dashboard_drafts sale de window_missed_at,
-- que se sigue anotando igual).
--
-- Un vencido sale de la cola, del contador de pendientes y de los avisos (todo
-- eso mira 'pending'/'failed'), deja lugar a un borrador nuevo (el índice único
-- de borrador vivo no lo incluye) y la bandeja lo muestra como "no enviado, la
-- ventana venció", con el texto para copiarlo y mandarlo desde la app.
--
-- Definiciones anteriores, para volver atrás:
--
--   agent_drafts_status_values:
--     CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text,
--       'failed'::text, 'discarded'::text, 'superseded'::text, 'regenerated'::text])))
--
--   private.sweep_agent_drafts() y public.purge_agent_draft_content(integer):
--     las de la 00070, sin cambios desde entonces (md5 de pg_get_functiondef el
--     23/10/2026: 48f6f980a1c0ed6862c7b2be90a4a799 y 3623764d9c295355646a966bf53ce55e).
--     La única diferencia de las nuevas es 'expired' (el UPDATE nuevo del barrido
--     y la lista de estados terminados de la purga).
--
-- Para volver atrás: UPDATE agent_drafts SET status = 'pending', decided_at = NULL
-- WHERE status = 'expired'; y reponer las tres definiciones de arriba.
--
-- Idempotente.
-- ============================================================================

-- 1. El estado nuevo -----------------------------------------------------------
ALTER TABLE public.agent_drafts DROP CONSTRAINT IF EXISTS agent_drafts_status_values;
ALTER TABLE public.agent_drafts ADD CONSTRAINT agent_drafts_status_values
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'discarded', 'superseded', 'regenerated', 'expired'));

COMMENT ON COLUMN public.agent_drafts.window_missed_at IS
  'Cuando la ventana cerro con el borrador todavia sin enviar. Desde la 00260 el borrador pasa a expired en el mismo momento.';

-- 2. El barrido: además de anotar, vence --------------------------------------
CREATE OR REPLACE FUNCTION private.sweep_agent_drafts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_failed integer := 0;
  v_missed integer := 0;
BEGIN
  UPDATE public.agent_drafts
  SET status = 'failed',
      send_error = 'send_timeout'
  WHERE status = 'sending'
    AND updated_at < now() - interval '5 minutes';
  GET DIAGNOSTICS v_failed = ROW_COUNT;

  UPDATE public.agent_drafts d
  SET status = 'expired',
      decided_at = now(),
      window_missed_at = COALESCE(d.window_missed_at, now()),
      missed_while_assigned_to = COALESCE(d.missed_while_assigned_to, (
        SELECT COALESCE(c.setter_id, c.vendedor_id)
        FROM public.contacts c
        WHERE c.id = d.contact_id
      ))
  WHERE d.status IN ('pending', 'failed')
    AND d.sendable_until IS NOT NULL
    AND d.sendable_until < now();
  GET DIAGNOSTICS v_missed = ROW_COUNT;

  RETURN jsonb_build_object('sending_failed', v_failed, 'windows_missed', v_missed);
END;
$$;

COMMENT ON FUNCTION private.sweep_agent_drafts() IS
  'Barrido de borradores cada 5 minutos: envios colgados pasan a failed, y un borrador cuya ventana cerro sin enviarse pasa a expired (con window_missed_at y missed_while_assigned_to). 00260.';

REVOKE ALL ON FUNCTION private.sweep_agent_drafts() FROM PUBLIC, anon, authenticated;

-- 3. La purga de texto: un vencido es un borrador terminado --------------------
CREATE OR REPLACE FUNCTION public.purge_agent_draft_content(p_retention_months integer DEFAULT 12)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.agent_drafts
  SET body = NULL,
      body_parts = NULL,
      sent_body = CASE WHEN status = 'sent' THEN '' ELSE NULL END,
      no_reply_reason = COALESCE(no_reply_reason, 'purged')
  WHERE status IN ('sent', 'discarded', 'superseded', 'regenerated', 'expired')
    AND created_at < now() - make_interval(months => GREATEST(p_retention_months, 1))
    AND (body IS NOT NULL OR body_parts IS NOT NULL OR (sent_body IS NOT NULL AND sent_body <> ''));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 4. Los que ya vencieron ------------------------------------------------------
-- decided_at = cuando se perdió la ventana (si se anotó), no hoy: así un vencido
-- de hace dos semanas no aparece como "vencido hoy".
UPDATE public.agent_drafts d
SET status = 'expired',
    decided_at = COALESCE(d.window_missed_at, d.sendable_until, now()),
    window_missed_at = COALESCE(d.window_missed_at, d.sendable_until, now())
WHERE d.status IN ('pending', 'failed')
  AND d.sendable_until IS NOT NULL
  AND d.sendable_until < now();
