import { describe, it, expect } from "vitest";
import { EMAIL_STATUS_LABELS, PDF_STATUS_LABELS, canRegenerate, canResend, canViewPdf, emailTone, pdfTone } from "./status";

describe("estados de la firma", () => {
  it("el email tiene tres estados visibles (más el pendiente inicial)", () => {
    expect(EMAIL_STATUS_LABELS.sent).toBe("Enviado");
    expect(EMAIL_STATUS_LABELS.retrying).toBe("Reintentando");
    expect(EMAIL_STATUS_LABELS.not_sent).toBe("No enviado");
    expect(PDF_STATUS_LABELS.failed).toBe("No se pudo generar");
  });
  it("los tonos distinguen listo, en espera y fallo", () => {
    expect([pdfTone("generated"), pdfTone("pending"), pdfTone("failed")]).toEqual(["ok", "wait", "bad"]);
    expect([emailTone("sent"), emailTone("retrying"), emailTone("pending"), emailTone("not_sent")]).toEqual(["ok", "wait", "wait", "bad"]);
  });
  it("las acciones dependen del PDF: ver y reenviar con PDF listo; regenerar solo si falló", () => {
    expect([canViewPdf("generated"), canViewPdf("pending"), canViewPdf("failed")]).toEqual([true, false, false]);
    expect([canResend("generated"), canResend("failed")]).toEqual([true, false]);
    expect([canRegenerate("failed"), canRegenerate("generated"), canRegenerate("pending")]).toEqual([true, false, false]);
  });
});
