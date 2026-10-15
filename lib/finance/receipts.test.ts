import { describe, expect, it } from "vitest";
import { RECEIPT_MAX_BYTES, checkExpenseReceipt, isAllowedReceiptMime, receiptPath, receiptPathBelongsTo } from "./receipts";

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]);

describe("checkExpenseReceipt", () => {
  it("acepta un PDF y un PNG por sus bytes", () => {
    expect(checkExpenseReceipt(PDF, "application/pdf")).toMatchObject({ ok: true, ext: "pdf" });
    expect(checkExpenseReceipt(PNG)).toMatchObject({ ok: true, ext: "png" });
  });
  it("un .exe renombrado a .pdf se rechaza (por contenido)", () => {
    expect(checkExpenseReceipt(EXE, "application/pdf")).toMatchObject({ ok: false });
  });
  it("12 MB se rechaza con el límite; vacío también", () => {
    const big = new Uint8Array(RECEIPT_MAX_BYTES + 1);
    big.set(PDF);
    expect(checkExpenseReceipt(big)).toMatchObject({ ok: false, error: expect.stringContaining("10 MB") });
    expect(checkExpenseReceipt(new Uint8Array())).toMatchObject({ ok: false });
  });
});

describe("ruta del comprobante", () => {
  it("cuelga del workspace y del gasto", () => {
    const path = receiptPath({ workspaceId: "w1", expenseId: "e1", fileId: "f1", ext: "pdf" });
    expect(path).toBe("w1/e1/f1.pdf");
    expect(receiptPathBelongsTo(path, { workspaceId: "w1", expenseId: "e1" })).toBe(true);
    expect(receiptPathBelongsTo(path, { workspaceId: "w2", expenseId: "e1" })).toBe(false);
    expect(receiptPathBelongsTo("w1/e1/../x.pdf", { workspaceId: "w1", expenseId: "e1" })).toBe(false);
    expect(receiptPathBelongsTo(null, { workspaceId: "w1", expenseId: "e1" })).toBe(false);
  });
  it("tipos permitidos", () => {
    expect(isAllowedReceiptMime("image/heic")).toBe(true);
    expect(isAllowedReceiptMime("text/html")).toBe(false);
  });
});
