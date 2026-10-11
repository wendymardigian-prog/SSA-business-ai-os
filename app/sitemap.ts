import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/app-url";
import { SITE_PAGES, sitemapEntries } from "@/lib/site/pages";

/** El sitemap de las páginas públicas del sitio de este clon. Vacío en la plantilla. */
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries(SITE_PAGES, appUrl());
}
