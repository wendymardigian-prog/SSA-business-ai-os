/**
 * Los limites del freno automatico del marketing: lo que dispara la pausa y lo que puede escribir una persona en
 * «Entrega de marketing». PURO: lo usan el freno (servidor), la accion y la pantalla.
 *
 * Se guardan como porcentaje en texto (`marketing_brake_bounce_pct`, `marketing_brake_complaint_pct`), en la config de
 * Resend. Sin guardar, o con un valor invalido, rige el limite por defecto.
 */

export const DEFAULT_BRAKE_BOUNCE_PCT = 2;
export const DEFAULT_BRAKE_COMPLAINT_PCT = 0.05;

/** Lo que se puede escribir. Un freno que nunca salta deja de proteger el dominio: el tope de arriba es a proposito. */
export const BRAKE_BOUNCE_PCT_RANGE = { min: 0.5, max: 10 } as const;
export const BRAKE_COMPLAINT_PCT_RANGE = { min: 0.01, max: 1 } as const;

export interface BrakeLimits {
  bouncePct: number;
  complaintPct: number;
}

export const DEFAULT_BRAKE_LIMITS: BrakeLimits = { bouncePct: DEFAULT_BRAKE_BOUNCE_PCT, complaintPct: DEFAULT_BRAKE_COMPLAINT_PCT };

type Range = { readonly min: number; readonly max: number };

function inRange(value: number, range: Range): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

function storedPct(raw: unknown, range: Range, fallback: number): number {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const value = Number(raw);
  return inRange(value, range) ? value : fallback;
}

/** Los limites guardados en la config de Resend. Nunca lanza: lo que no sirve vale lo que vale por defecto. */
export function brakeLimitsFromConfig(config: Record<string, unknown> | null | undefined): BrakeLimits {
  return {
    bouncePct: storedPct(config?.marketing_brake_bounce_pct, BRAKE_BOUNCE_PCT_RANGE, DEFAULT_BRAKE_BOUNCE_PCT),
    complaintPct: storedPct(config?.marketing_brake_complaint_pct, BRAKE_COMPLAINT_PCT_RANGE, DEFAULT_BRAKE_COMPLAINT_PCT),
  };
}

/**
 * El porcentaje como cociente, sin el ruido de la coma flotante (0,3 / 100 no da lo mismo que 3 / 1000, y el freno
 * compara por «estrictamente mayor»: el limite justo no puede frenar).
 */
export function pctToRate(pct: number): number {
  return Math.round(pct * 10_000) / 1_000_000;
}

/** Como se le muestra un limite a una persona: «0,05». */
export function formatBrakePct(pct: number): string {
  return pct.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

/** Valida lo que escribe una persona (admite coma o punto). Devuelve el texto que se guarda. */
export function parseBrakePct(raw: unknown, range: Range, label: string): { ok: true; value: string } | { ok: false; error: string } {
  const text = String(raw ?? "").trim().replace("%", "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: `${label}: escribí un porcentaje, por ejemplo ${formatBrakePct(range.min)}.` };
  const value = Number(text);
  if (!inRange(value, range)) return { ok: false, error: `${label}: tiene que estar entre ${formatBrakePct(range.min)} % y ${formatBrakePct(range.max)} %.` };
  return { ok: true, value: String(value) };
}
