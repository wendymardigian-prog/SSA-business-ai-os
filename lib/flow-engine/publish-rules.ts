/**
 * Lo que una automatizacion necesita en su disparador para poder publicarse.
 * Puro: lo usan `publishFlow`, la API y el lienzo (para avisar antes de apretar Publicar).
 *
 * Reglas:
 *  - exactamente UN disparador (el motor arranca siempre por el primero: con dos, el segundo corria los pasos del
 *    primero);
 *  - elegido: `triggerType: null` es "todavia no elegi" (asi nace una automatizacion nueva). Un nodo viejo SIN la clave
 *    se sigue leyendo como palabra clave, que es lo que el lienzo de antes ponia por defecto;
 *  - con lo minimo de su tipo (una palabra clave, un payload);
 *  - con al menos un paso conectado.
 */

import { chosenType } from "./trigger-catalog";

type RawNode = { id?: unknown; type?: unknown; data?: unknown };
type RawEdge = { source?: unknown };

export const NO_TRIGGER_PROBLEM = "La automatización no tiene disparador: elegí cómo arranca.";
export const TRIGGER_NOT_CHOSEN_PROBLEM = "Elegí cómo arranca la automatización (el disparador).";
export const MANY_TRIGGERS_PROBLEM = "La automatización tiene más de un disparador: dejá uno solo.";
export const NO_KEYWORDS_PROBLEM = "Cargá al menos una palabra clave en el disparador.";
export const NO_PAYLOAD_PROBLEM = "Completá el payload del botón o la respuesta rápida en el disparador.";
export const NO_FIRST_STEP_PROBLEM = "El disparador no tiene ningún paso conectado.";

export function triggerNodesOf(nodes: unknown[]): RawNode[] {
  return (Array.isArray(nodes) ? nodes : []).filter((n): n is RawNode => !!n && typeof n === "object" && (n as RawNode).type === "trigger");
}

/** El tipo elegido del disparador: `null` si no se eligio; un nodo viejo sin la clave es palabra clave. */
export function chosenTriggerType(node: RawNode | undefined): string | null {
  if (!node) return null;
  return chosenType((node.data ?? {}) as Record<string, unknown>);
}

function keywordsOf(data: Record<string, unknown>): string[] {
  const config = (data.config ?? {}) as { keywords?: unknown };
  const list = Array.isArray(data.keywords) ? data.keywords : Array.isArray(config.keywords) ? config.keywords : [];
  return list
    .map((kw) => (typeof kw === "string" ? kw : (kw as { value?: unknown })?.value))
    .filter((kw): kw is string => typeof kw === "string" && kw.trim().length > 0);
}

export function triggerProblems(nodes: unknown[], edges: unknown[]): string[] {
  const triggers = triggerNodesOf(nodes);
  if (triggers.length === 0) return [NO_TRIGGER_PROBLEM];
  if (triggers.length > 1) return [MANY_TRIGGERS_PROBLEM];

  const node = triggers[0];
  const type = chosenTriggerType(node);
  if (!type) return [TRIGGER_NOT_CHOSEN_PROBLEM];

  const problems: string[] = [];
  const data = (node.data ?? {}) as Record<string, unknown>;
  const config = (data.config ?? {}) as Record<string, unknown>;
  if (type === "keyword" || type === "comment_keyword") {
    // «Solo menciones en historias» sin palabras: la mencion sola alcanza.
    const mentionOnly = type === "keyword" && (data.storyMentionOnly === true || config.storyMentionOnly === true);
    if (!mentionOnly && keywordsOf(data).length === 0) problems.push(NO_KEYWORDS_PROBLEM);
  }
  if (type === "postback" || type === "quick_reply") {
    const payload = data.payload ?? config.payload;
    if (typeof payload !== "string" || !payload.trim()) problems.push(NO_PAYLOAD_PROBLEM);
  }
  const hasFirstStep = (Array.isArray(edges) ? edges : []).some((e) => (e as RawEdge)?.source === node.id);
  if (!hasFirstStep) problems.push(NO_FIRST_STEP_PROBLEM);
  return problems;
}
