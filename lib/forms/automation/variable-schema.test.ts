import { describe, it, expect } from "vitest";
import { formVariableSchema, answerValueOf, conditionTypeOfField, answerPath, FORM_GROUP } from "./variable-schema";
import { MissingFieldError } from "@/lib/flow-engine/condition-eval";
import type { FormField, FormFieldType } from "@/lib/forms/fields";

const f = (type: FormFieldType, key: string, extra: Partial<FormField> = {}): FormField => ({ id: `id_${key}`, key, type, label: key.toUpperCase(), required: false, ...extra });

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("formVariableSchema", () => {
  const fields = [
    f("short_text", "nombre", { label: "Nombre" }),
    f("number", "edad"),
    f("single_select", "facturacion", { label: "Facturación", options: ["Menos de USD 1.000", "USD 1.000 a USD 10.000", "Más de USD 10.000"] }),
    f("multi_select", "intereses", { options: ["CRM", "Ads"] }),
    f("date", "nacimiento"),
    f("consent", "terminos"),
    f("rating", "estrellas"),
    f("nps", "nps"),
    f("email", "correo"),
    f("file", "archivo"),
    f("hidden", "utm"),
    f("social", "ig"),
  ];
  const specs = formVariableSchema("form_submitted", [{ id: A, fields }]);
  const byPath = Object.fromEntries(specs.map((s) => [s.path, s]));

  it("siempre ofrece el nombre del formulario", () => {
    expect(byPath["form.name"]).toMatchObject({ type: "text", group: FORM_GROUP });
  });

  it("cada pregunta con SU tipo (numero, seleccion unica y multiple, fecha, consentimiento, el resto texto)", () => {
    expect(byPath["answer.edad"].type).toBe("number");
    expect(byPath["answer.estrellas"].type).toBe("number");
    expect(byPath["answer.nps"].type).toBe("number");
    expect(byPath["answer.facturacion"].type).toBe("single_select");
    expect(byPath["answer.intereses"].type).toBe("multi_select");
    expect(byPath["answer.nacimiento"].type).toBe("date");
    expect(byPath["answer.terminos"].type).toBe("boolean");
    expect(byPath["answer.nombre"].type).toBe("text");
    expect(byPath["answer.correo"].type).toBe("text");
    expect(byPath["answer.ig"].type).toBe("text");
  });

  it("las selecciones llevan sus opciones, con la etiqueta de la pregunta como nombre", () => {
    expect(byPath["answer.facturacion"].label).toBe("Facturación");
    expect(byPath["answer.facturacion"].options).toEqual([
      { value: "Menos de USD 1.000", label: "Menos de USD 1.000" },
      { value: "USD 1.000 a USD 10.000", label: "USD 1.000 a USD 10.000" },
      { value: "Más de USD 10.000", label: "Más de USD 10.000" },
    ]);
    expect(byPath["answer.intereses"].options?.map((o) => o.value)).toEqual(["CRM", "Ads"]);
    expect(byPath["answer.edad"].options).toBeUndefined();
  });

  it("los archivos y los campos ocultos no se ofrecen", () => {
    expect(byPath["answer.archivo"]).toBeUndefined();
    expect(byPath["answer.utm"]).toBeUndefined();
  });

  it("solo las encuestas ofrecen puntaje y categoria NPS", () => {
    expect(byPath["submission.score"]).toBeUndefined();
    const survey = Object.fromEntries(formVariableSchema("survey_answered", [{ id: A, fields }]).map((s) => [s.path, s]));
    expect(survey["submission.score"].type).toBe("number");
    expect(survey["submission.nps_category"]).toMatchObject({ type: "single_select" });
    expect(survey["submission.nps_category"].options).toEqual([
      { value: "promoter", label: "Promotor" },
      { value: "passive", label: "Pasivo" },
      { value: "detractor", label: "Detractor" },
    ]);
    // Un contrato no tiene puntaje.
    expect(formVariableSchema("contract_signed", [{ id: A, fields }]).some((s) => s.path.startsWith("submission."))).toBe(false);
  });

  it("la ruta es la de {{answer.x}}: los guiones pasan a guion bajo", () => {
    expect(answerPath("nombre-completo")).toBe("answer.nombre_completo");
    const out = formVariableSchema("form_submitted", [{ id: A, fields: [f("short_text", "nombre-completo")] }]);
    expect(out.map((s) => s.path)).toContain("answer.nombre_completo");
  });

  it("con varios formularios, solo las preguntas con la misma clave y el mismo tipo en TODOS", () => {
    const out = formVariableSchema("form_submitted", [
      { id: A, fields: [f("short_text", "nombre"), f("number", "monto"), f("short_text", "solo_a")] },
      { id: B, fields: [f("short_text", "nombre"), f("short_text", "monto"), f("short_text", "solo_b")] },
    ]);
    expect(out.map((s) => s.path)).toEqual(["form.name", "answer.nombre"]);
  });

  it("sin formularios elegidos (cualquiera) no ofrece preguntas, solo lo que es de todos", () => {
    expect(formVariableSchema("form_submitted", []).map((s) => s.path)).toEqual(["form.name"]);
  });

  it("conditionTypeOfField cubre todos los tipos de pregunta", () => {
    const types: FormFieldType[] = ["short_text", "long_text", "email", "phone", "number", "single_select", "multi_select", "date", "rating", "nps", "file", "consent", "hidden", "social"];
    for (const t of types) expect(["text", "number", "single_select", "multi_select", "date", "boolean"]).toContain(conditionTypeOfField(t));
  });
});

describe("answerValueOf: el valor real de la respuesta", () => {
  const source = {
    fields: [{ key: "facturacion" }, { key: "intereses" }, { key: "edad" }, { key: "nombre-completo" }, { key: "archivo" }, { key: "terminos" }],
    answers: {
      facturacion: { value: "Más de USD 10.000" },
      intereses: { value: ["CRM", "Ads"] },
      edad: { value: 42 },
      "nombre-completo": { value: "Ana" },
      archivo: { value: [{ name: "x.pdf" }] },
      terminos: { value: true },
    },
  };

  it("texto, numero, lista y si/no con su tipo", () => {
    expect(answerValueOf("answer.facturacion", source)).toBe("Más de USD 10.000");
    expect(answerValueOf("answer.intereses", source)).toEqual(["CRM", "Ads"]);
    expect(answerValueOf("answer.edad", source)).toBe(42);
    expect(answerValueOf("answer.terminos", source)).toBe(true);
  });
  it("una clave con guion se lee por su ruta con guion bajo", () => {
    expect(answerValueOf("answer.nombre_completo", source)).toBe("Ana");
  });
  it("una pregunta de la version que no se respondio es vacia (undefined), no inexistente", () => {
    expect(answerValueOf("answer.facturacion", { ...source, answers: {} })).toBeUndefined();
  });
  it("los archivos se ven vacios", () => {
    expect(answerValueOf("answer.archivo", source)).toBeUndefined();
  });
  it("una pregunta que no esta en esa version lanza MissingFieldError", () => {
    expect(() => answerValueOf("answer.borrada", source)).toThrow(MissingFieldError);
  });
  it("las respuestas pueden faltar del todo", () => {
    expect(answerValueOf("answer.edad", { fields: [{ key: "edad" }], answers: null })).toBeUndefined();
  });
});
