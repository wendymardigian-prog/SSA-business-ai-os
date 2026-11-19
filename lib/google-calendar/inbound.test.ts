import { describe, expect, it } from "vitest";
import { decideInbound, fullSyncFrom, type InboundBooking } from "./inbound";

const booking: InboundBooking = {
  id: "b1",
  start_at: "2026-12-01T09:00:00.000Z",
  end_at: "2026-12-01T09:30:00.000Z",
  status_group: "active",
};
const free = { pendingPlatformSync: false };

describe("decideInbound (00430)", () => {
  it("movida en Google: nueva hora y duración", () => {
    expect(decideInbound({ id: "e", status: "confirmed", startUtc: "2026-12-02T10:00:00.000Z", endUtc: "2026-12-02T10:45:00.000Z" }, booking, free))
      .toEqual({ kind: "move", startUtc: "2026-12-02T10:00:00.000Z", durationMinutes: 45 });
  });

  it("misma hora: no se hace nada (sin eco)", () => {
    expect(decideInbound({ id: "e", status: "confirmed", startUtc: "2026-12-01T09:00:00.000Z", endUtc: "2026-12-01T09:30:00.000Z" }, booking, free))
      .toEqual({ kind: "ignore", reason: "same_time" });
  });

  it("misma hora escrita con otro desfase horario: tampoco hay eco", () => {
    expect(decideInbound({ id: "e", status: "confirmed", startUtc: "2026-12-01T09:00:00Z", endUtc: "2026-12-01T09:30:00Z" }, booking, free))
      .toEqual({ kind: "ignore", reason: "same_time" });
  });

  it("cancelada en Google: se cancela", () => {
    expect(decideInbound({ id: "e", status: "cancelled", startUtc: null, endUtc: null }, booking, free)).toEqual({ kind: "cancel" });
  });

  it("gana la plataforma si tiene un cambio sin mandar, y una cancelada acá no se toca", () => {
    const moved = { id: "e", status: "confirmed" as const, startUtc: "2026-12-02T10:00:00.000Z", endUtc: "2026-12-02T10:30:00.000Z" };
    expect(decideInbound(moved, booking, { pendingPlatformSync: true })).toEqual({ kind: "ignore", reason: "pending_platform_change" });
    expect(decideInbound(moved, { ...booking, status_group: "cancelled" }, free)).toEqual({ kind: "ignore", reason: "already_cancelled" });
    expect(decideInbound({ ...moved, status: "cancelled" }, booking, { pendingPlatformSync: true })).toEqual({ kind: "ignore", reason: "pending_platform_change" });
  });

  it("día entero o duración fuera de 15 min a 8 h: no se mueve", () => {
    expect(decideInbound({ id: "e", status: "confirmed", startUtc: null, endUtc: null }, booking, free)).toEqual({ kind: "ignore", reason: "all_day" });
    expect(decideInbound({ id: "e", status: "confirmed", startUtc: "2026-12-02T10:00:00.000Z", endUtc: "2026-12-02T10:05:00.000Z" }, booking, free).kind).toBe("ignore");
    expect(decideInbound({ id: "e", status: "confirmed", startUtc: "2026-12-02T10:00:00.000Z", endUtc: "2026-12-02T19:00:00.000Z" }, booking, free).kind).toBe("ignore");
  });

  it("la lectura completa arranca un día atrás", () => {
    expect(fullSyncFrom(new Date("2026-12-01T09:00:00.000Z"))).toBe("2026-11-30T09:00:00.000Z");
  });
});
