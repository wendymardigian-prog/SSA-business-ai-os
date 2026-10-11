/**
 * Como se escriben las fechas y duraciones de Llamadas. Siempre en la zona de
 * QUIEN MIRA (la base guarda UTC). Puro.
 */

export function formatCallDate(iso: string | null | undefined, timeZone: string, style: "short" | "long" = "long"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    day: "numeric",
    month: "short",
    ...(style === "long" ? { year: "numeric" as const, hour: "2-digit" as const, minute: "2-digit" as const, hour12: false } : {}),
  }).format(date);
}

/** Minutos redondeados, o "—". Menos de un minuto se dice "<1 min". */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return "<1 min";
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "hace 2 horas" / "ayer" / "hace 5 dias", para al lado de una fecha. */
export function formatAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  return "";
}

/** Una clave de categoria ("falta_de_tiempo") como texto ("Falta de tiempo"). */
export function humanize(value: string | null | undefined): string {
  if (!value) return "";
  const text = value.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** El instante de hace `days` dias, en ISO. Vive aca para que las paginas no llamen a `Date.now()` al renderizar. */
export function daysAgoIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 3600_000).toISOString();
}
