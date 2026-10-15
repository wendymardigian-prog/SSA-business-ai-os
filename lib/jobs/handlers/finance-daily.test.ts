import { beforeEach, describe, expect, it, vi } from "vitest";

const audits: Array<Record<string, unknown>> = [];
const notices: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), auditAsSystem: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return null; }) }));
// Los pasos que escriben (recurrentes y automáticos) tienen su propio test: acá se prueba la orquestación.
const stepCalls: string[] = [];
vi.mock("@/lib/finance/daily-steps", () => ({
  generateRecurringStep: vi.fn(async () => { stepCalls.push("recurring"); return { created: 0 }; }),
  autoExpensesStep: vi.fn(async () => { stepCalls.push("auto_expenses"); return { actions: 0 }; }),
}));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async (a: Record<string, unknown>) => { notices.push(a); return true; }) }));

const { runFinanceDaily, handleFinanceDaily, registerFinanceDailyStep, FINANCE_DAILY_JOB } = await import("./finance-daily");

const WS = "11111111-1111-4111-8111-111111111111";

function fakeDb(opts: { overdueIds?: string[]; rpcError?: string; amounts?: Record<string, number> } = {}) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const db = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      if (opts.rpcError) return { data: null, error: { message: opts.rpcError } };
      return { data: opts.overdueIds ?? [], error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { timezone: "UTC" }, error: null }),
          in: async (_c: string, ids: string[]) => ({ data: ids.map((id) => ({ id, amount: opts.amounts?.[id] ?? 0 })), error: null }),
        }),
      }),
    }),
  };
  return { db: db as never, calls };
}

beforeEach(() => {
  audits.length = 0;
  notices.length = 0;
  stepCalls.length = 0;
});

describe("finance_daily: vencer", () => {
  it("vence con la fecha local del trabajo (no la de hoy del servidor) y NO toca otros estados (lo garantiza la función SQL)", async () => {
    const { db, calls } = fakeDb({ overdueIds: [] });
    const { results, failed } = await runFinanceDaily(db, WS, "2026-10-11", "America/Costa_Rica");
    expect(failed).toEqual([]);
    expect(stepCalls).toEqual(["recurring", "auto_expenses"]); // antes de vencer, en este orden
    expect(calls).toEqual([{ fn: "mark_expenses_overdue", args: { p_workspace_id: WS, p_today: "2026-10-11" } }]);
    expect(results.find((r) => r.step === "overdue")?.detail).toEqual({ overdue: 0 });
    expect(notices).toHaveLength(0);
  });

  it("avisa UNA vez con la cantidad y el total, y deja una entrada de historial por gasto con la etiqueta del sistema", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const { db } = fakeDb({ overdueIds: [a, b], amounts: { [a]: 800, [b]: 440.1 } });
    await runFinanceDaily(db, WS, "2026-10-11", "UTC");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ type: "expense_overdue", title: "2 gastos vencieron hoy por USD 1.240,10", entityType: "expense", metadata: { pill: "vencidos", count: 2 } });
    expect(notices[0]).not.toHaveProperty("recipientId");
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ entityType: "expense", action: "expense.overdue", label: "Finanzas: trabajo diario" });
  });

  it("si el paso de vencer falla, los demás corren igual y el trabajo lanza al final con el motivo", async () => {
    const ran: string[] = [];
    registerFinanceDailyStep({ name: "paso_previo", run: async () => { ran.push("previo"); return { ok: 1 }; } });
    const { db } = fakeDb({ rpcError: "boom" });
    const out = await runFinanceDaily(db, WS, "2026-10-11", "UTC");
    expect(out.failed).toEqual(["overdue"]);
    expect(ran).toEqual(["previo"]);
    expect(out.results.find((r) => r.step === "review_notice")?.ok).toBe(true);

    await expect(handleFinanceDaily({ supabase: db, job: { id: "j", type: FINANCE_DAILY_JOB, payload: { workspace_id: WS, local_date: "2026-10-11" }, attempts: 0 } } as never)).rejects.toThrow(/overdue/);
  });

  it("un payload sin workspace o con fecha rota no hace nada", async () => {
    const { db, calls } = fakeDb();
    await handleFinanceDaily({ supabase: db, job: { id: "j", type: FINANCE_DAILY_JOB, payload: { workspace_id: WS, local_date: "ayer" }, attempts: 0 } } as never);
    await handleFinanceDaily({ supabase: db, job: { id: "j", type: FINANCE_DAILY_JOB, payload: {}, attempts: 0 } } as never);
    expect(calls).toHaveLength(0);
  });
});
