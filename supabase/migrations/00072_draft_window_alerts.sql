-- ============================================================================
-- 00072 — Avisos de ventana de los borradores (Bloque 2c)
-- ============================================================================
-- Fase 3, Bloque 2c. Un borrador pendiente no se autovence nunca, pero la
-- ventana de mensajeria de la plataforma si: pasado el plazo (24 h en
-- Instagram) ya no se le puede responder al lead. Este job avisa ANTES, a la
-- persona a la que le toca, cuando un borrador cruza la mitad, el cuarto y el
-- octavo de su ventana.
--
-- SE APLICA CUANDO LA COLA YA SE LLENO SOLA UN PAR DE DIAS: es lo unico del
-- modo borrador que le manda notificaciones a una persona, y conviene
-- enchufarlo sabiendo que volumen tiene la cola. Lo que no puede esperar (los
-- envios colgados y las ventanas perdidas) ya lo hace el barrido de la 00070.
--
-- Guardas, todas obligatorias:
--
--   1. AGREGADO, NO UNO POR BORRADOR. Una notificacion por persona y corte:
--      "3 borradores tuyos con menos de 6 h de ventana". Un lote de 40 no
--      produce 40 avisos.
--
--   2. POR DESTINATARIO, NO POR WORKSPACE. Cada persona recibe el conteo de
--      SUS borradores (el setter del contacto; sin setter, el vendedor). Los
--      sin asignar van a Owner/Admin en un aviso aparte (recipient_id NULL) y
--      con ese rotulo. Nadie con cero borradores en el corte recibe nada. Un
--      aviso de workspace le llegaria a cuatro personas por un borrador que no
--      es de ninguna, y todas asumirian que lo tiene otro: el problema que el
--      aviso viene a resolver.
--
--   3. SOLO LO NUEVO. Se ignoran los borradores creados antes de aplicar esta
--      migracion (private.system_config 'draft_alerts_since'), o la primera
--      corrida dispararia el historial entero de una vez.
--
--   4. IDEMPOTENTE. Cada corte se anota en agent_drafts.alerted_thresholds EN
--      LA MISMA TRANSACCION que la notificacion. Correr el job dos veces
--      seguidas no avisa dos veces. alerted_thresholds es por borrador y no por
--      persona: si el contacto se reasigna entre un corte y el siguiente, el
--      corte ya avisado no se repite.
--
--   5. NUNCA PARA ATRAS. Si entre dos corridas se cruzaron dos cortes (un
--      canal con ventana corta, donde el octavo es del orden de los 5 minutos
--      del job), se anotan todos y se avisa solo el mas profundo.
--
-- Los cortes son denominadores de la ventana del canal (2, 4, 8), nunca horas
-- fijas: con W = 24 son 12, 6 y 3 horas. Un canal sin ventana no avisa.
--
-- Idempotente.
-- ============================================================================

-- Desde cuando se avisa: el momento en que se aplica esta migracion. Volver a
-- correrla no lo mueve.
INSERT INTO private.system_config (key, value, description)
VALUES (
  'draft_alerts_since',
  now()::text,
  'Los avisos de ventana (00072) ignoran los borradores creados antes de esto, para que la primera corrida no dispare el historial.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION private.alert_draft_windows()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_since timestamptz;
  v_drafts integer := 0;
  v_notifications integer := 0;
BEGIN
  SELECT value::timestamptz INTO v_since FROM private.system_config WHERE key = 'draft_alerts_since';
  v_since := COALESCE(v_since, now());

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.draft_alerts (
    id uuid, workspace_id uuid, owner uuid, window_hours integer, new_cuts smallint[], deepest smallint
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.draft_alerts;

  -- Los borradores vivos con ventana abierta que cruzaron algun corte nuevo.
  -- FOR UPDATE: dos corridas superpuestas no avisan el mismo corte.
  INSERT INTO pg_temp.draft_alerts (id, workspace_id, owner, window_hours, new_cuts, deepest)
  SELECT x.id, x.workspace_id, x.owner, x.w, x.cuts, (SELECT max(t) FROM unnest(x.cuts) t)
  FROM (
    SELECT d.id, d.workspace_id, COALESCE(c.setter_id, c.vendedor_id) AS owner, w.w,
      ARRAY(
        SELECT t FROM unnest(ARRAY[2, 4, 8]::smallint[]) t
        WHERE (d.sendable_until - now()) <= make_interval(secs => w.w * 3600.0 / t)
          AND NOT (t = ANY (d.alerted_thresholds))
      ) AS cuts
    FROM public.agent_drafts d
    JOIN public.channels ch ON ch.id = d.channel_id
    JOIN public.contacts c ON c.id = d.contact_id
    CROSS JOIN LATERAL (SELECT public.messaging_window_hours(ch.platform, ch.messaging_window_hours) AS w) w
    WHERE d.status IN ('pending', 'failed')
      AND d.sendable_until IS NOT NULL
      AND d.sendable_until > now()
      AND d.created_at >= v_since
      AND w.w > 0
    FOR UPDATE OF d SKIP LOCKED
  ) x
  WHERE cardinality(x.cuts) > 0;

  -- Se anotan TODOS los cortes cruzados.
  UPDATE public.agent_drafts d
  SET alerted_thresholds = d.alerted_thresholds || a.new_cuts
  FROM pg_temp.draft_alerts a
  WHERE d.id = a.id;
  GET DIAGNOSTICS v_drafts = ROW_COUNT;

  -- Y se avisa solo el mas profundo, agrupado por persona, corte y ventana.
  INSERT INTO public.notifications (workspace_id, type, title, body, entity_type, entity_id, recipient_id, metadata)
  SELECT
    g.workspace_id,
    'draft_window',
    format(
      '%s borrador%s %s con menos de %s de ventana',
      g.n,
      CASE WHEN g.n = 1 THEN '' ELSE 'es' END,
      CASE WHEN g.owner IS NULL THEN 'sin asignar'
           WHEN g.n = 1 THEN 'tuyo' ELSE 'tuyos' END,
      CASE WHEN g.window_hours % g.deepest = 0 THEN (g.window_hours / g.deepest)::text || ' h'
           ELSE round(g.window_hours::numeric / g.deepest * 60)::text || ' min' END
    ),
    CASE WHEN g.owner IS NULL
      THEN 'Nadie los tiene asignados. Pasada la ventana, la plataforma ya no deja responder.'
      ELSE 'Pasada la ventana, la plataforma ya no deja responder: quedan para responder a mano.' END,
    'draft_queue',
    NULL,
    g.owner,
    jsonb_build_object('threshold', g.deepest, 'count', g.n, 'draft_ids', to_jsonb(g.ids), 'unassigned', g.owner IS NULL)
  FROM (
    SELECT workspace_id, owner, deepest, window_hours, count(*) AS n, array_agg(id) AS ids
    FROM pg_temp.draft_alerts
    GROUP BY workspace_id, owner, deepest, window_hours
  ) g;
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  RETURN jsonb_build_object('drafts', v_drafts, 'notifications', v_notifications);
END;
$$;

COMMENT ON FUNCTION private.alert_draft_windows() IS
  'Avisos de ventana de los borradores (00072): agregados por persona y corte (mitad, cuarto, octavo de la ventana del canal), idempotentes por agent_drafts.alerted_thresholds, solo para borradores creados despues de aplicar la migracion. Los sin asignar van a Owner/Admin.';

REVOKE ALL ON FUNCTION private.alert_draft_windows() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-draft-window-alerts') THEN
    PERFORM cron.unschedule('ssa-cron-draft-window-alerts');
  END IF;
END $$;

SELECT cron.schedule(
  'ssa-cron-draft-window-alerts',
  '*/5 * * * *',
  $$SELECT private.alert_draft_windows()$$
);
