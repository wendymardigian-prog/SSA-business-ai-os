/**
 * Ajustes > General > Finanzas > «Gastos automáticos» (GF19). PURO: arma las filas de la pantalla a partir de los
 * métodos de pago del negocio, las cuentas de Meta y lo guardado, dice qué se puede encender y manda al servidor
 * SOLO las filas que cambiaron (no llena la configuración con un renglón apagado por cada método).
 */
import { shortMethodName } from "./auto-expenses";
import type { AutoSettingInput } from "./auto-settings";
import { AUTO_CLOSE_MAX, type AutoExpenseSetting, type ChargeMode } from "./settings";

export type AutoSectionId = "processor_fees" | "meta_ads";

/** Una fila de la pantalla: un método de pago o una cuenta publicitaria. */
export interface AutoRowView {
  /** Clave del método de pago, o `ad_account_id`. */
  key: string;
  name: string;
  enabled: boolean;
  chargeMode: ChargeMode;
  categoryKey: string | null;
  vendorId: string | null;
  /** El interruptor no se puede prender (se puede dejar apagado). */
  locked: boolean;
  /** Por qué está bloqueado (se muestra debajo). */
  lockedReason: string | null;
  /** Una aclaración que no bloquea (por ejemplo: sin comisión en Ventas). */
  note: string | null;
  /** El nombre con el que se crea el proveedor automático si no se elige ninguno. */
  vendorDefaultName: string;
}

export interface FinanceAutoData {
  processorRows: AutoRowView[];
  metaRows: AutoRowView[];
  autoCloseDays: number;
  /** Proveedores activos que se pueden elegir. */
  vendors: Array<{ id: string; name: string }>;
  /** No se pudieron leer las cuentas de Meta (distinto de «no hay»). */
  metaFailed: boolean;
}

export interface MethodLite {
  key: string;
  name: string;
  active: boolean;
  fee_percent: number;
  fee_fixed: number;
}

export interface MetaAccountLite {
  id: string;
  name: string;
  currency: string | null;
}

export const NO_FEE_NOTE = "Este método no tiene comisión configurada en Ventas; encenderlo no genera gastos.";
export const ONLY_USD_NOTE = "Solo USD por ahora";
export const META_VENDOR_DEFAULT = "Meta";

const fromSetting = (s: AutoExpenseSetting | undefined) => ({
  enabled: s?.enabled ?? false,
  chargeMode: (s?.charge_mode ?? "automatic") as ChargeMode,
  categoryKey: s?.category_key ?? null,
  vendorId: s?.vendor_id ?? null,
});

/**
 * Una fila por método activo del negocio, más los desactivados que todavía tienen un automático encendido (para poder
 * apagarlo). Un método desactivado y sin configuración no se ofrece.
 */
export function buildProcessorRows(methods: readonly MethodLite[], current: Record<string, AutoExpenseSetting>): AutoRowView[] {
  return methods
    .filter((m) => m.active || current[m.key]?.enabled)
    .map((m) => {
      const noFee = !(m.fee_percent > 0) && !(m.fee_fixed > 0);
      return {
        key: m.key,
        name: m.name,
        ...fromSetting(current[m.key]),
        locked: false,
        lockedReason: null,
        note: !m.active ? "Este método está desactivado en Ventas." : noFee ? NO_FEE_NOTE : null,
        vendorDefaultName: shortMethodName(m.name),
      };
    });
}

/** Una fila por cuenta publicitaria. Las que no están en USD no se pueden encender (sí apagar, si ya estaban encendidas). */
export function buildMetaRows(accounts: readonly MetaAccountLite[], current: Record<string, AutoExpenseSetting>): AutoRowView[] {
  return accounts.map((a) => {
    const base = fromSetting(current[a.id]);
    const isUsd = (a.currency ?? "").toUpperCase() === "USD";
    return {
      key: a.id,
      name: a.name,
      ...base,
      locked: !isUsd && !base.enabled,
      lockedReason: isUsd ? null : ONLY_USD_NOTE,
      note: null,
      vendorDefaultName: META_VENDOR_DEFAULT,
    };
  });
}

export function sameRow(a: AutoRowView, b: AutoRowView): boolean {
  return a.enabled === b.enabled && a.chargeMode === b.chargeMode && a.categoryKey === b.categoryKey && a.vendorId === b.vendorId;
}

/** Las filas que cambiaron respecto de lo que se cargó, en el formato que espera `saveAutoExpenseSettings`. */
export function changedInputs(rows: readonly AutoRowView[], baseline: readonly AutoRowView[]): AutoSettingInput[] {
  const before = new Map(baseline.map((r) => [r.key, r]));
  return rows
    .filter((r) => {
      const was = before.get(r.key);
      return !was || !sameRow(r, was);
    })
    .map((r) => ({ key: r.key, enabled: r.enabled, chargeMode: r.chargeMode, categoryKey: r.categoryKey, vendorId: r.vendorId }));
}

export function isAutoDirty(
  state: { processor: readonly AutoRowView[]; meta: readonly AutoRowView[]; days: string },
  baseline: { processor: readonly AutoRowView[]; meta: readonly AutoRowView[]; days: string },
): boolean {
  return (
    changedInputs(state.processor, baseline.processor).length > 0 ||
    changedInputs(state.meta, baseline.meta).length > 0 ||
    state.days.trim() !== baseline.days.trim()
  );
}

/** Los días de cierre como los escribe la persona: vacío o fuera de 0 a 10 es un error (el servidor lo vuelve a validar). */
export function autoCloseDaysError(text: string, max = AUTO_CLOSE_MAX): string | null {
  const t = text.trim();
  const n = Number(t);
  if (t === "" || !/^\d+$/.test(t) || !Number.isInteger(n) || n < 0 || n > max) return `Los días de cierre tienen que ser un número entero de 0 a ${max}`;
  return null;
}
