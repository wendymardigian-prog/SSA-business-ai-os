import { describe, it, expect } from "vitest";
import { dailySeries, dailySince, dailyTotals, niceMax, withProjection } from "./daily";

const NOW = new Date("2026-11-08T15:00:00Z"); // 9:00 en Costa Rica (UTC-6)
const TZ = "America/Costa_Rica";

describe("dailySeries", () => {
  it("arma 30 dias terminando hoy en la zona, con lo que no vino en 0", () => {
    const series = dailySeries([{ day: "2026-11-08", received: 3, human: 2, external: 1 }, { day: "2026-10-10", automation: 4 }], NOW, TZ);
    expect(series).toHaveLength(30);
    expect(series[0].day).toBe("2026-10-10");
    expect(series[0]).toMatchObject({ automation: 4, sent: 4, label: "10/10" });
    expect(series[29]).toMatchObject({ day: "2026-11-08", received: 3, human: 2, external: 1, sent: 3, label: "8/11" });
    expect(series[15]).toMatchObject({ sent: 0, received: 0 });
  });

  it("el dia lo pone la zona de quien mira, no UTC", () => {
    const lateNight = new Date("2026-11-09T03:00:00Z"); // 21:00 del 8 en Costa Rica
    expect(dailySeries([], lateNight, TZ).at(-1)?.day).toBe("2026-11-08");
    expect(dailySeries([], lateNight, "UTC").at(-1)?.day).toBe("2026-11-09");
  });

  it("descarta valores raros", () => {
    const [point] = dailySeries([{ day: "2026-11-08", human: -3, agent: Number.NaN }], NOW, TZ, 1);
    expect(point).toMatchObject({ human: 0, agent: 0, sent: 0 });
  });
});

describe("dailySince", () => {
  it("el inicio del primer dia del periodo, en la zona", () => {
    expect(dailySince(NOW, TZ).toISOString()).toBe("2026-10-10T06:00:00.000Z");
  });
});

describe("dailyTotals y niceMax", () => {
  it("suma por origen, el dia mas cargado y el promedio", () => {
    const series = dailySeries([{ day: "2026-11-07", automation: 10, human: 5 }, { day: "2026-11-08", agent: 2, received: 4 }], NOW, TZ);
    const totals = dailyTotals(series);
    expect(totals).toMatchObject({ sent: 17, received: 4, byKind: { automation: 10, broadcast: 0, agent: 2, approved: 0, human: 5, external: 0 } });
    expect(totals.maxSentDay?.day).toBe("2026-11-07");
    expect(totals.avgSent).toBeCloseTo(17 / 30);
  });

  it("un techo redondo", () => {
    expect([0, 1, 3, 7, 12, 48, 51, 180, 1000].map(niceMax)).toEqual([1, 1, 5, 10, 20, 50, 100, 200, 1000]);
  });
});

describe("withProjection", () => {
  it("hoy lleva lo que falta encima; los dias que vienen se agregan solo con lo proyectado", () => {
    const series = dailySeries([{ day: "2026-11-08", broadcast: 5 }], NOW, TZ);
    const out = withProjection(series, {
      "2026-11-08": { broadcast: 20, sequence: 1, scheduled: 0 },
      "2026-11-09": { broadcast: 100, sequence: 0, scheduled: 1 },
      "2026-11-10": { broadcast: 0, sequence: 0, scheduled: 0 },
    });
    expect(out).toHaveLength(32);
    expect(out[29]).toMatchObject({ day: "2026-11-08", broadcast: 5, sent: 5, future: false, projected: { broadcast: 20, sequence: 1 } });
    expect(out[30]).toMatchObject({ day: "2026-11-09", label: "9/11", sent: 0, future: true, projected: { broadcast: 100, scheduled: 1 } });
    expect(out[31]).toMatchObject({ day: "2026-11-10", future: true, projected: null });
    const totals = dailyTotals(out);
    expect(totals).toMatchObject({ sent: 5, projected: 122 });
    expect(totals.avgSent).toBeCloseTo(5 / 30);
  });

  it("sin proyeccion, la serie queda igual", () => {
    const series = dailySeries([], NOW, TZ);
    expect(withProjection(series, null)).toEqual(series);
  });
});
