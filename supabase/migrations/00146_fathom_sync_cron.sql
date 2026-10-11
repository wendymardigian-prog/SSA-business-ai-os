-- ============================================================================
-- 00146 — Llamadas: el cron que consulta Fathom cada 10 minutos
-- ============================================================================
-- Fathom no tiene webhooks para apps OAuth: hay que preguntarle. Cada 10
-- minutos, pg_cron llama a `private.enqueue_fathom_sync()`, que deja en la cola
-- de trabajos (`scheduled_jobs`) un pedido `fathom_sync` por cada persona con
-- Fathom conectado. El cron `jobs` que ya corre cada minuto los procesa con el
-- handler `lib/jobs/handlers/fathom-sync.ts`.
--
-- NO se reescribe `private.call_app_cron` ni se agrega una ruta en
-- `app/api/cron/`: comparten esa funcion y su lista blanca TODOS los crons de
-- la app. Este cron llama una funcion SQL directo, igual que
-- `private.sweep_agent_drafts()` y `private.alert_draft_windows()`.
--
-- La funcion:
--   1. Por cada conexion activa de Fathom cuya persona sigue en el workspace,
--      encola UN job, salvo que ya haya uno `pending` o `processing` de esa
--      conexion. La clave de dedupe (conexion + franja de 10 minutos) es la
--      misma que arma `fathomSyncDedupeKey` en lib/fathom/queue.ts, asi que
--      "Sincronizar ahora" y las continuaciones del handler no duplican.
--   2. Devuelve a `pending` (motivo `stuck`) los analisis de llamadas que
--      llevan mas de 15 minutos en `analyzing`.
--   3. Devuelve cuantos jobs encolo. Una conexion que falla se avisa con
--      RAISE WARNING y NO frena a las demas.
--
-- Es SECURITY DEFINER y nadie con sesion la puede ejecutar. Aditiva e
-- idempotente. Aplicarla antes de desplegar el codigo es inofensivo: sin una
-- conexion de Fathom (no se puede conectar hasta desplegar) no encola nada.
--
-- Como volver atras:
--   SELECT cron.unschedule('fathom-sync');
--   DROP FUNCTION IF EXISTS private.enqueue_fathom_sync();
--   UPDATE public.scheduled_jobs SET status = 'cancelled' WHERE type = 'fathom_sync' AND status = 'pending';
-- ============================================================================

CREATE OR REPLACE FUNCTION private.enqueue_fathom_sync()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conn record;
  v_slot bigint := floor(extract(epoch FROM now()) / 600);
  v_enqueued integer := 0;
BEGIN
  FOR v_conn IN
    SELECT c.id
    FROM public.oauth_connections c
    WHERE c.provider = 'fathom'
      AND c.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.workspace_members m
        WHERE m.workspace_id = c.workspace_id AND m.user_id = c.user_id
      )
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.scheduled_jobs j
        WHERE j.type = 'fathom_sync'
          AND j.status IN ('pending', 'processing')
          AND j.dedupe_key LIKE 'fathom_sync:' || v_conn.id::text || ':%'
      ) THEN
        INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
        VALUES (
          'fathom_sync',
          jsonb_build_object('connectionId', v_conn.id),
          now(),
          'fathom_sync:' || v_conn.id::text || ':' || v_slot::text
        )
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
        IF FOUND THEN
          v_enqueued := v_enqueued + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_fathom_sync: no pude encolar la conexion %: %', v_conn.id, SQLERRM;
    END;
  END LOOP;

  -- Un analisis que se quedo en `analyzing` (el proceso murio a la mitad) vuelve a la fila.
  BEGIN
    UPDATE public.calls
       SET analysis_status = 'pending', analysis_status_reason = 'stuck'
     WHERE analysis_status = 'analyzing'
       AND updated_at < now() - interval '15 minutes';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_fathom_sync: no pude barrer los analisis trabados: %', SQLERRM;
  END;

  RETURN v_enqueued;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_fathom_sync() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fathom-sync') THEN
    PERFORM cron.unschedule('fathom-sync');
  END IF;
END $$;

SELECT cron.schedule('fathom-sync', '*/10 * * * *', $$SELECT private.enqueue_fathom_sync()$$);
