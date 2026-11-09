// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, dayLabel, groupServices, parseServiceFilters, pendingReviewChip, serializeServiceFilters, type ServiceFilters } from "./list";

describe("la fila de un servicio", () => {
  it("Día 12 de 84, Día 12 sin fin, Pausado y Empieza el 1/1", () => {
    expect(dayLabel({ status: "active", startsOn: "2026-11-01", endsOn: "2027-01-23" }, "2026-11-12")).toBe("Día 12 de 84");
    expect(dayLabel({ status: "active", startsOn: "2026-11-01", endsOn: null }, "2026-11-12")).toBe("Día 12");
    expect(dayLabel({ status: "paused", startsOn: "2026-11-01", endsOn: null }, "2026-11-12")).toBe("Pausado");
    expect(dayLabel({ status: "active", startsOn: "2027-01-01", endsOn: null }, "2026-11-12")).toBe("Empieza el 1/1");
    expect(dayLabel({ status: "pending_confirmation", startsOn: null, endsOn: null }, "2026-11-12")).toBe("Por confirmar");
  });

  it("pasado el fin no cuenta mas alla del total", () => {
    expect(dayLabel({ status: "active", startsOn: "2026-11-01", endsOn: "2026-11-10" }, "2026-11-20")).toBe("Día 10 de 10");
  });

  it("N por revisar: nada con 0, y con mas lleva a Por revisar filtrado", () => {
    expect(pendingReviewChip(0, "c1")).toBeNull();
    expect(pendingReviewChip(3, "c1")).toEqual({ label: "3 por revisar", href: "/dashboard/portal/por-revisar?cliente=c1" });
  });
});

describe("los filtros en la URL", () => {
  it("parse y serialize son inversas", () => {
    const f: ServiceFilters = { view: "board", quick: "red", groupBy: "owner", q: "ana", page: 3, owner: "11111111-1111-4111-8111-111111111111", departedOnly: true };
    expect(parseServiceFilters(new URLSearchParams(serializeServiceFilters(f)))).toEqual(f);
    expect(serializeServiceFilters(DEFAULT_FILTERS)).toBe("");
    expect(parseServiceFilters(new URLSearchParams(""))).toEqual(DEFAULT_FILTERS);
  });

  it("un valor raro cae en el de por defecto", () => {
    expect(parseServiceFilters({ f: "<script>", agrupar: "x", pagina: "-2", responsable: "no-uuid" })).toEqual(DEFAULT_FILTERS);
  });
});

describe("agrupar y el tablero", () => {
  const items = [
    { phaseName: "Onboarding", light: "red" as const, ownerName: "Ana", status: "active" as const },
    { phaseName: "Trabajo", light: "green" as const, ownerName: "Beto", status: "active" as const },
    { phaseName: "Onboarding", light: "yellow" as const, ownerName: null, status: "active" as const },
  ];
  it("por fase", () => {
    expect(groupServices(items, "phase").map((g) => [g.label, g.items.length])).toEqual([["Onboarding", 2], ["Trabajo", 1]]);
  });
  it("por semaforo, en orden de gravedad", () => {
    expect(groupServices(items, "light").map((g) => g.label)).toEqual(["Rojo", "Amarillo", "En verde"]);
  });
  it("por responsable, con Sin responsable", () => {
    expect(groupServices(items, "owner").map((g) => g.label)).toContain("Sin responsable");
  });
});
