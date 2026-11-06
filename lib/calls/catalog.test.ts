import { describe, expect, it } from "vitest";
import type { CategoryRow } from "@/lib/scheduling/categories";
import { callCategoryLabel, categoryGroups, classifierOptions, legacyCallTypeFor, readCategorySnapshot, ruleTargetSnapshot, callDisplayLabel } from "./catalog";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, name: string, parent: number | null, key: string | null = null, over: Partial<CategoryRow> = {}): CategoryRow => ({
  id: id(n), parent_id: parent ? id(parent) : null, name, color: null, position: n, is_system: !!key, archived_at: null, system_key: key, description: null, ...over,
});

const cats: CategoryRow[] = [
  row(1, "Ventas", null, "ventas"),
  row(2, "Cierre", 1, "ventas.cierre"),
  row(3, "Seguimiento", 1, "ventas.seguimiento"),
  row(4, "Demo", 1),
  row(5, "Servicio", null, "servicio"),
  row(6, "Onboarding", 5),
  row(7, "Equipo", null, "equipo"),
  row(8, "Otros", null, "otros"),
  row(9, "Mesa redonda", 8),
  row(10, "Viejo", 1, null, { archived_at: "2026-01-01T00:00:00Z" }),
  row(11, "Marketing", null),
];

const snap = (categoryId: number) => ruleTargetSnapshot(id(categoryId), cats);

describe("ruleTargetSnapshot", () => {
  it("una regla nueva apunta a un id de la lista", () => {
    expect(snap(2)).toMatchObject({ area_name: "Ventas", type_name: "Cierre" });
    expect(snap(7)).toMatchObject({ area_name: "Equipo", type_id: null });
  });

  it("una regla vieja se convierte por su clave, aunque el nombre haya cambiado", () => {
    const renamed = cats.map((c) => (c.system_key === "ventas.cierre" ? { ...c, name: "Cierre final" } : c));
    expect(ruleTargetSnapshot("cierre", renamed)).toMatchObject({ type_name: "Cierre final" });
    expect(ruleTargetSnapshot("equipo", cats)).toMatchObject({ area_name: "Equipo" });
    expect(ruleTargetSnapshot("cliente", cats)).toMatchObject({ area_name: "Servicio" });
    expect(ruleTargetSnapshot("clase", cats)).toMatchObject({ area_name: "Servicio" });
    expect(ruleTargetSnapshot("otra", cats)).toMatchObject({ area_name: "Otros" });
  });

  it("un tipo propio viejo se busca por su nombre bajo Otros", () => {
    expect(ruleTargetSnapshot("mesa", cats, [{ clave: "mesa", nombre: "Mesa redonda" }])).toMatchObject({ type_name: "Mesa redonda" });
    expect(ruleTargetSnapshot("mesa", cats)).toBeNull();
  });

  it("lo archivado o lo que no existe no decide", () => {
    expect(snap(10)).toBeNull();
    expect(ruleTargetSnapshot(id(99), cats)).toBeNull();
    expect(ruleTargetSnapshot("cualquiera", cats)).toBeNull();
  });
});

describe("legacyCallTypeFor", () => {
  it("una reunion de Servicio NO queda como cierre", () => {
    expect(legacyCallTypeFor(snap(6), cats)).toBe("cliente");
    expect(legacyCallTypeFor(snap(5), cats)).toBe("cliente");
  });

  it("los tipos de venta conservan su valor, tambien renombrados", () => {
    expect(legacyCallTypeFor(snap(2), cats)).toBe("cierre");
    expect(legacyCallTypeFor(snap(3), cats)).toBe("seguimiento");
    const renamed = cats.map((c) => (c.id === id(2) ? { ...c, name: "Cierre final" } : c));
    expect(legacyCallTypeFor(ruleTargetSnapshot(id(2), renamed), renamed)).toBe("cierre");
  });

  it("un tipo nuevo toma el comportamiento de su area", () => {
    expect(legacyCallTypeFor(snap(4), cats)).toBe("cierre");
    expect(legacyCallTypeFor(snap(7), cats)).toBe("equipo");
    expect(legacyCallTypeFor(snap(9), cats)).toBe("otra");
    expect(legacyCallTypeFor(snap(11), cats)).toBe("otra");
  });

  it("no show gana, y sin area no hay tipo", () => {
    expect(legacyCallTypeFor(snap(2), cats, true)).toBe("no_show");
    expect(legacyCallTypeFor(null, cats, true)).toBe("no_show");
    expect(legacyCallTypeFor(null, cats)).toBeNull();
  });
});

describe("lo que se muestra y se ofrece", () => {
  it("la etiqueta dice area y tipo", () => {
    expect(callCategoryLabel(snap(2))).toBe("Ventas · Cierre");
    expect(callCategoryLabel(snap(7))).toBe("Equipo");
    expect(callCategoryLabel(null)).toBe("Sin clasificar");
  });

  it("los selectores no ofrecen lo archivado", () => {
    const ventas = categoryGroups(cats).find((g) => g.areaName === "Ventas");
    expect(ventas?.types.map((t) => t.name)).toEqual(["Cierre", "Seguimiento", "Demo"]);
  });

  it("la IA elige tipos, o el area si no tiene tipos", () => {
    const labels = classifierOptions(cats).map((o) => o.label);
    expect(labels).toContain("Ventas · Cierre");
    expect(labels).toContain("Equipo");
    expect(labels).not.toContain("Ventas");
    expect(labels).not.toContain("Ventas · Viejo");
  });

  it("con un area decidida, la IA solo elige dentro de esa area", () => {
    expect(classifierOptions(cats, id(5)).map((o) => o.label)).toEqual(["Servicio · Onboarding"]);
  });

  it("lee el snapshot guardado y descarta lo que no tiene forma", () => {
    expect(readCategorySnapshot({ area_id: "a", area_name: "Ventas" })).toEqual({ area_id: "a", area_name: "Ventas", type_id: null, type_name: null });
    expect(readCategorySnapshot(null)).toBeNull();
    expect(readCategorySnapshot({ area_name: "Ventas" })).toBeNull();
    expect(readCategorySnapshot([])).toBeNull();
  });
});

describe("callDisplayLabel", () => {
  const snapshot = { area_id: "a", area_name: "Servicio", type_id: "t", type_name: "Onboarding" };
  it("muestra area y tipo; sin clasificacion, el tipo viejo", () => {
    expect(callDisplayLabel(snapshot, "cliente")).toBe("Servicio · Onboarding");
    expect(callDisplayLabel(null, "cierre")).toBe("Cierre");
    expect(callDisplayLabel(null, null)).toBe("Sin clasificar");
  });
  it("suma la marca de no show", () => {
    expect(callDisplayLabel(snapshot, "no_show", true)).toBe("Servicio · Onboarding · No show");
    expect(callDisplayLabel(null, "no_show", true)).toBe("No show");
  });
});
