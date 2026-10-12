/**
 * El estado del componente "Atribución" (plano F11) como funciones puras: el
 * componente solo compone. Lo comparten el paso 1 del asistente de venta (F18) y
 * la edición de la venta (F26).
 *
 * El estado es lo que viaja al servidor (`AttributionRequest`): el servidor
 * resuelve el resto al guardar (F22).
 */
import type { AttributionRequest, ManualAttributionInput } from "./attribution";

export type AttributionFieldState = AttributionRequest;

export const DEFAULT_ATTRIBUTION_STATE: AttributionFieldState = { mode: "last_touch" };

export function chooseTouch(touchId: string): AttributionFieldState {
  return { mode: "touch", touchId };
}

export function loadManually(manual: ManualAttributionInput): AttributionFieldState {
  return { mode: "manual", manual };
}

/** "Volver al último toque" restaura el modo por defecto. */
export function backToLastTouch(): AttributionFieldState {
  return DEFAULT_ATTRIBUTION_STATE;
}

export type AttributionPanel = "touches" | "manual";

/** Sin toques, la lista no se ofrece: el panel abre directo en "Cargar a mano". */
export function initialPanel(touchCount: number): AttributionPanel {
  return touchCount > 0 ? "touches" : "manual";
}

/** El texto de qué modo está activo, para la línea "Atribución: …". */
export function modeLead(state: AttributionFieldState, hasTouches: boolean): string {
  if (state.mode === "touch") return "elegida del historial";
  if (state.mode === "manual") return "cargada a mano";
  return hasTouches ? "último toque" : "sin toques";
}

/** Un formulario manual vacío para empezar. */
export const EMPTY_MANUAL: { source: string; medium: string; campaign: string; content: string; term: string } = {
  source: "",
  medium: "",
  campaign: "",
  content: "",
  term: "",
};
