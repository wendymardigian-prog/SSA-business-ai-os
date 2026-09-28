-- ============================================================================
-- 00101 — Idempotencia del despacho de tareas de IA en segundo plano
-- ============================================================================
-- El problema: `bg-dispatch` inserta un `scheduled_jobs` por ventana confiando
-- en `uq_scheduled_jobs_dedupe_pending` (00061), que es UNICO SOLO ENTRE LOS
-- PENDING. Cuando el job se completa, la fila sale del indice y el cron de los
-- 15 minutos siguientes vuelve a insertar la misma clave. Y otra vez. Para
-- siempre, mientras la ventana siga vigente. Al 28/9/2026 habia 229 filas
-- `bg_task` para 23 ventanas distintas: 96 de ellas de la misma clave.
--
-- Hoy es gratis porque el handler de `bg_task` no hace nada. Con el
-- clasificador implementado serian 96 clasificaciones del mismo dia.
--
-- 1. Se borran los jobs que nunca trabajaron, y los huerfanos de workspaces
--    borrados (20 al 28/9). Tiene que ir ANTES del indice: con 96 duplicados
--    vivos, el CREATE UNIQUE INDEX falla.
--
-- 2. Un indice unico ACOTADO A `bg_task`, sin filtro de estado. La ventana no
--    se vuelve a despachar sin importar como haya quedado el job.
--
--    Por que no un unico total sobre `dedupe_key`: romperia dos mecanismos que
--    NECESITAN repetir la clave despues de que la fila anterior dejo de estar
--    pending.
--      - `agent_burst`: la 00061 (lineas 20-24) documenta la parcialidad como
--        diseno. Cuando el turno pasa a processing la fila sale del indice, y
--        un mensaje que llega mientras el agente genera inserta una fila
--        pending nueva con la misma clave para abrir la ventana siguiente. Con
--        un unico total ese mensaje no tendria donde anotarse. Ademas la
--        clausula `ON CONFLICT (dedupe_key) WHERE ... status='pending'` de
--        `push_debounced_job` dejaria de poder inferir su indice.
--      - `booking_relative_trigger`: `syncRelativeJobs` CANCELA Y REINSERTA la
--        misma clave, y `backfillRelativeJobs` (al prender un flujo de evento)
--        lo hace con el mismo `reschedule_count`.
--
--    El predicado `type = 'bg_task'` no puede satisfacer el WHERE de la
--    clausula de inferencia de `push_debounced_job`, asi que esa RPC sigue
--    apuntando a `uq_scheduled_jobs_dedupe_pending`, intacto.
--
-- Consecuencia aceptada: si el job de una ventana termina en `failed` (agoto
-- sus 3 reintentos), esa ventana no se reencola. No se pierde trabajo: la
-- seleccion del clasificador no mira ventanas, asi que la corrida del dia
-- siguiente toma los mismos pendientes. Solo se posterga.
--
-- Idempotente. Borra datos, y solo los que se explican arriba.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Limpieza
-- ------------------------------------------------------------

-- Los `bg_task` anteriores al 29/9/2026: todos completaron sin hacer nada,
-- porque el handler era `async () => {}`. La fecha de corte hace este DELETE
-- seguro si la migracion se vuelve a correr: no puede borrar un job legitimo
-- encolado despues de que exista el handler de verdad.
DELETE FROM public.scheduled_jobs
 WHERE type = 'bg_task'
   AND created_at < TIMESTAMPTZ '2026-09-29 00:00:00+00';

-- Huerfanos: el workspace del payload ya no existe. `scheduled_jobs` no tiene
-- columna `workspace_id` (va en el payload), asi que no hay FK que los limpie.
-- Sin fecha de corte: un job de un workspace borrado nunca es valido.
DELETE FROM public.scheduled_jobs
 WHERE type = 'bg_task'
   AND payload ? 'workspaceId'
   AND NOT EXISTS (
     SELECT 1 FROM public.workspaces w
      WHERE w.id::text = public.scheduled_jobs.payload ->> 'workspaceId'
   );

-- ------------------------------------------------------------
-- 2. El indice
-- ------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_jobs_bg_task_dedupe
  ON public.scheduled_jobs (dedupe_key)
  WHERE type = 'bg_task' AND dedupe_key IS NOT NULL;

COMMENT ON INDEX public.uq_scheduled_jobs_bg_task_dedupe IS
  'Una ventana de tarea en segundo plano se despacha UNA vez, en cualquier estado que haya quedado el job. Acotado a bg_task para no tocar la ventana de agent_burst ni el re-planificado de los avisos de agenda, que necesitan repetir su clave.';
