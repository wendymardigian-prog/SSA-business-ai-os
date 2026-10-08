import { describe, it, expect } from "vitest";
import { resolveAgendaPeriod, isAgendaPeriod, AGENDA_PERIODS } from "./agenda-period";

const TZ = "America/Costa_Rica";
// Miércoles 2026-09-16 08:00 CR (Costa Rica es UTC-6, sin DST).
const NOW = new Date("2026-09-16T14:00:00.000Z");

const crStart = (d: string) => `${d}T06:00:00.000Z`;
/** Fin de día civil `d` (23:59:59.999 CR), expresado en UTC. */
function crEnd(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, day + 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}T05:59:59.999Z`;
}

describe("resolveAgendaPeriod (zona Costa Rica)", () => {
  it("7-30: últimos 7 días y próximos 30, con hoy", () => {
    expect(resolveAgendaPeriod("7-30", NOW, TZ)).toEqual({ from: crStart("2026-09-09"), to: crEnd("2026-10-16") });
  });

  it("hoy: solo el día de hoy", () => {
    expect(resolveAgendaPeriod("hoy", NOW, TZ)).toEqual({ from: crStart("2026-09-16"), to: crEnd("2026-09-16") });
  });

  it("mañana", () => {
    expect(resolveAgendaPeriod("manana", NOW, TZ)).toEqual({ from: crStart("2026-09-17"), to: crEnd("2026-09-17") });
  });

  it("esta semana: lunes 14 a domingo 20", () => {
    expect(resolveAgendaPeriod("esta-semana", NOW, TZ)).toEqual({ from: crStart("2026-09-14"), to: crEnd("2026-09-20") });
  });

  it("próxima semana: lunes 21 a domingo 27", () => {
    expect(resolveAgendaPeriod("proxima-semana", NOW, TZ)).toEqual({ from: crStart("2026-09-21"), to: crEnd("2026-09-27") });
  });

  it("este mes: setiembre completo", () => {
    expect(resolveAgendaPeriod("este-mes", NOW, TZ)).toEqual({ from: crStart("2026-09-01"), to: crEnd("2026-09-30") });
  });

  it("próximo mes: octubre completo", () => {
    expect(resolveAgendaPeriod("proximo-mes", NOW, TZ)).toEqual({ from: crStart("2026-10-01"), to: crEnd("2026-10-31") });
  });

  it("cambio de año: próximo mes en diciembre apunta a enero del año siguiente", () => {
    const dec = new Date("2026-12-15T14:00:00.000Z");
    expect(resolveAgendaPeriod("proximo-mes", dec, TZ)).toEqual({ from: crStart("2027-01-01"), to: crEnd("2027-01-31") });
  });

  it("próximos 30 días: desde hoy", () => {
    expect(resolveAgendaPeriod("proximos-30", NOW, TZ)).toEqual({ from: crStart("2026-09-16"), to: crEnd("2026-10-16") });
  });

  it("últimos 30 días: hasta hoy", () => {
    expect(resolveAgendaPeriod("ultimos-30", NOW, TZ)).toEqual({ from: crStart("2026-08-17"), to: crEnd("2026-09-16") });
  });

  it("todo: sin límites, y es el único abierto para atrás y para adelante", () => {
    expect(resolveAgendaPeriod("todo", NOW, TZ)).toEqual({ from: null, to: null });
  });

  it("los 10 atajos tienen un caso en el switch (ninguno queda undefined)", () => {
    for (const p of AGENDA_PERIODS) {
      const r = resolveAgendaPeriod(p, NOW, TZ);
      expect(r).toBeDefined();
    }
  });
});

describe("isAgendaPeriod", () => {
  it("acepta los atajos del catálogo", () => {
    expect(isAgendaPeriod("7-30")).toBe(true);
    expect(isAgendaPeriod("todo")).toBe(true);
  });
  it("rechaza cualquier otra cosa", () => {
    expect(isAgendaPeriod("")).toBe(false);
    expect(isAgendaPeriod("90d")).toBe(false);
  });
});
