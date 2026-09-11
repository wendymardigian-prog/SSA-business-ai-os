-- ============================================================================
-- 00046 — scheduled_jobs vuelve a ser solo del service role
-- ============================================================================
-- La migracion 00002 la habia dejado bien: RLS habilitada y CERO policies, con
-- el comentario "service role only, no user RLS needed". La 00009 lo revirtio
-- al sumar broadcasts —"Jobs are workspace-agnostic (system-level), so allow
-- authenticated users"— porque el envio de broadcasts insertaba con el cliente
-- del usuario. En vez de mover ese insert a service role, se abrio la tabla.
--
-- Lo que eso dejaba abierto:
--
--   * SELECT con `auth.uid() IS NOT NULL` significa "cualquier usuario logueado
--     del sistema", no "de este workspace" — la tabla no tiene workspace_id,
--     asi que no habia con que filtrar. El payload de los jobs resume_flow
--     (lib/flow-engine/nodes/delay.ts) lleva contactId, conversationId, los ids
--     de Zernio y `variables`, que arrastra el TEXTO DEL MENSAJE del lead. Es
--     fuga de conversaciones y de datos personales entre negocios distintos.
--
--   * UPDATE abierto: marcar los jobs pendientes como completados deja colgados
--     para siempre todos los flows con un nodo de espera.
--
--   * INSERT abierto: encolar un resume_flow con la sesion de otro.
--
-- Se vuelve a deny-all. Ninguna pantalla ni Server Action lee esta tabla: los
-- unicos consumidores son app/api/cron/jobs (service) y los productores
-- lib/flow-engine/nodes/delay.ts y lib/scheduler.ts, este ultimo ya migrado a
-- service client en el commit anterior.
--
-- Por que no se agrega workspace_id: no hay ninguna pantalla que necesite leer
-- la cola, ni esta planificada. Una columna con backfill y policies que nadie
-- usa es costo de mantenimiento sin consumidor. Deny-all ademas es la postura
-- correcta por defecto: el dia que se sume un tipo de job con un payload
-- sensible, la tabla ya esta cerrada.
--
-- Idempotente.
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can insert jobs" ON public.scheduled_jobs;
DROP POLICY IF EXISTS "Authenticated users can read jobs" ON public.scheduled_jobs;
DROP POLICY IF EXISTS "Authenticated users can update jobs" ON public.scheduled_jobs;

-- La RLS ya estaba habilitada desde la 00002; se reafirma por si esta migracion
-- corre sobre una base donde alguien la apago.
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.scheduled_jobs IS
  'Cola interna del motor (delays de flows, entrega de broadcasts). RLS habilitada y SIN POLICIES a proposito: solo el service role entra. No es un descuido — el payload lleva variables de flow y texto de mensajes de los leads, y ninguna pantalla necesita leer esto. Si hace falta exponerla, agregar workspace_id primero.';
