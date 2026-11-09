// @plantilla-quitar(ventas)
/**
 * El link corto de un afiliado (F73): `/r/<código>/<linkKey>` → el link del producto con `?ref=` y las UTM. Puro
 * (las lecturas entran por `deps`).
 *
 * El código y la clave del link son únicos por negocio, no en toda la instalación: se buscan los productos que tienen
 * esa clave y, de ésos, el negocio donde el código existe. Si hay cero o más de un negocio posible, no se adivina:
 * cae a la app. El link tiene que estar activo y vigente; el producto, activo.
 */
import { linkIsLive, LINK_KEY, type ProductLinks } from "./product-links";
import { AFFILIATE_CODE, buildAffiliateUrl, campaignSlug } from "./url";

export const SHORT_LINK_CLICKS_PER_MINUTE = 120;

export interface ShortLinkProduct {
  id: string;
  workspaceId: string;
  name: string;
  active: boolean;
  links: ProductLinks;
}

export interface ShortLinkDeps {
  productsWithKey(linkKey: string): Promise<ShortLinkProduct[]>;
  /** Los negocios (de los dados) donde el código es de alguien del equipo o de un contacto afiliado. */
  workspacesWithCode(code: string, workspaceIds: string[]): Promise<string[]>;
  today: string;
}

export type ShortLinkResult = { status: "redirect"; url: string } | { status: "fallback"; reason: "bad_input" | "not_found" | "ambiguous" | "inactive" };

export async function resolveShortLink(rawCode: string, rawKey: string, deps: ShortLinkDeps): Promise<ShortLinkResult> {
  const code = (rawCode ?? "").toLowerCase();
  if (!AFFILIATE_CODE.test(code) || !LINK_KEY.test(rawKey ?? "")) return { status: "fallback", reason: "bad_input" };
  const products = await deps.productsWithKey(rawKey);
  if (products.length === 0) return { status: "fallback", reason: "not_found" };
  const owners = new Set(await deps.workspacesWithCode(code, [...new Set(products.map((p) => p.workspaceId))]));
  const matches = products.filter((p) => owners.has(p.workspaceId));
  if (matches.length === 0) return { status: "fallback", reason: "not_found" };
  if (matches.length > 1) return { status: "fallback", reason: "ambiguous" };
  const product = matches[0];
  const link = product.links.items.find((l) => l.key === rawKey);
  if (!product.active || !link || !linkIsLive(link, deps.today)) return { status: "fallback", reason: "inactive" };
  try {
    return { status: "redirect", url: buildAffiliateUrl(link.url, code, campaignSlug(product.name), rawKey) };
  } catch {
    return { status: "fallback", reason: "inactive" };
  }
}
