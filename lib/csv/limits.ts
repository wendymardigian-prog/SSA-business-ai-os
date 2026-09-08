/**
 * Limites de la importacion de CSV (F19).
 *
 * Viven aparte de lib/actions/csv-import.ts porque un archivo "use server"
 * solo puede exportar funciones async: una constante exportada desde ahi
 * rompe el build. Y los necesitan los dos lados — el navegador para avisar
 * antes de subir, el servidor para no confiar en eso.
 */

/** Filas por tanda. Secuenciales, para que la barra de progreso no mienta. */
export const IMPORT_BATCH_SIZE = 200;

export const MAX_IMPORT_ROWS = 10_000;

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Tope del detalle de errores: 10.000 filas malas serian varios MB en una fila. */
export const MAX_ERROR_DETAILS = 200;
