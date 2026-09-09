/**
 * Punto de entrada del registro (F7).
 *
 * Importar este modulo da de alta todos los tipos. El motor, el matcher de
 * triggers y la UI importan de aca, asi que ninguno puede quedar viendo una
 * lista distinta de la de los demas — que era justamente el problema: habia
 * cinco listas de tipos de nodo en la UI y dos mas en el motor, y se
 * desincronizaron.
 *
 * Para sumar un tipo nuevo, ver docs/flow-registry.md.
 */

import "./nodes";
import "./conditions";
import "./triggers";

export * from "./registry";
export type * from "./types";
