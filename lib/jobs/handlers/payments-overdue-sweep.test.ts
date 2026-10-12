/**
 * Ventas F30: el barrido de mora. Con la base en memoria: lo que importa es QUÉ pasa a moroso y
 * QUÉ no, y que dos corridas no marquen dos veces.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const audits: Array<Record<string, unknown>> = [];
const health: string[] = [];

vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), auditAsSystem: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return null; }) }));
vi.mock("@/lib/sales/payment-health-run", () => ({ refreshContactPaymentHealth: vi.fn(async (_d: unknown, _w: string, c: string) => { health.push(c); }) }));

const { runOverdueSweep, handlePaymentsOverdueSweep } = await import("./payments-overdue-sweep");

let db: MemoryDb;
const pay = (id: string, sale: string, status: string, due: string | null) => ({ id, workspace_id: WS, sale_id: sale, status, due_date: due });
const seed = (grace = 0) =>
  memoryDb({
    workspaces: [{ id: WS, overdue_grace_days: grace }],
    sales: [
      { id: "s-live", workspace_id: WS, contact_id: "c1", status: "reserved" },
      { id: "s-cancelled", workspace_id: WS, contact_id: "c2", status: "cancelled" },
      { id: "s-refunded", workspace_id: WS, contact_id: "c3", status: "refunded" },
      { id: "s-sub", workspace_id: WS, contact_id: "c4", status: "subscription_cancelled" },
    ],
    payments: [
      pay("p-late", "s-live", "scheduled", "2026-10-25"),
      pay("p-today", "s-live", "scheduled", "2026-10-26"),
      pay("p-future", "s-live", "scheduled", "2026-11-30"),
      pay("p-paid", "s-live", "paid", "2026-10-01"),
      pay("p-unc", "s-live", "uncollectible", "2026-10-01"),
      pay("p-cancelled-sale", "s-cancelled", "scheduled", "2026-10-01"),
      pay("p-refunded-sale", "s-refunded", "scheduled", "2026-10-01"),
      pay("p-sub-sale", "s-sub", "scheduled", "2026-10-01"),
    ],
  });
const status = (id: string) => db.rows("payments").find((p) => p.id === id)!.status;

beforeEach(() => { db = seed(); audits.length = 0; health.length = 0; });

describe("runOverdueSweep", () => {
  it("con gracia 0, vence hoy no pasa y vencido ayer sí; futuro, no", async () => {
    const r = await runOverdueSweep(db.client, WS, "2026-10-26");
    expect(r.paymentIds).toEqual(["p-late"]);
    expect(status("p-late")).toBe("overdue");
    expect(status("p-today")).toBe("scheduled");
    expect(status("p-future")).toBe("scheduled");
  });

  it("no toca lo cobrado ni lo incobrable, ni los pagos de una venta cancelada, reembolsada o con la suscripción dada de baja", async () => {
    await runOverdueSweep(db.client, WS, "2026-10-26");
    for (const id of ["p-paid", "p-unc", "p-cancelled-sale", "p-refunded-sale", "p-sub-sale"]) expect(["paid", "uncollectible", "scheduled"]).toContain(status(id));
    expect(status("p-paid")).toBe("paid");
    expect(status("p-unc")).toBe("uncollectible");
    for (const id of ["p-cancelled-sale", "p-refunded-sale", "p-sub-sale"]) expect(status(id)).toBe("scheduled");
  });

  it("un job del día anterior NO marca lo que vence ese día", async () => {
    // El job del 25/10: el pago que vence el 25/10 todavía no está moroso.
    const r = await runOverdueSweep(db.client, WS, "2026-10-25");
    expect(r.marked).toBe(0);
    expect(status("p-late")).toBe("scheduled");
  });

  it("con gracia 3, el de hace 3 días no pasa y el de hace 4 sí", async () => {
    db = seed(3);
    expect((await runOverdueSweep(db.client, WS, "2026-10-28")).paymentIds).toEqual([]); // vence 25/10, hoy 28: hace 3 días
    expect((await runOverdueSweep(db.client, WS, "2026-10-29")).paymentIds).toEqual(["p-late"]); // hace 4 días
  });

  it("dos corridas el mismo día: UN solo pasaje a moroso por pago y UNA auditoría", async () => {
    await runOverdueSweep(db.client, WS, "2026-10-26");
    const second = await runOverdueSweep(db.client, WS, "2026-10-26");
    expect(second.marked).toBe(0);
    expect(audits).toHaveLength(1);
  });

  it("audita como el sistema «Job de mora» y recalcula la salud del contacto", async () => {
    await runOverdueSweep(db.client, WS, "2026-10-26");
    expect(audits[0]).toMatchObject({ entityType: "payment", entityId: "p-late", action: "payment.overdue", label: "Job de mora" });
    expect(health).toEqual(["c1"]);
  });

  it("30 pagos vencidos pasan los 30, uno por uno", async () => {
    for (let i = 0; i < 30; i++) db.rows("payments").push(pay(`bulk-${i}`, "s-live", "scheduled", "2026-09-01"));
    const r = await runOverdueSweep(db.client, WS, "2026-10-26");
    expect(r.marked).toBe(31);
    expect(audits).toHaveLength(31);
  });
});

describe("handlePaymentsOverdueSweep", () => {
  it("lee workspace y fecha local del payload; un payload roto no hace nada", async () => {
    await handlePaymentsOverdueSweep({ supabase: db.client, job: { payload: { workspace_id: WS, local_date: "2026-10-26" } } } as never);
    expect(status("p-late")).toBe("overdue");
    await handlePaymentsOverdueSweep({ supabase: db.client, job: { payload: { workspace_id: WS, local_date: "mañana" } } } as never);
    await handlePaymentsOverdueSweep({ supabase: db.client, job: { payload: {} } } as never);
  });
});
