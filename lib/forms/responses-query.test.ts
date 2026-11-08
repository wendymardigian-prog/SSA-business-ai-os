import { describe, it, expect } from "vitest";
import { applyResponseFilters, formatInZone, type FilterableQuery } from "./responses-query";

function spy() {
  const calls: Array<[string, ...unknown[]]> = [];
  const q: FilterableQuery<unknown> & Record<string, unknown> = {
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), q),
    not: (...a: unknown[]) => (calls.push(["not", ...a]), q),
    is: (...a: unknown[]) => (calls.push(["is", ...a]), q),
    gte: (...a: unknown[]) => (calls.push(["gte", ...a]), q),
    lte: (...a: unknown[]) => (calls.push(["lte", ...a]), q),
  } as never;
  return { q: q as never, calls };
}

describe("applyResponseFilters", () => {
  it("sin filtros no agrega nada", () => {
    const { q, calls } = spy();
    applyResponseFilters(q, { status: "all", contact: "all", page: 1 }, "UTC");
    expect(calls).toEqual([]);
  });

  it("estado y con/sin contacto", () => {
    const { q, calls } = spy();
    applyResponseFilters(q, { status: "spam", contact: "without", page: 1 }, "UTC");
    expect(calls).toEqual([["eq", "status", "spam"], ["is", "contact_id", null]]);
    const b = spy();
    applyResponseFilters(b.q, { status: "all", contact: "with", page: 1 }, "UTC");
    expect(b.calls).toEqual([["not", "contact_id", "is", null]]);
  });

  it("las fechas son días enteros en la zona del workspace", () => {
    const { q, calls } = spy();
    applyResponseFilters(q, { from: "2026-10-10", to: "2026-10-10", status: "all", contact: "all", page: 1 }, "America/Costa_Rica");
    expect(calls[0]).toEqual(["gte", "created_at", "2026-10-10T06:00:00.000Z"]);
    expect(calls[1]).toEqual(["lte", "created_at", "2026-10-11T05:59:59.999Z"]);
  });
});

describe("el período del botón de fecha", () => {
  const NOW = new Date("2026-11-07T15:00:00Z");

  it("el Histórico no agrega nada", () => {
    const { q, calls } = spy();
    applyResponseFilters(q, { period: { period: "historico", from: null, to: null }, status: "all", contact: "all", page: 1 }, "UTC", NOW);
    expect(calls).toEqual([]);
  });

  it("un atajo filtra desde su inicio", () => {
    const { q, calls } = spy();
    applyResponseFilters(q, { period: { period: "7d", from: null, to: null }, status: "all", contact: "all", page: 1 }, "UTC", NOW);
    expect(calls[0]?.[0]).toBe("gte");
    expect(calls[0]?.[1]).toBe("created_at");
  });

  it("un rango a medida va tal cual y le gana a los días de un link viejo", () => {
    const { q, calls } = spy();
    const from = "2026-11-01T03:00:00.000Z";
    const to = "2026-11-03T02:59:59.999Z";
    applyResponseFilters(q, { period: { period: "historico", from, to }, from: "2026-01-01", status: "all", contact: "all", page: 1 }, "UTC", NOW);
    expect(calls).toEqual([["gte", "created_at", from], ["lte", "created_at", to]]);
  });

  it("con el Histórico, un link viejo con desde/hasta sigue filtrando", () => {
    const { q, calls } = spy();
    applyResponseFilters(q, { period: { period: "historico", from: null, to: null }, from: "2026-10-10", status: "all", contact: "all", page: 1 }, "UTC", NOW);
    expect(calls).toEqual([["gte", "created_at", "2026-10-10T00:00:00.000Z"]]);
  });
});

describe("formatInZone", () => {
  it("23:30 de Costa Rica se muestra como 23:30 del 10/10", () => {
    expect(formatInZone("2026-10-11T05:30:00Z", "America/Costa_Rica")).toMatch(/^10\/10\/2026.*23:30$/);
  });
});
