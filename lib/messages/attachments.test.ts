/**
 * El esquema normalizado de adjuntos (F1).
 *
 * Lo central: el lector nuevo tiene que entender los CUATRO formatos viejos sin
 * backfill. El de email es el que mas importa, porque es el unico que hoy
 * funciona bien y no se puede romper.
 */

import { describe, it, expect } from "vitest";
import {
  ATTACHMENTS_VERSION,
  EMAIL_BUCKET_MARKER,
  attachmentLabel,
  attachmentsLabel,
  emptyAttachment,
  fromBaileysMessage,
  fromZernioAttachments,
  kindForMime,
  normalizeMime,
  parseAttachments,
  sharedPostsInText,
  storyReplyAttachment,
  toAttachmentsColumn,
  unwrapBaileysMessage,
} from "./attachments";
import { LEGACY_BAILEYS, LEGACY_EMAIL, LEGACY_FLOW, LEGACY_ZERNIO } from "./attachments-legacy.test";

describe("parseAttachments: los cuatro formatos viejos (F1)", () => {
  it("email: devuelve un document listo, con el mismo path y su bucket", () => {
    const [item] = parseAttachments(LEGACY_EMAIL);

    expect(item).toMatchObject({
      kind: "document",
      storagePath: "ws-1/email-1/0-guia.pdf",
      mime: "application/pdf",
      filename: "guia.pdf",
      sizeBytes: 2048,
      status: "ready",
    });
    // Los adjuntos de email viven en otro bucket: la burbuja tiene que firmar
    // ahi y no en chat-media.
    expect(item.meta).toEqual({ bucket: EMAIL_BUCKET_MARKER });
  });

  it("email: uno sin path se descarta, igual que hoy", () => {
    expect(parseAttachments({ files: [{ filename: "roto.pdf" }] })).toEqual([]);
  });

  it("Zernio: una imagen queda con su URL de respaldo y sin path propio", () => {
    const [item] = parseAttachments(LEGACY_ZERNIO);

    expect(item).toMatchObject({
      kind: "image",
      sourceUrl: "https://cdn.meta/x.jpg",
      storagePath: null,
      // Hay algo que bajar: queda pendiente hasta que se baje.
      status: "pending",
    });
  });

  it("Baileys: una nota de voz queda con su duracion y su mime sin parametros", () => {
    const [item] = parseAttachments(LEGACY_BAILEYS);

    expect(item).toMatchObject({
      kind: "voice",
      durationSeconds: 12,
      mime: "audio/ogg",
      status: "pending",
    });
  });

  it("lo que registra un flow al enviar se lee como el array de Zernio", () => {
    const [item] = parseAttachments(LEGACY_FLOW);
    expect(item).toMatchObject({ kind: "image", sourceUrl: LEGACY_FLOW[0].url });
  });

  it("con null, {} o basura devuelve [] y no lanza", () => {
    expect(parseAttachments(null)).toEqual([]);
    expect(parseAttachments(undefined)).toEqual([]);
    expect(parseAttachments({})).toEqual([]);
    expect(parseAttachments([])).toEqual([]);
    expect(parseAttachments("texto")).toEqual([]);
    expect(parseAttachments(42)).toEqual([]);
    expect(parseAttachments({ files: "texto" })).toEqual([]);
    expect(parseAttachments([{ sin: "tipo" }])).toEqual([]);
    expect(parseAttachments({ nodoDesconocido: { x: 1 } })).toEqual([]);
  });
});

describe("parseAttachments: la forma nueva", () => {
  it("lee los items tal como se guardaron", () => {
    const items = [
      emptyAttachment("voice", {
        storagePath: "ws-1/cv-1/m-1-0.ogg",
        mime: "audio/ogg",
        durationSeconds: 8,
        sizeBytes: 4096,
        status: "ready",
      }),
    ];

    expect(parseAttachments({ v: ATTACHMENTS_VERSION, items })).toEqual(items);
  });

  it("un item sin kind conocido se descarta sin tirar el resto", () => {
    const parsed = parseAttachments({
      v: ATTACHMENTS_VERSION,
      items: [{ kind: "inventado" }, { kind: "image", status: "ready", storagePath: "p" }],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0].kind).toBe("image");
  });

  it("un status invalido cae en none: nunca deja un spinner girando para siempre", () => {
    const [item] = parseAttachments({ v: ATTACHMENTS_VERSION, items: [{ kind: "image", status: "cualquiera" }] });
    expect(item.status).toBe("none");
  });

  it("toAttachmentsColumn envuelve, y con la lista vacia guarda null", () => {
    expect(toAttachmentsColumn([])).toBeNull();
    expect(toAttachmentsColumn([emptyAttachment("image")])).toEqual({
      v: ATTACHMENTS_VERSION,
      items: [emptyAttachment("image")],
    });
  });
});

describe("Zernio", () => {
  it("un archivo generico es un documento", () => {
    expect(fromZernioAttachments([{ type: "file", url: "https://cdn/x.pdf" }])[0].kind).toBe("document");
  });

  it("un post compartido no se intenta descargar: es un link", () => {
    const [item] = fromZernioAttachments([{ type: "share", url: "https://instagram.com/p/abc" }]);

    expect(item).toMatchObject({ kind: "share", status: "none", sourceUrl: null });
    expect(item.meta).toEqual({ url: "https://instagram.com/p/abc" });
  });

  it("un tipo desconocido con URL entra como unsupported, no se pierde", () => {
    expect(fromZernioAttachments([{ type: "loquesea", url: "https://cdn/x" }])[0].kind).toBe("unsupported");
  });

  it("un tipo desconocido sin URL no entra", () => {
    expect(fromZernioAttachments([{ type: "loquesea" }])).toEqual([]);
  });
});

describe("las URLs de posts de Instagram que vienen en el texto (F3)", () => {
  it("un reel compartido se convierte en una tarjeta con link", () => {
    const [item] = sharedPostsInText("mira esto https://www.instagram.com/reel/Cxyz123_-/ que te parece");

    expect(item).toMatchObject({ kind: "share", status: "none" });
    expect(item.meta).toEqual({ url: "https://www.instagram.com/reel/Cxyz123_-" });
  });

  it("toma /p/, /reel/ y /tv/", () => {
    const urls = sharedPostsInText(
      "https://instagram.com/p/aaa https://instagram.com/reel/bbb https://instagram.com/tv/ccc",
    ).map((i) => (i.meta as { url: string }).url);

    expect(urls).toEqual([
      "https://instagram.com/p/aaa",
      "https://instagram.com/reel/bbb",
      "https://instagram.com/tv/ccc",
    ]);
  });

  it("el mismo link dos veces es una sola tarjeta", () => {
    expect(sharedPostsInText("https://instagram.com/p/aaa y de nuevo https://instagram.com/p/aaa/")).toHaveLength(1);
  });

  it("un link que no es de un post no entra", () => {
    expect(sharedPostsInText("https://instagram.com/minegocio")).toEqual([]);
    expect(sharedPostsInText("hola")).toEqual([]);
    expect(sharedPostsInText(null)).toEqual([]);
  });
});

describe("la respuesta a una historia (F3)", () => {
  it("guarda el id y la URL de la historia, que hoy se descartan", () => {
    const item = storyReplyAttachment({ storyId: "st-1", storyUrl: "https://cdn/story.jpg" });

    expect(item).toMatchObject({ kind: "story_reply", status: "none" });
    expect(item?.meta).toEqual({ storyId: "st-1", storyUrl: "https://cdn/story.jpg" });
  });

  it("sin datos no inventa un adjunto", () => {
    expect(storyReplyAttachment(null)).toBeNull();
    expect(storyReplyAttachment({})).toBeNull();
  });
});

describe("Baileys", () => {
  it("una imagen con caption devuelve el adjunto: el caption no lo tapa", () => {
    const items = fromBaileysMessage({
      imageMessage: { mimetype: "image/jpeg", caption: "mira esto", fileLength: "40213" },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "image", mime: "image/jpeg", sizeBytes: 40213, status: "pending" });
  });

  it("un audio sin ptt es audio; con ptt es nota de voz", () => {
    expect(fromBaileysMessage({ audioMessage: { mimetype: "audio/mp4", seconds: 30 } })[0].kind).toBe("audio");
    expect(fromBaileysMessage({ audioMessage: { mimetype: "audio/ogg", seconds: 30, ptt: true } })[0].kind).toBe("voice");
  });

  it("un video con gifPlayback es un GIF: WhatsApp los manda como mp4 corto", () => {
    expect(fromBaileysMessage({ videoMessage: { mimetype: "video/mp4", gifPlayback: true } })[0].kind).toBe("gif");
  });

  it("una ubicacion no se intenta descargar y guarda sus coordenadas", () => {
    const [item] = fromBaileysMessage({
      locationMessage: { degreesLatitude: -34.6, degreesLongitude: -58.4, name: "Obelisco" },
    });

    expect(item).toMatchObject({ kind: "location", status: "none" });
    expect(item.meta).toEqual({ lat: -34.6, lon: -58.4, name: "Obelisco" });
  });

  it("un contacto y una encuesta tampoco se descargan", () => {
    expect(fromBaileysMessage({ contactMessage: { displayName: "Juan" } })[0]).toMatchObject({
      kind: "contact",
      status: "none",
    });

    const [poll] = fromBaileysMessage({
      pollCreationMessage: { name: "Que dia te queda?", options: [{ optionName: "Lunes" }, { optionName: "Martes" }] },
    });
    expect(poll).toMatchObject({ kind: "poll", status: "none" });
    expect(poll.meta).toEqual({ name: "Que dia te queda?", options: ["Lunes", "Martes"] });
  });

  it("un mensaje de texto no es un adjunto", () => {
    expect(fromBaileysMessage({ conversation: "hola" })).toEqual([]);
    expect(fromBaileysMessage({ extendedTextMessage: { text: "hola" } })).toEqual([]);
  });

  it("un nodo de protocolo no es un adjunto: si no, el spinner queda girando", () => {
    expect(fromBaileysMessage({ protocolMessage: { key: {}, type: "REVOKE" } })).toEqual([]);
    expect(fromBaileysMessage({ reactionMessage: { text: "👍" } })).toEqual([]);
    expect(fromBaileysMessage({ messageContextInfo: { deviceListMetadataVersion: 2 } })).toEqual([]);
  });

  it("un mensaje envuelto (efimero, ver una vez) se desenvuelve", () => {
    const items = fromBaileysMessage({
      ephemeralMessage: { message: { audioMessage: { mimetype: "audio/ogg", seconds: 5, ptt: true } } },
    });

    expect(items[0]).toMatchObject({ kind: "voice", durationSeconds: 5 });
  });

  it("unwrap con un envoltorio vacio devuelve lo que habia, sin lazos infinitos", () => {
    expect(unwrapBaileysMessage({ ephemeralMessage: {} })).toEqual({ ephemeralMessage: {} });
    expect(unwrapBaileysMessage(null)).toBeNull();
  });

  it("con nada devuelve []", () => {
    expect(fromBaileysMessage(null)).toEqual([]);
    expect(fromBaileysMessage({})).toEqual([]);
  });
});

describe("mime y etiquetas", () => {
  it("el mime pierde sus parametros", () => {
    expect(normalizeMime("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(normalizeMime("IMAGE/JPEG")).toBe("image/jpeg");
    expect(normalizeMime("")).toBeNull();
    expect(normalizeMime(null)).toBeNull();
  });

  it("el kind se deduce del mime cuando el origen no lo dice", () => {
    expect(kindForMime("image/gif")).toBe("gif");
    expect(kindForMime("image/png")).toBe("image");
    expect(kindForMime("video/mp4")).toBe("video");
    expect(kindForMime("audio/ogg")).toBe("audio");
    expect(kindForMime("application/pdf")).toBe("document");
    expect(kindForMime(null)).toBe("unsupported");
  });

  it("cada kind tiene su etiqueta en castellano", () => {
    expect(attachmentLabel("voice")).toBe("🎤 Nota de voz");
    expect(attachmentLabel("image")).toBe("📷 Imagen");
    expect(attachmentLabel("video")).toBe("🎬 Video");
    expect(attachmentLabel("document")).toBe("📄 Documento");
    expect(attachmentLabel("location")).toBe("📍 Ubicación");
    expect(attachmentLabel("contact")).toBe("👤 Contacto");
    expect(attachmentLabel("poll")).toBe("📊 Encuesta");
  });

  it("la etiqueta del conjunto es la del primero, y sin adjuntos no hay etiqueta", () => {
    expect(attachmentsLabel([emptyAttachment("voice"), emptyAttachment("image")])).toBe("🎤 Nota de voz");
    expect(attachmentsLabel([])).toBeNull();
  });
});
