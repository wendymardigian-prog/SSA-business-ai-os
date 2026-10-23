/**
 * Reglas de asignacion de CONVERSACIONES por cuenta conectada (00255).
 *
 * "Lo que entra por Instagram 1 va a Ana; lo de Instagram 2 se reparte por
 * turnos entre Beto y Caro." Gana la PRIMERA regla activa que coincide con la
 * cuenta de la conversacion, en el orden en que estan. Una regla cuya gente ya
 * no esta en el equipo no aplica y se prueba la siguiente.
 *
 * La eleccion de la persona tiene una gemela en la base
 * (`public.conversation_rule_pick`): las dos corren los casos de
 * `assignment-rules.cases.json`. Si se cambia una, se cambia la otra y se suma
 * el caso. La que asigna de verdad es la RPC `assign_new_conversation`; esta
 * funcion la usan el probador de Ajustes y los tests.
 *
 * Modulo puro: no sabe de Supabase.
 */

export const RULE_MODES = ["fixed", "round_robin"] as const;
export type RuleMode = (typeof RULE_MODES)[number];

export const SETTER_MODES = ["none", "if_empty", "overwrite"] as const;
export type SetterMode = (typeof SETTER_MODES)[number];

export const RULE_MODE_LABELS: Record<RuleMode, string> = {
  fixed: "Siempre a la misma persona",
  round_robin: "Por turnos",
};

export const SETTER_MODE_LABELS: Record<SetterMode, string> = {
  none: "No tocar el setter",
  if_empty: "Ponerla como setter si el contacto no tiene",
  overwrite: "Ponerla siempre como setter (reemplaza al que haya)",
};

export const MAX_RULE_MEMBERS = 50;
export const MAX_RULE_NAME = 80;

export interface ConversationRule {
  id: string;
  name: string;
  position: number;
  enabled: boolean;
  /** Vacio = todas las cuentas. */
  channelIds: string[];
  mode: RuleMode;
  memberIds: string[];
  lastAssignedMemberId: string | null;
  setterMode: SetterMode;
  archivedAt: string | null;
}

/**
 * A quien le toca dentro de UNA regla. Misma semantica que la SQL:
 * - fija: la primera de la lista que sigue en el equipo;
 * - por turnos: la siguiente despues de la ultima que recibio una, dando la
 *   vuelta y salteando a quien ya no esta.
 */
export function pickRuleMember(mode: RuleMode, memberIds: string[], activeIds: Iterable<string>, last: string | null): string | null {
  const n = memberIds.length;
  if (n === 0) return null;
  const active = new Set(activeIds);
  let start = 0;
  if (mode === "round_robin" && last) {
    const at = memberIds.indexOf(last);
    start = at >= 0 ? at + 1 : 0; // SQL: array_position es 1-based; aca el indice + 1 equivale
  }
  for (let k = 0; k < n; k++) {
    const candidate = memberIds[(start + k) % n];
    if (candidate && active.has(candidate)) return candidate;
  }
  return null;
}

/** Si la regla aplica a esa cuenta (sin mirar la gente). */
export function ruleMatchesChannel(rule: Pick<ConversationRule, "enabled" | "archivedAt" | "channelIds">, channelId: string): boolean {
  if (!rule.enabled || rule.archivedAt) return false;
  return rule.channelIds.length === 0 || rule.channelIds.includes(channelId);
}

/** Las reglas en el orden en que se prueban (position, y empate estable). */
export function orderRules<T extends Pick<ConversationRule, "position">>(rules: T[]): T[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => a.rule.position - b.rule.position || a.index - b.index)
    .map((x) => x.rule);
}

export interface SimulatedAssignment {
  rule: ConversationRule;
  userId: string;
}

/** Que pasaria con una conversacion nueva de esa cuenta. Null = queda sin responsable. */
export function simulateAssignment(rules: ConversationRule[], channelId: string, activeIds: Iterable<string>): SimulatedAssignment | null {
  const active = new Set(activeIds);
  for (const rule of orderRules(rules)) {
    if (!ruleMatchesChannel(rule, channelId)) continue;
    const userId = pickRuleMember(rule.mode, rule.memberIds, active, rule.lastAssignedMemberId);
    if (userId) return { rule, userId };
  }
  return null;
}

export interface RuleInput {
  name?: unknown;
  enabled?: unknown;
  channelIds?: unknown;
  mode?: unknown;
  memberIds?: unknown;
  setterMode?: unknown;
}

export interface CheckedRule {
  name: string;
  enabled: boolean;
  channelIds: string[];
  mode: RuleMode;
  memberIds: string[];
  setterMode: SetterMode;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/**
 * Valida lo que manda la pantalla contra el equipo y las cuentas reales. Lo
 * llama la Server Action antes de escribir.
 */
export function checkRuleInput(
  input: RuleInput,
  known: { memberIds: Iterable<string>; channelIds: Iterable<string> },
): { ok: true; value: CheckedRule } | { ok: false; error: string } {
  const mode = input.mode;
  if (typeof mode !== "string" || !(RULE_MODES as readonly string[]).includes(mode)) return { ok: false, error: "Elegí cómo se reparte." };
  const setterMode = input.setterMode ?? "none";
  if (typeof setterMode !== "string" || !(SETTER_MODES as readonly string[]).includes(setterMode)) {
    return { ok: false, error: "Elegí qué pasa con el setter." };
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length > MAX_RULE_NAME) return { ok: false, error: `El nombre puede tener hasta ${MAX_RULE_NAME} caracteres.` };

  const members = new Set(known.memberIds);
  const memberIds = uniqueStrings(input.memberIds);
  if (memberIds.length === 0) return { ok: false, error: "Elegí al menos una persona." };
  if (memberIds.length > MAX_RULE_MEMBERS) return { ok: false, error: `Hasta ${MAX_RULE_MEMBERS} personas por regla.` };
  if (memberIds.some((id) => !members.has(id))) return { ok: false, error: "Alguna de esas personas ya no está en el equipo." };
  if (mode === "fixed" && memberIds.length > 1) return { ok: false, error: "Una regla fija va a una sola persona." };

  const channels = new Set(known.channelIds);
  const channelIds = uniqueStrings(input.channelIds);
  if (channelIds.some((id) => !channels.has(id))) return { ok: false, error: "Alguna de esas cuentas ya no está conectada." };

  return {
    ok: true,
    value: {
      name,
      enabled: input.enabled !== false,
      channelIds,
      mode: mode as RuleMode,
      memberIds,
      setterMode: setterMode as SetterMode,
    },
  };
}

/** Fila de la base -> regla. */
export function ruleFromRow(row: {
  id: string;
  name: string;
  position: number;
  enabled: boolean;
  channel_ids: string[] | null;
  mode: string;
  member_ids: string[] | null;
  last_assigned_member_id: string | null;
  setter_mode: string;
  archived_at: string | null;
}): ConversationRule {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    enabled: row.enabled,
    channelIds: row.channel_ids ?? [],
    mode: (RULE_MODES as readonly string[]).includes(row.mode) ? (row.mode as RuleMode) : "fixed",
    memberIds: row.member_ids ?? [],
    lastAssignedMemberId: row.last_assigned_member_id,
    setterMode: (SETTER_MODES as readonly string[]).includes(row.setter_mode) ? (row.setter_mode as SetterMode) : "none",
    archivedAt: row.archived_at,
  };
}
