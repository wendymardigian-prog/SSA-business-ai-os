import { describe, expect, it } from "vitest";
import cases from "./repetition.cases.json";
import { describeRepetition, seriesReached } from "./repetition";

describe("seriesReached (gemela de svc_series_reached)", () => {
  for (const c of cases.seriesReached) it(c.name, () => expect(seriesReached(c.recurrence, c.completed)).toBe(c.expected));
});

describe("describeRepetition", () => {
  it("cada 2 semanas con días", () => expect(describeRepetition({ every: "n_weeks", n: 2, weekdays: [4, 1], until: "phase_end" })).toBe("Cada 2 semanas, los lunes y jueves · hasta que termina su fase"));
  it("cada mes un día", () => expect(describeRepetition({ every: "month", day_of_month: 5, until: "n_times", n_until: 6 })).toBe("Cada mes, el día 5 · hasta 6 vueltas cumplidas"));
  it("diaria por 30 días", () => expect(describeRepetition({ every: "day", until: "n_days", n_until: 30 })).toBe("Cada día · durante 30 días"));
  it("nada que entender", () => expect(describeRepetition(null)).toBe(""));
});
