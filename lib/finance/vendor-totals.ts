/**
 * Lo que muestra la lista de proveedores (GF5): cuánto se les pagó en total y en el año, y cuándo fue el último
 * pago. Todo en CÉNTIMOS (`toCents`), nunca con un `SUM` de flotantes en el navegador. Más el filtro de la lista
 * y el borrador del formulario.
 */
import { toCents } from "@/lib/shared/money";
import { COMMON_COUNTRIES, VENDOR_NOTES_MAX, type VendorInput } from "./vendors";

export interface PaidExpenseRow {
  vendor_id: string | null;
  amount: unknown;
  paid_date: string | null;
  /** Si viene, solo cuentan los `pagado`. */
  status?: string;
}

export interface VendorTotals {
  paidCents: number;
  paidYearCents: number;
  /** Fecha civil del último pago, o null si nunca se les pagó. */
  lastPaid: string | null;
  count: number;
}

export const NO_TOTALS: VendorTotals = { paidCents: 0, paidYearCents: 0, lastPaid: null, count: 0 };

/** Los totales por proveedor. El «año» es el año civil de `todayLocal`. */
export function vendorTotals(rows: readonly PaidExpenseRow[], todayLocal: string): Map<string, VendorTotals> {
  const year = todayLocal.slice(0, 4);
  const out = new Map<string, VendorTotals>();
  for (const r of rows) {
    if (!r.vendor_id || !r.paid_date) continue;
    if (r.status !== undefined && r.status !== "pagado") continue;
    const cents = toCents(r.amount);
    const t = out.get(r.vendor_id) ?? { ...NO_TOTALS };
    t.paidCents += cents;
    if (r.paid_date.slice(0, 4) === year) t.paidYearCents += cents;
    if (!t.lastPaid || r.paid_date > t.lastPaid) t.lastPaid = r.paid_date;
    t.count += 1;
    out.set(r.vendor_id, t);
  }
  return out;
}

export function totalsOf(map: ReadonlyMap<string, VendorTotals>, id: string): VendorTotals {
  return map.get(id) ?? NO_TOTALS;
}

// ── La lista ───────────────────────────────────────────────────────────

export interface VendorRow {
  id: string;
  name: string;
  country: string | null;
  email: string | null;
  payment_details: string | null;
  terms: string | null;
  notes: string | null;
  user_id: string | null;
  archived_at: string | null;
}

export type VendorView = "activos" | "archivados";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Activos o archivados, con la búsqueda por nombre (sin importar mayúsculas ni tildes), por orden alfabético. */
export function filterVendors<T extends Pick<VendorRow, "name" | "archived_at">>(vendors: readonly T[], opts: { view: VendorView; q?: string }): T[] {
  const q = fold((opts.q ?? "").trim());
  return vendors
    .filter((v) => (opts.view === "archivados" ? !!v.archived_at : !v.archived_at))
    .filter((v) => (q === "" ? true : fold(v.name).includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function countVendors(vendors: ReadonlyArray<Pick<VendorRow, "archived_at">>): Record<VendorView, number> {
  const archivados = vendors.filter((v) => v.archived_at).length;
  return { activos: vendors.length - archivados, archivados };
}

export function countryName(code: string | null | undefined): string {
  if (!code) return "—";
  return COMMON_COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

/** Los países del selector; si el proveedor tiene uno que no está en la lista, se suma para no perderlo al editar. */
export function countryOptions(current: string | null | undefined): Array<{ code: string; name: string }> {
  if (current && !COMMON_COUNTRIES.some((c) => c.code === current)) return [...COMMON_COUNTRIES, { code: current, name: current }];
  return [...COMMON_COUNTRIES];
}

// ── El formulario ──────────────────────────────────────────────────────

export interface VendorDraft {
  id: string | null;
  name: string;
  country: string;
  email: string;
  paymentDetails: string;
  terms: string;
  notes: string;
}

export const EMPTY_VENDOR_DRAFT: VendorDraft = { id: null, name: "", country: "", email: "", paymentDetails: "", terms: "", notes: "" };

export function draftFromVendor(v: VendorRow): VendorDraft {
  return {
    id: v.id,
    name: v.name,
    country: v.country ?? "",
    email: v.email ?? "",
    paymentDetails: v.payment_details ?? "",
    terms: v.terms ?? "",
    notes: v.notes ?? "",
  };
}

/** Lo que reciben `createVendor` y `updateVendor` (vacío = «sin dato»; el servidor valida de nuevo). */
export function toVendorInput(d: VendorDraft): Pick<VendorInput, "name"> & Record<string, string> {
  return { name: d.name.trim(), country: d.country.trim(), email: d.email.trim(), paymentDetails: d.paymentDetails, terms: d.terms, notes: d.notes };
}

export function vendorDraftError(d: VendorDraft): string | null {
  if (!d.name.trim()) return "Poné un nombre";
  if (d.notes.length > VENDOR_NOTES_MAX) return `Las notas pueden tener hasta ${VENDOR_NOTES_MAX} caracteres`;
  return null;
}
