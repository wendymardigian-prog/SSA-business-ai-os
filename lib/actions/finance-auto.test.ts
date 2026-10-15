import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { defaultFinanceSettings } from "@/lib/finance/settings";

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const E1 = "44444444-4444-4444-8444-444444444444";
let db: MemoryDb;
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return "a"; }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async () => ({
    supabase: db.client,
    user: { id: USER },
    workspace: { id: WS, timezone: "America/Costa_Rica", finance_settings: defaultFinanceSettings() },
  }),
}));

const { createDriftAdjustment, ignoreDrift, runFinanceDailyNow } = await import("./finance-auto");

const paidWithDrift = (over: Record<string, unknown> = {}) => ({
  id: E1, workspace_id: WS, concept: "Comisión Whop · octubre 2026", vendor_id: null, category_key: "processor_fees", status: "pagado", origin: "processor_fee",
  amount: 50, auto_drift_amount: -4.2, auto_drift_resolved_at: null, ...over,
});

beforeEach(() => {
  audits.length = 0;
  db = memoryDb({ expenses: [paidWithDrift()], scheduled_jobs: [] });
});

describe("diferencia de un automático pagado", () => {
  it("crear ajuste: gasto con el signo de la diferencia, apuntando al original, y la diferencia queda resuelta", async () => {
    const r = await createDriftAdjustment(E1);
    expect(r.ok).toBe(true);
    const adjustment = db.rows("expenses").find((e) => e.origin === "adjustment");
    expect(adjustment).toMatchObject({ amount: -4.2, adjusts_expense_id: E1, status: "programado", concept: "Ajuste: Comisión Whop · octubre 2026", category_key: "processor_fees", created_by: USER });
    expect(db.rows("expenses").find((e) => e.id === E1)?.auto_drift_resolved_at).toBeTruthy();
    expect(audits[0]).toMatchObject({ action: "expense.adjustment_created" });
  });

  it("«ya se aplicó» lo crea pagado con la fecha de hoy", async () => {
    await createDriftAdjustment(E1, true);
    expect(db.rows("expenses").find((e) => e.origin === "adjustment")).toMatchObject({ status: "pagado", paid_by: USER });
  });

  it("no se puede crear dos veces ni sobre un gasto sin diferencia", async () => {
    await createDriftAdjustment(E1);
    expect(await createDriftAdjustment(E1)).toMatchObject({ ok: false, error: "Este gasto no tiene una diferencia pendiente" });
    db = memoryDb({ expenses: [paidWithDrift({ auto_drift_amount: null })] });
    expect(await createDriftAdjustment(E1)).toMatchObject({ ok: false });
    expect(db.rows("expenses")).toHaveLength(1);
  });

  it("ignorar pide motivo, no crea nada y deja el historial", async () => {
    expect(await ignoreDrift(E1, "   ")).toMatchObject({ ok: false });
    expect(await ignoreDrift(E1, "x".repeat(501))).toMatchObject({ ok: false });
    const r = await ignoreDrift(E1, "Meta ya lo corrigió");
    expect(r.ok).toBe(true);
    expect(db.rows("expenses")).toHaveLength(1);
    expect(db.rows("expenses")[0].auto_drift_resolved_at).toBeTruthy();
    expect(audits[0]).toMatchObject({ action: "expense.drift_ignored", metadata: { reason: "Meta ya lo corrigió", drift_cents: -420 } });
    expect(await ignoreDrift(E1, "otra vez")).toMatchObject({ ok: false });
  });
});

describe("Calcular ahora", () => {
  it("encola un finance_daily con clave manual y numerada", async () => {
    const first = await runFinanceDailyNow();
    expect(first).toMatchObject({ ok: true, queued: true });
    const job = db.rows("scheduled_jobs")[0];
    expect(job).toMatchObject({ type: "finance_daily" });
    expect(String(job.dedupe_key)).toMatch(new RegExp(`^finance_daily:${WS}:\\d{4}-\\d{2}-\\d{2}:manual:1$`));
    expect((job.payload as Record<string, unknown>).workspace_id).toBe(WS);
  });
});
