import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const notify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications/create", () => ({ createNotification: notify }));

import { clearEventCalendarRefs, notifyEventsNowOnGoogle } from "./calendar-switch";

beforeEach(() => notify.mockReset().mockResolvedValue(true));

describe("clearEventCalendarRefs (al desconectar una cuenta)", () => {
  it("saca el destino y los conflictos que se apagan, y no toca lo demás", async () => {
    const db = fakeDb({
      "event_types:select": {
        data: [
          { id: "e1", destination_calendar_id: "muerto", conflict_calendar_ids: [] },
          { id: "e2", destination_calendar_id: "vivo", conflict_calendar_ids: ["muerto", "vivo"] },
          { id: "e3", destination_calendar_id: null, conflict_calendar_ids: [] },
        ],
      },
      "event_types:update": { data: null },
    });
    expect(await clearEventCalendarRefs(db.client, "ws1", "u1", ["muerto"])).toBe(2);
    const updates = db.writesTo("event_types");
    expect(updates.map((u) => u.values)).toEqual([{ destination_calendar_id: null }, { conflict_calendar_ids: ["vivo"] }]);
    expect(updates.map((u) => u.filters.find((f) => f.column === "id")?.value)).toEqual(["e1", "e2"]);
  });

  it("sin calendarios que apagar no lee ni escribe nada", async () => {
    const db = fakeDb();
    expect(await clearEventCalendarRefs(db.client, "ws1", "u1", [])).toBe(0);
    expect(db.calls).toHaveLength(0);
  });
});

describe("notifyEventsNowOnGoogle (al conectar por primera vez)", () => {
  it("le avisa a la persona qué eventos pasaron a usar su Google", async () => {
    const db = fakeDb({ "event_types:select": { data: [{ title: "Admisión" }, { title: "Seguimiento" }] } });
    expect(await notifyEventsNowOnGoogle(db.client, "ws1", "u1")).toBe(2);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "u1", title: "Tus 2 eventos ya usan tu Google Calendar", body: expect.stringContaining("Admisión, Seguimiento") }));
  });

  it("sin eventos 'solo en el sistema' no avisa", async () => {
    expect(await notifyEventsNowOnGoogle(fakeDb({ "event_types:select": { data: [] } }).client, "ws1", "u1")).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("si la base falla, no lanza (el aviso no puede tumbar la conexión)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ "event_types:select": () => { throw new Error("se cayó la base"); } });
    expect(await notifyEventsNowOnGoogle(db.client, "ws1", "u1")).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    quiet.mockRestore();
  });
});
