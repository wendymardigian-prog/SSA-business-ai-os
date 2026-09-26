import { describe, it, expect } from "vitest";
import {
  validateOverrides,
  parseOverrides,
  upsertOverrides,
  trimPastOverrides,
  upcomingOverrides,
} from "./availability-schema";

describe("validateOverrides (F12)", () => {
  it("acepta 'no disponible' (rangos vacíos) y 'horario distinto'", () => {
    expect(
      validateOverrides([
        { date: "2026-10-12", ranges: [] },
        { date: "2026-10-02", ranges: [{ start: "09:00", end: "12:00" }] },
      ]),
    ).toEqual({ ok: true });
  });

  it("rechaza fechas inválidas o repetidas, marcando la fecha", () => {
    const r = validateOverrides([
      { date: "2026-02-31", ranges: [] },
      { date: "2026-10-02", ranges: [] },
      { date: "2026-10-02", ranges: [] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.day)).toEqual(["2026-02-31", "2026-10-02"]);
      expect(r.errors[1].message).toMatch(/repetida/);
    }
  });

  it("rechaza rangos superpuestos o invertidos dentro de una excepción", () => {
    const r = validateOverrides([
      {
        date: "2026-10-03",
        ranges: [
          { start: "10:00", end: "12:00" },
          { start: "11:00", end: "13:00" },
        ],
      },
    ]);
    expect(r.ok).toBe(false);
    expect(validateOverrides([{ date: "2026-10-03", ranges: [{ start: "12:00", end: "10:00" }] }]).ok).toBe(
      false,
    );
  });

  it("parseOverrides normaliza 00:00 como fin a 24:00", () => {
    expect(parseOverrides([{ date: "2026-10-03", ranges: [{ start: "22:00", end: "00:00" }] }])).toEqual([
      { date: "2026-10-03", ranges: [{ start: "22:00", end: "24:00" }] },
    ]);
  });
});

describe("upsertOverrides", () => {
  it("elegir 3 días deja 3 entradas nuevas y reemplaza la de una fecha ya existente", () => {
    const current = [{ date: "2026-10-03", ranges: [] }];
    const next = upsertOverrides(current, [
      { date: "2026-10-10", ranges: [] },
      { date: "2026-10-03", ranges: [{ start: "10:00", end: "12:00" }] },
      { date: "2026-10-17", ranges: [] },
    ]);
    expect(next.map((o) => o.date)).toEqual(["2026-10-03", "2026-10-10", "2026-10-17"]);
    expect(next[0].ranges).toEqual([{ start: "10:00", end: "12:00" }]);
  });
});

describe("trimPastOverrides / upcomingOverrides", () => {
  const overrides = [
    { date: "2026-06-01", ranges: [] }, // más de 90 días atrás
    { date: "2026-09-01", ranges: [] }, // pasada, dentro de los 90
    { date: "2026-10-10", ranges: [] },
  ];

  it("recorta solo las pasadas de más de 90 días", () => {
    const { kept, removed } = trimPastOverrides(overrides, "2026-10-01");
    expect(removed.map((o) => o.date)).toEqual(["2026-06-01"]);
    expect(kept.map((o) => o.date)).toEqual(["2026-09-01", "2026-10-10"]);
  });

  it("la lista de la pantalla oculta las pasadas", () => {
    expect(upcomingOverrides(overrides, "2026-10-01").map((o) => o.date)).toEqual(["2026-10-10"]);
  });
});
