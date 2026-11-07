import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/app-url"; // @plantilla-quitar(sitio)
import { SITE_PAGES, buildRobots } from "@/lib/site/pages"; // @plantilla-quitar(sitio)
// @plantilla-sin(sitio): import { previewBotRule } from "@/lib/og/robots";

/**
 * Sigue bloqueando todo: el sistema es la app, no un sitio web. Las páginas de agenda
 * (/calendario/*) ya se marcan `noindex` cada una por separado.
 *
 * Hay dos excepciones: las páginas públicas del sitio de ESTE clon (`lib/site/pages.ts`),
 * que se dejan pasar y se suman al sitemap, y los lectores de vista previa
 * (`lib/og/robots.ts`), que necesitan leer un link para armar su tarjeta.
 */
export default function robots(): MetadataRoute.Robots {
  return buildRobots(SITE_PAGES, appUrl()); // @plantilla-quitar(sitio)
  // @plantilla-sin(sitio): return { rules: [previewBotRule(), { userAgent: "*", disallow: "/" }] };
}
