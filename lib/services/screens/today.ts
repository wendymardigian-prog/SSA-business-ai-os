// @plantilla-quitar(servicios)
/** La fecha civil de hoy (AAAA-MM-DD) en una zona horaria; sin zona válida, UTC. */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
