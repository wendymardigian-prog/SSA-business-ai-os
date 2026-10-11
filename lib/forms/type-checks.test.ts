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
});

describe("typeChecks", () => {
  it("un personalizado no suma reglas", () => {
    expect(typeChecks("custom", {})).toEqual([]);
    expect(typeChecks("survey", { surveyConfig: {} })).toHaveLength(1);
    expect(typeChecks("contract", {})).toHaveLength(1);
  });
});
