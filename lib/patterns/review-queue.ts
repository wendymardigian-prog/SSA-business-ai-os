/**
 * La revision rapida de la clasificacion (F25, §13.3).
 *
 * Veinte textos por sesion, **primero los de menor confianza y las categorias
 * nuevas**: revisar los que el modelo acerto con 99 % no ensena nada y gasta el
 * rato que alguien tiene para esto.
 *
 * Puro: recibe los textos y devuelve el orden. La precision estimada sale de
 * `lib/patterns/quality.ts`, que es la unica formula; aca solo se ordena.
 */

export const REVIEW_SESSION_SIZE = 20;

export interface ReviewCandidate {
  textId: string;
  direction: "inbound" | "outbound";
  text: string;
  categoryId: string | null;
  categoryName: string | null;
  confidence: number | null;
  source: string | null;
  reviewResult: string | null;
  /** La categoria la creo el modelo: conviene mirarla antes que las de siempre. */
  categoryIsNew: boolean;
  messageCount: number;
}

/**
 * Los candidatos a revisar, ordenados.
 *
 * Quedan afuera: los ya revisados (una revision humana no se vuelve a pedir) y
 * los que puso una regla (no los decidio el modelo, no hay nada que evaluar).
 */
export function reviewQueue(candidates: ReviewCandidate[], size = REVIEW_SESSION_SIZE): ReviewCandidate[] {
  return candidates
    .filter((c) => c.reviewResult === null && c.source === "model")
    .sort((a, b) => {
      // Las categorias nuevas primero: son las que pueden estar mal inventadas.
      if (a.categoryIsNew !== b.categoryIsNew) return a.categoryIsNew ? -1 : 1;
      // Despues, la menor confianza.
      const ca = a.confidence ?? 1;
      const cb = b.confidence ?? 1;
      if (ca !== cb) return ca - cb;
      // A igual confianza, el que afecta a mas mensajes.
      if (a.messageCount !== b.messageCount) return b.messageCount - a.messageCount;
      return a.textId.localeCompare(b.textId);
    })
    .slice(0, size);
}

export interface WeeklyAccuracy {
  weekStart: string;
  reviewed: number;
  /** Porcentaje de aciertos. null cuando esa semana no se reviso nada. */
  accuracy: number | null;
}

/** El lunes de la semana de una fecha ISO. */
function mondayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Precision por semana, para la mini linea con referencia en 90 %.
 *
 * Una semana sin revisiones queda en null y se dibuja como hueco: no se reviso,
 * que no es lo mismo que haber fallado todo.
 */
export function accuracyByWeek(
  reviewed: Array<{ reviewedAt: string | null; reviewResult: string | null }>,
  weeks: string[],
): WeeklyAccuracy[] {
  const byWeek = new Map<string, { ok: number; total: number }>();
  for (const row of reviewed) {
    if (!row.reviewedAt || row.reviewResult === null) continue;
    const key = mondayKey(row.reviewedAt);
    if (!key) continue;
    const acc = byWeek.get(key) ?? { ok: 0, total: 0 };
    acc.total += 1;
    if (row.reviewResult === "ok") acc.ok += 1;
    byWeek.set(key, acc);
  }
  return weeks.map((weekStart) => {
    const acc = byWeek.get(weekStart);
    return {
      weekStart,
      reviewed: acc?.total ?? 0,
      accuracy: acc && acc.total > 0 ? Math.round((acc.ok / acc.total) * 100) : null,
    };
  });
}

/** Las ultimas N semanas (lunes), de la mas vieja a la mas nueva. */
export function lastWeeks(now: Date, count: number): string[] {
  const out: string[] = [];
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = base.getUTCDay();
  base.setUTCDate(base.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i * 7);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface CorrectedCategory {
  categoryId: string;
  name: string;
  corrected: number;
  total: number;
  pct: number;
}

/**
 * Las categorias con mas correcciones (top 3, §13.3).
 *
 * En porcentaje sobre sus propios textos y no en cantidad: una categoria con
 * doscientos textos y diez correcciones anda mejor que una con doce y cinco.
 */
export function mostCorrectedCategories(
  texts: Array<{ categoryId: string | null; categoryName: string | null; source: string | null; reviewResult: string | null }>,
  top = 3,
): CorrectedCategory[] {
  const byCategory = new Map<string, { name: string; corrected: number; total: number }>();
  for (const t of texts) {
    if (!t.categoryId || t.source !== "model") continue;
    const acc = byCategory.get(t.categoryId) ?? { name: t.categoryName ?? "Sin nombre", corrected: 0, total: 0 };
    acc.total += 1;
    if (t.reviewResult === "corrected") acc.corrected += 1;
    byCategory.set(t.categoryId, acc);
  }
  return [...byCategory.entries()]
    .filter(([, v]) => v.corrected > 0)
    .map(([categoryId, v]) => ({
      categoryId,
      name: v.name,
      corrected: v.corrected,
      total: v.total,
      pct: Math.round((v.corrected / v.total) * 100),
    }))
    .sort((a, b) => b.pct - a.pct || b.corrected - a.corrected)
    .slice(0, top);
}
