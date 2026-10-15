import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES } from "./categories";
import { EXPENSES_CSV_HEADER, expensesToCsv } from "./expenses-csv";
import type { ExpenseListRow } from "./expense-list";

const lookups = { categories: DEFAULT_EXPENSE_CATEGORIES, vendorName: (id: string | null) => (id ? "Agencia" : ""), memberName: (id: string | null) => (id ? "Ana" : "") };
const row = (over: Partial<ExpenseListRow> = {}): ExpenseListRow => ({ id: "e1", concept: "Pago", vendor_id: null, category_key: "marketing", amount: 10, status: "pagado", scheduled_date: "2026-10-10", paid_date: "2026-10-10", origin: "manual", receipt_path: null, ...over });

describe("expensesToCsv", () => {
  it("encabezado fijo y montos con punto y dos decimales: 0.10 y 0.20", () => {
    const out = expensesToCsv([row({ amount: 0.1 }), row({ id: "e2", amount: 0.2 })], lookups);
    const lines = out.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe(EXPENSES_CSV_HEADER.join(","));
    const idx = EXPENSES_CSV_HEADER.indexOf("monto_usd");
    expect(lines[1].split(",")[idx]).toBe("0.10");
    expect(lines[2].split(",")[idx]).toBe("0.20");
  });
  it("una coma y comillas en el concepto salen entre comillas", () => {
    expect(expensesToCsv([row({ concept: 'Pago "agencia", octubre' })], lookups)).toContain('"Pago ""agencia"", octubre"');
  });
  it("un concepto que empieza con = se neutraliza", () => {
    expect(expensesToCsv([row({ concept: "=1+1" })], lookups)).toContain("'=1+1");
  });
  it("un ajuste negativo sale con signo", () => {
    expect(expensesToCsv([row({ amount: -4.2, origin: "adjustment" })], lookups)).toContain("-4.20");
  });
  it("nunca lleva datos de pago del proveedor", () => {
    expect(EXPENSES_CSV_HEADER.join(",")).not.toMatch(/payment|pago_datos|cuenta/);
  });
});
