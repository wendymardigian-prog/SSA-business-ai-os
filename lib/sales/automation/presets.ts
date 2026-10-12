/**
 * Los atajos del selector de triggers de Ventas (plano F37). Son PRESETS del editor, no tipos
 * aparte: cada uno es un tipo guardado más la configuración que deja elegida. «Pago cobrado» y
 * «Cambió el estado del pago» son el mismo `payment_status_changed`.
 *
 * Un trigger guardado con un preset se reabre mostrando el nombre del atajo (`presetFor`); si la
 * configuración ya no coincide con ninguno, se muestra el genérico. Puro.
 */
import { paymentStatusLabel, saleStatusLabel } from "../labels";
import { DEFAULT_AT_TIME, SALES_TRIGGER_LABELS, validateSalesTriggerConfig, type SalesTriggerType } from "./triggers";

export interface SalesPreset {
  key: string;
  label: string;
  type: SalesTriggerType;
  /** Lo que el preset deja elegido. */
  config: Record<string, unknown>;
  /** Una línea para el selector. */
  description: string;
}

export const SALES_PRESETS: readonly SalesPreset[] = [
  { key: "sale_created", label: "Venta creada", type: "sale_created", config: {}, description: "Cuando se carga una venta nueva" },
  { key: "sale_status_changed", label: "Cambió el estado de la venta", type: "sale_status_changed", config: {}, description: "Elegís desde qué estado y hacia cuál" },
  { key: "sale_cancelled", label: "Venta cancelada", type: "sale_status_changed", config: { to_status: ["cancelled"] }, description: "Cuando una venta se cancela" },
  { key: "sale_settled", label: "Venta saldada", type: "sale_status_changed", config: { to_status: ["paid"] }, description: "Cuando una venta queda totalmente cobrada" },
  { key: "payment_created", label: "Pago creado", type: "payment_created", config: {}, description: "Cuando se crea un pago (programado, cobrado o reembolso)" },
  { key: "payment_status_changed", label: "Cambió el estado del pago", type: "payment_status_changed", config: {}, description: "Elegís desde qué estado y hacia cuál" },
  { key: "payment_paid", label: "Pago cobrado", type: "payment_status_changed", config: { to_status: ["paid"] }, description: "Cuando se cobra un pago" },
  { key: "payment_overdue", label: "Pago vencido (moroso)", type: "payment_status_changed", config: { to_status: ["overdue"] }, description: "Cuando un pago pasa a moroso" },
  { key: "refund_registered", label: "Reembolso registrado", type: "payment_created", config: { payment_types: ["refund"] }, description: "Cuando se registra un reembolso, total o parcial" },
  { key: "payment_before_due", label: "X días antes de un vencimiento", type: "payment_before_due", config: {}, description: "Un recordatorio antes de que venza un pago" },
  { key: "payment_after_due", label: "X días después de un vencimiento impago", type: "payment_after_due", config: {}, description: "Un aviso si el pago sigue sin cobrarse" },
];

export function getPreset(key: string): SalesPreset | undefined {
  return SALES_PRESETS.find((p) => p.key === key);
}

const sameSet = (a: unknown, b: unknown): boolean => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
};

/**
 * El atajo que corresponde a un trigger guardado. Gana el más específico: el preset cuyas claves
 * (`to_status`, `payment_types`…) coinciden EXACTAMENTE con las de la configuración. Los demás filtros
 * (producto, método…) no cambian el nombre. Si ninguno específico coincide, el genérico del tipo.
 */
export function presetFor(type: string, config: unknown): SalesPreset | null {
  const candidates = SALES_PRESETS.filter((p) => p.type === type);
  if (candidates.length === 0) return null;
  const cfg = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const specific = candidates.filter((p) => Object.keys(p.config).length > 0);
  for (const preset of specific) {
    if (Object.entries(preset.config).every(([key, value]) => sameSet(cfg[key], value))) return preset;
  }
  return candidates.find((p) => Object.keys(p.config).length === 0) ?? null;
}

const list = (values: unknown, label: (v: string) => string): string | null => {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.map((v) => label(String(v))).join(" o ");
};

/** «Pago: Programado → Cobrado», «3 días antes del vencimiento, 09:00»… para la lista y el resumen. */
export function describeSalesTrigger(type: string, rawConfig: unknown): string {
  const checked = validateSalesTriggerConfig(type, rawConfig);
  if (!checked.ok) return "Configuración incompleta";
  const c = checked.config;
  switch (type) {
    case "sale_created":
      return "Venta creada";
    case "sale_status_changed": {
      const from = list(c.from_status, saleStatusLabel) ?? "cualquiera";
      const to = list(c.to_status, saleStatusLabel) ?? "cualquiera";
      return `Venta: ${from} → ${to}`;
    }
    case "payment_created": {
      const types = Array.isArray(c.payment_types) && c.payment_types.length ? c.payment_types.join(", ") : null;
      return types === "refund" ? "Reembolso registrado" : "Pago creado";
    }
    case "payment_status_changed": {
      const from = list(c.from_status, paymentStatusLabel) ?? "cualquiera";
      const to = list(c.to_status, paymentStatusLabel) ?? "cualquiera";
      return `Pago: ${from} → ${to}`;
    }
    case "payment_before_due": {
      const days = Number(c.offset_days);
      return `${days === 0 ? "El día del vencimiento" : `${days} ${days === 1 ? "día" : "días"} antes del vencimiento`}, ${c.at_time ?? DEFAULT_AT_TIME}`;
    }
    case "payment_after_due": {
      const days = Number(c.offset_days);
      return `${days} ${days === 1 ? "día" : "días"} después del vencimiento si sigue impago, ${c.at_time ?? DEFAULT_AT_TIME}`;
    }
    default:
      return SALES_TRIGGER_LABELS[type as SalesTriggerType] ?? type;
  }
}
