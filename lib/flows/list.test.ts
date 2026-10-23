import { describe, expect, it } from "vitest";
import { EMPTY_FLOW_QUERY, filterFlows, flowCounts, flowListQueryString, flowOrigin, parseFlowListQuery, type FlowListRow } from "./list";

const row = (over: Partial<FlowListRow>): FlowListRow => ({
  id: "f",
  name: "Bienvenida",
  description: null,
  categories: [],
  status: "draft",
  origin: "manual",
  triggerLabel: "Primer mensaje",
  stepCount: 2,
  updatedAt: "2026-10-01T00:00:00Z",
  hasDraft: false,
  blockedNote: null,
  ...over,
});

const rows = [
  row({ id: "1", name: "Bienvenida", categories: ["Ventas", "Instagram"], status: "published" }),
  row({ id: "2", name: "Recordatorio de reunión", description: "Avisa 24 h antes", categories: ["Agenda"], origin: "agenda", triggerLabel: "Antes de una reunión" }),
  row({ id: "3", name: "Cobranza", categories: ["ventas"], origin: "sistema", status: "archived" }),
];

describe("filterFlows", () => {
  it("busca en nombre, descripcion, categorias y disparador, sin tildes", () => {
    expect(filterFlows(rows, { ...EMPTY_FLOW_QUERY, q: "reunion" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterFlows(rows, { ...EMPTY_FLOW_QUERY, q: "24 h" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterFlows(rows, { ...EMPTY_FLOW_QUERY, q: "instagram" }).map((r) => r.id)).toEqual(["1"]);
  });
  it("categorias: cualquiera de las elegidas, sin mirar mayusculas", () => {
    expect(filterFlows(rows, { ...EMPTY_FLOW_QUERY, categories: ["VENTAS"] }).map((r) => r.id)).toEqual(["1", "3"]);
    expect(filterFlows(rows, { ...EMPTY_FLOW_QUERY, categories: ["agenda", "instagram"] }).map((r) => r.id)).toEqual(["1", "2"]);
  });
  it("estado y origen", () => {
    expect(filterFlows(rows, { ...EMPTY_FLOW_QUERY, status: "published" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterFlows(rows, { ...EMPTY_FLOW_QUERY, origin: "sistema" }).map((r) => r.id)).toEqual(["3"]);
  });
});

describe("la URL", () => {
  it("ida y vuelta, ignorando lo que no se entiende", () => {
    const q = { q: "hola", status: "published" as const, origin: "agenda" as const, categories: ["Ventas", "Agenda"] };
    expect(parseFlowListQuery(Object.fromEntries(new URLSearchParams(flowListQueryString(q))))).toEqual(q);
    expect(parseFlowListQuery({ estado: "cualquiera", origen: "marte" })).toEqual(EMPTY_FLOW_QUERY);
  });
});

describe("conteos y origen", () => {
  it("une las categorias con distinta forma", () => {
    expect(flowCounts(rows).categories[0]).toEqual({ name: "Ventas", count: 2 });
    expect(flowCounts(rows).status).toMatchObject({ all: 3, published: 1, archived: 1, draft: 1 });
  });
  it("flowOrigin", () => {
    expect(flowOrigin({ form_id: "x" })).toBe("formularios");
    expect(flowOrigin({ event_type_id: "x" })).toBe("agenda");
    expect(flowOrigin({ template_key: "task_payment_overdue" })).toBe("sistema");
    expect(flowOrigin({})).toBe("manual");
  });
});
