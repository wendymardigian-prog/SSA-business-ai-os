import { describe, it, expect } from "vitest";
import { addDays, allowedDateRange, isIsoDate, reportDateProblem, shortDate } from "./dates";

describe("fechas de un EOD", () => {
  it("una fecha futura o más vieja que pastDays se rechaza", () => {
    expect(reportDateProblem("2026-10-13", "2026-10-12", 7)).toBe("future");
    expect(reportDateProblem("2026-10-04", "2026-10-12", 7)).toBe("too_old");
    expect(reportDateProblem("2026-10-05", "2026-10-12", 7)).toBeNull();
    expect(reportDateProblem("2026-10-12", "2026-10-12", 0)).toBeNull();
    expect(reportDateProblem("2026-10-11", "2026-10-12", 0)).toBe("too_old");
    expect(reportDateProblem("2026-02-30", "2026-10-12", 7)).toBe("invalid");
    expect(reportDateProblem(undefined, "2026-10-12", 7)).toBe("invalid");
  });
  it("suma días cruzando meses", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("rango del selector y fecha corta", () => {
    expect(allowedDateRange("2026-10-12", 3)).toEqual({ min: "2026-10-09", max: "2026-10-12" });
    expect(shortDate("2026-10-02")).toBe("2/10");
    expect(isIsoDate("2026-10-12")).toBe(true);
  });
});
