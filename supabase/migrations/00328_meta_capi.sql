-- ============================================================================
-- 00328 — API de Conversiones de Meta (CAPI)
-- ============================================================================
-- SSA le manda a Meta, desde el servidor, los eventos que valen (un lead, una reunión, un pago cobrado) con todos los
-- datos de la persona juntos. Si la web también lo mandó por Pixel con el mismo código, Meta junta los dos envíos.
--
--   1. `meta_capi_events`: cada evento que se manda (o se saltea), con su estado. Es la cola y el registro a la vez:
--      el índice único (workspace, evento, código) hace que un reintento del paso o del job nunca mande dos veces.
--      Sin `contact_id` a propósito (la persona sale de lo que disparó el evento): `merge_contacts` no cambia. Sin
--      hashes ni IP: solo el resultado.
--   2. `meta_capi_request_context`: la IP y el navegador de quien respondió un formulario o agendó, que Meta pide para
--      un evento de web y que SSA no guarda en ningún otro lado (la respuesta solo guarda un hash de la IP). Se escribe
--      solo si el negocio tiene la API de Conversiones configurada y se borra a los 8 días (Meta no acepta eventos de
--      más de 7). Solo `service_role`.
--   3. El trigger de `payments`: un pago que pasa a cobrado (no un reembolso, monto positivo) encola su compra
--      (Purchase), si el negocio prendió «Mandar cada pago cobrado como compra». Envuelto en EXCEPTION: un cobro
--      NUNCA falla por esto. No mira para atrás: los pagos cobrados antes no se mandan.
--   4. La limpieza diaria (pg_cron, SQL directo, sin `call_app_cron`).
--
-- Aditiva. Puede ir antes o después del código: hasta que una persona configure la API de Conversiones (pantalla
-- nueva), el trigger no encola nada y no se escribe ningún contexto.
--
-- Como volver atras:
--   SELECT cron.unschedule('meta-capi-cleanup');
--   DROP TRIGGER IF EXISTS payments_enqueue_meta_capi_purchase ON public.payments;
--   DROP FUNCTION IF EXISTS private.enqueue_meta_capi_purchase();
--   UPDATE public.scheduled_jobs SET status = 'cancelled' WHERE type = 'meta_capi_send' AND status = 'pending';
--   DROP TABLE IF EXISTS public.meta_capi_request_context;
--   DROP TABLE IF EXISTS public.meta_capi_events;
-- Riesgo: bajo. Tablas nuevas; lo único que toca algo existente es un trigger que solo encola.
-- Idempotente.
-- ============================================================================

SET search_path = '';

-- 1. Los eventos -----------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.meta_capi_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (char_length(event_name) BETWEEN 1 AND 50),
  event_id text NOT NULL CHECK (char_length(event_id) BETWEEN 1 AND 200),
  source_type text NOT NULL CHECK (source_type IN ('form', 'booking', 'payment', 'contact')),
  -- La respuesta, la reunión, el pago o el contacto. Sin FK: lo que lo disparó puede borrarse y el registro queda.
  source_id uuid NOT NULL,
  flow_id uuid REFERENCES public.flows(id) ON DELETE SET NULL,
  flow_session_id uuid REFERENCES public.flow_sessions(id) ON DELETE SET NULL,
  -- Cuándo pasó (no cuándo se mandó): Meta no acepta eventos de más de 7 días.
  event_time timestamptz NOT NULL,
  -- Lo configurado en el paso o en el pago: valor, moneda, nombre del contenido, solo reuniones del lead. Sin datos de la persona.
  params jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(params) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  skip_reason text CHECK (skip_reason IS NULL OR skip_reason ~ '^[a-z_]{1,40}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Se mandó con el código de prueba de Events Manager: Meta lo muestra solo en «Probar eventos».
  test boolean NOT NULL DEFAULT false,
  action_source text CHECK (action_source IS NULL OR action_source IN ('website', 'system_generated')),
  fbtrace_id text CHECK (fbtrace_id IS NULL OR char_length(fbtrace_id) <= 100),
  error text CHECK (error IS NULL OR char_length(error) <= 500),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meta_capi_events IS
  'Cada evento de la API de Conversiones de Meta (00328). Un evento se manda una sola vez (índice único por workspace, evento y código). Sin contact_id ni datos de la persona a propósito.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_capi_events_event
  ON public.meta_capi_events(workspace_id, event_name, event_id);
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_recent
  ON public.meta_capi_events(workspace_id, created_at DESC);

ALTER TABLE public.meta_capi_events ENABLE ROW LEVEL SECURITY;

-- Lo ve quien ve o configura las integraciones del negocio. Escribe solo el servidor (sin políticas de escritura).
DROP POLICY IF EXISTS meta_capi_events_select ON public.meta_capi_events;
CREATE POLICY meta_capi_events_select ON public.meta_capi_events FOR SELECT
  USING (
    COALESCE((select public.has_permission(workspace_id, 'integrations.view')), false)
    OR COALESCE((select public.has_permission(workspace_id, 'integrations.manage')), false)
  );

REVOKE ALL ON public.meta_capi_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.meta_capi_events TO authenticated;
GRANT ALL ON public.meta_capi_events TO service_role;

-- 2. La IP y el navegador ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.meta_capi_request_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('form', 'booking')),
  source_id uuid NOT NULL,
  client_ip text CHECK (client_ip IS NULL OR char_length(client_ip) <= 64),
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meta_capi_request_context IS
  'La IP y el navegador de quien respondió un formulario o agendó, para la API de Conversiones de Meta (00328). Solo service_role; se borra a los 8 días.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_capi_request_context_source
  ON public.meta_capi_request_context(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_meta_capi_request_context_created
  ON public.meta_capi_request_context(created_at);

ALTER TABLE public.meta_capi_request_context ENABLE ROW LEVEL SECURITY;
-- Sin políticas: ni authenticated ni anon la leen. Solo el servidor.
REVOKE ALL ON public.meta_capi_request_context FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_capi_request_context TO service_role;

-- 3. La compra de cada pago cobrado -----------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.enqueue_meta_capi_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  BEGIN
    IF NEW.status = 'paid' AND NEW.type <> 'refund' AND COALESCE(NEW.amount, 0) > 0
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid')
       AND EXISTS (
         SELECT 1 FROM public.integration_configs ic
          WHERE ic.workspace_id = NEW.workspace_id
            AND ic.type = 'meta'
            AND ic.provider = 'meta_capi'
            AND ic.is_active
            AND COALESCE(ic.config ->> 'pixel_id', '') <> ''
            AND ic.config ->> 'purchase_enabled' = 'true'
       ) THEN
      INSERT INTO public.meta_capi_events (workspace_id, event_name, event_id, source_type, source_id, event_time, params)
      VALUES (NEW.workspace_id, 'Purchase', 'payment.' || NEW.id::text, 'payment', NEW.id, COALESCE(NEW.paid_at, now()),
              jsonb_build_object('value', NEW.amount, 'currency', NEW.currency))
      ON CONFLICT (workspace_id, event_name, event_id) DO NOTHING
      RETURNING id INTO v_event_id;

      IF v_event_id IS NOT NULL THEN
        INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
        VALUES ('meta_capi_send', jsonb_build_object('eventLogId', v_event_id, 'attempt', 1), now(), 'meta_capi:' || v_event_id::text)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_meta_capi_purchase: no pude encolar el pago %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_meta_capi_purchase() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_enqueue_meta_capi_purchase ON public.payments;
CREATE TRIGGER payments_enqueue_meta_capi_purchase
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_meta_capi_purchase();

-- 4. La limpieza diaria ---------------------------------------------------------------------------------------------
-- La IP y el navegador, a los 8 días (Meta no acepta eventos de más de 7). El registro de envíos, a los 180 días.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-capi-cleanup') THEN
    PERFORM cron.unschedule('meta-capi-cleanup');
  END IF;
END $$;

SELECT cron.schedule(
  'meta-capi-cleanup',
  '23 4 * * *',
  $$DELETE FROM public.meta_capi_request_context WHERE created_at < now() - interval '8 days';
    DELETE FROM public.meta_capi_events WHERE created_at < now() - interval '180 days' AND status <> 'pending';$$
);
