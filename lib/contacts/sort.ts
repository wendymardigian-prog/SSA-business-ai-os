/**
 * El orden de la lista de contactos ("ordenar por").
 *
 * Vive en la URL (`?orden=`), igual que los filtros: una vista ordenada se puede
 * compartir. El valor viene del navegador, asi que se valida contra esta lista
 * cerrada antes de llegar a la consulta: uno inventado vuelve al orden de
 * siempre en vez de romper o, peor, ordenar por una columna a eleccion.
 *
 * Cada orden termina en `id`: sin un desempate unico, dos contactos con el
 * mismo valor pueden aparecer en dos paginas o en ninguna cuando se pagina.
 *
 * Puro: la pagina arma la consulta con `contactOrderClauses`.
 */

export const CONTACT_SORTS = ["reciente", "nuevos", "antiguos", "nombre"] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];

/** El de siempre: quien interactuo hace menos va primero. */
export const DEFAULT_CONTACT_SORT: ContactSort = "reciente";

export const CONTACT_SORT_LABELS: Record<ContactSort, string> = {
  reciente: "Última interacción",
  nuevos: "Más nuevos primero",
  antiguos: "Más antiguos primero",
  nombre: "Nombre (A-Z)",
};

export const CONTACT_SORT_HINTS: Record<ContactSort, string> = {
  reciente: "Quien escribió o respondió hace menos va primero",
  nuevos: "Por fecha en que se creó el contacto",
  antiguos: "Por fecha en que se creó el contacto",
  nombre: "Los que no tienen nombre van al final",
};

export interface OrderClause {
  column: "last_interaction_at" | "created_at" | "display_name" | "id";
  ascending: boolean;
  /** Donde van los NULL: al final (false) o al principio (true). */
  nullsFirst?: boolean;
}

/** El valor de la URL, o el orden de siempre si no es uno de la lista. */
export function parseContactSort(raw: string | string[] | null | undefined): ContactSort {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (CONTACT_SORTS as readonly string[]).includes(value ?? "") ? (value as ContactSort) : DEFAULT_CONTACT_SORT;
}

export function contactOrderClauses(sort: ContactSort): OrderClause[] {
  switch (sort) {
    case "nuevos":
      return [{ column: "created_at", ascending: false }, { column: "id", ascending: true }];
    case "antiguos":
      return [{ column: "created_at", ascending: true }, { column: "id", ascending: true }];
    case "nombre":
      return [
        { column: "display_name", ascending: true, nullsFirst: false },
        { column: "created_at", ascending: false },
        { column: "id", ascending: true },
      ];
    case "reciente":
      return [
        { column: "last_interaction_at", ascending: false, nullsFirst: false },
        { column: "created_at", ascending: false },
        { column: "id", ascending: true },
      ];
  }
}
