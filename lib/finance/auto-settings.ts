/**
 * Configuración de los gastos automáticos (GF19). PURO: valida lo que manda la pantalla contra lo que existe
 * (métodos de pago, cuentas de Meta, categorías) y dice qué proveedores hay que crear o reusar. La Server Action
 * (`lib/actions/finance-auto.ts`) hace el resto: crea los proveedores y escribe SOLO esas claves del jsonb.
 *
 * Apagar un automático no borra su configuración (queda guardada, apagada) y no toca los gastos ya creados.
 */
import { activeCategories, findCategory, type ExpenseCategory } from "./categories";
import { shortMethodName } from "./auto-expenses";
import type { RuleResult } from "./expense-rules";
import { checkAutoCloseDays, CHARGE_MODES, type AutoExpenseSetting, type ChargeMode, type FinanceSettings } from "./settings";

export type AutoSection = "processor_fees" | "meta_ads";

/** Una fila de la pantalla. `key` = clave del método de pago o `ad_account_id`. */
export interface AutoSettingInput {
  key: string;
  enabled: boolean;
  chargeMode: ChargeMode;
  categoryKey: string | null;
  vendorId: string | null;
}

export interface AutoSettingsInput {
  processorFees: AutoSettingInput[];
  metaAds: AutoSettingInput[];
  autoCloseDays: number | string;
}

export interface AutoSettingsContext {
  /** Los métodos del negocio: clave y nombre (incluye los inactivos: se puede dejar de usar uno y conservar su configuración). */
  methods: ReadonlyArray<{ key: string; name: string }>;
  /** Las cuentas publicitarias de la integración de Meta. */
  metaAccounts: ReadonlyArray<{ id: string; name: string; currency: string | null }>;
  categories: readonly ExpenseCategory[];
}

/** Un proveedor que hay que crear (o reusar si ya hay uno activo con ese nombre) antes de guardar. */
export interface VendorNeed {
  section: AutoSection;
  key: string;
  name: string;
}

export interface AutoSettingsPlan {
  processor_fees: Record<string, AutoExpenseSetting>;
  meta_ads: Record<string, AutoExpenseSetting>;
  auto_close_days: number;
  needsVendor: VendorNeed[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const META_VENDOR_NAME = "Meta";

function planSection(
  section: AutoSection,
  rows: readonly AutoSettingInput[],
  current: Record<string, AutoExpenseSetting>,
  known: ReadonlyMap<string, { name: string; currency?: string | null }>,
  categories: readonly ExpenseCategory[],
): RuleResult<{ map: Record<string, AutoExpenseSetting>; needs: VendorNeed[] }> {
  const map: Record<string, AutoExpenseSetting> = { ...current };
  const needs: VendorNeed[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.key)) return { ok: false, error: "Hay una fila repetida en la configuración" };
    seen.add(row.key);
    const entry = known.get(row.key);
    if (!entry) return { ok: false, error: section === "processor_fees" ? "Ese método de pago no existe" : "Esa cuenta publicitaria no está en la integración de Meta" };
    if (!(CHARGE_MODES as readonly string[]).includes(row.chargeMode)) return { ok: false, error: "Elegí cómo se cobra" };
    if (row.vendorId !== null && !UUID.test(row.vendorId)) return { ok: false, error: "Ese proveedor no es válido" };
    if (row.categoryKey !== null) {
      const category = findCategory(categories, row.categoryKey);
      const alreadyUsed = current[row.key]?.category_key === row.categoryKey;
      if (!category || (!alreadyUsed && !activeCategories(categories).some((c) => c.key === category.key))) return { ok: false, error: "Elegí una categoría activa" };
    }
    if (row.enabled && section === "meta_ads" && (entry.currency ?? "").toUpperCase() !== "USD") {
      return { ok: false, error: `La cuenta «${entry.name}» no está en dólares: por ahora solo se pueden automatizar cuentas en USD` };
    }
    map[row.key] = { enabled: row.enabled, vendor_id: row.vendorId, category_key: row.categoryKey, charge_mode: row.chargeMode };
    if (row.enabled && row.vendorId === null) needs.push({ section, key: row.key, name: section === "meta_ads" ? META_VENDOR_NAME : shortMethodName(entry.name) });
  }
  return { ok: true, map, needs };
}

export function planAutoSettings(input: AutoSettingsInput, current: FinanceSettings, ctx: AutoSettingsContext): RuleResult<{ plan: AutoSettingsPlan }> {
  const days = checkAutoCloseDays(input.autoCloseDays);
  if (!days.ok) return days;
  const methods = planSection("processor_fees", input.processorFees, current.processor_fees, new Map(ctx.methods.map((m) => [m.key, { name: m.name }])), ctx.categories);
  if (!methods.ok) return methods;
  const meta = planSection("meta_ads", input.metaAds, current.meta_ads, new Map(ctx.metaAccounts.map((a) => [a.id, { name: a.name, currency: a.currency }])), ctx.categories);
  if (!meta.ok) return meta;
  return { ok: true, plan: { processor_fees: methods.map, meta_ads: meta.map, auto_close_days: days.value, needsVendor: [...methods.needs, ...meta.needs] } };
}
