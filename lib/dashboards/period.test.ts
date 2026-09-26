import { describe, it, expect } from "vitest";
import { resolvePeriod, previousPeriod, PERIOD_PRESETS } from "./period";

const TZ = "America/Costa_Rica";
// Miércoles 2026-09-16 08:00 CR (Costa Rica es UTC-6, sin DST).
const NOW = new Date("2026-09-16T14:00:00.000Z");

// startOfDay CR de una fecha = ese día 06:00Z.
const crStart = (d: string) => `${d}T06:00:00.000Z`;
const crEnd = (d: string) => `${d}T05:59:59.999Z`; // fin de día = 23:59:59.999 CR = +1 día 05:59:59.999Z

describe("resolvePeriod (F14, zona Costa Rica)", () => {
  it("hoy", () => {
    expect(resolvePeriod("hoy", NOW, TZ)).toEqual({ from: crStart("2026-09-16"), to: null });
  });
  it("esta semana: lunes 14/09", () => {
    expect(resolvePeriod("esta-semana", NOW, TZ)).toEqual({ from: crStart("2026-09-14"), to: null });
  });
  it("semana pasada: lunes 07/09 a domingo 13/09", () => {
    expect(resolvePeriod("semana-pasada", NOW, TZ)).toEqual({ from: crStart("2026-09-07"), to: crEnd("2026-09-14") });
  });
  it("este mes: desde el 1", () => {
    expect(resolvePeriod("este-mes", NOW, TZ)).toEqual({ from: crStart("2026-09-01"), to: null });
  });
  it("mes pasado: agosto completo", () => {
    expect(resolvePeriod("mes-pasado", NOW, TZ)).toEqual({ from: crStart("2026-08-01"), to: crEnd("2026-09-01") });
  });
  it("últimos 7 días: incluye hoy y 6 atrás", () => {
    expect(resolvePeriod("7d", NOW, TZ)).toEqual({ from: crStart("2026-09-10"), to: null });
  });
  it("últimos 30 días", () => {
    expect(resolvePeriod("30d", NOW, TZ)).toEqual({ from: crStart("2026-08-18"), to: null });
  });
  it("este año: desde el 1 de enero", () => {
    expect(resolvePeriod("este-ano", NOW, TZ)).toEqual({ from: crStart("2026-01-01"), to: null });
  });
  it("histórico: sin límites", () => {
    expect(resolvePeriod("historico", NOW, TZ)).toEqual({ from: null, to: null });
  });
  it("cambio de mes: mes pasado en enero apunta a diciembre del año anterior", () => {
    const jan = new Date("2026-01-15T14:00:00.000Z");
    const r = resolvePeriod("mes-pasado", jan, TZ);
    expect(r.from).toBe(crStart("2025-12-01"));
    expect(r.to).toBe(crEnd("2026-01-01"));
  });
});

describe("previousPeriod (§11)", () => {
  it("el período anterior de igual duración va justo antes", () => {
    const range = { from: "2026-09-10T06:00:00.000Z", to: "2026-09-16T06:00:00.000Z" };
    const prev = previousPeriod(range, NOW);
    expect(prev.to).toBe("2026-09-10T05:59:59.999Z");
    // duración 6 días → from 6 días antes del from.
    expect(prev.from).toBe("2026-09-04T06:00:00.000Z");
  });
  it("histórico no compara", () => {
    expect(previousPeriod({ from: null, to: null }, NOW)).toEqual({ from: null, to: null });
  });
});

describe("cobertura", () => {
  it("los 11 atajos resuelven sin lanzar", () => {
    for (const p of PERIOD_PRESETS) expect(() => resolvePeriod(p, NOW, TZ)).not.toThrow();
    expect(PERIOD_PRESETS).toHaveLength(11);
  });
});
