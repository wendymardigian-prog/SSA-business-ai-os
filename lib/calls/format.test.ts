import { describe, expect, it } from "vitest";
import { formatAgo, formatCallDate, formatDuration, humanize } from "./format";

describe("formatCallDate", () => {
  it("usa la zona de quien mira: las 21:00Z son las 15:00 en Costa Rica", () => {
    expect(formatCallDate("2026-10-08T21:00:00Z", "America/Costa_Rica")).toContain("15:00");
    expect(formatCallDate("2026-10-08T21:00:00Z", "UTC")).toContain("21:00");
  });
  it("una fecha rota o vacia no rompe", () => {
    expect(formatCallDate(null, "UTC")).toBe("—");
    expect(formatCallDate("nada", "UTC")).toBe("—");
  });
  it("la corta no lleva hora", () => {
    expect(formatCallDate("2026-10-08T21:00:00Z", "UTC", "short")).not.toContain(":");
  });
});

describe("formatDuration", () => {
  it("minutos, horas y vacios", () => {
    expect(formatDuration(45 * 60)).toBe("45 min");
    expect(formatDuration(90 * 60)).toBe("1 h 30 min");
    expect(formatDuration(120 * 60)).toBe("2 h");
    expect(formatDuration(30)).toBe("<1 min");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("—");
  });
});

describe("formatAgo / humanize", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("dice el tiempo en castellano", () => {
    expect(formatAgo("2026-10-10T11:59:50Z", now)).toBe("recién");
    expect(formatAgo("2026-10-10T11:30:00Z", now)).toBe("hace 30 min");
    expect(formatAgo("2026-10-10T10:00:00Z", now)).toBe("hace 2 horas");
    expect(formatAgo("2026-10-09T10:00:00Z", now)).toBe("ayer");
    expect(formatAgo("2026-10-05T10:00:00Z", now)).toBe("hace 5 días");
    expect(formatAgo(null, now)).toBe("");
  });
  it("humanize", () => {
    expect(humanize("falta_de_tiempo")).toBe("Falta de tiempo");
    expect(humanize(null)).toBe("");
  });
});
