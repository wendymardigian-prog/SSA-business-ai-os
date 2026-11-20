/**
 * Qué disparadores ofrecen el «Solo si…» genérico, sin importar el registro (lo usa el panel, que corre en el
 * navegador). Son los que pasan por la cola de eventos; los de esta lista no: los de mensajes y comentarios tienen sus
 * filtros, el webhook tiene su propio «Solo si…» y los demás arrancan por otro camino (cron, receptor de emails).
 * `trigger-only-if.test.ts` compara esta lista con el registro (`supportsTriggerOnlyIf`).
 */
export const TRIGGERS_WITHOUT_ONLY_IF = [
  "keyword",
  "postback",
  "quick_reply",
  "welcome",
  "default",
  "comment_keyword",
  "email_received",
  "inactivity",
  "scheduled_time",
  "webhook_received",
] as const;

export function triggerOffersOnlyIf(type: string | null | undefined): boolean {
  if (!type) return false;
  return !(TRIGGERS_WITHOUT_ONLY_IF as readonly string[]).includes(type);
}

/** Como máximo, cuántas condiciones lleva un «Solo si…». */
export const MAX_ONLY_IF_CONDITIONS = 20;

export interface OnlyIfGroupInput {
  logic: "and" | "or";
  conditions: Array<{ field: string; operator: string; value?: unknown; valueType?: unknown; [key: string]: unknown }>;
}

/**
 * Lo que manda un editor como «Solo si…» (los editores de pasos lo guardan por el servidor): `null` lo saca, un grupo
 * vacío también, y uno con otra forma (o una condición a medias) se rechaza. PURO: lo usa la acción que guarda.
 */
export function parseTriggerOnlyIfInput(raw: unknown): { ok: true; group: OnlyIfGroupInput | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, group: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "El «Solo si…» no tiene la forma esperada." };
  const group = raw as { logic?: unknown; conditions?: unknown };
  if (group.logic !== undefined && group.logic !== "and" && group.logic !== "or") return { ok: false, error: "El «Solo si…» no tiene la forma esperada." };
  if (!Array.isArray(group.conditions)) return { ok: false, error: "El «Solo si…» no tiene la forma esperada." };
  if (group.conditions.length === 0) return { ok: true, group: null };
  if (group.conditions.length > MAX_ONLY_IF_CONDITIONS) return { ok: false, error: `Como máximo ${MAX_ONLY_IF_CONDITIONS} condiciones en el «Solo si…».` };
  const conditions: OnlyIfGroupInput["conditions"] = [];
  for (const c of group.conditions) {
    if (!c || typeof c !== "object" || Array.isArray(c)) return { ok: false, error: "El «Solo si…» no tiene la forma esperada." };
    const cond = c as Record<string, unknown>;
    if (typeof cond.field !== "string" || !cond.field.trim() || typeof cond.operator !== "string" || !cond.operator.trim()) {
      return { ok: false, error: "El «Solo si…» tiene una condición a medias: elegí el dato y cómo se compara, o sacala." };
    }
    conditions.push({ ...cond, field: cond.field, operator: cond.operator });
  }
  if (JSON.stringify(conditions).length > 20_000) return { ok: false, error: "El «Solo si…» es demasiado grande." };
  return { ok: true, group: { logic: group.logic === "or" ? "or" : "and", conditions } };
}
