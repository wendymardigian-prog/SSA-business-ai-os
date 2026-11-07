/**
 * Los bloques del dashboard de Chat que se pueden pedir de a uno.
 *
 * Es la lista blanca de la ruta y lo unico que el navegador necesita saber. No
 * importa nada del servidor: `lib/vault-boundary.test.ts` recorre lo que importa
 * cada Client Component (los tipos se borran al compilar).
 */

import type { DraftsCard } from "./drafts";
import type { AgentActionRow, EscalationReason, RuleResultRow } from "./escalations";
import type { AgentBlock, CardsBlock, FirstResponderBlock, PatternsBlock, QualityLine, TrendsBlock } from "./loaders";
import type { TeamRow } from "./team-rows";

export const CHAT_BLOCK_KEYS = [
  "cards",
  "trends",
  "agent",
  "firstResponder",
  "escalations",
  "actions",
  "rules",
  "drafts",
  "team",
  "patterns",
  "quality",
] as const;

export type ChatBlockKey = (typeof CHAT_BLOCK_KEYS)[number];

export interface ChatBlockData {
  cards: CardsBlock;
  trends: TrendsBlock;
  agent: AgentBlock;
  firstResponder: FirstResponderBlock;
  escalations: EscalationReason[];
  actions: AgentActionRow[];
  rules: RuleResultRow[];
  drafts: DraftsCard;
  team: TeamRow[];
  patterns: PatternsBlock;
  quality: QualityLine;
}

export function isChatBlockKey(value: string | null): value is ChatBlockKey {
  return value !== null && (CHAT_BLOCK_KEYS as readonly string[]).includes(value);
}

/**
 * Los que no se guardan: los borradores tienen que coincidir con el contador del
 * menu, que siempre es de este momento.
 */
export const UNCACHED_BLOCKS: readonly ChatBlockKey[] = ["drafts"];

/** Lo que cambia una correccion de categorias, sin tocar los demas numeros. */
export const PATTERN_BLOCKS: readonly ChatBlockKey[] = ["patterns", "quality"];
