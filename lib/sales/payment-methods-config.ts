/**
 * Los métodos de pago DEL NEGOCIO (Extra I, MP): una lista en `workspaces.payment_methods` (jsonb), no
 * una constante. Cada método tiene nombre, porcentaje y fijo del procesador, y un interruptor de activo.
 *
 * Puro: sin base ni red. Lo importan el servidor (acciones, loaders) y las pantallas.
 *
 * Reglas que viven acá y NO en la pantalla:
 *  - la `key` no cambia nunca (los pagos la guardan) y los métodos no se borran, se desactivan;
 *  - nombres únicos sin importar mayúsculas, y al menos un método activo.
 */
import { z } from "zod";
import { PAYMENT_METHODS, type PaymentMethodDef } from "./payment-methods";

export interface PaymentMethodConfig {
  /** Clave estable (`^[a-z0-9_]{2,40}$`). La guardan los pagos: no cambia nunca. */
  key: string;
  name: string;
  /** Porcentaje del procesador, 0 a 100, hasta 3 decimales. */
  fee_percent: number;
  /** Fijo en USD, ≥ 0, 2 decimales. */
  fee_fixed: number;
  active: boolean;
  created_at: string;
}

export const METHOD_KEY_RE = /^[a-z0-9_]{2,40}$/;
export const METHOD_NAME_MAX = 60;

/** Redondea a `decimals` sin dejar que el flotante se cuele (`2.9` sigue siendo `2.9`). */
function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

const decimalsOk = (value: number, decimals: number) => Math.abs(round(value, decimals) - value) < 1e-9;

export const paymentMethodConfigSchema = z.object({
  key: z.string().regex(METHOD_KEY_RE),
  name: z.string().trim().min(1).max(METHOD_NAME_MAX),
  fee_percent: z.number().min(0).max(100).refine((v) => decimalsOk(v, 3), "hasta 3 decimales"),
  fee_fixed: z.number().min(0).max(1_000_000).refine((v) => decimalsOk(v, 2), "hasta 2 decimales"),
  active: z.boolean(),
  created_at: z.string().min(1),
});

/** El catálogo de arranque: los 5 métodos de siempre, todos activos y con comisión 0. */
export function starterPaymentMethods(createdAt = "2026-10-15T00:00:00.000Z"): PaymentMethodConfig[] {
  return PAYMENT_METHODS.map((m) => ({
    key: m.key,
    name: m.name,
    fee_percent: m.feePercent,
    fee_fixed: m.feeFixed,
    active: true,
    created_at: createdAt,
  }));
}

/**
 * Lee lo que viene de la base. NUNCA lanza: una entrada inválida se descarta (y se avisa en el log, sin
 * datos del negocio), una clave repetida se queda con la primera, y si no queda nada usable devuelve el
 * catálogo de arranque (un negocio sin métodos no podría cobrar nada).
 */
export function parsePaymentMethods(json: unknown): PaymentMethodConfig[] {
  if (!Array.isArray(json)) return starterPaymentMethods();
  const seen = new Set<string>();
  const out: PaymentMethodConfig[] = [];
  for (const raw of json) {
    const parsed = paymentMethodConfigSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[payment-methods] descarto un método inválido");
      continue;
    }
    if (seen.has(parsed.data.key)) continue;
    seen.add(parsed.data.key);
    out.push(parsed.data);
  }
  return out.length > 0 ? out : starterPaymentMethods();
}

/** El formato que usan las reglas de comisión y el snapshot: `feePercent` / `feeFixed`. */
export function toMethodDef(m: Pick<PaymentMethodConfig, "key" | "name" | "fee_percent" | "fee_fixed">): PaymentMethodDef {
  return { key: m.key, name: m.name, feePercent: m.fee_percent, feeFixed: m.fee_fixed };
}

/** Todos los métodos del negocio (activos o no): lo que hace falta para MOSTRAR y para cobrar con uno viejo. */
export function methodDefs(methods: readonly PaymentMethodConfig[]): PaymentMethodDef[] {
  return methods.map(toMethodDef);
}

/** Las claves de los métodos activos: lo que se ofrece en pagos nuevos. */
export function activeMethodKeys(methods: readonly PaymentMethodConfig[]): string[] {
  return methods.filter((m) => m.active).map((m) => m.key);
}

/** Slug sin tildes, `[a-z0-9_]`, entre 2 y 40 caracteres; si existe, `_2`, `_3`… */
export function newMethodKey(name: string, existing: readonly string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 34) || "metodo";
  const root = base.length >= 2 ? base : `${base}_x`;
  const taken = new Set(existing);
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}_${Date.now()}`;
}

export type MethodsUpdateResult = { ok: true } | { ok: false; error: string };

/**
 * Qué se puede hacer con la lista al guardar. `before` es lo que hay en la base; `after`, lo que llega.
 * No se puede quitar un método ni cambiar su `key`; los nombres son únicos sin importar mayúsculas y
 * tiene que quedar al menos uno activo.
 */
export function validateMethodsUpdate(before: readonly PaymentMethodConfig[], after: readonly PaymentMethodConfig[]): MethodsUpdateResult {
  const afterKeys = new Set(after.map((m) => m.key));
  if (afterKeys.size !== after.length) return { ok: false, error: "Hay dos métodos con la misma clave" };
  for (const m of before) {
    if (!afterKeys.has(m.key)) return { ok: false, error: `No se puede quitar «${m.name}»: desactivalo para que no se ofrezca más` };
  }
  const names = new Set<string>();
  for (const m of after) {
    const norm = m.name.trim().toLowerCase();
    if (names.has(norm)) return { ok: false, error: `Ya hay un método llamado «${m.name.trim()}»` };
    names.add(norm);
  }
  if (!after.some((m) => m.active)) return { ok: false, error: "Tiene que quedar al menos un método activo" };
  return { ok: true };
}
