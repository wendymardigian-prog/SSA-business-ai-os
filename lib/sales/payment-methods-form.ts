/**
 * El formulario de un método de pago (Ajustes > General > Ventas). Puro: la pantalla solo compone.
 * Acepta coma o punto decimal ("2,9" y "2.9") porque quien carga escribe como habla.
 */
import { METHOD_NAME_MAX, type PaymentMethodConfig } from "./payment-methods-config";

export interface MethodDraft {
  /** Vacío = método nuevo. */
  key?: string;
  name: string;
  percent: string;
  fixed: string;
  active: boolean;
}

export const EMPTY_DRAFT: MethodDraft = { name: "", percent: "", fixed: "", active: true };

const NUMBER = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 3, useGrouping: false });

export function draftFromMethod(m: PaymentMethodConfig): MethodDraft {
  return { key: m.key, name: m.name, percent: m.fee_percent === 0 ? "" : NUMBER.format(m.fee_percent), fixed: m.fee_fixed === 0 ? "" : NUMBER.format(m.fee_fixed), active: m.active };
}

/** "2,9" → 2.9; vacío → 0; algo que no es un número → null. */
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type DraftResult = { ok: true; value: { name: string; fee_percent: number; fee_fixed: number } } | { ok: false; error: string };

export function parseDraft(draft: MethodDraft, others: readonly PaymentMethodConfig[]): DraftResult {
  const name = draft.name.trim();
  if (!name) return { ok: false, error: "Poné un nombre" };
  if (name.length > METHOD_NAME_MAX) return { ok: false, error: `El nombre puede tener hasta ${METHOD_NAME_MAX} caracteres` };
  const clash = others.find((m) => m.key !== draft.key && m.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) return { ok: false, error: `Ya hay un método llamado «${clash.name}»` };
  const pct = parseDecimal(draft.percent);
  if (pct === null || pct > 100) return { ok: false, error: "El porcentaje tiene que estar entre 0 y 100" };
  if (Math.abs(Math.round(pct * 1000) / 1000 - pct) > 1e-9) return { ok: false, error: "El porcentaje admite hasta 3 decimales" };
  const fixed = parseDecimal(draft.fixed);
  if (fixed === null) return { ok: false, error: "El fijo tiene que ser un monto en dólares" };
  if (Math.abs(Math.round(fixed * 100) / 100 - fixed) > 1e-9) return { ok: false, error: "El fijo admite hasta 2 decimales" };
  return { ok: true, value: { name, fee_percent: pct, fee_fixed: fixed } };
}

/** Lo que viaja a `updatePaymentMethods`: la lista completa, con el método editado o el nuevo al final. */
export function methodsPayload(current: readonly PaymentMethodConfig[], draft: MethodDraft, value: { name: string; fee_percent: number; fee_fixed: number }) {
  const rows = current.map((m) => ({ key: m.key, name: m.name, fee_percent: m.fee_percent, fee_fixed: m.fee_fixed, active: m.active }));
  if (draft.key) return rows.map((r) => (r.key === draft.key ? { ...r, ...value, active: draft.active } : r));
  return [...rows, { ...value, active: draft.active }];
}

/** Activar o desactivar un método sin tocar el resto. */
export function togglePayload(current: readonly PaymentMethodConfig[], key: string, active: boolean) {
  return current.map((m) => ({ key: m.key, name: m.name, fee_percent: m.fee_percent, fee_fixed: m.fee_fixed, active: m.key === key ? active : m.active }));
}

/** "2,9 % + USD 0,30" para la columna de comisión; "Sin comisión" si es 0. */
export function feeSummary(m: Pick<PaymentMethodConfig, "fee_percent" | "fee_fixed">): string {
  const parts: string[] = [];
  if (m.fee_percent > 0) parts.push(`${NUMBER.format(m.fee_percent).replace(".", ",")} %`);
  if (m.fee_fixed > 0) parts.push(`USD ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(m.fee_fixed)}`);
  return parts.length ? parts.join(" + ") : "Sin comisión";
}
