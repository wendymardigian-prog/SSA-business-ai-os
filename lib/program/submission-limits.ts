// @plantilla-quitar(servicios)
/**
 * Entregas de una actividad (F126, decisión 469), puro. Gemela de `app_servicio.submission_plan(jsonb)` (00375); los
 * casos de `submission-limits.cases.json` corren contra las dos (verify-program --bloque a3).
 *
 * Los límites viven en `form_versions.definition.submission = {before_review, after_review}`: cada uno es 0, N o null
 * (sin límite). **Una actividad sin `submission` sigue como antes** (sin límites ni reemplazos): los valores por
 * defecto se escriben recién al guardarla en el editor.
 *
 * - Antes de la primera revisión, entregar de nuevo **reemplaza** la entrega pendiente (queda `superseded`) y gasta
 *   una corrección de `before_review`.
 * - «Pedir otra entrega» (`needs_changes`) **siempre** habilita una más, sin gastar de `after_review`.
 * - Una revisada que no aprobó habilita otra mientras queden de `after_review`.
 * - Una aprobada (o revisada sin calificación) no se reentrega.
 * - Después de la primera revisión, una entrega pendiente espera su revisión: no se reemplaza.
 */

export interface SubmissionLimits {
  before_review?: number | null;
  after_review?: number | null;
}

/** Lo que se guarda al crear o editar una actividad en el editor (§18, F126). */
export const DEFAULT_SUBMISSION_LIMITS: Required<SubmissionLimits> = { before_review: null, after_review: 2 };

export interface SubmissionHistoryRow {
  id: string;
  /** `review_status` de la fila. */
  status: "pending" | "reviewed" | "needs_changes" | "superseded" | "graded" | null;
  /** `grade.passed` (null o ausente si no se calificó). */
  passed?: boolean | null;
}

export type SubmissionPlan =
  | { ok: true; supersede: string | null }
  | { ok: false; code: "EV003" | "EV004" | "EV005"; message: string };

export const SUBMISSION_MESSAGES = {
  EV003_before: "Ya usaste todas las correcciones antes de la revisión",
  EV003_after: "Ya no quedan entregas nuevas para esta actividad",
  EV004: "Esta entrega ya está aprobada",
  EV005: "Tu entrega está esperando la revisión",
} as const;

/** Un límite válido: entero de 0 a 100. Cualquier otra cosa es «sin límite» (null). */
export function limitValue(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null;
}

/** Lo que se revisa al guardar la actividad. */
export function submissionLimitsIssues(l: SubmissionLimits | null | undefined): string[] {
  if (!l) return [];
  const p: string[] = [];
  for (const [k, label] of [["before_review", "correcciones antes de la revisión"], ["after_review", "entregas nuevas después de una revisión"]] as const) {
    const v = l[k];
    if (v !== null && v !== undefined && limitValue(v) === null) p.push(`«${label}» va de 0 a 100, o sin límite`);
  }
  return p;
}

/**
 * Si la persona puede entregar otra vez y qué fila reemplaza. `history` son sus entregas recibidas de esa actividad,
 * de la más vieja a la más nueva (incluidas las `superseded`).
 */
export function submissionPlan(limits: SubmissionLimits | null | undefined, history: readonly SubmissionHistoryRow[]): SubmissionPlan {
  if (!limits || typeof limits !== "object") return { ok: true, supersede: null };
  const before = limitValue(limits.before_review);
  const after = limitValue(limits.after_review);
  const live = history.filter((s) => s.status !== "superseded");
  const last = live[live.length - 1];
  if (!last) return { ok: true, supersede: null };
  const reviewedEver = live.some((s) => s.status === "reviewed" || s.status === "needs_changes");

  if (last.status === "pending" || last.status === null) {
    if (reviewedEver) return { ok: false, code: "EV005", message: SUBMISSION_MESSAGES.EV005 };
    const used = history.length - live.length;
    if (before !== null && used >= before) return { ok: false, code: "EV003", message: SUBMISSION_MESSAGES.EV003_before };
    return { ok: true, supersede: last.id };
  }
  if (last.status === "needs_changes") return { ok: true, supersede: null };
  if (last.status === "reviewed") {
    if (last.passed !== false) return { ok: false, code: "EV004", message: SUBMISSION_MESSAGES.EV004 };
    let used = 0;
    for (let i = 1; i < live.length; i++) if (live[i - 1].status === "reviewed" && live[i - 1].passed === false) used++;
    if (after !== null && used >= after) return { ok: false, code: "EV003", message: SUBMISSION_MESSAGES.EV003_after };
    return { ok: true, supersede: null };
  }
  return { ok: true, supersede: null };
}
