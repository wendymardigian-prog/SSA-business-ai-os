import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "./items";

describe("orden del menú (F13)", () => {
  it("Dashboards es el primer ítem, con ícono de grilla", () => {
    expect(NAV_ITEMS[0].name).toBe("Dashboards");
    expect(NAV_ITEMS[0].href).toBe("/dashboard/dashboards/chat");
    expect(NAV_ITEMS[0].icon).toBe("LayoutGrid");
  });
  it("Analytics ya no existe", () => {
    expect(NAV_ITEMS.some((i) => i.name === "Analytics")).toBe(false);
    expect(NAV_ITEMS.some((i) => i.href.includes("/analytics"))).toBe(false);
  });
  it("los nombres no se repiten", () => {
    expect(new Set(NAV_ITEMS.map((i) => i.name)).size).toBe(NAV_ITEMS.length);
  });
});
