/**
 * Caracterizacion de los cuatro formatos que hoy conviven en
 * `messages.attachments` — como los lee el sistema HOY.
 *
 * Se escribe ANTES de F1, que mete un esquema normalizado. La columna es jsonb
 * libre y cada origen escribe una forma distinta:
 *
 *   1. Email      `{ files: [{ filename, contentType, storagePath, sizeBytes }] }`
 *   2. Instagram  `[{ type, url, payload? }]`  (el array crudo de Zernio)
 *   3. WhatsApp   `{ audioMessage: { ... } }`  (el nodo crudo de Baileys)
 *   4. Flows      `[{ type, url }]`            (lo que registra recordSend)
 *
 * El unico que hoy se muestra bien es el de email: `parseAttachments` de
 * lib/email/attachments.ts entiende ese y nada mas, y la burbuja pinta un clip
 * con la palabra "Adjunto" para todo el resto.
 *
 * Lo que este archivo fija es el comportamiento del lector VIEJO, que no se
 * toca: la ruta de descarga de email y su burbuja tienen que seguir andando
 * igual despues de F1. El lector nuevo tiene su propio archivo de tests.
 */

import { describe, it, expect } from "vitest";
import { parseAttachments as parseEmailAttachments } from "@/lib/email/attachments";

/** Los cuatro payloads reales, tal como estan hoy en la base. */
export const LEGACY_EMAIL = {
  files: [
    { filename: "guia.pdf", contentType: "application/pdf", storagePath: "ws-1/email-1/0-guia.pdf", sizeBytes: 2048 },
  ],
};

export const LEGACY_ZERNIO = [{ type: "image", url: "https://cdn.meta/x.jpg" }];

export const LEGACY_BAILEYS = {
  audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 12, ptt: true, url: "https://mmg.whatsapp.net/x.enc" },
};

export const LEGACY_FLOW = [{ type: "image", url: "https://storage/content-media/ws-1/post-1/foto.jpg" }];

describe("el lector viejo de adjuntos (lib/email/attachments.ts), como funciona hoy", () => {
  it("el formato de email es el unico que entiende: devuelve el path para firmarlo despues", () => {
    expect(parseEmailAttachments(LEGACY_EMAIL)).toEqual([
      {
        filename: "guia.pdf",
        contentType: "application/pdf",
        storagePath: "ws-1/email-1/0-guia.pdf",
        sizeBytes: 2048,
      },
    ]);
  });

  it("el array de Zernio no lo entiende: la burbuja termina mostrando un clip y 'Adjunto'", () => {
    expect(parseEmailAttachments(LEGACY_ZERNIO)).toEqual([]);
  });

  it("el nodo de Baileys tampoco: una nota de voz de WhatsApp no se puede escuchar", () => {
    expect(parseEmailAttachments(LEGACY_BAILEYS)).toEqual([]);
  });

  it("lo que registra un flow al enviar tampoco", () => {
    expect(parseEmailAttachments(LEGACY_FLOW)).toEqual([]);
  });

  it("nunca lanza con basura", () => {
    expect(parseEmailAttachments(null)).toEqual([]);
    expect(parseEmailAttachments({})).toEqual([]);
    expect(parseEmailAttachments("texto")).toEqual([]);
    expect(parseEmailAttachments({ files: "texto" })).toEqual([]);
  });
});
