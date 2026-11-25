import type { SkeletonVariant } from "@/components/page-skeleton";

/**
 * La forma del esqueleto de las pantallas que no tienen `loading.tsx` propio y caen en el del panel
 * (`app/(dashboard)/dashboard/loading.tsx`). Antes todas mostraban la misma grilla de tarjetas sin título; ahora
 * muestran su título (sale de la URL, `PageSkeleton`) y una forma parecida a la pantalla (traído de RER-BAIOS #149).
 *
 * `home`: Inicio, que tiene su propia barra (no `PageHeader`) y sigue con la grilla de siempre.
 * Una pantalla nueva sin `loading.tsx` que no sea una lista se suma acá.
 */
export type FallbackSkeleton = SkeletonVariant | "home";

const BY_ROUTE: Record<string, FallbackSkeleton> = {
  "/dashboard": "home",
  // Tableros y paneles de cifras.
  "/dashboard/dashboards": "cards",
  "/dashboard/finanzas": "cards",
  "/dashboard/portal": "cards",
  "/dashboard/disenos": "cards",
  // Formularios y ajustes.
  "/dashboard/cuenta": "form",
  "/dashboard/clientes/importar": "form",
  "/dashboard/afiliados/reglas": "form",
  "/dashboard/disenos/ajustes": "form",
  "/dashboard/portal/ajustes": "form",
  "/dashboard/portal/[productId]/ajustes": "form",
  "/dashboard/eod/[formId]": "form",
  // Fichas.
  "/dashboard/portal/[productId]": "detail",
  "/dashboard/disenos/d/[id]": "detail",
  "/dashboard/disenos/t/[id]": "detail",
  "/dashboard/clientes/c/[contactId]": "detail",
  "/dashboard/clientes/s/[serviceId]": "detail",
  // Conversación con lista al costado.
  "/dashboard/asistente": "split",
};

// Las rutas con un id (`[productId]`) se comparan con su patrón: un segmento cualquiera en su lugar.
const PATTERNS: Array<[RegExp, FallbackSkeleton]> = Object.entries(BY_ROUTE)
  .filter(([route]) => route.includes("["))
  .map(([route, variant]) => [new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+")}$`), variant]);

/** La forma para una dirección; lo que no está en la lista es una lista (el caso más común). */
export function skeletonVariantFor(pathname: string | null | undefined): FallbackSkeleton {
  const clean = (pathname ?? "/dashboard").replace(/\/+$/, "") || "/dashboard";
  if (BY_ROUTE[clean]) return BY_ROUTE[clean];
  for (const [pattern, variant] of PATTERNS) if (pattern.test(clean)) return variant;
  return "list";
}
