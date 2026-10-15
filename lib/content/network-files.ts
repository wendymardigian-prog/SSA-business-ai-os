/**
 * Cuando los archivos SON obligatorios y cuando no.
 *
 * `validateNetwork` es la regla del servidor al programar: sin archivos, la red
 * no sale. Eso es verdad solo cuando la publica el SISTEMA. Una red que "la
 * subo yo" lleva su fecha tentativa en el calendario y no necesita archivos en
 * la pieza: quien la sube los tiene en otro lado. Mostrarle un error rojo por
 * eso era pedirle algo que no hace falta.
 *
 * Aca esta la parte de la pantalla: que errores son de archivos faltantes, y
 * como se ve la validacion segun quien publica. El servidor NO cambia: al
 * programar sigue exigiendo todo (F77).
 */

import type { NetworkValidation } from "./validation";

/**
 * Los errores que dicen "no hay archivos (suficientes)": los de
 * `validateNetwork` y los del formato (`checkFormatFiles`).
 */
export function isMissingFilesError(message: string): boolean {
  return (
    /^Faltan archivos/.test(message) ||
    / necesita al menos una imagen o un video\.?$/.test(message) ||
    /^YouTube necesita un video\.?$/.test(message)
  );
}

/**
 * La validacion tal como se le muestra a la persona.
 *
 * Publica el sistema: es la del servidor, tal cual. La sube la persona: sin los
 * errores de archivos faltantes (siguen los demas: un archivo que no sirve para
 * el formato o un texto demasiado largo, que son errores de verdad).
 */
export function visibleValidation(validation: NetworkValidation, systemPublishes: boolean): NetworkValidation {
  if (systemPublishes) return validation;
  const errors = validation.errors.filter((e) => !isMissingFilesError(e));
  return { ...validation, errors, ok: errors.length === 0 };
}

/** Si lo unico que le falta a la red para salir son archivos. */
export function lacksFiles(validation: NetworkValidation): boolean {
  return validation.errors.some(isMissingFilesError);
}

/** Lo que dice la tarjeta cuando el sistema no puede programar por falta de archivos. */
export const NO_FILES_TO_SCHEDULE =
  "No se puede programar: no hay archivos para publicar. Subilos en “Archivos de la pieza” y elegilos en esta red.";
