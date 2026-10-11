/**
 * `{{form_link.<slug>}}` en cualquier mensaje (F20): la parte PURA. Encuentra los
 * tokens y los reemplaza por los links ya firmados. Quien firma y consulta la base
 * es `resolveFormLinkVariables` (`lib/response-assets/bank-variables.ts`).
 *
 * Los guiones del slug pasan a guion bajo en el token (`como-vas` →
 * `como_vas`), porque el interpolador del motor solo lee `\w` dentro de `{{…}}`.
 */

const FORM_LINK_TOKEN = /\{\{\s*form_link\.([a-z0-9_]+)\s*\}\}/gi;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿El texto trae algún `{{form_link.…}}`? Es lo único que decide si hay que consultar algo. */
export function hasFormLinkVariables(text: string): boolean {
  FORM_LINK_TOKEN.lastIndex = 0;
  const found = FORM_LINK_TOKEN.test(text);
  FORM_LINK_TOKEN.lastIndex = 0;
  return found;
}

/** El slug real de un token: `como_vas` → `como-vas`. */
export function slugFromToken(token: string): string {
  return token.toLowerCase().replace(/_/g, "-");
}

/** Los slugs distintos que piden estos textos. */
export function formLinkSlugs(texts: string[]): string[] {
  const slugs = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(FORM_LINK_TOKEN)) slugs.add(slugFromToken(match[1]));
  }
  return [...slugs];
}

/** Reemplaza cada token por su link; el que no tiene link (formulario inexistente) queda tal cual. */
export function replaceFormLinks(text: string, links: Record<string, string>): string {
  return text.replace(FORM_LINK_TOKEN, (whole, token: string) => links[slugFromToken(token)] ?? whole);
}

/** El `service.id` y el `sale.id` del contexto del flujo, si los trae y tienen forma de UUID. */
export function linkIdsFromVariables(variables: Record<string, unknown> | undefined): { serviceId: string | null; saleId: string | null } {
  const idOf = (key: string): string | null => {
    const group = variables?.[key];
    const id = group && typeof group === "object" ? (group as { id?: unknown }).id : null;
    return typeof id === "string" && UUID_RE.test(id) ? id : null;
  };
  return { serviceId: idOf("service"), saleId: idOf("sale") };
}
