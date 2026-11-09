// @plantilla-quitar(ventas)
/**
 * Los links de un producto (F70, BAIOS): `products.links`. Puro; la gemela SQL es `public.validate_product_links`
 * (S13) y las dos corren los casos de `product-links.cases.json`.
 *
 * Cada link tiene una clave estable (`lk_xxxxxx`) que no cambia al renombrarlo. Dos principales por producto:
 * «para conocer» (página de producto o landing) y «para convertir» (agenda o checkout).
 */

export const LINK_KINDS = ["product_page", "landing", "registration_form", "booking", "checkout", "other"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  product_page: "Página de producto",
  landing: "Landing",
  registration_form: "Formulario de registro",
  booking: "Agenda",
  checkout: "Checkout",
  other: "Otro",
};

export const LEARN_KINDS: readonly LinkKind[] = ["product_page", "landing"];
export const CONVERT_KINDS: readonly LinkKind[] = ["booking", "checkout"];
export const LINK_KEY = /^lk_[a-z0-9]{6}$/;

export interface ProductLink {
  key: string;
  name: string;
  kind: LinkKind;
  url: string;
  active: boolean;
  valid_until: string | null;
  variant_id: string | null;
}

export interface ProductLinks {
  v: 1;
  primary_learn?: string | null;
  primary_convert?: string | null;
  items: ProductLink[];
}

export const EMPTY_LINKS: ProductLinks = { v: 1, items: [] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los problemas de `products.links`. Vacío = está bien. Mismos textos y orden que la SQL. */
export function validateProductLinks(raw: unknown, productVariantIds: string[] | null = null): string[] {
  const p: string[] = [];
  if (!isObj(raw)) return ["los links no son válidos"];
  if (raw.v !== 1) p.push("versión desconocida");
  if (!Array.isArray(raw.items)) return [...p, "faltan los links"];
  const keys = new Set<string>();
  const byKey = new Map<string, Record<string, unknown>>();
  for (const it of raw.items as unknown[]) {
    if (!isObj(it)) {
      p.push("hay un link que no es válido");
      continue;
    }
    const name = typeof it.name === "string" ? it.name.trim() : "";
    const label = name || "un link";
    if (typeof it.key !== "string" || !LINK_KEY.test(it.key)) p.push(`«${label}»: la clave no es válida`);
    else if (keys.has(it.key)) p.push(`la clave ${it.key} está repetida`);
    else {
      keys.add(it.key);
      byKey.set(it.key, it);
    }
    if (!name) p.push("hay un link sin nombre");
    if (!(LINK_KINDS as readonly string[]).includes(it.kind as string)) p.push(`«${label}»: elegí el tipo`);
    if (!(typeof it.url === "string" && /^https:\/\/[^\s/$.?#].[^\s]*$/i.test(it.url))) p.push(`«${label}»: el link tiene que empezar con https://`);
    if (typeof it.active !== "boolean") p.push(`«${label}»: «Activo» tiene que ser sí o no`);
    if (it.valid_until !== null && it.valid_until !== undefined && !(typeof it.valid_until === "string" && DATE.test(it.valid_until))) p.push(`«${label}»: la fecha de vigencia no es válida`);
    if (it.variant_id !== null && it.variant_id !== undefined) {
      if (!(typeof it.variant_id === "string" && UUID.test(it.variant_id))) p.push(`«${label}»: la variante no es válida`);
      else if (productVariantIds && !productVariantIds.includes(it.variant_id)) p.push(`«${label}»: la variante tiene que ser de este producto`);
    }
  }
  for (const [field, kinds, label] of [
    ["primary_learn", LEARN_KINDS, "para conocer"],
    ["primary_convert", CONVERT_KINDS, "para convertir"],
  ] as const) {
    const v = raw[field];
    if (v === null || v === undefined) continue;
    const it = typeof v === "string" ? byKey.get(v) : undefined;
    if (!it) p.push(`el principal ${label} no es uno de los links`);
    else if (!(kinds as readonly string[]).includes(it.kind as string)) p.push(`el principal ${label} no puede ser de ese tipo`);
  }
  return p;
}

/** Si un link se puede usar hoy (activo y no vencido). */
export function linkIsLive(l: Pick<ProductLink, "active" | "valid_until">, today: string): boolean {
  return l.active && (!l.valid_until || l.valid_until >= today);
}

/**
 * Antes de guardar: un principal que quedó inactivo o vencido se vacía, con el aviso «Elegí otro link principal».
 * Puro: devuelve los links y los avisos.
 */
export function normalizePrimaries(links: ProductLinks, today: string): { links: ProductLinks; notices: string[] } {
  const notices: string[] = [];
  const next: ProductLinks = { ...links };
  for (const field of ["primary_learn", "primary_convert"] as const) {
    const key = next[field];
    if (!key) continue;
    const it = next.items.find((i) => i.key === key);
    if (!it || !linkIsLive(it, today)) {
      next[field] = null;
      notices.push(`Elegí otro link principal ${field === "primary_learn" ? "para conocer" : "para convertir"}.`);
    }
  }
  return { links: next, notices };
}

export function newLinkKey(existing: string[], random: () => number = Math.random): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let n = 0; n < 50; n++) {
    let s = "lk_";
    for (let i = 0; i < 6; i++) s += chars[Math.floor(random() * chars.length)];
    if (!existing.includes(s)) return s;
  }
  throw new Error("no pude armar una clave nueva");
}
