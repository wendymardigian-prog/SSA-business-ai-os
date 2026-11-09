// @plantilla-quitar(servicios)
/**
 * Límites y créditos del tutor del programa (F85), puro. Gemela de `app_servicio.assistant_credits_plan(jsonb)` (00352):
 * los casos de `assistant.cases.json` corren contra las dos.
 *
 * Qué límite vale para un estudiante, en este orden: el propio (su acceso al Asistente IA), el de la sección en su
 * variante y el del programa. Los créditos = (límite − gasto del mes) × créditos por dólar, sin decimales y nunca
 * negativos. El mes es el del negocio.
 */

export interface AssistantSettings {
  monthly_limit_usd_per_student?: number;
  credits_per_usd?: number;
  credits_name?: string;
  suggestions?: string[];
  excluded_kb_ids?: string[];
}

export const ASSISTANT_DEFAULTS = { monthly_limit_usd_per_student: 10, credits_per_usd: 100, credits_name: "créditos" } as const;

export function pickAssistantLimit(own: number | null | undefined, variant: number | null | undefined, program: number | null | undefined): number {
  for (const v of [own, variant, program]) if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return ASSISTANT_DEFAULTS.monthly_limit_usd_per_student;
}

export function assistantCredits(i: { limitUsd: number; spentUsd: number; creditsPerUsd: number }): number {
  const left = Math.max(0, i.limitUsd - Math.max(0, i.spentUsd));
  return Math.max(0, Math.floor(left * Math.max(0, i.creditsPerUsd) + 1e-9));
}

/** Para los casos compartidos: lo mismo que la base, en un objeto. */
export function assistantCreditsPlan(p: { own: number | null; variant: number | null; program: number | null; spentUsd: number; creditsPerUsd: number | null }): { limitUsd: number; credits: number; reached: boolean } {
  const limitUsd = pickAssistantLimit(p.own, p.variant, p.program);
  const credits = assistantCredits({ limitUsd, spentUsd: p.spentUsd, creditsPerUsd: p.creditsPerUsd ?? ASSISTANT_DEFAULTS.credits_per_usd });
  return { limitUsd, credits, reached: p.spentUsd >= limitUsd };
}

/** El primer día del mes del negocio, como fecha civil («2026-11-01»), para un instante y una zona. */
export function monthStartIn(at: Date, timeZone: string): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return `${d.slice(0, 7)}-01`;
}
