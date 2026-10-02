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
  drafted: "Dejo un borrador",
  already_answered: "Ya habia una respuesta",
};

export const RUN_SOURCE_LABELS: Record<string, string> = {
  agent: "Agente",
  flow_ai_node: "Automatizacion",
  sequence_ai_step: "Secuencia",
  kb_indexing: "Base de conocimiento",
  conversation_summary: "Resumen de cierre",
  message_classification: "Clasificador",
  // Esta en el CHECK de agent_runs.source y no lo escribe nadie (docs/PENDIENTE.md).
  message_classification_eval: "Clasificador (evaluacion)",
  content_copy: "Copywriter",
  ads_analysis: "Analisis de anuncios",
  audio_transcription: "Transcripcion",
  media_description: "Descripcion de imagen",
};

const DETAIL_LABELS: Record<string, string> = {
  channel_off: "el agente esta apagado para este canal",
  agent_off: "el agente esta apagado",
  conversation_off: "el agente esta apagado en esta conversacion",
  paused: "un flow pauso el agente",
  flow: "un flow respondio el mensaje",
  flow_session: "un flow estaba esperando esta respuesta",
  external_cooldown: "otra herramienta (ManyChat) respondio hace poco",
  moment_1: "ya habia una respuesta antes de generar",
  after_generation: "ya habia una respuesta mientras se generaba",
  flow_error: "un flow arranco y fallo",
  global_keyword: "era una palabra clave global",
  job_expired: "el turno se descarto por demora",
  provider_unavailable: "fallaron el modelo principal y el de respaldo",
  skipped_same_provider_auth: "no se intento el respaldo: mismo proveedor, y la key ya habia sido rechazada",
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
  reopened: "la conversacion se reabrio antes de resumirla",
  no_new_messages: "no habia mensajes nuevos desde el ultimo resumen",
  bad_output: "el modelo no devolvio un resumen valido",
  summary_condensed: "el resumen se condenso por largo",
  summary_truncated: "el resumen se recorto al tope",
  classified: "aplico la clasificacion al cierre",
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
      if (part.startsWith("rule:")) return `lo decidió una regla de respuesta`;
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


/**
 * Los nombres de los proveedores, para los mensajes de error.
 *
 * A mano y no importados de lib/integrations/providers.ts: ese modulo trae
 * SECRET_NAMES, y este archivo lo lee el navegador. lib/vault-boundary.test.ts
 * falla si se cruza esa linea.
 */
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google_ai: "Google",
};

/**
 * Traduce el error tecnico de un run a algo accionable.
 *
 * El texto guardado tiene la forma "primary anthropic/claude-sonnet-5:
 * api_401:authentication_error; fallback anthropic/claude-haiku-4-5:
 * skipped_same_provider_auth". Legible para quien escribio el codigo, inutil
 * para quien tiene que arreglarlo.
 *
 * Lo que importa de ese texto es UNA cosa: que hay que hacer ahora. Por eso el
 * resultado es el diagnostico primero, y el detalle tecnico despues.
 */
export function describeModelError(error: string | null): string {
  if (!error) return "";

  const parts = error.split(";").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return error;

  // El primer intento es el que explica el turno; los siguientes suelen ser
  // consecuencia (el respaldo salteado, el mismo proveedor fallando igual).
  const hint = parts.map(hintFor).find(Boolean);
  return hint ? `${hint} · ${error}` : error;
}

/** El aviso accionable de un intento, o null si no hay nada mejor que decir. */
function hintFor(attempt: string): string | null {
  const provider = attempt.match(/\b(anthropic|openai|google_ai)\//)?.[1];
  const label = provider ? (PROVIDER_LABELS[provider] ?? provider) : "el proveedor";
  const model = attempt.match(/\/([\w.\-:]+):/)?.[1] ?? null;

  const status = attempt.match(/api_(\d{3})/)?.[1];
  if (status) {
    const code = Number(status);
    if (code === 401 || code === 403) {
      return `La API key de ${label} no es valida o fue revocada. Cambiala en Ajustes > Integraciones`;
    }
    if (code === 404) {
      return model
        ? `El modelo ${model} no existe para esta cuenta de ${label}. Elegi otro en la configuracion del agente`
        : `${label} no encontro el modelo. Elegi otro en la configuracion del agente`;
    }
    if (code === 429) {
      return `Se alcanzo el limite de uso de ${label}. Suele resolverse solo; si sigue, revisa el plan de la cuenta`;
    }
    if (code === 400) {
      return `${label} rechazo el pedido. Suele ser un modelo mal escrito o una opcion que ese modelo no acepta`;
    }
    if (code >= 500) {
      return `${label} esta caido o sobrecargado. No hay nada que arreglar de este lado`;
    }
    return `${label} respondio con un error HTTP ${code}`;
  }

  if (attempt.includes("timeout")) {
    return "El modelo no respondio a tiempo. Se puede subir el timeout en la configuracion del agente";
  }
  if (attempt.includes("provider_unavailable")) {
    return `${label} no esta conectado. Se conecta en Ajustes > Integraciones`;
  }
  if (attempt.includes("no_key")) {
    return `Falta la API key de ${label}. Se carga en Ajustes > Integraciones`;
  }
  return null;
}
