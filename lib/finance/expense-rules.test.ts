import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES } from "./categories";
import { duplicateDraft, planCreateExpense, planPayExpense, planRevertExpense, planUpdateExpense, planVoidExpense, type ExpenseRowLite } from "./expense-rules";

const ctx = { todayLocal: "2026-10-10", categories: DEFAULT_EXPENSE_CATEGORIES };
const base = { concept: "Factura agencia", categoryKey: "marketing", amount: 800, scheduledDate: "2026-10-20" };
const row = (over: Partial<ExpenseRowLite> = {}): ExpenseRowLite => ({
  status: "programado", origin: "manual", amount: 800, scheduled_date: "2026-10-20", paid_date: null, concept: "Factura agencia",
  vendor_id: null, category_key: "marketing", responsible_id: null, notes: null, ...over,
});

describe("planCreateExpense", () => {
  it("fecha de hoy nace programado; de ayer, vencido", () => {
    expect(planCreateExpense({ ...base, scheduledDate: "2026-10-10" }, ctx)).toMatchObject({ ok: true, row: { status: "programado" } });
    expect(planCreateExpense({ ...base, scheduledDate: "2026-10-09" }, ctx)).toMatchObject({ ok: true, row: { status: "vencido" } });
  });
  it("«monto a confirmar» nace Por revisar con monto 0", () => {
    expect(planCreateExpense({ ...base, amount: undefined, amountToConfirm: true }, ctx)).toMatchObject({ ok: true, row: { status: "por_revisar", amount: 0 } });
  });
  it("sin monto ni «a confirmar» se rechaza", () => {
    expect(planCreateExpense({ ...base, amount: 0 }, ctx)).toMatchObject({ ok: false });
    expect(planCreateExpense({ ...base, amount: "x" }, ctx)).toMatchObject({ ok: false });
  });
  it("«ya está pagado» pone la fecha de pago (hoy por defecto) y no admite una futura", () => {
    expect(planCreateExpense({ ...base, paid: true }, ctx)).toMatchObject({ ok: true, row: { status: "pagado", paid_date: "2026-10-10" } });
    expect(planCreateExpense({ ...base, paid: true, paidDate: "2026-10-11" }, ctx)).toMatchObject({ ok: false });
    expect(planCreateExpense({ ...base, paid: true, amountToConfirm: true }, ctx)).toMatchObject({ ok: false });
  });
  it("exige una categoría activa y un concepto", () => {
    expect(planCreateExpense({ ...base, categoryKey: "no-existe" }, ctx)).toMatchObject({ ok: false });
    expect(planCreateExpense({ ...base, categoryKey: "marketing" }, { ...ctx, categories: ctx.categories.map((c) => (c.key === "marketing" ? { ...c, archived_at: "x" } : c)) })).toMatchObject({ ok: false });
    expect(planCreateExpense({ ...base, concept: "   " }, ctx)).toMatchObject({ ok: false });
  });
  it("avisa de un monto muy alto sin bloquear; el monto se redondea al céntimo", () => {
    expect(planCreateExpense({ ...base, amount: 100000 }, ctx)).toMatchObject({ ok: true, highAmount: true });
    expect(planCreateExpense({ ...base, amount: 0.1 + 0.2 }, ctx)).toMatchObject({ ok: true, row: { amount: 0.3 } });
  });
  it("a las 23:30 hora de Costa Rica «hoy» sigue siendo el día local (lo resuelve quien llama)", () => {
    // 2026-10-11T05:30Z = 2026-10-10 23:30 en Costa Rica
    const today = new Date("2026-10-11T05:30:00Z").toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
    expect(today).toBe("2026-10-10");
    expect(planCreateExpense({ ...base, scheduledDate: today }, { ...ctx, todayLocal: today })).toMatchObject({ row: { status: "programado" } });
  });
});

describe("planUpdateExpense", () => {
  const input = { concept: "Factura agencia", categoryKey: "marketing", amount: 800, scheduledDate: "2026-10-20" };
  it("cambiar la fecha recalcula programado/vencido", () => {
    expect(planUpdateExpense(row(), { ...input, scheduledDate: "2026-10-05" }, ctx)).toMatchObject({ ok: true, patch: { status: "vencido" } });
    expect(planUpdateExpense(row({ status: "vencido", scheduled_date: "2026-10-05" }), { ...input, scheduledDate: "2026-10-25" }, ctx)).toMatchObject({ ok: true, patch: { status: "programado" } });
  });
  it("un pagado no cambia monto ni fecha, pero sí concepto, notas y categoría", () => {
    const paid = row({ status: "pagado", paid_date: "2026-10-08" });
    expect(planUpdateExpense(paid, { ...input, amount: 900 }, ctx)).toMatchObject({ ok: false, error: expect.stringContaining("Revertí") });
    expect(planUpdateExpense(paid, { ...input, scheduledDate: "2026-10-21" }, ctx)).toMatchObject({ ok: false });
    expect(planUpdateExpense(paid, { ...input, concept: "Otro concepto", notes: "nota" }, ctx)).toMatchObject({ ok: true, patch: { status: "pagado", concept: "Otro concepto" } });
  });
  it("un anulado no se edita", () => {
    expect(planUpdateExpense(row({ status: "anulado" }), input, ctx)).toMatchObject({ ok: false });
  });
  it("un automático no pagado no deja cambiar monto ni concepto", () => {
    const auto = row({ origin: "processor_fee" });
    expect(planUpdateExpense(auto, { ...input, amount: 10 }, ctx)).toMatchObject({ ok: false });
    expect(planUpdateExpense(auto, { ...input, concept: "Otro" }, ctx)).toMatchObject({ ok: false });
    expect(planUpdateExpense(auto, { ...input, notes: "solo una nota" }, ctx)).toMatchObject({ ok: true });
  });
  it("una liquidación de comisiones no cambia monto ni persona", () => {
    const payout = row({ origin: "commission_payout", vendor_id: "11111111-1111-4111-8111-111111111111" });
    expect(planUpdateExpense(payout, { ...input, vendorId: "11111111-1111-4111-8111-111111111111", amount: 5 }, ctx)).toMatchObject({ ok: false });
    expect(planUpdateExpense(payout, { ...input, vendorId: null }, ctx)).toMatchObject({ ok: false });
  });
  it("confirmar el monto de un Por revisar con fecha pasada lo deja vencido", () => {
    const review = row({ status: "por_revisar", amount: 0, scheduled_date: "2026-10-01" });
    expect(planUpdateExpense(review, { ...input, amount: 120, scheduledDate: "2026-10-01" }, ctx)).toMatchObject({ ok: true, patch: { status: "vencido", amount: 120 } });
    expect(planUpdateExpense(review, { ...input, amount: 0, scheduledDate: "2026-10-01" }, ctx)).toMatchObject({ ok: true, patch: { status: "por_revisar" } });
  });
  it("conserva la categoría archivada que ya tenía, pero no se elige una archivada para otra", () => {
    const archived = ctx.categories.map((c) => (c.key === "marketing" ? { ...c, archived_at: "x" } : c));
    expect(planUpdateExpense(row(), input, { ...ctx, categories: archived })).toMatchObject({ ok: true });
    expect(planUpdateExpense(row({ category_key: "other" }), input, { ...ctx, categories: archived })).toMatchObject({ ok: false });
  });
  it("un ajuste admite monto negativo y nunca cero", () => {
    const adj = row({ origin: "adjustment", amount: -4.2 });
    expect(planUpdateExpense(adj, { ...input, amount: -5 }, ctx)).toMatchObject({ ok: true, patch: { amount: -5 } });
    expect(planUpdateExpense(adj, { ...input, amount: 0 }, ctx)).toMatchObject({ ok: false });
    expect(planUpdateExpense(row(), { ...input, amount: -5 }, ctx)).toMatchObject({ ok: false });
  });
});

describe("pagar, revertir, anular", () => {
  it("pagar con fecha futura se rechaza; sin fecha, hoy", () => {
    expect(planPayExpense(row(), { paidDate: "2026-10-11" }, ctx)).toMatchObject({ ok: false });
    expect(planPayExpense(row(), {}, ctx)).toMatchObject({ ok: true, patch: { status: "pagado", paid_date: "2026-10-10", amount: 800 } });
  });
  it("un Por revisar necesita monto para pagarse", () => {
    const review = row({ status: "por_revisar", amount: 0 });
    expect(planPayExpense(review, {}, ctx)).toMatchObject({ ok: false });
    expect(planPayExpense(review, { amount: 75.5 }, ctx)).toMatchObject({ ok: true, patch: { amount: 75.5 } });
  });
  it("ya pagado o anulado no se paga; un automático no cambia el monto al pagar", () => {
    expect(planPayExpense(row({ status: "pagado", paid_date: "2026-10-08" }), {}, ctx)).toMatchObject({ ok: false });
    expect(planPayExpense(row({ status: "anulado" }), {}, ctx)).toMatchObject({ ok: false });
    expect(planPayExpense(row({ origin: "meta_ads" }), { amount: 1 }, ctx)).toMatchObject({ ok: false });
  });
  it("revertir pide motivo y vuelve a programado o vencido según su fecha", () => {
    const paid = row({ status: "pagado", paid_date: "2026-10-08", scheduled_date: "2026-10-05" });
    expect(planRevertExpense(paid, "  ", ctx)).toMatchObject({ ok: false });
    expect(planRevertExpense(paid, "me equivoqué", ctx)).toEqual({ ok: true, target: "vencido" });
    expect(planRevertExpense({ ...paid, scheduled_date: "2026-10-20" }, "x", ctx)).toEqual({ ok: true, target: "programado" });
    expect(planRevertExpense(row(), "x", ctx)).toMatchObject({ ok: false });
  });
  it("anular pide motivo; un pagado se revierte primero", () => {
    expect(planVoidExpense(row(), "")).toMatchObject({ ok: false });
    expect(planVoidExpense(row({ status: "pagado" }), "x")).toMatchObject({ ok: false, error: expect.stringContaining("Revertí") });
    expect(planVoidExpense(row(), "duplicado")).toEqual({ ok: true, reason: "duplicado" });
    expect(planVoidExpense(row({ status: "anulado" }), "x")).toMatchObject({ ok: false });
  });
});

describe("duplicar", () => {
  it("copia lo importante y deja la fecha vacía", () => {
    expect(duplicateDraft(row({ vendor_id: "v1", notes: "n" }))).toMatchObject({ concept: "Factura agencia", vendorId: "v1", categoryKey: "marketing", amount: 800, notes: "n", scheduledDate: "" });
  });
});
