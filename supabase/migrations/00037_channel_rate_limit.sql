-- ============================================================
-- MIGRACION 00037 — TOPE DE ENVIOS AUTOMATIZADOS POR CANAL (F8)
-- ============================================================
-- Instagram permite hasta 200 mensajes automatizados por hora y por cuenta.
-- Pasarse no devuelve un error prolijo: la API empieza a rechazar envios y, si
-- se insiste, la cuenta queda limitada un rato largo. Es de esas cosas que no
-- se notan hasta que se rompen, y cuando se rompen se rompe el canal entero.
--
-- Hasta ahora no habia ningun control: el motor mandaba de a uno con una pausa
-- fija de 500ms entre mensajes del mismo nodo, y nada mas. Con un flow por
-- mensaje entrante y las secuencias corriendo por cron, llegar a 200 en una
-- hora es perfectamente posible.
--
-- Se cuenta con una fila por canal y por hora, en vez de contar mensajes de la
-- tabla `messages`. Contar mensajes obligaria a escanear un rango de tiempo en
-- cada envio, sobre una tabla que solo crece; asi es un upsert sobre una fila
-- chica, y el contador se reclama en la misma sentencia que lo verifica, que es
-- lo unico que lo hace seguro con varios envios en paralelo.
--
-- El tope NO aplica a lo que manda una persona a mano desde la bandeja: ese
-- limite es para mensajes automatizados. Quien decide es quien llama.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.channel_send_windows (
  channel_id   uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  sent_count   integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, window_start)
);

COMMENT ON TABLE public.channel_send_windows IS
  'Contador de mensajes automatizados por canal y por hora. Sostiene el tope de la API de Instagram (200/hora).';

CREATE INDEX IF NOT EXISTS idx_channel_send_windows_start
  ON public.channel_send_windows(window_start);

ALTER TABLE public.channel_send_windows ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Solo lectura, y solo para quien ya ve el canal: sirve para mostrar "te
  -- quedan N envios" en la UI. Escribe unicamente el motor, con service role.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'channel_send_windows'
      AND policyname = 'channel_send_windows_select'
  ) THEN
    CREATE POLICY "channel_send_windows_select" ON public.channel_send_windows
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.channels c
          WHERE c.id = channel_send_windows.channel_id
            AND public.is_workspace_member(c.workspace_id)
        )
      );
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- Reclamar un envio
-- ------------------------------------------------------------
-- Devuelve true si el envio entra en la ventana, false si ya se llego al tope.
--
-- La verificacion y el incremento pasan en la misma sentencia a proposito: si
-- fueran un SELECT y despues un UPDATE, dos envios simultaneos podrian leer 199
-- los dos y terminar mandando 201.
CREATE OR REPLACE FUNCTION public.claim_automated_send(
  p_channel_id uuid,
  p_limit integer DEFAULT 200
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window timestamptz := date_trunc('hour', now());
  v_count  integer;
BEGIN
  INSERT INTO public.channel_send_windows (channel_id, window_start, sent_count)
  VALUES (p_channel_id, v_window, 1)
  ON CONFLICT (channel_id, window_start) DO UPDATE
    SET sent_count = public.channel_send_windows.sent_count + 1,
        updated_at = now()
    WHERE public.channel_send_windows.sent_count < p_limit
  RETURNING sent_count INTO v_count;

  -- Sin fila devuelta, el WHERE del upsert no se cumplio: la ventana esta llena.
  RETURN v_count IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automated_send(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automated_send(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.claim_automated_send(uuid, integer) IS
  'Reclama un envio automatizado en la ventana de la hora actual. true si entra, false si se llego al tope.';

-- ------------------------------------------------------------
-- Limpieza
-- ------------------------------------------------------------
-- Las ventanas viejas no le sirven a nadie: se guardan dos dias por si hay que
-- mirar por que un canal freno, y se van con la purga diaria.
CREATE OR REPLACE FUNCTION public.purge_send_windows(p_retention_days integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.channel_send_windows
  WHERE window_start < now() - make_interval(days => p_retention_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_send_windows(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_send_windows(integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-purge-send-windows') THEN
    PERFORM cron.unschedule('ssa-cron-purge-send-windows');
  END IF;
END;
$$;

SELECT cron.schedule(
  'ssa-cron-purge-send-windows',
  '20 4 * * *',
  $$SELECT public.purge_send_windows(2)$$
);
