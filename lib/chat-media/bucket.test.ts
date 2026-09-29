/**
 * El bucket de la media del chat (F2): paths, extensiones y lo que se rechaza.
 */

import { describe, it, expect } from "vitest";
import {
  chatMediaDownloadUrl,
  chatMediaUrl,
  extensionForMime,
  isSafeStoragePath,
  mediaPath,
  safeFilename,
} from "./bucket";

describe("mediaPath (F2)", () => {
  it("el primer segmento es el workspace: es lo unico que mira la policy", () => {
    const path = mediaPath({
      workspaceId: "ws-1",
      conversationId: "cv-1",
      messageId: "m-1",
      index: 0,
      mime: "audio/ogg",
    });

    expect(path).toBe("ws-1/cv-1/m-1-0.ogg");
    expect(path.split("/")[0]).toBe("ws-1");
  });

  it("varios adjuntos del mismo mensaje no se pisan", () => {
    const base = { workspaceId: "ws-1", conversationId: "cv-1", messageId: "m-1", mime: "image/jpeg" };
    expect(mediaPath({ ...base, index: 0 })).not.toBe(mediaPath({ ...base, index: 1 }));
  });

  it("un mime que no conocemos no rompe el path", () => {
    expect(mediaPath({ workspaceId: "w", conversationId: "c", messageId: "m", index: 0, mime: null })).toBe(
      "w/c/m-0.bin",
    );
  });
});

describe("extensionForMime", () => {
  it("los formatos de audio que importan", () => {
    expect(extensionForMime("audio/ogg")).toBe("ogg");
    expect(extensionForMime("audio/ogg; codecs=opus")).toBe("ogg");
    expect(extensionForMime("audio/mp4")).toBe("m4a");
    expect(extensionForMime("audio/webm")).toBe("webm");
    expect(extensionForMime("audio/mpeg")).toBe("mp3");
  });

  it("imagen, video y documento", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("video/mp4")).toBe("mp4");
    expect(extensionForMime("application/pdf")).toBe("pdf");
  });

  it("lo desconocido cae en bin", () => {
    expect(extensionForMime("application/x-loquesea")).toBe("bin");
    expect(extensionForMime(null)).toBe("bin");
  });
});

describe("isSafeStoragePath", () => {
  it("acepta un path normal", () => {
    expect(isSafeStoragePath("ws-1/cv-1/m-1-0.ogg")).toBe(true);
  });

  it("rechaza salir de la carpeta del workspace", () => {
    expect(isSafeStoragePath("ws-1/../ws-2/secreto.ogg")).toBe(false);
    expect(isSafeStoragePath("../x")).toBe(false);
  });

  it("rechaza el / inicial: cambiaria el workspace que evalua la policy", () => {
    expect(isSafeStoragePath("/ws-1/cv-1/x.ogg")).toBe(false);
  });

  it("rechaza vacio, nulo y un path sin carpeta", () => {
    expect(isSafeStoragePath("")).toBe(false);
    expect(isSafeStoragePath(null)).toBe(false);
    expect(isSafeStoragePath(undefined)).toBe(false);
    expect(isSafeStoragePath("suelto.ogg")).toBe(false);
  });

  it("rechaza las barras invertidas", () => {
    expect(isSafeStoragePath("ws-1\\cv-1\\x.ogg")).toBe(false);
  });
});

describe("safeFilename", () => {
  it("saca lo que no sirve en un path", () => {
    expect(safeFilename("mi foto (1).jpg")).toBe("mi-foto-1-.jpg");
    expect(safeFilename("../../etc/passwd")).toBe("etc-passwd");
  });

  it("con nada usa el respaldo", () => {
    expect(safeFilename(null)).toBe("adjunto");
    expect(safeFilename("***")).toBe("adjunto");
  });

  it("no crece sin techo", () => {
    expect(safeFilename("a".repeat(500)).length).toBeLessThanOrEqual(80);
  });
});

describe("los links de la burbuja", () => {
  it("apuntan a la ruta propia, que firma al abrirla", () => {
    expect(chatMediaUrl("ws-1/cv-1/m-1-0.ogg")).toBe("/api/v1/chat-media?path=ws-1%2Fcv-1%2Fm-1-0.ogg");
  });

  it("el de descarga pide la descarga y lleva el nombre", () => {
    expect(chatMediaDownloadUrl("ws-1/cv-1/m-1-0.ogg", "nota de voz.ogg")).toBe(
      "/api/v1/chat-media?path=ws-1%2Fcv-1%2Fm-1-0.ogg&download=1&name=nota-de-voz.ogg",
    );
  });
});
