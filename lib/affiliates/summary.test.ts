// @plantilla-quitar(ventas)
import { describe, expect, it } from "vitest";
import { affiliateSummary } from "./summary";

const people = [
  { type: "user" as const, id: "u1", name: "Ana", code: "ana12" },
  { type: "contact" as const, id: "c1", name: "Beto", code: "beto34" },
  { type: "user" as const, id: "u2", name: "Caro", code: "caro56" },
];

describe("el resumen de afiliados", () => {
  it("cuenta referidos vigentes, ventas no canceladas y comisiones, en céntimos", () => {
    const { rows, totals } = affiliateSummary(
      people,
      [
        { affiliate_user_id: "u1", affiliate_contact_id: null, affiliate_kind: "originated", affiliate_expires_at: null },
        { affiliate_user_id: "u1", affiliate_contact_id: null, affiliate_kind: "influenced", affiliate_expires_at: "2026-12-01T00:00:00Z" },
        { affiliate_user_id: "u1", affiliate_contact_id: null, affiliate_kind: "influenced", affiliate_expires_at: "2026-10-01T00:00:00Z" },
        { affiliate_user_id: null, affiliate_contact_id: "c1", affiliate_kind: "originated", affiliate_expires_at: null },
        { affiliate_user_id: "zz", affiliate_contact_id: null, affiliate_kind: "originated", affiliate_expires_at: null },
      ],
      [
        { affiliate_user_id: null, affiliate_contact_id: "c1", status: "paid", final_amount: "1000.10" },
        { affiliate_user_id: null, affiliate_contact_id: "c1", status: "cancelled", final_amount: 500 },
        { affiliate_user_id: "u1", affiliate_contact_id: null, status: "pending", final_amount: 200 },
      ],
      [
        { user_id: null, contact_id: "c1", amount: "100.01", expense_id: null },
        { user_id: null, contact_id: "c1", amount: 50, expense_id: "e1" },
      ],
      "2026-11-08T12:00:00Z",
    );
    expect(rows.map((r) => r.id)).toEqual(["c1", "u1", "u2"]);
    expect(rows[0]).toMatchObject({ leads: 1, originated: 1, sales: 1, salesCents: 100010, commissionsCents: 15001, pendingCents: 10001 });
    expect(rows[1]).toMatchObject({ leads: 2, originated: 1, influenced: 1, sales: 1, salesCents: 20000 });
    expect(rows[2]).toMatchObject({ leads: 0, sales: 0 });
    expect(totals).toEqual({ leads: 3, originated: 2, influenced: 1, sales: 2, salesCents: 120010, commissionsCents: 15001, pendingCents: 10001 });
  });
});
