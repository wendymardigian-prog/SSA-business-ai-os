// @plantilla-quitar(servicios)
/**
 * Paso bloqueado hasta una fecha o hasta otro paso (Servicios A4, F146). PURA.
 *
 * Gemela de `app_servicio.svc_lock_plan(jsonb)` (00369), con los casos de `lock.cases.json` (vitest y
 * `verify-services --bloque a4`). La fecha se calcula con la misma regla que los plazos (`dueDate` / `svc_due_date`),
 * que no se tocan.
 *
 *   lock = { from: "service_created" | "service_start" | "phase_start", days: 0..365 }   → desde esa fecha
 *        | { after_item_key: "it_xxxxxx" }                                               → cuando se complete ese paso
 *
 * Si el ancla todavía no existe (la fase no empezó, el servicio no arrancó), el paso sigue bloqueado sin fecha.
 */
import { dueDate, type DueAnchors } from "./engine-rules";

export const LOCK_FROMS = ["service_created", "service_start", "phase_start"] as const;
export type LockFrom = (typeof LOCK_FROMS)[number];
export type ItemLock = { from: LockFrom; days: number } | { after_item_key: string };

export type LockPlanInput = {
  lock: unknown;
  anchors: Pick<DueAnchors, "serviceCreated" | "serviceStart" | "phaseStart">;
  /** Hoy, en la zona del negocio (YYYY-MM-DD). */
  today: string;
  /** Las claves de los pasos ya completos del servicio. */
  completedKeys: string[];
};

export type LockState = { locked: boolean; until: string | null; waiting_item_key: string | null };

export const UNLOCKED: LockState = { locked: false, until: null, waiting_item_key: null };

export function readLock(raw: unknown): ItemLock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.after_item_key === "string" && o.after_item_key) return { after_item_key: o.after_item_key };
  if (typeof o.from === "string" && (LOCK_FROMS as readonly string[]).includes(o.from)) {
    const days = Number(o.days);
    return { from: o.from as LockFrom, days: Number.isFinite(days) ? Math.round(days) : 0 };
  }
  return null;
}

export function lockPlan(input: LockPlanInput): LockState {
  const lock = readLock(input.lock);
  if (!lock) return UNLOCKED;
  if ("after_item_key" in lock) {
    return input.completedKeys.includes(lock.after_item_key) ? UNLOCKED : { locked: true, until: null, waiting_item_key: lock.after_item_key };
  }
  const until = dueDate({ from: lock.from, days: lock.days }, { ...input.anchors, itemCompleted: null });
  if (!until) return { locked: true, until: null, waiting_item_key: null };
  return input.today < until ? { locked: true, until, waiting_item_key: null } : UNLOCKED;
}

/** La frase del candado: «Desde el 13/11» o «Después de: Configurar cuenta». */
export function lockLabel(state: LockState, itemNames: Record<string, string>, formatDate: (d: string) => string): string | null {
  if (!state.locked) return null;
  if (state.waiting_item_key) return `Después de: ${itemNames[state.waiting_item_key] ?? "otro paso"}`;
  if (state.until) return `Desde el ${formatDate(state.until)}`;
  return "Todavía no se puede completar";
}

/** El mensaje de SV033 (lo mismo que dice la base al rechazar). */
export function lockErrorMessage(state: LockState, itemNames: Record<string, string>, formatDate: (d: string) => string): string {
  if (state.waiting_item_key) return `Este paso se puede completar cuando se complete «${itemNames[state.waiting_item_key] ?? "otro paso"}».`;
  if (state.until) return `Este paso se puede completar desde el ${formatDate(state.until)}.`;
  return "Este paso todavía no se puede completar.";
}
