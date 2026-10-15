import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES } from "./categories";
import {
  amountToText, draftFromDuplicate, draftFromExpense, emptyDraft, fieldLocks, isHighAmountCents, parseAmountText, toCreateInput, toUpdateInput, validateDraft,
} from "./expense-form";
import type { ExpenseRowLite } from "./expense-rules";

const TODAY = "2026-10-15";
const cats = DEFAULT_EXPENSE_CATEGORIES;

const row = (patch: Partial<ExpenseRowLite> = {}): ExpenseRowLite => ({
  status: "programado", origin: "manual", amount: 120, scheduled_date: "2026-10-20", paid_date: null, concept: "Hosting", vendor_id: "v1",
  category_key: "software", responsible_id: null, notes: "nota", ...patch,
});

describe("parseAmountText", () => {
  it.each([
    ["1240", 124000],
    ["1240,5", 124050],
    ["1240.50", 124050],
    ["1.240,50", 124050],
    ["1,240.50", 124050],
    ["USD 12.500", 1250000],
    ["12,500", 1250000],
    ["$ 36", 3600],
    ["0,5", 50],
    ["0.99", 99],
    ["1.234.567", 123456700],
  ])("%s → %i céntimos", (text, cents) => {
    expect(parseAmountText(text)).toEqual({ kind: "ok", cents });
  });

  it("vacío no es un error", () => {
    expect(parseAmountText("  ")).toEqual({ kind: "empty" });
  });

  it.each(["abc", "12,3456", "1.2.3", "0,125", "12..5", "1,24,5", "--4"])("%s es inválido", (text) => {
    expect(parseAmountText(text).kind).toBe("invalid");
  });

  it("un negativo solo se acepta si se pide (los ajustes)", () => {
    expect(parseAmountText("-4,20").kind).toBe("invalid");
    expect(parseAmountText("-4,20", { allowNegative: true })).toEqual({ kind: "ok", cents: -420 });
    expect(parseAmountText("−4,20", { allowNegative: true })).toEqual({ kind: "ok", cents: -420 });
  });

  it("rechaza un monto que no entra en la base", () => {
    expect(parseAmountText("99999999999").kind).toBe("invalid");
  });

  it("amountToText vuelve al texto del campo", () => {
    expect(amountToText(1240.5)).toBe("1240,50");
    expect(amountToText(36)).toBe("36");
    expect(amountToText(0)).toBe("");
    expect(amountToText(null)).toBe("");
  });

  it("avisa de un monto alto desde USD 100.000", () => {
    expect(isHighAmountCents(9_999_999)).toBe(false);
    expect(isHighAmountCents(10_000_000)).toBe(true);
  });
});

describe("borradores", () => {
  it("el alta arranca con hoy y una categoría activa", () => {
    const d = emptyDraft(TODAY, cats);
    expect(d.scheduledDate).toBe(TODAY);
    expect(d.paidDate).toBe(TODAY);
    expect(d.categoryKey).toBe("ads_meta");
    expect(d.paid).toBe(false);
  });

  it("duplicar copia concepto, proveedor, categoría, monto, responsable y notas, con la fecha vacía", () => {
    const d = draftFromDuplicate(row({ responsible_id: "u1" }), TODAY, cats);
    expect(d).toMatchObject({ concept: "Hosting", vendorId: "v1", categoryKey: "software", amountText: "120", responsibleId: "u1", notes: "nota", scheduledDate: "", paid: false });
  });

  it("duplicar un Por revisar vuelve a pedir «Monto a confirmar»", () => {
    const d = draftFromDuplicate(row({ status: "por_revisar", amount: 0 }), TODAY, cats);
    expect(d.amountToConfirm).toBe(true);
    expect(d.amountText).toBe("");
  });

  it("duplicar con una categoría archivada cae a una activa", () => {
    const archived = cats.map((c) => (c.key === "software" ? { ...c, archived_at: "2026-01-01", system: false } : c));
    expect(draftFromDuplicate(row(), TODAY, archived).categoryKey).toBe("ads_meta");
  });

  it("editar trae los valores tal cual", () => {
    expect(draftFromExpense(row({ amount: 36.5 }), TODAY)).toMatchObject({ concept: "Hosting", amountText: "36,50", scheduledDate: "2026-10-20" });
  });
});

describe("fieldLocks", () => {
  it("un pagado no cambia monto ni fecha", () => {
    const l = fieldLocks({ status: "pagado", origin: "manual" });
    expect(l).toMatchObject({ amount: true, scheduledDate: true, concept: false });
    expect(l.amountReason).toContain("Revertí el pago primero");
  });

  it("un automático sin pagar no cambia monto ni concepto, y dice por qué", () => {
    const l = fieldLocks({ status: "programado", origin: "processor_fee" });
    expect(l).toMatchObject({ amount: true, concept: true, scheduledDate: false });
    expect(l.amountReason).toBe("Este monto lo calcula el sistema todos los días. Se congela cuando lo marcás pagado.");
  });

  it("un automático pagado: solo monto y fecha (el concepto se puede aclarar)", () => {
    expect(fieldLocks({ status: "pagado", origin: "meta_ads" })).toMatchObject({ amount: true, concept: false, scheduledDate: true });
  });

  it("una liquidación de comisiones no cambia monto ni persona", () => {
    expect(fieldLocks({ status: "programado", origin: "commission_payout" })).toMatchObject({ amount: true, vendor: true });
  });

  it("un gasto manual sin pagar se edita entero; sin gasto no hay bloqueos", () => {
    expect(fieldLocks({ status: "vencido", origin: "manual" })).toMatchObject({ amount: false, concept: false, vendor: false, scheduledDate: false });
    expect(fieldLocks(null).amount).toBe(false);
  });
});

describe("validateDraft", () => {
  const base = { ...emptyDraft(TODAY, cats), concept: "Factura", amountText: "100" };
  const create = { mode: "create" as const, todayLocal: TODAY, categories: cats };

  it("un alta correcta devuelve los céntimos", () => {
    expect(validateDraft(base, create)).toEqual({ ok: true, amountCents: 10000 });
  });

  it("pide concepto, categoría, fecha y monto", () => {
    expect(validateDraft({ ...base, concept: "  " }, create)).toMatchObject({ ok: false, field: "concept" });
    expect(validateDraft({ ...base, categoryKey: "" }, create)).toMatchObject({ ok: false, field: "category" });
    expect(validateDraft({ ...base, scheduledDate: "" }, create)).toMatchObject({ ok: false, field: "date" });
    expect(validateDraft({ ...base, amountText: "" }, create)).toMatchObject({ ok: false, field: "amount" });
    expect(validateDraft({ ...base, amountText: "0" }, create)).toMatchObject({ ok: false, field: "amount" });
  });

  it("«Monto a confirmar» deja el monto vacío", () => {
    expect(validateDraft({ ...base, amountText: "", amountToConfirm: true }, create)).toEqual({ ok: true, amountCents: null });
  });

  it("no se da de alta un gasto pagado con fecha futura ni sin monto", () => {
    expect(validateDraft({ ...base, paid: true, paidDate: "2026-10-16" }, create)).toMatchObject({ ok: false, field: "paidDate" });
    expect(validateDraft({ ...base, paid: true, amountToConfirm: true, amountText: "" }, create)).toMatchObject({ ok: false, field: "amount" });
    expect(validateDraft({ ...base, paid: true, paidDate: TODAY }, create)).toMatchObject({ ok: true });
  });

  it("al editar no se elige una categoría archivada ajena, pero se conserva la propia", () => {
    const archived = cats.map((c) => (c.key === "software" ? { ...c, archived_at: "2026-01-01", system: false } : c));
    const edit = (rowCat: string) => ({ mode: "edit" as const, todayLocal: TODAY, categories: archived, row: { status: "programado", origin: "manual", category_key: rowCat } });
    expect(validateDraft({ ...base, categoryKey: "software" }, edit("software")).ok).toBe(true);
    expect(validateDraft({ ...base, categoryKey: "software" }, edit("taxes"))).toMatchObject({ ok: false, field: "category" });
  });

  it("al editar un monto bloqueado no se valida el monto", () => {
    const edit = { mode: "edit" as const, todayLocal: TODAY, categories: cats, row: { status: "pagado", origin: "manual", category_key: "software" } };
    expect(validateDraft({ ...base, amountText: "" }, edit)).toEqual({ ok: true, amountCents: null });
  });

  it("un Por revisar se puede guardar sin monto; un ajuste admite negativo", () => {
    const revisar = { mode: "edit" as const, todayLocal: TODAY, categories: cats, row: { status: "por_revisar", origin: "recurring", category_key: "software" } };
    expect(validateDraft({ ...base, amountText: "" }, revisar)).toEqual({ ok: true, amountCents: null });
    const ajuste = { mode: "edit" as const, todayLocal: TODAY, categories: cats, row: { status: "programado", origin: "adjustment", category_key: "software" } };
    expect(validateDraft({ ...base, amountText: "-4,20" }, ajuste)).toEqual({ ok: true, amountCents: -420 });
    expect(validateDraft({ ...base, amountText: "0" }, ajuste)).toMatchObject({ ok: false, field: "amount" });
  });
});

describe("armar lo que se manda", () => {
  const d = { ...emptyDraft(TODAY, cats), concept: "  Factura  ", vendorId: "v1", amountText: "1.240,50", notes: "" };

  it("createExpense recibe el monto en dólares y las notas vacías como null", () => {
    expect(toCreateInput(d, 124050)).toEqual({
      concept: "Factura", vendorId: "v1", categoryKey: "ads_meta", amount: 1240.5, amountToConfirm: false, scheduledDate: TODAY,
      responsibleId: null, notes: null, paid: false, paidDate: null,
    });
  });

  it("«Monto a confirmar» manda monto null; «Ya está pagado» manda la fecha", () => {
    expect(toCreateInput({ ...d, amountToConfirm: true }, null)).toMatchObject({ amount: null, amountToConfirm: true });
    expect(toCreateInput({ ...d, paid: true, paidDate: "2026-10-10" }, 124050)).toMatchObject({ paid: true, paidDate: "2026-10-10" });
  });

  it("updateExpense no manda el monto si está bloqueado o vacío", () => {
    expect(toUpdateInput(d, null, { scheduled_date: "2026-10-20" })).not.toHaveProperty("amount");
    expect(toUpdateInput(d, 5000, { scheduled_date: "2026-10-20" })).toMatchObject({ amount: 50, concept: "Factura" });
  });
});
