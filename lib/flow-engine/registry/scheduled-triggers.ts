/**
 * «En una fecha y hora» en el registro: `scheduled_time`.
 *
 * Es el primer disparador de SISTEMA (`subject: "system"`): el flujo arranca sin contacto ni persona. No lo levanta el
 * matcher de mensajes ni el cron de `automation_events`: al publicar se agenda un trabajo en la cola para la próxima vez
 * (`lib/scheduled-flows/jobs.ts`) y el trabajo `flow_scheduled_run` corre el flujo y agenda la siguiente. Por eso no
 * declara `eventTypes`.
 *
 * Las reglas viven puras en `lib/scheduled-flows/schedule.ts`; acá solo se declara.
 */
import { registerTrigger } from "./registry";
import { SCHEDULED_TRIGGER_TYPE } from "@/lib/scheduled-flows/schedule";

registerTrigger({
  type: SCHEDULED_TRIGGER_TYPE,
  label: "En una fecha y hora",
  scope: "scheduled",
  priority: 40,
  subject: "system",
  sourceType: "system",
  variableSchema: () => [
    { path: "schedule.date", label: "Fecha", type: "text", group: "Del disparador" },
    { path: "schedule.weekday", label: "Día de la semana", type: "text", group: "Del disparador" },
    { path: "schedule.time", label: "Hora", type: "text", group: "Del disparador" },
  ],
});
