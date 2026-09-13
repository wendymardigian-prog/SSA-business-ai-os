import { describe, it, expect } from "vitest";
import { evaluateSpend } from "./spend";
import { startOfZonedDay, startOfZonedMonth } from "@/lib/dates";

describe("evaluar los topes de gasto", () => {
  it("por debajo de los topes: sigue sin avisos", () => {
    const r = evaluateSpend([
      { scope: "agent_daily", limitUsd: 5, action: "notify", spentUsd: 4.99 },
      { scope: "agent_monthly", limitUsd: 100, action: "disable", spentUsd: 40 },
    ]);
    expect(r).toEqual({ allowed: true, warnings: [] });
  });

  it("el diario alcanzado AVISA pero no corta: cortar leads por un numero todavia desconocido es peor", () => {
    const r = evaluateSpend([
      { scope: "agent_daily", limitUsd: 5, action: "notify", spentUsd: 5 },
      { scope: "agent_monthly", limitUsd: 100, action: "disable", spentUsd: 40 },
    ]);
    expect(r.allowed).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ scope: "agent_daily", spentUsd: 5 });
  });

  it("el mensual alcanzado CORTA", () => {
    const r = evaluateSpend([
      { scope: "agent_daily", limitUsd: 5, action: "notify", spentUsd: 6 },
      { scope: "agent_monthly", limitUsd: 100, action: "disable", spentUsd: 100.01 },
    ]);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.blocking.scope).toBe("agent_monthly");
    expect(r.warnings.map((w) => w.scope)).toEqual(["agent_daily"]);
  });

  it("sin tope cargado no se evalua", () => {
    expect(evaluateSpend([{ scope: "workspace_monthly", limitUsd: null, action: "disable", spentUsd: 999 }]))
      .toEqual({ allowed: true, warnings: [] });
  });
});

describe("cortes de dia y mes en la zona del negocio (Costa Rica, UTC-6)", () => {
  it("a las 23:30 de Costa Rica sigue siendo el mismo dia, aunque en UTC ya sea manana", () => {
    // 2026-09-20 23:30 en Costa Rica = 2026-09-21 05:30 UTC.
    const now = new Date("2026-09-21T05:30:00Z");
    expect(startOfZonedDay(now, "America/Costa_Rica").toISOString()).toBe("2026-09-20T06:00:00.000Z");
  });

  it("el mes empieza a la medianoche del 1 en Costa Rica", () => {
    const now = new Date("2026-10-01T03:00:00Z"); // 30 de septiembre 21:00 en CR
    expect(startOfZonedMonth(now, "America/Costa_Rica").toISOString()).toBe("2026-09-01T06:00:00.000Z");
  });
});
