// @plantilla-quitar(servicios)
/**
 * El calendario de un programa: las pestañas de la lista (Próximas / Pasadas) y el drawer de UNA clase (una fecha de
 * una sesión en vivo). PURO: lo usan la página, el calendario y el link «Clase» de una tarea.
 *
 * La clase abierta vive en la URL (`?sesion=<id>&fecha=<AAAA-MM-DD>`, la fecha ORIGINAL de la clase, la misma clave que
 * `live_session_dates.occurs_on`), así el link de una tarea la vuelve a abrir. La pestaña, en `?lista=pasadas` (sin el
 * parámetro, Próximas).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type ListTab = "proximas" | "pasadas";

export interface ClassRef {
  sessionId: string;
  occursOn: string;
}

/** La pestaña de la lista según `?lista=`: cualquier otra cosa es Próximas. */
export function listTabFrom(value: string | null | undefined): ListTab {
  return value === "pasadas" ? "pasadas" : "proximas";
}

/** La clase de la URL, o null si falta algo o no es válido (un link roto no abre nada). */
export function parseClassRef(sessionId: string | null | undefined, occursOn: string | null | undefined): ClassRef | null {
  if (!sessionId || !occursOn || !UUID.test(sessionId) || !DATE.test(occursOn)) return null;
  return { sessionId: sessionId.toLowerCase(), occursOn };
}

/** La query con la clase puesta (o sacada, con null), conservando el resto. */
export function withClassRef(query: string, ref: ClassRef | null): string {
  const p = new URLSearchParams(query);
  if (ref) {
    p.set("sesion", ref.sessionId);
    p.set("fecha", ref.occursOn);
  } else {
    p.delete("sesion");
    p.delete("fecha");
  }
  return p.toString();
}

/** La query con la pestaña puesta: Próximas no deja parámetro. */
export function withListTab(query: string, tab: ListTab): string {
  const p = new URLSearchParams(query);
  if (tab === "pasadas") p.set("lista", "pasadas");
  else p.delete("lista");
  return p.toString();
}

/** El link a una clase desde afuera del programa (una tarea): pasa por una ruta que busca el programa de la sesión. */
export function classHref(ref: ClassRef): string {
  return `/dashboard/portal/clase?${new URLSearchParams({ sesion: ref.sessionId, fecha: ref.occursOn })}`;
}

/** El link al calendario de un programa con la clase abierta (en la pestaña que le toca). */
export function programClassHref(productId: string, ref: ClassRef, past: boolean): string {
  const p = new URLSearchParams({ tab: "calendario", vista: "lista" });
  if (past) p.set("lista", "pasadas");
  p.set("sesion", ref.sessionId);
  p.set("fecha", ref.occursOn);
  return `/dashboard/portal/${productId}?${p}`;
}

export interface ClassSectionsInput {
  /** La clase ya empezó. */
  started: boolean;
  status: "normal" | "cancelled" | "moved";
  /** `live_sessions.manage`: mover, cancelar, editar la sesión, la grabación y las notas. */
  canManage: boolean;
  /** `tasks.view`: la sección de tareas (crear pide además `tasks.edit`, lo decide la sección). */
  canSeeTasks: boolean;
}

export interface ClassSections {
  /** El botón «Entrar» (con link de la reunión): solo una clase que no está cancelada y no terminó hace rato. */
  enter: boolean;
  /** El menú «⋯» con mover / cancelar / editar la sesión. */
  menu: boolean;
  notes: "edit" | "read";
  tasks: boolean;
  /** Grabación y asistencia: las de una clase que ya empezó y no se canceló. */
  recording: boolean;
  attendance: boolean;
}

/** Qué muestra el drawer de una clase. */
export function classSections(i: ClassSectionsInput): ClassSections {
  const happened = i.started && i.status !== "cancelled";
  return {
    enter: !i.started && i.status !== "cancelled",
    menu: i.canManage,
    notes: i.canManage ? "edit" : "read",
    tasks: i.canSeeTasks,
    recording: happened,
    attendance: happened,
  };
}

/** Tope del texto de las notas (HTML ya limpio). */
export const CLASS_NOTE_MAX = 20_000;

/** Lo que se guarda de unas notas: vacío (sin texto) = null. */
export function noteToStore(html: string): string | null {
  const text = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return text ? html : null;
}
