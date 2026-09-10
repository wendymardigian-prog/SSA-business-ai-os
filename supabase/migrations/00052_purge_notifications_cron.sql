-- ============================================================================
-- 00052 — Agendar la purga de notificaciones leidas (F18)
-- ============================================================================
-- La funcion purge_read_notifications quedo creada en la 00051 pero no la
-- llamaba nadie: una funcion de purga sin cron es una tabla que crece igual.
--
-- Va por SQL directo y no por HTTP, como purge_soft_deleted: es puro SQL, no
-- necesita Storage ni nada de la app, y dar la vuelta por la red solo suma un
-- punto de falla.
--
-- Los documentos borrados de la base de conocimiento NO se purgan aca. Esos si
-- necesitan borrar el archivo del bucket de Storage, y eso desde SQL no se
-- puede: lo hace la app, en /api/cron/jobs. Borrar la fila desde aca dejaria el
-- archivo huerfano para siempre.
--
-- Idempotente: cron.unschedule antes de agendar, envuelto para que no falle si
-- el job todavia no existe.
-- ============================================================================

DO $$
BEGIN
  PERFORM cron.unschedule('ssa-cron-purge-notifications');
EXCEPTION
  WHEN OTHERS THEN NULL;  -- todavia no existia
END $$;

-- 4:50: las otras purgas ya ocupan :00, :10, :20, :30 y :40.
SELECT cron.schedule(
  'ssa-cron-purge-notifications',
  '50 4 * * *',
  $$SELECT public.purge_read_notifications(60)$$
);
