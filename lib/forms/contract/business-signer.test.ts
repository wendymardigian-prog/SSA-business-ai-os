import { describe, expect, it } from "vitest";
import { businessSignaturePath, parseBusinessSignature } from "./business-signer";
import { isBusinessSignaturePath } from "./config";

const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString("base64")}`;
const jpg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString("base64")}`;

describe("parseBusinessSignature", () => {
  it("acepta un PNG y un JPG por sus bytes", () => {
    expect(parseBusinessSignature(png)).toMatchObject({ ok: true, ext: "png", mime: "image/png" });
    expect(parseBusinessSignature(jpg)).toMatchObject({ ok: true, ext: "jpg", mime: "image/jpeg" });
  });

  it("rechaza lo que dice ser PNG y no lo es, un SVG, nada o algo muy pesado", () => {
    expect(parseBusinessSignature(`data:image/png;base64,${Buffer.from("<svg/>").toString("base64")}`).ok).toBe(false);
    expect(parseBusinessSignature("data:image/svg+xml;base64,PHN2Zy8+").ok).toBe(false);
    expect(parseBusinessSignature(null).ok).toBe(false);
    const big = `data:image/png;base64,${Buffer.alloc(600 * 1024, 1).toString("base64")}`;
    expect(parseBusinessSignature(big)).toMatchObject({ ok: false, error: expect.stringContaining("500 KB") });
  });

  it("la ruta que arma es la que después se acepta al guardar", () => {
    const path = businessSignaturePath("ws1", "f1", "0d8a8c1e-1111-4222-8333-444455556666", "png");
    expect(path).toBe("ws1/f1/business-signer/0d8a8c1e-1111-4222-8333-444455556666.png");
    expect(isBusinessSignaturePath(path, "ws1", "f1")).toBe(true);
  });
});
