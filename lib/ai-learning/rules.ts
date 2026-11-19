import { REJECT_REASON_LABELS, type RejectReason } from "./reject-reasons";

/**
 * Reglas aprendidas. Puro: lo usan el servidor, la pantalla y el armado del prompt.
 *
 * Cuando un agente acumula rechazos con el MISMO motivo (umbral configurable por agente, 3 de serie, en una ventana
 * de 30 días y desde la última decisión sobre una regla de ese motivo), el sistema PROPONE una regla. El texto sale de
 * una plantilla por motivo (sin llamar a la IA); la persona lo edita antes de aceptarlo. Solo las aceptadas entran al
 * prompt, en una sección aparte y versionada. La gemela SQL es `propose_learned_rule_if_due` (00442).
 */

export const RULE_WINDOW_DAYS = 30;

export const RULE_TEMPLATES: Record<RejectReason, string> = {
  tone: "Cuidá el tono: escribí cercano y profesional, sin frases que suenen bruscas ni demasiado informales.",
  wrong_data: "Antes de dar un dato (precio, fecha, plazo o condición), comprobalo en la información del cliente; si no está, no lo inventes.",
  not_this_client: "Antes de proponer algo, comprobá que corresponde a este cliente, a su servicio y a su etapa.",
  too_long: "Respondé más corto: como mucho tres frases, sin repetir lo que ya se dijo.",
  missing_info: "No dejes la respuesta a medias: incluí el siguiente paso concreto y la información que la persona necesita para darlo.",
  other: "Revisá las notas de los rechazos y ajustá la respuesta a lo que pidió el equipo.",
};

export const RULE_STATUS_LABELS: Record<string, string> = {
  proposed: "Propuesta",
  active: "Activa",
  discarded: "Descartada",
  retired: "Retirada",
};

/** El texto propuesto: la plantilla del motivo. Las notas viajan aparte como evidencia. */
export function proposedRuleText(reason: RejectReason): string {
  return RULE_TEMPLATES[reason];
}

export interface RuleDueInput {
  /** Las fechas (ISO) de los rechazos de este agente con este motivo. */
  rejectionsAt: readonly string[];
  /** La última decisión sobre una regla de este motivo (aceptada, descartada o retirada), si la hubo. */
  lastDecisionAt: string | null;
  /** Ya hay una propuesta abierta de este motivo. */
  hasOpenProposal: boolean;
  threshold: number;
  now: Date;
  windowDays?: number;
}

/** Si toca proponer una regla. Misma regla que la función SQL. */
export function ruleIsDue(input: RuleDueInput): boolean {
  if (input.hasOpenProposal) return false;
  const windowStart = input.now.getTime() - (input.windowDays ?? RULE_WINDOW_DAYS) * 86_400_000;
  const last = input.lastDecisionAt ? new Date(input.lastDecisionAt).getTime() : -Infinity;
  const since = Math.max(windowStart, last);
  const count = input.rejectionsAt.filter((at) => new Date(at).getTime() > since).length;
  return count >= Math.max(input.threshold, 2);
}

export interface LearnedRuleForPrompt {
  id: string;
  text: string;
}

/**
 * La sección de reglas aprendidas que se suma al prompt (vacía = no se suma nada: el prompt queda igual que antes, ni
 * un carácter de más).
 */
export function learnedRulesSection(rules: readonly LearnedRuleForPrompt[]): string {
  const clean = rules.map((r) => r.text.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  return `\n\n## Reglas aprendidas (aprobadas por el equipo)\n${clean.map((t) => `- ${t}`).join("\n")}`;
}

/** La foto que se guarda en cada versión del prompt. */
export function rulesSnapshot(rules: readonly LearnedRuleForPrompt[]): Array<{ id: string; text: string }> {
  return rules.map((r) => ({ id: r.id, text: r.text }));
}

export function parseRulesSnapshot(raw: unknown): LearnedRuleForPrompt[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const { id, text } = r as Record<string, unknown>;
    return typeof id === "string" && typeof text === "string" ? [{ id, text }] : [];
  });
}

export function reasonLabel(reason: string): string {
  return REJECT_REASON_LABELS[reason as RejectReason] ?? reason;
}
