import { describe, it, expect } from "vitest";
import { dueWindow, dispatchDedupeKey } from "./dispatch";

const TZ = "America/Costa_Rica"; // UTC-6
// Miércoles 2026-09-16, 04:00 CR = 10:00Z.
const at = (iso: string) => new Date(iso);

describe("dueWindow (F24, zona Costa Rica)", () => {
  it("daily: después de la hora es hoy", () => {
    // 04:00 CR, hora 03:00 → ya pasó → ventana de hoy.
    expect(dueWindow("daily", "03:00", at("2026-09-16T10:00:00Z"), TZ)).toBe("2026-09-16");
  });
  it("daily: antes de la hora es ayer", () => {
    // 02:00 CR (08:00Z), hora 03:00 → no pasó → ayer.
    expect(dueWindow("daily", "03:00", at("2026-09-16T08:00:00Z"), TZ)).toBe("2026-09-15");
  });
  it("hourly: la hora actual", () => {
    // 04:00 CR.
    expect(dueWindow("hourly", "00:00", at("2026-09-16T10:00:00Z"), TZ)).toBe("2026-09-16T04");
  });
  it("every6h: el bucket de 6 horas", () => {
    // 04:00 CR → bucket 00; 13:00 CR → bucket 12.
    expect(dueWindow("every6h", "00:00", at("2026-09-16T10:00:00Z"), TZ)).toBe("2026-09-16T00");
    expect(dueWindow("every6h", "00:00", at("2026-09-16T19:00:00Z"), TZ)).toBe("2026-09-16T12");
  });
  it("weekly: el lunes de esta semana", () => {
    // Miércoles → lunes 14/09.
    expect(dueWindow("weekly", "03:00", at("2026-09-16T10:00:00Z"), TZ)).toBe("2026-09-14");
  });
  it("dedupe_key", () => {
    expect(dispatchDedupeKey("ws-1", "message_classification", "2026-09-16")).toBe("bg:ws-1:message_classification:2026-09-16");
  });
});
