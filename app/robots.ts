import type { MetadataRoute } from "next";

/**
 * No hay nada publico que indexar: el sistema es la app, no un sitio web.
 * Las paginas de agenda (/calendario/*) ya se marcan `noindex` cada una por
 * separado; esto es el cinturon de seguridad para todo lo demas.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
