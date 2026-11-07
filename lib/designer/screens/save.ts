/**
 * El guardado automático del editor (F27): 1,5 s después del último cambio, con la `rev` del documento.
 *
 * El estado es una máquina pequeña y pura (la pantalla solo le pasa lo que pasó):
 *   guardado → (cambio) → con cambios → (1,5 s) → guardando → (ok) → guardado
 *                                                  ↘ (otra persona guardó antes) → conflicto: «Recargar»
 *                                                  ↘ (sin red) → sin conexión: se guarda al volver
 * Un cambio que llega MIENTRAS se guarda no se pierde: al terminar queda «con cambios» y se vuelve a guardar. Una `rev`
 * vieja responde `conflict` y la pantalla ofrece «Recargar»: nunca se pisa en silencio.
 *
 * Módulo puro.
 */

export const AUTOSAVE_DELAY_MS = 1500;

export type SaveStatus = "saved" | "dirty" | "saving" | "offline" | "conflict" | "error";

export interface SaveState {
  status: SaveStatus;
  /** La `rev` que tiene el servidor, hasta donde sabemos. */
  rev: number;
  /** Un cambio llegó mientras se guardaba: al terminar hay que volver a guardar. */
  pending: boolean;
  /** El motivo del último error (en español). */
  error: string | null;
}

export type SaveEvent =
  | { type: "edit" }
  | { type: "start" }
  | { type: "saved"; rev: number }
  | { type: "conflict" }
  | { type: "failed"; error: string; offline: boolean }
  | { type: "online" }
  | { type: "reloaded"; rev: number };

export function initialSaveState(rev: number): SaveState {
  return { status: "saved", rev, pending: false, error: null };
}

export function saveReducer(state: SaveState, event: SaveEvent): SaveState {
  switch (event.type) {
    case "edit":
      // Con un conflicto abierto no hay a dónde guardar: se queda hasta que la persona recargue.
      if (state.status === "conflict") return state;
      if (state.status === "saving") return { ...state, pending: true };
      return { ...state, status: "dirty", error: null };
    case "start":
      return state.status === "dirty" || state.status === "offline" || state.status === "error" ? { ...state, status: "saving", pending: false } : state;
    case "saved":
      return { status: state.pending ? "dirty" : "saved", rev: event.rev, pending: false, error: null };
    case "conflict":
      return { ...state, status: "conflict", pending: false, error: null };
    case "failed":
      return { ...state, status: event.offline ? "offline" : "error", pending: false, error: event.offline ? null : event.error };
    case "online":
      return state.status === "offline" ? { ...state, status: "dirty" } : state;
    case "reloaded":
      return initialSaveState(event.rev);
  }
}

/** Si hay que guardar ahora (programar el temporizador): solo con cambios, no mientras se guarda ni con un conflicto. */
export function needsSave(state: SaveState): boolean {
  return state.status === "dirty" || state.status === "error";
}

/** Si el navegador debe avisar antes de cerrar la pestaña (hay cambios que no llegaron al servidor). */
export function hasUnsavedChanges(state: SaveState): boolean {
  return state.status !== "saved";
}

/** Un error de red (sin conexión) se distingue de uno del servidor: el primero se reintenta solo al volver. */
export function isOfflineError(error: unknown, online: boolean): boolean {
  if (!online) return true;
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}
