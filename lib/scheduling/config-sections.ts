/**
 * Las cinco secciones de la Configuracion de agenda (F8), como datos puros:
 * la navegacion lateral y el boton principal de cada una salen de aca.
 */

export interface ConfigSection {
  key: "eventos" | "disponibilidad" | "calendarios" | "categorias" | "ajustes";
  label: string;
  href: string;
  /** El boton principal de la barra en esa seccion (id + etiqueta). */
  primaryAction: { id: string; label: string } | null;
  /** Solo se puede editar con este permiso; ver, todos. */
  editPermission?: string;
}

export const CONFIG_BASE = "/dashboard/agenda/configuracion";

export const CONFIG_SECTIONS: ConfigSection[] = [
  { key: "eventos", label: "Eventos", href: `${CONFIG_BASE}/eventos`, primaryAction: { id: "new_event", label: "+ Nuevo evento" } },
  { key: "disponibilidad", label: "Disponibilidad", href: `${CONFIG_BASE}/disponibilidad`, primaryAction: { id: "new_schedule", label: "+ Nuevo horario" } },
  { key: "calendarios", label: "Calendarios de Google", href: `${CONFIG_BASE}/calendarios`, primaryAction: { id: "connect_google", label: "+ Conectar cuenta de Google" } },
  { key: "categorias", label: "Categorías", href: `${CONFIG_BASE}/categorias`, primaryAction: { id: "new_category", label: "+ Nuevo tipo" }, editPermission: "scheduling.manage_categories" },
  { key: "ajustes", label: "Ajustes", href: `${CONFIG_BASE}/ajustes`, primaryAction: { id: "save", label: "Guardar cambios" } },
];

export const DEFAULT_CONFIG_SECTION = CONFIG_SECTIONS[0];

export function configSectionFor(pathname: string): ConfigSection | null {
  return CONFIG_SECTIONS.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`)) ?? null;
}

/** Quien ve el engranaje: tiene agenda propia o administra categorias (F8). */
export function canOpenConfig(can: (key: string) => boolean): boolean {
  return can("scheduling.use") || can("scheduling.manage_categories");
}
