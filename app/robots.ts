import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/app-url"; // @plantilla-quitar(sitio)
import { SITE_PAGES, buildRobots } from "@/lib/site/pages"; // @plantilla-quitar(sitio)

/**
 * Sigue bloqueando todo: el sistema es la app, no un sitio web. Las páginas de agenda
 * (/calendario/*) ya se marcan `noindex` cada una por separado.
 *
 * La excepción son las páginas públicas del sitio de ESTE clon (`lib/site/pages.ts`):
 * esas se dejan pasar y se suman al sitemap. Con la lista vacía (la plantilla) queda
 * exactamente como antes.
 */
export default function robots(): MetadataRoute.Robots {
  return buildRobots(SITE_PAGES, appUrl()); // @plantilla-quitar(sitio)
  // @plantilla-sin(sitio): return { rules: [{ userAgent: "*", disallow: "/" }] };
}
