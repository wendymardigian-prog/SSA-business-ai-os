/**
 * Ventas F37: las tres acciones de cobranza de un flujo. Pasan por el MISMO núcleo que las Server
 * Actions; lo que cambia es el actor: el sistema, con el nombre del flujo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const audits: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit", async (orig) => {
  const real = await orig<typeof import("@/lib/audit")>();
  return {
    ...real,
    logAudit: vi.fn(async (a: Record<string, unknown>) => { audits.push({ ...a, actorType: "user" }); return null; }),
    auditAsSystem: vi.fn(async (a: Record<string, unknown>) => { audits.push({ ...a, actorType: "system", actorLabel: a.label }); return null; }),
  };
});
vi.mock("@/lib/sales/payment-health-run", () => ({ refreshContactPaymentHealth: vi.fn(async () => {}) }));
vi.mock("@/lib/sales/automation/relative", () => ({ syncPaymentRelativeJobs: vi.fn(async () => 0) }));

const { markPaymentPaidNode, reschedulePaymentNode, setSaleStatusNode } = await import("./sales-actions");

const WS = "ws-1";
let db: MemoryDb;
const seed = () =>
  memoryDb({
    workspaces: [{ id: WS, timezone: "America/Costa_Rica", enabled_payment_methods: ["wise", "binance"], overdue_grace_days: 0 }],
    flows: [{ id: "flow-1", name: "Cobranza automática" }],
    sales: [{ id: "s1", workspace_id: WS, contact_id: "c1", sale_date: "2026-10-01", status: "reserved", financing_type: "installments" }],
    payments: [{ id: "p1", workspace_id: WS, sale_id: "s1", type: "installment", status: "scheduled", amount: 500, due_date: "2099-12-01", original_due_date: "2099-12-01", reschedule_count: 0, paid_on: null, payment_method: null }],
  });
const args = (data: Record<string, unknown>, variables: Record<string, unknown> = { event_payment_id: "p1", event_sale_id: "s1" }) =>
  ({ supabase: db.client, data, node: { id: "n1" }, context: { workspaceId: WS, flowId: "flow-1", contactId: "c1", variables } }) as never;
beforeEach(() => { db = seed(); audits.length = 0; });

describe("mark_payment_paid", () => {
  it("sin la confirmación del editor no cobra nada", async () => {
    await markPaymentPaidNode.execute(args({ method: "wise" }));
    expect(db.rows("payments")[0].status).toBe("scheduled");
  });

  it("confirmado: cobra por el monto programado con el método elegido y audita como el flujo (actor sistema)", async () => {
    await markPaymentPaidNode.execute(args({ method: "binance", confirmed: true }));
    expect(db.rows("payments")[0]).toMatchObject({ status: "paid", amount: 500, payment_method: "binance" });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityType: "payment", entityId: "p1", action: "payment.paid", actorType: "system", actorLabel: "Cobranza automática" });
  });

  it("un método que no está habilitado cae en el primero habilitado; un pago ya cobrado no se cobra otra vez", async () => {
    await markPaymentPaidNode.execute(args({ method: "paypal", confirmed: true }));
    expect(db.rows("payments")[0].payment_method).toBe("wise");
    const before = audits.length;
    await markPaymentPaidNode.execute(args({ confirmed: true }));
    expect(audits).toHaveLength(before);
  });

  it("sin pago en el contexto no hace nada (y no lanza)", async () => {
    await expect(markPaymentPaidNode.execute(args({ confirmed: true }, {}))).resolves.toBeUndefined();
  });
});

describe("reschedule_payment", () => {
  it("suma los días al vencimiento, conserva el original y deja el motivo fijo", async () => {
    await reschedulePaymentNode.execute(args({ days: 7 }));
    expect(db.rows("payments")[0]).toMatchObject({ due_date: "2099-12-08", original_due_date: "2099-12-01", reschedule_count: 1, reschedule_reason: "Reprogramado por una automatización" });
    expect(audits[0]).toMatchObject({ action: "payment.rescheduled", actorType: "system", actorLabel: "Cobranza automática" });
  });
  it("días fuera de 1 a 90 no hacen nada", async () => {
    await reschedulePaymentNode.execute(args({ days: 0 }));
    await reschedulePaymentNode.execute(args({ days: 91 }));
    expect(db.rows("payments")[0].reschedule_count).toBe(0);
  });
});

describe("set_sale_status", () => {
  it("cancelar anula los pagos programados y audita como el flujo", async () => {
    await setSaleStatusNode.execute(args({ status: "cancelled", reason: "Sin respuesta tras 30 días" }));
    expect(db.rows("sales")[0]).toMatchObject({ status: "cancelled", cancellation_reason: "Sin respuesta tras 30 días" });
    expect(db.rows("payments")[0].status).toBe("cancelled");
    expect(audits[0]).toMatchObject({ entityType: "sale", action: "sale.cancelled", actorType: "system", actorLabel: "Cobranza automática" });
  });
  it("solo a cancelada o suscripción dada de baja: cualquier otro estado se ignora", async () => {
    await setSaleStatusNode.execute(args({ status: "paid" }));
    await setSaleStatusNode.execute(args({}));
    expect(db.rows("sales")[0].status).toBe("reserved");
  });
  it("dar de baja solo una suscripción", async () => {
    await setSaleStatusNode.execute(args({ status: "subscription_cancelled" }));
    expect(db.rows("sales")[0].status).toBe("reserved");
    Object.assign(db.rows("sales")[0], { financing_type: "subscription", status: "subscription_active" });
    await setSaleStatusNode.execute(args({ status: "subscription_cancelled", reason: "Pidió la baja" }));
    expect(db.rows("sales")[0]).toMatchObject({ status: "subscription_cancelled", subscription_cancel_reason: "Pidió la baja" });
  });
  it("una venta ya cancelada no se vuelve a cancelar", async () => {
    db.rows("sales")[0].status = "cancelled";
    await setSaleStatusNode.execute(args({ status: "cancelled", reason: "x" }));
    expect(audits).toHaveLength(0);
  });
});
