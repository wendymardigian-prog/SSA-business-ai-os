import { describe, expect, it } from "vitest";
import { settingsForHost } from "./host-settings";

const event = {
  owner_user_id: "duena",
  schedule_id: "horario-de-la-duena",
  destination_calendar_id: "cal-de-la-duena",
  conflict_calendar_ids: ["conflicto-de-la-duena"],
};

describe("settingsForHost", () => {
  it("el dueño del evento usa lo que se eligió en el evento", () => {
    expect(settingsForHost(event, "duena")).toEqual({
      schedule_id: "horario-de-la-duena",
      destination_calendar_id: "cal-de-la-duena",
      conflict_calendar_ids: ["conflicto-de-la-duena"],
    });
  });

  it("un anfitrión reasignado usa SUS valores por defecto, nunca los del dueño", () => {
    expect(settingsForHost(event, "nuevo")).toEqual({ schedule_id: null, destination_calendar_id: null, conflict_calendar_ids: [] });
  });
});
