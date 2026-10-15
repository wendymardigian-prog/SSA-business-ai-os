import { describe, expect, it } from "vitest";
import { emptyCommissionFilters, parseCommissionFilters } from "./filters";
import type { CommissionListRow } from "./list-load";
import {
  closeDrawerHref, drawerHref, exportHref, exportWarning, groupLabel, groupPageRows, isSelectableRow, notSelectableMessage, payoutResultMessage, refundAdjustHref,
  rowGroupKey, selectionState, setManySelected, toggleSelected, type Selection,
} from "./list-view";
import { commissionStatus } from "./status";

let n = 0;
const row = (patch: Partial<CommissionListRow> = {}): CommissionListRow => {
  n += 1;
  const base = { voided_at: null, user_id: "u1", expense_id: null, available_on: "2026-10-01" };
  return {
    id: `c${n}`, kind: "earned", role: "vendedor", roleName: "Vendedor", userId: "u1", userName: "Ana", saleId: "s1", paymentId: "p1", contactId: "k1", contactName: "Lucía",
    productId: "pr1", productName: "Mentoría", variantName: null, amountCents: 1000, baseCents: 10000, paidOn: "2026-10-10", availableOn: "2026-10-01", ruleId: "r", ruleName: "Regla",
    attribution: null, notes: null, voidReason: null, voidedAt: null, createdAt: "2026-10-10T10:00:00Z", expense: null,
    status: commissionStatus(base, null, "2026-10-15"), notSelectable: null, ...patch,
  };
};

const lookups = {
  members: [{ id: "u1", name: "Ana" }, { id: "u2", name: "Beto" }],
  roles: [{ key: "vendedor", name: "Vendedor" }],
  products: [{ id: "pr1", name: "Mentoría" }],
};

describe("links", () => {
  it("la ficha conserva los filtros y suma ?commission=", () => {
    const filters = parseCommissionFilters({ estado: "pendiente", pagina: "2" });
    const href = drawerHref(filters, "abc");
    expect(href).toBe("/dashboard/finanzas/comisiones?estado=pendiente&pagina=2&commission=abc");
    expect(closeDrawerHref(filters)).toBe("/dashboard/finanzas/comisiones?estado=pendiente&pagina=2");
    expect(closeDrawerHref(emptyCommissionFilters())).toBe("/dashboard/finanzas/comisiones");
  });
  it("el CSV usa el mismo filtro sin página ni agrupar", () => {
    expect(exportHref(parseCommissionFilters({ estado: "pendiente", pagina: "3", agrupar: "rol" }))).toBe("/api/v1/commissions/export?estado=pendiente");
    expect(exportHref(emptyCommissionFilters())).toBe("/api/v1/commissions/export");
  });
  it("avisa cuando el filtro pasa el tope del CSV", () => {
    expect(exportWarning(5000)).toBeNull();
    expect(exportWarning(5001)).toMatch(/5\.001.*5\.000/);
  });
  it("el link de un reembolso lleva el id del pago", () => {
    expect(refundAdjustHref("p-1")).toBe("/dashboard/finanzas/comisiones?ajuste=p-1");
  });
});

describe("selección", () => {
  const free = row({ id: "a", amountCents: 500 });
  const inExpense = row({ id: "b", notSelectable: "already_in_expense" });
  const held = row({ id: "c", notSelectable: "held" });
  const empty: Selection = new Map();

  it("solo se elige lo que se puede elegir, con el monto y la persona", () => {
    expect(isSelectableRow(free)).toBe(true);
    expect(isSelectableRow(inExpense)).toBe(false);
    const one = toggleSelected(empty, free);
    expect([...one.values()]).toEqual([{ id: "a", userId: "u1", amountCents: 500, paidOn: "2026-10-10" }]);
    expect(toggleSelected(empty, inExpense).size).toBe(0);
    expect(toggleSelected(one, free).size).toBe(0);
  });

  it("marcar toda la página no toca las que no se pueden pagar, y desmarcar las suelta", () => {
    const all = setManySelected(empty, [free, inExpense, held, row({ id: "d" })], true);
    expect([...all.keys()].sort()).toEqual(["a", "d"]);
    expect(setManySelected(all, [free], false).size).toBe(1);
  });

  it("el estado de la casilla de grupo", () => {
    const rows = [free, row({ id: "d" }), inExpense];
    expect(selectionState(empty, rows)).toBe("none");
    expect(selectionState(toggleSelected(empty, free), rows)).toBe("some");
    expect(selectionState(setManySelected(empty, rows, true), rows)).toBe("all");
    expect(selectionState(empty, [inExpense, held])).toBe("none");
  });

  it("dice el motivo en palabras", () => {
    expect(notSelectableMessage("held")).toBe("Está retenida: todavía no se puede pagar");
    expect(notSelectableMessage("no_person")).toMatch(/asignale una primero/);
    expect(notSelectableMessage(null)).toBeNull();
  });
});

describe("grupos de la página", () => {
  const a1 = row({ id: "a1", userId: "u1", amountCents: 1000 });
  const a2 = row({ id: "a2", userId: "u1", amountCents: 500 });
  const b1 = row({ id: "b1", userId: "u2", userName: "Beto", amountCents: 3000 });
  const sin = row({ id: "s1", userId: null, userName: null });

  it("la clave de cada fila es la misma que cuenta el servidor", () => {
    expect(rowGroupKey(a1, "persona")).toBe("u1");
    expect(rowGroupKey(sin, "persona")).toBe("none");
    expect(rowGroupKey(a1, "mes")).toBe("2026-10");
    expect(rowGroupKey(row({ paidOn: null }), "mes")).toBe("none");
    expect(rowGroupKey(a1, "estado")).toBe("pendiente");
    expect(rowGroupKey(a1, "gasto")).toBe("none");
    expect(rowGroupKey(row({ expense: { expense_id: "e1", status: "programado", scheduled_date: null, paid_date: null } }), "gasto")).toBe("e1");
  });

  it("respeta el orden del servidor y muestra el subtotal de TODO el filtro", () => {
    const groups = [{ key: "u2", count: 9, cents: 27000 }, { key: "u1", count: 4, cents: 6000 }];
    const out = groupPageRows([a1, a2, b1], "persona", groups, lookups);
    expect(out.map((g) => [g.key, g.label, g.rows.length, g.count, g.cents])).toEqual([
      ["u2", "Beto", 1, 9, 27000],
      ["u1", "Ana", 2, 4, 6000],
    ]);
  });

  it("un grupo que el servidor no trae (las anuladas) se cuenta con la página", () => {
    const out = groupPageRows([a1, sin], "persona", [{ key: "u1", count: 1, cents: 1000 }], lookups);
    expect(out.map((g) => [g.key, g.label, g.count, g.cents])).toEqual([["u1", "Ana", 1, 1000], ["none", "Sin persona", 1, 1000]]);
  });

  it("los títulos de los grupos que no tienen valor se dicen", () => {
    expect(groupLabel("rol", "none", [], lookups)).toBe("Sin rol (ajustes)");
    expect(groupLabel("gasto", "none", [], lookups)).toBe("Sin gasto");
    expect(groupLabel("mes", "2026-10", [], lookups)).toMatch(/octubre/i);
    expect(groupLabel("estado", "pendiente", [], lookups)).toBe("Pendiente");
    expect(groupLabel("producto", "pr1", [], lookups)).toBe("Mentoría");
    expect(groupLabel("producto", "none", [], lookups)).toBe("Sin producto");
  });
});

describe("payoutResultMessage", () => {
  it("dice cuántos gastos y cuánto", () => {
    expect(payoutResultMessage([{ amountCents: 100000 }, { amountCents: 24000 }], [])).toBe("Se generaron 2 gastos (USD 1.240,00).");
    expect(payoutResultMessage([{ amountCents: 5000 }], [])).toBe("Se generó 1 gasto (USD 50,00).");
  });
  it("suma por qué no entraron algunas", () => {
    expect(payoutResultMessage([{ amountCents: 1000 }], [{ message: "Ya está en un gasto" }])).toBe("Se generó 1 gasto (USD 10,00). 1 comisión no entró: ya está en un gasto.");
    expect(payoutResultMessage([], [{ message: "Está anulada" }, { message: "Está anulada" }, { message: "Ya está en un gasto" }])).toBe(
      "No se generó ningún gasto. 3 comisiones no entraron: está anulada; ya está en un gasto.",
    );
  });
});
