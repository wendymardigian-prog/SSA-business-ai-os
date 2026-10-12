/**
 * Los caminos de un nodo `branch` ("Condiciones"): ids, limites y validacion.
 * PURO.
 *
 * El id de un camino ES su salida (`sourceHandle`, y lo que devuelve el nodo es
 * `handle:<id>`): por eso se genera una vez, no cambia nunca aunque se
 * renombre el camino, y no puede chocar con las salidas que el motor ya
 * conoce (`else`, y los alias `true`/`false`/`yes`/`no` del nodo viejo).
 */

import type { BranchNodeData, BranchPath } from "./condition-eval";

/** La salida de "Si no": siempre existe y siempre es la ultima. */
export const BRANCH_ELSE_HANDLE = "else";
export const BRANCH_ELSE_LABEL = "Si no";

/** Ids que un camino NO puede tener: el motor los toma por otra cosa. */
export const RESERVED_PATH_IDS = ["else", "true", "false", "yes", "no"] as const;

export const MIN_PATHS = 1;
export const MAX_PATHS = 10;
export const MAX_LABEL_LENGTH = 60;

const PATH_ID_RE = /^p_[a-z0-9]{6}$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** `p_` + 6 caracteres. Sin repetir ninguno de `taken`. `random` entra por parametro para los tests. */
export function newPathId(taken: Iterable<string> = [], random: () => number = Math.random): string {
  const used = new Set(taken);
  // Con 36^6 combinaciones el primer intento casi siempre sirve; el tope evita un bucle sin fin.
  for (let attempt = 0; attempt < 50; attempt++) {
    let id = "p_";
    for (let i = 0; i < 6; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
    if (!used.has(id)) return id;
  }
  // Inalcanzable en la practica: cae a un id que se arma con el tamano del conjunto.
  return `p_${(used.size + 1).toString(36).padStart(6, "0")}`;
}

/** ¿Es un id que el editor generaria? (los demas se aceptan al leer, no al escribir). */
export function isGeneratedPathId(id: unknown): id is string {
  return typeof id === "string" && PATH_ID_RE.test(id);
}

export function isReservedPathId(id: string): boolean {
  return (RESERVED_PATH_IDS as readonly string[]).includes(id);
}

/** Los caminos de un nodo, sin romperse con datos a medias. */
export function pathsOf(data: Partial<BranchNodeData> | null | undefined): BranchPath[] {
  return Array.isArray(data?.paths) ? (data!.paths as BranchPath[]).filter((p) => p && typeof p === "object") : [];
}

/** Lo que hay que corregir antes de guardar un `branch`. Vacio = valido. */
export function validateBranchData(data: Partial<BranchNodeData> | null | undefined): string[] {
  const errors: string[] = [];
  const paths = pathsOf(data);
  if (paths.length < MIN_PATHS) errors.push("Tiene que haber al menos un camino.");
  if (paths.length > MAX_PATHS) errors.push(`Como máximo ${MAX_PATHS} caminos.`);

  const seen = new Set<string>();
  paths.forEach((path, index) => {
    const n = index + 1;
    if (typeof path.id !== "string" || path.id === "") errors.push(`El camino ${n} no tiene identificador.`);
    else if (isReservedPathId(path.id)) errors.push(`El camino ${n} usa un identificador reservado ("${path.id}").`);
    else if (seen.has(path.id)) errors.push(`Hay dos caminos con el mismo identificador ("${path.id}").`);
    else seen.add(path.id);

    if (typeof path.label !== "string" || path.label.trim() === "") errors.push(`El camino ${n} necesita un nombre.`);
    else if (path.label.length > MAX_LABEL_LENGTH) errors.push(`El nombre del camino ${n} es muy largo (máximo ${MAX_LABEL_LENGTH}).`);

    if (path.logic !== "and" && path.logic !== "or") errors.push(`El camino ${n} tiene que combinar sus condiciones con "y" o con "o".`);
    if (!Array.isArray(path.conditions) || path.conditions.length === 0) errors.push(`El camino ${n} necesita al menos una condición.`);
  });
  return errors;
}
