/**
 * El punto de extensión «columnas de módulos» de la lista de Ventas (Servicios A1, F95, D14).
 *
 * Un módulo suma una columna sin tocar la pantalla de Ventas: el servidor arma, para cada venta de la página, una
 * celda serializable (texto, link opcional y tono) y la lista la pinta al final, después de las columnas de BAIOS.
 * En la plantilla viaja vacío: sin módulos, la lista es exactamente la de siempre.
 */
export type ModuleCellTone = "good" | "warn" | "bad" | "muted" | "action";

export interface ModuleCell {
  label: string;
  href?: string | null;
  tone?: ModuleCellTone;
}

export interface ModuleColumn {
  key: string;
  header: string;
  /** Una celda por id de venta; sin celda, la columna muestra «—». */
  cells: Record<string, ModuleCell | undefined>;
}

export const MODULE_CELL_TONE_CLASS: Record<ModuleCellTone, string> = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  muted: "text-muted-foreground",
  action: "font-medium text-primary-ink",
};
