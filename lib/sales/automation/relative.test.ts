/**
 * Ventas F37: los recordatorios relativos al vencimiento. La cola y la base están en memoria.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { backfillPaymentRelativeJobs, PAYMENT_RELATIVE_JOB_TYPE, syncPaymentRelativeJobs } from "./relative";
import { handlePaymentRelativeTrigger } from "@/lib/jobs/handlers/payment-relative";

const WS = "ws-1";
let db: MemoryDb;
const NOW = new Date("2026-10-11T12:00:00Z");

const seed = () =>
  memoryDb(
    {
      workspaces: [{ id: WS, timezone: "America/Costa_Rica" }],
      sales: [{ id: "s1", workspace_id: WS, contact_id: "c1", status: "reserved", product_snapshot: { product_id: "A" } }],
      payments: [{ id: "p1", workspace_id: WS, sale_id: "s1", type: "installment", status: "scheduled", due_date: "2026-10-26", reschedule_count: 0 }],
      triggers: [{ id: "t1", workspace_id: WS, type: "payment_before_due", is_active: true, config: { offset_days: 3, at_time: "09:00" } }],
      scheduled_jobs: [],
      automation_events: [],
    },
    // Solo un job PENDIENTE por clave: igual que el índice único de la cola.
    { unique: { scheduled_jobs: (a, b) => !!a.dedupe_key && a.dedupe_key === b.dedupe_key && a.status === "pending" && b.status === "pending" } },
  );

const jobs = () => db.rows("scheduled_jobs");
beforeEach(() => { db = seed(); });

describe("syncPaymentRelativeJobs", () => {
  it("agenda el recordatorio de 3 días antes a las 09:00 de la zona del workspace", async () => {
    expect(await syncPaymentRelativeJobs(db.client, { paymentId: "p1" }, NOW)).toBe(1);
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({ type: PAYMENT_RELATIVE_JOB_TYPE, status: "pending", dedupe_key: "rel:t1:p1:0", run_at: "2026-10-23T15:00:00.000Z" });
    expect(jobs()[0].payload).toMatchObject({ payment_id: "p1", trigger_id: "t1", trigger_type: "payment_before_due", reschedule_count: 0 });
  });

  it("planificar dos veces no duplica (el duplicado se tolera)", async () => {
    await syncPaymentRelativeJobs(db.client, { paymentId: "p1" }, NOW);
    await syncPaymentRelativeJobs(db.client, { paymentId: "p1" }, NOW);
    expect(jobs().filter((j) => j.status === "pending")).toHaveLength(1);
  });

  it("reprogramar: el anterior queda cancelled y existe uno nuevo con el reschedule_count nuevo", async () => {
    await syncPaymentRelativeJobs(db.client, { paymentId: "p1" }, NOW);
    Object.assign(db.rows("payments")[0], { due_date: "2026-11-10", reschedule_count: 1 });
    await syncPaymentRelativeJobs(db.client, { paymentId: "p1" }, NOW);
    expect(jobs().map((j) => [j.dedupe_key, j.status])).toEqual([["rel:t1:p1:0", "cancelled"], ["rel:t1:p1:1", "pending"]]);
    expect(jobs()[1].run_at).toBe("2026-11-07T15:00:00.000Z");
  });

  it("cobrar, anular o marcar incobrable deja sus recordatorios pendientes en cancelled y no agenda otros", async () => {
    await syncPaymentRelativeJobs(db.client, { paymentId: "p1" }, NOW);
    db.rows("payments")[0].status = "paid";
    expect(await syncPaymentRelativeJobs(db.client, { paymentId: "p1" }, NOW)).toBe(0);
    expect(jobs().map((j) => j.status)).toEqual(["cancelled"]);
  });

  it("un pago creado hoy que vence mañana no genera el de 3 días antes", async () => {
    db.rows("payments")[0].due_date = "2026-10-12";
    expect(await syncPaymentRelativeJobs(db.client, { paymentId: "p1" }, NOW)).toBe(0);
    expect(jobs()).toHaveLength(0);
  });

  it("por venta: planifica todos sus pagos abiertos; una venta cancelada no agenda nada", async () => {
    db.rows("payments").push({ id: "p2", workspace_id: WS, sale_id: "s1", type: "installment", status: "scheduled", due_date: "2026-11-26", reschedule_count: 0 });
    expect(await syncPaymentRelativeJobs(db.client, { saleId: "s1" }, NOW)).toBe(2);
    db.rows("sales")[0].status = "cancelled";
    expect(await syncPaymentRelativeJobs(db.client, { saleId: "s1" }, NOW)).toBe(0);
    expect(jobs().every((j) => j.status === "cancelled")).toBe(true);
  });

  it("sin triggers relativos activos no agenda nada; sin pago, tampoco", async () => {
    db.rows("triggers")[0].is_active = false;
    expect(await syncPaymentRelativeJobs(db.client, { paymentId: "p1" }, NOW)).toBe(0);
    expect(await syncPaymentRelativeJobs(db.client, { paymentId: "no-existe" }, NOW)).toBe(0);
    expect(await syncPaymentRelativeJobs(db.client, {}, NOW)).toBe(0);
  });

  it("el backfill planifica los pagos abiertos al prender el flujo", async () => {
    expect(await backfillPaymentRelativeJobs(db.client, WS, NOW)).toBe(1);
  });
});

describe("handlePaymentRelativeTrigger", () => {
  const job = (over: Record<string, unknown> = {}) => ({ supabase: db.client, job: { payload: { payment_id: "p1", trigger_id: "t1", trigger_type: "payment_before_due", reschedule_count: 0, ...over } } }) as never;

  it("emite el evento con el nombre del trigger, solo escalares y sin booking_id", async () => {
    await handlePaymentRelativeTrigger(job());
    const events = db.rows("automation_events");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ workspace_id: WS, event_type: "payment_before_due", contact_id: "c1" });
    expect(events[0].payload).toEqual({ payment_id: "p1", sale_id: "s1", contact_id: "c1", product_id: "A", trigger_id: "t1", reschedule_count: 0 });
    expect(events[0].payload).not.toHaveProperty("booking_id");
  });

  it("si el pago ya está cobrado, NO emite", async () => {
    db.rows("payments")[0].status = "paid";
    await handlePaymentRelativeTrigger(job());
    expect(db.rows("automation_events")).toHaveLength(0);
  });

  it("si se reprogramó después de agendar el recordatorio, NO emite (el nuevo ya tiene el suyo)", async () => {
    db.rows("payments")[0].reschedule_count = 1;
    await handlePaymentRelativeTrigger(job({ reschedule_count: 0 }));
    expect(db.rows("automation_events")).toHaveLength(0);
  });

  it("una venta cancelada o un trigger apagado, NO emiten", async () => {
    db.rows("sales")[0].status = "cancelled";
    await handlePaymentRelativeTrigger(job());
    db.rows("sales")[0].status = "reserved";
    db.rows("triggers")[0].is_active = false;
    await handlePaymentRelativeTrigger(job());
    expect(db.rows("automation_events")).toHaveLength(0);
  });

  it("un payload roto o de otro tipo no hace nada", async () => {
    await handlePaymentRelativeTrigger(job({ trigger_type: "sale_created" }));
    await handlePaymentRelativeTrigger(job({ payment_id: undefined }));
    expect(db.rows("automation_events")).toHaveLength(0);
  });
});
