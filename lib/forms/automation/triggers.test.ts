import { describe, it, expect } from "vitest";
import { formEventMatches, formDedupeKey, answersForConditions, TRIGGER_FOR_FORM_TYPE, FORM_TRIGGER_TYPES, type SubmissionForMatch } from "./triggers";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const sub = (over: Partial<SubmissionForMatch> = {}): SubmissionForMatch => ({
  formId: A,
  score: null,
  npsCategory: null,
  surveyCategory: null,
  answers: {},
  ...over,
});

const cond = (fieldKey: string, operator: string, value: string) => ({
  rootConjunction: "and" as const,
  conditions: [{ fieldKey, operator, value }],
  groups: [],
});

describe("form_submitted", () => {
  it("con form_ids = [A] y una respuesta de B no inicia; con [] sí", () => {
    expect(formEventMatches("form_submitted", { form_ids: [A] }, sub({ formId: B }))).toBe(false);
    expect(formEventMatches("form_submitted", { form_ids: [] }, sub({ formId: B }))).toBe(true);
    expect(formEventMatches("form_submitted", {}, sub({ formId: B }))).toBe(true);
  });

  it("answer_conditions: facturación > 10k no inicia con 500", () => {
    const config = { form_ids: [], answer_conditions: cond("facturacion", "gt", "10000") };
    expect(formEventMatches("form_submitted", config, sub({ answers: { facturacion: 500 } }))).toBe(false);
    expect(formEventMatches("form_submitted", config, sub({ answers: { facturacion: 25000 } }))).toBe(true);
  });

  it("una configuración rota no dispara para nadie", () => {
    expect(formEventMatches("form_submitted", { form_ids: "todos" }, sub())).toBe(false);
    expect(formEventMatches("form_submitted", { answer_conditions: { rootConjunction: "xor" } }, sub())).toBe(false);
  });
});

describe("survey_answered", () => {
  it("nps_categories = detractor: dispara con 4, no con 7", () => {
    const config = { form_ids: [], nps_categories: ["detractor"] };
    expect(formEventMatches("survey_answered", config, sub({ score: 4, npsCategory: "detractor" }))).toBe(true);
    expect(formEventMatches("survey_answered", config, sub({ score: 7, npsCategory: "passive" }))).toBe(false);
  });

  it("una encuesta de estrellas (sin categoría NPS) no entra a un filtro por categoría", () => {
    expect(formEventMatches("survey_answered", { nps_categories: ["promoter"] }, sub({ score: 5, npsCategory: null }))).toBe(false);
  });

  it("score lte 6 dispara con un NPS de 6 y no con 7", () => {
    const config = { score: { operator: "lte", value: 6 } };
    expect(formEventMatches("survey_answered", config, sub({ score: 6 }))).toBe(true);
    expect(formEventMatches("survey_answered", config, sub({ score: 7 }))).toBe(false);
  });

  it("score gte y eq", () => {
    expect(formEventMatches("survey_answered", { score: { operator: "gte", value: 9 } }, sub({ score: 9 }))).toBe(true);
    expect(formEventMatches("survey_answered", { score: { operator: "eq", value: 8 } }, sub({ score: 9 }))).toBe(false);
  });

  it("con filtro de puntaje, una respuesta sin puntaje no entra", () => {
    expect(formEventMatches("survey_answered", { score: { operator: "lte", value: 6 } }, sub({ score: null }))).toBe(false);
  });

  it("survey_categories filtra por la categoría de la encuesta", () => {
    expect(formEventMatches("survey_answered", { survey_categories: ["servicio"] }, sub({ surveyCategory: "servicio" }))).toBe(true);
    expect(formEventMatches("survey_answered", { survey_categories: ["servicio"] }, sub({ surveyCategory: "cierre" }))).toBe(false);
    expect(formEventMatches("survey_answered", { survey_categories: ["servicio"] }, sub({ surveyCategory: null }))).toBe(false);
  });
});

describe("contract_signed", () => {
  it("solo mira el formulario, ignora lo que no le corresponde", () => {
    expect(formEventMatches("contract_signed", { form_ids: [A], nps_categories: ["detractor"] }, sub())).toBe(true);
    expect(formEventMatches("contract_signed", { form_ids: [B] }, sub())).toBe(false);
  });
});

describe("piezas", () => {
  it("un evento por respuesta: cada tipo de formulario tiene un solo trigger", () => {
    expect(TRIGGER_FOR_FORM_TYPE).toEqual({ custom: "form_submitted", survey: "survey_answered", contract: "contract_signed" });
    expect(new Set(Object.values(TRIGGER_FOR_FORM_TYPE)).size).toBe(FORM_TRIGGER_TYPES.length);
  });

  it("un tipo desconocido nunca coincide", () => {
    expect(formEventMatches("call_linked", {}, sub())).toBe(false);
  });

  it("la clave de idempotencia es la misma para la misma respuesta", () => {
    expect(formDedupeKey("form_submitted", "s1")).toBe("form:form_submitted:s1");
    expect(formDedupeKey("form_submitted", "s1")).toBe(formDedupeKey("form_submitted", "s1"));
  });

  it("answersForConditions: deja valores simples y vacía los archivos", () => {
    expect(
      answersForConditions({
        a: { value: "x" },
        b: { value: 3 },
        c: { value: ["u", "v"] },
        d: { value: [{ path: "p", name: "n" }] },
        e: undefined,
      }),
    ).toEqual({ a: "x", b: 3, c: ["u", "v"], d: undefined, e: undefined });
  });
});

describe("el CHECK de triggers.type (migración 00155)", () => {
  it("contiene todos los tipos de antes (incluidos los de Llamadas) más los tres de Formularios", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/00155_flows_form_id_trigger_types.sql", "utf8");
    const body = sql.slice(sql.indexOf("ADD CONSTRAINT triggers_type_check"));
    const BEFORE = [
      "keyword", "postback", "quick_reply", "welcome", "default", "comment_keyword", "new_contact", "crm_event", "inactivity", "email_received",
      "booking_created", "booking_rescheduled", "booking_cancelled", "booking_updated", "booking_ended", "booking_status_changed",
      "booking_before_start", "booking_after_end", "booking_after_created", "call_analyzed", "call_linked",
    ];
    for (const type of [...BEFORE, ...FORM_TRIGGER_TYPES]) expect(body, type).toContain(`'${type}'`);
  });
});
