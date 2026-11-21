import { describe, expect, it } from "vitest";
import { canSeeTeamAvailability, parseTeamLayout } from "./team-view";

describe("vista de equipo", () => {
  it("la ven Owner/Admin, quien administra agendas ajenas o ve todas las reuniones", () => {
    const base = { isAdmin: false, canManageOthers: false, canViewBookings: false, bookingsScope: null };
    expect(canSeeTeamAvailability({ ...base, isAdmin: true })).toBe(true);
    expect(canSeeTeamAvailability({ ...base, canManageOthers: true })).toBe(true);
    expect(canSeeTeamAvailability({ ...base, canViewBookings: true, bookingsScope: "all" })).toBe(true);
    expect(canSeeTeamAvailability({ ...base, canViewBookings: true, bookingsScope: "own" })).toBe(false);
    expect(canSeeTeamAvailability(base)).toBe(false);
  });
  it("equipo=0 es «Todo junto»", () => {
    expect(parseTeamLayout(undefined)).toBe(true);
    expect(parseTeamLayout("0")).toBe(false);
  });
});

import { busyBlocksForDay } from "./team-view";

describe("bloques ocupados de un día", () => {
  const DAY = { start: "2026-11-24T06:00:00.000Z", end: "2026-11-25T06:00:00.000Z" }; // un día en Costa Rica
  it("pasa a minutos del día local, recorta y junta lo que se pisa", () => {
    expect(
      busyBlocksForDay(
        [
          { startAt: "2026-11-24T15:00:00.000Z", endAt: "2026-11-24T16:00:00.000Z" },
          { startAt: "2026-11-24T15:30:00.000Z", endAt: "2026-11-24T17:00:00.000Z" },
          { startAt: "2026-11-24T03:00:00.000Z", endAt: "2026-11-24T07:00:00.000Z" },
        ],
        DAY.start,
        DAY.end,
      ),
    ).toEqual([
      { startMinutes: 0, endMinutes: 60 },
      { startMinutes: 540, endMinutes: 660 },
    ]);
  });
});
