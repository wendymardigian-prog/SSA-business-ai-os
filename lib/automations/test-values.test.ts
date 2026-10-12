import { describe, it, expect } from "vitest";
import { fieldsOfTree, manualFields, manualValuesFrom, testResponseLabel, testValuesFromSubmission } from "./test-values";
import { explainPaths } from "./explain-paths";
import type { ConditionFieldSpec } from "@/lib/flow-engine/condition-eval";
import type { StepTree } from "./step-tree";

const fields = [{ key: "facturacion" }, { key: "intereses" }, { key: "edad" }, { key: "nombre-completo" }];

describe("testValuesFromSubmission", () => {
  const answers = {
    facturacion: { value: "USD 1.000 a USD 10.000" },
    intereses: { value: ["seo", "ads"] },
    edad: { value: 31 },
  };

  it("lee cada pregunta con su valor real (numero, lista) y el nombre del formulario", () => {
    const values = testValuesFromSubmission({ fields, answers, formName: "Aplicación" });
    expect(values).toMatchObject({
      "form.name": "Aplicación",
      "answer.facturacion": "USD 1.000 a USD 10.000",
      "answer.intereses": ["seo", "ads"],
      "answer.edad": 31,
    });
  });

  it("una pregunta sin responder queda vacia (null), no «sin dato»", () => {
    const values = testValuesFromSubmission({ fields, answers, formName: "A" });
    expect(Object.prototype.hasOwnProperty.call(values, "answer.nombre_completo")).toBe(true);
    expect(values["answer.nombre_completo"]).toBeNull();
  });

  it("las claves con guion pasan a guion bajo, como {{answer.x}}", () => {
    const values = testValuesFromSubmission({ fields, answers: { "nombre-completo": { value: "Ana" } }, formName: "A" });
    expect(values["answer.nombre_completo"]).toBe("Ana");
  });

  it("una pregunta que NO esta en la version no aparece (la condicion dira que ya no existe)", () => {
    const values = testValuesFromSubmission({ fields: [{ key: "facturacion" }], answers: { facturacion: { value: "x" }, vieja: { value: "y" } }, formName: "A" });
    expect(Object.keys(values)).not.toContain("answer.vieja");
  });

  it("el puntaje y la categoria NPS solo si la respuesta los tiene (nunca un cero inventado)", () => {
    const sin = testValuesFromSubmission({ fields, answers, formName: "A", score: null, npsCategory: null });
    expect(Object.keys(sin)).not.toContain("submission.score");
    expect(Object.keys(sin)).not.toContain("submission.nps_category");
    const con = testValuesFromSubmission({ fields, answers, formName: "A", score: 0, npsCategory: "detractor" });
    expect(con["submission.score"]).toBe(0);
    expect(con["submission.nps_category"]).toBe("detractor");
  });
});

describe("a mano", () => {
  const specs: ConditionFieldSpec[] = [
    { path: "answer.plan", label: "Plan", type: "single_select", options: [{ value: "a", label: "A" }] },
    { path: "answer.extras", label: "Extras", type: "multi_select", options: [{ value: "x", label: "X" }] },
    { path: "answer.edad", label: "Edad", type: "number" },
    { path: "answer.acepta", label: "Acepta", type: "boolean" },
    { path: "answer.nombre", label: "Nombre", type: "text" },
    { path: "has_active_sale:", label: "Venta", type: "boolean", argument: { kind: "text" } },
  ];

  it("no pide los campos con argumento ni los viejos", () => {
    expect(manualFields([...specs, { path: "x", label: "x", type: "text", legacy: true }]).map((f) => f.path)).toEqual(["answer.plan", "answer.extras", "answer.edad", "answer.acepta", "answer.nombre"]);
  });

  it("arma los valores con su tipo y deja lo vacio en null", () => {
    const values = manualValuesFrom(manualFields(specs), { "answer.plan": "a", "answer.extras": ["x"], "answer.edad": "30", "answer.acepta": "true" });
    expect(values).toEqual({ "answer.plan": "a", "answer.extras": ["x"], "answer.edad": "30", "answer.acepta": true, "answer.nombre": null });
  });

  it("una lista vacia o un texto en blanco son vacios", () => {
    const values = manualValuesFrom(manualFields(specs), { "answer.extras": [], "answer.nombre": "   ", "answer.acepta": "" });
    expect(values).toMatchObject({ "answer.extras": null, "answer.nombre": null, "answer.acepta": null });
  });

  it("un numero que no es numero llega tal cual y el evaluador lo rechaza", () => {
    const values = manualValuesFrom(manualFields(specs), { "answer.edad": "abc" });
    const tree: StepTree = {
      trigger: { id: "t", data: {} },
      steps: [{ kind: "branch", id: "b", data: {}, otherwise: [], paths: [{ id: "p", label: "Mayor", logic: "and", steps: [], conditions: [{ field: "answer.edad", operator: "gt", value: "1", valueType: "number" }] }] }],
    };
    expect(explainPaths(tree, values, specs).branches[0].isElse).toBe(true);
  });
});

describe("etiqueta de una respuesta", () => {
  it("fecha + nombre y email", () => {
    expect(testResponseLabel({ whenText: "12/10/2026, 15:30", name: "Ana", email: "ana@x.com" })).toBe("12/10/2026, 15:30 · Ana (ana@x.com)");
  });
  it("solo nombre, solo email o ninguno", () => {
    expect(testResponseLabel({ whenText: "h", name: "Ana" })).toBe("h · Ana");
    expect(testResponseLabel({ whenText: "h", email: "a@x.com" })).toBe("h · a@x.com");
    expect(testResponseLabel({ whenText: "h", name: " ", email: null })).toBe("h · Sin contacto");
  });
});

describe("fieldsOfTree", () => {
  it("junta los campos del servidor, sin repetir rutas", () => {
    const inputs = {
      triggerSchema: [{ path: "answer.plan", label: "Plan", type: "text" as const, group: "Del formulario" }],
      customFields: [],
      tags: [],
      sequences: [],
    };
    const branch = (id: string) => ({ kind: "branch" as const, id, data: {}, paths: [], otherwise: [] });
    const found = fieldsOfTree({ trigger: { id: "t", data: {} }, steps: [{ ...branch("b1"), paths: [], otherwise: [branch("b2")] }] }, inputs);
    expect(found.filter((f) => f.path === "answer.plan")).toHaveLength(1);
  });
});
