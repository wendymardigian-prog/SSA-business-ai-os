/**
 * Los filtros de la lista de contactos por atribución (F88).
 *
 * Se filtra por el PRIMER toque, y la pantalla lo dice: "los contactos que
 * entraron por un comentario" no es "los contactos que alguna vez comentaron".
 * El primer toque es el crédito de quien trajo al lead, que es lo que se quiere
 * contar; el último cambia con cada interacción y no sirve para eso.
 *
 * Los valores vienen de la URL, así que se validan contra las listas cerradas de
 * la taxonomía antes de llegar a la consulta: uno inventado se ignora en vez de
 * romper. (Por eso solo se pueden filtrar los valores de la lista: uno crudo,
 * como un `utm_source` raro, no tiene un selector que lo ofrezca.)
 */

import { pickEnum, type SearchParamValue } from "@/lib/url-params";
import { MEDIUMS, SOURCES, type KnownMedium, type KnownSource } from "./taxonomy";

/** Los nombres de los parámetros de la URL. */
export const SOURCE_PARAM = "fuente";
export const MEDIUM_PARAM = "medio";

/** Dónde vive cada valor dentro de `contacts.attribution` (y en el índice de la 00114). */
export const FIRST_TOUCH_SOURCE_PATH = "attribution->first_touch->>source";
export const FIRST_TOUCH_MEDIUM_PATH = "attribution->first_touch->>medium";

export interface AttributionFilters {
  source: KnownSource | "";
  medium: KnownMedium | "";
}

export function parseAttributionFilters(params: Record<string, SearchParamValue>): AttributionFilters {
  return {
    source: pickEnum<KnownSource>(params[SOURCE_PARAM], SOURCES),
    medium: pickEnum<KnownMedium>(params[MEDIUM_PARAM], MEDIUMS),
  };
}

/** Las condiciones a aplicar a la consulta, en forma de pares ruta-valor. */
export function attributionClauses(filters: AttributionFilters): Array<{ path: string; value: string }> {
  return [
    ...(filters.source ? [{ path: FIRST_TOUCH_SOURCE_PATH, value: filters.source }] : []),
    ...(filters.medium ? [{ path: FIRST_TOUCH_MEDIUM_PATH, value: filters.medium }] : []),
  ];
}

export const hasAttributionFilter = (filters: AttributionFilters) => Boolean(filters.source || filters.medium);
