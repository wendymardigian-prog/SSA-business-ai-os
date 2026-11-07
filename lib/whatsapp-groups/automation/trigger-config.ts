/**
 * La configuracion de los disparadores de grupos de WhatsApp. PURA.
 *
 * Filtros (los guarda el nodo disparador y se copian a `triggers.config`):
 *   - `group_ids`: los grupos (ids de `whatsapp_groups`). VACIO = cualquier grupo activado.
 *   - `message_scope` (reacciones y votos): a QUE mensaje.
 *       `business`   cualquier mensaje que mando el negocio (por defecto en reacciones)
 *       `any`        cualquier mensaje del grupo
 *       `picked`     los elegidos (`message_ids`), por ejemplo desde «Crear automatización» en la bandeja
 *       `flow_step`  los que mando un paso de una automatizacion (`flow_step: { flowId, nodeId }`)
 *   - `emojis` (reacciones): VACIO = cualquier emoji.
 *   - `options` (votos): VACIO = cualquier opcion; si no, alcanza con que el voto incluya UNA de ellas.
 *
 * Una configuracion ROTA no dispara para nadie (es mas seguro que mandar a todos).
 */

import type { GroupTriggerType } from "./payload";
import { selectedOptionsOf } from "./payload";

export const MESSAGE_SCOPES = ["business", "any", "picked", "flow_step"] as const;
export type MessageScope = (typeof MESSAGE_SCOPES)[number];

export interface GroupTriggerConfig {
  groupIds: string[];
  messageScope: MessageScope;
  messageIds: string[];
  flowStep: { flowId: string; nodeId: string } | null;
  emojis: string[];
  options: string[];
}

function list(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return null;
  return [...new Set((value as string[]).map((v) => v.trim()).filter(Boolean))];
}

/** El emoji para comparar: sin el selector de variante (❤️ y ❤ son el mismo). */
export function normalizeEmoji(emoji: string): string {
  return emoji.replace(/️/g, "").trim();
}

/** Una opcion de encuesta para comparar: sin espacios de mas y sin mayusculas. */
export function normalizeOption(option: string): string {
  return option.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

/** Lee la config guardada. `null` si esta rota (no dispara). */
export function parseGroupTriggerConfig(type: GroupTriggerType, config: unknown): GroupTriggerConfig | null {
  const c = config == null ? {} : config;
  if (typeof c !== "object" || Array.isArray(c)) return null;
  const raw = c as Record<string, unknown>;

  const groupIds = list(raw.group_ids);
  const messageIds = list(raw.message_ids ?? raw.poll_message_ids);
  const emojis = list(raw.emojis);
  const options = list(raw.options);
  if (!groupIds || !messageIds || !emojis || !options) return null;

  const defaultScope: MessageScope = type === "whatsapp_group_reaction" ? "business" : "any";
  const scopeRaw = raw.message_scope ?? defaultScope;
  if (typeof scopeRaw !== "string" || !(MESSAGE_SCOPES as readonly string[]).includes(scopeRaw)) return null;
  const messageScope = scopeRaw as MessageScope;

  let flowStep: GroupTriggerConfig["flowStep"] = null;
  if (messageScope === "flow_step") {
    const step = raw.flow_step as { flowId?: unknown; nodeId?: unknown } | null | undefined;
    if (!step || typeof step.flowId !== "string" || typeof step.nodeId !== "string" || !step.flowId || !step.nodeId) return null;
    flowStep = { flowId: step.flowId, nodeId: step.nodeId };
  }
  // «Los elegidos» sin ninguno elegido no puede disparar para todos.
  if (messageScope === "picked" && messageIds.length === 0) return null;

  return { groupIds, messageScope, messageIds, flowStep, emojis: emojis.map(normalizeEmoji), options };
}

function str(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  return typeof v === "string" ? v : "";
}

/** Las opciones del filtro que el voto eligio (vacio si no coincide ninguna). Sin filtro, todas las votadas. */
export function matchedOptions(config: GroupTriggerConfig, payload: Record<string, unknown>): string[] {
  const voted = selectedOptionsOf(payload);
  if (config.options.length === 0) return voted;
  const wanted = new Set(config.options.map(normalizeOption));
  return voted.filter((option) => wanted.has(normalizeOption(option)));
}

/** ¿El evento cumple los filtros del disparador? */
export function groupEventMatches(type: GroupTriggerType, rawConfig: unknown, rawPayload: unknown): boolean {
  const config = parseGroupTriggerConfig(type, rawConfig);
  if (!config || !rawPayload || typeof rawPayload !== "object") return false;
  const payload = rawPayload as Record<string, unknown>;

  if (config.groupIds.length > 0 && !config.groupIds.includes(str(payload, "group_id"))) return false;
  if (type === "whatsapp_group_joined") return true;

  switch (config.messageScope) {
    case "business":
      if (payload.message_from_business !== true) return false;
      break;
    case "picked":
      if (!config.messageIds.includes(str(payload, "message_id"))) return false;
      break;
    case "flow_step":
      if (str(payload, "message_flow_id") !== config.flowStep?.flowId || str(payload, "message_node_id") !== config.flowStep?.nodeId) return false;
      break;
    case "any":
      break;
  }

  if (type === "whatsapp_group_reaction") {
    const emoji = normalizeEmoji(str(payload, "emoji"));
    if (!emoji) return false;
    return config.emojis.length === 0 || config.emojis.includes(emoji);
  }
  return matchedOptions(config, payload).length > 0;
}

/**
 * La clave de idempotencia de un disparo (`trigger_fires`, por disparador):
 *   - entrar: una vez por persona y grupo (volver a entrar no lo repite);
 *   - reaccionar: una vez por persona y mensaje (cambiar de emoji no lo repite);
 *   - votar: por persona, encuesta y las opciones del filtro que eligio (cambiar a OTRA opcion que coincide si
 *     dispara; sin filtro, una vez por persona y encuesta).
 */
export function groupDedupeKey(type: GroupTriggerType, rawConfig: unknown, rawPayload: unknown, contactId: string, eventId: string): string {
  const payload = (rawPayload && typeof rawPayload === "object" ? rawPayload : {}) as Record<string, unknown>;
  const groupId = str(payload, "group_id");
  const messageId = str(payload, "message_id");
  if (type === "whatsapp_group_joined") return groupId ? `wa-join:${groupId}:${contactId}` : `event:${eventId}`;
  if (!messageId) return `event:${eventId}`;
  if (type === "whatsapp_group_reaction") return `wa-react:${messageId}:${contactId}`;
  const config = parseGroupTriggerConfig(type, rawConfig);
  if (!config || config.options.length === 0) return `wa-vote:${messageId}:${contactId}`;
  const matched = matchedOptions(config, payload).map(normalizeOption).sort();
  return `wa-vote:${messageId}:${contactId}:${matched.join("|")}`;
}
