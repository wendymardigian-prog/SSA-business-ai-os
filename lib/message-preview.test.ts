import { describe, it, expect } from "vitest";
import { messagePreview, previewForMessage } from "./message-preview";

describe("messagePreview", () => {
  it("returns short text unchanged", () => {
    expect(messagePreview("hello")).toBe("hello");
  });

  it("handles null and undefined", () => {
    expect(messagePreview(null)).toBe("");
    expect(messagePreview(undefined)).toBe("");
  });

  it("never leaves a lone surrogate at the cut, which PostgREST rejects", () => {
    // 99 chars then an emoji, so a UTF-16 slice(0, 100) splits the pair.
    const text = "a".repeat(99) + "😀" + "tail";

    expect(text.slice(0, 100).isWellFormed()).toBe(false);
    expect(messagePreview(text).isWellFormed()).toBe(true);
  });

  it("counts emoji as one character rather than two", () => {
    expect(messagePreview("😀".repeat(120))).toBe("😀".repeat(100));
  });
});

describe("previewForMessage (F15)", () => {
  it("el texto gana: es lo que la persona escribio", () => {
    expect(previewForMessage({ text: "hola, queria el precio" })).toBe("hola, queria el precio");
  });

  it("sin texto pero con adjunto usa la etiqueta del tipo, en vez de dejar la fila vacia", () => {
    const voice = { v: 2, items: [{ kind: "voice", status: "ready", storagePath: "p" }] };
    expect(previewForMessage({ attachments: voice })).toBe("🎤 Nota de voz");

    const image = { v: 2, items: [{ kind: "image", status: "ready", storagePath: "p" }] };
    expect(previewForMessage({ attachments: image })).toBe("📷 Imagen");
  });

  it("la etiqueta tambien sale de los formatos viejos: una foto de Instagram ya guardada", () => {
    expect(previewForMessage({ attachments: [{ type: "image", url: "https://cdn/x.jpg" }] })).toBe("📷 Imagen");
    expect(previewForMessage({ attachments: { audioMessage: { ptt: true, seconds: 3 } } })).toBe("🎤 Nota de voz");
  });

  it("con transcripcion muestra lo que se dijo, que dice mas que la etiqueta", () => {
    const voice = { v: 2, items: [{ kind: "voice", status: "ready", storagePath: "p" }] };
    expect(previewForMessage({ attachments: voice, transcript: "hola, queria saber el precio" })).toBe(
      "hola, queria saber el precio",
    );
  });

  it("el caption gana sobre la transcripcion: lo que la persona escribio primero", () => {
    const voice = { v: 2, items: [{ kind: "voice", status: "ready", storagePath: "p" }] };
    expect(previewForMessage({ text: "mira esto", attachments: voice, transcript: "hola" })).toBe("mira esto");
  });

  it("una transcripcion larga se recorta como cualquier preview", () => {
    expect(previewForMessage({ transcript: "a".repeat(200) })).toHaveLength(100);
  });

  it("sin nada devuelve vacio, no undefined", () => {
    expect(previewForMessage({})).toBe("");
    expect(previewForMessage({ text: null, attachments: null })).toBe("");
  });
});
