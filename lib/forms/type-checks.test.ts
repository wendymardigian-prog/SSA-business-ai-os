import { describe, it, expect } from "vitest";
import { contractChecks, surveyChecks, typeChecks } from "./type-checks";
import { newField } from "./fields";

describe("encuesta", () => {
  const ok = { fields: [{ ...newField("nps", "nps", "NPS"), required: true }] };

  it("pasa con un puntaje obligatorio", () => {
    expect(surveyChecks({ scoreFieldKey: "nps" })(ok)).toEqual([]);
  });

  it("rechaza un puntaje que no existe o es opcional", () => {
    expect(surveyChecks({ scoreFieldKey: "otro" })(ok)).toHaveLength(1);
    expect(surveyChecks({ scoreFieldKey: "nps" })({ fields: [{ ...ok.fields[0], required: false }] })[0]).toMatch(/obligatorio/);
  });

  it("rechaza un puntaje que no es estrellas ni NPS", () => {
    const def = { fields: [{ ...newField("short_text", "nps", "Texto"), required: true }] };
    expect(surveyChecks({ scoreFieldKey: "nps" })(def)[0]).toMatch(/estrellas o NPS/);
  });
});

describe("contrato", () => {
  it("necesita texto y un email obligatorio", () => {
    expect(contractChecks()({ fields: [], contractText: "" })).toHaveLength(2);
    expect(contractChecks()({ fields: [{ ...newField("email", "email"), required: false }], contractText: "Texto" })).toHaveLength(1);
    expect(contractChecks()({ fields: [{ ...newField("email", "email"), required: true }], contractText: "Texto" })).toEqual([]);
  });
  it("variables: en Aceptación de términos no se publican; en modo Contrato, solo las que existen", () => {
    const fields = [{ ...newField("email", "email"), required: true }, { ...newField("short_text", "empresa"), required: true }];
    const terms = contractChecks({ title: "A", mode: "terms" });
    expect(terms({ fields, contractText: "Entre {{respuesta.empresa}} y nosotros" })[0]).toContain("solo funcionan en modo Contrato");
    const contract = contractChecks({ title: "A", mode: "contract" });
    expect(contract({ fields, contractText: "Entre {{respuesta.empresa}} y {{negocio.nombre}}, el {{fecha}}" })).toEqual([]);
    expect(contract({ fields, contractText: "Entre {{respuesta.cuit}} y {{venta.precio}}" })[0]).toBe("El contrato usa variables que no existen: {{respuesta.cuit}}, {{venta.precio}}");
  });
});

describe("typeChecks", () => {
  it("un personalizado no suma reglas", () => {
    expect(typeChecks("custom", {})).toEqual([]);
    expect(typeChecks("survey", { surveyConfig: {} })).toHaveLength(1);
    expect(typeChecks("contract", {})).toHaveLength(1);
  });
});

describe("encuesta con el vínculo a contactos apagado (R3)", () => {
  const ok = { fields: [{ ...newField("nps", "nps", "NPS"), required: true }] };

  it('"una vez por contacto" no se puede publicar con el modo none', () => {
    const reasons = surveyChecks({ scoreFieldKey: "nps", oncePerContact: true }, "none")(ok);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/una vez por contacto/);
  });

  it("sin el límite, o con el vínculo prendido, publica igual", () => {
    expect(surveyChecks({ scoreFieldKey: "nps", oncePerContact: false }, "none")(ok)).toEqual([]);
    expect(surveyChecks({ scoreFieldKey: "nps", oncePerContact: true }, "create_or_link")(ok)).toEqual([]);
  });

  it("typeChecks le pasa el modo a la encuesta", () => {
    const [check] = typeChecks("survey", { surveyConfig: { scoreFieldKey: "nps", oncePerContact: true }, contactMode: "none" });
    expect(check(ok)).toHaveLength(1);
  });
});
