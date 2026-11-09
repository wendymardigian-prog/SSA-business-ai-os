// @plantilla-quitar(servicios)
/**
 * La pestaña «Servicio» de la variante (F31): de la configuración guardada al formulario y de vuelta.
 *
 * Puro. El formulario tiene SIEMPRE todos los campos (con sus valores por defecto) para que cambiar de modo y volver
 * no pierda lo escrito; `toServiceSettings` arma solo las claves del modo elegido (la base rechaza las demás). La
 * validación es la de `validateServiceSettings`, gemela de la SQL.
 */
import {
  serviceMode,
  type ServiceMode,
  type ServiceSettings,
  type WhenRule,
} from "../settings";

export interface ServiceSettingsForm {
  mode: ServiceMode;
  // Crea
  rule: WhenRule;
  /** El porcentaje (percent) o el monto en dólares (amount). */
  ruleValue: string;
  confirm: boolean;
  start: "payment_date" | "sale_date" | "manual";
  ownerMode: "fixed" | "round_robin" | "conditions" | "previous";
  ownerUserId: string;
  ownerMembers: string[];
  ownerConditions: unknown[];
  fallbackUserId: string;
  renewal: "new_linked" | "extend" | "ask";
  // Extiende
  extendAnyVariant: boolean;
  extendTargets: string[];
  extendN: string;
  extendUnit: "days" | "weeks" | "months";
  extendAccesses: boolean;
  ifNoService: "confirm" | "create";
  fallbackVariantId: string;
  // Comun a crea y extiende
  overdueRedDays: string;
  overdueCut: boolean;
  overdueCutDays: string;
  overdueRestore: boolean;
  /** Cuándo se prendió la regla (se conserva tal cual: lo maneja la base). */
  enabledAt: string | null;
}

const str = (v: unknown, fallback = "") => (typeof v === "number" ? String(v) : typeof v === "string" ? v : fallback);

/** La configuración guardada como formulario. Una variante sin configurar (`{}`) es «No crea servicio». */
export function serviceSettingsForm(settings: unknown): ServiceSettingsForm {
  const s = (settings && typeof settings === "object" ? settings : {}) as ServiceSettings;
  const mode = serviceMode(s);
  const when = s.when ?? { rule: "any_payment" as WhenRule };
  const owner = s.owner ?? { mode: "round_robin" as const };
  const ext = s.extend ?? {};
  return {
    mode,
    rule: when.rule ?? "any_payment",
    ruleValue: when.value == null ? "" : String(when.value),
    confirm: s.confirm === true,
    start: s.start ?? "payment_date",
    ownerMode: owner.mode ?? "round_robin",
    ownerUserId: owner.user_id ?? "",
    ownerMembers: owner.members ?? [],
    ownerConditions: owner.conditions ?? [],
    fallbackUserId: owner.fallback_user_id ?? "",
    renewal: s.renewal ?? "new_linked",
    extendAnyVariant: ext.target_variant_ids == null,
    extendTargets: ext.target_variant_ids ?? [],
    extendN: str(ext.n, "1"),
    extendUnit: ext.unit ?? "months",
    extendAccesses: ext.extend_accesses === true,
    ifNoService: ext.if_no_service ?? "confirm",
    fallbackVariantId: ext.fallback_variant_id ?? "",
    overdueRedDays: str(s.light?.overdue_red_days, ""),
    overdueCut: s.overdue_cut?.enabled === true,
    overdueCutDays: str(s.overdue_cut?.days, "15"),
    overdueRestore: s.overdue_cut?.restore !== false,
    enabledAt: when.enabled_at ?? null,
  };
}

const num = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** El formulario como configuración: solo las claves del modo elegido. */
export function toServiceSettings(f: ServiceSettingsForm): ServiceSettings {
  if (f.mode === "none") return {};
  const out: ServiceSettings = { v: 1, mode: f.mode };
  const when: NonNullable<ServiceSettings["when"]> = { rule: f.rule };
  if (f.rule === "percent" || f.rule === "amount") when.value = num(f.ruleValue);
  if (f.enabledAt) when.enabled_at = f.enabledAt;
  out.when = when;
  if (f.mode === "create") {
    out.confirm = f.confirm;
    out.start = f.start;
    const owner: NonNullable<ServiceSettings["owner"]> = { mode: f.ownerMode };
    if (f.ownerMode === "fixed") owner.user_id = f.ownerUserId || null;
    if (f.ownerMode === "round_robin") owner.members = f.ownerMembers;
    if (f.ownerMode === "conditions") {
      owner.conditions = f.ownerConditions;
      owner.members = f.ownerMembers;
    }
    owner.fallback_user_id = f.fallbackUserId || null;
    out.owner = owner;
    out.renewal = f.renewal;
  } else {
    out.extend = {
      target_variant_ids: f.extendAnyVariant ? null : f.extendTargets,
      n: num(f.extendN) ?? NaN,
      unit: f.extendUnit,
      extend_accesses: f.extendAccesses,
      if_no_service: f.ifNoService,
      fallback_variant_id: f.fallbackVariantId || null,
    };
  }
  const red = num(f.overdueRedDays);
  if (red !== null) out.light = { overdue_red_days: red };
  if (f.overdueCut) out.overdue_cut = { enabled: true, days: num(f.overdueCutDays) ?? NaN, restore: f.overdueRestore };
  return out;
}

/** «Al cobrarse» en una palabra, para la fila de la variante y su cabecera. */
export const MODE_LABELS: Record<ServiceMode, string> = {
  create: "Crea un servicio",
  extend: "Extiende el servicio que ya tiene",
  none: "No crea servicio",
};

export const WHEN_RULE_LABELS: Record<WhenRule, string> = {
  any_payment: "Con el primer pago cobrado",
  non_reservation: "Con el primer pago que no es la reserva",
  percent: "Cuando se cobró un porcentaje de la venta",
  amount: "Cuando se cobró un monto",
};
