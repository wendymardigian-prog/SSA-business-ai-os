import { describe, it, expect } from "vitest";
import {
  countActiveFilters,
  needsServerToFilter,
  matchesInboxRow,
  statusForQuery,
  EMPTY_INBOX_FILTERS,
  ASSIGNMENT_UNASSIGNED,
  type InboxFilters,
  type FilterableRow,
} from "./filters";

const filtros = (over: Partial<InboxFilters> = {}): InboxFilters => ({
  ...EMPTY_INBOX_FILTERS,
  ...over,
});

const fila = (over: Partial<FilterableRow> = {}): FilterableRow => ({
  status: "open",
  platform: "instagram",
  last_message_at: "2026-09-07T15:00:00.000Z",
  created_at: "2026-09-01T10:00:00.000Z",
  last_message_preview: "hola, quiero info",
  contacts: { display_name: "Ana Gomez" },
  ...over,
});

const SIN_RANGO = { from: null, to: null };

describe("countActiveFilters", () => {
  it("la bandeja recien abierta no tiene filtros activos", () => {
    expect(countActiveFilters(filtros())).toBe(0);
  });

  it("cambiar el estado por default si cuenta", () => {
    expect(countActiveFilters(filtros({ status: "closed" }))).toBe(1);
    expect(countActiveFilters(filtros({ status: "all" }))).toBe(1);
  });

  it("una categoria multi-valor cuenta como un filtro, no como uno por valor", () => {
    expect(countActiveFilters(filtros({ tagIds: ["a", "b", "c"] }))).toBe(1);
  });

  it("suma las categorias entre si", () => {
    const f = filtros({
      search: "ana",
      platforms: ["whatsapp"],
      tagIds: ["a"],
      assignment: ASSIGNMENT_UNASSIGNED,
      datePreset: "7d",
    });
    expect(countActiveFilters(f)).toBe(5);
  });
});

describe("needsServerToFilter", () => {
  it("estado, canal y fecha se pueden resolver en el cliente", () => {
    expect(needsServerToFilter(filtros({ status: "closed", platforms: ["whatsapp"], datePreset: "hoy" }))).toBe(false);
  });

  it("los tags no: viven en el contacto", () => {
    expect(needsServerToFilter(filtros({ tagIds: ["a"] }))).toBe(true);
  });

  it("la asignacion tampoco: depende del setter y del vendedor", () => {
    expect(needsServerToFilter(filtros({ assignment: ASSIGNMENT_UNASSIGNED }))).toBe(true);
  });
});

describe("matchesInboxRow", () => {
  it("sin filtros entra cualquier fila", () => {
    expect(matchesInboxRow(fila(), filtros({ status: "all" }), SIN_RANGO)).toBe(true);
  });

  it("filtra por estado", () => {
    expect(matchesInboxRow(fila({ status: "closed" }), filtros(), SIN_RANGO)).toBe(false);
    expect(matchesInboxRow(fila({ status: "open" }), filtros(), SIN_RANGO)).toBe(true);
  });

  it("'todas' deja pasar cualquier estado", () => {
    expect(matchesInboxRow(fila({ status: "snoozed" }), filtros({ status: "all" }), SIN_RANGO)).toBe(true);
  });

  it("filtra por canal, aceptando varios", () => {
    const f = filtros({ platforms: ["whatsapp", "instagram"] });
    expect(matchesInboxRow(fila({ platform: "instagram" }), f, SIN_RANGO)).toBe(true);
    expect(matchesInboxRow(fila({ platform: "telegram" }), f, SIN_RANGO)).toBe(false);
  });

  it("filtra por rango de fechas", () => {
    const rango = { from: "2026-09-07T03:00:00.000Z", to: null };
    expect(matchesInboxRow(fila({ last_message_at: "2026-09-07T15:00:00.000Z" }), filtros(), rango)).toBe(true);
    expect(matchesInboxRow(fila({ last_message_at: "2026-09-06T15:00:00.000Z" }), filtros(), rango)).toBe(false);
  });

  it("una conversacion sin mensajes se ubica por su fecha de creacion", () => {
    const row = fila({ last_message_at: null, created_at: "2026-09-07T15:00:00.000Z" });
    expect(matchesInboxRow(row, filtros(), { from: "2026-09-07T03:00:00.000Z", to: null })).toBe(true);
  });

  it("busca en el nombre del contacto y en el preview", () => {
    expect(matchesInboxRow(fila(), filtros({ search: "ana" }), SIN_RANGO)).toBe(true);
    expect(matchesInboxRow(fila(), filtros({ search: "info" }), SIN_RANGO)).toBe(true);
    expect(matchesInboxRow(fila(), filtros({ search: "zzz" }), SIN_RANGO)).toBe(false);
  });

  it("la busqueda no distingue mayusculas", () => {
    expect(matchesInboxRow(fila(), filtros({ search: "GOMEZ" }), SIN_RANGO)).toBe(true);
  });

  it("un contacto sin nombre no rompe la busqueda", () => {
    const row = fila({ contacts: null, last_message_preview: null });
    expect(matchesInboxRow(row, filtros({ search: "ana" }), SIN_RANGO)).toBe(false);
  });

  it("las categorias se combinan con AND", () => {
    const f = filtros({ status: "open", platforms: ["whatsapp"] });
    expect(matchesInboxRow(fila({ platform: "instagram" }), f, SIN_RANGO)).toBe(false);
  });
});

describe("statusForQuery", () => {
  it("'all' significa no filtrar", () => {
    expect(statusForQuery("all")).toBeNull();
  });

  it("el resto va tal cual a la consulta", () => {
    expect(statusForQuery("snoozed")).toBe("snoozed");
  });
});
