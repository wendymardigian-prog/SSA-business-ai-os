import { describe, expect, it } from "vitest";
import { classInColumn, classesLayerParam, parseClassesLayer, placeClassesInCalendar, type AgendaClass } from "./calendar-classes";

const cls = (over: Partial<AgendaClass> = {}): AgendaClass => ({
  key: "s1|2026-11-27",
  sessionId: "s1",
  occursOn: "2026-11-27",
  title: "Clase semanal",
  productTitle: "Programa",
  hostUserId: "u1",
  startAt: "2026-11-28T01:00:00Z", // viernes 19:00 en Costa Rica
  endAt: "2026-11-28T02:00:00Z",
  meetingUrl: null,
  moved: false,
  ...over,
});

describe("capa Clases", () => {
  it("se agrupa por el día de quien mira", () => {
    const range = { from: "2026-11-23", to: "2026-11-29" };
    const cr = placeClassesInCalendar({ classes: [cls()], viewerTz: "America/Costa_Rica", range });
    expect(Object.keys(cr)).toEqual(["2026-11-27"]);
    expect(cr["2026-11-27"][0]).toMatchObject({ key: "l:s1|2026-11-27", startMinutes: 19 * 60, endMinutes: 20 * 60 });
    const madrid = placeClassesInCalendar({ classes: [cls()], viewerTz: "Europe/Madrid", range });
    expect(Object.keys(madrid)).toEqual(["2026-11-28"]);
  });

  it("deja afuera lo que no está en el rango y ordena por hora", () => {
    const late = cls({ key: "b", startAt: "2026-11-27T22:00:00Z", endAt: "2026-11-27T23:00:00Z" });
    const out = placeClassesInCalendar({ classes: [cls(), late, cls({ key: "c", startAt: "2026-12-10T01:00:00Z", endAt: "2026-12-10T02:00:00Z" })], viewerTz: "America/Costa_Rica", range: { from: "2026-11-27", to: "2026-11-27" } });
    expect(out["2026-11-27"].map((p) => p.cls.key)).toEqual(["b", "s1|2026-11-27"]);
  });

  it("en la vista de equipo va en la columna de su anfitrión", () => {
    expect(classInColumn(cls(), null)).toBe(true);
    expect(classInColumn(cls(), "u1")).toBe(true);
    expect(classInColumn(cls(), "u2")).toBe(false);
  });

  it("el interruptor está prendido salvo clases=0", () => {
    expect(parseClassesLayer(undefined)).toBe(true);
    expect(parseClassesLayer("0")).toBe(false);
    expect(classesLayerParam(true)).toBeNull();
    expect(classesLayerParam(false)).toBe("0");
  });
});
