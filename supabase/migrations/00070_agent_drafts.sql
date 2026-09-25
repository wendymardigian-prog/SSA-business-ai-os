-- ============================================================================
-- 00070 — Modo borrador del agente (Bloque 2c)
-- ============================================================================
-- Fase 3, Bloque 2c. Cuando un canal esta en modo borrador, el turno del agente
-- termina guardando la respuesta en agent_drafts en vez de enviarla. Una
-- persona la revisa en la cola y decide: enviar, editar y enviar, regenerar o
-- descartar.
--
-- Por que una tabla aparte y no un mensaje con estado "borrador": una fila en
-- messages la contarian los dashboards como enviada, el contexto del agente la
-- leeria como algo que dijo, y extractBurst la tomaria como la salida que
-- cierra la rafaga (si despues se descarta, esos entrantes no se vuelven a
-- responder nunca).
--
--  1. agents.channel_modes: el modo por canal (send | draft). Sin entrada =
--     send, asi que esta migracion no cambia el comportamiento de nada.
--  2. agents.max_replies_per_conversation pasa a aceptar NULL = sin tope, y ese
--     es el default. La columna y el guardarrail quedan: volver a tener tope es
--     escribir un numero.
--  3. agent_runs: estado nuevo 'drafted', y los dos instantes que miden el
--     tiempo de respuesta en los dos modos (inbound_at, responded_at).
--  4. channels.messaging_window_hours: la ventana de mensajeria del canal.
--  5. contacts.ai_summary_updated_at: cuando se actualizo la memoria.
--  6. agent_drafts, con su RLS, indices y Realtime.
--  7. messaging_window_hours(): la misma regla que lib/messaging-window.ts.
--  8. El barrido de borradores cada 5 minutos (envios colgados y ventanas
--     perdidas) y la retencion de 12 meses del texto.
--  9. push_debounced_job con claves volatiles.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. agents.channel_modes
-- ------------------------------------------------------------

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS channel_modes jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.agents.channel_modes IS
  'Modo del agente por canal: { channel_id: "send" | "draft" }. Sin entrada = send (envia directo). En draft el turno deja un borrador en agent_drafts y no envia nada. Solo tiene sentido para canales que estan en enabled_channel_ids.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_channel_modes_object') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_channel_modes_object
      CHECK (jsonb_typeof(channel_modes) = 'object');
  END IF;
END $$;

-- Regla de la 00060: toda columna de agents que lea la pantalla va al GRANT.
GRANT SELECT (channel_modes) ON public.agents TO authenticated;

-- ------------------------------------------------------------
-- 2. Tope de respuestas por conversacion: vacio = sin tope
-- ------------------------------------------------------------
-- Lo que protegia contra un agente en loop ya lo cubren los topes de gasto y
-- la regla de escalamiento (N turnos sin resolver -> deriva).

ALTER TABLE public.agents ALTER COLUMN max_replies_per_conversation DROP NOT NULL;
ALTER TABLE public.agents ALTER COLUMN max_replies_per_conversation DROP DEFAULT;

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_windows_range;
ALTER TABLE public.agents ADD CONSTRAINT agents_windows_range
  CHECK (
    bundle_window_seconds BETWEEN 15 AND 3600
    AND (max_wait_seconds IS NULL OR max_wait_seconds >= bundle_window_seconds)
    AND (max_replies_per_conversation IS NULL OR max_replies_per_conversation BETWEEN 1 AND 500)
  );

-- Los agentes que todavia tienen el default viejo (12) nunca lo configuro
-- nadie: pasan a sin tope, que es el default nuevo. Un numero distinto de 12
-- lo puso una persona y se respeta.
UPDATE public.agents
SET max_replies_per_conversation = NULL
WHERE max_replies_per_conversation = 12;

COMMENT ON COLUMN public.agents.max_replies_per_conversation IS
  'Tope de respuestas del agente por conversacion desde la ultima intervencion humana. NULL = sin tope (default desde la 00070). El guardarrail solo actua con un numero cargado.';

-- ------------------------------------------------------------
-- 3. agent_runs: 'drafted' y los instantes de la respuesta
-- ------------------------------------------------------------

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_values;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_values
  CHECK (status IN ('running', 'responded', 'escalated', 'skipped_automation',
                    'skipped', 'blocked_guardrail', 'completed', 'error', 'drafted'));

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS responded_at timestamptz;

COMMENT ON COLUMN public.agent_runs.inbound_at IS
  'El ULTIMO mensaje entrante de la rafaga que responde este turno. Se congela al abrir el run. Existe en los dos modos, asi que permite comparar envio directo contra borrador con el mismo numero.';
COMMENT ON COLUMN public.agent_runs.responded_at IS
  'Cuando salio la respuesta de verdad. Envio directo: segundos despues del turno. Borrador: cuando alguien lo aprobo. NULL mientras no salio.';

CREATE INDEX IF NOT EXISTS idx_agent_runs_response_time
  ON public.agent_runs(workspace_id, inbound_at)
  WHERE responded_at IS NOT NULL;

GRANT SELECT (inbound_at, responded_at) ON public.agent_runs TO authenticated;

-- ------------------------------------------------------------
-- 4. channels.messaging_window_hours
-- ------------------------------------------------------------

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS messaging_window_hours integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channels_messaging_window_range') THEN
    ALTER TABLE public.channels ADD CONSTRAINT channels_messaging_window_range
      CHECK (messaging_window_hours IS NULL OR messaging_window_hours BETWEEN 0 AND 168);
  END IF;
END $$;

COMMENT ON COLUMN public.channels.messaging_window_hours IS
  'Horas desde el ultimo mensaje del lead en las que la plataforma deja responder. NULL = default por plataforma (Instagram y Facebook: 24, lo que documenta Meta; el resto: sin ventana). 0 = sin ventana (WhatsApp por Evolution).';

-- ------------------------------------------------------------
-- 5. contacts.ai_summary_updated_at
-- ------------------------------------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS ai_summary_updated_at timestamptz;

COMMENT ON COLUMN public.contacts.ai_summary_updated_at IS
  'Cuando se actualizo por ultima vez ai_conversation_summary (la memoria del agente). NULL en las memorias anteriores a la 00070.';

-- ------------------------------------------------------------
-- 6. agent_drafts
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_drafts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id                 uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  conversation_id          uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id               uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  channel_id               uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  run_id                   uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  status                   text NOT NULL DEFAULT 'pending',
  body                     text,
  body_parts               jsonb,
  no_reply_reason          text,
  suggested_actions        jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_actions          jsonb NOT NULL DEFAULT '[]'::jsonb,
  burst_message_ids        uuid[] NOT NULL DEFAULT '{}',
  burst_started_at         timestamptz,
  burst_last_inbound_at    timestamptz,
  sendable_until           timestamptz,
  alerted_thresholds       smallint[] NOT NULL DEFAULT '{}',
  window_missed_at         timestamptz,
  missed_while_assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_body                text,
  send_error               text,
  sent_message_id          uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  discard_reason           text,
  regenerate_instruction   text,
  previous_draft_id        uuid REFERENCES public.agent_drafts(id) ON DELETE SET NULL,
  decided_at               timestamptz,
  decided_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_drafts IS
  'Respuestas del agente que esperan aprobacion humana (modo borrador, Bloque 2c). No son mensajes: nada de aca se envia ni cuenta como salida hasta que una persona lo aprueba.';
COMMENT ON COLUMN public.agent_drafts.status IS
  'pending: espera decision. sending: saliendo en este instante (lo toma quien aprueba). sent: salio. failed: el envio fallo, se puede reintentar. discarded: alguien lo descarto, o hubo una respuesta real por otro lado. superseded: el lead escribio antes de que se aprobara. regenerated: alguien pidio otra version.';
COMMENT ON COLUMN public.agent_drafts.body IS
  'Texto propuesto. NULL = "necesita respuesta humana" (el agente sugirio derivar o lo freno un guardarrail); el motivo esta en no_reply_reason.';
COMMENT ON COLUMN public.agent_drafts.no_reply_reason IS
  'Por que no hay texto: escalate, guardrail:<cual> o error:<cual>.';
COMMENT ON COLUMN public.agent_drafts.suggested_actions IS
  'Acciones que el agente sugirio y NO ejecuto (derivar, pausarse). Se aplican si la persona aprueba.';
COMMENT ON COLUMN public.agent_drafts.applied_actions IS
  'Acciones que el agente YA aplico en ese turno (etiquetas, temperatura, seguimiento...), para mostrarlas en la cola. Se revierten desde la pestana Acciones.';
COMMENT ON COLUMN public.agent_drafts.burst_last_inbound_at IS
  'El ultimo mensaje del lead que responde. La ventana de mensajeria se cuenta desde aca.';
COMMENT ON COLUMN public.agent_drafts.sendable_until IS
  'Hasta cuando se puede enviar (burst_last_inbound_at + ventana del canal). NULL = el canal no tiene ventana. "No enviable" es un calculo sobre esto, no un estado.';
COMMENT ON COLUMN public.agent_drafts.alerted_thresholds IS
  'Que cortes de la ventana ya se avisaron, como denominadores: 2 = mitad, 4 = cuarto, 8 = octavo. Sobrevive a un cambio de messaging_window_hours.';
COMMENT ON COLUMN public.agent_drafts.window_missed_at IS
  'Cuando la ventana cerro con el borrador todavia sin enviar. El estado NO cambia: sin vencimiento quiere decir que nada se autovence.';
COMMENT ON COLUMN public.agent_drafts.missed_while_assigned_to IS
  'De quien era el borrador cuando se perdio la ventana (setter del contacto, o vendedor). Congelado: una reasignacion posterior no reescribe la historia.';
COMMENT ON COLUMN public.agent_drafts.sent_body IS
  'Lo que se envio realmente. Distinto de body si se edito: esa diferencia es la metrica de calidad.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_drafts_status_values') THEN
    ALTER TABLE public.agent_drafts ADD CONSTRAINT agent_drafts_status_values
      CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'discarded', 'superseded', 'regenerated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_drafts_sent_has_body') THEN
    ALTER TABLE public.agent_drafts ADD CONSTRAINT agent_drafts_sent_has_body
      CHECK (status <> 'sent' OR sent_body IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_drafts_empty_has_reason') THEN
    ALTER TABLE public.agent_drafts ADD CONSTRAINT agent_drafts_empty_has_reason
      CHECK (body IS NOT NULL OR no_reply_reason IS NOT NULL);
  END IF;
END $$;

-- Un solo borrador vivo por conversacion, garantizado por la base y no solo
-- por codigo. failed es vivo: tiene "Reintentar" en la cola.
CREATE UNIQUE INDEX IF NOT EXISTS agent_drafts_one_open_per_conversation
  ON public.agent_drafts(conversation_id)
  WHERE status IN ('pending', 'sending', 'failed');

-- La cola. No cubre la expresion (sendable_until < now()) con la que empieza
-- el ORDER BY: a este volumen no importa.
CREATE INDEX IF NOT EXISTS idx_agent_drafts_queue
  ON public.agent_drafts(workspace_id, status, sendable_until NULLS LAST, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_drafts_run ON public.agent_drafts(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_drafts_contact ON public.agent_drafts(contact_id);
CREATE INDEX IF NOT EXISTS idx_agent_drafts_conversation ON public.agent_drafts(conversation_id, status);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_agent_drafts') THEN
    CREATE TRIGGER set_updated_at_agent_drafts
      BEFORE UPDATE ON public.agent_drafts
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- RLS. Mismo patron que agent_runs (00060): el EXISTS sobre conversations pasa
-- por la RLS de conversations y arrastra el scope de leads sin nombrarlo. Un
-- Member ve y decide solo los borradores de sus leads.
ALTER TABLE public.agent_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_drafts_select" ON public.agent_drafts;
CREATE POLICY "agent_drafts_select" ON public.agent_drafts
  FOR SELECT USING (
    public.is_workspace_admin(workspace_id)
    OR (
      public.is_workspace_member(workspace_id)
      AND EXISTS (
        SELECT 1 FROM public.conversations conv
        WHERE conv.id = agent_drafts.conversation_id
      )
    )
  );

-- UPDATE: una persona solo puede TOMAR un borrador vivo para enviarlo, o
-- descartarlo, o pedir otra version, siempre a su nombre. Marcar 'sent' o
-- 'failed' lo hace el service role despues de enviar de verdad; resucitar un
-- borrador terminado no se puede (el USING solo deja tocar filas vivas).
DROP POLICY IF EXISTS "agent_drafts_update" ON public.agent_drafts;
CREATE POLICY "agent_drafts_update" ON public.agent_drafts
  FOR UPDATE
  USING (
    status IN ('pending', 'failed')
    AND (
      public.is_workspace_admin(workspace_id)
      OR (
        public.is_workspace_member(workspace_id)
        AND EXISTS (
          SELECT 1 FROM public.conversations conv
          WHERE conv.id = agent_drafts.conversation_id
        )
      )
    )
  )
  WITH CHECK (
    status IN ('sending', 'discarded', 'regenerated')
    AND decided_by = auth.uid()
  );

-- Sin INSERT ni DELETE: los borradores los escribe el agente (service role).
DROP POLICY IF EXISTS "agent_drafts_insert" ON public.agent_drafts;
DROP POLICY IF EXISTS "agent_drafts_delete" ON public.agent_drafts;

REVOKE ALL ON TABLE public.agent_drafts FROM anon, authenticated;
GRANT SELECT ON public.agent_drafts TO authenticated;
GRANT UPDATE (status, decided_at, decided_by, sent_body, discard_reason, regenerate_instruction, updated_at)
  ON public.agent_drafts TO authenticated;

-- Realtime: la cola y la conversacion se actualizan solas. Filtra por la
-- policy de SELECT de cada suscriptor.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agent_drafts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_drafts;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 7. messaging_window_hours()
-- ------------------------------------------------------------
-- La misma regla que lib/messaging-window.ts. Si cambia una, cambia la otra.

CREATE OR REPLACE FUNCTION public.messaging_window_hours(p_platform text, p_configured integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_configured IS NOT NULL THEN p_configured
    WHEN p_platform IN ('instagram', 'facebook') THEN 24
    ELSE 0
  END;
$$;

COMMENT ON FUNCTION public.messaging_window_hours(text, integer) IS
  'Ventana de mensajeria de un canal en horas: la configurada, o 24 para Instagram/Facebook, o 0 (sin ventana). Espejo de lib/messaging-window.ts.';

REVOKE ALL ON FUNCTION public.messaging_window_hours(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_window_hours(text, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 8a. El barrido de borradores (cada 5 minutos)
-- ------------------------------------------------------------
-- Dos cosas, las dos sobre un punado de filas (solo borradores vivos):
--
--   - Un envio colgado: un borrador en 'sending' hace mas de 5 minutos es un
--     proceso que murio a mitad del envio. Pasa a 'failed' para que se pueda
--     reintentar y deje de bloquear la conversacion (mientras hay un 'sending'
--     el agente no puede dejar otro borrador ahi).
--   - Una ventana perdida: la ventana cerro con el borrador sin enviar. Se
--     anota cuando y de quien era en ese momento. El estado no cambia.
--
-- Va en un cron lento y no en el de 15 segundos del agente: es algo que casi
-- nunca pasa. Los avisos a las personas (00072) son otro job.

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
  SET window_missed_at = now(),
      missed_while_assigned_to = (
        SELECT COALESCE(c.setter_id, c.vendedor_id)
        FROM public.contacts c
        WHERE c.id = d.contact_id
      )
  WHERE d.status IN ('pending', 'failed')
    AND d.sendable_until IS NOT NULL
    AND d.sendable_until < now()
    AND d.window_missed_at IS NULL;
  GET DIAGNOSTICS v_missed = ROW_COUNT;

  RETURN jsonb_build_object('sending_failed', v_failed, 'windows_missed', v_missed);
END;
$$;

COMMENT ON FUNCTION private.sweep_agent_drafts() IS
  'Barrido de borradores cada 5 minutos: envios colgados pasan a failed, ventanas cerradas sin envio quedan anotadas (window_missed_at, missed_while_assigned_to). No cambia el estado de un pendiente.';

REVOKE ALL ON FUNCTION private.sweep_agent_drafts() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 8b. Retencion: el texto sigue la politica de los mensajes (12 meses)
-- ------------------------------------------------------------

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
  WHERE status IN ('sent', 'discarded', 'superseded', 'regenerated')
    AND created_at < now() - make_interval(months => GREATEST(p_retention_months, 1))
    AND (body IS NOT NULL OR body_parts IS NOT NULL OR (sent_body IS NOT NULL AND sent_body <> ''));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.purge_agent_draft_content(integer) IS
  'Vacia el texto de los borradores terminados de mas de N meses (default 12), la misma politica que el contenido de messages. La fila queda para las metricas.';

REVOKE ALL ON FUNCTION public.purge_agent_draft_content(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_agent_draft_content(integer) TO service_role;

-- 8c. Los schedules. Cada 5 minutos el barrido; 5:30 la retencion (el primer
-- hueco libre despues de las purgas de 5:00, 5:10 y 5:20).
DO $$
DECLARE
  v_job text;
BEGIN
  FOREACH v_job IN ARRAY ARRAY['ssa-cron-agent-drafts-sweep', 'ssa-cron-purge-agent-drafts'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job) THEN
      PERFORM cron.unschedule(v_job);
    END IF;
  END LOOP;
END $$;

SELECT cron.schedule(
  'ssa-cron-agent-drafts-sweep',
  '*/5 * * * *',
  $$SELECT private.sweep_agent_drafts()$$
);

SELECT cron.schedule(
  'ssa-cron-purge-agent-drafts',
  '30 5 * * *',
  $$SELECT public.purge_agent_draft_content(12)$$
);

-- ------------------------------------------------------------
-- 9. push_debounced_job con claves volatiles
-- ------------------------------------------------------------
-- Un conflicto sobre la clave de un job reprogramable quiere decir que dos
-- disparadores se fusionaron en un solo turno. Algunas claves del payload
-- solo valen para el disparador que las trajo: si se fusiona con otro, dejan
-- de valer. p_volatile_keys son esas claves, y en un conflicto se descartan
-- del payload resultante VENGAN DE DONDE VENGAN (del existente o del que
-- entra).
--
-- El caso que lo motiva (Bloque 2c): regenerar un borrador con una instruccion
-- ("mas corto", "no menciones el precio"). Si el lead escribe mientras la
-- regeneracion espera, la instruccion era sobre un borrador que ya quedo viejo:
-- se descarta (regenerate_instruction es volatil) y se conserva la cadena
-- (regenerate_of no lo es). La funcion no sabe nada de borradores: quien
-- agenda dice que es volatil.
--
-- La firma de cinco parametros se conserva y delega con la lista vacia: las
-- llamadas existentes no cambian.

CREATE OR REPLACE FUNCTION public.push_debounced_job(
  p_type          text,
  p_dedupe_key    text,
  p_payload       jsonb,
  p_run_at        timestamptz,
  p_deadline      timestamptz,
  p_volatile_keys text[]
)
RETURNS TABLE (job_id uuid, job_run_at timestamptz, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt  integer := 0;
  v_volatile text[] := COALESCE(p_volatile_keys, '{}');
BEGIN
  IF p_type IS NULL OR p_dedupe_key IS NULL OR p_run_at IS NULL THEN
    RAISE EXCEPTION 'push_debounced_job: type, dedupe_key y run_at son obligatorios';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;

    RETURN QUERY
    INSERT INTO public.scheduled_jobs AS j (type, payload, run_at, dedupe_key)
    VALUES (
      p_type,
      COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('burst_deadline', p_deadline),
      LEAST(p_run_at, p_deadline),
      p_dedupe_key
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending'
    DO UPDATE SET
      run_at = GREATEST(
        j.run_at,
        LEAST(p_run_at, (j.payload->>'burst_deadline')::timestamptz)
      ),
      payload = (
        j.payload || jsonb_build_object(
          'last_message_at', COALESCE(p_payload->'last_message_at', to_jsonb(now()))
        )
      ) - v_volatile
    WHERE j.status = 'pending'
    RETURNING j.id, j.run_at, (j.xmax = 0);

    IF FOUND THEN
      RETURN;
    END IF;

    IF v_attempt >= 3 THEN
      RAISE EXCEPTION 'push_debounced_job: no se pudo agendar % despues de % intentos', p_dedupe_key, v_attempt;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz, text[]) IS
  'Agenda o empuja hacia adelante un job reprogramable. En un conflicto (dos disparadores fusionados) descarta del payload las claves de p_volatile_keys, vengan del job existente o del que entra. Solo service role.';

REVOKE ALL ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.push_debounced_job(
  p_type       text,
  p_dedupe_key text,
  p_payload    jsonb,
  p_run_at     timestamptz,
  p_deadline   timestamptz
)
RETURNS TABLE (job_id uuid, job_run_at timestamptz, created boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM public.push_debounced_job(p_type, p_dedupe_key, p_payload, p_run_at, p_deadline, '{}'::text[]);
$$;

COMMENT ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) IS
  'Firma original (00061): delega en la de seis parametros sin claves volatiles. Solo service role.';

REVOKE ALL ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) TO service_role;
