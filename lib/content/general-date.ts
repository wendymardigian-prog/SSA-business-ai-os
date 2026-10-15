/**
 * La fecha general de una pieza.
 *
 * Una pieza sale en varias redes y casi siempre el mismo dia. En vez de poner
 * la misma fecha red por red, hay UNA fecha general arriba. Si alguna red
 * necesita la suya, se pone en esa red y la general deja de aplicar.
 *
 * No hay un campo nuevo en la base: la fecha general se guarda como la fecha de
 * cada red que todavia esta abierta (`networks[].planned_at`). Asi el
 * calendario, el tablero, el despachador y el resto leen lo mismo de siempre,
 * y lo que se ve en pantalla es lo que va a pasar. El modo se DERIVA de esas
 * fechas, no se guarda:
 *
 *   general      todas las redes abiertas tienen la misma fecha (o ninguna
 *                tiene): hay una fecha general, vacia o no.
 *   per_network  hay fechas distintas, o una red con fecha y otra sin ella:
 *                la fecha se asigna en cada red.
 *   none         no hay redes abiertas donde guardarla.
 *
 * Una red "cerrada" (ya publicada, o publicandose) no participa: su fecha es un
 * hecho, y cambiar la general no puede moverla.
 *
 * Puro: sin React, sin base.
 */

import type { NetworkEntry } from "./redistribution";

export type GeneralDateMode = "general" | "per_network" | "none";

export interface GeneralDateView {
  mode: GeneralDateMode;
  /** La fecha general (ISO), si el modo es `general` y hay una. */
  at: string | null;
}

/** El instante de una fecha, para comparar dos textos que dicen lo mismo. */
function instant(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

/** Las redes que todavia pueden cambiar de fecha. */
function openNetworks(networks: NetworkEntry[], closed: ReadonlySet<string>): NetworkEntry[] {
  return networks.filter((n) => !closed.has(n.platform));
}

export function generalDateOf(networks: NetworkEntry[], closed: ReadonlySet<string> = new Set()): GeneralDateView {
  const open = openNetworks(networks, closed);
  if (open.length === 0) return { mode: "none", at: null };

  const times = open.map((n) => instant(n.planned_at));
  const withDate = times.filter((t): t is number => t !== null);

  // Ninguna tiene fecha: la general esta libre, a la espera de una.
  if (withDate.length === 0) return { mode: "general", at: null };

  // Una con fecha y otra sin ella cuenta como "cada red": que alguna tenga la
  // suya es justo lo que apaga la general.
  if (withDate.length !== open.length) return { mode: "per_network", at: null };

  const first = withDate[0];
  if (withDate.some((t) => t !== first)) return { mode: "per_network", at: null };

  return { mode: "general", at: open.find((n) => n.planned_at)?.planned_at ?? null };
}

/** Pone (o borra, con null) la fecha en todas las redes abiertas. */
export function applyGeneralDate(
  networks: NetworkEntry[],
  at: string | null,
  closed: ReadonlySet<string> = new Set(),
): NetworkEntry[] {
  return networks.map((n) => (closed.has(n.platform) ? n : { ...n, planned_at: at }));
}

/**
 * Una red que se agrega hereda la fecha general, si la hay: sumar Threads a
 * una pieza ya fechada no tiene que dejarla sin fecha.
 */
export function inheritGeneralDate(
  entry: NetworkEntry,
  networks: NetworkEntry[],
  closed: ReadonlySet<string> = new Set(),
): NetworkEntry {
  const general = generalDateOf(networks, closed);
  return general.mode === "general" && general.at ? { ...entry, planned_at: general.at } : entry;
}
