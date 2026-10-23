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
