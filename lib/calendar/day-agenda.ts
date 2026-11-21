/**
 * «Ver todo» de un día del calendario de la Agenda: la lista de todo lo de ese día (reuniones, tareas y eventos de
 * Google) ordenada, el filtro de los interruptores del modal y el resumen que aparece al pasar el mouse. PURO.
 */
export type DayEntryKind = "booking" | "task" | "google" | "busy";

export interface DayEntry {
  kind: DayEntryKind;
  id: string;
  title: string;
  /** Minutos desde la medianoche local; null = todo el día o sin hora. */
  startMinutes: number | null;
  /** «09:00 a 10:00», «Todo el día» o «Sin hora». */
  timeLabel: string;
  /** Una línea más: el estado, el calendario, quién atiende. */
  sub: string | null;
  /** Se puede abrir su panel (el «Ocupado» de otra persona, no). */
  openable: boolean;
}

/** Sin hora (todo el día, tarea sin hora) primero; después por hora; a igual hora, reuniones, tareas y Google. */
const KIND_ORDER: Record<DayEntryKind, number> = { booking: 0, task: 1, google: 2, busy: 3 };

export function sortDayEntries(entries: readonly DayEntry[]): DayEntry[] {
  return [...entries].sort((a, b) => {
    const am = a.startMinutes ?? -1;
    const bm = b.startMinutes ?? -1;
    if (am !== bm) return am - bm;
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.title.localeCompare(b.title, "es");
  });
}

/** Lo que muestra el modal según sus interruptores. */
export function filterDayEntries(entries: readonly DayEntry[], include: { tasks: boolean; google: boolean }): DayEntry[] {
  return sortDayEntries(
    entries.filter((e) => {
      if (e.kind === "task") return include.tasks;
      if (e.kind === "google" || e.kind === "busy") return include.google;
      return true;
    }),
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** «3 reuniones · 2 eventos de Google · 1 tarea», o «Nada agendado». */
export function daySummary(entries: readonly DayEntry[]): string {
  const bookings = entries.filter((e) => e.kind === "booking").length;
  const google = entries.filter((e) => e.kind === "google" || e.kind === "busy").length;
  const tasks = entries.filter((e) => e.kind === "task").length;
  const parts: string[] = [];
  if (bookings) parts.push(plural(bookings, "reunión", "reuniones"));
  if (google) parts.push(plural(google, "evento de Google", "eventos de Google"));
  if (tasks) parts.push(plural(tasks, "tarea", "tareas"));
  return parts.length ? parts.join(" · ") : "Nada agendado";
}
