import type { ProposalField } from "./types";

/**
 * Qué permiso hace falta para aprobar la propuesta de cada herramienta del agente: nadie aprueba lo que no
 * podría hacer a mano. Lo que no está en la lista pide `agents.edit` (el más restrictivo de los del módulo).
 * Sin dependencias: lo usan la bandeja y el núcleo.
 */
export const AGENT_TOOL_PERMISSIONS: Record<string, string> = {
  etiquetar_contacto: "contacts.edit",
  cambiar_temperatura: "contacts.edit",
  cambiar_estado_setter: "contacts.edit",
  calificar_lead: "contacts.edit",
  programar_seguimiento: "contacts.edit",
  asignar_conversacion: "contacts.assign",
  crear_tarea: "tasks.edit",
};

export function agentToolPermission(toolKey: string): string {
  return AGENT_TOOL_PERMISSIONS[toolKey] ?? "agents.edit";
}

/**
 * Los campos editables de una propuesta de herramienta del agente: los de texto de su entrada (lo que el modelo
 * escribió). Sin esquema conocido, ninguno (se aprueba o se rechaza tal cual). Puro.
 */
export function agentToolFields(params: Record<string, unknown>): ProposalField[] {
  const out: ProposalField[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") out.push({ key, label: humanize(key), kind: value.length > 80 ? "textarea" : "text" });
    else if (Array.isArray(value) && value.every((v) => typeof v === "string")) out.push({ key, label: humanize(key), kind: "list" });
  }
  return out;
}

function humanize(key: string): string {
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
