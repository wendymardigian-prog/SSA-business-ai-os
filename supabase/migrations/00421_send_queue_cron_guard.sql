-- 00421_send_queue_cron_guard.sql · La guarda del cron `send-queue` mira también la cola de WhatsApp (00420).
--
-- Solo AMPLÍA `private.cron_work_send_queue` (00327): la definición de abajo es la que estaba EN LA BASE de producción
-- (leída con pg_get_functiondef el 18/11/2026) más tres comprobaciones sobre `send_queue_items`, y la condición de los
-- broadcasts suma «lo masivo del número no está pausado» (`bulk_paused_at`, 00420). Sin esto, los envíos de
-- las automatizaciones solo saldrían con la llamada de seguridad (cada 10 minutos). `lib/cron/guards.test.ts` ata el
-- umbral de 5 minutos a `QUEUE_STALE_SENDING_MS` (`lib/send-queue/automation/run-queue.ts`).
--
-- Aditiva: misma firma, mismo dueño, mismos permisos. Puede ir antes o después del deploy (sin filas en la cola, las
-- comprobaciones nuevas dan siempre «no hay trabajo»), pero DESPUÉS de la 00420 (lee su tabla).
--
-- Definición anterior, completa (00327, para volver atrás):
--
--   CREATE OR REPLACE FUNCTION private.cron_work_send_queue(p_now timestamp with time zone DEFAULT now())
--    RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_now timestamptz := p_now + interval '5 seconds';
--   BEGIN
--     IF EXISTS (SELECT 1 FROM public.broadcast_recipients r
--       WHERE r.status = 'sending' AND r.claimed_at < v_now - interval '5 minutes') THEN RETURN true; END IF;
--     IF EXISTS (SELECT 1 FROM public.broadcasts b
--       WHERE b.status = 'scheduled' AND b.scheduled_for <= v_now) THEN RETURN true; END IF;
--     IF EXISTS (SELECT 1 FROM public.broadcasts b
--       LEFT JOIN public.channel_send_lanes l ON l.channel_id = b.channel_id
--       WHERE b.status = 'sending' AND b.channel_id IS NOT NULL AND b.created_at <= v_now
--         AND (l.channel_id IS NULL OR (l.paused_at IS NULL AND (l.next_send_at IS NULL OR l.next_send_at <= v_now))))
--     THEN RETURN true; END IF;
--     RETURN false;
--   END;
--   $function$

CREATE OR REPLACE FUNCTION private.cron_work_send_queue(p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := p_now + interval '5 seconds';
BEGIN
  -- Destinatarios que quedaron `sending` (reapStaleSending, STALE_SENDING_MS = 5 min).
  IF EXISTS (
    SELECT 1 FROM public.broadcast_recipients r
    WHERE r.status = 'sending' AND r.claimed_at < v_now - interval '5 minutes'
  ) THEN RETURN true; END IF;

  -- Broadcasts programados cuya hora llego (activateScheduled).
  IF EXISTS (
    SELECT 1 FROM public.broadcasts b
    WHERE b.status = 'scheduled' AND b.scheduled_for <= v_now
  ) THEN RETURN true; END IF;

  -- Broadcasts enviandose cuyo carril puede trabajar (runLane): sin carril
  -- todavia (lo crea), o sin pausa y con next_send_at ya cumplido. Un carril
  -- pausado o esperando no hace nada hasta su hora. 00421: un número con lo
  -- masivo pausado (`bulk_paused_at`) tampoco manda broadcasts.
  IF EXISTS (
    SELECT 1
    FROM public.broadcasts b
    LEFT JOIN public.channel_send_lanes l ON l.channel_id = b.channel_id
    WHERE b.status = 'sending'
      AND b.channel_id IS NOT NULL
      AND b.created_at <= v_now
      AND (l.channel_id IS NULL OR (l.paused_at IS NULL AND l.bulk_paused_at IS NULL AND (l.next_send_at IS NULL OR l.next_send_at <= v_now)))
  ) THEN RETURN true; END IF;

  -- 00421 · Cola de WhatsApp: envíos que quedaron `sending` (el proceso murió a mitad del envío; QUEUE_STALE_SENDING_MS = 5 min).
  IF EXISTS (
    SELECT 1 FROM public.send_queue_items q
    WHERE q.status = 'sending' AND q.claimed_at < v_now - interval '5 minutes'
  ) THEN RETURN true; END IF;

  -- 00421 · Cola de WhatsApp: algo que caduca (aunque el número esté pausado: caducar no manda nada).
  IF EXISTS (
    SELECT 1 FROM public.send_queue_items q
    WHERE q.status IN ('scheduled', 'queued') AND q.expires_at IS NOT NULL AND q.expires_at <= v_now
  ) THEN RETURN true; END IF;

  -- 00421 · Cola de WhatsApp: algo listo para salir (o un programado cuya hora llegó) en un carril que puede trabajar.
  IF EXISTS (
    SELECT 1
    FROM public.send_queue_items q
    LEFT JOIN public.channel_send_lanes l ON l.channel_id = q.channel_id
    WHERE q.status IN ('scheduled', 'queued')
      AND q.scheduled_for <= v_now
      AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= v_now)
      AND (l.channel_id IS NULL OR (l.paused_at IS NULL AND (l.next_send_at IS NULL OR l.next_send_at <= v_now)))
      AND (q.priority <> 'bulk' OR l.bulk_paused_at IS NULL)
  ) THEN RETURN true; END IF;

  RETURN false;
END;
$function$;
