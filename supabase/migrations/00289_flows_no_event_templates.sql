-- 00289_flows_no_event_templates
--
-- "Reuniones sin evento" (Agenda → Configuración): los flujos de las reuniones con
-- titulo libre son del negocio, no de un evento (`flows.event_type_id` queda null), y
-- los crea `ensureNoEventFlows` al abrir la seccion.
--
-- Este indice es lo que impide que dos pedidos a la vez creen dos veces el mismo flujo:
-- prendidos los dos, el invitado recibiria dos confirmaciones.
--
-- Aditiva. Va ANTES de desplegar el codigo. Para volver atras:
--   DROP INDEX IF EXISTS public.uq_flows_no_event_template;

CREATE UNIQUE INDEX IF NOT EXISTS uq_flows_no_event_template
  ON public.flows (workspace_id, template_key)
  WHERE event_type_id IS NULL AND template_key LIKE 'no\_event\_%';
