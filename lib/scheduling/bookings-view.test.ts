import { describe, it, expect } from "vitest";
import { needsOutcome, quickFilterOf, applyQuickFilter, quickFilterCounts, groupForKanban, allowedDrops } from "./bookings-view";
import type { BookingStatus } from "./types";

const now = new Date("2026-10-06T16:00:00.000Z");
const b = (status: BookingStatus, start: string, minutes = 30) => ({
  status,
  start_at: start,
  end_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
});

describe("needsOutcome (F32)", () => {
  it("una agenda scheduled que terminó hace 1 minuto: true", () => {
    expect(needsOutcome(b("scheduled", "2026-10-06T15:29:00.000Z"), now)).toBe(true);
  });

  it("no si todavía no terminó, ni si ya tiene resultado o está cancelada", () => {
    expect(needsOutcome(b("confirmed", "2026-10-06T15:45:00.000Z"), now)).toBe(false);
    expect(needsOutcome(b("sale", "2026-10-06T14:00:00.000Z"), now)).toBe(false);
    expect(needsOutcome(b("cancelled_other", "2026-10-06T14:00:00.000Z"), now)).toBe(false);
  });
});

describe("filtros rápidos (F33)", () => {
  const list = [
    b("scheduled", "2026-10-08T15:00:00.000Z"),
    b("confirmed", "2026-10-07T15:00:00.000Z"),
    b("scheduled", "2026-10-06T14:00:00.000Z"), // sin resultado
    b("no_show", "2026-10-05T14:00:00.000Z"),
    b("sale", "2026-10-01T14:00:00.000Z"),
    b("cancelled_no_response", "2026-10-09T14:00:00.000Z"),
  ];

  it("clasifica y cuenta", () => {
    expect(quickFilterOf(list[2], now)).toBe("needs_outcome");
    expect(quickFilterCounts(list, now)).toEqual({ upcoming: 2, needs_outcome: 1, with_outcome: 2, cancelled: 1 });
  });

  it("'Sin resultado' lista solo activas con el fin en el pasado; próximas ascendente, el resto descendente", () => {
    expect(applyQuickFilter(list, "needs_outcome", now).map((x) => x.start_at)).toEqual(["2026-10-06T14:00:00.000Z"]);
    expect(applyQuickFilter(list, "upcoming", now).map((x) => x.start_at)).toEqual(["2026-10-07T15:00:00.000Z", "2026-10-08T15:00:00.000Z"]);
    expect(applyQuickFilter(list, "with_outcome", now).map((x) => x.status)).toEqual(["no_show", "sale"]);
  });
});

describe("groupForKanban / allowedDrops", () => {
  it("una columna por estado en el orden de la tabla, siempre las 11, ordenadas por fecha", () => {
    const cols = groupForKanban([b("sale", "2026-10-02T14:00:00.000Z"), b("sale", "2026-10-01T14:00:00.000Z"), b("scheduled", "2026-10-08T15:00:00.000Z")]);
    expect(cols).toHaveLength(11);
    expect(cols.map((c) => c.status)[0]).toBe("scheduled");
    expect(cols.find((c) => c.status === "sale")?.bookings.map((x) => x.start_at)).toEqual(["2026-10-01T14:00:00.000Z", "2026-10-02T14:00:00.000Z"]);
    expect(cols.find((c) => c.status === "no_show")?.bookings).toEqual([]);
  });

  it("allowedDrops respeta canTransition", () => {
    expect(allowedDrops(b("scheduled", "2026-10-08T15:00:00.000Z"), now)).not.toContain("sale");
    expect(allowedDrops(b("scheduled", "2026-10-06T14:00:00.000Z"), now)).toContain("sale");
    expect(allowedDrops(b("cancelled_other", "2026-10-06T14:00:00.000Z"), now)).toEqual([]);
  });
});
