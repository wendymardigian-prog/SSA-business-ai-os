import { describe, it, expect } from "vitest";
import { assetKindForAttachment, channelAccepts, channelAcceptsAnyFile, rejectedKinds } from "./media";
import { ASSET_KINDS, type AssetKind } from "@/lib/response-assets/kind";

/**
 * La matriz entera (banca v2, F10): tres canales por seis tipos, mas el audio
 * de Instagram por formato y un proveedor desconocido. Si alguien cambia una
 * celda, este test dice cual.
 */
const MATRIX: Record<string, Record<AssetKind, boolean>> = {
  resend: { text: true, link: true, image: false, video: false, audio: false, file: false },
  evolution: { text: true, link: true, image: true, video: true, audio: true, file: true },
  zernio: { text: true, link: true, image: true, video: true, audio: true, file: false },
  "proveedor-nuevo": { text: true, link: true, image: false, video: false, audio: false, file: false },
};

describe("channelAccepts: la matriz", () => {
  for (const [provider, row] of Object.entries(MATRIX)) {
    for (const kind of ASSET_KINDS) {
      it(`${provider} × ${kind} = ${row[kind] ? "si" : "no"}`, () => {
        expect(channelAccepts(provider, kind).ok).toBe(row[kind]);
      });
    }
  }

  it("sin proveedor: igual que uno desconocido (solo texto y enlace)", () => {
    expect(channelAccepts(null, "text").ok).toBe(true);
    expect(channelAccepts(undefined, "image").ok).toBe(false);
  });
});

describe("Instagram: el audio depende del formato", () => {
  it("acepta m4a, aac, wav y mp4", () => {
    for (const mime of ["audio/mp4", "audio/aac", "audio/wav", "audio/x-m4a"]) {
      expect(channelAccepts("zernio", "audio", mime).ok, mime).toBe(true);
    }
  });

  it("rechaza ogg, webm y mp3, con el motivo de siempre", () => {
    for (const mime of ["audio/ogg", "audio/webm", "audio/mpeg"]) {
      const result = channelAccepts("zernio", "audio", mime);
      expect(result.ok, mime).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/Instagram no acepta este formato de audio/);
    }
  });

  it("un audio sin mime conocido (null) no se arriesga", () => {
    expect(channelAccepts("zernio", "audio", null).ok).toBe(false);
  });

  it("WhatsApp convierte cualquier formato", () => {
    expect(channelAccepts("evolution", "audio", "audio/ogg").ok).toBe(true);
  });
});

describe("los motivos", () => {
  it("cada rechazo dice por que, para el chip deshabilitado", () => {
    expect(rejectedKinds("zernio")).toEqual({ file: expect.stringMatching(/Instagram no acepta archivos/) });
    expect(Object.keys(rejectedKinds("resend")).sort()).toEqual(["audio", "file", "image", "video"]);
    expect(rejectedKinds("evolution")).toEqual({});
  });
});

describe("helpers", () => {
  it("si acepta algun archivo", () => {
    expect(channelAcceptsAnyFile("resend")).toBe(false);
    expect(channelAcceptsAnyFile("zernio")).toBe(true);
    expect(channelAcceptsAnyFile(null)).toBe(false);
  });

  it("el tipo de recurso de un adjunto saliente", () => {
    expect(assetKindForAttachment("voice")).toBe("audio");
    expect(assetKindForAttachment("document")).toBe("file");
    expect(assetKindForAttachment("video")).toBe("video");
  });
});
