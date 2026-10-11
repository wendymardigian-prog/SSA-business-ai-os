import { describe, it, expect } from "vitest";
import { newFormParts } from "./defaults";
import { validateDefinition } from "./definition-schema";

describe("newFormParts", () => {
  it("un personalizado arranca vacío y sin configuración de tipo", () => {
    const parts = newFormParts("custom", "Aplicación");
    expect(parts.definition.fields).toEqual([]);
    expect(parts.surveyConfig).toBeNull();
    expect(parts.contractConfig).toBeNull();
    expect(parts.design.title).toBe("Aplicación");
  });

  it("una encuesta trae el NPS obligatorio y un comentario opcional, y su configuración", () => {
    const parts = newFormParts("survey", "¿Cómo vas?");
    expect(parts.definition.fields.map((f) => [f.key, f.type, f.required])).toEqual([
      ["nps", "nps", true],
      ["por_que", "long_text", false],
    ]);
    expect(parts.surveyConfig).toEqual({ scoreFieldKey: "nps", category: "servicio", oncePerContact: false });
    expect(validateDefinition(parts.definition).ok).toBe(true);
  });

  it("un contrato trae nombre y email obligatorios, texto vacío y firma obligatoria", () => {
    const parts = newFormParts("contract", "Acuerdo");
    expect(parts.definition.fields.map((f) => [f.key, f.type, f.required])).toEqual([
      ["nombre", "short_text", true],
      ["email", "email", true],
    ]);
    expect(parts.definition.contractText).toBe("");
    expect(parts.contractConfig).toMatchObject({ title: "Acuerdo", signatureRequired: true, ccEmails: [] });
  });
});
