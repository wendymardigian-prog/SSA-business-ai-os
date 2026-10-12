import { describe, it, expect } from "vitest";
import { explainPaths, hasBranchSteps, MISSING_REASON, NO_DATA_REASON, testResolver } from "./explain-paths";
import { MissingFieldError, type BranchCondition, type ConditionFieldSpec } from "@/lib/flow-engine/condition-eval";
import type { ActionStep, BranchPathStep, BranchStep, Step, StepTree } from "./step-tree";

const FACT = ["Menos de USD 1.000", "USD 1.000 a USD 10.000", "Más de USD 10.000"];

const FIELDS: ConditionFieldSpec[] = [
  { path: "answer.facturacion", label: "Facturación", type: "single_select", options: FACT.map((value) => ({ value, label: value })) },
  { path: "answer.presupuesto", label: "Presupuesto", type: "number" },
  { path: "answer.intereses", label: "Intereses", type: "multi_select", options: [{ value: "seo", label: "SEO" }, { value: "ads", label: "Publicidad" }] },
];

const tree = (steps: Step[]): StepTree => ({ trigger: { id: "trigger", data: { triggerType: "form_submitted" } }, steps });
const action = (id: string): ActionStep => ({ kind: "action", id, nodeType: "action", data: { actionType: "addTag", tagName: id } });
const path = (id: string, label: string, conditions: BranchCondition[], steps: Step[] = [], logic: "and" | "or" = "and"): BranchPathStep => ({ id, label, logic, conditions, steps });
const branch = (id: string, paths: BranchPathStep[], otherwise: Step[] = [], data: Record<string, unknown> = {}): BranchStep => ({ kind: "branch", id, data, paths, otherwise });

const fact = (value: string): BranchCondition => ({ field: "answer.facturacion", operator: "is", value, valueType: "single_select" });
const presupuesto = (operator: string, value: string): BranchCondition => ({ field: "answer.presupuesto", operator, value, valueType: "number" });

const ALTA = path("p_alta", "Facturación alta", [fact(FACT[2])]);
const MEDIA = path("p_media", "Facturación media", [fact(FACT[1])]);

describe("explainPaths: por donde iria", () => {
  const t = tree([branch("b1", [ALTA, MEDIA])]);

  it("dice el camino que toma y explica cada condicion con ✓ o ✗", () => {
    const { branches } = explainPaths(t, { "answer.facturacion": FACT[1] }, FIELDS);
    expect(branches).toHaveLength(1);
    const b = branches[0];
    expect(b.takenPathId).toBe("p_media");
    expect(b.takenLabel).toBe("Facturación media");
    expect(b.headline).toBe("Iría por «Facturación media»");
    // Mira el primero (no se cumple) y el segundo (se cumple).
    expect(b.paths.map((p) => [p.label, p.passed])).toEqual([["Facturación alta", false], ["Facturación media", true]]);
    expect(b.paths[0].conditions[0].line).toBe(`Facturación es «${FACT[2]}» ✗`);
    expect(b.paths[1].conditions[0].line).toBe(`Facturación es «${FACT[1]}» ✓`);
  });

  it("en cuanto un camino se cumple, los de despues ni se miran", () => {
    const { branches } = explainPaths(tree([branch("b1", [ALTA, MEDIA])]), { "answer.facturacion": FACT[2] }, FIELDS);
    expect(branches[0].paths.map((p) => p.id)).toEqual(["p_alta"]);
  });

  it("gana el PRIMERO que se cumple aunque despues se cumpla otro", () => {
    const amplio = path("p_amplio", "Cualquiera con presupuesto", [presupuesto("gt", "0")]);
    const { branches } = explainPaths(tree([branch("b1", [amplio, ALTA])]), { "answer.facturacion": FACT[2], "answer.presupuesto": "500" }, FIELDS);
    expect(branches[0].takenPathId).toBe("p_amplio");
  });

  it("si ninguno se cumple, va por «Si no» y lo dice", () => {
    const { branches } = explainPaths(t, { "answer.facturacion": FACT[0] }, FIELDS);
    expect(branches[0]).toMatchObject({ takenPathId: "else", takenLabel: "Si no", isElse: true, headline: "Ningún camino se cumple: iría por «Si no»" });
    expect(branches[0].paths).toHaveLength(2);
  });

  it("una pregunta sin responder (null) es vacia: no cumple `es`, pero `está vacío` si", () => {
    const empty: BranchCondition = { field: "answer.facturacion", operator: "is_empty", valueType: "single_select" };
    const { branches } = explainPaths(tree([branch("b1", [ALTA, path("p_vacio", "Sin responder", [empty])])]), { "answer.facturacion": null }, FIELDS);
    expect(branches[0].takenPathId).toBe("p_vacio");
    expect(branches[0].paths[1].conditions[0].line).toBe("Facturación está vacío ✓");
  });

  it("explica varias condiciones con y / o", () => {
    const both = path("p_ambas", "Alta y con presupuesto", [fact(FACT[2]), presupuesto("gt", "5000")]);
    const { branches } = explainPaths(tree([branch("b1", [both])]), { "answer.facturacion": FACT[2], "answer.presupuesto": "3000" }, FIELDS);
    const p = branches[0].paths[0];
    expect(p.passed).toBe(false);
    expect(p.conditions.map((c) => c.line)).toEqual([`Facturación es «${FACT[2]}» ✓`, "Presupuesto es mayor que 5000 ✗"]);
  });

  it("usa el nombre del nodo y las etiquetas de las opciones", () => {
    const options: ConditionFieldSpec[] = [{ ...FIELDS[0], options: [{ value: "a", label: "Plan A" }] }];
    const c: BranchCondition = { field: "answer.facturacion", operator: "is", value: "a", valueType: "single_select" };
    const { branches } = explainPaths(tree([branch("b1", [path("p1", "Va A", [c])], [], { label: "Según plan" })]), { "answer.facturacion": "a" }, options);
    expect(branches[0].name).toBe("Según plan");
    expect(branches[0].paths[0].conditions[0].text).toBe("Facturación es «Plan A»");
  });

  it("un camino sin nombre se lee «Camino N»", () => {
    const { branches } = explainPaths(tree([branch("b1", [path("p1", "  ", [fact(FACT[0])])])]), { "answer.facturacion": FACT[0] }, FIELDS);
    expect(branches[0].takenLabel).toBe("Camino 1");
  });

  it("una seleccion multiple se compara como lista", () => {
    const c: BranchCondition = { field: "answer.intereses", operator: "includes_all", values: ["seo", "ads"], valueType: "multi_select" };
    const t2 = tree([branch("b1", [path("p1", "Los dos", [c])])]);
    expect(explainPaths(t2, { "answer.intereses": ["seo", "ads"] }, FIELDS).branches[0].takenPathId).toBe("p1");
    expect(explainPaths(t2, { "answer.intereses": ["seo"] }, FIELDS).branches[0].takenPathId).toBe("else");
  });

  it("no cambia el arbol ni los valores", () => {
    const frozenTree = structuredClone(t);
    const values = { "answer.facturacion": FACT[1] };
    const frozenValues = structuredClone(values);
    explainPaths(t, values, FIELDS);
    expect(t).toEqual(frozenTree);
    expect(values).toEqual(frozenValues);
  });
});

describe("explainPaths: lo que no se puede leer", () => {
  it("un campo de un paso anterior (o del contacto) es «sin dato en la prueba» y no se cumple", () => {
    const upstream: BranchCondition = { field: "variable:respuesta_http", operator: "is_not_empty", valueType: "text" };
    const { branches } = explainPaths(tree([branch("b1", [path("p1", "Con dato", [upstream])])]), {}, []);
    const c = branches[0].paths[0].conditions[0];
    expect(c).toMatchObject({ status: "no_data", ok: false, reason: NO_DATA_REASON });
    expect(c.line).toBe(`variable:respuesta_http tiene un valor ✗ (${NO_DATA_REASON})`);
    expect(branches[0].isElse).toBe(true);
  });

  it("`es distinto de` sobre algo sin dato tampoco se cumple (no se asume vacio)", () => {
    const c: BranchCondition = { field: "contact.lead_temperature", operator: "is_not", value: "hot", valueType: "single_select" };
    expect(explainPaths(tree([branch("b1", [path("p1", "No caliente", [c])])]), {}, []).branches[0].isElse).toBe(true);
  });

  it("una pregunta que ya no existe lo dice", () => {
    const old: BranchCondition = { field: "answer.borrada", operator: "is", value: "x", valueType: "text" };
    const { branches } = explainPaths(tree([branch("b1", [path("p1", "Vieja", [old])])]), { "answer.facturacion": FACT[0] }, FIELDS);
    expect(branches[0].paths[0].conditions[0]).toMatchObject({ status: "missing", ok: false, reason: MISSING_REASON });
    expect(branches[0].paths[0].conditions[0].line).toContain(`(${MISSING_REASON})`);
    expect(branches[0].isElse).toBe(true);
  });

  it("el resolver lanza MissingFieldError para answer.* y otro error para el resto", () => {
    const resolve = testResolver({ "answer.a": "1" });
    expect(resolve("answer.a")).toBe("1");
    expect(() => resolve("answer.b")).toThrow(MissingFieldError);
    expect(() => resolve("contact.tags")).toThrow(/Sin dato/);
    expect(() => resolve("contact.tags")).not.toThrow(MissingFieldError);
  });

  it("un campo heredado del prototipo no cuenta como dato", () => {
    expect(() => testResolver({})("constructor")).toThrow();
  });
});

describe("explainPaths: Condiciones anidadas", () => {
  const inner = branch("inner", [path("p_in", "Con presupuesto alto", [presupuesto("gte", "5000")])], [action("a_in_else")]);
  const other = branch("other", [path("p_x", "Nunca", [presupuesto("gt", "0")])]);
  const t = tree([branch("outer", [path("p_alta", "Alta", [fact(FACT[2])], [inner]), path("p_media", "Media", [fact(FACT[1])], [other])], [])]);

  it("sigue el camino que TOMA y explica lo que cuelga de el", () => {
    const { branches } = explainPaths(t, { "answer.facturacion": FACT[2], "answer.presupuesto": "9000" }, FIELDS);
    expect(branches.map((b) => b.stepId)).toEqual(["outer", "inner"]);
    expect(branches[1].takenPathId).toBe("p_in");
    expect(branches[1].inside).toBe("dentro de «Alta»");
  });

  it("lo que cuelga de un camino que no se toma no se explica", () => {
    const { branches } = explainPaths(t, { "answer.facturacion": FACT[2], "answer.presupuesto": "9000" }, FIELDS);
    expect(branches.map((b) => b.stepId)).not.toContain("other");
  });

  it("si va por «Si no», sigue lo que hay en «Si no»", () => {
    const elseInner = branch("else_inner", [path("p_e", "Sea cual sea", [presupuesto("gt", "-1")])]);
    const t2 = tree([branch("outer", [ALTA], [elseInner])]);
    const { branches } = explainPaths(t2, { "answer.facturacion": FACT[0], "answer.presupuesto": "1" }, FIELDS);
    expect(branches.map((b) => b.stepId)).toEqual(["outer", "else_inner"]);
    expect(branches[1].inside).toBe("dentro de «Si no»");
  });

  it("un «Si» plano no corta el recorrido", () => {
    const gate: Step = { kind: "gate", id: "g", data: {}, steps: [inner] };
    const { branches } = explainPaths(tree([gate]), { "answer.presupuesto": "9000" }, FIELDS);
    expect(branches.map((b) => b.stepId)).toEqual(["inner"]);
  });
});

describe("hasBranchSteps", () => {
  it("es true con un Condiciones, tambien dentro de un «Si»", () => {
    expect(hasBranchSteps(tree([action("a")]))).toBe(false);
    expect(hasBranchSteps(tree([branch("b", [ALTA])]))).toBe(true);
    expect(hasBranchSteps(tree([{ kind: "gate", id: "g", data: {}, steps: [branch("b", [ALTA])] }]))).toBe(true);
    expect(hasBranchSteps(null)).toBe(false);
  });
});
