import { describe, it, expect } from "vitest";
import { validateSignature, decodeSignature, isPng, MAX_SIGNATURE_BYTES } from "./signature";

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const dataUrl = (bytes: number[] | Uint8Array, mime = "image/png") => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const png = (extra = 20) => dataUrl([...PNG_HEAD, ...new Array(extra).fill(1)]);

describe("validateSignature", () => {
  it("un PNG real con trazos es válido", () => {
    const result = validateSignature({ signature: png(), strokes: 2, required: true });
    expect(result.ok && result.bytes?.byteLength).toBeGreaterThan(8);
  });
  it("obligatoria y vacía: signature_required (aunque el navegador lo haya dejado pasar)", () => {
    expect(validateSignature({ signature: "", strokes: 0, required: true })).toEqual({ ok: false, error: "signature_required" });
    expect(validateSignature({ signature: undefined, required: true })).toEqual({ ok: false, error: "signature_required" });
  });
  it("obligatoria con signature_strokes = 0: se rechaza", () => {
    expect(validateSignature({ signature: png(), strokes: 0, required: true })).toEqual({ ok: false, error: "signature_required" });
  });
  it("un data URL que dice PNG pero trae los bytes de un JPEG se rechaza", () => {
    const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    expect(validateSignature({ signature: dataUrl(jpeg), strokes: 3, required: true })).toEqual({ ok: false, error: "signature_invalid" });
  });
  it("un data URL que dice JPEG no es válido aunque sea PNG por dentro", () => {
    expect(validateSignature({ signature: dataUrl([...PNG_HEAD, 1, 2], "image/jpeg"), strokes: 3, required: true }).ok).toBe(false);
  });
  it("de 250 KB se rechaza; justo en el tope pasa", () => {
    expect(validateSignature({ signature: dataUrl([...PNG_HEAD, ...new Array(250 * 1024).fill(1)]), strokes: 3, required: true })).toEqual({ ok: false, error: "signature_invalid" });
    const edge = new Uint8Array(MAX_SIGNATURE_BYTES);
    edge.set(PNG_HEAD);
    expect(validateSignature({ signature: dataUrl(edge), strokes: 3, required: true }).ok).toBe(true);
    const over = new Uint8Array(MAX_SIGNATURE_BYTES + 1);
    over.set(PNG_HEAD);
    expect(validateSignature({ signature: dataUrl(over), strokes: 3, required: true }).ok).toBe(false);
  });
  it("opcional y sin firma: se firma sin imagen", () => {
    expect(validateSignature({ signature: undefined, required: false })).toEqual({ ok: true, bytes: null });
    expect(validateSignature({ signature: png(), strokes: 0, required: false })).toEqual({ ok: true, bytes: null });
  });
  it("opcional pero con una firma rota: se rechaza (no se ignora en silencio)", () => {
    expect(validateSignature({ signature: "data:image/png;base64,@@@", strokes: 2, required: false })).toEqual({ ok: false, error: "signature_invalid" });
  });
  it("basura que no es un data URL", () => {
    expect(decodeSignature("hola")).toBeNull();
    expect(decodeSignature("data:image/png;base64,")).toBeNull();
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
