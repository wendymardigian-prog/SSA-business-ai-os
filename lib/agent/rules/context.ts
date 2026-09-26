import type { RuleContext } from "./evaluate";
import { isKnownButtonText } from "./known-buttons";

/**
 * Arma el contexto PREVIO de las reglas (campos que se pueden mirar antes de
 * generar). Los campos de la respuesta (`response.*`, `agent.*`, `intent`) se
 * completan después con `fillResponseContext`.
 *
 * Best-effort para los campos que necesitan el episodio (Bloque 3): hoy
 * `is_episode_start` = no hay mensajes anteriores a la ráfaga; `previous_episodes`
 * = 0 y `window_hours_left` = null hasta tener la función de episodios. La
 * plantilla no depende de esos tres.
 */
export function buildPreRuleContext(args: {
  burstText: string;
  burstCount: number;
  lastInboundText: string | null;
  knownButtonExtra?: Iterable<string>;
  temperature: string | null;
  tags: string[];
  hasPriorOutbound: boolean;
  hasPriorMessages: boolean;
  assigned: boolean;
  channel: string;
  inBusinessHours: boolean;
}): RuleContext {
  return {
    inbound: {
      text: args.burstText,
      is_known_button: isKnownButtonText(args.lastInboundText, args.knownButtonExtra),
      length: args.burstText.length,
      burst_count: args.burstCount,
    },
    contact: {
      temperature: args.temperature,
      tags: args.tags,
      is_new: !args.hasPriorOutbound,
      previous_episodes: 0,
    },
    conversation: {
      assigned: args.assigned,
      window_hours_left: null,
      is_episode_start: !args.hasPriorMessages,
      channel: args.channel,
    },
    time: { in_business_hours: args.inBusinessHours },
    // Se completan después de generar.
    response: undefined,
    agent: undefined,
    intent: null,
  };
}

const LINK_RE = /https?:\/\//i;

/** Completa el contexto con los campos de la respuesta del agente (etapa final). */
export function fillResponseContext(
  ctx: RuleContext,
  args: {
    responseText: string;
    parts: number;
    wantsEscalate: boolean;
    kbMiss: boolean;
    usedTools: string[];
    intent?: { category_id: string | null; confidence: number } | null;
  },
): RuleContext {
  return {
    ...ctx,
    response: {
      text: args.responseText,
      has_link: LINK_RE.test(args.responseText),
      parts: args.parts,
    },
    agent: {
      wants_escalate: args.wantsEscalate,
      kb_miss: args.kbMiss,
      used_tools: args.usedTools,
    },
    intent: args.intent ?? null,
  };
}
