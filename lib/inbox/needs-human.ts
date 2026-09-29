/**
 * El aviso de "necesita humano" en la bandeja (F11).
 *
 * De nada sirve marcar la conversacion si nadie mira: el escalado tiene que
 * verse en la lista, en el encabezado del hilo y en un filtro.
 *
 * La decision de que mostrar y que dice vive aca, en funciones puras y
 * testeadas; el componente solo las compone. Modulo PURO.
 */

/** El parametro de la URL del filtro. */
export const NEEDS_HUMAN_PARAM = "necesita-humano";

export interface NeedsHumanRow {
  needs_human?: boolean | null;
  needs_human_reason?: string | null;
  needs_human_at?: string | null;
}

export interface NeedsHumanBadge {
  show: boolean;
  label: string;
  /** Lo que se lee al pasar el mouse: el motivo, o una explicacion generica. */
  title: string;
}

const LABEL = "Necesita humano";

const FALLBACK =
  "El asistente no pudo entender lo que llegó y no respondió. Contestale vos y marcá la conversación como vista.";

/**
 * El badge de una conversacion escalada.
 *
 * Siempre devuelve un objeto, con `show` en false cuando no corresponde: asi el
 * componente no tiene que decidir nada, y el titulo nunca queda vacio (un
 * `title` vacio en un badge rojo es peor que no tener badge).
 */
export function needsHumanBadge(row: NeedsHumanRow | null | undefined): NeedsHumanBadge {
  if (!row?.needs_human) return { show: false, label: LABEL, title: "" };

  const reason = row.needs_human_reason?.trim();
  return {
    show: true,
    label: LABEL,
    title: reason ? `${reason}. El asistente no respondió: contestale vos.` : FALLBACK,
  };
}

/** Cuantas de las que se estan mirando necesitan una persona. */
export function countNeedsHuman(rows: Array<NeedsHumanRow | null | undefined>): number {
  return rows.filter((row) => row?.needs_human === true).length;
}
