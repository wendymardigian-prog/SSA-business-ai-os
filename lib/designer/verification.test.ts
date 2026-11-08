import { describe, expect, it } from "vitest";
import cases from "./verification.cases.json";
import {
  alreadyValidNotice,
  canVerify,
  DOC_TYPES,
  docTypeVariable,
  FORMAT_NOT_VERIFIABLE,
  issueButtonLabel,
  validateTemplateVerification,
  verificationText,
  verificationTitle,
  verifyAfterFormatChange,
  type DocType,
} from "./verification";

describe("verificación: reglas (casos compartidos con los CHECK de D2)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    expect(validateTemplateVerification(c.input).length === 0).toBe(c.valid);
  });

  it("solo los formatos impresos admiten verificación", () => {
    expect(["carta_v", "carta_h", "a4_v", "a4_h"].every((f) => canVerify(f as never))).toBe(true);
    expect(["sq", "v45", "story", "wide", "web"].some((f) => canVerify(f as never))).toBe(false);
  });

  it("al pasar a un formato no impreso se apaga sola con el aviso", () => {
    expect(verifyAfterFormatChange({ verify: true }, "v45")).toEqual({ verify: false, notice: FORMAT_NOT_VERIFIABLE });
    expect(verifyAfterFormatChange({ verify: true }, "a4_h")).toEqual({ verify: true, notice: null });
    expect(verifyAfterFormatChange({ verify: false }, "story")).toEqual({ verify: false, notice: null });
  });
});

describe("verificación: textos por tipo (4 tipos × válido/anulado)", () => {
  const args = ["Academia Ejemplo", "7 de noviembre de 2026", "K8F2-WQ4M-7TQA"] as const;
  const expected: Record<DocType, [string, string]> = {
    certificado: [
      "✅ Certificado válido · emitido por Academia Ejemplo el 7 de noviembre de 2026 · Código K8F2-WQ4M-7TQA",
      "⛔ Certificado anulado · Motivo: nombre mal escrito",
    ],
    constancia: [
      "✅ Constancia válida · emitida por Academia Ejemplo el 7 de noviembre de 2026 · Código K8F2-WQ4M-7TQA",
      "⛔ Constancia anulada · Motivo: nombre mal escrito",
    ],
    diploma: [
      "✅ Diploma válido · emitido por Academia Ejemplo el 7 de noviembre de 2026 · Código K8F2-WQ4M-7TQA",
      "⛔ Diploma anulado · Motivo: nombre mal escrito",
    ],
    otro: [
      "✅ Verificado · Credencial emitido por Academia Ejemplo el 7 de noviembre de 2026 · Código K8F2-WQ4M-7TQA",
      "⛔ Anulado · Credencial · Motivo: nombre mal escrito",
    ],
  };

  it.each(DOC_TYPES.map((t) => [t] as const))("%s", (type) => {
    const label = type === "otro" ? "Credencial" : null;
    expect(verificationText(type, label, "valid", ...args)).toBe(expected[type][0]);
    expect(verificationText(type, label, "void", ...args, "nombre mal escrito")).toBe(expected[type][1]);
  });

  it("los títulos cortos concuerdan en género", () => {
    expect(verificationTitle("constancia", "valid")).toBe("Constancia válida");
    expect(verificationTitle("diploma", "void")).toBe("Diploma anulado");
    expect(verificationTitle("otro", "valid")).toBe("Verificado");
  });

  it("el botón y el aviso salen del tipo", () => {
    expect(issueButtonLabel({ verify: true, doc_type: "constancia", doc_type_label: null })).toBe("Emitir constancia");
    expect(issueButtonLabel({ verify: true, doc_type: "otro", doc_type_label: "Credencial" })).toBe("Emitir credencial");
    expect(issueButtonLabel({ verify: false, doc_type: "certificado", doc_type_label: null })).toBe("Generar para…");
    expect(alreadyValidNotice({ doc_type: "constancia", doc_type_label: null }, "ABCD-EFGH-JKMN")).toBe("Ya tiene una constancia válida (código ABCD-EFGH-JKMN): ¿reemplazarla?");
    expect(alreadyValidNotice({ doc_type: "certificado", doc_type_label: null }, "X")).toBe("Ya tiene un certificado válido (código X): ¿reemplazarlo?");
  });

  it("design.doc_type es el nombre del tipo, vacío si no verifica", () => {
    expect(docTypeVariable({ verify: true, doc_type: "diploma", doc_type_label: null })).toBe("Diploma");
    expect(docTypeVariable({ verify: false, doc_type: "diploma", doc_type_label: null })).toBe("");
  });
});
