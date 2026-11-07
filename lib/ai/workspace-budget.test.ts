import { describe, it, expect } from "vitest";
import { checkSpendLimits, isTemporaryBlock, workspaceSpendCandidates } from "./spend";
import { withinWorkspaceBudget } from "./workspace-budget";

/**
 * "Llegue al tope" tiene que significar lo mismo para el agente
 * (checkSpendLimits) y para lo que no es el agente (withinWorkspaceBudget:
 * clasificador y analisis de anuncios). Antes no: uno avisaba con el tope
 * diario y el otro cortaba, y el otro ademas arrancaba el "dia" a la
 * medianoche UTC, seis horas antes que la de Costa Rica.
 */

const TZ = "America/Costa_Rica";
// 21:00 del 1/10 en Costa Rica: en UTC ya es 2/10.
const NOW = new Date("2026-10-02T03:00:00Z");
const DAY_START = "2026-10-01T06:00:00.000Z";
const MONTH_START = "2026-10-01T06:00:00.000Z";
// A mitad de mes, el comienzo del dia y el del mes son instantes distintos y
// la suma de cada ventana se distingue.
const MID = new Date("2026-10-16T03:00:00Z");
const MID_DAY_START = "2026-10-15T06:00:00.000Z";

function fakeDb(opts: {
  daily: number | string | null;
  monthly: number | string | null;
  spentToday: number;
  spentMonth: number;
  failRpc?: boolean;
  failWorkspace?: boolean;
}) {
  const sinces: string[] = [];
  const client = {
    rpc: async (_fn: string, args: { p_since: string }) => {
      sinces.push(args.p_since);
      if (opts.failRpc) return { data: null, error: { message: "boom" } };
      return { data: args.p_since === MID_DAY_START ? opts.spentToday : opts.spentMonth, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            opts.failWorkspace
              ? { data: null, error: { message: "sin conexion" } }
              : {
                  data: { ai_daily_cost_limit_usd: opts.daily, ai_monthly_cost_limit_usd: opts.monthly, timezone: TZ },
                  error: null,
                },
        }),
      }),
    }),
  };
  return { client: client as never, sinces };
}

async function both(opts: Parameters<typeof fakeDb>[0], now = MID) {
  const a = fakeDb(opts);
  const b = fakeDb(opts);
  const agent = await checkSpendLimits(a.client, {
    workspaceId: "ws-1",
    agentId: "ag-1",
    limits: {
      agentDailyUsd: null,
      agentDailyAction: "notify",
      agentMonthlyUsd: null,
      agentMonthlyAction: "disable",
      workspaceDailyUsd: opts.daily === null ? null : Number(opts.daily),
      workspaceMonthlyUsd: opts.monthly === null ? null : Number(opts.monthly),
    },
    now,
    timeZone: TZ,
  });
  const budget = await withinWorkspaceBudget(b.client, "ws-1", now);
  return {
    agent,
    budget,
    agentSinces: [...a.sinces].sort(),
    budgetSinces: [...b.sinces].sort(),
  };
}

describe("los dos topes del workspace responden lo mismo", () => {
  const cases: Array<[string, Parameters<typeof fakeDb>[0], boolean, string | null]> = [
    ["por debajo de los dos topes", { daily: 5, monthly: 100, spentToday: 1, spentMonth: 40 }, true, null],
    ["tope diario alcanzado", { daily: 5, monthly: 100, spentToday: 5, spentMonth: 40 }, false, "workspace_daily"],
    ["tope mensual alcanzado", { daily: 5, monthly: 100, spentToday: 1, spentMonth: 100.5 }, false, "workspace_monthly"],
    ["solo tope diario, alcanzado", { daily: 5, monthly: null, spentToday: 7, spentMonth: 7 }, false, "workspace_daily"],
    ["sin topes", { daily: null, monthly: null, spentToday: 999, spentMonth: 999 }, true, null],
    ["montos de la base como string (numeric)", { daily: "5", monthly: "100", spentToday: 6, spentMonth: 40 }, false, "workspace_daily"],
  ];

  for (const [name, opts, allowed, scope] of cases) {
    it(name, async () => {
      const r = await both(opts);
      expect(r.agent.allowed).toBe(allowed);
      expect(r.budget.allowed).toBe(allowed);
      const blocking = "blocking" in r.agent ? r.agent.blocking?.scope ?? null : null;
      expect(blocking).toBe(scope);
      // Y miran la misma ventana: piden la suma desde los mismos instantes.
      expect(r.budgetSinces).toEqual(r.agentSinces);
    });
  }

  it("si no se puede leer el gasto, ninguno de los dos llama al modelo", async () => {
    const r = await both({ daily: 5, monthly: 100, spentToday: 0, spentMonth: 0, failRpc: true });
    expect(r.agent.allowed).toBe(false);
    expect(r.budget).toMatchObject({ allowed: false, message: "No pude verificar el gasto de IA del workspace." });
  });
});

describe("withinWorkspaceBudget", () => {
  it("si no puede leer los topes del workspace, corta (antes dejaba pasar todo)", async () => {
    const { client } = fakeDb({ daily: 5, monthly: 100, spentToday: 0, spentMonth: 0, failWorkspace: true });
    expect(await withinWorkspaceBudget(client, "ws-1", MID)).toMatchObject({ allowed: false });
  });

  it("el dia arranca a la medianoche local del workspace, no a la de UTC", async () => {
    const { client, sinces } = fakeDb({ daily: 5, monthly: 100, spentToday: 0, spentMonth: 0 });
    await withinWorkspaceBudget(client, "ws-1", NOW);
    expect(sinces).toContain(DAY_START);
    expect(sinces).not.toContain("2026-10-01T00:00:00.000Z");
  });

  it("el mensaje dice cuando se reanuda segun el tope", async () => {
    const diario = await withinWorkspaceBudget(fakeDb({ daily: 5, monthly: 100, spentToday: 5, spentMonth: 5 }).client, "ws-1", MID);
    expect(diario.message).toContain("tope diario");
    expect(diario.message).toContain("manana");
    const mensual = await withinWorkspaceBudget(fakeDb({ daily: 50, monthly: 100, spentToday: 1, spentMonth: 120 }).client, "ws-1", MID);
    expect(mensual.message).toContain("tope mensual");
  });
});

describe("workspaceSpendCandidates", () => {
  it("los dos topes del workspace cortan, y solo aparecen los cargados", () => {
    const c = workspaceSpendCandidates({ dailyUsd: 5, monthlyUsd: null, now: NOW, timeZone: TZ });
    expect(c).toEqual([{ scope: "workspace_daily", limitUsd: 5, action: "disable", since: new Date(DAY_START) }]);
    const m = workspaceSpendCandidates({ dailyUsd: null, monthlyUsd: "100", now: NOW, timeZone: TZ });
    expect(m).toEqual([{ scope: "workspace_monthly", limitUsd: 100, action: "disable", since: new Date(MONTH_START) }]);
  });

  it("un tope diario es temporal; uno mensual no", () => {
    expect(isTemporaryBlock("workspace_daily")).toBe(true);
    expect(isTemporaryBlock("agent_daily")).toBe(true);
    expect(isTemporaryBlock("workspace_monthly")).toBe(false);
    expect(isTemporaryBlock("agent_monthly")).toBe(false);
  });
});

describe("withinWorkspaceBudget: un modelo sin precio no deja pasar gasto invisible (lote 3)", () => {
  /** Topes del negocio y la tabla de precios; `price` null = el modelo no tiene fila. */
  function pricedDb(opts: { daily: number | null; dailyAction?: "notify" | "disable"; price: { audio_per_hour: number | null } | null }) {
    const chain = (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "lte", "order", "limit"]) q[m] = () => q;
      q.maybeSingle = async () =>
        table === "workspaces"
          ? { data: { ai_daily_cost_limit_usd: opts.daily, ai_monthly_cost_limit_usd: null, ai_daily_limit_action: opts.dailyAction ?? null, timezone: TZ }, error: null }
          : { data: opts.price ? { id: "p1", input_per_mtok: 1, output_per_mtok: 1, cached_input_per_mtok: 0, ...opts.price } : null, error: null };
      return q;
    };
    return { rpc: async () => ({ data: 0, error: null }), from: chain } as never;
  }
  const chat = { provider: "anthropic", model: "modelo-x" };

  it("con un tope que corta y sin precio: no se llama", async () => {
    const res = await withinWorkspaceBudget(pricedDb({ daily: 10, price: null }), "ws-1", MID, { model: chat });
    expect(res.allowed).toBe(false);
    expect(res.message).toContain("no tiene precio");
  });

  it("con precio, o sin topes, o con un tope que solo avisa: pasa", async () => {
    expect((await withinWorkspaceBudget(pricedDb({ daily: 10, price: { audio_per_hour: null } }), "ws-1", MID, { model: chat })).allowed).toBe(true);
    expect((await withinWorkspaceBudget(pricedDb({ daily: null, price: null }), "ws-1", MID, { model: chat })).allowed).toBe(true);
    expect((await withinWorkspaceBudget(pricedDb({ daily: 10, dailyAction: "notify", price: null }), "ws-1", MID, { model: chat })).allowed).toBe(true);
  });

  it("un modelo de audio necesita precio por hora", async () => {
    const audio = { provider: "groq", model: "whisper", kind: "audio" as const };
    expect((await withinWorkspaceBudget(pricedDb({ daily: 10, price: { audio_per_hour: null } }), "ws-1", MID, { model: audio })).allowed).toBe(false);
    expect((await withinWorkspaceBudget(pricedDb({ daily: 10, price: { audio_per_hour: 0.04 } }), "ws-1", MID, { model: audio })).allowed).toBe(true);
  });
});
