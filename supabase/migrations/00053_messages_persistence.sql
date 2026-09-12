-- ============================================================================
-- 00053 — Persistencia de mensajes: workspace_id, autoria del agente e interruptor
-- ============================================================================
-- Prepara la tabla `messages` para que empiece a recibir los entrantes de TODOS
-- los canales, incluidos los DMs de Instagram que hasta ahora no se guardaban
-- (Zernio era la fuente de verdad y la bandeja le pedia el hilo por API).
--
-- Tres cosas:
--
-- 1. `workspace_id` denormalizado. Hasta hoy el aislamiento se resolvia por
--    join contra `conversations`, y alcanzaba porque casi nadie consultaba
--    `messages`. Los dashboards de la Fase 3 agrupan por dia, canal y direccion
--    sobre esta tabla, que va a ser la mas grande del sistema: sin la columna,
--    cada consulta arrastra un join. La tabla tiene 0 filas hoy, asi que es el
--    momento mas barato para agregarla.
--
-- 2. `sent_by_agent_id`, para distinguir lo que manda el agente de IA de lo que
--    manda una persona (`sent_by_user_id`) o un flow (`sent_by_flow_id`).
--
-- 3. El interruptor `workspaces.persist_zernio_inbound`, para poder apagar el
--    guardado de los entrantes de Zernio sin un deploy.
--
-- Lo que NO se hace aca, a proposito:
--   - `deleted_at` en messages. El borrado es fisico: messages.conversation_id
--     y conversations.contact_id son ON DELETE CASCADE, asi que purge_soft_deleted
--     (00025) ya se lleva los mensajes de un contacto purgado. Un soft delete
--     dejaria el texto del lead en la base aparentando estar borrado, que es lo
--     contrario de lo que exigen las reglas de retencion de Meta.
--   - `agent_run_id`. Es del Bloque 2, junto con la tabla `agent_runs`.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. workspace_id en messages
-- ------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.messages.workspace_id IS
  'Denormalizado desde conversations. Lo completa el trigger messages_fill_workspace_id, asi que ningun insert tiene que acordarse. Existe para que los dashboards agrupen sin join; NO reemplaza al EXISTS de la policy, que es de donde sale el scope de leads.';

-- Las filas que ya estaban (los de WhatsApp y los salientes de flow).
UPDATE public.messages m
   SET workspace_id = c.workspace_id
  FROM public.conversations c
 WHERE c.id = m.conversation_id
   AND m.workspace_id IS NULL;

-- NOT NULL solo si quedo todo completo. Mismo criterio que la 00038: una fila
-- huerfana no puede bloquear la migracion entera, pero tiene que avisar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE workspace_id IS NULL) THEN
    ALTER TABLE public.messages ALTER COLUMN workspace_id SET NOT NULL;
  ELSE
    RAISE WARNING 'Quedan mensajes sin workspace_id: la columna queda opcional. Revisar filas huerfanas.';
  END IF;
END $$;

-- Lo mantiene al dia sin que el codigo tenga que acordarse. Hace falta porque
-- hay seis lugares que insertan en messages sin pasar por insertMessage
-- (flow-engine/send.ts, los nodos send-message y comment-reply, ai-response y
-- el envio manual de /api/v1/messages): confiar en que cada uno mande la
-- columna es confiar en acordarse seis veces, y en la septima.
CREATE OR REPLACE FUNCTION public.messages_set_workspace_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT c.workspace_id INTO NEW.workspace_id
      FROM public.conversations c WHERE c.id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Un trigger corre con los privilegios del dueño de la tabla, no del invocante:
-- revocar EXECUTE no lo afecta. Es lo que pide la 00048 para que el linter no
-- la reporte.
REVOKE ALL ON FUNCTION public.messages_set_workspace_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_fill_workspace_id ON public.messages;
CREATE TRIGGER messages_fill_workspace_id
  BEFORE INSERT OR UPDATE OF conversation_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_set_workspace_id();

-- ------------------------------------------------------------
-- 2. Autoria del agente de IA
-- ------------------------------------------------------------
-- SIN foreign key a proposito: la tabla `agents` todavia no existe, se crea en
-- el Bloque 2 de esta fase.
--
--   >>> BLOQUE 2: agregar aca la constraint cuando exista `agents`:
--   >>> ALTER TABLE public.messages
--   >>>   ADD CONSTRAINT messages_sent_by_agent_id_fkey
--   >>>   FOREIGN KEY (sent_by_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;
--
-- Y en esa misma migracion va `agent_run_id`, que tampoco se crea aca.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sent_by_agent_id uuid;

COMMENT ON COLUMN public.messages.sent_by_agent_id IS
  'Que agente de IA mando este mensaje. Sin FK todavia: la tabla agents se crea en el Bloque 2 de la Fase 3, que es donde hay que agregar la constraint.';

-- ------------------------------------------------------------
-- 3. Indices para los dashboards del Bloque 3
-- ------------------------------------------------------------
-- El grafico es un GROUP BY por dia y direccion dentro de un rango de fechas.
-- Con estos dos, y la columna recien agregada, sale del indice sin tocar
-- conversations.

CREATE INDEX IF NOT EXISTS idx_messages_workspace_created
  ON public.messages(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_direction_created
  ON public.messages(workspace_id, direction, created_at);

-- Para el "abrir el run que genero este mensaje" del Bloque 2, y para que
-- desactivar un agente no obligue a un seq scan.
CREATE INDEX IF NOT EXISTS idx_messages_sent_by_agent
  ON public.messages(sent_by_agent_id) WHERE sent_by_agent_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. El interruptor del guardado de entrantes de Zernio
-- ------------------------------------------------------------
-- Un registro en la base y no una variable de entorno: apagarlo no puede
-- depender de un deploy. Mismo patron que lead_scope_enabled (00018/00024).
--
-- Arranca en true: los mensajes no son retroactivos mas alla de los ~500 por
-- conversacion que devuelve la API de Zernio, asi que cada dia apagado es
-- historia que no se recupera. Si la confirmacion de los terminos de Zernio y
-- Meta sale mal, se apaga desde Ajustes y se purga lo guardado.
--
-- Solo gobierna los entrantes de los canales de Zernio. Los de WhatsApp
-- (Evolution) y los salientes se guardan siempre: para WhatsApp esta tabla es
-- la unica fuente del hilo, apagarlo vaciaria la bandeja.
--
-- No hace falta policy nueva: workspaces_update ya es Owner/Admin (00018).

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS persist_zernio_inbound boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workspaces.persist_zernio_inbound IS
  'Si se guardan localmente los mensajes entrantes de los canales de Zernio (Instagram). Apagado, el receptor no inserta y el sistema se comporta como antes de la Fase 3. No afecta a WhatsApp ni a los salientes.';
