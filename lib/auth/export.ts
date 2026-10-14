/**
 * Exportar datos a CSV (Equipo y roles, F24). Un solo permiso, `data.export`, para los cuatro exports
 * del sistema: las respuestas de formularios, los reportes de fin de día, las corridas de IA y la tabla
 * de anuncios. Antes los podía bajar cualquiera que viera la pantalla, el Member incluido.
 *
 * Puro: lo usan las páginas (para ofrecer o no el botón) y los endpoints y acciones (para rechazar).
 */
export const EXPORT_KEY = "data.export";

export function canExport(can: (key: string) => boolean): boolean {
  return can(EXPORT_KEY);
}

export const NO_EXPORT_MESSAGE = "No tenés permiso para exportar datos";
