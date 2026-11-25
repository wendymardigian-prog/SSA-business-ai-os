import { describe, expect, it } from "vitest";
import { cutRrule } from "@/lib/google-calendar/client";
import { firstDateProblem, rruleFor } from "./rrule";

describe("rruleFor", () => {
  it("cada día y cada N días", () => {
    expect(rruleFor({ every: "day", until: "phase_end" }, "2026-11-25")).toBe("RRULE:FREQ=DAILY");
    expect(rruleFor({ every: "n_days", n: 3, until: "phase_end" }, "2026-11-25")).toBe("RRULE:FREQ=DAILY;INTERVAL=3");
  });
  it("semanal con días, y sin días toma el del primero", () => {
    expect(rruleFor({ every: "week", weekdays: [4, 1], until: "phase_end" }, "2026-11-23")).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,TH");
    expect(rruleFor({ every: "week", until: "phase_end" }, "2026-11-25")).toBe("RRULE:FREQ=WEEKLY;BYDAY=WE");
  });
  it("quincenal", () => expect(rruleFor({ every: "n_weeks", n: 2, weekdays: [2], until: "phase_end" }, "2026-11-24")).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU"));
  it("mensual: el 15, y el 31 cae el último día", () => {
    expect(rruleFor({ every: "month", day_of_month: 15, until: "phase_end" }, "2026-12-15")).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=15");
    expect(rruleFor({ every: "month", day_of_month: 31, until: "phase_end" }, "2026-12-31")).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
  });
});

describe("firstDateProblem", () => {
  it("el primer día tiene que caer en la serie", () => {
    expect(firstDateProblem({ every: "week", weekdays: [1], until: "phase_end" }, "2026-11-25")).toMatch(/días de la semana/);
    expect(firstDateProblem({ every: "week", weekdays: [3], until: "phase_end" }, "2026-11-25")).toBeNull();
    expect(firstDateProblem({ every: "month", day_of_month: 31, until: "phase_end" }, "2027-02-28")).toBeNull();
    expect(firstDateProblem({ every: "month", day_of_month: 31, until: "phase_end" }, "2027-02-27")).toMatch(/31/);
  });
});

describe("cutRrule", () => {
  it("le pone UNTIL y saca el que tenía", () => {
    expect(cutRrule("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270101T000000Z", "2026-11-25T15:00:00.000Z")).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261125T150000Z");
  });
});
