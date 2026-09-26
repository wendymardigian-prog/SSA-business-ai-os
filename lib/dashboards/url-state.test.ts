import { describe, it, expect } from "vitest";
import { parseDashboardFilters, dashboardFiltersToParams, activeFilterChips, DEFAULT_PERIOD } from "./url-state";

const parse = (qs: string) => parseDashboardFilters(new URLSearchParams(qs));

describe("estado de la URL del dashboard (F14)", () => {
  it("vacío = defaults", () => {
    expect(parse("")).toEqual({ channel: null, author: null, period: DEFAULT_PERIOD, from: null, to: null });
  });
  it("lee canal, autor y período", () => {
    expect(parse("channel=ig&author=u1&range=hoy")).toEqual({ channel: "ig", author: "u1", period: "hoy", from: null, to: null });
  });
  it("un rango a medida gana sobre el preset", () => {
    const f = parse("from=2026-09-01T00:00:00Z&to=2026-09-05T00:00:00Z");
    expect(f.from).toBe("2026-09-01T00:00:00Z");
    expect(f.to).toBe("2026-09-05T00:00:00Z");
  });
  it("un período inválido cae al default", () => {
    expect(parse("range=maniana").period).toBe(DEFAULT_PERIOD);
  });
  it("ida y vuelta URL ↔ estado", () => {
    const f = parse("channel=ig&author=u1&range=este-mes");
    const back = parseDashboardFilters(dashboardFiltersToParams(f));
    expect(back).toEqual(f);
  });
  it("no serializa el período por defecto", () => {
    expect(dashboardFiltersToParams({ channel: null, author: null, period: DEFAULT_PERIOD, from: null, to: null }).toString()).toBe("");
  });
  it("chips de filtros activos", () => {
    const chips = activeFilterChips({ channel: "ig", author: "u1", period: "30d", from: null, to: null }, { channel: () => "Instagram", author: () => "Sofía" });
    expect(chips).toEqual([{ key: "channel", label: "Instagram" }, { key: "author", label: "Sofía" }]);
  });
});
