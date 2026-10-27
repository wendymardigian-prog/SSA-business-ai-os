/**
 * Las acciones que el agente ejecuta, con su etiqueta. Puro y sin dependencias
 * de servidor: lo leen la pestana Acciones y el panel "Que hizo el agente" de
 * la bandeja (que corre en el navegador).
 */
export const AGENT_ACTION_LABELS: Record<string, string> = {
  tag: "Etiquetó",
  temperature: "Cambió la temperatura",
  // Pipeline (00245).
  setter_status: "Cambió el estado de setter",
  followup: "Programó el seguimiento",
  assign: "Asignó la conversación",
  human_takeover: "Derivó a una persona",
  agent_paused: "Se pausó",
  summary: "Guardó el resumen",
  whatsapp_handoff: "Pasó el lead a WhatsApp",
  update: "Se apagó por tope de gasto",
  // Tareas (Extra A): lo que el agente deja pendiente para el equipo.  @plantilla-quitar(tareas)
  "task.created": "Creó una tarea", // @plantilla-quitar(tareas)
};
