/**
 * Las fechas en la tarjeta del tablero.
 *
 * Una pieza sale casi siempre el mismo dia en todas sus redes: ahi la tarjeta
 * muestra UNA fecha (con hora) y las redes van sin fecha. Si cada red tiene la
 * suya, la fecha va en el chip de cada red. Una red sin fecha no cuenta como
 * "la misma": si alguna tiene y otra no, se muestran por red.
 *
 * Puro: lo usa la tarjeta y lo prueba un test.
 */

export type CardDates =
  | { kind: "none" }
  /** Todas las redes salen en el mismo momento: una sola fecha. */
  | { kind: "single"; at: string }
  /** Cada red con la suya: va en su chip. */
  | { kind: "per_network" };

export function cardDates(networks: Array<{ at: string | null }>): CardDates {
  const times = networks.map((n) => (n.at ? Date.parse(n.at) : NaN));
  const dated = times.filter((t) => !Number.isNaN(t));
  if (dated.length === 0) return { kind: "none" };

  const allDated = dated.length === networks.length;
  const allSame = dated.every((t) => t === dated[0]);
  if (allDated && allSame) {
    return { kind: "single", at: networks.find((n) => n.at)!.at as string };
  }
  return { kind: "per_network" };
}

/** "25 oct · 15:00", en la zona del negocio. Una fecha que no se entiende no se muestra. */
export function formatCardDate(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const month = get("month").replace(/\.$/, "");
  return `${get("day")} ${month} · ${get("hour")}:${get("minute")}`;
}
