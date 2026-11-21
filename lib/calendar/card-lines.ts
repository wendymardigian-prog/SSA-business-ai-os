/**
 * Cuántas líneas de título entran en un bloque del calendario. PURO.
 *
 * El título usa todas las líneas que caben en el alto del bloque (con «…» al final si igual no entra). Un bloque bajo
 * (una reunión de 15 minutos) queda en una sola línea.
 */
export const CARD_LINE_HEIGHT_PX = 14;
/** El padding de arriba y abajo de una tarjeta (py-1). */
export const CARD_PADDING_PX = 8;

export function linesThatFit(heightPx: number, options: { lineHeightPx?: number; reservedPx?: number } = {}): number {
  const line = options.lineHeightPx ?? CARD_LINE_HEIGHT_PX;
  const usable = heightPx - CARD_PADDING_PX - (options.reservedPx ?? 0);
  if (!Number.isFinite(usable) || usable <= line) return 1;
  return Math.max(1, Math.floor(usable / line));
}

/** El estilo que corta el texto en N líneas (`-webkit-line-clamp`). */
export function clampStyle(lines: number): React.CSSProperties {
  return { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: Math.max(1, lines), overflow: "hidden" };
}
