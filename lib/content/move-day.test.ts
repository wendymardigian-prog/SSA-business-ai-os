/**
 * C14 · arrastrar una pieza a otro día.
 *
 * Lo importante: conserva la HORA. Mover del martes al jueves es "sale el
 * jueves a la misma hora", no "a las 00:00" — si no, arrastrar obligaría a
 * volver al editor a poner la hora de nuevo y dejaría de servir.
 */

import { describe, it, expect } from "vitest";
import { moveToDay } from "./move-day";

const TZ = "America/Costa_Rica";
// Las 18:00 UTC son las 12:00 en Costa Rica.
const MARTES = "2026-10-06T18:00:00.000Z";
const AHORA = new Date("2026-10-01T12:00:00Z");

const net = (platform: string, at: string | null) => ({ platform, planned_at: at });

describe("mover una pieza de día", () => {
  it("cambia el día y conserva la hora", () => {
    const result = moveToDay({
      networks: [net("instagram", MARTES)],
      fromDay: "2026-10-06",
      toDay: "2026-10-08",
      timeZone: TZ,
      now: AHORA,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.networks[0].planned_at).toBe("2026-10-08T18:00:00.000Z");
  });

  it("mueve solo las redes que salían ESE día", () => {
    // Una pieza que sale el martes en Instagram y el viernes en TikTok,
    // arrastrada desde el martes, deja TikTok donde estaba.
    const viernes = "2026-10-09T18:00:00.000Z";
    const result = moveToDay({
      networks: [net("instagram", MARTES), net("tiktok", viernes)],
      fromDay: "2026-10-06",
      toDay: "2026-10-08",
      timeZone: TZ,
      now: AHORA,
    });

    expect(result.ok && result.moved).toEqual(["instagram"]);
    expect(result.ok && result.networks[1].planned_at).toBe(viernes);
  });

  it("también hacia atrás", () => {
    const result = moveToDay({
      networks: [net("instagram", MARTES)],
      fromDay: "2026-10-06",
      toDay: "2026-10-05",
      timeZone: TZ,
      now: AHORA,
    });

    expect(result.ok && result.networks[0].planned_at).toBe("2026-10-05T18:00:00.000Z");
  });

  it("no deja moverla al pasado", () => {
    const result = moveToDay({
      networks: [net("instagram", MARTES)],
      fromDay: "2026-10-06",
      toDay: "2026-09-20",
      timeZone: TZ,
      now: AHORA,
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("ya paso") });
  });

  it("una red sin fecha no se toca", () => {
    const result = moveToDay({
      networks: [net("instagram", MARTES), net("youtube", null)],
      fromDay: "2026-10-06",
      toDay: "2026-10-08",
      timeZone: TZ,
      now: AHORA,
    });

    expect(result.ok && result.networks[1].planned_at).toBeNull();
  });

  it("si ninguna red sale ese día, lo dice", () => {
    const result = moveToDay({
      networks: [net("instagram", MARTES)],
      fromDay: "2026-10-01",
      toDay: "2026-10-08",
      timeZone: TZ,
      now: AHORA,
    });

    expect(result.ok).toBe(false);
  });

  it("un día mal formado no rompe nada", () => {
    expect(
      moveToDay({
        networks: [net("instagram", MARTES)],
        fromDay: "2026-10-06",
        toDay: "cualquier cosa",
        timeZone: TZ,
        now: AHORA,
      }).ok,
    ).toBe(false);
  });
});
