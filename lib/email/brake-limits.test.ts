import { describe, expect, it } from "vitest";
import {
  BRAKE_BOUNCE_PCT_RANGE,
  BRAKE_COMPLAINT_PCT_RANGE,
  brakeLimitsFromConfig,
  DEFAULT_BRAKE_LIMITS,
  formatBrakePct,
  parseBrakePct,
  pctToRate,
} from "./brake-limits";

describe("brakeLimitsFromConfig", () => {
  it("sin guardar rigen 2 % y 0,05 %", () => {
    expect(brakeLimitsFromConfig({})).toEqual({ bouncePct: 2, complaintPct: 0.05 });
    expect(brakeLimitsFromConfig(null)).toEqual(DEFAULT_BRAKE_LIMITS);
  });

  it("lee lo guardado", () => {
    expect(brakeLimitsFromConfig({ marketing_brake_bounce_pct: "3", marketing_brake_complaint_pct: "0.3" })).toEqual({ bouncePct: 3, complaintPct: 0.3 });
  });

  it("un valor invalido o fuera de rango vale lo de por defecto, sin lanzar", () => {
    for (const bad of ["", "abc", "0", "1000", "-1", 3, null]) {
      expect(brakeLimitsFromConfig({ marketing_brake_bounce_pct: bad, marketing_brake_complaint_pct: bad })).toEqual(DEFAULT_BRAKE_LIMITS);
    }
  });
});

describe("pctToRate", () => {
  it("da el mismo numero que el cociente exacto (el limite justo no puede frenar por la coma flotante)", () => {
    expect(pctToRate(2)).toBe(0.02);
    expect(pctToRate(0.05)).toBe(0.0005);
    expect(pctToRate(3)).toBe(6 / 200);
    expect(pctToRate(0.3)).toBe(3 / 1000);
  });
});

describe("parseBrakePct", () => {
  it("admite coma, punto y el signo de porcentaje, y guarda con punto", () => {
    expect(parseBrakePct("0,3", BRAKE_COMPLAINT_PCT_RANGE, "Quejas")).toEqual({ ok: true, value: "0.3" });
    expect(parseBrakePct("0.05", BRAKE_COMPLAINT_PCT_RANGE, "Quejas")).toEqual({ ok: true, value: "0.05" });
    expect(parseBrakePct("3 %", BRAKE_BOUNCE_PCT_RANGE, "Rebotes")).toEqual({ ok: true, value: "3" });
    expect(parseBrakePct(3, BRAKE_BOUNCE_PCT_RANGE, "Rebotes")).toEqual({ ok: true, value: "3" });
  });

  it("rechaza lo que no es un porcentaje o se sale del rango, nombrando el campo", () => {
    for (const bad of ["", "abc", "1,2,3", "-1", "0,001"]) {
      const r = parseBrakePct(bad, BRAKE_COMPLAINT_PCT_RANGE, "Quejas");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("Quejas");
    }
    expect(parseBrakePct("11", BRAKE_BOUNCE_PCT_RANGE, "Rebotes").ok).toBe(false);
    expect(parseBrakePct("0.4", BRAKE_BOUNCE_PCT_RANGE, "Rebotes").ok).toBe(false);
  });
});

describe("formatBrakePct", () => {
  it("como lo lee una persona", () => {
    expect(formatBrakePct(0.05)).toBe("0,05");
    expect(formatBrakePct(2)).toBe("2");
  });
});
