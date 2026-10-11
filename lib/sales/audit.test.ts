/**
 * Ventas F34: qué escribe cada acción del módulo en `audit_log`. Lee el código y las migraciones: toda
 * acción de venta o pago que se audita tiene su etiqueta en el historial, las personas escriben con su
 * actor y los procesos automáticos con un nombre legible.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeChanges, SALE_ACTION_LABELS } from "@/lib/audit-history";

const read = (path: string) => readFileSync(path, "utf8");
const actionsIn = (text: string) => [...text.matchAll(/["']((?:sale|payment|product|variant|version|assignment|assignment_rule)\.[a-z_]+)["']/g)].map((m) => m[1]);

describe("las acciones de Ventas que se auditan tienen etiqueta en el historial", () => {
  const sources = [
    "lib/actions/sales.ts",
    "lib/actions/payments.ts",
    "lib/actions/sales-contract.ts",
    "lib/sales/payments-core.ts",
    "lib/jobs/handlers/payments-overdue-sweep.ts",
    "lib/jobs/handlers/sales-contact-eval.ts",
    "supabase/migrations/00162_sales_payments.sql",
  ];
  for (const file of sources) {
    it(file, () => {
      const found = [...new Set(actionsIn(read(file)))].filter((a) => /^(sale|payment)\./.test(a));
      for (const action of found) expect(Object.keys(SALE_ACTION_LABELS), `${file} audita «${action}» sin etiqueta`).toContain(action);
    });
  }
});

describe("quién escribe", () => {
  it("el barrido de mora escribe como el sistema «Job de mora»", () => {
    const text = read("lib/jobs/handlers/payments-overdue-sweep.ts");
    expect(text).toContain("auditAsSystem");
    expect(text).toContain('OVERDUE_AUDIT_LABEL = "Job de mora"');
  });

  it("las acciones de un flujo escriben como el sistema con el nombre del flujo; las personas, con su id", () => {
    const core = read("lib/sales/payments-core.ts");
    expect(core).toMatch(/kind === "user"[\s\S]*performedBy: c\.actor\.userId/);
    expect(core).toMatch(/auditAsSystem\([\s\S]*label: c\.actor\.label/);
    expect(read("lib/flow-engine/nodes/sales-actions.ts")).toContain('actor: { kind: "system", label: flowName }');
  });

  it("las acciones de las personas pasan por logAudit con performedBy", () => {
    const payments = read("lib/actions/payments.ts");
    for (const action of ["payment.created", "payment.refund", "payment.receipt_uploaded"]) expect(payments).toContain(action);
    expect(payments.match(/performedBy: ctx\.user\.id/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe("el historial de una venta se lee con su diff legible", () => {
  it("el estado sale con su etiqueta y los montos con su nombre", () => {
    const lines = describeChanges("sale", { status: { old: "pending_payment", new: "paid" }, final_amount: { old: 1297, new: 1097 }, discount_reason: { old: null, new: "Promo octubre" } });
    expect(lines).toEqual([
      { field: "status", label: "Estado", before: "Con pago pendiente", after: "Pagada" },
      { field: "final_amount", label: "Monto final", before: "1297", after: "1097" },
      { field: "discount_reason", label: "Motivo del descuento", before: "—", after: "Promo octubre" },
    ]);
  });
  it("el estado de un pago también", () => {
    expect(describeChanges("payment", { status: { old: "scheduled", new: "overdue" } })[0]).toMatchObject({ before: "Programado", after: "Moroso" });
    expect(describeChanges("contact", { status: { old: "open", new: "closed" } })[0]).toMatchObject({ before: "open", after: "closed" });
  });
});
