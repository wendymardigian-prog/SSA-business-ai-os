import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { defaultFinanceSettings } from "@/lib/finance/settings";

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const T1 = "33333333-3333-4333-8333-333333333333";
let db: MemoryDb;
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return "a"; }) }));
vi.mock("@/lib/workspace-members", () => ({ getWorkspaceMembers: async () => [{ userId: USER }] }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async () => ({
    supabase: db.client,
    user: { id: USER },
    workspace: { id: WS, timezone: "America/Costa_Rica", finance_settings: defaultFinanceSettings() },
  }),
}));

const { createRecurringTemplate, updateRecurringTemplate, setRecurringActive } = await import("./finance-recurring");

const form = (over: Record<string, unknown> = {}) => ({
  concept: "Google Workspace", categoryKey: "software", amountType: "fixed", amount: "36", chargeMode: "automatic", frequency: "monthly", monthlyDay: 5, startDate: "2026-09-01", ...over,
});

beforeEach(() => {
  audits.length = 0;
  db = memoryDb({ recurring_expenses: [], vendors: [] });
});

describe("plantillas recurrentes", () => {
  it("crea con el anclaje en hoy y deja el historial", async () => {
    const r = await createRecurringTemplate(form());
    expect(r.ok).toBe(true);
    const row = db.rows("recurring_expenses")[0];
    expect(row).toMatchObject({ workspace_id: WS, concept: "Google Workspace", is_active: true, amount: 36, created_by: USER });
    expect(typeof row.generation_anchor).toBe("string");
    expect(audits[0]).toMatchObject({ entityType: "recurring_expense", action: "recurring.created" });
  });

  it("rechaza una categoría que no existe y un monto fijo en cero", async () => {
    expect((await createRecurringTemplate(form({ categoryKey: "inventada" }))).ok).toBe(false);
    expect((await createRecurringTemplate(form({ amount: "0" }))).ok).toBe(false);
    expect(db.rows("recurring_expenses")).toHaveLength(0);
  });

  it("editar solo el monto NO reinicia el anclaje; cambiar el día SÍ", async () => {
    db = memoryDb({ recurring_expenses: [{
      id: T1, workspace_id: WS, concept: "Google Workspace", vendor_id: null, category_key: "software", amount_type: "fixed", amount: 36, charge_mode: "automatic", frequency: "monthly",
      weekly_day: null, weekly_interval: null, monthly_day: 5, yearly_month: null, yearly_day: null, start_date: "2026-09-01", end_date: null, lead_days: 0, is_active: true, paused_at: null,
      generation_anchor: "2026-09-01", responsible_id: null, notes: null, updated_at: "2026-10-01T00:00:00Z",
    }] });
    const a = await updateRecurringTemplate(T1, form({ amount: "40" }));
    expect(a).toMatchObject({ ok: true, anchorReset: false });
    expect(db.rows("recurring_expenses")[0]).toMatchObject({ amount: 40, generation_anchor: "2026-09-01" });
    const b = await updateRecurringTemplate(T1, form({ monthlyDay: 10 }));
    expect(b).toMatchObject({ ok: true, anchorReset: true });
    expect(db.rows("recurring_expenses")[0].generation_anchor).not.toBe("2026-09-01");
    expect(audits.filter((x) => x.action === "recurring.updated")).toHaveLength(2);
  });

  it("pausar guarda la fecha; reactivar reinicia el anclaje y lista las fechas salteadas", async () => {
    db = memoryDb({ recurring_expenses: [{
      id: T1, workspace_id: WS, concept: "x", vendor_id: null, category_key: "software", amount_type: "fixed", amount: 36, charge_mode: "manual", frequency: "monthly",
      weekly_day: null, weekly_interval: null, monthly_day: 5, yearly_month: null, yearly_day: null, start_date: "2026-01-01", end_date: null, lead_days: 0, is_active: false,
      paused_at: new Date(Date.now() - 40 * 86_400_000).toISOString(), generation_anchor: "2026-01-01", responsible_id: null, notes: null, updated_at: "2026-10-01T00:00:00Z",
    }] });
    const r = await setRecurringActive(T1, true);
    expect(r.ok).toBe(true);
    expect(r.ok && r.missedDates.length).toBeGreaterThanOrEqual(1);
    expect(db.rows("recurring_expenses")[0]).toMatchObject({ is_active: true, paused_at: null });
    expect(audits[0]).toMatchObject({ action: "recurring.reactivated" });
    const again = await setRecurringActive(T1, true);
    expect(again).toMatchObject({ ok: true, missedDates: [] });
    const paused = await setRecurringActive(T1, false);
    expect(paused.ok).toBe(true);
    expect(db.rows("recurring_expenses")[0]).toMatchObject({ is_active: false });
    expect(audits.at(-1)).toMatchObject({ action: "recurring.paused" });
  });

  it("una plantilla de otro workspace o un id inválido no existen", async () => {
    expect(await updateRecurringTemplate("no-es-uuid", form())).toMatchObject({ ok: false });
    expect(await setRecurringActive(T1, false)).toMatchObject({ ok: false, error: "Esta plantilla no existe" });
  });
});
