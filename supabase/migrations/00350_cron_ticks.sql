-- ============================================================================
-- 00350: un solo trabajo de pg_cron por frecuencia
-- ============================================================================
--
-- Por que: despues de la 00327 (las guardas) los cron casi no llaman a la app,
-- pero pg_cron sigue haciendo ~18.000 corridas por dia. Cada corrida le cuesta
-- a la base lo mismo aunque no haga nada:
--   - abre una conexion nueva (cron.use_background_workers = off en Supabase):
--     ~400 ms de promedio por corrida el 8/11/2026, y 316 corridas fallaron con
--     "job startup timeout" mientras la base estaba saturada;
--   - escribe tres veces en cron.job_run_details (alta, arranque y fin), que es
--     una tabla con WAL. cron.log_run no se puede apagar en Supabase.
--
-- Que hace (sin cambiar lo que hace el sistema): junta en UN trabajo los cron
-- que corren con la misma frecuencia. Cada parte va en su propio bloque
-- BEGIN ... EXCEPTION, asi una que falla no frena a las otras.
--
--   every-15-seconds  (15 s)            agent-bursts + send-queue
--   every-minute      (* * * * *)       automation-events + jobs + sequences
--   every-5-minutes   (3-59/5 * * * *)  agent-drafts-sweep + draft-window-alerts
--                                       + drafts-refresh + whatsapp-health
--
-- El de 5 minutos corre en los minutos 3, 8, 13... (antes en 0, 5, 10...): asi
-- no arranca junto con los de cada 10 y 15 minutos (fathom-sync, bg-dispatch,
-- bg-collect, inactivity, eod-reminders-enqueue) ni con los de cada hora (7, 10,
-- 15, 17 y 30). Que corra 3 minutos mas tarde no cambia nada: ninguno de los cuatro
-- depende de la hora exacta.
--
-- Cuentas (por dia): 2 x 5.760 + 3 x 1.440 + 4 x 288 = 16.992 corridas pasan a
-- 5.760 + 1.440 + 288 = 7.488. Son 9.504 corridas, 9.504 conexiones y 28.512
-- escrituras en cron.job_run_details menos por dia.
--
-- Lo que se mantiene igual:
--   - private.call_app_cron_if_work y las guardas de la 00327: cada parte de la
--     app sigue pasando por su guarda, con la misma llamada de seguridad.
--   - private.alert_draft_windows y private.sweep_agent_drafts: se llaman igual
--     que antes (las definiciones de la base no se tocan).
--   - Las llamadas a la app salen con pg_net: net.http_get solo encola el
--     pedido, que sale cuando el trabajo termina. Juntar las partes no las
--     pone en fila detras de un pedido HTTP.
--
-- Lo que cambia y hay que saber:
--   1. Una corrida es UNA transaccion. Si una parte falla con un error que se
--      ataja (casi todos), se deshace solo esa parte. Si fallara con uno que no
--      se ataja (cancelar la consulta a mano), se deshace la corrida entera: el
--      estado de las guardas tambien, asi que el tic siguiente vuelve a llamar.
--      No se pierde trabajo, se corre un tic mas tarde.
--   2. cron.job_run_details ya no muestra el error de una parte (la corrida
--      dice "succeeded"). El error queda en private.cron_tick_errors (UNLOGGED:
--      sin WAL) y en el log de Postgres (RAISE WARNING). Lo muestra
--      scripts/measure-cron-load.mjs.
--   3. lock_timeout de 10 s por corrida: una parte que espera un candado (un
--      UPDATE de sweep_agent_drafts sobre un borrador que otra transaccion tiene
--      tomado) falla esa vez en lugar de frenar a las demas. Se reintenta en el
--      tic siguiente, que es lo que ya pasaba cuando una corrida fallaba.
--   4. Dentro de una corrida las partes corren en orden: el barrido de
--      borradores vencidos (agent-drafts-sweep) va antes que los avisos de
--      ventana y que la guarda de drafts-refresh, asi no avisan ni refrescan un
--      borrador que el barrido acaba de vencer.
--
-- Parte de la base: lee cron.job y aborta si alguno de los nueve cron ya no
-- tiene el comando que dejo la 00327 o esta apagado (no se junta algo que
-- alguien cambio sin mirar). Idempotente: una segunda pasada no encuentra los
-- nueve viejos y vuelve a dejar los tres nuevos igual.
--
-- Aditiva: puede ir antes o despues del deploy (el codigo de la app no cambia).
--
-- ---------------------------------------------------------------------------
-- Leido de la base el 8/11/2026 05:10 UTC (con la 00327 aplicada) y vuelto a
-- leer el 8/11/2026 ~18:30 UTC, con la base hasta la 00348: los nueve comandos y
-- las cuatro huellas son las mismas, y ninguna migracion posterior sumo un cron
-- de 15 s, 1 minuto o 5 minutos.
--
-- cron.job (jobname | schedule | command):
--   agent-bursts         | 15 seconds  | SELECT private.call_app_cron_if_work('agent-bursts', interval '10 minutes')
--   send-queue           | 15 seconds  | SELECT private.call_app_cron_if_work('send-queue', interval '10 minutes')
--   automation-events    | * * * * *   | SELECT private.call_app_cron_if_work('automation-events', interval '10 minutes')
--   jobs                 | * * * * *   | SELECT private.call_app_cron_if_work('jobs', interval '10 minutes')
--   sequences            | * * * * *   | SELECT private.call_app_cron_if_work('sequences', interval '10 minutes')
--   agent-drafts-sweep   | */5 * * * * | SELECT private.sweep_agent_drafts()
--   draft-window-alerts  | */5 * * * * | SELECT private.alert_draft_windows()
--   drafts-refresh       | */5 * * * * | SELECT private.call_app_cron_if_work('drafts-refresh', interval '1 hour')
--   whatsapp-health      | */5 * * * * | SELECT private.call_app_cron_if_work('whatsapp-health', interval '1 hour')
--   (todos activos, usuario postgres, base postgres)
--
-- Las funciones que se llaman y NO se tocan (md5 de pg_get_functiondef):
--   private.call_app_cron_if_work(text,interval)  988b9d1e0622994ace99215bd9a488a8  -> bigint
--   private.call_app_cron(text)                   fa1c8e4243e54277f5787c5d29ad1a7d  -> bigint
--   private.sweep_agent_drafts()                  6360067849706877b4291de4ac07d3cf  -> jsonb
--   private.alert_draft_windows()                 88a589c216dabdbdc0e09f8c9eaa69b3  -> jsonb
--
-- cron.use_background_workers = off, cron.log_run = on, pg_cron 1.6.4.
--
-- ---------------------------------------------------------------------------
-- Para volver atras (vuelven los nueve trabajos como estaban):
--   SELECT cron.schedule('agent-bursts', '15 seconds', $c$SELECT private.call_app_cron_if_work('agent-bursts', interval '10 minutes')$c$);
--   SELECT cron.schedule('send-queue', '15 seconds', $c$SELECT private.call_app_cron_if_work('send-queue', interval '10 minutes')$c$);
--   SELECT cron.schedule('automation-events', '* * * * *', $c$SELECT private.call_app_cron_if_work('automation-events', interval '10 minutes')$c$);
--   SELECT cron.schedule('jobs', '* * * * *', $c$SELECT private.call_app_cron_if_work('jobs', interval '10 minutes')$c$);
--   SELECT cron.schedule('sequences', '* * * * *', $c$SELECT private.call_app_cron_if_work('sequences', interval '10 minutes')$c$);
--   SELECT cron.schedule('agent-drafts-sweep', '*/5 * * * *', $c$SELECT private.sweep_agent_drafts()$c$);
--   SELECT cron.schedule('draft-window-alerts', '*/5 * * * *', $c$SELECT private.alert_draft_windows()$c$);
--   SELECT cron.schedule('drafts-refresh', '*/5 * * * *', $c$SELECT private.call_app_cron_if_work('drafts-refresh', interval '1 hour')$c$);
--   SELECT cron.schedule('whatsapp-health', '*/5 * * * *', $c$SELECT private.call_app_cron_if_work('whatsapp-health', interval '1 hour')$c$);
--   SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('every-15-seconds', 'every-minute', 'every-5-minutes');
-- (todo en la misma transaccion; las funciones nuevas pueden quedar, no las llama nadie)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Lo que esta migracion necesita de la base
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('private.call_app_cron_if_work(text,interval)') IS NULL THEN
    RAISE EXCEPTION '00350: falta private.call_app_cron_if_work (la 00327 va antes)';
  END IF;
  IF to_regprocedure('private.sweep_agent_drafts()') IS NULL OR to_regprocedure('private.alert_draft_windows()') IS NULL THEN
    RAISE EXCEPTION '00350: falta private.sweep_agent_drafts o private.alert_draft_windows';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Donde queda el error de una parte (UNLOGGED: sin WAL; vacia es valida)
-- ----------------------------------------------------------------------------
CREATE UNLOGGED TABLE IF NOT EXISTS private.cron_tick_errors (
  -- La parte: la ruta de la app ('jobs', 'send-queue'...) o el cron de la base ('agent-drafts-sweep').
  part text PRIMARY KEY,
  error_count bigint NOT NULL DEFAULT 0,
  last_error_at timestamptz NOT NULL,
  -- El mensaje del error (SQLERRM), recortado. Nunca lleva el secreto del cron: call_app_cron no lo pone en sus errores.
  last_error text NOT NULL,
  counted_since timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.cron_tick_errors FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE private.cron_tick_errors IS
  'Errores de las partes de los cron agrupados (00350): cuantos y el ultimo. UNLOGGED a proposito: sin WAL, y se vacia si la base se reinicia.';

-- Anota el error de una parte. Nunca lanza: si no puede anotar, avisa en el log
-- y la corrida sigue con la parte siguiente.
CREATE OR REPLACE FUNCTION private.cron_tick_note_error(p_part text, p_error text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  RAISE WARNING 'cron %: %', p_part, p_error;
  BEGIN
    INSERT INTO private.cron_tick_errors AS e (part, error_count, last_error_at, last_error)
    VALUES (p_part, 1, now(), left(COALESCE(p_error, '(sin mensaje)'), 500))
    ON CONFLICT (part) DO UPDATE
      SET error_count = e.error_count + 1, last_error_at = EXCLUDED.last_error_at, last_error = EXCLUDED.last_error;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'cron_tick_errors(%) no se pudo anotar: %', p_part, SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION private.cron_tick_note_error(text, text) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Los tres trabajos. Cada parte en su bloque: una que falla no frena a las
--    otras. Gemela: CRON_TICKS en lib/cron/ticks.json (lib/cron/guards.test.ts
--    compara esta lista con la de cada guarda).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.cron_tick_15_seconds()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
SET lock_timeout TO '10s'
AS $$
BEGIN
  BEGIN
    PERFORM private.call_app_cron_if_work('agent-bursts', interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('agent-bursts', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('send-queue', interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('send-queue', SQLERRM);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION private.cron_tick_minute()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
SET lock_timeout TO '10s'
AS $$
BEGIN
  BEGIN
    PERFORM private.call_app_cron_if_work('automation-events', interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('automation-events', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('jobs', interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('jobs', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('sequences', interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('sequences', SQLERRM);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION private.cron_tick_5_minutes()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
SET lock_timeout TO '10s'
AS $$
BEGIN
  -- Primero se vencen los borradores cuya ventana ya cerro: los avisos y la
  -- guarda de drafts-refresh, que van despues, ya no los ven.
  BEGIN
    PERFORM private.sweep_agent_drafts();
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('agent-drafts-sweep', SQLERRM);
  END;

  BEGIN
    PERFORM private.alert_draft_windows();
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('draft-window-alerts', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('drafts-refresh', interval '1 hour');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('drafts-refresh', SQLERRM);
  END;

  BEGIN
    PERFORM private.call_app_cron_if_work('whatsapp-health', interval '1 hour');
  EXCEPTION WHEN OTHERS THEN
    PERFORM private.cron_tick_note_error('whatsapp-health', SQLERRM);
  END;
END;
$$;

REVOKE ALL ON FUNCTION private.cron_tick_15_seconds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_tick_minute() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cron_tick_5_minutes() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.cron_tick_15_seconds() IS
  'Cron every-15-seconds (00350): agent-bursts y send-queue, cada uno por su guarda y en su bloque.';
COMMENT ON FUNCTION private.cron_tick_minute() IS
  'Cron every-minute (00350): automation-events, jobs y sequences, cada uno por su guarda y en su bloque.';
COMMENT ON FUNCTION private.cron_tick_5_minutes() IS
  'Cron every-5-minutes (00350): sweep_agent_drafts, alert_draft_windows, drafts-refresh y whatsapp-health, cada uno en su bloque.';

-- ----------------------------------------------------------------------------
-- 3. Los nueve cron pasan a ser tres. Se comprueba que cada uno siga como lo
--    dejo la 00327 antes de sacarlo; los tres nuevos se agendan en la misma
--    transaccion, asi nunca hay un momento sin cron.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_old CONSTANT jsonb := jsonb_build_object(
    'agent-bursts', 'SELECT private.call_app_cron_if_work(''agent-bursts'', interval ''10 minutes'')',
    'send-queue', 'SELECT private.call_app_cron_if_work(''send-queue'', interval ''10 minutes'')',
    'automation-events', 'SELECT private.call_app_cron_if_work(''automation-events'', interval ''10 minutes'')',
    'jobs', 'SELECT private.call_app_cron_if_work(''jobs'', interval ''10 minutes'')',
    'sequences', 'SELECT private.call_app_cron_if_work(''sequences'', interval ''10 minutes'')',
    'agent-drafts-sweep', 'SELECT private.sweep_agent_drafts()',
    'draft-window-alerts', 'SELECT private.alert_draft_windows()',
    'drafts-refresh', 'SELECT private.call_app_cron_if_work(''drafts-refresh'', interval ''1 hour'')',
    'whatsapp-health', 'SELECT private.call_app_cron_if_work(''whatsapp-health'', interval ''1 hour'')'
  );
  r record;
BEGIN
  FOR r IN SELECT j.jobname, j.command, j.active FROM cron.job j WHERE v_old ? j.jobname
  LOOP
    IF btrim(r.command, E' ;\n\t') IS DISTINCT FROM v_old ->> r.jobname THEN
      RAISE EXCEPTION '00350: el cron "%" cambio desde la 00327 (hoy: %). Revisalo antes de juntarlo.', r.jobname, r.command;
    END IF;
    IF NOT r.active THEN
      RAISE EXCEPTION '00350: el cron "%" esta apagado. Juntarlo lo prenderia: revisalo antes.', r.jobname;
    END IF;
  END LOOP;

  PERFORM cron.schedule('every-15-seconds', '15 seconds', 'SELECT private.cron_tick_15_seconds()');
  PERFORM cron.schedule('every-minute', '* * * * *', 'SELECT private.cron_tick_minute()');
  PERFORM cron.schedule('every-5-minutes', '3-59/5 * * * *', 'SELECT private.cron_tick_5_minutes()');

  PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE v_old ? j.jobname;
END $$;
