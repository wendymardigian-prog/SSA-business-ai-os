import { describe, expect, it } from "vitest";
import { COMMISSIONS_CSV_HEADER, commissionsToCsv, type CommissionExportRow } from "./export-csv";

const row = (patch: Partial<CommissionExportRow> = {}): CommissionExportRow => ({
  id: "c1", paidOn: "2026-10-10", personName: "Ana", roleName: "Vendedor", contactName: "Lucía Pérez", productName: "Mentoría", financing: "En cuotas", paymentNumber: 2,
  method: "Whop", collectedCents: 50000, feeCents: 1480, baseCents: 48520, calc: "8 % del neto", amountCents: 3882, ruleName: "Vendedor 8 %", statusLabel: "Pendiente",
  expenseStatusLabel: null, expenseDate: null, channel: "organic", pieceOrAd: "Reel de octubre", notes: null, ...patch,
});

describe("commissionsToCsv", () => {
  it("lleva las 21 columnas pedidas, en orden, con BOM", () => {
    const csv = commissionsToCsv([]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.replace("﻿", "").trim().split(",")).toEqual([
      "id", "fecha_cobro", "persona", "rol", "contacto", "producto", "financiamiento", "pago_numero", "metodo", "cobrado", "fee", "base", "calculo", "monto", "regla",
      "estado", "gasto_estado", "gasto_fecha", "canal", "pieza_o_anuncio", "notas",
    ]);
    expect(COMMISSIONS_CSV_HEADER).toHaveLength(21);
  });

  it("los montos van con punto y dos decimales", () => {
    const lines = commissionsToCsv([row()]).split("\r\n");
    expect(lines[1]).toBe("c1,2026-10-10,Ana,Vendedor,Lucía Pérez,Mentoría,En cuotas,2,Whop,500.00,14.80,485.20,8 % del neto,38.82,Vendedor 8 %,Pendiente,,,organic,Reel de octubre,");
  });

  it("un ajuste negativo conserva el signo, y lo que no se muestra queda vacío", () => {
    const line = commissionsToCsv([row({ amountCents: -1941, collectedCents: null, feeCents: null, baseCents: null, calc: null, ruleName: null, roleName: null, paymentNumber: null })]).split("\r\n")[1];
    expect(line).toContain(",-19.41,");
    expect(line.split(",").slice(7, 14)).toEqual(["", "Whop", "", "", "", "", "-19.41"]);
  });

  it("el gasto lleva su estado y su fecha", () => {
    const line = commissionsToCsv([row({ statusLabel: "Pagada", expenseStatusLabel: "Pagado", expenseDate: "2026-11-06" })]).split("\r\n")[1];
    expect(line).toContain(",Pagada,Pagado,2026-11-06,");
  });

  it("neutraliza las fórmulas de los textos y entrecomilla lo que tiene comas", () => {
    const line = commissionsToCsv([row({ contactName: "=HYPERLINK(\"x\")", notes: "pagar, por favor\nrápido" })]).split("\r\n");
    expect(line[1]).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(commissionsToCsv([row({ notes: "pagar, por favor" })])).toContain('"pagar, por favor"');
  });
});
