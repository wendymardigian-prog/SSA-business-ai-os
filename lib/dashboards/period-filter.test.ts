import { describe, expect, it } from "vitest";
import { applyPeriodToParams, periodLabel, periodQuery, readDashboardPeriod, resolveDashboardPeriod } from "./period-filter";

const FROM = "2026-09-02T06:00:00.000Z";
const TO = "2026-09-06T05:59:59.999Z";
const ZONE = "America/Costa_Rica";

describe("readDashboardPeriod", () => {
  it("lee un atajo y, sin nada, usa los 30 dias", () => {
    expect(readDashboardPeriod(new URLSearchParams("range=7d"))).toEqual({ period: "7d", from: null, to: null });
    expect(readDashboardPeriod(new URLSearchParams())).toEqual({ period: "30d", from: null, to: null });
  });

  it("entiende el objeto de searchParams de una pagina", () => {
    expect(readDashboardPeriod({ range: "90d", cuenta: "act_1" }).period).toBe("90d");
    expect(readDashboardPeriod({ range: ["7d", "90d"] }).period).toBe("30d");
  });

  it("sigue entendiendo un link viejo con periodo, y range le gana", () => {
    expect(readDashboardPeriod({ periodo: "7d" }).period).toBe("7d");
    expect(readDashboardPeriod({ periodo: "7d", range: "90d" }).period).toBe("90d");
  });

  it("lee un rango a medida solo con las dos puntas validas", () => {
    expect(readDashboardPeriod({ from: FROM, to: TO })).toEqual({ period: "30d", from: FROM, to: TO });
    expect(readDashboardPeriod({ from: FROM }).from).toBeNull();
    expect(readDashboardPeriod({ from: "basura", to: TO }).from).toBeNull();
  });

  it("un rango invertido no cuenta como rango", () => {
    expect(readDashboardPeriod({ from: TO, to: FROM })).toEqual({ period: "30d", from: null, to: null });
  });

  it("un atajo que no existe cae a los 30 dias", () => {
    expect(readDashboardPeriod({ range: "cualquiera" }).period).toBe("30d");
  });
});

describe("resolveDashboardPeriod", () => {
  const now = new Date("2026-09-20T15:00:00.000Z");

  it("el rango a medida gana sobre el atajo", () => {
    expect(resolveDashboardPeriod({ period: "7d", from: FROM, to: TO }, now, ZONE)).toEqual({ from: FROM, to: TO });
  });

  it("sin rango, resuelve el atajo", () => {
    expect(resolveDashboardPeriod({ period: "historico", from: null, to: null }, now, ZONE).from).toBeNull();
    expect(resolveDashboardPeriod({ period: "7d", from: null, to: null }, now, ZONE).from).not.toBeNull();
  });
});

describe("periodQuery: los links conservan lo elegido", () => {
  it("con un rango lleva las dos puntas y la cuenta", () => {
    const params = new URLSearchParams(periodQuery({ period: "30d", from: FROM, to: TO }, { cuenta: "act_9" }));
    expect(params.get("cuenta")).toBe("act_9");
    expect(params.get("from")).toBe(FROM);
    expect(params.get("to")).toBe(TO);
    expect(params.has("range")).toBe(false);
  });

  it("con un atajo lleva range, y los 30 dias no hace falta escribirlos", () => {
    expect(periodQuery({ period: "7d", from: null, to: null }, { cuenta: "act_9" })).toBe("cuenta=act_9&range=7d");
    expect(periodQuery({ period: "30d", from: null, to: null }, { cuenta: "act_9" })).toBe("cuenta=act_9");
  });
});

describe("applyPeriodToParams", () => {
  it("elegir un atajo despues de un rango lo saca, o el rango seguiria ganando", () => {
    const current = new URLSearchParams({ from: FROM, to: TO, cuenta: "act_9" });
    const next = applyPeriodToParams(current, { preset: "7d", from: null, to: null });
    expect(next.toString()).toBe("cuenta=act_9&range=7d");
  });

  it("elegir un rango saca el atajo y el nombre viejo", () => {
    const current = new URLSearchParams({ range: "7d", periodo: "90d", red: "instagram" });
    const next = applyPeriodToParams(current, { preset: null, from: FROM, to: TO });
    expect(next.get("red")).toBe("instagram");
    expect(next.get("from")).toBe(FROM);
    expect(next.has("range")).toBe(false);
    expect(next.has("periodo")).toBe(false);
  });

  it("no modifica los parametros que recibe", () => {
    const current = new URLSearchParams({ range: "7d" });
    applyPeriodToParams(current, { preset: "90d", from: null, to: null });
    expect(current.get("range")).toBe("7d");
  });
});

describe("periodLabel", () => {
  it("un atajo dice su nombre", () => {
    expect(periodLabel({ period: "7d", from: null, to: null }, ZONE)).toBe("Últimos 7 días");
  });

  it("un rango dice sus dias en la zona de quien mira, no los del UTC", () => {
    expect(periodLabel({ period: "30d", from: FROM, to: TO }, ZONE)).toBe("02 sept 2026 – 05 sept 2026");
  });
});
