import { describe, expect, it } from "vitest";
import { calendarDaysAgo, listTimeLabel, threadDayLabel } from "./day-label";

// Fechas locales (sin "Z"): la regla es por dia de calendario de quien mira.
const at = (s: string) => new Date(s);

describe("calendarDaysAgo", () => {
  it("ayer a la tarde, mirado hoy temprano, es ayer aunque pasaron menos de 24 h", () => {
    expect(calendarDaysAgo(at("2026-10-23T15:54:00"), at("2026-10-24T08:00:00"))).toBe(1);
  });
  it("hoy a la madrugada, mirado hoy a la noche, es hoy", () => {
    expect(calendarDaysAgo(at("2026-10-24T00:10:00"), at("2026-10-24T23:50:00"))).toBe(0);
  });
});

describe("threadDayLabel", () => {
  const now = at("2026-10-24T08:00:00");
  it("hoy y ayer en castellano", () => {
    expect(threadDayLabel(at("2026-10-24T07:00:00"), now)).toBe("Hoy");
    expect(threadDayLabel(at("2026-10-23T15:54:00"), now)).toBe("Ayer");
  });
  it("mas atras, la fecha", () => {
    expect(threadDayLabel(at("2026-10-20T10:00:00"), now)).not.toMatch(/Hoy|Ayer/);
  });
});

describe("listTimeLabel", () => {
  const now = at("2026-10-24T08:00:00");
  it("un mensaje de ayer a la noche dice 'Ayer', no la hora", () => {
    expect(listTimeLabel(at("2026-10-23T22:25:00"), now)).toBe("Ayer");
  });
  it("uno de hoy dice la hora", () => {
    expect(listTimeLabel(at("2026-10-24T07:19:00"), now)).toMatch(/\d{1,2}:\d{2}/);
  });
});
