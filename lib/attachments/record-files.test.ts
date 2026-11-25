import { describe, expect, it } from "vitest";
import { classifyRecordFile, cleanRecordFileName, pickRecordFiles, recordAttachmentPath, RECORD_ATTACHMENT_MAX_BYTES } from "./record-files";

const f = (name: string, size = 10) => ({ name, size });
const bytes = (head: number[]) => { const b = new Uint8Array(64); b.set(head); return b; };
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("pickRecordFiles", () => {
  it("deja pasar hasta 5", () => {
    const r = pickRecordFiles([f("a"), f("b"), f("c"), f("d"), f("e"), f("f")]);
    expect(r.ok.map((x) => x.name)).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.error).toMatch(/como máximo 5/);
  });
  it("saca el que pesa más de 25 MB y lo dice", () => {
    const r = pickRecordFiles([f("chico"), f("grande", RECORD_ATTACHMENT_MAX_BYTES + 1)]);
    expect(r.ok.map((x) => x.name)).toEqual(["chico"]);
    expect(r.error).toBe("«grande» pesa más de 25 MB.");
  });
  it("sin problemas, sin error", () => expect(pickRecordFiles([f("a")]).error).toBeNull());
});

describe("classifyRecordFile: por los bytes", () => {
  it("una imagen y un PDF", () => {
    expect(classifyRecordFile(bytes(PNG), "image/png", "a.png", 100)).toEqual({ ok: true, mime: "image/png" });
    expect(classifyRecordFile(bytes(PDF), "", "a.pdf", 100)).toEqual({ ok: true, mime: "application/pdf" });
  });
  it("un Word con su tipo, o sin tipo pero con su extensión", () => {
    expect(classifyRecordFile(bytes(ZIP), DOCX, "a.docx", 100)).toEqual({ ok: true, mime: DOCX });
    expect(classifyRecordFile(bytes(ZIP), "", "a.docx", 100)).toEqual({ ok: true, mime: DOCX });
  });
  it("un zip cualquiera, un ejecutable o un .png que no es imagen: no", () => {
    expect(classifyRecordFile(bytes(ZIP), "application/zip", "a.zip", 100).ok).toBe(false);
    expect(classifyRecordFile(bytes([0x4d, 0x5a]), "application/pdf", "a.pdf", 100).ok).toBe(false);
    expect(classifyRecordFile(bytes([1, 2, 3]), "image/png", "a.png", 100).ok).toBe(false);
  });
  it("vacío o muy grande: no", () => {
    expect(classifyRecordFile(bytes(PNG), "image/png", "a.png", 0).ok).toBe(false);
    expect(classifyRecordFile(bytes(PNG), "image/png", "a.png", RECORD_ATTACHMENT_MAX_BYTES + 1).ok).toBe(false);
  });
});

describe("nombres y rutas", () => {
  it("limpia rutas y caracteres de control", () => {
    expect(cleanRecordFileName("../../etc/pa\u0000sswd")).toBe("passwd");
    expect(cleanRecordFileName("  ")).toBe("archivo");
  });
  it("la ruta queda dentro del negocio y de su carpeta", () => {
    expect(recordAttachmentPath("ws", "nota", "id1", "Mi contrato (final).pdf")).toBe("ws/nota/id1-Mi-contrato-final-.pdf");
  });
});
