// @plantilla-quitar(servicios)
/**
 * El desbloqueo de un módulo, submódulo o clase para una persona (F47, F100, F101, F102), puro. Gemela de
 * `app_servicio.program_unlock_plan(jsonb)` (00342); los casos de `unlock.cases.json` corren contra las dos.
 *
 * Orden (F102):
 *  1. archivado o inactivo (propio o de un padre) → no se ve;
 *  2. no incluido en la variante → no se ve (`included = false`);
 *  3. bloqueado (propio o de un padre; el primero desde arriba manda) → se ve según su `display`: con candado se lista;
 *     «Próximamente» se ve si es el propio y oculta a sus hijos; oculto no se ve;
 *  4. abierto.
 * Abrir a mano, por un paso o por automatización (`unlockedIds`) abre aunque la regla diga otra cosa. Un
 * `after_complete` que apunta a algo inactivo queda cumplido.
 */

export type UnlockDisplay = "open" | "locked" | "coming_soon" | "hidden";

export interface UnlockRule {
  type?: string;
  date?: string | null;
  days?: number | null;
  target?: string | null;
  id?: string | null;
  condition?: string | null;
  display?: "locked" | "coming_soon" | "hidden" | null;
  coming_soon_text?: string | null;
  show_date?: boolean | null;
  locked_text?: string | null;
}

export interface UnlockNode {
  id: string;
  status: string;
  rule: UnlockRule | null;
  /** Lo incluye la variante de la persona (F101). Solo los módulos lo dicen; los hijos lo heredan. */
  included?: boolean;
}

export interface UnlockInput {
  /** De la raíz (módulo) al ítem. */
  chain: UnlockNode[];
  ctx: {
    today: string;
    /** El día en que empezó el acceso Programa de la persona. */
    accessStartsOn: string | null;
    /** Clases, módulos o pasos del camino ya completos (ids o claves). */
    completed: string[];
    /** Ítems inactivos o archivados (un `after_complete` que los apunta queda cumplido). */
    inactiveIds: string[];
    challengeStarted: boolean;
    /** Lo que se abrió para esta persona (paso, automatización o a mano). */
    unlockedIds: string[];
  };
}

export interface UnlockResult {
  visible: boolean;
  unlocked: boolean;
  included: boolean;
  display: UnlockDisplay;
  reason: string | null;
  opensOn: string | null;
}

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const human = (d: string) => d.split("-").reverse().join("/");

function opensOn(rule: UnlockRule, ctx: UnlockInput["ctx"]): string | null {
  if (rule.type === "fixed_date") return rule.date ?? null;
  if (rule.type === "days_after_start") return ctx.accessStartsOn ? addDays(ctx.accessStartsOn, typeof rule.days === "number" && rule.days > 0 ? rule.days : 0) : null;
  return null;
}

function isOpen(node: UnlockNode, ctx: UnlockInput["ctx"]): boolean {
  const r = node.rule ?? { type: "open" };
  if (ctx.unlockedIds.includes(node.id)) return true;
  switch (r.type ?? "open") {
    case "open":
      return true;
    case "fixed_date":
    case "days_after_start": {
      const d = opensOn(r, ctx);
      return d !== null && ctx.today >= d;
    }
    case "after_complete":
      return !!r.id && (ctx.completed.includes(r.id) || ctx.inactiveIds.includes(r.id));
    case "challenge_started":
      return ctx.challengeStarted;
    default:
      // journey_item y automation: solo con `unlockedIds`.
      return false;
  }
}

function defaultDisplay(rule: UnlockRule): "locked" | "coming_soon" | "hidden" {
  return rule.display ?? (rule.type === "fixed_date" ? "coming_soon" : "locked");
}

function reasonOf(rule: UnlockRule, ctx: UnlockInput["ctx"], display: string): string {
  if (display === "coming_soon" && rule.coming_soon_text) return rule.coming_soon_text;
  const d = opensOn(rule, ctx);
  switch (rule.type) {
    case "fixed_date":
    case "days_after_start":
      return d ? `Se abre el ${human(d)}` : "Se abre cuando empiece tu acceso";
    case "after_complete":
      return "Se abre cuando completes lo anterior";
    case "challenge_started":
      return "Se abre cuando empiece el Reto";
    default:
      return rule.locked_text || "Todavía no está disponible";
  }
}

const HIDDEN = (included: boolean): UnlockResult => ({ visible: false, unlocked: false, included, display: "hidden", reason: null, opensOn: null });

export function unlockPlan(input: UnlockInput): UnlockResult {
  const { chain, ctx } = input;
  if (chain.length === 0) return HIDDEN(true);
  if (chain.some((n) => n.status !== "active")) return HIDDEN(true);
  if (chain.some((n) => n.included === false)) return HIDDEN(false);
  const last = chain.length - 1;
  for (let i = 0; i <= last; i++) {
    const node = chain[i];
    if (isOpen(node, ctx)) continue;
    const rule = node.rule ?? {};
    const display = defaultDisplay(rule);
    const own = i === last;
    const visible = own ? display !== "hidden" : display === "locked";
    return {
      visible,
      unlocked: false,
      included: true,
      display: visible ? display : "hidden",
      reason: visible ? reasonOf(rule, ctx, display) : null,
      opensOn: visible && own ? opensOn(rule, ctx) : null,
    };
  }
  return { visible: true, unlocked: true, included: true, display: "open", reason: null, opensOn: null };
}

/** Problemas de una regla de desbloqueo (lo que el editor muestra antes de guardar). */
export function unlockRuleProblems(rule: UnlockRule): string[] {
  const p: string[] = [];
  const t = rule.type ?? "open";
  if (!["open", "fixed_date", "days_after_start", "after_complete", "challenge_started", "journey_item", "automation"].includes(t)) p.push("el tipo de desbloqueo no es válido");
  if (t === "open" && rule.display) p.push("una clase abierta no tiene «cómo se ve bloqueada»");
  if (t === "fixed_date" && !(rule.date && /^\d{4}-\d{2}-\d{2}$/.test(rule.date))) p.push("elegí la fecha");
  if (t === "days_after_start" && !(typeof rule.days === "number" && Number.isInteger(rule.days) && rule.days >= 0 && rule.days <= 3650)) p.push("los días tienen que ser de 0 a 3650");
  if (t === "after_complete" && !rule.id) p.push("elegí qué hay que completar");
  if (rule.display && !["locked", "coming_soon", "hidden"].includes(rule.display)) p.push("«cómo se ve» no es válido");
  if (rule.coming_soon_text && rule.coming_soon_text.length > 80) p.push("el texto de «Próximamente» tiene hasta 80 caracteres");
  if (rule.coming_soon_text && rule.display !== "coming_soon" && !(t === "fixed_date" && !rule.display)) p.push("el texto solo va con «Próximamente»");
  return p;
}
