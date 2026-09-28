import { describe, expect, it } from "vitest";
import { destinationOptions, isSystemCalendar, planCalendarSync, suggestDefaultDestination, type CalendarRow, type GoogleCalendarListItem } from "./calendars";

const g = (over: Partial<GoogleCalendarListItem> & { id: string }): GoogleCalendarListItem => ({
  summary: over.id,
  backgroundColor: null,
  accessRole: "owner",
  primary: false,
  deleted: false,
  ...over,
});
const row = (over: Partial<CalendarRow> & { id: string; external_calendar_id: string }): CalendarRow => ({
  name: over.external_calendar_id,
  color: null,
  access_role: "owner",
  is_primary: false,
  check_conflicts: false,
  is_active: true,
  ...over,
});

describe("sincronizar calendarios (F5)", () => {
  it("los calendarios de sistema no se guardan", () => {
    const plan = planCalendarSync([], [
      g({ id: "es.cr#holiday@group.v.calendar.google.com" }),
      g({ id: "addressbook#contacts@group.v.calendar.google.com" }),
      g({ id: "x#weeknum@group.v.calendar.google.com" }),
      g({ id: "wendy@ejemplo.com", primary: true }),
    ]);
    expect(plan.inserts.map((i) => i.external_calendar_id)).toEqual(["wendy@ejemplo.com"]);
    expect(isSystemCalendar("wendy@ejemplo.com")).toBe(false);
  });

  it("la primera vez, el primario nace revisando conflictos y los demas no", () => {
    const plan = planCalendarSync([], [g({ id: "p", primary: true }), g({ id: "otro" })]);
    expect(plan.inserts.map((i) => [i.external_calendar_id, i.check_conflicts])).toEqual([["p", true], ["otro", false]]);
  });

  it("sincronizar dos veces no duplica y no toca el switch de conflictos", () => {
    const existing = [row({ id: "r1", external_calendar_id: "p", check_conflicts: false, is_primary: true })];
    const plan = planCalendarSync(existing, [g({ id: "p", primary: true, summary: "Renombrado", backgroundColor: "#f00" })]);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ id: "r1", patch: { external_calendar_id: "p", name: "Renombrado", color: "#f00", access_role: "owner", is_primary: true, is_active: true } }]);
    expect("check_conflicts" in plan.updates[0].patch).toBe(false);
  });

  it("los que ya no vienen quedan inactivos; los ya inactivos no se repiten", () => {
    const existing = [row({ id: "r1", external_calendar_id: "p" }), row({ id: "r2", external_calendar_id: "viejo" }), row({ id: "r3", external_calendar_id: "muerto", is_active: false })];
    const plan = planCalendarSync(existing, [g({ id: "p" }), g({ id: "borrado", deleted: true })]);
    expect(plan.deactivate).toEqual(["r2"]);
  });

  it("reader y freeBusyReader no se ofrecen como destino", () => {
    const cals = [
      row({ id: "a", external_calendar_id: "a", access_role: "reader" }),
      row({ id: "b", external_calendar_id: "b", access_role: "freeBusyReader" }),
      row({ id: "c", external_calendar_id: "c", access_role: "writer" }),
      row({ id: "d", external_calendar_id: "d", access_role: "owner", is_active: false }),
    ];
    expect(destinationOptions(cals).map((c) => c.id)).toEqual(["c"]);
  });

  it("el destino sugerido es el primario escribible; si no hay, el primer escribible; si no, nada", () => {
    expect(suggestDefaultDestination([row({ id: "a", external_calendar_id: "a", access_role: "writer" }), row({ id: "p", external_calendar_id: "p", is_primary: true })])).toBe("p");
    expect(suggestDefaultDestination([row({ id: "a", external_calendar_id: "a", access_role: "writer" }), row({ id: "p", external_calendar_id: "p", is_primary: true, access_role: "reader" })])).toBe("a");
    expect(suggestDefaultDestination([row({ id: "p", external_calendar_id: "p", access_role: "reader" })])).toBeNull();
  });
});
