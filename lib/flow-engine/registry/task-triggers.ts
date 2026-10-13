/**
 * Los dos disparadores de Tareas en el registro (Extra A, F25): `task_completed` y `task_overdue`.
 *
 * Son flujos CON O SIN contacto (`contactOptional`): si la tarea tiene contacto, el evento viaja con el contacto y sigue
 * el camino de siempre; si no, viaja con la persona del equipo a cargo (responsable, si no quien la creo) y el flujo corre
 * sin contacto, como los de fin de dia (los pasos que necesitan un contacto se saltean y se anotan).
 *
 * Acá solo se declaran: que evento atiende cada uno, como se filtra y cual es su clave de idempotencia. Las reglas viven
 * puras en `lib/tasks/automation/`. Los eventos llevan solo escalares y nunca `booking_id`.
 */
import { registerTrigger } from "./registry";
import { TASK_EVENT_TYPES } from "@/lib/tasks/automation/payload";
import { parseTaskPayload, taskDedupeKey } from "@/lib/tasks/automation/payload";
import { taskEventMatches } from "@/lib/tasks/automation/trigger-config";
import { TASK_VARIABLE_FIELDS, taskVariables } from "@/lib/tasks/automation/variables";
import { appUrl } from "@/lib/app-url";

const LABELS: Record<(typeof TASK_EVENT_TYPES)[number], string> = {
  task_completed: "Se completó una tarea",
  task_overdue: "Una tarea quedó vencida",
};

for (const type of TASK_EVENT_TYPES) {
  registerTrigger({
    type,
    label: LABELS[type],
    scope: "event",
    // Debajo de `crm_event` (50), igual que agenda, llamadas, formularios y ventas.
    priority: 45,
    // Atiende tambien eventos sin contacto (con la persona del equipo a cargo).
    contactOptional: true,
    eventTypes: [type],

    eventMatches: (args) => taskEventMatches(args.config, args.event.payload),

    dedupeKeyFor: (args) => taskDedupeKey(type, args.event.payload, args.event.id),

    // Lo que un camino condicional puede comparar de la tarea (todo texto).
    variableSchema: () => TASK_VARIABLE_FIELDS.map((f) => ({ path: f.path, label: f.label, type: "text" as const, group: "De la tarea" })),

    variablesFor: async (args) => {
      const payload = parseTaskPayload(args.event.payload);
      if (!payload) return {};
      let ownerName = "";
      try {
        const { data: task } = await args.supabase.from("tasks").select("owner_id").eq("id", payload.task_id).maybeSingle();
        if (task?.owner_id) {
          const { getWorkspaceMembers } = await import("@/lib/workspace-members");
          ownerName = (await getWorkspaceMembers(args.event.workspace_id)).find((m) => m.userId === task.owner_id)?.name ?? "";
        }
      } catch (error) {
        console.error("[tareas] no pude leer el responsable para las variables:", error instanceof Error ? error.message : "error");
      }
      return taskVariables({ payload, ownerName, url: `${appUrl()}/dashboard/tareas?task=${payload.task_id}` });
    },
  });
}
