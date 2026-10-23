import { describe, expect, it } from "vitest";
import { inactivityDedupeKey, inactivitySince, windowHours } from "./route";

describe("inactividad", () => {
  it("una inactividad nueva (otra ultima interaccion) es otra clave", () => {
    expect(inactivityDedupeKey("cv", 24, "2026-10-01T00:00:00Z")).not.toBe(inactivityDedupeKey("cv", 24, "2026-10-05T00:00:00Z"));
    expect(inactivityDedupeKey("cv", 24, "x")).toBe(inactivityDedupeKey("cv", 24, "x"));
  });
  it("solo cuenta lo que quedo inactivo despues de prender el disparador", () => {
    expect(inactivitySince("2026-10-10T12:00:00.000Z", 24)).toBe("2026-10-09T12:00:00.000Z");
  });
  it("windowHours", () => {
    expect(windowHours({ amount: 2, unit: "days" })).toBe(48);
    expect(windowHours({})).toBeNull();
  });
});
