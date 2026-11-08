// @plantilla-quitar(servicios)
/**
 * Ajustes › Productos con el módulo de Servicios prendido (F114): la tarjeta de cada producto y la fila de cada
 * variante. Puro: los componentes solo pintan lo que esto devuelve. Con el módulo apagado la pantalla es la de
 * siempre y nada de esto se usa.
 */
import { formatPriceUsd as formatUsd } from "@/lib/content/taxonomy";
import { serviceMode, type ServiceMode } from "../settings";
import { MODE_LABELS } from "./service-settings-form";
import { journeySummaryText } from "./journey-editor";
import type { JourneyTemplate } from "../journey-template";

export interface VariantFacts {
  id: string;
  name: string;
  archived: boolean;
  /** Precio activo en dólares; null o 0 = sin precio. */
  price: number | null;
  serviceSettings: unknown;
  journeyTemplate: JourneyTemplate | null;
  portalSettings: unknown;
  activeServices: number;
}

export interface ProductCardInput {
  id: string;
  name: string;
  typeLabel: string;
  statusLabel: string;
  variants: VariantFacts[];
}

export interface ProductCardView {
  id: string;
  name: string;
  typeLabel: string;
  statusLabel: string;
  href: string;
  /** «Portal», «Portal · 2 de 3 variantes» o «Sin portal». */
  portalLabel: string;
  portalOn: boolean;
  variantsLabel: string;
  /** «USD 300 – USD 1.000», «USD 500» o «Sin precio». */
  priceLabel: string;
  activeServices: number;
  /** «2 variantes con camino» o null. */
  journeyLabel: string | null;
}

const live = (vs: VariantFacts[]) => vs.filter((v) => !v.archived);

export function variantPortalOn(portalSettings: unknown): boolean {
  return !!portalSettings && typeof portalSettings === "object" && (portalSettings as { enabled?: unknown }).enabled === true;
}

export function portalSectionsCount(portalSettings: unknown): number {
  const s = (portalSettings && typeof portalSettings === "object" ? portalSettings : {}) as { sections?: unknown };
  return Array.isArray(s.sections) ? s.sections.length : 0;
}

export function priceRangeLabel(prices: Array<number | null>): string {
  const ok = prices.filter((p): p is number => typeof p === "number" && p > 0);
  if (ok.length === 0) return "Sin precio";
  const min = Math.min(...ok);
  const max = Math.max(...ok);
  return min === max ? formatUsd(min) : `${formatUsd(min)} – ${formatUsd(max)}`;
}

export function productCardView(p: ProductCardInput): ProductCardView {
  const vs = live(p.variants);
  const withPortal = vs.filter((v) => variantPortalOn(v.portalSettings)).length;
  const portalLabel = withPortal === 0 ? "Sin portal" : withPortal === vs.length ? "Portal" : `Portal · ${withPortal} de ${vs.length} variantes`;
  const withJourney = vs.filter((v) => serviceMode(v.serviceSettings) === "create" && (v.journeyTemplate?.phases?.length ?? 0) > 0).length;
  return {
    id: p.id,
    name: p.name,
    typeLabel: p.typeLabel,
    statusLabel: p.statusLabel,
    href: `/dashboard/settings/productos/${p.id}`,
    portalLabel,
    portalOn: withPortal > 0,
    variantsLabel: `${vs.length} ${vs.length === 1 ? "variante" : "variantes"}`,
    priceLabel: priceRangeLabel(vs.map((v) => v.price)),
    activeServices: vs.reduce((n, v) => n + v.activeServices, 0),
    journeyLabel: withJourney === 0 ? null : `${withJourney} ${withJourney === 1 ? "variante con camino" : "variantes con camino"}`,
  };
}

export interface VariantRowView {
  id: string;
  name: string;
  href: string;
  archived: boolean;
  priceLabel: string;
  mode: ServiceMode;
  /** «Al cobrarse»: Crea un servicio · Extiende el servicio que ya tiene · No crea servicio. */
  modeLabel: string;
  /** «4 fases · 17 pasos · 84 días», «Sin camino» (naranja) o «Usa el del servicio que extiende». */
  journeyLabel: string;
  journeyMissing: boolean;
  /** «3 secciones» o «Sin acceso». */
  portalLabel: string;
  activeServices: number;
}

export function variantRowView(productId: string, v: VariantFacts): VariantRowView {
  const mode = serviceMode(v.serviceSettings);
  const journey = mode === "create" ? journeySummaryText(v.journeyTemplate) : mode === "extend" ? "Usa el del servicio que extiende" : "—";
  const sections = portalSectionsCount(v.portalSettings);
  return {
    id: v.id,
    name: v.name,
    href: `/dashboard/settings/productos/${productId}/variantes/${v.id}`,
    archived: v.archived,
    priceLabel: typeof v.price === "number" && v.price > 0 ? formatUsd(v.price) : "Sin precio",
    mode,
    modeLabel: MODE_LABELS[mode],
    journeyLabel: journey,
    journeyMissing: mode === "create" && journey === "Sin camino",
    portalLabel: variantPortalOn(v.portalSettings) ? `${sections} ${sections === 1 ? "sección" : "secciones"}` : "Sin acceso",
    activeServices: v.activeServices,
  };
}

/** Las pestañas de la variante que ve cada persona (F114). Con el módulo apagado, solo Precio y cobro. */
export type VariantTabKey = "camino" | "servicio" | "portal" | "precio";
export const VARIANT_TAB_LABELS: Record<VariantTabKey, string> = {
  camino: "Camino del cliente",
  servicio: "Servicio",
  portal: "Portal",
  precio: "Precio y cobro",
};

export function variantTabs(opts: { moduleOn: boolean; can: (key: string) => boolean }): VariantTabKey[] {
  if (!opts.moduleOn) return ["precio"];
  const out: VariantTabKey[] = [];
  if (opts.can("services.configure")) out.push("camino", "servicio");
  if (opts.can("portal.sections") || opts.can("portal.access_rules")) out.push("portal");
  out.push("precio");
  return out;
}

/** La pestaña de la URL, o la primera que se puede ver. */
export function parseVariantTab(raw: string | null | undefined, allowed: VariantTabKey[]): VariantTabKey {
  return (allowed as string[]).includes(raw ?? "") ? (raw as VariantTabKey) : allowed[0];
}
