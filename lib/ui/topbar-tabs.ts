/**
 * El texto del contador de una pestaña de la barra (`TopbarTabs`): nada con 0, vacío o un valor que no es un número;
 * «99+» desde 100, para que el círculo no crezca sin fin.
 */
export function tabCountLabel(count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return null;
  const n = Math.floor(count);
  return n > 99 ? "99+" : String(n);
}

/** Las clases de UNA pestaña de la barra (el control segmentado: la activa en blanco sobre el gris). */
export function headerTabClass(active: boolean): string {
  return [
    "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors max-topbar:h-10",
    active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
  ].join(" ");
}

/** Las clases del contenedor de las pestañas de la barra. */
export const HEADER_TABS_CONTAINER = "flex shrink-0 items-center rounded-lg bg-muted/60 p-0.5";
