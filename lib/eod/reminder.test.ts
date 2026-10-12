import { describe, it, expect } from "vitest";
import { reminderDue, remindersToSend } from "./reminder";

const on = { reminder: { enabled: true, time: "18:00" } };
// 2026-10-12 00:10 UTC = 18:10 del 11/10 en Costa Rica (UTC-6) y 21:10 del 11/10 en Buenos Aires (UTC-3).
const now = new Date("2026-10-12T00:10:00Z");

describe("recordatorio del EOD", () => {
  it("a la hora elegida en la zona de cada persona, dentro de la ventana", () => {
    expect(reminderDue(on, now, "America/Costa_Rica")).toEqual({ due: true, date: "2026-10-11" });
    expect(reminderDue(on, now, "America/Argentina/Buenos_Aires").due).toBe(false);
    expect(reminderDue({ reminder: { enabled: false, time: "18:00" } }, now, "America/Costa_Rica").due).toBe(false);
  });

  it("no a quien ya envió, ni dos veces el mismo día", () => {
    const people = [
      { userId: "ana", timeZone: "America/Costa_Rica" },
      { userId: "beto", timeZone: "America/Costa_Rica" },
      { userId: "caro", timeZone: "America/Costa_Rica" },
      { userId: "dani", timeZone: "America/Argentina/Buenos_Aires" },
    ];
    expect(remindersToSend({ config: on, now, people, submitted: new Set(["beto:2026-10-11"]), reminded: new Set(["caro:2026-10-11"]) })).toEqual([{ userId: "ana", date: "2026-10-11" }]);
  });
});
