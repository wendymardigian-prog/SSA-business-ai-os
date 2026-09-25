-- ============================================================================
-- 00071 — Metricas del modo borrador (Bloque 2c)
-- ============================================================================
-- Fase 3, Bloque 2c.
--
-- 1. ai_cost_report suma lo que cuestan los borradores: cuantos turnos
--    terminaron en borrador, cuanto se gasto en los que se descartaron (lo que
--    cuesta la desconfianza) y cuantos se enviaron sin editar (el dato que dice
--    cuando pasar a envio directo). Sigue siendo solo service role: son costos.
--
-- 2. draft_queue_metrics: la franja de la cola (tiempos de respuesta, ventanas
--    perdidas, aprobados sin editar). NO es de costos: es operacion, y la puede
--    pedir cualquiera del workspace. Por eso NO sigue el patron de
--    ai_cost_report (solo service role, con el workspace de parametro y la
--    garantia en TypeScript): se llama con el cliente del usuario y se defiende
--    sola, como match_knowledge_chunks_filtered (00062). Un Member siempre
--    recibe SUS numeros, pase el id que pase.
--
-- 3. draft_queue_metrics_by_person: el desglose por persona. Solo Owner/Admin,
--    chequeado adentro.
--
-- Los tres tiempos son tres cosas distintas y se calculan por separado:
--   - del agente:     completed_at - inbound_at. Incluye la espera de la
--                     rafaga (30 s de ventana + 8 de generacion = 38 s).
--   - de aprobacion:  responded_at - completed_at, SOLO sobre runs que dejaron
--                     borrador. Sobre todos, los de envio directo (~0) la
--                     hundirian y se leeria como una mejora que no existio.
--   - de respuesta:   responded_at - inbound_at. Lo unico que percibe el lead,
--                     contado desde su ULTIMO mensaje.
--
-- De quien es un borrador: del setter del contacto; sin setter, del vendedor;
-- sin ninguno, "sin asignar". Se resuelve por join, no hay campo en el
-- borrador (una reasignacion lo moveria sin desincronizar nada).
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. ai_cost_report con los borradores
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_cost_report(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH r AS (
    SELECT *
    FROM public.agent_runs
    WHERE workspace_id = p_workspace_id
      AND created_at >= p_from
      AND created_at < p_to
      AND status <> 'running'
  ),
  rd AS (
    SELECT r.id, r.cost_usd, d.status AS draft_status, d.body, d.sent_body
    FROM r
    JOIN public.agent_drafts d ON d.run_id = r.id
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'runs',             count(*),
        'cost_usd',         COALESCE(sum(cost_usd), 0),
        'conversations',    count(DISTINCT conversation_id),
        'escalations',      count(*) FILTER (WHERE status = 'escalated'),
        'responded',        count(*) FILTER (WHERE status = 'responded'),
        'drafted',          count(*) FILTER (WHERE status = 'drafted'),
        'missing_pricing',  count(*) FILTER (WHERE cost_usd IS NULL AND (COALESCE(input_tokens, 0) > 0 OR COALESCE(embedding_tokens, 0) > 0)),
        'input_tokens',     COALESCE(sum(input_tokens), 0),
        'output_tokens',    COALESCE(sum(output_tokens), 0),
        'cached_tokens',    COALESCE(sum(cached_tokens), 0),
        'embedding_tokens', COALESCE(sum(embedding_tokens), 0)
      )
      FROM r
    ),
    'drafts', (
      SELECT jsonb_build_object(
        'discarded',          count(*) FILTER (WHERE draft_status = 'discarded'),
        'discarded_cost_usd', COALESCE(sum(cost_usd) FILTER (WHERE draft_status = 'discarded'), 0),
        'sent',               count(*) FILTER (WHERE draft_status = 'sent'),
        'sent_unedited',      count(*) FILTER (WHERE draft_status = 'sent' AND sent_body = body)
      )
      FROM rd
    ),
    'by_source', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('source', source, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (SELECT source, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c FROM r GROUP BY source) s
    ),
    'by_agent', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('agent_id', agent_id, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (SELECT agent_id, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c FROM r GROUP BY agent_id) a
    ),
    'by_model', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'provider', provider, 'model', model, 'runs', n, 'cost_usd', c,
        'input_tokens', i, 'output_tokens', o, 'missing_pricing', m
      ) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (
        SELECT provider, model, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c,
               COALESCE(sum(input_tokens), 0) AS i, COALESCE(sum(output_tokens), 0) AS o,
               count(*) FILTER (WHERE cost_usd IS NULL AND COALESCE(input_tokens, 0) > 0) AS m
        FROM r
        WHERE model IS NOT NULL
        GROUP BY provider, model
      ) mo
    ),
    'top_conversations', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('conversation_id', conversation_id, 'contact_id', contact_id, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (
        SELECT conversation_id, max(contact_id::text)::uuid AS contact_id, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c
        FROM r
        WHERE conversation_id IS NOT NULL
        GROUP BY conversation_id
        ORDER BY c DESC, n DESC
        LIMIT 10
      ) t
    )
  );
$$;

COMMENT ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) IS
  'Agregados de costo de IA de un periodo para la pestana Costos: totales, borradores (descartados y su gasto, enviados sin editar), por fuente, por agente, por modelo y top 10 de conversaciones. Solo service role.';

REVOKE ALL ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) TO service_role;

-- ------------------------------------------------------------
-- 2. draft_queue_metrics
-- ------------------------------------------------------------
-- p_user_id: solo lo respeta un Owner/Admin (NULL = el equipo, un id = esa
-- persona). Para un Member se reemplaza por auth.uid() sin mirar lo que vino:
-- pedir los numeros de otro rebota en la base, no en un if de la pantalla.
--
-- "De una persona" quiere decir:
--   - tiempos de respuesta y del agente: runs sobre contactos que son suyos;
--   - aprobacion, enviados, sin editar y descartados: lo que decidio ella;
--   - ventanas perdidas: las que se perdieron mientras el borrador era suyo.

CREATE OR REPLACE FUNCTION public.draft_queue_metrics(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_user_id      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_result jsonb;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;
  IF NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this workspace';
  END IF;

  IF public.is_workspace_admin(p_workspace_id) THEN
    v_user := p_user_id;
  ELSE
    v_user := auth.uid();
  END IF;

  WITH runs AS (
    SELECT r.id, r.status, r.inbound_at, r.completed_at, r.responded_at
    FROM public.agent_runs r
    LEFT JOIN public.contacts c ON c.id = r.contact_id
    WHERE r.workspace_id = p_workspace_id
      AND r.source = 'agent'
      AND r.inbound_at IS NOT NULL
      AND (v_user IS NULL OR COALESCE(c.setter_id, c.vendedor_id) = v_user)
  ),
  decided AS (
    SELECT d.*, r.completed_at AS run_completed_at, r.responded_at AS run_responded_at
    FROM public.agent_drafts d
    LEFT JOIN public.agent_runs r ON r.id = d.run_id
    WHERE d.workspace_id = p_workspace_id
      AND d.decided_at >= p_from AND d.decided_at < p_to
      AND (v_user IS NULL OR d.decided_by = v_user)
  )
  SELECT jsonb_build_object(
    'response_median_s', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM responded_at - inbound_at))
      FROM runs
      WHERE responded_at >= p_from AND responded_at < p_to
    ),
    'agent_median_s', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - inbound_at))
      FROM runs
      WHERE status IN ('responded', 'drafted')
        AND completed_at >= p_from AND completed_at < p_to
    ),
    -- Solo borradores enviados: sobre todos los runs, los de envio directo
    -- (~0 s) hundirian la mediana.
    'approval_median_s', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM run_responded_at - run_completed_at))
      FROM decided
      WHERE status = 'sent' AND run_responded_at IS NOT NULL AND run_completed_at IS NOT NULL
    ),
    'sent',          (SELECT count(*) FROM decided WHERE status = 'sent'),
    'sent_unedited', (SELECT count(*) FROM decided WHERE status = 'sent' AND sent_body = body),
    -- Descartar a proposito es una decision; los descartes automaticos (una
    -- respuesta a mano, un cierre) llevan el prefijo auto: y no cuentan.
    'discarded',     (SELECT count(*) FROM decided WHERE status = 'discarded' AND COALESCE(discard_reason, '') NOT LIKE 'auto:%'),
    'windows_missed', (
      SELECT count(*)
      FROM public.agent_drafts d
      WHERE d.workspace_id = p_workspace_id
        AND d.window_missed_at >= p_from AND d.window_missed_at < p_to
        AND (v_user IS NULL OR d.missed_while_assigned_to = v_user)
    ),
    'scope', CASE WHEN v_user IS NULL THEN 'team' ELSE 'person' END
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.draft_queue_metrics(uuid, timestamptz, timestamptz, uuid) IS
  'Franja de la cola de borradores: medianas de respuesta, del agente y de aprobacion, enviados, sin editar, descartados y ventanas perdidas de un periodo. Se defiende sola: exige ser miembro, y a un Member le devuelve siempre sus numeros.';

REVOKE ALL ON FUNCTION public.draft_queue_metrics(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_queue_metrics(uuid, timestamptz, timestamptz, uuid) TO authenticated;

-- ------------------------------------------------------------
-- 3. draft_queue_metrics_by_person (Owner/Admin)
-- ------------------------------------------------------------
-- Una fila por persona que decidio algo o perdio una ventana en el periodo,
-- mas la fila "sin asignar" (user_id NULL) para las ventanas perdidas de
-- borradores que no eran de nadie.

CREATE OR REPLACE FUNCTION public.draft_queue_metrics_by_person(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;
  IF NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: only workspace owners and admins';
  END IF;

  WITH decided AS (
    SELECT d.decided_by AS user_id, d.status, d.body, d.sent_body, d.discard_reason,
           r.completed_at, r.responded_at
    FROM public.agent_drafts d
    LEFT JOIN public.agent_runs r ON r.id = d.run_id
    WHERE d.workspace_id = p_workspace_id
      AND d.decided_by IS NOT NULL
      AND d.decided_at >= p_from AND d.decided_at < p_to
  ),
  per_decider AS (
    SELECT user_id,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM responded_at - completed_at))
        FILTER (WHERE status = 'sent' AND responded_at IS NOT NULL AND completed_at IS NOT NULL) AS approval_median_s,
      count(*) FILTER (WHERE status = 'sent') AS sent,
      count(*) FILTER (WHERE status = 'sent' AND sent_body = body) AS sent_unedited,
      count(*) FILTER (WHERE status = 'discarded' AND COALESCE(discard_reason, '') NOT LIKE 'auto:%') AS discarded
    FROM decided
    GROUP BY user_id
  ),
  per_missed AS (
    SELECT d.missed_while_assigned_to AS user_id, count(*) AS windows_missed
    FROM public.agent_drafts d
    WHERE d.workspace_id = p_workspace_id
      AND d.window_missed_at >= p_from AND d.window_missed_at < p_to
    GROUP BY d.missed_while_assigned_to
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',           u.user_id,
    'approval_median_s', pd.approval_median_s,
    'sent',              COALESCE(pd.sent, 0),
    'sent_unedited',     COALESCE(pd.sent_unedited, 0),
    'discarded',         COALESCE(pd.discarded, 0),
    'windows_missed',    COALESCE(pm.windows_missed, 0)
  ) ORDER BY u.user_id NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT user_id FROM per_decider
    UNION
    SELECT user_id FROM per_missed
  ) u
  LEFT JOIN per_decider pd ON pd.user_id IS NOT DISTINCT FROM u.user_id
  LEFT JOIN per_missed pm ON pm.user_id IS NOT DISTINCT FROM u.user_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.draft_queue_metrics_by_person(uuid, timestamptz, timestamptz) IS
  'Desglose por persona de la cola de borradores (mediana de aprobacion, enviados, sin editar, descartados, ventanas perdidas). Solo Owner/Admin, chequeado adentro.';

REVOKE ALL ON FUNCTION public.draft_queue_metrics_by_person(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_queue_metrics_by_person(uuid, timestamptz, timestamptz) TO authenticated;
