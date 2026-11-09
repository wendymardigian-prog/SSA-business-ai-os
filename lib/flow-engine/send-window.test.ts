import { describe, expect, it } from "vitest";
import { sendWindowOf, sendWindowProblem, windowOpening, WINDOW_ORDER_PROBLEM, WINDOW_TIME_PROBLEM } from "./send-window";

const CR = "America/Costa_Rica"; // UTC-6, sin horario de verano
const W = { from: "08:00", to: "21:00" };
const at = (iso: string) => new Date(iso);

describe("windowOpening", () => {
  it("dentro del horario: se manda ahora", () => {
    // 15:00 en Costa Rica
    expect(windowOpening(at("2026-11-09T21:00:00Z"), CR, W)).toBeNull();
    // justo a las 08:00 ya está abierto
    expect(windowOpening(at("2026-11-09T14:00:00Z"), CR, W)).toBeNull();
    // 20:59
    expect(windowOpening(at("2026-11-10T02:59:00Z"), CR, W)).toBeNull();
  });

  it("de madrugada: abre hoy a las 08:00", () => {
    // 03:00 en Costa Rica del 10/11
    expect(windowOpening(at("2026-11-10T09:00:00Z"), CR, W)?.toISOString()).toBe("2026-11-10T14:00:00.000Z");
  });

  it("de noche: abre mañana a las 08:00", () => {
    // 23:00 en Costa Rica del 9/11
    expect(windowOpening(at("2026-11-10T05:00:00Z"), CR, W)?.toISOString()).toBe("2026-11-10T14:00:00.000Z");
    // a las 21:00 en punto ya está cerrado
    expect(windowOpening(at("2026-11-10T03:00:00Z"), CR, W)?.toISOString()).toBe("2026-11-10T14:00:00.000Z");
  });

  it("usa la zona del negocio, no la del servidor", () => {
    // Las 03:00 UTC son las 21:00 en Costa Rica (cerrado) pero las 04:00 en Madrid (cerrado, abre a las 08:00 de Madrid).
    expect(windowOpening(at("2026-11-10T03:00:00Z"), "Europe/Madrid", W)?.toISOString()).toBe("2026-11-10T07:00:00.000Z");
    // Las 15:00 UTC son las 09:00 en Costa Rica (abierto).
    expect(windowOpening(at("2026-11-09T15:00:00Z"), CR, W)).toBeNull();
  });

  it("el día del cambio de horario de verano abre a la hora de pared correcta", () => {
    // Nueva York, domingo 8/3/2026: las 02:00 saltan a las 03:00. A las 01:00 locales (06:00Z) todavía es EST.
    const opens = windowOpening(at("2026-03-08T06:00:00Z"), "America/New_York", W);
    // 08:00 EDT = 12:00Z
    expect(opens?.toISOString()).toBe("2026-03-08T12:00:00.000Z");
  });
});

describe("sendWindowOf / sendWindowProblem", () => {
  it("apagado o sin dato: no hay horario", () => {
    expect(sendWindowOf(undefined)).toBeNull();
    expect(sendWindowOf({})).toBeNull();
    expect(sendWindowOf({ windowEnabled: false, windowFrom: "08:00", windowTo: "21:00" })).toBeNull();
    expect(sendWindowProblem({ windowEnabled: false, windowFrom: "99:00", windowTo: "x" })).toBeNull();
  });

  it("prendido sin horas: usa 08:00 a 21:00", () => {
    expect(sendWindowOf({ windowEnabled: true })).toEqual({ from: "08:00", to: "21:00" });
  });

  it("prendido con horas propias", () => {
    expect(sendWindowOf({ windowEnabled: true, windowFrom: "09:30", windowTo: "18:00" })).toEqual({ from: "09:30", to: "18:00" });
  });

  it("horas mal escritas o al revés: es un problema y el paso sale como siempre", () => {
    expect(sendWindowProblem({ windowEnabled: true, windowFrom: "8am", windowTo: "21:00" })).toBe(WINDOW_TIME_PROBLEM);
    expect(sendWindowProblem({ windowEnabled: true, windowFrom: "21:00", windowTo: "08:00" })).toBe(WINDOW_ORDER_PROBLEM);
    expect(sendWindowProblem({ windowEnabled: true, windowFrom: "10:00", windowTo: "10:00" })).toBe(WINDOW_ORDER_PROBLEM);
    expect(sendWindowOf({ windowEnabled: true, windowFrom: "21:00", windowTo: "08:00" })).toBeNull();
  });
});
