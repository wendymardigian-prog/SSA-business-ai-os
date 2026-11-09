/**
 * El texto del contador de una pestaña de la barra (`TopbarTabs`): nada con 0, vacío o un valor que no es un número;
 * «99+» desde 100, para que el círculo no crezca sin fin.
 */
export function tabCountLabel(count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return null;
  const n = Math.floor(count);
  return n > 99 ? "99+" : String(n);
}
