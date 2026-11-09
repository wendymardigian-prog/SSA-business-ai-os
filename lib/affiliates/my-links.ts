// @plantilla-quitar(ventas)
/**
 * Mis links (F103): los links activos y vigentes de los productos activos, agrupados por producto, con los dos
 * principales primero; cada uno con el link limpio y el link con el código de la persona. Puro.
 */
import { linkIsLive, LINK_KIND_LABELS, type ProductLinks } from "./product-links";
import { shortAffiliateUrl } from "./url";

export interface MyLinksProduct {
  id: string;
  name: string;
  active: boolean;
  links: ProductLinks;
}

export interface MyLinkView {
  key: string;
  name: string;
  kindLabel: string;
  url: string;
  withCode: string | null;
  primary: "learn" | "convert" | null;
}

export function myLinksView(products: MyLinksProduct[], code: string | null, today: string, base: string): Array<{ id: string; name: string; links: MyLinkView[] }> {
  return products
    .filter((p) => p.active)
    .map((p) => {
      const live = (p.links?.items ?? []).filter((l) => linkIsLive(l, today));
      const primaryOf = (key: string): MyLinkView["primary"] => (p.links.primary_learn === key ? "learn" : p.links.primary_convert === key ? "convert" : null);
      const ordered = [...live].sort((a, b) => {
        const rank = (k: string) => (primaryOf(k) === "learn" ? 0 : primaryOf(k) === "convert" ? 1 : 2);
        return rank(a.key) - rank(b.key);
      });
      return {
        id: p.id,
        name: p.name,
        links: ordered.map((l) => ({
          key: l.key,
          name: l.name,
          kindLabel: LINK_KIND_LABELS[l.kind],
          url: l.url,
          withCode: code ? shortAffiliateUrl(base, code, l.key) : null,
          primary: primaryOf(l.key),
        })),
      };
    })
    .filter((p) => p.links.length > 0);
}

export type LeadNameMode = "first_name_initial" | "full" | "hidden";

/** Cómo ve un afiliado el nombre de sus referidos (F103, `affiliate_settings.show_lead_names`). Por defecto «Ana P.». */
export function leadDisplayName(name: string | null | undefined, mode: LeadNameMode | undefined): string {
  const clean = (name ?? "").trim();
  if (mode === "hidden" || !clean) return "Un contacto";
  if (mode === "full") return clean;
  const [first, second] = clean.split(/\s+/);
  return second ? `${first} ${second[0].toUpperCase()}.` : first;
}
