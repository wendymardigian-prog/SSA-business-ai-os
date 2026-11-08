import { describe, it, expect } from "vitest";
import { bucketTimes, combineProjection, projectBroadcasts, projectionDays } from "./projection";
import { DEFAULT_WHATSAPP_POLICY, type SendPolicy } from "@/lib/send-queue/pace";

const TZ = "America/Costa_Rica";
// Domingo 8/11/2026 9:00 en Costa Rica.
const NOW = new Date("2026-11-08T15:00:00Z");
const open: SendPolicy = { ...DEFAULT_WHATSAPP_POLICY, minGapSeconds: 60, maxGapSeconds: 60, perMinute: null, perHour: null, perDay: 100, window: { enabled: false, days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" } };

describe("projectionDays", () => {
  it("hoy y los 6 dias siguientes en la zona", () => {
    expect(projectionDays(NOW, TZ)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]);
  });
});

describe("projectBroadcasts", () => {
  it("respeta el tope diario y lo ya mandado hoy", () => {
    const out = projectBroadcasts([{ start: NOW, pending: 250, policy: open }], { now: NOW, laneTimeZone: TZ, viewerTimeZone: TZ, sentToday: 40 });
    expect(out["2026-11-08"]).toBe(60);
    expect(out["2026-11-09"]).toBe(100);
    expect(out["2026-11-10"]).toBe(90);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(250);
  });

  it("uno programado arranca ese dia; dos en cola van uno detras del otro", () => {
    const out = projectBroadcasts(
      [
        { start: new Date("2026-11-10T15:00:00Z"), pending: 30, policy: open },
        { start: NOW, pending: 150, policy: open },
      ],
      { now: NOW, laneTimeZone: TZ, viewerTimeZone: TZ },
    );
    expect(out["2026-11-08"]).toBe(100);
    expect(out["2026-11-09"]).toBe(50);
    expect(out["2026-11-10"]).toBe(30);
  });

  it("con el horario de envio, el domingo no sale nada (ventana de lunes a sabado)", () => {
    const out = projectBroadcasts([{ start: NOW, pending: 10, policy: DEFAULT_WHATSAPP_POLICY }], { now: NOW, laneTimeZone: TZ, viewerTimeZone: TZ });
    expect(out["2026-11-08"]).toBe(0);
    expect(out["2026-11-09"]).toBe(10);
  });

  it("lo que no entra en 7 dias se corta", () => {
    const out = projectBroadcasts([{ start: NOW, pending: 5000, policy: open }], { now: NOW, laneTimeZone: TZ, viewerTimeZone: TZ });
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(700);
  });
});

describe("bucketTimes y combineProjection", () => {
  it("un vencido cuenta hoy; despues del horizonte no cuenta", () => {
    const out = bucketTimes(["2026-11-01T10:00:00Z", "2026-11-09T18:00:00Z", "2026-12-30T10:00:00Z", "basura"], { now: NOW, viewerTimeZone: TZ });
    expect(out["2026-11-08"]).toBe(1);
    expect(out["2026-11-09"]).toBe(1);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("junta las tres fuentes por dia", () => {
    const keys = ["2026-11-08", "2026-11-09"];
    expect(combineProjection(keys, { broadcast: { "2026-11-08": 3 }, scheduled: { "2026-11-09": 2 } })).toEqual({
      "2026-11-08": { broadcast: 3, sequence: 0, scheduled: 0 },
      "2026-11-09": { broadcast: 0, sequence: 0, scheduled: 2 },
    });
  });
});
