import { describe, it, expect } from "vitest";
import {
  CLOSED_WIDGET,
  acceptanceFor,
  disabledKindsFor,
  isWidgetShortcut,
  opensBySlash,
  pickOutcome,
  textToRestoreOnClose,
  widgetReducer,
  widgetResults,
  widgetShortcutLabel,
} from "./asset-widget";
import { NO_FILTERS, type BankAsset } from "@/lib/response-assets/list";

function asset(over: Partial<BankAsset> & Pick<BankAsset, "id" | "kind" | "name">): BankAsset {
  return {
    shortcut: null, description: null, tags: [], content: null, url: null, linkKind: null, caption: null,
    storagePath: null, previewPath: null, mimeType: null, sizeBytes: null, durationSeconds: null,
    transcript: null, transcriptStatus: "none", transcriptError: null, agentEnabled: false, isActive: true,
    usageCount: 0, lastUsedAt: null, createdAt: null,
    ...over,
  };
}

const CONTEXT = { contact: { display_name: "Ana", email: null, phone: null }, workspace: { name: "SSA" } };

describe("widgetReducer", () => {
  it("abrir arranca en la lista, limpio, con lo que se escribio despues de la barra", () => {
    const dirty = { ...CLOSED_WIDGET, filters: { kind: "video" as const, tags: ["x"], query: "viejo" } };
    const state = widgetReducer(dirty, { type: "open", bySlash: true, query: "pre" });
    expect(state).toMatchObject({ view: "list", openedBySlash: true, activeIndex: 0, filters: { kind: "all", tags: [], query: "pre" } });
  });

  it("las flechas dan la vuelta, y cambiar un filtro vuelve al primero", () => {
    let state = widgetReducer(CLOSED_WIDGET, { type: "open", bySlash: false });
    state = widgetReducer(state, { type: "move", delta: -1, count: 3 });
    expect(state.activeIndex).toBe(2);
    state = widgetReducer(state, { type: "move", delta: 1, count: 3 });
    expect(state.activeIndex).toBe(0);
    state = widgetReducer(state, { type: "hover", index: 2 });
    state = widgetReducer(state, { type: "filters", filters: { ...NO_FILTERS, query: "x" } });
    expect(state.activeIndex).toBe(0);
  });

  it("sin resultados, moverse no rompe", () => {
    const state = widgetReducer({ ...CLOSED_WIDGET, view: "list", activeIndex: 4 }, { type: "move", delta: 1, count: 0 });
    expect(state.activeIndex).toBe(0);
  });

  it("del preview se vuelve a la lista sin perder la busqueda ni los filtros", () => {
    let state = widgetReducer(CLOSED_WIDGET, { type: "open", bySlash: false, query: "ana" });
    state = widgetReducer(state, { type: "filters", filters: { kind: "video", tags: ["testimonios"], query: "ana" } });
    state = widgetReducer(state, { type: "preview", assetId: "v1" });
    expect(state).toMatchObject({ view: "preview", previewId: "v1" });
    state = widgetReducer(state, { type: "back" });
    expect(state).toMatchObject({ view: "list", previewId: null, filters: { kind: "video", tags: ["testimonios"], query: "ana" } });
  });

  it("cerrar vuelve al estado cerrado", () => {
    const open = widgetReducer(CLOSED_WIDGET, { type: "open", bySlash: false });
    expect(widgetReducer(open, { type: "close" })).toEqual(CLOSED_WIDGET);
  });
});

describe("la barra", () => {
  it("se abre solo al escribir la barra al principio de un composer que no la tenia", () => {
    expect(opensBySlash("", "/")).toBe(true);
    expect(opensBySlash("", "/precio")).toBe(true); // pegado
    expect(opensBySlash("/pre", "/prec")).toBe(false);
    expect(opensBySlash("hola", "hola /")).toBe(false);
    expect(opensBySlash("", "https://x.com")).toBe(false);
  });

  it("cerrar con Escape devuelve la barra y lo buscado, solo si se abrio con la barra", () => {
    const bySlash = widgetReducer(CLOSED_WIDGET, { type: "open", bySlash: true, query: "pre" });
    expect(textToRestoreOnClose(bySlash)).toBe("/pre");
    const byButton = widgetReducer(CLOSED_WIDGET, { type: "open", bySlash: false, query: "pre" });
    expect(textToRestoreOnClose(byButton)).toBeNull();
    expect(textToRestoreOnClose(CLOSED_WIDGET)).toBeNull();
  });
});

describe("pickOutcome: Enter nunca manda", () => {
  it("un texto se inserta interpolado", () => {
    const text = asset({ id: "t", kind: "text", name: "x", content: "Hola {{contact.display_name}}, soy de {{workspace.name}}" });
    expect(pickOutcome(text, "evolution", CONTEXT)).toEqual({ type: "insert", text: "Hola Ana, soy de SSA" });
  });

  it("un enlace inserta la URL, tambien por email", () => {
    const link = asset({ id: "l", kind: "link", name: "x", url: "https://cal.com/a" });
    expect(pickOutcome(link, "resend", CONTEXT)).toEqual({ type: "insert", text: "https://cal.com/a" });
  });

  it("los cuatro tipos con archivo abren el preview", () => {
    for (const kind of ["audio", "video", "image", "file"] as const) {
      const item = asset({ id: kind, kind, name: "x", mimeType: kind === "audio" ? "audio/ogg" : "x/y" });
      expect(pickOutcome(item, "evolution", CONTEXT), kind).toEqual({ type: "preview" });
    }
  });

  it("lo que el canal no acepta queda bloqueado con el motivo", () => {
    const pdf = asset({ id: "f", kind: "file", name: "x", mimeType: "application/pdf" });
    expect(pickOutcome(pdf, "zernio", CONTEXT)).toMatchObject({ type: "blocked", reason: expect.stringMatching(/Instagram no acepta archivos/) });
    const ogg = asset({ id: "a", kind: "audio", name: "x", mimeType: "audio/ogg" });
    expect(pickOutcome(ogg, "zernio", CONTEXT)).toMatchObject({ type: "blocked" });
    const m4a = asset({ id: "a2", kind: "audio", name: "x", mimeType: "audio/mp4" });
    expect(pickOutcome(m4a, "zernio", CONTEXT)).toEqual({ type: "preview" });
  });
});

describe("lo que muestra", () => {
  it("los chips deshabilitados de cada canal", () => {
    expect(Object.keys(disabledKindsFor("resend")).sort()).toEqual(["audio", "file", "image", "video"]);
    expect(Object.keys(disabledKindsFor("zernio"))).toEqual(["file"]);
  });

  it("acceptanceFor mira el formato solo de lo que tiene archivo", () => {
    expect(acceptanceFor({ kind: "text", mimeType: null }, "zernio").ok).toBe(true);
    expect(acceptanceFor({ kind: "audio", mimeType: "audio/mpeg" }, "zernio").ok).toBe(false);
  });

  it("solo los activos, con los filtros aplicados", () => {
    const list = [
      asset({ id: "a", kind: "text", name: "Activo", content: "x" }),
      asset({ id: "b", kind: "text", name: "Inactivo", content: "x", isActive: false }),
    ];
    expect(widgetResults(list, NO_FILTERS).map((a) => a.id)).toEqual(["a"]);
  });

  it("el atajo y su texto", () => {
    expect(isWidgetShortcut({ key: "/", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isWidgetShortcut({ key: "/", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isWidgetShortcut({ key: "/", metaKey: false, ctrlKey: false })).toBe(false);
    expect(widgetShortcutLabel("MacIntel")).toBe("⌘ /");
    expect(widgetShortcutLabel("Win32")).toBe("Ctrl + /");
  });
});
