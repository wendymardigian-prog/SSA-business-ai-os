import { describe, it, expect } from "vitest";
import {
  availableConditionFields,
  upstreamOf,
  staleConditions,
  findFieldSpec,
  flattenFields,
  customFieldValueType,
  GROUP_UPSTREAM,
  GROUP_CONTACT,
} from "./condition-catalog";
import { pickPath, type BranchCondition, type BranchPath } from "./condition-eval";
import { formVariableSchema } from "@/lib/forms/automation/variable-schema";
import { bookingVariableSchema } from "@/lib/scheduling/automation/variable-schema";
import { salesVariableSchema } from "@/lib/sales/automation/variable-schema";
import type { FormField } from "@/lib/forms/fields";

const FACT = ["Menos de USD 1.000", "USD 1.000 a USD 10.000", "Más de USD 10.000"];
const form: FormField[] = [
  { id: "1", key: "facturacion", type: "single_select", label: "Facturación", required: true, options: FACT },
  { id: "2", key: "edad", type: "number", label: "Edad", required: false },
];
const triggerSchema = formVariableSchema("form_submitted", [{ id: "f1", fields: form }]);

const baseInput = {
  triggerSchema,
  customFields: [
    { slug: "presupuesto", name: "Presupuesto", type: "number" },
    { slug: "alta", name: "Fecha de alta", type: "date" },
    { slug: "sitio", name: "Sitio web", type: "url" },
    { slug: "vip", name: "Es VIP", type: "boolean" },
  ],
  tags: [{ name: "vip" }, { name: "frio" }, { name: "vip" }],
  sequences: [{ id: "s1", name: "Bienvenida" }],
};

describe("availableConditionFields: grupos y orden", () => {
  const groups = availableConditionFields(baseInput);
  const labels = groups.map((g) => g.label);

  it("primero el disparador, despues pasos anteriores (si hay), contacto, llamadas y ventas", () => {
    expect(labels).toEqual(["Del formulario", "Del contacto", "De sus llamadas", "De sus ventas"]);
    const withUpstream = availableConditionFields({ ...baseInput, upstreamNodes: [{ id: "n1", type: "aiResponse", data: {} }] });
    expect(withUpstream.map((g) => g.label)).toEqual(["Del formulario", GROUP_UPSTREAM, GROUP_CONTACT, "De sus llamadas", "De sus ventas"]);
  });

  it("el criterio de Facturación: seleccion unica con sus 3 opciones", () => {
    const spec = findFieldSpec(groups, "answer.facturacion")!;
    expect(spec.type).toBe("single_select");
    expect(spec.label).toBe("Facturación");
    expect(spec.options?.map((o) => o.value)).toEqual(FACT);
  });

  it("del contacto: tags (sin repetir), secuencias con id, temperatura y campos personalizados con su tipo", () => {
    const tags = findFieldSpec(groups, "contact.tags")!;
    expect(tags.type).toBe("multi_select");
    expect(tags.options).toEqual([{ value: "vip", label: "vip" }, { value: "frio", label: "frio" }]);
    expect(findFieldSpec(groups, "contact.sequences")!.options).toEqual([{ value: "s1", label: "Bienvenida" }]);
    expect(findFieldSpec(groups, "contact.lead_temperature")!.options?.map((o) => o.value)).toEqual(["cold", "warm", "hot"]);
    expect(findFieldSpec(groups, "presupuesto")!.type).toBe("number");
    expect(findFieldSpec(groups, "alta")!.type).toBe("date");
    expect(findFieldSpec(groups, "sitio")!.type).toBe("text");
    expect(findFieldSpec(groups, "vip")!.type).toBe("boolean");
  });

  it("los campos de siempre (canal, llamadas, ventas) traen su tipo; los que piden argumento, tambien", () => {
    expect(findFieldSpec(groups, "platform")!.type).toBe("single_select");
    expect(findFieldSpec(groups, "platform")!.options?.map((o) => o.value)).toContain("whatsapp");
    expect(findFieldSpec(groups, "last_call_lead_score:")!.type).toBe("number");
    expect(findFieldSpec(groups, "total_purchased")!.type).toBe("number");
    const active = findFieldSpec(groups, "has_active_sale:prod-1")!;
    expect(active.path).toBe("has_active_sale:");
    expect(active.argument).toMatchObject({ kind: "text" });
  });

  it("tag: y sequence: siguen, marcados como viejos (los cubre contact.tags / contact.sequences); variable: no se ofrece", () => {
    expect(findFieldSpec(groups, "tag:vip")!.legacy).toBe(true);
    expect(findFieldSpec(groups, "sequence:s1")!.legacy).toBe(true);
    expect(flattenFields(groups).some((f) => f.path === "variable:")).toBe(false);
  });

  it("no hay rutas repetidas", () => {
    const paths = flattenFields(groups).map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("sin nada cargado igual hay campos del contacto, y no revienta", () => {
    const groupsEmpty = availableConditionFields({});
    expect(groupsEmpty.map((g) => g.label)).toContain(GROUP_CONTACT);
    expect(findFieldSpec(groupsEmpty, "contact.tags")!.options).toEqual([]);
  });

  it("Agenda y Ventas aportan sus grupos como texto", () => {
    const booking = availableConditionFields({ triggerSchema: bookingVariableSchema() });
    expect(booking[0].label).toBe("De la reunión");
    expect(findFieldSpec(booking, "booking.status")!.type).toBe("text");
    const sales = availableConditionFields({ triggerSchema: salesVariableSchema("payment_status_changed") });
    expect(findFieldSpec(sales, "payment.to_status")).toBeDefined();
    expect(findFieldSpec(availableConditionFields({ triggerSchema: salesVariableSchema("sale_created") }), "payment.to_status")).toBeUndefined();
  });

  it("customFieldValueType", () => {
    expect(customFieldValueType("email")).toBe("text");
    expect(customFieldValueType("number")).toBe("number");
  });
});

describe("pasos anteriores: crm antes SI, despues NO", () => {
  // trigger -> A -> B(branch) -> C ; B -> D (otra rama)
  const graph = {
    nodes: [
      { id: "t", type: "trigger" },
      { id: "http", type: "action", data: { actionType: "httpRequest", responseVariable: "crm", label: "Buscar en el CRM" } },
      { id: "b", type: "branch", data: { paths: [] } },
      { id: "ia", type: "aiResponse", data: {} },
      { id: "otra", type: "action", data: { actionType: "httpRequest", responseVariable: "otra" } },
    ],
    edges: [
      { source: "t", target: "http" },
      { source: "http", target: "b" },
      { source: "b", target: "ia" },
      { source: "b", target: "otra" },
    ],
  };

  it("upstreamOf: solo lo que esta antes en el mismo camino, del disparador al nodo", () => {
    expect(upstreamOf(graph, "b").map((n) => n.id)).toEqual(["t", "http"]);
    expect(upstreamOf(graph, "ia").map((n) => n.id)).toEqual(["t", "http", "b"]);
    expect(upstreamOf(graph, "t")).toEqual([]);
  });

  it("antes del branch, la respuesta del CRM se ofrece; en el camino de al lado o despues, no", () => {
    const before = availableConditionFields({ upstreamNodes: upstreamOf(graph, "b") });
    expect(findFieldSpec(before, "variable:crm")?.label).toBe("Respuesta de la llamada HTTP (crm) · Buscar en el CRM");
    // Un nodo de la rama de al lado ("otra") no es ancestro de "ia".
    const sibling = availableConditionFields({ upstreamNodes: upstreamOf(graph, "ia") });
    expect(findFieldSpec(sibling, "variable:otra")).toBeUndefined();
    // Y el nodo que viene DESPUES del branch no aporta a un branch anterior.
    const earlier = availableConditionFields({ upstreamNodes: upstreamOf(graph, "http") });
    expect(findFieldSpec(earlier, "variable:crm")).toBeUndefined();
  });

  it("un ciclo no cuelga la busqueda", () => {
    const cyc = { nodes: [{ id: "a", type: "delay" }, { id: "b", type: "delay" }], edges: [{ source: "a", target: "b" }, { source: "b", target: "a" }] };
    expect(upstreamOf(cyc, "a").map((n) => n.id)).toEqual(["b"]);
  });
});

describe("staleConditions: la pregunta ya no existe", () => {
  const groups = availableConditionFields(baseInput);
  const cond = (field: string): BranchCondition => ({ field, operator: "is_empty", valueType: "text" });

  it("una respuesta de una pregunta que ya no esta se marca", () => {
    const stale = staleConditions({ logic: "and", conditions: [cond("answer.facturacion"), cond("answer.borrada")] }, groups);
    expect(stale).toEqual([{ index: 1, field: "answer.borrada", message: "Esta pregunta ya no existe en el formulario." }]);
  });
  it("un campo personalizado borrado se marca; uno que esta, no", () => {
    expect(staleConditions({ logic: "and", conditions: [cond("presupuesto"), cond("viejo")] }, groups).map((s) => s.field)).toEqual(["viejo"]);
  });
  it("lo que el catalogo no puede juzgar no se marca (variable:, tag:, campos con prefijo, contact.*)", () => {
    const conds = ["variable:x", "tag:cualquiera", "platform", "last_call_outcome:", "has_active_sale:abc", "contact.tags"].map(cond);
    expect(staleConditions({ logic: "and", conditions: conds }, groups)).toEqual([]);
  });
  it("sin condiciones o con un grupo roto no revienta", () => {
    expect(staleConditions({ logic: "and", conditions: [] }, groups)).toEqual([]);
    expect(staleConditions({ logic: "and" } as never, groups)).toEqual([]);
  });
});

describe("el catalogo y el evaluador hablan el mismo idioma", () => {
  it("los operadores del tipo de cada campo del catalogo existen (el campo de Facturacion se compara con `is_any_of`)", () => {
    const paths: BranchPath[] = [
      { id: "p_alto", label: "Alto", logic: "and", conditions: [{ field: "answer.facturacion", operator: "is", value: FACT[2], valueType: "single_select" }] },
      { id: "p_medio", label: "Medio", logic: "and", conditions: [{ field: "answer.facturacion", operator: "is_any_of", values: [FACT[0], FACT[1]], valueType: "single_select" }] },
    ];
    expect(pickPath(paths, () => FACT[2]).path?.id).toBe("p_alto");
    expect(pickPath(paths, () => FACT[1]).path?.id).toBe("p_medio");
  });
});
