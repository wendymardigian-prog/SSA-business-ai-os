/**
 * El widget de recursos de la bandeja (banca v2, F7-F9), como funciones
 * puras: su estado, como se mueve con el teclado y que pasa al elegir un
 * recurso. El componente (components/inbox/asset-picker.tsx) solo lo dibuja.
 *
 * Se abre de tres formas y es SIEMPRE el mismo componente: escribiendo "/"
 * en el composer vacio, con el boton de la biblioteca, o con ⌘/Ctrl + /. Si
 * fueran dos widgets, uno se quedaria atras del otro.
 *
 * **Se abre siempre, con la banca vacia tambien.** Antes la condicion exigia
 * al menos un recurso y por eso la funcion era invisible: con cero recursos
 * el "/" no hacia nada y nadie descubria que existia.
 *
 * **Enter nunca manda.** Con un texto o un enlace inserta en el campo de
 * escritura (editable); con los cuatro tipos con archivo abre el preview, y
 * mandar es un clic explicito en Enviar.
 */

import { channelAccepts, rejectedKinds, type ChannelAcceptance } from "@/lib/channels/media";
import { interpolateTemplate, type TemplateContext } from "@/lib/templates/interpolate";
import { applyFilters, NO_FILTERS, type AssetFilters, type BankAsset } from "@/lib/response-assets/list";
import { hasFile, type AssetKind } from "@/lib/response-assets/kind";

export interface WidgetState {
  view: "closed" | "list" | "preview";
  previewId: string | null;
  filters: AssetFilters;
  activeIndex: number;
  /** Se abrio escribiendo "/": al cerrarlo con Escape, la barra vuelve al composer. */
  openedBySlash: boolean;
}

export const CLOSED_WIDGET: WidgetState = {
  view: "closed",
  previewId: null,
  filters: NO_FILTERS,
  activeIndex: 0,
  openedBySlash: false,
};

export type WidgetAction =
  | { type: "open"; bySlash: boolean; query?: string }
  | { type: "close" }
  | { type: "filters"; filters: AssetFilters }
  | { type: "move"; delta: 1 | -1; count: number }
  | { type: "hover"; index: number }
  | { type: "preview"; assetId: string }
  | { type: "back" };

export function widgetReducer(state: WidgetState, action: WidgetAction): WidgetState {
  switch (action.type) {
    case "open":
      return {
        view: "list",
        previewId: null,
        // Abrir de nuevo arranca limpio: los filtros de la vez anterior
        // esconderian recursos sin que la persona sepa por que.
        filters: { ...NO_FILTERS, query: action.query ?? "" },
        activeIndex: 0,
        openedBySlash: action.bySlash,
      };
    case "close":
      return CLOSED_WIDGET;
    case "filters":
      return { ...state, filters: action.filters, activeIndex: 0 };
    case "move":
      if (action.count <= 0) return { ...state, activeIndex: 0 };
      return { ...state, activeIndex: (state.activeIndex + action.delta + action.count) % action.count };
    case "hover":
      return { ...state, activeIndex: action.index };
    case "preview":
      return { ...state, view: "preview", previewId: action.assetId };
    case "back":
      // Volver a la lista conserva la busqueda, los filtros y donde estaba.
      return { ...state, view: "list", previewId: null };
  }
}

/** Lo que va al composer al cerrar: la barra y lo buscado, si se abrio con "/" y se cerro sin elegir. */
export function textToRestoreOnClose(state: WidgetState): string | null {
  if (!state.openedBySlash || state.view === "closed") return null;
  return `/${state.filters.query}`;
}

/**
 * Si este canal puede mandar ESTE recurso (el tipo y, para un audio en
 * Instagram, el formato). Es la misma pregunta que se hace la API al mandar.
 */
export function acceptanceFor(asset: Pick<BankAsset, "kind" | "mimeType">, provider: string | null | undefined): ChannelAcceptance {
  return channelAccepts(provider, asset.kind, hasFile(asset.kind) ? asset.mimeType : undefined);
}

/** Los chips de tipo que se muestran deshabilitados en este canal, con su motivo. */
export function disabledKindsFor(provider: string | null | undefined): Partial<Record<AssetKind, string>> {
  return rejectedKinds(provider);
}

/** Los resultados del widget: solo activos, con los filtros aplicados. */
export function widgetResults(assets: BankAsset[], filters: AssetFilters): BankAsset[] {
  return applyFilters(
    assets.filter((a) => a.isActive),
    filters,
  );
}

export type PickOutcome =
  | { type: "insert"; text: string }
  | { type: "preview" }
  | { type: "blocked"; reason: string };

/**
 * Que pasa al elegir un recurso (Enter o clic):
 *  - texto  -> se inserta interpolado (con el contacto y el negocio reales)
 *  - enlace -> se inserta la URL
 *  - con archivo -> se abre el preview; nunca se manda directo
 *  - lo que el canal no acepta -> nada, con el motivo
 */
export function pickOutcome(
  asset: Pick<BankAsset, "kind" | "content" | "url" | "mimeType">,
  provider: string | null | undefined,
  context: TemplateContext,
): PickOutcome {
  const acceptance = acceptanceFor(asset, provider);
  if (!acceptance.ok) return { type: "blocked", reason: acceptance.reason };
  if (asset.kind === "text") return { type: "insert", text: interpolateTemplate(asset.content ?? "", context) };
  if (asset.kind === "link") return { type: "insert", text: asset.url ?? "" };
  return { type: "preview" };
}

/**
 * Si un texto en el composer arranca la apertura por "/": solo cuando la
 * barra se escribe AL PRINCIPIO de un composer que no la tenia. Asi, despues
 * de cerrar con Escape (que devuelve "/algo" al campo), seguir escribiendo no
 * lo vuelve a abrir: hay quien de verdad quiere escribir una barra.
 */
export function opensBySlash(previous: string, next: string): boolean {
  return !previous.startsWith("/") && next.startsWith("/");
}

/** ⌘/Ctrl + / abre el widget desde cualquier lugar de la conversacion. */
export function isWidgetShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey?: boolean }): boolean {
  return event.key === "/" && (event.metaKey || event.ctrlKey) && !event.altKey;
}

/** El texto del atajo para el tooltip, segun la plataforma. */
export function widgetShortcutLabel(platform: string | null | undefined): string {
  return /mac|iphone|ipad/i.test(platform ?? "") ? "⌘ /" : "Ctrl + /";
}
