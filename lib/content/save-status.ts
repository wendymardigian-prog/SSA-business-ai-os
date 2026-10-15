/**
 * Lo que dice el drawer sobre el guardado, todo el tiempo.
 *
 * Antes "Guardado ✓" duraba 1,5 segundos y despues volvia a "Se guarda solo":
 * quien miraba justo en otro momento no sabia si lo ultimo que escribio estaba
 * a salvo. Ahora hay SIEMPRE un estado a la vista, y es uno de cuatro:
 *
 *   saving   se esta guardando ahora mismo
 *   error    el ultimo guardado fallo y hay cambios que no estan a salvo
 *   unsaved  hay cambios escritos que todavia no se mandaron
 *   saved    todo lo que se escribio esta guardado
 *
 * El orden de prioridad es ese mismo: un error nunca se tapa con "Guardando…",
 * y "Guardado" solo aparece cuando de verdad no queda nada pendiente.
 *
 * Puro: sin React ni reloj, para poder probarlo.
 */

export type SaveState = "saved" | "saving" | "unsaved" | "error";

export interface SaveStatusInput {
  /** Hay cambios escritos que todavia no estan en el servidor. */
  dirty: boolean;
  /** Hay un guardado en vuelo. */
  saving: boolean;
  /** El ultimo guardado fallo (y no hubo uno bueno despues). */
  failed: boolean;
}

export function deriveSaveState({ dirty, saving, failed }: SaveStatusInput): SaveState {
  if (saving) return "saving";
  if (failed) return "error";
  if (dirty) return "unsaved";
  return "saved";
}

export interface SaveStatusView {
  state: SaveState;
  /** Lo que se lee. */
  label: string;
  /** Mas detalle, para el tooltip. */
  title: string;
  /** Ofrece un boton de "Reintentar". */
  canRetry: boolean;
}

const VIEWS: Record<SaveState, Omit<SaveStatusView, "state">> = {
  saved: {
    label: "Guardado",
    title: "Todos los cambios están guardados.",
    canRetry: false,
  },
  saving: {
    label: "Guardando…",
    title: "Guardando los cambios.",
    canRetry: false,
  },
  unsaved: {
    label: "Cambios sin guardar",
    title: "Se guardan solos en unos segundos, o al salir del campo.",
    canRetry: false,
  },
  error: {
    label: "No se pudo guardar",
    title: "Lo último que escribiste no está guardado. Probá de nuevo.",
    canRetry: true,
  },
};

export function saveStatusView(input: SaveStatusInput): SaveStatusView {
  const state = deriveSaveState(input);
  return { state, ...VIEWS[state] };
}

/**
 * Cuanto se espera despues del ultimo cambio antes de guardar solo.
 *
 * Los campos de texto se guardan al salir (blur) y los selectores al elegir;
 * esto es la red de seguridad para quien escribe un buen rato sin salir del
 * campo: lo escrito nunca queda mas que unos segundos sin guardar.
 */
export const AUTOSAVE_IDLE_MS = 2_500;
