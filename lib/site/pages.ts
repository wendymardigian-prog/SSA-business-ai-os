/**
 * Las páginas públicas del sitio de ESTE clon (F30). La lista la mantiene cada clon:
 * en la plantilla está vacía. De acá salen el `sitemap.xml` y lo que `robots.txt`
 * deja pasar; todo lo demás sigue bloqueado.
 *
 * Cada página nueva de `app/(sitio)/<ruta>/page.tsx` se suma acá (ver `docs/sitio.md`).
 */

export interface SitePage {
  /** La ruta, con la barra inicial: `/`, `/servicios`, `/blog/hola`. */
  path: string;
  /** `YYYY-MM-DD` de la última vez que cambió. Opcional. */
  lastModified?: string;
  changeFrequency?: "daily" | "weekly" | "monthly" | "yearly";
  /** 0 a 1. Opcional. */
  priority?: number;
}

/** Las rutas que el sistema ya usa: una página del sitio no puede llamarse así. */
// `baja`: la pagina publica de baja de los emails (suscripcion a emails, E3). `recuperar` y `restablecer`: "Olvidé mi contraseña" (Mi cuenta).
export const RESERVED_ROUTES = ["dashboard", "login", "auth", "invite", "api", "calendario", "f", "embed", "l", "baja", "recuperar", "restablecer"] as const;

/** La lista de este clon. Vacía en la plantilla. */
export const SITE_PAGES: SitePage[] = [];

const PATH_RE = /^\/(?:[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)?$/;

export function isReservedPath(path: string): boolean {
  const first = path.split("/").filter(Boolean)[0];
  return !!first && (RESERVED_ROUTES as readonly string[]).includes(first);
}

/** Los problemas de una lista de páginas (vacía = está bien). */
export function validateSitePages(pages: SitePage[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (!PATH_RE.test(page.path)) problems.push(`"${page.path}" no es una ruta válida (minúsculas, números y guiones, con la barra inicial)`);
    else if (isReservedPath(page.path)) problems.push(`"${page.path}" usa una ruta reservada del sistema`);
    if (seen.has(page.path)) problems.push(`"${page.path}" está repetida`);
    seen.add(page.path);
    if (page.priority !== undefined && (page.priority < 0 || page.priority > 1)) problems.push(`"${page.path}": la prioridad va de 0 a 1`);
    if (page.lastModified !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(page.lastModified)) problems.push(`"${page.path}": la fecha va como AAAA-MM-DD`);
  }
  return problems;
}

export interface SitemapEntry {
  url: string;
  lastModified?: string;
  changeFrequency?: SitePage["changeFrequency"];
  priority?: number;
}

/** Las entradas del sitemap (solo las páginas válidas), con la URL completa. */
export function sitemapEntries(pages: SitePage[], baseUrl: string): SitemapEntry[] {
  const base = baseUrl.replace(/\/$/, "");
  return pages
    .filter((page) => PATH_RE.test(page.path) && !isReservedPath(page.path))
    .map((page) => ({
      url: `${base}${page.path === "/" ? "" : page.path}` || base,
      ...(page.lastModified ? { lastModified: page.lastModified } : {}),
      ...(page.changeFrequency ? { changeFrequency: page.changeFrequency } : {}),
      ...(page.priority !== undefined ? { priority: page.priority } : {}),
    }));
}

export interface RobotsConfig {
  rules: Array<{ userAgent: string; allow?: string[]; disallow: string }>;
  sitemap?: string;
}

/**
 * `robots.txt`: sigue bloqueando todo (`disallow: "/"`) y deja pasar SOLO las páginas de
 * la lista. Sin páginas queda exactamente como antes. Con páginas, suma el sitemap.
 */
export function buildRobots(pages: SitePage[], baseUrl: string): RobotsConfig {
  const valid = pages.filter((page) => PATH_RE.test(page.path) && !isReservedPath(page.path));
  if (valid.length === 0) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    // `$` ancla la ruta exacta: "/" permitido no abre todo el sitio.
    rules: [{ userAgent: "*", allow: valid.map((page) => (page.path === "/" ? "/$" : page.path)), disallow: "/" }],
    sitemap: `${baseUrl.replace(/\/$/, "")}/sitemap.xml`,
  };
}
