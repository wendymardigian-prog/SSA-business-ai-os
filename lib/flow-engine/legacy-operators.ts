/**
 * Los seis operadores del nodo `condition` de siempre (`equals`, `not_equals`,
 * `contains`, `exists`, `gt`, `lt`), como funciones puras.
 *
 * Estaban escritos adentro de `registry/conditions.ts`. Se sacaron a un modulo
 * sin dependencias para que el registro (servidor) y el evaluador tipado
 * (`condition-eval.ts`, que tambien corre en el navegador) usen LA MISMA
 * funcion: asi "Convertir a Condiciones" se comporta idéntico al nodo viejo, y
 * un test de paridad lo cuida contra el registro.
 *
 * Semantica tal cual era: texto exacto (distingue mayusculas, no recorta), `gt`
 * y `lt` numericos con `Number()` (un vacio vale 0, un texto no numerico nunca
 * se cumple), y lo que no existe es "distinto" de todo.
 */

export interface LegacyOperator {
  operator: string;
  label: string;
  evaluate(actual: string | undefined, expected: string): boolean;
}

export const LEGACY_OPERATORS: LegacyOperator[] = [
  { operator: "equals", label: "es igual a", evaluate: (actual, expected) => actual === expected },
  { operator: "not_equals", label: "no es igual a", evaluate: (actual, expected) => actual !== expected },
  { operator: "contains", label: "contiene", evaluate: (actual, expected) => actual?.includes(expected) || false },
  {
    operator: "exists",
    label: "tiene algun valor",
    evaluate: (actual) => actual !== undefined && actual !== null && actual !== "",
  },
  { operator: "gt", label: "es mayor que", evaluate: (actual, expected) => Number(actual) > Number(expected) },
  { operator: "lt", label: "es menor que", evaluate: (actual, expected) => Number(actual) < Number(expected) },
];

const BY_ID = new Map(LEGACY_OPERATORS.map((o) => [o.operator, o]));

export function getLegacyOperator(operator: string): LegacyOperator | undefined {
  return BY_ID.get(operator);
}
