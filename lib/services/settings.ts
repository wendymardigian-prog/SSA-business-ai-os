// @plantilla-quitar(servicios)
/**
 * La configuracion del servicio de cada variante (`product_variants.service_settings`, F5, F115).
 *
 * Modulo puro. Es la gemela de `app_servicio.validate_service_settings` (00332): los casos de
 * `service-settings.cases.json` corren contra las dos (vitest y `verify-services --bloque sv1`).
 * Lo que depende de la base (que las personas sean del equipo, que la variante de respaldo sea del
 * mismo producto y cree servicios) se valida con el `context` cuando viene, y siempre en SQL.
 *
 * `{}` = modo `none`: la variante no crea servicios.
 */

export const SERVICE_MODES = ["create", "extend", "none"] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];
export const WHEN_RULES = ["any_payment", "non_reservation", "percent", "amount"] as const;
export type WhenRule = (typeof WHEN_RULES)[number];
export const START_RULES = ["payment_date", "sale_date", "manual"] as const;
export const OWNER_MODES = ["fixed", "round_robin", "conditions", "previous"] as const;
export const RENEWAL_MODES = ["new_linked", "extend", "ask"] as const;
export const EXTEND_UNITS = ["days", "weeks", "months"] as const;
export const IF_NO_SERVICE = ["confirm", "create"] as const;

export interface ServiceSettings {
  v?: 1;
  mode?: ServiceMode;
  when?: { rule: WhenRule; value?: number | null; enabled_at?: string | null };
  confirm?: boolean;
  start?: (typeof START_RULES)[number];
  owner?: {
    mode: (typeof OWNER_MODES)[number];
    members?: string[];
    user_id?: string | null;
    conditions?: unknown[];
    fallback_user_id?: string | null;
  };
  renewal?: (typeof RENEWAL_MODES)[number];
  light?: { overdue_red_days?: number };
  overdue_cut?: { enabled?: boolean; days?: number; restore?: boolean };
  extend?: {
    target_variant_ids?: string[] | null;
    n?: number;
    unit?: (typeof EXTEND_UNITS)[number];
    extend_accesses?: boolean;
    if_no_service?: (typeof IF_NO_SERVICE)[number];
    fallback_variant_id?: string | null;
  };
}

/** Lo que la validacion necesita saber de la base (opcional en TS; siempre en SQL). */
export interface ServiceSettingsContext {
  productId?: string;
  /** Variantes del producto: id y modo de su servicio. */
  variants?: Array<{ id: string; productId: string; mode: ServiceMode }>;
  /** Ids de las personas del equipo del negocio. */
  members?: string[];
}

import { unknownKeyProblems } from "./json-order";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const TOP_KEYS: Record<ServiceMode, string[]> = {
  none: ["v", "mode"],
  create: ["v", "mode", "when", "confirm", "start", "owner", "renewal", "light", "overdue_cut"],
  extend: ["v", "mode", "when", "extend", "light", "overdue_cut"],
};

/** El modo, con `{}` = none. */
export function serviceMode(settings: unknown): ServiceMode {
  if (!isObj(settings) || settings.mode === undefined) return "none";
  return (SERVICE_MODES as readonly string[]).includes(settings.mode as string) ? (settings.mode as ServiceMode) : "none";
}

/** Los problemas de una configuracion. Vacio = esta bien. Mismo orden y mismos textos que la SQL. */
export function validateServiceSettings(settings: unknown, context: ServiceSettingsContext = {}): string[] {
  const p: string[] = [];
  if (!isObj(settings)) return ["la configuración tiene que ser un objeto"];
  if (has(settings, "v") && settings.v !== 1) p.push("versión desconocida");
  const rawMode = settings.mode;
  if (rawMode !== undefined && !(SERVICE_MODES as readonly string[]).includes(rawMode as string)) {
    p.push("modo desconocido");
    return p;
  }
  const mode: ServiceMode = (rawMode as ServiceMode) ?? "none";
  p.push(...unknownKeyProblems(settings, TOP_KEYS[mode]));
  if (mode === "none") return p;

  // ¿Cuándo?
  const when = settings.when;
  if (!isObj(when)) {
    p.push("elegí cuándo se crea");
  } else if (!(WHEN_RULES as readonly string[]).includes(when.rule as string)) {
    p.push("elegí cuándo se crea");
  } else if (when.rule === "percent" && (!isInt(when.value) || when.value < 1 || when.value > 100)) {
    p.push("el porcentaje va de 1 a 100");
  } else if (when.rule === "amount" && (!isInt(when.value) || when.value < 1)) {
    p.push("el monto tiene que ser mayor a cero");
  }

  if (has(settings, "light")) {
    const light = settings.light;
    if (!isObj(light) || (has(light, "overdue_red_days") && (!isInt(light.overdue_red_days) || light.overdue_red_days < 1 || light.overdue_red_days > 365))) {
      p.push("los días para rojo por pagos van de 1 a 365");
    }
  }
  if (has(settings, "overdue_cut")) {
    const cut = settings.overdue_cut;
    if (!isObj(cut) || (has(cut, "days") && (!isInt(cut.days) || cut.days < 1 || cut.days > 365))) {
      p.push("los días de mora van de 1 a 365");
    }
  }

  if (mode === "create") {
    if (has(settings, "confirm") && typeof settings.confirm !== "boolean") p.push("«Pedir confirmación» tiene que ser sí o no");
    if (has(settings, "start") && !(START_RULES as readonly string[]).includes(settings.start as string)) p.push("elegí la fecha de inicio");
    if (has(settings, "renewal") && !(RENEWAL_MODES as readonly string[]).includes(settings.renewal as string)) p.push("elegí qué pasa si vuelve a comprar");
    const owner = settings.owner;
    if (!isObj(owner) || !(OWNER_MODES as readonly string[]).includes(owner.mode as string)) {
      p.push("elegí cómo se asigna el responsable");
    } else {
      if (owner.mode === "fixed" && !(typeof owner.user_id === "string" && UUID.test(owner.user_id))) p.push("elegí la persona");
      if (owner.mode === "round_robin" && !(Array.isArray(owner.members) && owner.members.length > 0)) p.push("elegí las personas del reparto");
      if (owner.mode === "conditions" && !(Array.isArray(owner.conditions) && owner.conditions.length > 0)) p.push("agregá al menos una condición");
      if (!(typeof owner.fallback_user_id === "string" && UUID.test(owner.fallback_user_id))) p.push("elegí la persona de respaldo");
      if (context.members) {
        const people = [
          ...(Array.isArray(owner.members) ? owner.members : []),
          ...(typeof owner.user_id === "string" ? [owner.user_id] : []),
          ...(typeof owner.fallback_user_id === "string" ? [owner.fallback_user_id] : []),
        ];
        if (people.some((id) => !context.members!.includes(id as string))) p.push("hay una persona que no es del equipo");
      }
    }
  }

  if (mode === "extend") {
    const ext = settings.extend;
    if (!isObj(ext)) {
      p.push("elegí cuánto suma");
      p.push("elegí la variante de respaldo");
    } else {
      if (!isInt(ext.n) || ext.n < 1 || ext.n > 1000) p.push("elegí cuánto suma");
      if (has(ext, "unit") && !(EXTEND_UNITS as readonly string[]).includes(ext.unit as string)) p.push("elegí días, semanas o meses");
      if (has(ext, "if_no_service") && !(IF_NO_SERVICE as readonly string[]).includes(ext.if_no_service as string)) p.push("elegí qué pasa si no tiene un servicio para extender");
      if (has(ext, "target_variant_ids") && ext.target_variant_ids !== null && !(Array.isArray(ext.target_variant_ids) && ext.target_variant_ids.every((x) => typeof x === "string" && UUID.test(x)))) {
        p.push("las variantes a extender no son válidas");
      }
      const fb = ext.fallback_variant_id;
      if (!(typeof fb === "string" && UUID.test(fb))) {
        p.push("elegí la variante de respaldo");
      } else if (context.variants && context.productId) {
        const v = context.variants.find((x) => x.id === fb);
        if (!v || v.productId !== context.productId) p.push("la variante de respaldo tiene que ser de este producto");
        else if (v.mode !== "create") p.push("la variante de respaldo tiene que crear un servicio");
      }
      if (context.variants && context.productId && Array.isArray(ext.target_variant_ids)) {
        const bad = ext.target_variant_ids.some((id) => context.variants!.find((x) => x.id === id)?.productId !== context.productId);
        if (bad) p.push("las variantes a extender tienen que ser de este producto");
      }
    }
  }
  return p;
}

/** Al pasar de `none` a `create`/`extend` se fija `when.enabled_at`; al volver a `none` se borra (F5). */
export function withEnabledAt(prev: unknown, next: ServiceSettings, now: string): ServiceSettings {
  const before = serviceMode(prev);
  const after = serviceMode(next);
  if (after === "none") {
    const { when: _when, ...rest } = next;
    return rest;
  }
  const prevWhen = isObj(prev) && isObj(prev.when) ? prev.when : null;
  const enabledAt = before === "none" ? now : ((prevWhen?.enabled_at as string | undefined) ?? now);
  return { ...next, when: { ...(next.when as NonNullable<ServiceSettings["when"]>), enabled_at: enabledAt } };
}

/** Los dias para rojo por pagos de la variante (default 15). */
export function overdueRedDays(settings: unknown): number {
  const light = isObj(settings) && isObj(settings.light) ? settings.light : null;
  return light && isInt(light.overdue_red_days) ? light.overdue_red_days : 15;
}
