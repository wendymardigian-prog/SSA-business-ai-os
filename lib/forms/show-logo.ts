/**
 * «Mostrar el logo del negocio» de un formulario (`forms.design.showLogo`, 18/11/2026). PURO.
 *
 * Prendido salvo que alguien lo haya apagado a mano: los formularios que ya existían lo tenían guardado en «sí» y
 * arrancan con logo (decisión de producto). Lo leen la página pública (`/f/<slug>`, nunca incrustada) y el PDF de un
 * contrato (arriba de la primera hoja). El logo es el de la marca del negocio (`resolveBrand`).
 */
export function showsLogo(design: unknown): boolean {
  return !(design && typeof design === "object" && (design as { showLogo?: unknown }).showLogo === false);
}
