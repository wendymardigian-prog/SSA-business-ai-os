/**
 * El estado del componente "Atribución" (plano F11) como funciones puras: el
 * componente solo compone. Lo comparten el paso 1 del asistente de venta (F18) y
 * la edición de la venta (F26).
 *
 * El estado es lo que viaja al servidor (`AttributionRequest`): el servidor
 * resuelve el resto al guardar (F22).
 */
import type { AttributionRequest, ManualAttributionInput } from "@/lib/attribution/attribution";
import type { ManualChoiceInput } from "./manual-channel";
import { suggestSaleTouch, type SuggestedTouch, type SuggestTouchInput } from "./suggest-touch";
import { shortDayMonth, touchTitle, NO_NAMES, type LabelableTouch, type TouchNames } from "@/lib/attribution/touch-label";

/**
 * "Cargar a mano" con canal (Extra I, F47): la eleccion de la persona. El SERVIDOR crea el toque al guardar la venta
 * y la atribuye a el. `label` es solo para mostrar ("Contenido orgánico · Instagram · Reel…").
 */
export interface ManualChannelState {
  mode: "manual_channel";
  choice: ManualChoiceInput;
  label?: string;
}

export type AttributionFieldState = AttributionRequest | ManualChannelState;

export const DEFAULT_ATTRIBUTION_STATE: AttributionFieldState = { mode: "last_touch" };

export function chooseTouch(touchId: string): AttributionFieldState {
  return { mode: "touch", touchId };
}

export function loadManually(manual: ManualAttributionInput): AttributionFieldState {
  return { mode: "manual", manual };
}

/** Cargar a mano con canal: lo que eligio la persona en el selector de dos pasos. */
export function loadChannelChoice(choice: ManualChoiceInput, label?: string): AttributionFieldState {
  return { mode: "manual_channel", choice, ...(label ? { label } : {}) };
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
  if (state.mode === "manual" || state.mode === "manual_channel") return "cargada a mano";
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

// ── La sugerencia de toque (Extra I, F46) ────────────────────────────────────

/**
 * El estado con el que arranca el componente cuando se cargan los toques del contacto: el ultimo toque, salvo que
 * ese sea un mensaje sin origen y haya uno anterior que si lo tiene (`suggestSaleTouch`). Entonces arranca en ESE.
 */
export function initialAttributionState(touches: readonly SuggestTouchInput[]): { state: AttributionFieldState; suggestion: SuggestedTouch | null } {
  const suggestion = suggestSaleTouch(touches);
  if (suggestion && suggestion.reason === "last_is_direct") return { state: chooseTouch(suggestion.touchId), suggestion };
  return { state: DEFAULT_ATTRIBUTION_STATE, suggestion };
}

export interface SuggestionNotice {
  /** `applied`: la sugerencia esta puesta y se puede volver al ultimo toque. `available`: se puede usar. */
  kind: "applied" | "available";
  /** La línea, en dos partes para poder poner el titulo en cursiva. */
  before: string;
  title: string;
  after: string;
  action: { label: string; to: "last_touch" | "suggested" };
}

/**
 * El aviso de la sugerencia. Solo hay aviso cuando el ultimo toque es directo y existe uno anterior con origen
 * (`last_is_direct`); en los otros casos no hay nada que decir.
 *
 *   - la sugerencia esta puesta ........ «El último toque fue un mensaje sin origen; te sugerimos *Reel…* del 3/10»
 *                                        con «Usar el último toque igual»
 *   - esta el ultimo toque (o el aviso
 *     se muestra sin auto-aplicar) ..... «El último toque fue un mensaje sin origen. Podés usar *Reel…* del 3/10…»
 *                                        con «Usar la sugerencia»
 */
export function suggestionNotice(params: {
  state: AttributionFieldState;
  suggestion: SuggestedTouch | null;
  touches: ReadonlyArray<SuggestTouchInput & LabelableTouch & { source?: string | null; medium?: string | null }>;
  timeZone: string;
  names?: TouchNames;
}): SuggestionNotice | null {
  const { state, suggestion, touches, timeZone } = params;
  if (!suggestion || suggestion.reason !== "last_is_direct") return null;
  const touch = touches.find((t) => t.id === suggestion.touchId);
  if (!touch) return null;

  const title = touchTitle(touch, params.names ?? NO_NAMES);
  const day = shortDayMonth(touch.occurred_at, timeZone);

  if (state.mode === "touch" && state.touchId === suggestion.touchId) {
    return {
      kind: "applied",
      before: "El último toque fue un mensaje sin origen; te sugerimos ",
      title,
      after: ` del ${day}.`,
      action: { label: "Usar el último toque igual", to: "last_touch" },
    };
  }
  if (state.mode === "last_touch") {
    return {
      kind: "available",
      before: "El último toque fue un mensaje sin origen. Podés usar ",
      title,
      after: ` del ${day}, que sí tiene origen.`,
      action: { label: "Usar la sugerencia", to: "suggested" },
    };
  }
  return null;
}
