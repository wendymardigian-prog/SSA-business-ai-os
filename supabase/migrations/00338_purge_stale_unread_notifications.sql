-- ============================================================================
-- 00338 — Los avisos sin leer tambien se purgan, a los 60 dias
-- ============================================================================
--
-- Por que: la 00051 decidio que un aviso NO leido no se borra nunca ("si nadie
-- lo vio, sigue pendiente"), y `purge_read_notifications` solo borra los
-- leidos. En la practica casi nadie marca los avisos: en produccion, el
-- 8/11/2026, los 961 avisos del negocio estaban todos sin leer, y crecen unos
-- 100 por dia (sobre todo "respuesta de formulario" y "borrador por vencer").
-- Sin purga la tabla crece para siempre, y todo lo que la recorre (la campana,
-- "Marcar todas", la RLS) se vuelve cada vez mas lento.
--
-- Por que 60 dias (la misma vara que los leidos):
--   - Un aviso de hace dos meses ya no lo ve nadie: la campana muestra los 20
--     mas nuevos (con ~100 por dia, un aviso sale de la vista en horas).
--   - Una sola regla, facil de explicar: "un aviso de mas de 60 dias se borra,
--     leido o no".
--   - No rompe ningun "una vez" que se apoya en los avisos: el aviso previo del
--     tope de gasto de IA ("una vez por periodo", lib/ai/spend-alerts.ts) mira
--     periodos de hasta un mes, y "una vez cada 10 minutos" / el recordatorio
--     del EOD miran minutos u horas.
--   - Lo unico que puede volver a avisar es una tarea vencida hace mas de 60
--     dias y todavia abierta (`tasks-due-sweep` avisa una vez por tarea y fecha
--     de vencimiento mirando los avisos): vuelve a aparecer en la campana una
--     vez cada 60 dias. Es lo mismo que ya pasa hoy con un aviso leido, y un
--     recordatorio de algo que sigue vencido no hace mal.
--   - Hoy no borra nada: el aviso sin leer mas viejo es del 29/9/2026.
--
-- Que hace: una funcion nueva, `purge_stale_unread_notifications(dias)`, solo
-- `service_role`, y el cron diario `purge-notifications` (00052) pasa a llamar a
-- las dos en la misma sentencia. `purge_read_notifications` no cambia.
--
-- Idempotente. Para volver atras:
--   SELECT cron.schedule('purge-notifications', '50 4 * * *',
--     $$SELECT public.purge_read_notifications(60)$$);
--   DROP FUNCTION IF EXISTS public.purge_stale_unread_notifications(integer);
-- (el comando de antes, el de la 00052).
--
-- Se aplica en produccion SOLO con el OK de Wendy.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purge_stale_unread_notifications(p_retention_days integer DEFAULT 60)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  -- Nunca menos de 30 dias: un aviso de la semana pasada sin leer todavia sirve.
  DELETE FROM public.notifications
  WHERE read_at IS NULL
    AND created_at < now() - make_interval(days => GREATEST(p_retention_days, 30));

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.purge_stale_unread_notifications(integer) IS
  'Borra las notificaciones SIN LEER de mas de N dias (minimo 30). Las leidas las borra purge_read_notifications. La llama el cron diario purge-notifications (00338).';

REVOKE ALL ON FUNCTION public.purge_stale_unread_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_stale_unread_notifications(integer) TO service_role;

-- El comentario de la 00051 decia que las no leidas no se tocaban nunca.
COMMENT ON FUNCTION public.purge_read_notifications(integer) IS
  'Borra las notificaciones LEIDAS de mas de N dias. Las no leidas de mas de 60 dias las borra purge_stale_unread_notifications (00338). La llama el cron diario.';

-- El mismo cron, a la misma hora: ahora purga las dos. Por SQL directo (00052).
DO $$
BEGIN
  PERFORM cron.unschedule('purge-notifications');
EXCEPTION
  WHEN OTHERS THEN NULL;  -- todavia no existia
END $$;

SELECT cron.schedule(
  'purge-notifications',
  '50 4 * * *',
  $$SELECT public.purge_read_notifications(60), public.purge_stale_unread_notifications(60)$$
);
