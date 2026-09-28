import { describe, expect, it } from "vitest";
import { applyContactAssignment, defaultAssignmentForArea } from "./assignment";

describe("applyContactAssignment (F22)", () => {
  it("vendedor_if_empty asigna solo si esta vacio", () => {
    expect(applyContactAssignment({ setter_id: null, vendedor_id: null }, "host", "vendedor_if_empty")).toEqual({ vendedor_id: "host" });
    expect(applyContactAssignment({ setter_id: null, vendedor_id: "otra" }, "host", "vendedor_if_empty")).toEqual({});
  });
  it("setter_if_empty idem; none nunca", () => {
    expect(applyContactAssignment({ setter_id: null, vendedor_id: null }, "host", "setter_if_empty")).toEqual({ setter_id: "host" });
    expect(applyContactAssignment({ setter_id: "x", vendedor_id: null }, "host", "setter_if_empty")).toEqual({});
    expect(applyContactAssignment({ setter_id: null, vendedor_id: null }, "host", "none")).toEqual({});
  });
});

describe("defaultAssignmentForArea (F22)", () => {
  it("Ventas de sistema → vendedor si esta vacio; Servicio y areas nuevas → none", () => {
    expect(defaultAssignmentForArea({ name: "Ventas", is_system: true })).toBe("vendedor_if_empty");
    expect(defaultAssignmentForArea({ name: "Servicio", is_system: true })).toBe("none");
    expect(defaultAssignmentForArea({ name: "Comunidad", is_system: false })).toBe("none");
    expect(defaultAssignmentForArea({ name: "Ventas", is_system: false })).toBe("none");
    expect(defaultAssignmentForArea(null)).toBe("none");
  });
});
