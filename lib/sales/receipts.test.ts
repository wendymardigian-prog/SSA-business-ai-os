import { describe, expect, it } from "vitest";
import { checkReceipt, receiptPath, receiptPathBelongsTo, RECEIPT_MAX_BYTES } from "./receipts";

const bytes = (head: number[], size = 64) => Uint8Array.from([...head, ...new Array(Math.max(0, size - head.length)).fill(0)]);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
const EXE = [0x4d, 0x5a, 0x90, 0x00];

describe("checkReceipt", () => {
  it("acepta imagen y PDF por sus bytes", () => {
    expect(checkReceipt(bytes(PNG))).toEqual({ ok: true, mime: "image/png", ext: "png" });
    expect(checkReceipt(bytes(PDF))).toEqual({ ok: true, mime: "application/pdf", ext: "pdf" });
  });
  it("rechaza un .exe aunque diga ser una imagen, un archivo vacío y uno de más de 10 MB", () => {
    expect(checkReceipt(bytes(EXE)).ok).toBe(false);
    expect(checkReceipt(new Uint8Array(0)).ok).toBe(false);
    const big = bytes(PNG, RECEIPT_MAX_BYTES + 1);
    expect(checkReceipt(big)).toMatchObject({ ok: false });
  });
  it("un audio o un gif no son comprobantes", () => {
    expect(checkReceipt(bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])).ok).toBe(false);
    expect(checkReceipt(bytes([0x49, 0x44, 0x33])).ok).toBe(false);
  });
});

describe("rutas", () => {
  const ids = { workspaceId: "ws", saleId: "sale", paymentId: "pay" };
  it("la ruta empieza por el workspace", () => {
    expect(receiptPath({ ...ids, fileId: "f1", ext: "pdf" })).toBe("ws/sale/pay/f1.pdf");
  });
  it("solo se firma un path que cuelga del workspace, la venta y el pago pedidos", () => {
    expect(receiptPathBelongsTo("ws/sale/pay/f1.pdf", ids)).toBe(true);
    expect(receiptPathBelongsTo("otro/sale/pay/f1.pdf", ids)).toBe(false);
    expect(receiptPathBelongsTo("ws/sale/otro/f1.pdf", ids)).toBe(false);
    expect(receiptPathBelongsTo("ws/sale/pay/../x.pdf", ids)).toBe(false);
    expect(receiptPathBelongsTo(null, ids)).toBe(false);
  });
});
