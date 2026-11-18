import { describe, expect, it } from "vitest";
import type { CategoryRow } from "@/lib/scheduling/categories";
import { manualAreaOptions, manualHostOptions } from "./manual-options";

const area = (id: string, name: string, extra: Partial<CategoryRow> = {}): CategoryRow => ({
  id,
  parent_id: null,
  name,
  color: null,
  position: 0,
  is_system: true,
  archived_at: null,
  system_key: name.toLowerCase(),
  ...extra,
});

const cats: CategoryRow[] = [
  area("v", "Ventas"),
  area("s", "Servicio"),
  { ...area("t", "Onboarding"), parent_id: "s", system_key: null },
  area("o", "Otros"),
  area("x", "Vieja", { archived_at: "2026-01-01T00:00:00Z", is_system: false, system_key: null }),
];

describe("manualAreaOptions", () => {
  it("sin preferencia, la de siempre: «Otros», solo áreas vivas", () => {
    const r = manualAreaOptions(cats);
    expect(r.map((a) => a.id)).toEqual(["v", "s", "o"]);
    expect(r.find((a) => a.isDefault)?.id).toBe("o");
  });

  it("desde las fichas de Servicios, «Servicio» por su clave estable", () => {
    expect(manualAreaOptions(cats, "servicio").find((a) => a.isDefault)?.id).toBe("s");
  });

  it("si la renombraron, la encuentra igual por la clave", () => {
    const renamed = cats.map((c) => (c.id === "s" ? { ...c, name: "Clientes" } : c));
    expect(manualAreaOptions(renamed, "servicio").find((a) => a.isDefault)?.id).toBe("s");
  });

  it("sin clave (antes de la 00300), por el nombre si es de sistema", () => {
    const noKey = cats.map((c) => ({ ...c, system_key: null }));
    expect(manualAreaOptions(noKey, "servicio").find((a) => a.isDefault)?.id).toBe("s");
  });

  it("si no hay «Servicio», cae a «Otros»", () => {
    const without = cats.filter((c) => c.id !== "s" && c.parent_id !== "s");
    expect(manualAreaOptions(without, "servicio").find((a) => a.isDefault)?.id).toBe("o");
  });

  it("siempre exactamente una por defecto", () => {
    expect(manualAreaOptions(cats, "servicio").filter((a) => a.isDefault)).toHaveLength(1);
  });
});

describe("manualHostOptions", () => {
  it("ordena por nombre y dice quién puede crear un Meet", () => {
    const meet = { calendars: [], connections: [], defaultDestinationByUser: new Map() };
    const r = manualHostOptions(new Map([["b", "Beto"], ["a", "Ana"]]), meet);
    expect(r.map((h) => h.label)).toEqual(["Ana", "Beto"]);
    expect(r.every((h) => h.meetAvailable === false)).toBe(true);
  });
});
