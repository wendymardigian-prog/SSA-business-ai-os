/**
 * Tipos de la atribución de una visita. Sin dependencias: los usa también el
 * script de embed.
 */

/** Atribución plana: las claves de `keys.ts` que vinieron + datos de la visita. Todo texto. */
export type Attribution = Record<string, string>;

/** Una visita persistida: la atribución plana más cuándo pasó (ms desde epoch). */
export interface Visit {
  [key: string]: string | number;
  ts: number;
}

/** Lo que se guarda en la cookie `ssa_attr` (sitio) o en el `localStorage` de la web que embebe. */
export interface StoredAttribution {
  v: 1;
  first?: Visit;
  last?: Visit;
}

/** La atribución efectiva de un envío: la de la visita + la primera persistida. */
export type EffectiveAttribution = Attribution & { first_visit?: never };
