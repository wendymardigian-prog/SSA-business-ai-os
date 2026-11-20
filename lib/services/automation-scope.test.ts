// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { serviceEventMatches } from "./automation";

const ev = (extra: Record<string, unknown> = {}) => ({ service_id: "s1", product_id: "p1", variant_id: "v1", service_status: "active", ...extra });

describe("serviceEventMatches: productos y variantes, uno, varios o todos", () => {
  it("sin nada elegido corre para cualquier producto, también uno nuevo", () => {
    expect(serviceEventMatches({}, ev({ product_id: "p-nuevo", variant_id: "v-nueva" }))).toBe(true);
  });
  it("dos variantes de productos distintos", () => {
    const c = { variant_ids: ["v1", "v9"] };
    expect(serviceEventMatches(c, ev())).toBe(true);
    expect(serviceEventMatches(c, ev({ product_id: "p9", variant_id: "v9" }))).toBe(true);
    expect(serviceEventMatches(c, ev({ variant_id: "v2" }))).toBe(false);
  });
  it("un producto entero incluye sus variantes nuevas", () => {
    expect(serviceEventMatches({ product_ids: ["p1"] }, ev({ variant_id: "v-nueva" }))).toBe(true);
    expect(serviceEventMatches({ product_ids: ["p1"] }, ev({ product_id: "p2" }))).toBe(false);
  });
  it("los filtros viejos de un solo valor siguen andando", () => {
    expect(serviceEventMatches({ product_id: "p1", variant_id: "v1" }, ev())).toBe(true);
    expect(serviceEventMatches({ product_id: "p1", variant_id: "v2" }, ev())).toBe(false);
    expect(serviceEventMatches({ product_id: "p2" }, ev())).toBe(false);
  });
  it("relativo de un disparador: el id manda y además la elección múltiple", () => {
    const p = ev({ trigger_id: "t1" });
    expect(serviceEventMatches({ variant_ids: ["v1"] }, p, "t1")).toBe(true);
    expect(serviceEventMatches({ variant_ids: ["v2"] }, p, "t1")).toBe(false);
    expect(serviceEventMatches({}, p, "t2")).toBe(false);
  });
  it("de una automatización (cifra, relativo en horas)", () => {
    const p = ev({ flow_id: "f1", trigger_id: "t1" });
    expect(serviceEventMatches({ product_ids: ["p1"] }, p, "t-otro", "f1")).toBe(true);
    expect(serviceEventMatches({ product_ids: ["p2"] }, p, "t-otro", "f1")).toBe(false);
  });
});

describe("estado y semáforo", () => {
  it("a qué estado pasó y desde cuál", () => {
    const p = ev({ service_status: "completed", previous_status: "active" });
    expect(serviceEventMatches({ to_statuses: ["completed", "cancelled"] }, p)).toBe(true);
    expect(serviceEventMatches({ to_statuses: ["paused"] }, p)).toBe(false);
    expect(serviceEventMatches({ from_statuses: ["paused"] }, p)).toBe(false);
    expect(serviceEventMatches({ to_statuses: [] }, p)).toBe(true);
  });
  it("a qué color pasó el semáforo (gray y grey son lo mismo)", () => {
    expect(serviceEventMatches({ lights: ["red"] }, ev({ light: "red" }))).toBe(true);
    expect(serviceEventMatches({ lights: ["red"] }, ev({ light: "yellow" }))).toBe(false);
    expect(serviceEventMatches({ lights: ["grey"] }, ev({ light: "gray" }))).toBe(true);
  });
});
