-- ============================================================================
-- 00055 — Retencion de los mensajes crudos (F20)
-- ============================================================================
-- Desde la 00053 se guardan los entrantes de todos los canales, incluido el
-- contenido de los DMs de Instagram. Guardar texto de leads sin una fecha de
-- vencimiento no es una tabla que crece: es un compromiso que no se esta
-- cumpliendo. Esta migracion le pone el vencimiento.
--
-- **Politica: 12 meses para los mensajes crudos.** Los agregados que alimenten
-- los dashboards (Bloque 3) son otra cosa y se conservan indefinidamente: son
-- conteos por dia, canal y direccion, sin texto ni datos personales. La linea
-- divisoria es esa — lo que tiene contenido del lead vence, lo que es un numero
-- no.
--
-- Que NO borra esta purga, y por que:
--
--   - **Los mensajes de un contacto marcado "no contactar".** Esa marca dice
--     que no le escribamos mas, no que borremos lo que dijo. Borrarlos ademas
--     dejaria al operador sin el contexto de por que pidio la baja, que es
--     justo lo que necesita para no volver a equivocarse. Siguen la retencion
--     normal de 12 meses como cualquier otro.
--
--   - **Los mensajes de un contacto borrado.** No hacen falta reglas nuevas:
--     messages.conversation_id y conversations.contact_id son ON DELETE
--     CASCADE, asi que cuando purge_soft_deleted (00025) borra el contacto a
--     los 30 dias del soft delete, sus mensajes se van con el. El borrado en
--     cascada ya existia; lo que faltaba era el vencimiento por antiguedad.
--
-- Los mensajes no tienen deleted_at: el borrado es fisico. Es lo que
-- corresponde cuando lo que se promete es borrar de verdad.
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purge_old_messages(
  p_retention_months integer DEFAULT 12,
  p_batch_size       integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff  timestamptz := now() - make_interval(months => GREATEST(p_retention_months, 1));
  v_deleted integer := 0;
  v_batch   integer := 0;
  v_rounds  integer := 0;
BEGIN
  -- Por lotes y no de un saque. Todo corre igual dentro de una transaccion
  -- (plpgsql no puede commitear en el medio), asi que esto no libera el lock
  -- entre vueltas; lo que evita es un unico DELETE enorme la primera vez que
  -- corra sobre una tabla con anios de historia. A la escala de una agencia el
  -- borrado diario es de unos pocos miles de filas y termina al instante.
  LOOP
    DELETE FROM public.messages
    WHERE id IN (
      SELECT id FROM public.messages
      WHERE created_at < v_cutoff
      ORDER BY created_at
      LIMIT GREATEST(p_batch_size, 1)
    );

    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_deleted := v_deleted + v_batch;
    v_rounds  := v_rounds + 1;

    EXIT WHEN v_batch = 0;

    -- Freno de mano: 200 lotes son un millon de filas. Si un dia hiciera falta
    -- borrar mas que eso de una vez, es una migracion pensada, no un cron que
    -- se queda toda la noche tomando la tabla del inbox.
    IF v_rounds >= 200 THEN
      RAISE WARNING 'purge_old_messages corto en % lotes (% filas). Queda historia por borrar: volve a correrla.', v_rounds, v_deleted;
      EXIT;
    END IF;
  END LOOP;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.purge_old_messages(integer, integer) IS
  'Borra los mensajes de mas de N meses (default 12). Politica de retencion de la Fase 3. No distingue canal ni contacto: un mensaje de un contacto "no contactar" vence igual que cualquier otro, y los de un contacto borrado ya se van por cascade con purge_soft_deleted. La llama el cron diario.';

REVOKE ALL ON FUNCTION public.purge_old_messages(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_messages(integer, integer) TO service_role;

-- ------------------------------------------------------------
-- El cron
-- ------------------------------------------------------------
-- SQL directo, sin dar la vuelta por HTTP: es puro SQL y no necesita nada de la
-- app, igual que purge_soft_deleted. Dar la vuelta por la red solo sumaria un
-- punto de falla.
--
-- 5:00. Las purgas van encadenadas cada 10 minutos desde las 4:00 y los seis
-- slots de esa hora ya estan tomados (:00 borrados, :10 pg_net, :20 ventanas de
-- envio, :30 trigger_fires, :40 automation_events, :50 notificaciones).

DO $$
BEGIN
  PERFORM cron.unschedule('ssa-cron-purge-messages');
EXCEPTION
  WHEN OTHERS THEN NULL;  -- todavia no existia
END $$;

SELECT cron.schedule(
  'ssa-cron-purge-messages',
  '0 5 * * *',
  $$SELECT public.purge_old_messages(12)$$
);
