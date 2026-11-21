/**
 * El panel de una reunión o de un evento de Google: en el escritorio queda AL COSTADO del calendario, dentro del
 * flujo y sin sombra (el calendario se sigue pudiendo usar: arrastrar, estirar, abrir otro); en el teléfono va encima,
 * a pantalla completa, con el fondo oscuro.
 */
export const SIDE_PANEL_BACKDROP_CLASS = "fixed inset-0 z-40 bg-black/40 md:hidden";
export const SIDE_PANEL_CLASS =
  "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl md:relative md:inset-auto md:z-auto md:h-full md:w-[26rem] md:max-w-none md:shrink-0 md:shadow-none";
