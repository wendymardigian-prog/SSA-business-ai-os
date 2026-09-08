import { describe, it, expect, vi, afterEach } from "vitest";
import { describeAttachment, extractText, messageTimestamp } from "./evolution-message";

afterEach(() => vi.useRealTimers());

describe("extractText", () => {
  it("lee un texto suelto", () => {
    expect(extractText({ conversation: "hola, quiero info" })).toBe("hola, quiero info");
  });

  it("lee un texto con vista previa de link, que WhatsApp manda en otro lado", () => {
    expect(
      extractText({ extendedTextMessage: { text: "mira esto https://x.com" } })
    ).toBe("mira esto https://x.com");
  });

  it("lee el pie de una foto, un video y un documento", () => {
    expect(extractText({ imageMessage: { caption: "asi quedo" } })).toBe("asi quedo");
    expect(extractText({ videoMessage: { caption: "el before" } })).toBe("el before");
    expect(extractText({ documentMessage: { caption: "la propuesta" } })).toBe("la propuesta");
  });

  it("lee la respuesta a botones y a listas", () => {
    expect(
      extractText({ buttonsResponseMessage: { selectedDisplayText: "Quiero saber mas" } })
    ).toBe("Quiero saber mas");
    expect(extractText({ listResponseMessage: { title: "Plan Pro" } })).toBe("Plan Pro");
  });

  it("devuelve null cuando el mensaje es puro adjunto", () => {
    expect(extractText({ audioMessage: { seconds: 12 } })).toBeNull();
    expect(extractText({ stickerMessage: {} })).toBeNull();
    expect(extractText({})).toBeNull();
    expect(extractText(undefined)).toBeNull();
    expect(extractText(null)).toBeNull();
  });

  it("no se cae con una forma inesperada", () => {
    expect(extractText({ extendedTextMessage: "no es un objeto" })).toBeNull();
    expect(extractText({ conversation: "" })).toBeNull();
    expect(extractText({ conversation: 42 })).toBeNull();
  });
});

describe("describeAttachment", () => {
  it("da una etiqueta para que el preview no quede vacio", () => {
    expect(describeAttachment("imageMessage")).toBe("📷 Imagen");
    expect(describeAttachment("audioMessage")).toBe("🎤 Audio");
  });

  it("devuelve null para un tipo que no conocemos", () => {
    expect(describeAttachment("pollCreationMessage")).toBeNull();
    expect(describeAttachment(undefined)).toBeNull();
  });
});

describe("messageTimestamp", () => {
  it("convierte los segundos de Evolution a ISO", () => {
    expect(messageTimestamp(1767225600)).toBe("2026-01-01T00:00:00.000Z");
    expect(messageTimestamp("1767225600")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("ante un timestamp que no sirve usa el ahora, en vez de romper el orden de la bandeja", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T10:00:00Z"));
    for (const raw of [undefined, null, 0, "abc", ""]) {
      expect(messageTimestamp(raw as never)).toBe("2026-09-08T10:00:00.000Z");
    }
  });
});
