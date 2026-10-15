/**
 * Ventas F29 y F32: cobrar, cobro parcial, revertir, reprogramar, incobrable, reembolso, agregar
 * un pago y comprobantes. Sin servicios externos: la base y el Storage están en memoria.
 */
import { paymentMethodsFixture } from "@/lib/sales/test-support/payment-methods";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1);
const SALE = U(30);
const CONTACT = U(10);
const PAY = U(40);

let db: MemoryDb;
let role = "admin";
let roleId: string | null = null;
const audits: Array<Record<string, unknown>> = [];
const healthCalls: string[] = [];
const syncCalls: Array<Record<string, unknown>> = [];
const uploaded: Array<{ path: string; contentType: string }> = [];
const removed: string[][] = [];
const signed: Array<{ path: string; seconds: number }> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return null; }) }));
vi.mock("@/lib/sales/payment-health-run", () => ({ refreshContactPaymentHealth: vi.fn(async (_s: unknown, _w: string, contactId: string) => { healthCalls.push(contactId); }) }));
vi.mock("@/lib/sales/automation/relative", () => ({ syncPaymentRelativeJobs: vi.fn(async (_s: unknown, target: Record<string, unknown>) => { syncCalls.push(target); }) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: ME },
    workspace: { id: WS, timezone: "America/Costa_Rica", payment_methods: paymentMethodsFixture(["wise", "binance"]), overdue_grace_days: 0 },
    role, roleId, supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: (t: string) => (db.client as unknown as { from: (t: string) => unknown }).from(t),
    storage: {
      from: () => ({
        upload: async (path: string, _b: unknown, opts: { contentType: string }) => { uploaded.push({ path, contentType: opts.contentType }); return { error: null }; },
        remove: async (paths: string[]) => { removed.push(paths); return { error: null }; },
        createSignedUrl: async (path: string, seconds: number) => { signed.push({ path, seconds }); return { data: { signedUrl: `https://storage.test/${path}?t=1` }, error: null }; },
      }),
    },
  }),
}));

const { correctPaymentFee, markPaymentPaid, revertPayment, reschedulePayment, markUncollectible, createRefund, addPayment, uploadPaymentReceipt, getPaymentReceiptUrl } = await import("./payments");

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const seed = () =>
  memoryDb(
    {
      workspace_roles: [],
      sales: [{ id: SALE, workspace_id: WS, contact_id: CONTACT, sale_date: "2026-10-01", status: "reserved", financing_type: "installments", final_amount: 1000 }],
      payments: [
        { id: PAY, workspace_id: WS, sale_id: SALE, type: "installment", status: "scheduled", amount: 500, due_date: "2099-12-01", original_due_date: "2099-12-01", reschedule_count: 0, paid_on: null, payment_method: null, provider_fee_amount: null, receipt_path: null, notes: null },
        { id: U(41), workspace_id: WS, sale_id: SALE, type: "reservation", status: "paid", amount: 500, due_date: "2026-10-01", original_due_date: "2026-10-01", paid_on: "2026-10-01", payment_method: "wise", provider_fee_amount: 0, receipt_path: null, notes: null },
      ],
    },
    { generated: { payments: (row) => { row.delay_days = row.paid_on && row.original_due_date ? daysBetween(String(row.original_due_date), String(row.paid_on)) : null; } } },
  );

beforeEach(() => {
  role = "admin"; roleId = null; db = seed();
  audits.length = 0; healthCalls.length = 0; syncCalls.length = 0; uploaded.length = 0; removed.length = 0; signed.length = 0;
});

const row = (id: string) => db.rows("payments").find((p) => p.id === id)!;
const asLimitedMember = () => { role = "member"; roleId = "rol-1"; db.rows("workspace_roles").push({ id: "rol-1", workspace_id: WS, system_role: null, permissions: { keys: ["sales.view"], scopes: {} } }); };

describe("markPaymentPaid", () => {
  it("sin payments.manage no escribe nada", async () => {
    asLimitedMember();
    expect(await markPaymentPaid({ paymentId: PAY, method: "wise" })).toMatchObject({ ok: false });
    expect(row(PAY).status).toBe("scheduled");
  });

  it("cobra: congela método, snapshot y comisión; recalcula la salud y los recordatorios; audita con la persona", async () => {
    const r = await markPaymentPaid({ paymentId: PAY, method: "binance" });
    expect(r).toMatchObject({ ok: true, partial: null, overpaidBy: 0 });
    expect(row(PAY)).toMatchObject({ status: "paid", amount: 500, payment_method: "binance", provider_fee_amount: 0 });
    expect(row(PAY).payment_option_snapshot).toMatchObject({ method_key: "binance", method_name: "Binance" });
    expect(row(PAY).paid_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(healthCalls).toEqual([CONTACT]);
    expect(syncCalls).toEqual([{ paymentId: PAY }]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityType: "payment", entityId: PAY, action: "payment.paid", performedBy: ME });
  });

  it("un monto menor deja el pago por lo real y OFRECE la diferencia", async () => {
    const r = await markPaymentPaid({ paymentId: PAY, amount: 350, method: "wise" });
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.partial?.difference).toBe(150);
    expect(row(PAY).amount).toBe(350);
    expect(db.rows("payments")).toHaveLength(2); // no crea nada solo
  });

  it("cobrar de más se permite y avisa", async () => {
    const r = await markPaymentPaid({ paymentId: PAY, amount: 600, method: "wise" });
    expect(r.ok && r.overpaidBy).toBe(100);
  });

  it("fecha anterior a la venta, método deshabilitado y ya cobrado se rechazan", async () => {
    expect(await markPaymentPaid({ paymentId: PAY, method: "wise", paidOn: "2026-09-30" })).toMatchObject({ ok: false });
    expect(await markPaymentPaid({ paymentId: PAY, method: "whop" })).toMatchObject({ ok: false });
    expect(await markPaymentPaid({ paymentId: U(41), method: "wise" })).toMatchObject({ ok: false, error: "Este pago ya está cobrado" });
    expect(row(PAY).status).toBe("scheduled");
  });

  it("si el pago cambió mientras tanto, no se cobra dos veces", async () => {
    db.rows("payments").find((p) => p.id === PAY)!.status = "paid"; // otra persona lo cobró
    expect(await markPaymentPaid({ paymentId: PAY, method: "wise" })).toMatchObject({ ok: false });
  });
});

describe("revertPayment", () => {
  it("un cobro de hace 5 días vuelve a moroso y se borra todo lo cobrado", async () => {
    Object.assign(row(PAY), { status: "paid", due_date: "2026-10-06", original_due_date: "2026-10-06", paid_on: "2026-10-06", paid_at: "x", payment_method: "wise", provider_fee_amount: 3, payment_option_snapshot: { a: 1 } });
    vi.setSystemTime(new Date("2026-10-11T18:00:00Z"));
    const r = await revertPayment({ paymentId: PAY, reason: "se cobró dos veces" });
    vi.useRealTimers();
    expect(r).toEqual({ ok: true, status: "overdue" });
    expect(row(PAY)).toMatchObject({ status: "overdue", paid_at: null, paid_on: null, provider_fee_amount: null, payment_option_snapshot: null, revert_reason: "se cobró dos veces" });
    expect(audits[0]).toMatchObject({ action: "payment.reverted" });
  });

  it("pide motivo y no sirve sobre un programado", async () => {
    expect(await revertPayment({ paymentId: U(41), reason: "" })).toMatchObject({ ok: false });
    expect(await revertPayment({ paymentId: PAY, reason: "x" })).toMatchObject({ ok: false });
  });
});

describe("reschedulePayment", () => {
  it("conserva la fecha original, suma una reprogramación y guarda el motivo", async () => {
    const r = await reschedulePayment({ paymentId: PAY, newDate: "2099-12-20", reason: "pidió más tiempo" });
    expect(r).toEqual({ ok: true, status: "scheduled" });
    expect(row(PAY)).toMatchObject({ due_date: "2099-12-20", original_due_date: "2099-12-01", reschedule_count: 1, reschedule_reason: "pidió más tiempo" });
    expect(syncCalls).toEqual([{ paymentId: PAY }]);
  });

  it("un moroso a una fecha futura vuelve a programado", async () => {
    Object.assign(row(PAY), { status: "overdue", due_date: "2026-10-01" });
    expect(await reschedulePayment({ paymentId: PAY, newDate: "2099-01-01", reason: "x" })).toEqual({ ok: true, status: "scheduled" });
  });

  it("sin motivo se rechaza", async () => {
    expect(await reschedulePayment({ paymentId: PAY, newDate: "2099-12-20", reason: " " })).toMatchObject({ ok: false });
    expect(row(PAY).reschedule_count).toBe(0);
  });
});

describe("markUncollectible", () => {
  it("solo un moroso; no cambia el saldo", async () => {
    expect(await markUncollectible({ paymentId: PAY, reason: "no responde" })).toMatchObject({ ok: false });
    Object.assign(row(PAY), { status: "overdue" });
    expect(await markUncollectible({ paymentId: PAY, reason: "no responde" })).toEqual({ ok: true });
    expect(row(PAY)).toMatchObject({ status: "uncollectible", uncollectible_reason: "no responde" });
  });
});

describe("createRefund", () => {
  it("parcial: crea una fila negativa, el pago original sigue cobrado con su comisión y la venta no se escribe", async () => {
    const r = await createRefund({ saleId: SALE, amount: 200, date: "2026-10-10", reason: "pidió devolución parcial", refundOfPaymentId: U(41) });
    expect(r).toEqual({ ok: true, scope: "partial" });
    const refund = db.rows("payments").find((p) => p.type === "refund")!;
    expect(refund).toMatchObject({ amount: -200, status: "paid", provider_fee_amount: null, refund_of_payment_id: U(41), refund_reason: "pidió devolución parcial" });
    expect(row(U(41))).toMatchObject({ status: "paid", provider_fee_amount: 0 });
    expect(db.rows("sales")[0].status).toBe("reserved");
    expect(audits.map((a) => a.action)).toEqual(["payment.refund"]);
  });

  it("total: la venta queda refunded ANTES de crear la fila y sus programados se anulan", async () => {
    const r = await createRefund({ saleId: SALE, amount: 500, date: "2026-10-10", reason: "se cancela todo" });
    expect(r).toEqual({ ok: true, scope: "total" });
    expect(db.rows("sales")[0].status).toBe("refunded");
    expect(row(PAY).status).toBe("cancelled");
    expect(row(U(41)).status).toBe("paid");
    expect(audits.map((a) => a.action)).toEqual(["payment.refund", "sale.refunded"]);
  });

  it("no puede superar lo cobrado neto: dice el máximo", async () => {
    const r = await createRefund({ saleId: SALE, amount: 500.01, date: "2026-10-10", reason: "x" });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain("500.00");
    expect(db.rows("payments").some((p) => p.type === "refund")).toBe(false);
  });

  it("una venta cancelada no se reembolsa", async () => {
    db.rows("sales")[0].status = "cancelled";
    expect(await createRefund({ saleId: SALE, amount: 10, date: "2026-10-10", reason: "x" })).toMatchObject({ ok: false });
  });
});

describe("addPayment", () => {
  it("crea una cuota programada con su fecha original", async () => {
    const r = await addPayment({ saleId: SALE, amount: 150, dueDate: "2099-11-10" });
    expect(r.ok).toBe(true);
    const created = db.rows("payments").find((p) => p.amount === 150)!;
    expect(created).toMatchObject({ type: "installment", status: "scheduled", due_date: "2099-11-10", original_due_date: "2099-11-10" });
    expect(await addPayment({ saleId: SALE, amount: 0, dueDate: "2099-11-10" })).toMatchObject({ ok: false });
  });
});

describe("comprobantes", () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0];
  const form = (bytes: number[] | Uint8Array, name = "c.png") => {
    const fd = new FormData();
    fd.set("paymentId", PAY);
    fd.set("file", new File([Uint8Array.from(bytes)], name));
    return fd;
  };

  it("sube una imagen válida al path del workspace/venta/pago y lo guarda", async () => {
    const r = await uploadPaymentReceipt(form(PNG));
    expect(r.ok).toBe(true);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].path).toMatch(new RegExp(`^${WS}/${SALE}/${PAY}/[0-9a-f-]{36}\\.png$`));
    expect(row(PAY).receipt_path).toBe(uploaded[0].path);
  });

  it("rechaza un .exe disfrazado de imagen y un archivo de más de 10 MB", async () => {
    expect(await uploadPaymentReceipt(form([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "factura.png"))).toMatchObject({ ok: false });
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PNG);
    expect(await uploadPaymentReceipt(form(big))).toMatchObject({ ok: false });
    expect(uploaded).toHaveLength(0);
  });

  it("el link firmado dura 60 segundos y solo se da de un path que cuelga del pago", async () => {
    Object.assign(row(PAY), { receipt_path: `${WS}/${SALE}/${PAY}/abc.png` });
    const r = await getPaymentReceiptUrl({ paymentId: PAY });
    expect(r.ok && r.url).toContain("abc.png");
    expect(signed).toEqual([{ path: `${WS}/${SALE}/${PAY}/abc.png`, seconds: 60 }]);
    Object.assign(row(PAY), { receipt_path: `otro/${SALE}/${PAY}/abc.png` });
    expect(await getPaymentReceiptUrl({ paymentId: PAY })).toMatchObject({ ok: false });
    expect(signed).toHaveLength(1);
  });
});

describe("correctPaymentFee (Extra I, F6)", () => {
  it("cambia solo el total de la comisión de un cobro y lo deja en el historial con su motivo", async () => {
    await markPaymentPaid({ paymentId: PAY, method: "wise" });
    audits.length = 0;
    const before = { ...row(PAY) };
    expect(await correctPaymentFee({ paymentId: PAY, feeAmount: 12.5, reason: "el banco cobró distinto" })).toEqual({ ok: true, feeAmount: 12.5 });
    expect(row(PAY).provider_fee_amount).toBe(12.5);
    expect(row(PAY).amount).toBe(before.amount);
    expect(row(PAY).payment_option_snapshot).toEqual(before.payment_option_snapshot);
    expect(audits[0]).toMatchObject({ entityType: "payment", action: "payment.fee_corrected", metadata: { reason: "el banco cobró distinto" } });
  });

  it("rechaza más que lo cobrado, un pago sin cobrar y a quien no administra pagos", async () => {
    expect(await correctPaymentFee({ paymentId: PAY, feeAmount: 1, reason: "x" })).toMatchObject({ ok: false }); // programado
    await markPaymentPaid({ paymentId: PAY, method: "wise" });
    expect(await correctPaymentFee({ paymentId: PAY, feeAmount: 999, reason: "x" })).toMatchObject({ ok: false });
    asLimitedMember();
    expect(await correctPaymentFee({ paymentId: PAY, feeAmount: 1, reason: "x" })).toMatchObject({ ok: false });
  });
});
