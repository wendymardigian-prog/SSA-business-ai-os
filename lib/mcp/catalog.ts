import { CATALOG_JSON } from "./catalog.generated";

/**
 * El catálogo de acciones del conector MCP (generado por `scripts/build-mcp-catalog.mjs`). Puro: lo leen las
 * herramientas `listar_acciones`, `describir_accion` y `ejecutar_accion`.
 */

export type ActionKind = "read" | "write" | "sensitive";

export interface CatalogParam {
  name: string;
  optional: boolean;
  type: string;
}

export interface CatalogAction {
  id: string;
  file: string;
  name: string;
  kind: ActionKind;
  /** Las claves de permiso que se ven en el cuerpo (orientativo: la acción las vuelve a comprobar). */
  permissions: string[];
  params: CatalogParam[];
  returns: string;
  description: string;
}

const CATALOG = JSON.parse(CATALOG_JSON) as { count: number; actions: CatalogAction[] };
const BY_ID = new Map(CATALOG.actions.map((a) => [a.id, a]));

export function allActions(): readonly CatalogAction[] {
  return CATALOG.actions;
}

export function findAction(id: string): CatalogAction | null {
  return BY_ID.get(id) ?? null;
}

/** El módulo de una acción: la primera parte del archivo («scheduling/bookings» → «scheduling»). */
export function actionModule(a: Pick<CatalogAction, "file">): string {
  return a.file.split("/")[0].replace(/-.*$/, "");
}

/**
 * Las que la persona puede intentar: las que no piden ninguna clave visible o piden alguna que tiene. Orientativo
 * (para no ofrecerle lo que seguro no puede); quien decide es la acción. Pura.
 */
export function visibleFor(can: (key: string) => boolean, actions: readonly CatalogAction[] = CATALOG.actions): CatalogAction[] {
  return actions.filter((a) => a.permissions.length === 0 || a.permissions.some((k) => can(k)));
}

/** Búsqueda simple por palabras (todas tienen que aparecer en id, nombre o descripción). Pura. */
export function searchActions(actions: readonly CatalogAction[], query: string | undefined, module?: string): CatalogAction[] {
  const words = (query ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  return actions.filter((a) => {
    if (module && actionModule(a) !== module && !a.file.startsWith(module)) return false;
    if (words.length === 0) return true;
    const hay = `${a.id} ${a.description} ${a.permissions.join(" ")}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return words.every((w) => hay.includes(w));
  });
}
