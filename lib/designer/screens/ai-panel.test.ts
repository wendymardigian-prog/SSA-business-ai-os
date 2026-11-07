import { describe, expect, it } from "vitest";
import type { PanelMessage } from "../ai/action-types";
import { actionErrorText, bubbleFor, checkPickedImage, composerState, isWaiting, keyAction, newlyApplied, normalizeScope, pollDelayMs, proposalStatusLabel, scopeOptions, suggestionsFor, toAttachment } from "./ai-panel";

const msg = (over: Partial<PanelMessage> = {}): PanelMessage => ({ id: "m1", role: "assistant", content: "Listo", createdAt: "2026-11-07T12:00:00Z", attachments: [], scopePage: null, changedPages: [], summary: null, warnings: [], proposal: null, pending: false, error: null, ...over });

describe("screens/ai-panel: sugerencias según el formato (F31)", () => {
  it("un carrusel: portada, láminas y textos más cortos", () => {
    expect(suggestionsFor({ format: "v45", isTemplate: false, pageCount: 5 })).toEqual(["Hacé la portada más llamativa", "Agregá 2 láminas más", "Acortá los textos"]);
  });
  it("una pieza de una página", () => {
    expect(suggestionsFor({ format: "sq", isTemplate: false, pageCount: 1 })).toEqual(["Probá otra paleta", "Más grande el título"]);
  });
  it("un certificado (plantilla impresa)", () => {
    expect(suggestionsFor({ format: "carta_h", isTemplate: true, pageCount: 1 })).toContain("Más espacio para nombres largos");
  });
  it("una página web y un documento impreso tienen las suyas", () => {
    expect(suggestionsFor({ format: "web", isTemplate: false, pageCount: 1 })[0]).toMatch(/testimonios/);
    expect(suggestionsFor({ format: "a4_v", isTemplate: false, pageCount: 3 })).toContain("Probá otra tipografía");
  });
  it("todos los formatos tienen al menos dos sugerencias", () => {
    for (const format of ["carta_v", "carta_h", "a4_v", "a4_h", "sq", "v45", "story", "wide", "web"] as const) {
      for (const isTemplate of [false, true]) expect(suggestionsFor({ format, isTemplate, pageCount: 3 }).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("screens/ai-panel: «Sobre: Todo / Solo la página N»", () => {
  it("con varias páginas ofrece las dos", () => {
    expect(scopeOptions(2, 5)).toEqual([
      { value: null, label: "Todo" },
      { value: 2, label: "Solo la página 3" },
    ]);
  });
  it("con una sola no hay nada que elegir", () => {
    expect(scopeOptions(0, 1)).toEqual([{ value: null, label: "Todo" }]);
  });
  it("si la página elegida ya no existe, vuelve a «Todo»", () => {
    expect(normalizeScope(3, 5)).toBe(3);
    expect(normalizeScope(7, 5)).toBeNull();
    expect(normalizeScope(null, 5)).toBeNull();
  });
});

describe("screens/ai-panel: el teclado del campo", () => {
  it("Enter envía y Shift+Enter hace una línea nueva", () => {
    expect(keyAction({ key: "Enter", shiftKey: false })).toBe("send");
    expect(keyAction({ key: "Enter", shiftKey: true })).toBe("newline");
  });
  it("no envía mientras se compone un acento ni con Ctrl o Cmd; otras teclas no hacen nada", () => {
    expect(keyAction({ key: "Enter", shiftKey: false, isComposing: true })).toBe("none");
    expect(keyAction({ key: "Enter", shiftKey: false, metaKey: true })).toBe("none");
    expect(keyAction({ key: "a", shiftKey: false })).toBe("none");
  });
});

describe("screens/ai-panel: cuándo se puede enviar", () => {
  const base = { text: "Más grande", attachments: 0, busy: false, uploading: false, aiConnected: true };
  it("con texto o con una imagen sí", () => {
    expect(composerState(base)).toEqual({ canSend: true });
    expect(composerState({ ...base, text: "  ", attachments: 1 })).toEqual({ canSend: true });
  });
  it("vacío no, y sin motivo que mostrar", () => {
    expect(composerState({ ...base, text: "  " })).toEqual({ canSend: false, reason: null });
  });
  it("sin IA conectada dice «Conectá una clave de IA en Configuración»", () => {
    expect(composerState({ ...base, aiConnected: false })).toEqual({ canSend: false, reason: "Conectá una clave de IA en Configuración" });
  });
  it("mientras trabaja o sube una imagen, espera", () => {
    expect(composerState({ ...base, busy: true })).toMatchObject({ canSend: false, reason: "La IA está trabajando" });
    expect(composerState({ ...base, uploading: true })).toMatchObject({ canSend: false });
  });
});

describe("screens/ai-panel: imágenes adjuntas", () => {
  it("acepta PNG, JPG y WebP de hasta 20 MB y hasta 5 por pedido", () => {
    expect(checkPickedImage({ type: "image/png", size: 1000, name: "a.png" }, 0)).toBeNull();
    expect(checkPickedImage({ type: "image/jpeg", size: 1000, name: "a.jpg" }, 4)).toBeNull();
    expect(checkPickedImage({ type: "image/webp", size: 1000, name: "a.webp" }, 0)).toBeNull();
    expect(checkPickedImage({ type: "image/png", size: 1000, name: "a.png" }, 5)).toMatch(/hasta 5/);
    expect(checkPickedImage({ type: "image/svg+xml", size: 10, name: "a.svg" }, 0)).toBe("Usá PNG o JPG (también WebP).");
    expect(checkPickedImage({ type: "image/png", size: 21 * 1024 * 1024, name: "a.png" }, 0)).toMatch(/20 MB/);
  });
  it("arma el adjunto desde lo que devolvió la subida", () => {
    expect(toAttachment({ path: "ws/images/x.png", name: "x.png", mime: "image/png" })).toEqual({ asset_path: "ws/images/x.png", name: "x.png", mime: "image/png" });
  });
});

describe("screens/ai-panel: cómo se dibuja cada mensaje", () => {
  it("el pedido de la persona muestra el alcance y los nombres de las imágenes", () => {
    const b = bubbleFor(msg({ role: "user", content: "Usá esta foto", scopePage: 2, attachments: [{ asset_path: "p", name: "foto.png", mime: "image/png" }] }));
    expect(b).toMatchObject({ kind: "user", scopeLabel: "Sobre la página 3", attachmentNames: ["foto.png"], did: null });
  });
  it("una respuesta muestra «qué cambió» y los avisos de la revisión", () => {
    const b = bubbleFor(msg({ summary: "Cambió la página 3", warnings: ["La página 3 tiene poco contraste: subí la capa de color."] }));
    expect(b).toMatchObject({ kind: "assistant", did: "Cambió la página 3" });
    expect(b.warnings).toHaveLength(1);
  });
  it("una respuesta que fue un error se ve como error", () => {
    expect(bubbleFor(msg({ content: "No pude aplicar ese cambio", error: "No pude aplicar ese cambio" })).kind).toBe("error");
  });
  it("las propuestas respondidas dicen cómo quedaron", () => {
    expect(proposalStatusLabel("pending")).toBeNull();
    expect(proposalStatusLabel("accepted")).toBe("Hecho");
    expect(proposalStatusLabel("declined")).toBe("Lo dejé como estaba");
  });
});

describe("screens/ai-panel: esperar la respuesta y avisar al editor", () => {
  it("mientras hay un pedido pendiente, espera", () => {
    expect(isWaiting([msg(), msg({ role: "user", pending: true })])).toBe(true);
    expect(isWaiting([msg()])).toBe(false);
  });
  it("mira cada 2,5 s al principio y cada vez menos seguido si tarda", () => {
    expect(pollDelayMs(0)).toBe(2500);
    expect(pollDelayMs(90_000)).toBe(5000);
    expect(pollDelayMs(10 * 60_000)).toBe(15_000);
  });
  it("el editor se entera solo de las respuestas nuevas que guardaron cambios", () => {
    const old = msg({ id: "viejo", changedPages: [0] });
    const nueva = msg({ id: "nueva", changedPages: [2] });
    const soloComentario = msg({ id: "otra", changedPages: [] });
    const error = msg({ id: "error", changedPages: [], error: "boom" });
    const user = msg({ id: "u", role: "user" });
    expect(newlyApplied(new Set(["viejo"]), [old, nueva, soloComentario, error, user]).map((m) => m.id)).toEqual(["nueva"]);
    expect(newlyApplied(new Set(["viejo", "nueva"]), [old, nueva])).toEqual([]);
  });
  it("traduce un error de tamaño del servidor", () => {
    expect(actionErrorText(new Error("Body exceeded 1 MB limit"))).toMatch(/pesa más de lo que admite/);
    expect(actionErrorText(new Error("cualquier cosa"))).toBe("No pude hacerlo ahora. Probá de nuevo.");
    expect(actionErrorText("x")).toBe("No pude hacerlo ahora. Probá de nuevo.");
  });
});
