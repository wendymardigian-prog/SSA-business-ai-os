/**
 * El aviso ANTES del tope de gasto de IA: cuando "esta por llegar" y cuando no.
 */

import { describe, it, expect, vi } from "vitest";
import { approachingThresholds, notifySpendApproaching, validAlertPct } from "./spend-alerts";

const day = new Date("2026-10-09T06:00:00.000Z");
const month = new Date("2026-10-01T06:00:00.000Z");

describe("validAlertPct", () => {
  it("solo un entero de 1 a 99: con 100 ya es el tope, y sin valor no hay aviso", () => {
    expect(validAlertPct(80)).toBe(80);
    expect(validAlertPct(1)).toBe(1);
    expect(validAlertPct(99)).toBe(99);
    expect(validAlertPct(0)).toBeNull();
    expect(validAlertPct(100)).toBeNull();
    expect(validAlertPct(80.5)).toBeNull();
    expect(validAlertPct(null)).toBeNull();
    expect(validAlertPct(undefined)).toBeNull();
  });
});

describe("approachingThresholds", () => {
  it("avisa desde el porcentaje y hasta justo antes del tope", () => {
    const entries = [{ scope: "workspace_daily", limitUsd: 10, spentUsd: 8, since: day }];
    expect(approachingThresholds(entries, 80)).toEqual([
      { scope: "workspace_daily", limitUsd: 10, spentUsd: 8, pct: 80, periodStart: day },
    ]);
    expect(approachingThresholds([{ ...entries[0], spentUsd: 7.99 }], 80)).toEqual([]);
    // Llegar al tope ya no es "se acerca": ahi corta o avisa, segun la accion elegida.
    expect(approachingThresholds([{ ...entries[0], spentUsd: 10 }], 80)).toEqual([]);
  });

  it("evalua los dos topes por separado", () => {
    const out = approachingThresholds(
      [
        { scope: "workspace_daily", limitUsd: 10, spentUsd: 9, since: day },
        { scope: "workspace_monthly", limitUsd: 200, spentUsd: 100, since: month },
      ],
      80,
    );
    expect(out.map((o) => o.scope)).toEqual(["workspace_daily"]);
  });

  it("sin porcentaje no hay nada, y los topes del agente no llevan aviso previo", () => {
    const entries = [
      { scope: "workspace_daily", limitUsd: 10, spentUsd: 9, since: day },
      { scope: "agent_daily", limitUsd: 5, spentUsd: 4.9, since: day },
    ];
    expect(approachingThresholds(entries, null)).toEqual([]);
    expect(approachingThresholds(entries, 80).map((o) => o.scope)).toEqual(["workspace_daily"]);
  });

  it("un tope sin monto o en cero no se evalua", () => {
    expect(approachingThresholds([{ scope: "workspace_daily", limitUsd: null, spentUsd: 5, since: day }], 80)).toEqual([]);
    expect(approachingThresholds([{ scope: "workspace_daily", limitUsd: 0, spentUsd: 5, since: day }], 80)).toEqual([]);
  });
});

describe("notifySpendApproaching", () => {
  const approach = { scope: "workspace_monthly" as const, limitUsd: 200, spentUsd: 170, pct: 80, periodStart: month };

  it("nunca lanza: un aviso que falla no frena una llamada al modelo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = {
      from() {
        throw new Error("conexion caida");
      },
    } as never;
    await expect(notifySpendApproaching(client, { workspaceId: "ws-1", approaching: [approach] })).resolves.toBeUndefined();
  });

  it("sin nada que avisar no toca la base", async () => {
    const from = vi.fn();
    await notifySpendApproaching({ from } as never, { workspaceId: "ws-1", approaching: [] });
    expect(from).not.toHaveBeenCalled();
  });
});
