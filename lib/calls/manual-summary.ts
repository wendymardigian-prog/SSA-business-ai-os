/**
 * Cargar una reunión a mano (Servicios A4, F141). PURA.
 *
 * En una reunión sin análisis (sin analizador, sin transcripción, o porque falló), una persona con `calls.edit` carga
 * un resumen, los próximos pasos y notas internas. Se guarda DENTRO de `calls.summary`, en la clave `manual`
 * (`{ summary, next_steps, notes, by, at }`), sin tocar `analysis` ni `analysis_status`. El resumen automático la
 * conserva al escribir (`withManualKept`), y si después se analiza, lo cargado a mano sigue ahí.
 */

export const MANUAL_SUMMARY_MAX = 2000;
export const MANUAL_NOTES_MAX = 2000;
export const MANUAL_STEPS_MAX = 10;
export const MANUAL_STEP_MAX = 200;

export type ManualSummary = { summary: string; next_steps: string[]; notes: string; by: string; at: string };
export type ManualSummaryInput = { summary: string; nextSteps: string[]; notes: string };

type Parsed = { ok: true; value: Omit<ManualSummary, "by" | "at"> } | { ok: false; error: string };

export function parseManualSummary(input: ManualSummaryInput): Parsed {
  const summary = (input.summary ?? "").trim();
  const notes = (input.notes ?? "").trim();
  const steps = (Array.isArray(input.nextSteps) ? input.nextSteps : []).map((s) => String(s ?? "").trim()).filter(Boolean);
  if (!summary && steps.length === 0 && !notes) return { ok: false, error: "Escribí al menos el resumen, un próximo paso o una nota." };
  if (summary.length > MANUAL_SUMMARY_MAX) return { ok: false, error: `El resumen puede tener hasta ${MANUAL_SUMMARY_MAX} caracteres.` };
  if (notes.length > MANUAL_NOTES_MAX) return { ok: false, error: `Las notas pueden tener hasta ${MANUAL_NOTES_MAX} caracteres.` };
  if (steps.length > MANUAL_STEPS_MAX) return { ok: false, error: `Podés cargar hasta ${MANUAL_STEPS_MAX} próximos pasos.` };
  if (steps.some((s) => s.length > MANUAL_STEP_MAX)) return { ok: false, error: `Cada próximo paso puede tener hasta ${MANUAL_STEP_MAX} caracteres.` };
  return { ok: true, value: { summary, next_steps: steps, notes } };
}

/** Lo cargado a mano que ya tiene una reunión, o null. */
export function manualSummaryOf(summary: unknown): ManualSummary | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const m = (summary as Record<string, unknown>).manual;
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  return {
    summary: typeof o.summary === "string" ? o.summary : "",
    next_steps: Array.isArray(o.next_steps) ? o.next_steps.filter((s): s is string => typeof s === "string") : [],
    notes: typeof o.notes === "string" ? o.notes : "",
    by: typeof o.by === "string" ? o.by : "",
    at: typeof o.at === "string" ? o.at : "",
  };
}

/** El `summary` nuevo con lo cargado a mano adentro, conservando el resto (el resumen automático, si hay). */
export function withManualSummary(previous: unknown, manual: ManualSummary): Record<string, unknown> {
  const base = previous && typeof previous === "object" && !Array.isArray(previous) ? (previous as Record<string, unknown>) : {};
  return { ...base, manual };
}

/** El resumen automático nuevo, conservando lo que se cargó a mano antes. */
export function withManualKept(next: Record<string, unknown>, previous: unknown): Record<string, unknown> {
  const manual = manualSummaryOf(previous);
  return manual ? { ...next, manual } : next;
}

/** Si la reunión se muestra como «Cargada a mano»: tiene carga manual y no tiene análisis. */
export function isManuallyLoaded(summary: unknown, analysisStatus: string | null): boolean {
  return manualSummaryOf(summary) !== null && analysisStatus !== "done";
}
