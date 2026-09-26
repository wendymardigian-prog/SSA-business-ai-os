import { describe, it, expect } from "vitest";
import {
  formatSlotLabel,
  formatDateLong,
  formatSlotSummary,
  formatDateTimeWithZone,
  timezoneCityLabel,
  normalizeSpaces,
  gmtOffsetLabel,
  formatDateLongWithYear,
} from "./format";

const CR = "America/Costa_Rica";
const t = "2026-10-06T20:00:00.000Z"; // martes 6/10, 14:00 en Costa Rica

describe("formatSlotLabel (F25)", () => {
  it("20:00 UTC en Costa Rica: '2:00 p. m.' en 12h y '14:00' en 24h", () => {
    expect(normalizeSpaces(formatSlotLabel(t, CR, "12h"))).toBe("2:00 p. m.");
    expect(formatSlotLabel(t, CR, "24h")).toBe("14:00");
  });

  it("la medianoche se muestra como 00:05, no 24:05", () => {
    expect(formatSlotLabel("2026-10-06T06:05:00.000Z", CR, "24h")).toBe("00:05");
  });
});

describe("fechas en español", () => {
  it("día largo en minúsculas y resumen con mayúscula inicial", () => {
    expect(formatDateLong(t, CR)).toBe("martes 6 de octubre");
    expect(formatDateLongWithYear(t, CR)).toBe("martes 6 de octubre de 2026");
    expect(formatSlotSummary(t, "2026-10-06T20:30:00.000Z", CR, "24h")).toBe("Martes 6 de octubre, 14:00 – 14:30");
  });

  it("con zona: '(hora de Ciudad de México)'", () => {
    expect(formatDateTimeWithZone(t, "America/Mexico_City")).toBe("martes 6 de octubre, 14:00 (hora de Ciudad de México)");
    expect(timezoneCityLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(timezoneCityLabel("Europe/Rome")).toBe("Rome");
  });

  it("gmtOffsetLabel", () => {
    expect(gmtOffsetLabel(t, CR)).toBe("GMT-6");
  });
});
