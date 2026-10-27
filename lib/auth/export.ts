/**
 * Exportar datos a CSV (Equipo y roles, F24). Un solo permiso, `data.export`, para todos los exports
 * del sistema (las corridas de IA, la tabla de anuncios...): no alcanza con ver la pantalla.
 *
 * Puro: lo usan las páginas (para ofrecer o no el botón) y los endpoints y acciones (para rechazar).
 */
export const EXPORT_KEY = "data.export";

export function canExport(can: (key: string) => boolean): boolean {
  return can(EXPORT_KEY);
}

export const NO_EXPORT_MESSAGE = "No tenés permiso para exportar datos";
