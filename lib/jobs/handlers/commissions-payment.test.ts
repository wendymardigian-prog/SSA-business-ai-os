import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { handleCommissionsPayment } from "./commissions-payment";

const WS = "11111111-1111-4111-8111-111111111111";
const PAY = "22222222-2222-4222-8222-222222222222";
const SALE = "33333333-3333-4333-8333-333333333333";
const ANA = "44444444-4444-4444-8444-444444444444";
const JUAN = "55555555-5555-4555-8555-555555555555";
const C1 = "66666666-6666-4666-8666-666666666661";
const C2 = "66666666-6666-4666-8666-666666666662";
const C3 = "66666666-6666-4666-8666-666666666663";
let db: MemoryDb;

const world = (rpc: Record<string, (a: Record<string, unknown>) => unknown>) => {
  db = memoryDb(
    {
      commissions: [
        { id: C1, workspace_id: WS, user_id: ANA, amount: 38.82, sale_id: SALE },
        { id: C2, workspace_id: WS, user_id: JUAN, amount: 25, sale_id: SALE },
        { id: C3, workspace_id: WS, user_id: null, amount: 15, sale_id: SALE },
      ],
      sales: [{ id: SALE, contact_id: "c-1" }],
      contacts: [{ id: "c-1", display_name: "Pedro" }],
      payments: [{ id: PAY, workspace_id: WS, sale_id: SALE }],
      notifications: [],
    },
    { rpc },
  );
};
const run = (payload: Record<string, unknown>) => handleCommissionsPayment({ supabase: db.client, job: { id: "j", type: "commissions_payment", payload, attempts: 0 } });
beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

describe("commissions_payment", () => {
  it("generar: avisa a cada persona (no a «Sin persona») con el total de lo suyo", async () => {
    world({ generate_commissions_for_payment: () => ({ created: 3, created_ids: [C1, C2, C3], skipped_roles: [] }) });
    await run({ payment_id: PAY, action: "generate" });
    const notices = db.rows("notifications");
    expect(notices.map((n) => n.recipient_id).sort()).toEqual([ANA, JUAN].sort());
    expect(notices.find((n) => n.recipient_id === ANA)).toMatchObject({ type: "commission_generated", title: "Generaste USD 38,82 en comisiones por la venta de Pedro", entity_type: "commission" });
  });

  it("generar de nuevo dentro de los 10 minutos no repite el aviso (agrupado por persona)", async () => {
    world({ generate_commissions_for_payment: () => ({ created: 1, created_ids: [C1] }) });
    await run({ payment_id: PAY, action: "generate" });
    await run({ payment_id: PAY, action: "generate" });
    expect(db.rows("notifications")).toHaveLength(1);
  });

  it("generar sin nada creado no avisa", async () => {
    world({ generate_commissions_for_payment: () => ({ created: 0, created_ids: [] }) });
    await run({ payment_id: PAY, action: "generate" });
    expect(db.rows("notifications")).toHaveLength(0);
  });

  it("revertir con comisiones ya liquidadas avisa UNA vez a Owner/Admin (sin destinatario)", async () => {
    world({ revert_commissions_for_payment: () => ({ voided: [C2], needs_review: [C1, C3] }) });
    await run({ payment_id: PAY, action: "revert" });
    const notices = db.rows("notifications");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ type: "commission_review_needed", recipient_id: null, workspace_id: WS });
    expect(String(notices[0].title)).toContain("2 comisiones ya liquidadas");
  });

  it("revertir sin nada que revisar no avisa", async () => {
    world({ revert_commissions_for_payment: () => ({ voided: [C1], needs_review: [] }) });
    await run({ payment_id: PAY, action: "revert" });
    expect(db.rows("notifications")).toHaveLength(0);
  });

  it("si la base falla al llamar a la función, LANZA (la cola reintenta); un payload roto se ignora", async () => {
    world({ generate_commissions_for_payment: () => { throw new Error("la base se cayó"); } });
    await expect(run({ payment_id: PAY, action: "generate" })).rejects.toThrow(/no pude generar/);
    await expect(run({ payment_id: "no-es-uuid", action: "generate" })).resolves.toBeUndefined();
    await expect(run({ payment_id: PAY, action: "otra" })).resolves.toBeUndefined();
  });
});
