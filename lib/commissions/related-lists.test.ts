import { describe, expect, it } from "vitest";
import { classifyRows, type ExpenseRef, type LightCommission, type SaleLink } from "./list-model";
import { buildRelatedCommissions, relatedTitle } from "./related-lists";

const TODAY = "2026-10-15";
let n = 0;
const row = (patch: Partial<LightCommission> = {}): LightCommission => {
  n += 1;
  return {
    id: `c${n}`, kind: "earned", role: "vendedor", user_id: "u1", payment_id: "p", sale_id: "s1", rule_id: "r", amount: 10, base_amount: 100,
    paid_on: "2026-10-10", available_on: "2026-10-10", expense_id: null, voided_at: null, created_at: `2026-10-10T10:00:0${n % 10}Z`, ...patch,
  };
};
const expenses = new Map<string, ExpenseRef>([["e1", { expense_id: "e1", status: "programado", scheduled_date: "2026-11-05", paid_date: null }]]);
const sales = new Map<string, SaleLink>([["s1", { contact_id: "k1", product_id: "pr1" }]]);
const names = {
  people: new Map([["u1", "Ana"], ["u2", "Beto"]]),
  roles: new Map([["vendedor", "Vendedor"], ["setter", "Setter"]]),
  contacts: new Map([["k1", "Lucía Pérez"]]),
};

describe("buildRelatedCommissions", () => {
  const classified = classifyRows(
    [
      row({ id: "anul", voided_at: "2026-10-11T00:00:00Z", amount: 99, created_at: "2026-10-10T10:00:00Z" }),
      row({ id: "b", user_id: "u2", role: "setter", amount: 5.5, expense_id: "e1", created_at: "2026-10-10T10:00:04Z" }),
      row({ id: "a", amount: 38.82, created_at: "2026-10-10T10:00:01Z" }),
      row({ id: "sinp", user_id: null, role: "contenido", amount: 15, created_at: "2026-10-10T10:00:02Z" }),
      row({ id: "adj", kind: "adjustment", role: null, amount: -4, sale_id: null, created_at: "2026-10-10T10:00:03Z" }),
    ],
    expenses,
    sales,
    TODAY,
  );
  const list = buildRelatedCommissions(classified, names);

  it("pone las vivas primero, en el orden en que se generaron, y las anuladas al final", () => {
    expect(list.items.map((i) => i.id)).toEqual(["a", "sinp", "adj", "b", "anul"]);
  });

  it("suma solo las que no están anuladas, con el ajuste negativo restando", () => {
    expect(list.totalCents).toBe(550 + 3882 + 1500 - 400);
    expect(list.liveCount).toBe(4);
  });

  it("traduce persona, rol y contacto, y deja el estado y el detalle del gasto", () => {
    const b = list.items.find((i) => i.id === "b")!;
    expect(b).toMatchObject({ personName: "Beto", roleName: "Setter", contactName: "Lucía Pérez", statusKey: "en_gasto", statusDetail: "Programado 5/11", voided: false });
    const sinp = list.items.find((i) => i.id === "sinp")!;
    expect(sinp).toMatchObject({ personName: null, roleName: "contenido", statusKey: "sin_persona" });
    expect(list.items.find((i) => i.id === "anul")?.voided).toBe(true);
  });

  it("una lista vacía suma cero", () => {
    expect(buildRelatedCommissions([], names)).toEqual({ items: [], totalCents: 0, liveCount: 0 });
  });
});

describe("relatedTitle", () => {
  it("dice quién y qué: rol, ajuste o sin persona", () => {
    expect(relatedTitle({ personName: "Ana", roleName: "Vendedor", kind: "earned" })).toBe("Ana — Vendedor");
    expect(relatedTitle({ personName: "Ana", roleName: null, kind: "adjustment" })).toBe("Ana — Ajuste");
    expect(relatedTitle({ personName: null, roleName: "Contenido", kind: "earned" })).toBe("Sin persona — Contenido");
    expect(relatedTitle({ personName: null, roleName: null, kind: "earned" })).toBe("Sin persona");
  });
});
