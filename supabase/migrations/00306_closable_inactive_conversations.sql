-- ============================================================================
-- 00306: las conversaciones que el barrido de inactividad puede cerrar, en UNA consulta
--
-- Por que. El barrido (`sweepInactiveConversations`, corre en cada tic del cron `jobs`,
-- cada minuto) tomaba las 50 conversaciones inactivas MAS VIEJAS y preguntaba a
-- `agent_runs`, una por una, si el agente habia participado. En produccion esas 50 eran
-- siempre las mismas (de septiembre, sin ninguna corrida del agente): se revisaban y se
-- descartaban cada minuto, o sea unos 3.000 pedidos por hora para nada, y las que si
-- se podian cerrar nunca llegaban a la lista. El cierre por inactividad no habia cerrado
-- ni una conversacion desde que existe.
--
-- Que hace. Devuelve solo lo que de verdad se puede cerrar, con las mismas condiciones
-- que antes pero decididas en la base:
--   - abierta, sin borrar, de uno de los canales del agente;
--   - inactiva desde antes de `p_inactive_before` (el agente la define en horas);
--   - con actividad desde `p_active_since`: el PISO DE FECHA. Lo anterior es backlog y no
--     se cierra solo (cerrarlo y resumirlo de golpe seria una rafaga de llamadas a la IA
--     y cientos de chats que cambian de estado en la bandeja del equipo);
--   - que una persona no haya apagado (`agent_enabled = false`) ni pausado el agente;
--   - donde el agente ya participo (al menos una corrida `source = 'agent'`);
--   - sin un borrador esperando que alguien lo apruebe (el borrador no mueve
--     `last_message_at`, y sin esto se cerraria la conversacion con la pregunta sin
--     responder).
-- Las dos primeras palancas por conversacion (`agent_enabled` y `agent_paused_until`)
-- repiten lo que decide `resolveAgentState`: si no estuvieran aca, una conversacion
-- apagada o pausada volveria a quedar primera de la lista y a trabarla, igual que antes.
-- `closing.ts` sigue llamando a `resolveAgentState` como red de seguridad.
--
-- Los tres estados vivos de un borrador son los de `LIVE_DRAFT_STATUSES`
-- (`lib/agent/drafts/types.ts`) y los del indice unico
-- `agent_drafts_one_open_per_conversation`.
--
-- SECURITY INVOKER y solo `service_role`: la llama el cron, que corre sin usuario.
-- Aditiva e idempotente. Va ANTES de desplegar el codigo que la usa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.closable_inactive_conversations(
  p_workspace_id uuid,
  p_channel_ids uuid[],
  p_inactive_before timestamptz,
  p_active_since timestamptz,
  p_now timestamptz DEFAULT now(),
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  channel_id uuid,
  agent_enabled boolean,
  agent_paused_until timestamptz,
  last_message_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.id, c.channel_id, c.agent_enabled, c.agent_paused_until, c.last_message_at
  FROM public.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.status = 'open'
    AND c.deleted_at IS NULL
    AND c.channel_id = ANY (p_channel_ids)
    AND c.last_message_at < p_inactive_before
    AND c.last_message_at >= p_active_since
    AND c.agent_enabled IS DISTINCT FROM false
    AND (c.agent_paused_until IS NULL OR c.agent_paused_until <= p_now)
    AND EXISTS (
      SELECT 1 FROM public.agent_runs r
      WHERE r.conversation_id = c.id AND r.source = 'agent'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.agent_drafts d
      WHERE d.conversation_id = c.id AND d.status IN ('pending', 'sending', 'failed')
    )
  ORDER BY c.last_message_at ASC
  LIMIT GREATEST(p_limit, 0)
$$;

REVOKE ALL ON FUNCTION public.closable_inactive_conversations(uuid, uuid[], timestamptz, timestamptz, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.closable_inactive_conversations(uuid, uuid[], timestamptz, timestamptz, timestamptz, integer) TO service_role;

COMMENT ON FUNCTION public.closable_inactive_conversations(uuid, uuid[], timestamptz, timestamptz, timestamptz, integer) IS
  'Conversaciones abiertas que el barrido de inactividad puede cerrar (00306). Solo service_role.';
