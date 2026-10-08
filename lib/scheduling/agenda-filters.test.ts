import { describe, it, expect } from "vitest";
import {
  EMPTY_AGENDA_FILTERS,
  countActiveAgendaFilters,
  agendaFilterChips,
  statusGroupsForFilter,
  isBookingOrigin,
  ORIGIN_LABELS,
  type AgendaFilters,
} from "./agenda-filters";
import type { CategoryRow } from "./categories";

const CATEGORIES: CategoryRow[] = [
  { id: "area-1", parent_id: null, name: "Ventas", color: "#2563eb", position: 0, is_system: true, archived_at: null },
  { id: "tipo-1", parent_id: "area-1", name: "Triaje", color: null, position: 0, is_system: true, archived_at: null },
];

describe("countActiveAgendaFilters", () => {
  it("sin filtros, cero", () => {
    expect(countActiveAgendaFilters(EMPTY_AGENDA_FILTERS)).toBe(0);
  });

  it("tres estados elegidos cuentan uno, no tres", () => {
    const filters: AgendaFilters = { ...EMPTY_AGENDA_FILTERS, statuses: ["scheduled", "confirmed", "sale"] };
    expect(countActiveAgendaFilters(filters)).toBe(1);
  });

  it("fuente, medio y campaña juntos cuentan un solo grupo (UTM)", () => {
    const filters: AgendaFilters = { ...EMPTY_AGENDA_FILTERS, utmSources: ["instagram"], utmMediums: ["paid"] };
    expect(countActiveAgendaFilters(filters)).toBe(1);
  });

  it("cada grupo distinto suma uno", () => {
    const filters: AgendaFilters = {
      ...EMPTY_AGENDA_FILTERS,
      statuses: ["sale"],
      categoryIds: ["area-1"],
      hostUserIds: ["user-1"],
    };
    expect(countActiveAgendaFilters(filters)).toBe(3);
  });
});

describe("agendaFilterChips", () => {
  const catalog = { categories: CATEGORIES, events: new Map([["ev-1", "Llamada de triaje"]]), hosts: new Map([["user-1", "Ana"]]) };

  it("un chip por valor elegido, con su etiqueta", () => {
    const filters: AgendaFilters = {
      ...EMPTY_AGENDA_FILTERS,
      statuses: ["sale"],
      categoryIds: ["tipo-1"],
      eventTypeIds: ["ev-1"],
      hostUserIds: ["user-1"],
      origins: ["manual"],
      utmSources: ["instagram"],
    };
    const chips = agendaFilterChips(filters, catalog);
    expect(chips).toContainEqual({ param: "estado", value: "sale", label: "Venta" });
    expect(chips).toContainEqual({ param: "categoria", value: "tipo-1", label: "Ventas · Triaje" });
    expect(chips).toContainEqual({ param: "evento", value: "ev-1", label: "Llamada de triaje" });
    expect(chips).toContainEqual({ param: "anfitrion", value: "user-1", label: "Ana" });
    expect(chips).toContainEqual({ param: "origen", value: "manual", label: "A mano" });
    expect(chips).toContainEqual({ param: "utm_source", value: "instagram", label: "Fuente: instagram" });
  });

  it("un id de evento o anfitrión que ya no existe muestra un genérico en vez de desaparecer", () => {
    const filters: AgendaFilters = { ...EMPTY_AGENDA_FILTERS, eventTypeIds: ["ev-borrado"], hostUserIds: ["user-borrado"] };
    const chips = agendaFilterChips(filters, catalog);
    expect(chips).toContainEqual({ param: "evento", value: "ev-borrado", label: "Evento" });
    expect(chips).toContainEqual({ param: "anfitrion", value: "user-borrado", label: "Alguien del equipo" });
  });

  it("un valor inventado de estado u origen no genera chip (no hay como mostrarlo)", () => {
    const filters: AgendaFilters = { ...EMPTY_AGENDA_FILTERS, statuses: ["inventado"], origins: ["inventado"] };
    expect(agendaFilterChips(filters, catalog)).toEqual([]);
  });
});

describe("statusGroupsForFilter", () => {
  it("los cuatro grupos, con los 11 estados repartidos", () => {
    const groups = statusGroupsForFilter();
    expect(groups.map((g) => g.group)).toEqual(["active", "no_show", "outcome", "cancelled"]);
    expect(groups.reduce((n, g) => n + g.statuses.length, 0)).toBe(11);
  });
});

describe("isBookingOrigin / ORIGIN_LABELS", () => {
  it("los cinco orígenes tienen etiqueta", () => {
    for (const o of ["public_page", "embed", "manual", "agent", "api"]) {
      expect(isBookingOrigin(o)).toBe(true);
      expect(ORIGIN_LABELS[o as keyof typeof ORIGIN_LABELS]).toBeTruthy();
    }
  });
  it("rechaza un origen inventado", () => {
    expect(isBookingOrigin("whatsapp")).toBe(false);
  });
});
