// @plantilla-quitar(servicios)
/**
 * La pestaña «Portal» de la variante (F116) y el drawer de la regla de una sección (F109). Puro.
 *
 * Dos datos distintos:
 *  - «En el programa» (`products.portal_settings.sections.<sección>`): vale para TODAS las variantes del producto.
 *  - «Incluida en esta variante» y su regla (`product_variants.portal_settings.sections[]`): solo esta variante.
 * Apagar el acceso o sacar una sección de una variante no corta a los servicios que ya existen (decisión 455).
 */
import { AVAILABLE_SECTIONS, SECTION_LABELS, type PortalSection } from "../availability";
import type { SectionRule, VariantPortalSettings } from "@/lib/portal-admin/settings";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readVariantPortal(raw: unknown): VariantPortalSettings {
  const s = isObj(raw) ? (raw as VariantPortalSettings) : {};
  return { v: 1, enabled: s.enabled === true, ask_terms: s.ask_terms !== false, sections: Array.isArray(s.sections) ? s.sections : [] };
}

export function programSections(raw: unknown): Partial<Record<PortalSection, boolean>> {
  const s = isObj(raw) && isObj(raw.sections) ? (raw.sections as Record<string, unknown>) : {};
  const out: Partial<Record<PortalSection, boolean>> = {};
  for (const sec of AVAILABLE_SECTIONS) if (typeof s[sec] === "boolean") out[sec] = s[sec] as boolean;
  return out;
}

export interface PortalSectionRow {
  section: PortalSection;
  label: string;
  /** Prendida en el programa (para todas las variantes). Sin dato = prendida. */
  inProgram: boolean;
  included: boolean;
  opensLabel: string;
  untilLabel: string;
  limitsLabel: string;
}

export function opensLabel(r: SectionRule | undefined): string {
  const o = r?.opens;
  if (!o) return "Al empezar el servicio";
  switch (o.type) {
    case "service_start":
      return "Al empezar el servicio";
    case "days_after_start":
      return `${o.days ?? "?"} días después del inicio`;
    case "fixed_date":
      return o.date ? `El ${o.date.split("-").reverse().join("/")}` : "En una fecha";
    case "phase_completed":
      return "Al terminar una fase";
    case "item_completed":
      return "Al completar un paso";
    case "module_completed":
      return "Al completar un módulo";
    case "challenge_started":
      return "Al empezar el Reto";
    case "journey_item":
      return "Lo abre un paso del camino";
    case "automation":
      return "Lo abre una automatización";
  }
}

export function untilLabel(r: SectionRule | undefined): string {
  const u = r?.until;
  if (!u) return "Lo que dure el servicio";
  switch (u.type) {
    case "service":
      return "Lo que dure el servicio";
    case "days":
      return `${u.n ?? "?"} días`;
    case "months":
      return `${u.n ?? "?"} meses`;
    case "fixed_date":
      return u.date ? `Hasta el ${u.date.split("-").reverse().join("/")}` : "Hasta una fecha";
    case "phase_completed":
      return "Hasta terminar una fase";
    case "item_completed":
      return "Hasta completar un paso";
    case "forever":
      return "Para siempre";
  }
}

export function limitsLabel(r: SectionRule | undefined): string {
  if (!r) return "—";
  const parts: string[] = [];
  if (r.section === "community" && r.limits?.community_can_post === false) parts.push("Solo lee");
  if (r.section === "assistant" && typeof r.ai_limit_usd === "number") parts.push(`Hasta USD ${r.ai_limit_usd} por mes`);
  if (r.section === "program" && r.content && r.content.modules !== "all") parts.push(`${r.content.modules.length} módulos`);
  return parts.join(" · ") || "—";
}

export function portalRows(variantRaw: unknown, programRaw: unknown, sections: readonly PortalSection[] = AVAILABLE_SECTIONS): PortalSectionRow[] {
  const v = readVariantPortal(variantRaw);
  const prog = programSections(programRaw);
  return sections.map((sec) => {
    const rule = v.sections?.find((r) => r.section === sec);
    const included = !!rule && rule.included !== false;
    return {
      section: sec,
      label: SECTION_LABELS[sec],
      inProgram: prog[sec] !== false,
      included,
      opensLabel: included ? opensLabel(rule) : "—",
      untilLabel: included ? untilLabel(rule) : "—",
      limitsLabel: included ? limitsLabel(rule) : "—",
    };
  });
}

/** Incluir o sacar una sección de la variante. Sacarla conserva la regla (al volver a incluirla vuelve igual). */
export function setIncluded(raw: unknown, section: PortalSection, included: boolean): VariantPortalSettings {
  const v = readVariantPortal(raw);
  const list = [...(v.sections ?? [])];
  const i = list.findIndex((r) => r.section === section);
  if (i >= 0) list[i] = { ...list[i], included };
  else if (included) list.push({ section, included: true });
  return { ...v, sections: list };
}

/** Cambiar la regla de una sección (el drawer de F109). */
export function setRule(raw: unknown, section: PortalSection, patch: Partial<SectionRule>): VariantPortalSettings {
  const v = readVariantPortal(raw);
  const list = [...(v.sections ?? [])];
  const i = list.findIndex((r) => r.section === section);
  const base: SectionRule = i >= 0 ? list[i] : { section, included: true };
  const next = { ...base, ...patch, section };
  for (const k of Object.keys(next) as Array<keyof SectionRule>) if (next[k] === undefined) delete next[k];
  if (i >= 0) list[i] = next;
  else list.push(next);
  return { ...v, sections: list };
}

export function setEnabled(raw: unknown, enabled: boolean): VariantPortalSettings {
  return { ...readVariantPortal(raw), enabled };
}

/** Copiar las secciones y reglas de esta variante a otra (sin tocar si la otra tiene acceso). */
export function copySectionsTo(fromRaw: unknown, toRaw: unknown): VariantPortalSettings {
  const from = readVariantPortal(fromRaw);
  return { ...readVariantPortal(toRaw), sections: (from.sections ?? []).map((r) => ({ ...r })) };
}
