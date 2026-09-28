import type { Json, TriggerType } from "@/lib/types/database";
import { getTrigger } from "@/lib/flow-engine/registry";

/**
 * Los tipos que el editor sabe configurar con campos propios (palabras clave,
 * payload). Los demás guardan su config tal cual viene del panel.
 */
export const BUILDER_TRIGGER_TYPES = [
  "keyword",
  "postback",
  "quick_reply",
  "welcome",
  "default",
  "comment_keyword",
] as const;

type BuilderTriggerType = (typeof BUILDER_TRIGGER_TYPES)[number];

const isBuilderTriggerType = (t: string): t is BuilderTriggerType =>
  (BUILDER_TRIGGER_TYPES as readonly string[]).includes(t);

/** Las claves del nodo que NO son configuración del trigger. */
const NODE_ONLY_KEYS = new Set(["triggerType", "config", "keywords", "payload", "label", "description", "postIds", "replyText", "matchType", "alsoMatchInDms", "onlyIfAgentOff", "priority"]);

/**
 * Los tipos que el editor puede guardar: los seis de mensaje más cualquiera
 * registrado con alcance `event` o `scheduled`.
 *
 * Antes la lista estaba escrita a mano con los seis de mensaje, así que
 * `new_contact`, `crm_event`, `inactivity` y `email_received` elegidos en el
 * canvas NUNCA se guardaban: el editor los ofrecía y no pasaba nada. Ahora la
 * decide el registro, que es la única lista de tipos del sistema.
 */
function isPersistableTriggerType(type: string): boolean {
  if (isBuilderTriggerType(type)) return true;
  const definition = getTrigger(type);
  return definition?.scope === "event" || definition?.scope === "scheduled";
}

export interface DesiredTrigger {
  flow_id: string;
  channel_id: null;
  type: TriggerType;
  config: Json;
  is_active: boolean;
  priority: number;
}

/**
 * Derive the `triggers` rows a published flow should have from its node graph.
 *
 * One node usually maps to one row. The exception is a `comment_keyword` node
 * with "also match in DMs", which emits a second row typed `keyword`: the
 * runtime matcher keys the DM path off that type, so this is what lets one flow
 * answer both a comment and a DM carrying the same keyword.
 */
export function buildDesiredTriggers(
  flowNodes: Array<Record<string, unknown>>,
  flowId: string,
): DesiredTrigger[] {
  return flowNodes
    .filter((n) => n?.type === "trigger")
    .flatMap((n) => {
      const data = (n.data ?? {}) as Record<string, any>;
      const nodeConfig = (data.config ?? {}) as Record<string, any>;
      const type = (data.triggerType ?? "keyword") as string;
      if (!isPersistableTriggerType(type)) return [];

      // The trigger panel stores keywords as data.keywords ([{ value, matchType }]);
      // template-seeded nodes store data.config.keywords ([string]). The matcher
      // accepts both shapes, so pass through whichever the node carries.
      const config: Record<string, any> = {};
      if (type === "keyword" || type === "comment_keyword") {
        config.keywords = data.keywords ?? nodeConfig.keywords ?? [];
        if (nodeConfig.matchType) config.matchType = nodeConfig.matchType;
        const postIds = data.postIds ?? nodeConfig.postIds;
        if (Array.isArray(postIds) && postIds.length > 0) config.postIds = postIds;
        const replyText = data.replyText ?? nodeConfig.replyText;
        if (typeof replyText === "string" && replyText.trim()) config.replyText = replyText;
      } else if (type === "postback" || type === "quick_reply") {
        const payload = data.payload ?? nodeConfig.payload;
        if (payload !== undefined) config.payload = payload;
      } else {
        // Los tipos que no son de mensaje guardan lo que el panel escribió en
        // el nodo, menos lo que es del canvas (la etiqueta, el tipo elegido).
        // Así sumar un filtro nuevo al panel no pide tocar este archivo.
        for (const [key, value] of Object.entries(data)) {
          if (NODE_ONLY_KEYS.has(key) || value === undefined || value === null) continue;
          if (Array.isArray(value) && value.length === 0) continue;
          config[key] = value;
        }
        for (const [key, value] of Object.entries(nodeConfig)) {
          if (NODE_ONLY_KEYS.has(key) || value === undefined || value === null) continue;
          config[key] = value;
        }
      }

      // Fase 3: puerta "solo si el agente de IA esta apagado" (registry/guards.ts).
      // Vale para los triggers de mensaje; la evalua el matcher despues del match.
      if (data.onlyIfAgentOff === true && type !== "comment_keyword") {
        config.only_if_agent_off = true;
      }

      const row: DesiredTrigger = {
        flow_id: flowId,
        channel_id: null,
        type: type as TriggerType,
        config,
        is_active: true,
        priority: typeof nodeConfig.priority === "number" ? nodeConfig.priority : 0,
      };

      // postIds (post scoping) and replyText (the public reply on the comment)
      // are dropped from the DM row: a DM has neither a post nor a comment.
      if (type === "comment_keyword" && data.alsoMatchInDms === true && config.keywords?.length) {
        const { postIds: _postIds, replyText: _replyText, ...dmConfig } = config;
        if (data.onlyIfAgentOff === true) dmConfig.only_if_agent_off = true;
        return [row, { ...row, type: "keyword" as TriggerType, config: dmConfig }];
      }

      return [row];
    });
}
