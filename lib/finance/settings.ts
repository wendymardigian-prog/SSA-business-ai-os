/**
 * La configuración de Finanzas: `workspaces.finance_settings` (jsonb). Una columna por pantalla, así dos
 * personas guardando secciones distintas no se pisan.
 *
 *   { expense_categories: [...], processor_fees: {...}, meta_ads: {...}, auto_close_days: 3 }
 *
 * Se lee con el cliente del usuario (cualquier miembro puede leer `workspaces`; no hay datos sensibles) y se
 * escribe SOLO por Server Action con el cliente de servicio, después de `expenses.manage`.
 */
import { z } from "zod";
import { DEFAULT_EXPENSE_CATEGORIES, parseCategories, type ExpenseCategory } from "./categories";

export const CHARGE_MODES = ["automatic", "manual"] as const;
export type ChargeMode = (typeof CHARGE_MODES)[number];

const uuidOrNull = z.string().uuid().nullable().default(null);

/** Un método de pago (clave de `workspaces.payment_methods`) con comisiones automáticas. */
export const processorFeeSettingSchema = z.object({
  enabled: z.boolean(),
  vendor_id: uuidOrNull,
  category_key: z.string().regex(/^[a-z0-9_]{2,40}$/).nullable().default(null),
  charge_mode: z.enum(CHARGE_MODES).default("automatic"),
});

/** Una cuenta publicitaria de Meta (`ad_account_id`). */
export const metaAdsSettingSchema = processorFeeSettingSchema;

export type AutoExpenseSetting = z.output<typeof processorFeeSettingSchema>;

export interface FinanceSettings {
  expense_categories: ExpenseCategory[];
  processor_fees: Record<string, AutoExpenseSetting>;
  meta_ads: Record<string, AutoExpenseSetting>;
  auto_close_days: number;
}

export const AUTO_CLOSE_MAX = 10;
export const DEFAULT_AUTO_CLOSE_DAYS = 3;

export function defaultFinanceSettings(): FinanceSettings {
  return {
    expense_categories: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c })),
    processor_fees: {},
    meta_ads: {},
    auto_close_days: DEFAULT_AUTO_CLOSE_DAYS,
  };
}

function parseAutoMap(json: unknown): Record<string, AutoExpenseSetting> {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: Record<string, AutoExpenseSetting> = {};
  for (const [key, raw] of Object.entries(json as Record<string, unknown>)) {
    const parsed = processorFeeSettingSchema.safeParse(raw);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

/** Lee lo guardado. Nunca lanza: lo inválido cae al valor por defecto de esa parte. */
export function parseFinanceSettings(json: unknown): FinanceSettings {
  const raw = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const days = Number(raw.auto_close_days);
  return {
    expense_categories: parseCategories(raw.expense_categories),
    processor_fees: parseAutoMap(raw.processor_fees),
    meta_ads: parseAutoMap(raw.meta_ads),
    auto_close_days: Number.isInteger(days) && days >= 0 && days <= AUTO_CLOSE_MAX ? days : DEFAULT_AUTO_CLOSE_DAYS,
  };
}

/** Los días de cierre automático, validados (0 a 10). */
export function checkAutoCloseDays(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const n = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isInteger(n) || n < 0 || n > AUTO_CLOSE_MAX) {
    return { ok: false, error: `Los días de cierre tienen que ser un número entero de 0 a ${AUTO_CLOSE_MAX}` };
  }
  return { ok: true, value: n };
}
