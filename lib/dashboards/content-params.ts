/**
 * Lo que el dashboard de contenido guarda en la URL (F105).
 *
 * `agrupar` elige la dimension de la tabla de rendimiento y los otros cinco
 * son filtros sobre la clasificacion de la pieza. Viven en la URL y no en el
 * estado del componente por lo mismo que la vista del tablero: se comparte con
 * un link, "atras" hace lo que se espera, y el servidor lee SOLO lo que hace
 * falta.
 *
 * Los valores se comparan contra ids que ya estan en los datos: no se validan
 * contra la base aca. Uno que no existe simplemente no trae nada.
 */

import { isGroupDimension, type ClassificationFilters, type GroupDimension } from "./content";

export const DEFAULT_GROUP: GroupDimension = "offer";

/** Un valor mas largo que un id no es un valor: se ignora. */
const MAX_LENGTH = 64;

type RawParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_LENGTH ? trimmed : null;
}

export function parseClassificationParams(params: RawParams): {
  group: GroupDimension;
  filters: ClassificationFilters;
} {
  const group = single(params.agrupar);

  const filters: ClassificationFilters = {};
  const entries: Array<[keyof ClassificationFilters, string | null]> = [
    ["piece", single(params.pieza)],
    ["offer", single(params.oferta)],
    ["pillar", single(params.pilar)],
    ["funnel", single(params.embudo)],
    ["format", single(params.formato)],
  ];
  for (const [key, value] of entries) {
    if (value) filters[key] = value;
  }

  return { group: group && isGroupDimension(group) ? group : DEFAULT_GROUP, filters };
}

/** La query string con un parametro puesto o quitado. `agrupar` en su valor por defecto se quita. */
export function withParam(current: URLSearchParams, key: string, value: string | null): string {
  const next = new URLSearchParams(current.toString());
  const isDefault = key === "agrupar" && value === DEFAULT_GROUP;
  if (value && !isDefault) next.set(key, value);
  else next.delete(key);
  return next.toString();
}

/** El parametro de URL que filtra cada dimension (la red ya existia como `red`). */
export const GROUP_PARAM: Record<GroupDimension, string> = {
  piece: "pieza",
  offer: "oferta",
  pillar: "pilar",
  funnel: "embudo",
  platform: "red",
  format: "formato",
};

/** Lo que esta elegido en el filtro de esa dimension, o null. */
export function selectedFor(
  dimension: GroupDimension,
  filters: ClassificationFilters,
  platform: string | null,
): string | null {
  if (dimension === "platform") return platform;
  return filters[dimension === "piece" ? "piece" : dimension] ?? null;
}
