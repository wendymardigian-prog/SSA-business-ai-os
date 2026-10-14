-- ============================================================================
-- 00216 — Recepción de webhooks sin carrera: `receive_inbound_webhook`  (Tirón 2, C2)
-- ============================================================================
-- Hoy `lib/webhooks/receive.ts` hace dos cosas separadas: un SELECT por `body_hash` ("¿llegó lo mismo en los
-- últimos 10 minutos?") y después un INSERT. Dos entregas idénticas SIMULTÁNEAS pasan las dos el SELECT, antes
-- de que ninguna se haya guardado, y las dos quedan `received`: el mismo envío dispara dos veces los flujos
-- (dos bienvenidas). Con un id de envío configurado ya había un índice único (`uq_inbound_webhooks_event`),
-- pero sin id no había nada que lo frenara.
--
-- Esta función hace la verificación y el insert en UNA transacción, serializados con un candado de la base
-- (`pg_advisory_xact_lock`) por (endpoint, id del envío si lo hay, o `body_hash`):
--   - con id del envío: el índice único sigue siendo el que decide; el candado solo ordena la cola;
--   - sin id: la segunda entrega espera a la primera, la ve y se guarda como `ignored` ("Repetido…").
-- Devuelve `{ kind: 'inserted', id, status }` (el estado FINAL: puede ser `ignored` aunque se pidiera otro)
-- o `{ kind: 'duplicate' }` (el mismo id de envío por segunda vez). Las demás reglas del receptor (token,
-- secreto, tope, tamaño, parseo, el estado `paused`/`error`/`captured`/`received`) siguen en TypeScript.
--
-- - SECURITY INVOKER: la llama el servidor con el cliente de servicio. `authenticated` y `anon` no pueden.
-- - `SET search_path = ''`. Idempotente (CREATE OR REPLACE).
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.receive_inbound_webhook(jsonb, integer);
--   (y volver el código de `lib/webhooks/server-ports.ts` al SELECT + INSERT de antes).
-- Riesgo: bajo (aditiva: una función nueva; la tabla no cambia).
-- ============================================================================

SET search_path = '';

CREATE OR REPLACE FUNCTION public.receive_inbound_webhook(
  p_row jsonb,
  p_duplicate_window_seconds integer DEFAULT 600
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_endpoint uuid := (p_row ->> 'endpoint_id')::uuid;
  v_event    text := nullif(p_row ->> 'external_event_id', '');
  v_hash     text := nullif(p_row ->> 'body_hash', '');
  v_status   text := p_row ->> 'status';
  v_summary  text := nullif(p_row ->> 'summary', '');
  v_error    text := nullif(p_row ->> 'error_message', '');
  v_id       uuid;
BEGIN
  IF v_endpoint IS NULL OR v_status IS NULL THEN
    RAISE EXCEPTION 'receive_inbound_webhook: faltan endpoint_id o status' USING ERRCODE = '22023';
  END IF;

  -- Dos entregas del mismo envío (mismo id, o mismo cuerpo) se atienden una atrás de la otra.
  -- Sin id ni huella no hay nada que serializar: la clave es única por llamada.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_endpoint::text || ':' || coalesce(v_event, v_hash, gen_random_uuid()::text), 0)
  );

  -- Sin id de envío, el mismo cuerpo en la ventana es un repetido (ya está guardado, o lo estaba la entrega
  -- que acaba de soltar el candado). Con id, decide el índice único de abajo.
  IF v_event IS NULL AND v_hash IS NOT NULL AND p_duplicate_window_seconds > 0 AND EXISTS (
       SELECT 1
         FROM public.inbound_webhooks w
        WHERE w.endpoint_id = v_endpoint
          AND w.body_hash = v_hash
          AND w.received_at >= now() - make_interval(secs => p_duplicate_window_seconds)
     ) THEN
    v_status  := 'ignored';
    v_summary := 'Repetido: igual a un envío de los últimos 10 minutos';
    v_error   := NULL;
  END IF;

  BEGIN
    INSERT INTO public.inbound_webhooks (
      workspace_id, endpoint_id, status, payload, query, content_type, size_bytes,
      ip_prefix, user_agent, external_event_id, body_hash, error_message, result
    ) VALUES (
      (p_row ->> 'workspace_id')::uuid, v_endpoint, v_status, p_row -> 'payload', p_row -> 'query',
      p_row ->> 'content_type', nullif(p_row ->> 'size_bytes', '')::integer,
      p_row ->> 'ip_prefix', p_row ->> 'user_agent', v_event, v_hash, v_error,
      CASE WHEN v_summary IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('summary', v_summary) END
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- El índice (endpoint, id de envío): el mismo envío por segunda vez.
    RETURN jsonb_build_object('kind', 'duplicate');
  END;

  RETURN jsonb_build_object('kind', 'inserted', 'id', v_id, 'status', v_status);
END;
$fn$;

REVOKE ALL ON FUNCTION public.receive_inbound_webhook(jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_inbound_webhook(jsonb, integer) TO service_role;

COMMENT ON FUNCTION public.receive_inbound_webhook(jsonb, integer) IS
  'Guarda un envío de webhook con un candado por (endpoint, id de envío o huella del cuerpo): dos entregas idénticas simultáneas dan un `received` y un `ignored`. Solo service_role.';
