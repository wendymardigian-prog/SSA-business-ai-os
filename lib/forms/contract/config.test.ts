import { describe, it, expect } from "vitest";
import { validateContractConfig, parseStoredContractConfig, parseCcInput, signerEmailField, signerNameFromAnswers } from "./config";
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
    expect(parseStoredContractConfig(null, "Mi contrato")).toEqual({ title: "Mi contrato", signatureRequired: true, acceptLabel: "Leí y acepto el contrato", ccEmails: [] });
    expect(parseStoredContractConfig({ title: "T", signatureRequired: false, ccEmails: ["x@y.com", "roto"] }).ccEmails).toEqual(["x@y.com"]);
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
