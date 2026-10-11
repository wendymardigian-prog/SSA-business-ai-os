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

describe("formatInZone", () => {
  it("23:30 de Costa Rica se muestra como 23:30 del 10/10", () => {
    expect(formatInZone("2026-10-11T05:30:00Z", "America/Costa_Rica")).toMatch(/^10\/10\/2026.*23:30$/);
  });
});
