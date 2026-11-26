/**
 * Donde abrir un tooltip para que entre entero en la pantalla.
 *
 * El `InfoTooltip` del ⓘ se abria siempre hacia la derecha del icono: en la
 * ultima tarjeta del dashboard de Chat el panel se salia del borde y se leia
 * menos de la mitad (23/10/2026). Ahora se calcula con la posicion real del
 * icono y el ancho de la ventana:
 *
 *   - Horizontal: arranca alineado con el icono, y si no entra se corre a la
 *     izquierda lo justo; nunca a menos del margen de ninguno de los dos lados.
 *     En una pantalla mas angosta que el panel, el panel se achica.
 *   - Vertical: abajo del icono; si abajo no entra y arriba si, arriba.
 *
 * Puro: recibe numeros y devuelve numeros (coordenadas de `position: fixed`).
 */

export interface TooltipPlacementInput {
  /** El rectangulo del icono (getBoundingClientRect). */
  anchor: { left: number; top: number; bottom: number };
  viewport: { width: number; height: number };
  /** Ancho deseado del panel. */
  width: number;
  /** Alto estimado del panel (para decidir arriba o abajo). */
  height: number;
  /** Margen minimo con el borde de la pantalla. */
  margin?: number;
  /** Separacion entre el icono y el panel. */
  gap?: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  width: number;
  /** true = el panel va arriba del icono (top es su borde de abajo: usar translateY(-100%)). */
  above: boolean;
}

export function placeTooltip(input: TooltipPlacementInput): TooltipPlacement {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 6;
  const width = Math.max(0, Math.min(input.width, input.viewport.width - margin * 2));
  const maxLeft = input.viewport.width - margin - width;
  const left = Math.max(margin, Math.min(input.anchor.left, maxLeft));

  const below = input.anchor.bottom + gap;
  const fitsBelow = below + input.height <= input.viewport.height - margin;
  const fitsAbove = input.anchor.top - gap - input.height >= margin;
  const above = !fitsBelow && fitsAbove;
  return { left, top: above ? input.anchor.top - gap : below, width, above };
}

/**
 * Donde abrir el tooltip de `Tip` (24/11/2026): el panel ya medido, del lado pedido y dentro de la pantalla.
 *
 *   - `top` / `bottom`: arriba o abajo del disparador; si de ese lado no entra y del otro si, del otro. Horizontal:
 *     centrado (o alineado al borde izquierdo con `align: "start"`) y corrido lo justo para no salirse.
 *   - `right`: al costado, centrado en el alto (el menu lateral plegado); si no entra a la derecha, a la izquierda.
 *
 * Devuelve la esquina de arriba a la izquierda del panel en coordenadas de `position: fixed` (sin transform).
 */
export type TipSide = "top" | "bottom" | "right";

export interface TipPlacementInput {
  anchor: { left: number; top: number; right: number; bottom: number };
  viewport: { width: number; height: number };
  /** El panel ya dibujado y medido. */
  panel: { width: number; height: number };
  side?: TipSide;
  align?: "start" | "center";
  margin?: number;
  gap?: number;
}

export interface TipPlacement {
  left: number;
  top: number;
  /** El lado en el que quedo (puede ser el contrario del pedido). */
  side: TipSide | "left";
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

export function placeTip(input: TipPlacementInput): TipPlacement {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 8;
  const { anchor, viewport, panel } = input;
  const side = input.side ?? "top";
  const maxLeft = viewport.width - margin - panel.width;
  const maxTop = viewport.height - margin - panel.height;

  if (side === "right") {
    const fitsRight = anchor.right + gap + panel.width <= viewport.width - margin;
    const fitsLeft = anchor.left - gap - panel.width >= margin;
    const useLeft = !fitsRight && fitsLeft;
    const left = useLeft ? anchor.left - gap - panel.width : clamp(anchor.right + gap, margin, maxLeft);
    const top = clamp(anchor.top + (anchor.bottom - anchor.top) / 2 - panel.height / 2, margin, maxTop);
    return { left, top, side: useLeft ? "left" : "right" };
  }

  const left =
    input.align === "start"
      ? clamp(anchor.left, margin, maxLeft)
      : clamp(anchor.left + (anchor.right - anchor.left) / 2 - panel.width / 2, margin, maxLeft);
  const fitsAbove = anchor.top - gap - panel.height >= margin;
  const fitsBelow = anchor.bottom + gap + panel.height <= viewport.height - margin;
  const above = side === "top" ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
  return {
    left,
    top: above ? anchor.top - gap - panel.height : anchor.bottom + gap,
    side: above ? "top" : "bottom",
  };
}
