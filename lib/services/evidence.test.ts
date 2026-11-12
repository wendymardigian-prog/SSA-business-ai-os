import { describe, expect, it } from "vitest";
import { canRemoveEvidence, evidenceMissing, evidencePath, isEvidencePathOf, readEvidenceRule, validateEvidence, type EvidenceEntry } from "./evidence";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0, 0x04, 0, 0, 0]);
const entry = (over: Partial<EvidenceEntry> = {}): EvidenceEntry => ({ id: "e1", kind: "note", text: "listo", by: "u1", at: "2026-11-12T10:00:00Z", ...over });

describe("validateEvidence", () => {
  const rule = readEvidenceRule({ required: true, kinds: ["file", "link", "note"] });
  it("acepta un PNG o un PDF por sus bytes", () => {
    expect(validateEvidence({ kind: "file", bytes: PNG, size: 1000 }, rule, [])).toEqual({ ok: true, value: { kind: "file", mime: "image/png", ext: "png" } });
    expect(validateEvidence({ kind: "file", bytes: PDF, size: 1000 }, rule, [])).toMatchObject({ ok: true, value: { ext: "pdf" } });
  });
  it("rechaza un archivo que dice ser PNG pero sus bytes son de otro tipo", () => {
    expect(validateEvidence({ kind: "file", bytes: EXE, size: 1000 }, rule, []).ok).toBe(false);
  });
  it("rechaza más de 10 MB, un link sin https y una nota vacía o larga", () => {
    expect(validateEvidence({ kind: "file", bytes: PNG, size: 11 * 1024 * 1024 }, rule, []).ok).toBe(false);
    expect(validateEvidence({ kind: "link", url: "http://x.test" }, rule, []).ok).toBe(false);
    expect(validateEvidence({ kind: "link", url: "https://x.test/a" }, rule, [])).toEqual({ ok: true, value: { kind: "link", url: "https://x.test/a" } });
    expect(validateEvidence({ kind: "note", text: "  " }, rule, []).ok).toBe(false);
    expect(validateEvidence({ kind: "note", text: "x".repeat(2001) }, rule, []).ok).toBe(false);
  });
  it("respeta los tipos pedidos y el tope de 10", () => {
    const onlyLink = readEvidenceRule({ required: true, kinds: ["link"] });
    expect(validateEvidence({ kind: "note", text: "hola" }, onlyLink, []).ok).toBe(false);
    expect(validateEvidence({ kind: "note", text: "hola" }, rule, Array.from({ length: 10 }, (_, i) => entry({ id: `e${i}` }))).ok).toBe(false);
  });
});

describe("qué falta y quién quita", () => {
  it("falta evidencia si pide y no hay ninguna del tipo pedido", () => {
    const rule = readEvidenceRule({ required: true, kinds: ["file"] });
    expect(evidenceMissing(rule, [])).toBe(true);
    expect(evidenceMissing(rule, [entry({ kind: "note" })])).toBe(true);
    expect(evidenceMissing(rule, [entry({ kind: "file", path: "a" })])).toBe(false);
    expect(evidenceMissing(null, [])).toBe(false);
  });
  it("solo lo propio y con el paso pendiente", () => {
    expect(canRemoveEvidence(entry(), "u1", "pending")).toBe(true);
    expect(canRemoveEvidence(entry(), "u2", "pending")).toBe(false);
    expect(canRemoveEvidence(entry(), "u1", "completed")).toBe(false);
  });
  it("la ruta queda dentro del negocio, el servicio y el paso", () => {
    const p = evidencePath("w", "s", "i", "f", "png");
    expect(p).toBe("w/s/i/f.png");
    expect(isEvidencePathOf(p, "w", "s", "i")).toBe(true);
    expect(isEvidencePathOf("w/s/i/../x.png", "w", "s", "i")).toBe(false);
    expect(isEvidencePathOf("otro/s/i/f.png", "w", "s", "i")).toBe(false);
  });
  it("lee solo reglas válidas", () => {
    expect(readEvidenceRule({ required: true, kinds: ["file", "file", "video"] })).toEqual({ required: true, kinds: ["file"] });
    expect(readEvidenceRule({ required: false, kinds: ["file"] })).toBeNull();
  });
});
