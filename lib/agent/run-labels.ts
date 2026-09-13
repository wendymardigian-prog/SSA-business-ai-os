/**
 * Textos para mostrar un run en lenguaje llano. Sin dependencias de servidor.
 * El detalle tecnico (status_detail) se traduce aca, en un solo lugar.
 */

export const RUN_STATUS_LABELS: Record<string, string> = {
  running: "En curso",
  responded: "Respondio",
  escalated: "Derivo a una persona",
  skipped_automation: "Se abstuvo: una automatizacion se hizo cargo",
  skipped: "No actuo",
  blocked_guardrail: "Lo freno un guardarrail",
  completed: "Completado",
  error: "Error",
};

export const RUN_SOURCE_LABELS: Record<string, string> = {
  agent: "Agente de conversacion",
  flow_ai_node: "Nodo de IA de un flow",
  sequence_ai_step: "Paso de IA de una secuencia",
  kb_indexing: "Indexacion de la base de conocimiento",
  conversation_summary: "Resumen de conversacion",
};

const DETAIL_LABELS: Record<string, string> = {
  channel_off: "el agente esta apagado para este canal",
  agent_off: "el agente esta apagado",
  conversation_off: "el agente esta apagado en esta conversacion",
  paused: "un flow pauso el agente",
  flow: "un flow respondio el mensaje",
  flow_session: "un flow estaba esperando esta respuesta",
  flow_error: "un flow arranco y fallo",
  global_keyword: "era una palabra clave global",
  job_expired: "el turno se descarto por demora",
  provider_unavailable: "fallaron el modelo principal y el de respaldo",
  model_timeout: "el modelo no respondio a tiempo",
  send_failed: "no se pudo enviar la respuesta",
  turn_exception: "error inesperado en el turno",
  human_took_over_during_generation: "una persona tomo la conversacion mientras se generaba",
  "tool:derivar_a_humano": "el agente decidio derivar",
  fallback_model: "respondio el modelo de respaldo",
  sent_early_new_message: "se envio antes porque el lead volvio a escribir",
  output_truncated: "la respuesta se recorto al largo maximo",
  stale_running: "el proceso se corto antes de terminar",
  message_persistence_off: "el guardado de mensajes entrantes esta apagado en Ajustes",
};

/** "guardrail:blocked_topic | pricing_missing:x" -> lista legible. */
export function describeRunDetail(detail: string | null): string[] {
  if (!detail) return [];
  return detail
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (DETAIL_LABELS[part]) return DETAIL_LABELS[part];
      if (part.startsWith("guardrail:")) return `guardarrail: ${part.slice(10).replace(/_/g, " ")}`;
      if (part.startsWith("spend:")) return `tope de gasto alcanzado (${part.slice(6).replace(/_/g, " ")})`;
      if (part.startsWith("output:")) return `la respuesta no paso la validacion (${part.slice(7)})`;
      if (part.startsWith("pricing_missing:")) return `falta cargar el precio de ${part.slice(16)}: el costo quedo sin calcular`;
      if (part.startsWith("partial_send:")) return `se enviaron ${part.slice(13)} partes`;
      return part.replace(/_/g, " ");
    });
}

export const STEP_KIND_LABELS: Record<string, string> = {
  model_call: "Llamada al modelo",
  kb_search: "Busqueda en la base de conocimiento",
  tool_call: "Herramienta",
  guardrail: "Guardarrail",
};
