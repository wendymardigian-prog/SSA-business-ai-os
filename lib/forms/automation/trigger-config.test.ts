import { describe, it, expect } from "vitest";
import { parseFormTriggerConfig, cleanTriggerConfig, commonFields, describeFormTrigger } from "./trigger-config";
import { newField } from "@/lib/forms/fields";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseFormTriggerConfig", () => {
  it("vacío o sin nada es válido y significa cualquiera", () => {
    expect(parseFormTriggerConfig("form_submitted", undefined)).toEqual({ ok: true, config: { form_ids: [] } });
    expect(parseFormTriggerConfig("contract_signed", {})).toEqual({ ok: true, config: { form_ids: [] } });
  });
  it("rechaza ids que no son uuid y categorías desconocidas", () => {
    expect(parseFormTriggerConfig("form_submitted", { form_ids: ["x"] }).ok).toBe(false);
    expect(parseFormTriggerConfig("survey_answered", { nps_categories: ["enojado"] }).ok).toBe(false);
    expect(parseFormTriggerConfig("survey_answered", { survey_categories: ["otra"] }).ok).toBe(false);
  });
});

describe("cleanTriggerConfig", () => {
  it("saca listas y condiciones vacías, y repetidos", () => {
    const out = cleanTriggerConfig("survey_answered", {
      form_ids: [A, A],
      nps_categories: [],
      survey_categories: [],
      answer_conditions: { rootConjunction: "and", conditions: [], groups: [] },
    });
    expect(out).toEqual({ form_ids: [A] });
  });
  it("un contrato solo conserva los formularios", () => {
    expect(cleanTriggerConfig("contract_signed", { form_ids: [A], nps_categories: ["promoter"], score: { operator: "lte", value: 3 } })).toEqual({ form_ids: [A] });
  });
  it("un formulario personalizado no guarda lo propio de la encuesta", () => {
    expect(cleanTriggerConfig("form_submitted", { form_ids: [B], score: { operator: "lte", value: 3 } })).toEqual({ form_ids: [B] });
  });
  it("una configuración rota vuelve a vacía", () => {
    expect(cleanTriggerConfig("form_submitted", { form_ids: 3 })).toEqual({ form_ids: [] });
  });
});

describe("commonFields", () => {
  const f = (type: Parameters<typeof newField>[0], key: string) => newField(type, key, key);
  it("con un solo formulario ofrece todos sus campos de respuesta", () => {
    expect(commonFields([{ id: A, fields: [f("short_text", "nombre"), f("email", "email")] }]).map((x) => x.key)).toEqual(["nombre", "email"]);
  });
  it("con varios, solo los que tienen la misma clave y el mismo tipo en todos", () => {
    const out = commonFields([
      { id: A, fields: [f("short_text", "nombre"), f("email", "email"), f("number", "edad")] },
      { id: B, fields: [f("short_text", "nombre"), f("short_text", "email")] },
    ]);
    expect(out.map((x) => x.key)).toEqual(["nombre"]);
  });
  it("sin formularios no ofrece nada", () => {
    expect(commonFields([])).toEqual([]);
  });
});

describe("describeFormTrigger", () => {
  it("lo cuenta en palabras", () => {
    expect(describeFormTrigger("form_submitted", { form_ids: [] })).toBe("Se envía un formulario en cualquier formulario");
    expect(describeFormTrigger("survey_answered", { form_ids: [A], nps_categories: ["detractor"] }, { [A]: "NPS" })).toBe("Se responde una encuesta en «NPS», de detractores");
    expect(describeFormTrigger("form_submitted", { form_ids: "mal" })).toMatch(/inválida/);
  });
});
