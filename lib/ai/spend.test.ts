import { describe, it, expect } from "vitest";
import { checkSpendLimits, evaluateSpend, workspaceSpendCandidates } from "./spend";
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

describe("las acciones de los topes del workspace (00133)", () => {
  const now = new Date("2026-10-09T18:00:00Z");
  const base = { dailyUsd: 10, monthlyUsd: 200, now, timeZone: "America/Costa_Rica" };

  it("sin elegir nada, los dos CORTAN: es lo que hacian antes de que fueran configurables", () => {
    const out = workspaceSpendCandidates(base);
    expect(out.map((c) => [c.scope, c.action])).toEqual([
      ["workspace_daily", "disable"],
      ["workspace_monthly", "disable"],
    ]);
  });

  it("cada tope elige: el diario solo avisa y el mensual sigue cortando", () => {
    const out = workspaceSpendCandidates({ ...base, dailyAction: "notify", monthlyAction: "disable" });
    expect(out.map((c) => c.action)).toEqual(["notify", "disable"]);
  });

  it("ante un valor raro de la base, corta: solo 'notify' expreso deja de cortar", () => {
    const out = workspaceSpendCandidates({ ...base, dailyAction: "otra-cosa" as never, monthlyAction: null });
    expect(out.map((c) => c.action)).toEqual(["disable", "disable"]);
  });

  it("un tope diario del workspace en 'notify' que se alcanza deja pasar, con aviso", () => {
    const [daily] = workspaceSpendCandidates({ ...base, dailyAction: "notify" });
    const r = evaluateSpend([{ scope: daily.scope, limitUsd: daily.limitUsd, action: daily.action, spentUsd: 10 }]);
    expect(r.allowed).toBe(true);
    expect(r.warnings.map((w) => w.scope)).toEqual(["workspace_daily"]);
  });
});

describe("checkSpendLimits con las acciones y el aviso previo", () => {
  /** Un cliente que responde sum_ai_spend segun la ventana pedida (dia = mas nuevo que el mes). */
  function fakeDb(spent: { daily: number; monthly: number }, notifications: Array<Record<string, unknown>> = []) {
    const inserts: Array<Record<string, unknown>> = [];
    const client = {
      rpc: async (_name: string, args: { p_since: string }) => {
        const dayStart = new Date("2026-10-09T06:00:00.000Z").toISOString();
        return { data: args.p_since === dayStart ? spent.daily : spent.monthly, error: null };
      },
      from: (table: string) => {
        if (table !== "notifications") throw new Error(`tabla inesperada: ${table}`);
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ contains: () => ({ limit: async () => ({ data: notifications, error: null }) }) }) }),
          }),
          insert: async (row: Record<string, unknown>) => {
            inserts.push(row);
            return { error: null };
          },
        };
      },
    };
    return { client: client as never, inserts };
  }

  const limits = {
    agentDailyUsd: null,
    agentDailyAction: "notify" as const,
    agentMonthlyUsd: null,
    agentMonthlyAction: "disable" as const,
    workspaceDailyUsd: 10,
    workspaceMonthlyUsd: 200,
  };
  const args = { workspaceId: "ws-1", agentId: "ag-1", now: new Date("2026-10-09T18:00:00Z"), timeZone: "America/Costa_Rica" };

  it("el diario del workspace en 'notify' alcanzado ya no frena la llamada", async () => {
    const { client } = fakeDb({ daily: 12, monthly: 50 });
    const r = await checkSpendLimits(client, { ...args, limits: { ...limits, workspaceDailyAction: "notify" } });
    expect(r.allowed).toBe(true);
    expect(r.warnings.map((w) => w.scope)).toEqual(["workspace_daily"]);
  });

  it("el diario del workspace por defecto sigue frenando", async () => {
    const { client } = fakeDb({ daily: 12, monthly: 50 });
    const r = await checkSpendLimits(client, { ...args, limits });
    expect(r.allowed).toBe(false);
  });

  it("pasar el % de aviso crea UNA notificacion, sin frenar", async () => {
    const { client, inserts } = fakeDb({ daily: 8, monthly: 50 });
    const r = await checkSpendLimits(client, { ...args, limits: { ...limits, alertPct: 80 } });
    expect(r.allowed).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      workspace_id: "ws-1",
      type: "ai_spend_threshold",
      metadata: { scope: "workspace_daily", pct: 80, period_start: "2026-10-09T06:00:00.000Z" },
    });
  });

  it("si ya hay un aviso de ese tope en este periodo, no crea otro", async () => {
    const { client, inserts } = fakeDb({ daily: 8, monthly: 50 }, [{ id: "n-1" }]);
    await checkSpendLimits(client, { ...args, limits: { ...limits, alertPct: 80 } });
    expect(inserts).toHaveLength(0);
  });

  it("sin porcentaje elegido no hay aviso previo", async () => {
    const { client, inserts } = fakeDb({ daily: 9.9, monthly: 199 });
    await checkSpendLimits(client, { ...args, limits });
    expect(inserts).toHaveLength(0);
  });
});
