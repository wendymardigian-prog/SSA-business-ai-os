import { describe, it, expect } from "vitest";
import { validateContractConfig, parseStoredContractConfig, parseCcInput, signerEmailField, signerNameFromAnswers, isBusinessSignaturePath } from "./config";
import { newField } from "@/lib/forms/fields";

const ok = (over = {}) => ({ title: "Acuerdo", signatureRequired: true, acceptLabel: "Acepto", ccEmails: [], ...over });

describe("validateContractConfig", () => {
  it("acepta una configuración completa", () => {
    expect(validateContractConfig(ok()).ok).toBe(true);
  });
  it("hasta 3 direcciones de copia, sin repetidas y en minúsculas", () => {
    const result = validateContractConfig(ok({ ccEmails: ["A@x.com", "a@x.com", "b@x.com"] }));
    expect(result.ok && result.config.ccEmails).toEqual(["a@x.com", "b@x.com"]);
    expect(validateContractConfig(ok({ ccEmails: ["a@x.com", "b@x.com", "c@x.com", "d@x.com"] })).ok).toBe(false);
  });
  it("una dirección inválida o un título vacío no pasan", () => {
    expect(validateContractConfig(ok({ ccEmails: ["no-es-email"] })).ok).toBe(false);
    expect(validateContractConfig(ok({ title: "  " })).ok).toBe(false);
    expect(validateContractConfig(ok({ acceptLabel: "" })).ok).toBe(false);
  });
});

describe("parseStoredContractConfig", () => {
  it("completa lo que falta con los valores por defecto y nunca lanza", () => {
    expect(parseStoredContractConfig(null, "Mi contrato")).toEqual({ title: "Mi contrato", signatureRequired: true, acceptLabel: "Leí y acepto el contrato", ccEmails: [], copyToOwner: true, mode: "terms", businessSigner: { enabled: false, name: "", role: "", signaturePath: null } });
    expect(parseStoredContractConfig({ title: "T", signatureRequired: false, ccEmails: ["x@y.com", "roto"] }).ccEmails).toEqual(["x@y.com"]);
  });
  it("la copia al Owner: prendida si la configuración es de antes de la opción, y se respeta si se apagó", () => {
    expect(parseStoredContractConfig({ title: "T", signatureRequired: true, acceptLabel: "A", ccEmails: [] }).copyToOwner).toBe(true);
    expect(parseStoredContractConfig({ title: "T", signatureRequired: true, acceptLabel: "A", ccEmails: [], copyToOwner: false }).copyToOwner).toBe(false);
  });
});

describe("signer", () => {
  it("parseCcInput separa por coma, punto y coma o espacio", () => {
    expect(parseCcInput("a@x.com, B@x.com; c@x.com  a@x.com")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(parseCcInput("")).toEqual([]);
  });
  it("el email del firmante es el primer email obligatorio", () => {
    const fields = [{ ...newField("email", "otro", "Otro"), required: false }, { ...newField("email", "email", "Email"), required: true }];
    expect(signerEmailField(fields)?.key).toBe("email");
    expect(signerEmailField([newField("short_text", "x", "X")])).toBeUndefined();
  });
  it("el nombre sale del campo que lo dice; si no, del primer texto con valor", () => {
    const fields = [newField("short_text", "empresa", "Empresa"), newField("short_text", "nombre_firmante", "Nombre del firmante")];
    expect(signerNameFromAnswers(fields, { empresa: "Acme", nombre_firmante: " Ana Pérez " })).toBe("Ana Pérez");
    expect(signerNameFromAnswers([newField("short_text", "empresa", "Empresa")], { empresa: "Acme" })).toBe("Acme");
    expect(signerNameFromAnswers(fields, {})).toBe("");
  });
});

describe("modo y firma de ambas partes", () => {
  const base = { title: "Acuerdo", signatureRequired: true, acceptLabel: "Acepto", ccEmails: [] };
  const signer = { enabled: true, name: "Wendy Mardigian", role: "Directora", signaturePath: "ws/form/business-signer/a.png" };

  it("una configuración de antes queda en Aceptación de términos y sin firma del negocio", () => {
    const parsed = parseStoredContractConfig(base);
    expect(parsed.mode).toBe("terms");
    expect(parsed.businessSigner).toEqual({ enabled: false, name: "", role: "", signaturePath: null });
    const checked = validateContractConfig(base);
    expect(checked.ok && checked.config.mode).toBe("terms");
  });

  it("la firma de ambas partes necesita el modo Contrato, la imagen y el nombre", () => {
    expect(validateContractConfig({ ...base, mode: "terms", businessSigner: signer }).ok).toBe(false);
    expect(validateContractConfig({ ...base, mode: "contract", businessSigner: { ...signer, signaturePath: null } }).ok).toBe(false);
    expect(validateContractConfig({ ...base, mode: "contract", businessSigner: { ...signer, name: " " } }).ok).toBe(false);
    expect(validateContractConfig({ ...base, mode: "contract", businessSigner: signer }).ok).toBe(true);
    // Apagada, no pide nada.
    expect(validateContractConfig({ ...base, mode: "contract", businessSigner: { enabled: false, name: "", role: "", signaturePath: null } }).ok).toBe(true);
  });

  it("solo una imagen de la firma de ESTE formulario", () => {
    expect(isBusinessSignaturePath("ws1/f1/business-signer/abc-123.png", "ws1", "f1")).toBe(true);
    expect(isBusinessSignaturePath("ws1/f1/business-signer/abc.jpg", "ws1", "f1")).toBe(true);
    expect(isBusinessSignaturePath("ws2/f1/business-signer/abc.png", "ws1", "f1")).toBe(false);
    expect(isBusinessSignaturePath("ws1/f1/business-signer/../../x.png", "ws1", "f1")).toBe(false);
    expect(isBusinessSignaturePath("ws1/f1/sig/abc.png", "ws1", "f1")).toBe(false);
    expect(isBusinessSignaturePath("ws1/f1/business-signer/abc.svg", "ws1", "f1")).toBe(false);
  });
});
