/**
 * El texto efectivo de un mensaje (F9) y por que uno no se puede leer (F10).
 */

import { describe, it, expect } from "vitest";
import { emptyAttachment } from "@/lib/messages/attachments";
import { effectiveMessageText, unreadableReason } from "./effective-text";

const withItems = (...kinds: Parameters<typeof emptyAttachment>[0][]) => ({
  v: 2,
  items: kinds.map((kind) => emptyAttachment(kind, { status: "ready", storagePath: "p" })),
});

describe("effectiveMessageText: las cuatro ramas (F9)", () => {
  it("el texto propio se usa tal cual", () => {
    expect(effectiveMessageText({ text: "hola, queria el precio" })).toBe("hola, queria el precio");
  });

  it("una transcripcion lista entra MARCADA como nota de voz", () => {
    // El modelo tiene que saber que es un audio transcripto y no algo que el
    // lead escribio: son dos cosas distintas.
    expect(
      effectiveMessageText({
        transcript: "hola, queria saber el precio",
        transcript_status: "ready",
        attachments: withItems("voice"),
      }),
    ).toBe('[Nota de voz] "hola, queria saber el precio"');
  });

  it("un audio adjunto se marca como audio, no como nota de voz", () => {
    expect(
      effectiveMessageText({ transcript: "el reenvio", transcript_status: "ready", attachments: withItems("audio") }),
    ).toBe('[Audio] "el reenvio"');
  });

  it("una descripcion de imagen entra marcada como imagen", () => {
    expect(
      effectiveMessageText({ media_description: "Captura del comprobante de pago", attachments: withItems("image") }),
    ).toBe("[Imagen] Captura del comprobante de pago");
  });

  it("sin nada interpretable devuelve null: sigue quedando FUERA del historial", () => {
    expect(effectiveMessageText({})).toBeNull();
    expect(effectiveMessageText({ text: null, transcript: null, media_description: null })).toBeNull();
    expect(effectiveMessageText({ text: "   " })).toBeNull();
  });
});

describe("effectiveMessageText: la precedencia (F9)", () => {
  it("con texto Y transcripcion gana el TEXTO: es el caption, lo que la persona escribio", () => {
    expect(
      effectiveMessageText({
        text: "escuchá esto",
        transcript: "hola, queria el precio",
        transcript_status: "ready",
        attachments: withItems("voice"),
      }),
    ).toBe("escuchá esto");
  });

  it("con texto y descripcion tambien gana el texto", () => {
    expect(effectiveMessageText({ text: "mirá", media_description: "Una captura" })).toBe("mirá");
  });

  it("con transcripcion y descripcion gana la transcripcion", () => {
    expect(
      effectiveMessageText({
        transcript: "lo dije en el audio",
        transcript_status: "ready",
        media_description: "Una foto",
        attachments: withItems("voice"),
      }),
    ).toBe('[Nota de voz] "lo dije en el audio"');
  });

  it("una transcripcion que NO esta lista no se usa: el modelo no puede contestar sobre un audio que nadie escucho", () => {
    for (const status of ["pending", "failed", "none", null]) {
      expect(
        effectiveMessageText({ transcript: "texto a medias", transcript_status: status, attachments: withItems("voice") }),
      ).toBeNull();
    }
  });

  it("no se inventa un marcador para lo que no se entendio", () => {
    // Meter "[Nota de voz sin transcribir]" seria peor que no meter nada: el
    // modelo contestaria sobre un audio que no escucho.
    const result = effectiveMessageText({ transcript_status: "failed", attachments: withItems("voice") });
    expect(result).toBeNull();
  });
});

describe("effectiveMessageText: un reel o post compartido (FA2)", () => {
  const withShare = (meta: Record<string, unknown>) => ({
    v: 2,
    items: [emptyAttachment("share", { status: "none", meta })],
  });

  it("con titulo, un reel entra marcado y el agente lo lee sin escalar", () => {
    expect(
      effectiveMessageText({
        attachments: withShare({ url: "https://instagram.com/reel/abc", title: "Mira este lugar", shareType: "reel" }),
      }),
    ).toBe('[Reel compartido] "Mira este lugar"');
  });

  it("un post compartido usa su propia etiqueta", () => {
    expect(
      effectiveMessageText({ attachments: withShare({ url: "https://x", title: "Un posteo", shareType: "post" }) }),
    ).toBe('[Publicación compartida] "Un posteo"');
  });

  it("sin shareType cae en la etiqueta generica", () => {
    expect(effectiveMessageText({ attachments: withShare({ url: "https://x", title: "Algo" }) })).toBe(
      '[Publicación compartida] "Algo"',
    );
  });

  it("el titulo se recorta a 400 caracteres", () => {
    const title = "a".repeat(500);
    const result = effectiveMessageText({ attachments: withShare({ url: "https://x", title, shareType: "reel" }) });
    expect(result).toBe(`[Reel compartido] "${"a".repeat(400)}"`);
  });

  it("sin titulo no se inventa nada: un link solo no alcanza para responder", () => {
    expect(effectiveMessageText({ attachments: withShare({ url: "https://x" }) })).toBeNull();
  });
});

describe("effectiveMessageText: stickers y GIFs no escalan (FA7)", () => {
  it("un sticker solo se lee marcado, sin gastar una descripcion de vision", () => {
    expect(effectiveMessageText({ attachments: withItems("sticker") })).toBe("[Sticker]");
  });

  it("un GIF solo tambien", () => {
    expect(effectiveMessageText({ attachments: withItems("gif") })).toBe("[GIF]");
  });

  it("un sticker junto con algo ilegible no se etiqueta: la rafaga sigue siendo ilegible", () => {
    expect(effectiveMessageText({ attachments: withItems("sticker", "video") })).toBeNull();
  });
});

describe("unreadableReason: el motivo en castellano (F10)", () => {
  it("un mensaje que SI se entiende no tiene motivo", () => {
    expect(unreadableReason({ text: "hola" })).toBeNull();
    expect(
      unreadableReason({ transcript: "hola", transcript_status: "ready", attachments: withItems("voice") }),
    ).toBeNull();
  });

  it("una nota de voz que fallo, una que no termino y una sin transcribir dicen cosas distintas", () => {
    const voice = withItems("voice");
    expect(unreadableReason({ transcript_status: "failed", attachments: voice })).toBe(
      "Llegó una nota de voz que no se pudo transcribir",
    );
    expect(unreadableReason({ transcript_status: "pending", attachments: voice })).toBe(
      "Llegó una nota de voz y la transcripción no terminó a tiempo",
    );
    expect(unreadableReason({ transcript_status: "none", attachments: voice })).toBe(
      "Llegó una nota de voz sin transcribir",
    );
  });

  it("cada tipo tiene su motivo, y ninguno es un codigo", () => {
    expect(unreadableReason({ attachments: withItems("video") })).toBe(
      "Llegó un video, que el asistente no puede ver",
    );
    expect(unreadableReason({ attachments: withItems("document") })).toBe(
      "Llegó un documento, que el asistente no puede leer",
    );
    expect(unreadableReason({ attachments: withItems("location") })).toBe("Llegó una ubicación");
    expect(unreadableReason({ attachments: withItems("contact") })).toBe("Llegó un contacto compartido");
    expect(unreadableReason({ attachments: withItems("poll") })).toBe("Llegó una encuesta");
    expect(unreadableReason({ attachments: withItems("image") })).toBe(
      "Llegó una imagen que el asistente no pudo interpretar",
    );
    expect(unreadableReason({ attachments: withItems("story_reply") })).toContain("historia");
    expect(unreadableReason({ attachments: withItems("share") })).toContain("publicación compartida");
  });

  it("un tipo desconocido igual se nombra: la persona tiene que saber que llego", () => {
    const reason = unreadableReason({ attachments: withItems("unsupported") });
    expect(reason).toContain("no puede interpretar");
  });

  it("un mensaje sin texto y SIN adjuntos no es ilegible: no hay nada", () => {
    expect(unreadableReason({})).toBeNull();
  });

  it("un sticker solo no es ilegible (FA7): effectiveMessageText ya lo etiqueta", () => {
    expect(unreadableReason({ attachments: withItems("sticker") })).toBeNull();
  });

  it("un reel compartido CON titulo no es ilegible (FA2)", () => {
    expect(
      unreadableReason({
        attachments: { v: 2, items: [emptyAttachment("share", { status: "none", meta: { url: "https://x", title: "Hola", shareType: "reel" } })] },
      }),
    ).toBeNull();
  });
});
