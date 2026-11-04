-- ============================================================================
-- 00287 — La guardia unica de entrega de emails (automatizaciones de email, Fase 1a)
-- ============================================================================
-- Que suma (todo aditivo):
--
-- 1. `email_log`:
--    - `category` (marketing | transactional): lo que cuenta el tope de marketing.
--    - Los eventos de entrega que manda Resend por el webhook, ubicados por `provider_message_id`:
--      `delivered_at`, `opened_at` + `open_count`, `clicked_at` + `click_count` + `last_clicked_url`,
--      `bounced_at`, `complained_at`. Y `unsubscribed_at` (la baja vino del link de ESTE email, `?e=`).
--    - `flow_node_id` y `automation_run_id` (los usa la Fase 1b para agrupar resultados por paso y por disparo;
--      sin FK todavia: la tabla `automation_runs` llega en la 1b).
--    - Dos estados nuevos: `reserved` (la guardia aparto el lugar antes de mandar) y `skipped_no_email`.
--    - Indices para el webhook (por id del proveedor), el tope (por categoria y fecha) y los resultados.
--
-- 2. La guardia (gemela de `lib/email/delivery-guard.ts`, casos en `lib/email/delivery-guard.cases.json`):
--    - `private.email_guard_decide(jsonb)`: PURA. El tope del dia = el mas bajo entre el maximo elegido (default 100)
--      y el escalon del calentamiento (100, 200, 400, 800); la cuota del plan de Resend si esta cargada; la pausa del
--      freno. Sube el escalon una vez por dia nuevo si el dia anterior salio algo y el freno no salto.
--    - `private.email_guard_state(ws, now, category)`: lee la configuracion y cuenta en el dia del NEGOCIO.
--    - `public.reserve_email_send(...)`: con candado por negocio, decide y, si hay lugar, inserta la fila de
--      `email_log` en `reserved` (asi dos envios a la vez no pasan el tope). Solo `service_role`.
--    - `public.email_send_capacity(ws)`: lo mismo sin reservar ni guardar (la cola de broadcasts y la pantalla).
--    - `public.patch_resend_config(ws, patch)`: mezcla claves en la config de Resend sin pisar las demas (el freno,
--      el maximo, reanudar). Un valor null borra la clave.
--
-- 3. `public.record_email_delivery_event(...)`: anota un evento del webhook en la fila de `email_log`.
-- 4. `public.contact_last_activity(ws, ids)`: la actividad mas reciente (ultimo mensaje o ultimo toque; si no hay,
--    el alta), para mandar primero a los mas activos.
--
-- Orden: ANTES de desplegar el codigo (el envio llama a `reserve_email_send`).
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.contact_last_activity(uuid, uuid[]);
--   DROP FUNCTION IF EXISTS public.record_email_delivery_event(text, text, timestamptz, text);
--   DROP FUNCTION IF EXISTS public.patch_resend_config(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.email_send_capacity(uuid);
--   DROP FUNCTION IF EXISTS public.reserve_email_send(uuid, text, text, text, uuid, text, uuid, uuid, text, uuid);
--   DROP FUNCTION IF EXISTS private.email_guard_state(uuid, timestamptz, text);
--   DROP FUNCTION IF EXISTS private.email_guard_decide(jsonb);
--   UPDATE public.email_log SET status = 'failed', last_error = 'reserva sin cerrar' WHERE status = 'reserved';
--   UPDATE public.email_log SET status = 'skipped_not_configured' WHERE status = 'skipped_no_email';
--   ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
--   ALTER TABLE public.email_log ADD CONSTRAINT email_log_status_check
--     CHECK (status = ANY (ARRAY['sent', 'failed', 'skipped_not_configured', 'skipped_unsubscribed',
--       'skipped_bounced', 'skipped_complained', 'skipped_do_not_contact', 'skipped_unverifiable',
--       'skipped_not_subscribed']));                                     -- (la definicion de la 00278)
--   DROP INDEX IF EXISTS public.idx_email_log_provider_message, public.idx_email_log_ws_category_created,
--     public.idx_email_log_related, public.idx_email_log_run;
--   ALTER TABLE public.email_log DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS delivered_at,
--     DROP COLUMN IF EXISTS opened_at, DROP COLUMN IF EXISTS open_count, DROP COLUMN IF EXISTS clicked_at,
--     DROP COLUMN IF EXISTS click_count, DROP COLUMN IF EXISTS last_clicked_url, DROP COLUMN IF EXISTS bounced_at,
--     DROP COLUMN IF EXISTS complained_at, DROP COLUMN IF EXISTS unsubscribed_at, DROP COLUMN IF EXISTS flow_node_id,
--     DROP COLUMN IF EXISTS automation_run_id;
-- Riesgo: bajo. Columnas nuevas con default, funciones nuevas; el CHECK es un superconjunto del anterior.
-- ============================================================================

SET search_path = '';

-- 1. email_log ---------------------------------------------------------------

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS open_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS click_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_clicked_url text,
  ADD COLUMN IF NOT EXISTS bounced_at timestamptz,
  ADD COLUMN IF NOT EXISTS complained_at timestamptz,
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS flow_node_id text,
  ADD COLUMN IF NOT EXISTS automation_run_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_log_category_check' AND conrelid = 'public.email_log'::regclass) THEN
    ALTER TABLE public.email_log ADD CONSTRAINT email_log_category_check
      CHECK (category IS NULL OR category IN ('marketing', 'transactional'));
  END IF;
END $$;

ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
ALTER TABLE public.email_log ADD CONSTRAINT email_log_status_check
  CHECK (status = ANY (ARRAY[
    'sent', 'failed', 'skipped_not_configured',
    'skipped_unsubscribed', 'skipped_bounced', 'skipped_complained',
    'skipped_do_not_contact', 'skipped_unverifiable',
    'skipped_not_subscribed',
    'reserved', 'skipped_no_email'
  ]));

COMMENT ON COLUMN public.email_log.category IS
  'marketing | transactional (00287). Null: un email al equipo o del sistema, o uno de antes de la 00287. El tope diario cuenta solo marketing.';
COMMENT ON COLUMN public.email_log.opened_at IS
  'Primera apertura que informo Resend (aproximada: depende de que el cliente de correo cargue la imagen de seguimiento).';
COMMENT ON COLUMN public.email_log.unsubscribed_at IS
  'La persona se dio de baja desde el link de ESTE email (`?e=<id>` en el link y en el header de baja).';

CREATE INDEX IF NOT EXISTS idx_email_log_provider_message
  ON public.email_log (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_log_ws_category_created
  ON public.email_log (workspace_id, category, created_at) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_log_related
  ON public.email_log (related_entity_id) WHERE related_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_log_run
  ON public.email_log (automation_run_id) WHERE automation_run_id IS NOT NULL;

-- 2. La guardia -------------------------------------------------------------

-- PURA: los mismos casos que `decideEmailSend` (lib/email/delivery-guard.ts). Si se cambia una regla, se cambia en las
-- dos y se suma el caso a `delivery-guard.cases.json`.
CREATE OR REPLACE FUNCTION private.email_guard_decide(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_steps integer[] := ARRAY[100, 200, 400, 800];
  v_category text := coalesce(p->>'category', 'marketing');
  v_today date := (p->>'today')::date;
  v_enabled boolean;
  v_level integer := coalesce((p->>'warmup_level')::integer, 0);
  v_level_date date := nullif(p->>'warmup_level_date', '')::date;
  v_changed boolean := false;
  v_completed boolean := false;
  v_manual integer := greatest(0, coalesce((p->>'manual_cap')::integer, 100));
  v_cap integer;
  v_quota integer := (p->>'quota')::integer;
  v_marketing_today integer := coalesce((p->>'marketing_today')::integer, 0);
  v_all_today integer := coalesce((p->>'all_today')::integer, 0);
  v_remaining integer;
  v_status text;
BEGIN
  -- El calentamiento: sin decision guardada, prendido si el negocio mando menos de 500 de marketing en su vida.
  IF p->'warmup_enabled' IS NULL OR jsonb_typeof(p->'warmup_enabled') = 'null' THEN
    v_enabled := coalesce((p->>'lifetime_marketing_sent')::integer, 0) < 500;
    v_changed := true;
  ELSE
    v_enabled := (p->>'warmup_enabled')::boolean;
  END IF;

  IF v_enabled THEN
    v_level := least(greatest(v_level, 0), 3);
    IF v_level_date IS NULL THEN
      v_level_date := v_today;
      v_changed := true;
    ELSIF v_level_date < v_today THEN
      IF coalesce((p->>'brake_since_level')::boolean, false) THEN
        -- El freno salto: no sube; el escalon vuelve a contar desde hoy.
        v_level_date := v_today;
        v_changed := true;
      ELSIF coalesce((p->>'sent_since_level')::boolean, false) THEN
        v_level := v_level + 1;
        v_level_date := v_today;
        v_changed := true;
        IF v_level > 3 THEN
          v_enabled := false;
          v_completed := true;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_enabled THEN
    v_cap := least(v_manual, v_steps[v_level + 1]);
  ELSE
    v_cap := v_manual;
  END IF;

  v_remaining := greatest(0, v_cap - v_marketing_today);
  IF v_quota IS NOT NULL THEN
    v_remaining := least(v_remaining, greatest(0, v_quota - v_all_today));
  END IF;

  IF v_category <> 'marketing' THEN
    v_status := 'ok';
  ELSIF coalesce((p->>'paused')::boolean, false) THEN
    v_status := 'paused';
  ELSIF v_marketing_today >= v_cap THEN
    v_status := 'deferred_cap';
  ELSIF v_quota IS NOT NULL AND v_all_today >= v_quota THEN
    v_status := 'deferred_quota';
  ELSE
    v_status := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'cap', v_cap,
    'remaining', CASE WHEN v_status = 'paused' THEN 0 ELSE v_remaining END,
    'warmup_enabled', v_enabled,
    'warmup_level', CASE WHEN v_enabled OR v_completed THEN least(v_level, 4) ELSE v_level END,
    'warmup_level_date', v_level_date,
    'warmup_completed', v_completed,
    'warmup_changed', v_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION private.email_guard_decide(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.email_guard_decide(jsonb) TO service_role;

-- El estado del negocio: lee la config de Resend y cuenta en el dia del NEGOCIO (workspaces.timezone).
CREATE OR REPLACE FUNCTION private.email_guard_state(p_workspace_id uuid, p_now timestamptz, p_category text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cfg jsonb;
  v_tz text;
  v_today date;
  v_day_start timestamptz;
  v_next_day timestamptz;
  v_level_date date;
  v_level_start timestamptz;
  v_quota integer;
  v_input jsonb;
  v_out jsonb;
  v_retry timestamptz;
  v_int_re text := '^\s*[0-9]+\s*$';
BEGIN
  SELECT ic.config INTO v_cfg
    FROM public.integration_configs ic
   WHERE ic.workspace_id = p_workspace_id AND ic.type = 'email_provider' AND ic.provider = 'resend'
   LIMIT 1;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);

  SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names n WHERE n.name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  v_today := (p_now AT TIME ZONE v_tz)::date;
  v_day_start := v_today::timestamp AT TIME ZONE v_tz;
  v_next_day := (v_today + 1)::timestamp AT TIME ZONE v_tz;

  v_level_date := CASE WHEN coalesce(v_cfg->>'warmup_level_date', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (v_cfg->>'warmup_level_date')::date END;
  v_level_start := CASE WHEN v_level_date IS NOT NULL THEN v_level_date::timestamp AT TIME ZONE v_tz END;
  v_quota := CASE WHEN coalesce(v_cfg->>'daily_quota', '') ~ v_int_re THEN (v_cfg->>'daily_quota')::integer END;

  v_input := jsonb_build_object(
    'category', p_category,
    'today', v_today,
    'manual_cap', CASE WHEN coalesce(v_cfg->>'marketing_daily_cap', '') ~ v_int_re THEN (v_cfg->>'marketing_daily_cap')::integer END,
    'warmup_enabled', CASE v_cfg->>'warmup_enabled' WHEN 'true' THEN to_jsonb(true) WHEN 'false' THEN to_jsonb(false) ELSE 'null'::jsonb END,
    'warmup_level', CASE WHEN coalesce(v_cfg->>'warmup_level', '') ~ v_int_re THEN (v_cfg->>'warmup_level')::integer END,
    'warmup_level_date', v_level_date,
    'paused', nullif(v_cfg->>'marketing_paused_at', '') IS NOT NULL,
    'quota', v_quota,
    'marketing_today', (
      SELECT count(*) FROM public.email_log l
       WHERE l.workspace_id = p_workspace_id AND l.category = 'marketing'
         AND l.status IN ('sent', 'reserved') AND l.created_at >= v_day_start
    ),
    'all_today', CASE WHEN v_quota IS NULL THEN 0 ELSE (
      SELECT count(*) FROM public.email_log l
       WHERE l.workspace_id = p_workspace_id AND l.status IN ('sent', 'reserved') AND l.created_at >= v_day_start
    ) END,
    'lifetime_marketing_sent', CASE WHEN v_cfg ? 'warmup_enabled' THEN 0 ELSE (
      SELECT count(*) FROM public.email_log l
       WHERE l.workspace_id = p_workspace_id AND l.status = 'sent'
         AND (l.category = 'marketing' OR (l.category IS NULL AND l.kind IN ('broadcast', 'flow', 'flow_message', 'sequence')))
    ) END,
    'sent_since_level', CASE WHEN v_level_start IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM public.email_log l
       WHERE l.workspace_id = p_workspace_id AND l.category = 'marketing' AND l.status = 'sent'
         AND l.created_at >= v_level_start AND l.created_at < v_day_start
    ) END,
    'brake_since_level', CASE
      WHEN v_level_start IS NULL OR coalesce(v_cfg->>'marketing_last_brake_at', '') = '' THEN false
      ELSE (v_cfg->>'marketing_last_brake_at')::timestamptz >= v_level_start
    END
  );

  v_out := private.email_guard_decide(v_input);
  v_retry := CASE v_out->>'status'
    WHEN 'deferred_cap' THEN v_next_day
    WHEN 'deferred_quota' THEN v_next_day
    WHEN 'paused' THEN p_now + interval '1 hour'
  END;

  RETURN v_out || jsonb_build_object(
    'retry_at', v_retry,
    'used_today', (v_input->>'marketing_today')::integer,
    'all_today', (v_input->>'all_today')::integer,
    'quota', v_quota,
    'manual_cap', coalesce((v_input->>'manual_cap')::integer, 100),
    'day_start', v_day_start,
    'next_day_start', v_next_day,
    'time_zone', v_tz,
    'paused_at', nullif(v_cfg->>'marketing_paused_at', ''),
    'paused_reason', nullif(v_cfg->>'marketing_paused_reason', '')
  );
END;
$$;

REVOKE ALL ON FUNCTION private.email_guard_state(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.email_guard_state(uuid, timestamptz, text) TO service_role;

-- Mezcla claves en la config de Resend del negocio. Un valor null borra la clave. Sin leer y pisar: dos escrituras a
-- la vez (el freno y una reserva que sube el escalon) no se pisan.
CREATE OR REPLACE FUNCTION public.patch_resend_config(p_workspace_id uuid, p_patch jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_removed text[];
  v_rows integer;
BEGIN
  SELECT coalesce(array_agg(e.key), ARRAY[]::text[]) INTO v_removed
    FROM jsonb_each(coalesce(p_patch, '{}'::jsonb)) e
   WHERE jsonb_typeof(e.value) = 'null';

  UPDATE public.integration_configs ic
     SET config = (coalesce(ic.config, '{}'::jsonb) || jsonb_strip_nulls(coalesce(p_patch, '{}'::jsonb))) - v_removed,
         updated_at = now()
   WHERE ic.workspace_id = p_workspace_id AND ic.type = 'email_provider' AND ic.provider = 'resend';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.patch_resend_config(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_resend_config(uuid, jsonb) TO service_role;

-- Reserva un lugar para un email de MARKETING. Con candado por negocio: dos envios a la vez no pasan el tope.
-- Devuelve el estado de la guardia y, si hay lugar, `log_id` (la fila `reserved` que el envio cierra en sent/failed).
CREATE OR REPLACE FUNCTION public.reserve_email_send(
  p_workspace_id uuid,
  p_to text,
  p_subject text,
  p_kind text,
  p_contact_id uuid DEFAULT NULL,
  p_related_type text DEFAULT NULL,
  p_related_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_flow_node_id text DEFAULT NULL,
  p_automation_run_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state jsonb;
  v_id uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email_guard:' || p_workspace_id::text, 0));

  v_state := private.email_guard_state(p_workspace_id, now(), 'marketing');

  -- El escalon del calentamiento (o la decision de prenderlo) se guarda la primera vez que se evalua en el dia.
  IF (v_state->>'warmup_changed')::boolean THEN
    PERFORM public.patch_resend_config(p_workspace_id, jsonb_build_object(
      'warmup_enabled', CASE WHEN (v_state->>'warmup_enabled')::boolean THEN 'true' ELSE 'false' END,
      'warmup_level', (v_state->>'warmup_level'),
      'warmup_level_date', (v_state->>'warmup_level_date'),
      'warmup_completed_at', CASE WHEN (v_state->>'warmup_completed')::boolean THEN now()::text END
    ));
  END IF;

  IF v_state->>'status' <> 'ok' THEN
    RETURN v_state;
  END IF;

  INSERT INTO public.email_log (
    workspace_id, to_email, subject, kind, status, category, contact_id,
    related_entity_type, related_entity_id, created_by, flow_node_id, automation_run_id
  ) VALUES (
    p_workspace_id, coalesce(p_to, ''), coalesce(p_subject, ''), coalesce(p_kind, 'marketing'), 'reserved', 'marketing',
    p_contact_id, p_related_type, p_related_id, p_created_by, p_flow_node_id, p_automation_run_id
  )
  RETURNING id INTO v_id;

  RETURN v_state || jsonb_build_object('log_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_email_send(uuid, text, text, text, uuid, text, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_email_send(uuid, text, text, text, uuid, text, uuid, uuid, text, uuid) TO service_role;

-- Lo mismo sin reservar ni guardar nada: cuanto queda hoy, el escalon, la pausa. Para la cola de broadcasts (no
-- reclamar destinatarios para nada) y para la pantalla de Resend.
CREATE OR REPLACE FUNCTION public.email_send_capacity(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.email_guard_state(p_workspace_id, now(), 'marketing');
$$;

REVOKE ALL ON FUNCTION public.email_send_capacity(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_send_capacity(uuid) TO service_role;

-- 3. Eventos de entrega -------------------------------------------------------

-- Anota un evento del webhook de Resend en la fila de `email_log` con ese id. Devuelve la fila tocada (para evaluar el
-- freno del negocio). La idempotencia la da el receptor (`webhook_events`): un mismo evento no llega dos veces.
CREATE OR REPLACE FUNCTION public.record_email_delivery_event(p_provider_message_id text, p_event text, p_at timestamptz, p_url text DEFAULT NULL)
RETURNS TABLE (email_log_id uuid, workspace_id uuid, category text, contact_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_provider_message_id IS NULL OR p_provider_message_id = '' THEN
    RETURN;
  END IF;
  RETURN QUERY
  UPDATE public.email_log l
     SET delivered_at  = CASE WHEN p_event = 'delivered'  THEN coalesce(l.delivered_at, p_at) ELSE l.delivered_at END,
         opened_at     = CASE WHEN p_event = 'opened'     THEN coalesce(l.opened_at, p_at) ELSE l.opened_at END,
         open_count    = CASE WHEN p_event = 'opened'     THEN l.open_count + 1 ELSE l.open_count END,
         clicked_at    = CASE WHEN p_event = 'clicked'    THEN coalesce(l.clicked_at, p_at) ELSE l.clicked_at END,
         click_count   = CASE WHEN p_event = 'clicked'    THEN l.click_count + 1 ELSE l.click_count END,
         last_clicked_url = CASE WHEN p_event = 'clicked' AND p_url IS NOT NULL THEN left(p_url, 2000) ELSE l.last_clicked_url END,
         bounced_at    = CASE WHEN p_event = 'bounced'    THEN coalesce(l.bounced_at, p_at) ELSE l.bounced_at END,
         complained_at = CASE WHEN p_event = 'complained' THEN coalesce(l.complained_at, p_at) ELSE l.complained_at END
   WHERE l.provider_message_id = p_provider_message_id
     AND p_event IN ('delivered', 'opened', 'clicked', 'bounced', 'complained')
  RETURNING l.id, l.workspace_id, l.category, l.contact_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_email_delivery_event(text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_delivery_event(text, text, timestamptz, text) TO service_role;

-- 4. La actividad mas reciente -------------------------------------------------

-- El ultimo mensaje (`last_interaction_at`) o el ultimo toque (formulario, agenda, compra cargada, mensaje); si no hay
-- ninguno, el alta. Para mandar primero a quien estuvo activo hace menos.
CREATE OR REPLACE FUNCTION public.contact_last_activity(p_workspace_id uuid, p_contact_ids uuid[])
RETURNS TABLE (contact_id uuid, activity_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.id,
         coalesce(greatest(c.last_interaction_at, t.last_touch), c.created_at)
    FROM public.contacts c
    LEFT JOIN LATERAL (
      SELECT max(ct.occurred_at) AS last_touch
        FROM public.contact_touches ct
       WHERE ct.workspace_id = p_workspace_id AND ct.contact_id = c.id
    ) t ON true
   WHERE c.workspace_id = p_workspace_id
     AND c.id = ANY (p_contact_ids);
$$;

REVOKE ALL ON FUNCTION public.contact_last_activity(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_last_activity(uuid, uuid[]) TO service_role;
