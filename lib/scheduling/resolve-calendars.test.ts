import { describe, expect, it } from "vitest";
import { resolveEventCalendars, type CalendarForResolve } from "./resolve-calendars";

const cal = (id: string, over: Partial<CalendarForResolve> = {}): CalendarForResolve => ({ id, name: id, access_role: "owner", check_conflicts: false, is_active: true, ...over });
const cals = [cal("p", { check_conflicts: true }), cal("personal", { check_conflicts: true }), cal("otro"), cal("muerto", { check_conflicts: true, is_active: false })];

describe("resolveEventCalendars (F19)", () => {
  it("modo profile: los del perfil con check_conflicts y activos; destino del perfil", () => {
    const r = resolveEventCalendars({}, { default_destination_calendar_id: "p" }, cals);
    expect(r.mode).toBe("profile");
    expect(r.conflicts.map((c) => c.id)).toEqual(["p", "personal"]);
    expect(r.destination?.id).toBe("p");
    expect(r.warnings).toEqual([]);
  });
  it("modo custom: los de la lista que sigan activos; el destino del evento gana", () => {
    const r = resolveEventCalendars({ destination_calendar_id: "otro", conflict_calendar_ids: ["personal", "muerto", "borrado"] }, { default_destination_calendar_id: "p" }, cals);
    expect(r.mode).toBe("custom");
    expect(r.conflicts.map((c) => c.id)).toEqual(["personal"]);
    expect(r.destination?.id).toBe("otro");
  });
  it("custom con todos inactivos: conflicts vacio y advertencia", () => {
    const r = resolveEventCalendars({ conflict_calendar_ids: ["muerto"] }, null, cals);
    expect(r.conflicts).toEqual([]);
    expect(r.warnings).toContain("no_conflict_calendars");
  });
  it("un destino desconectado se ignora con advertencia", () => {
    const r = resolveEventCalendars({}, { default_destination_calendar_id: "p" }, [cal("p", { connection_broken: true })]);
    expect(r.destination).toBeNull();
    expect(r.warnings).toContain("destination_unavailable");
  });
});
