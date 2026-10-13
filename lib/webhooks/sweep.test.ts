import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { sweepInboundRetention } from "./sweep";

const NOW = new Date("2026-10-12T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("sweepInboundRetention", () => {
  it("vacía el payload a los 90 días, conserva la fila y borra la de más de 365", async () => {
    const db = memoryDb({
      inbound_webhooks: [
        { id: "nuevo", received_at: daysAgo(10), payload: { a: 1 }, query: {} },
        { id: "noventa", received_at: daysAgo(90), payload: { a: 1 }, query: { q: 1 } },
        { id: "ya-vacio", received_at: daysAgo(120), payload: null, query: null },
        { id: "viejo", received_at: daysAgo(366), payload: null, query: null },
      ],
      flow_sessions: [],
    });
    const out = await sweepInboundRetention(db.client, NOW);
    expect(out).toEqual({ cleared: 1, deleted: 1 });
    const rows = db.rows("inbound_webhooks");
    expect(rows.map((r) => r.id).sort()).toEqual(["noventa", "nuevo", "ya-vacio"]);
    expect(rows.find((r) => r.id === "noventa")).toMatchObject({ payload: null, query: null });
    expect(rows.find((r) => r.id === "nuevo")?.payload).toEqual({ a: 1 });
  });

  it("al borrar un envío viejo, borra antes sus sesiones SIN contacto y conserva las que tienen contacto", async () => {
    const db = memoryDb({
      inbound_webhooks: [{ id: "viejo", received_at: daysAgo(400), payload: null, query: null }],
      flow_sessions: [
        { id: "s-sin", inbound_webhook_id: "viejo", contact_id: null, member_user_id: null },
        { id: "s-con", inbound_webhook_id: "viejo", contact_id: "c-1", member_user_id: null },
      ],
    });
    await sweepInboundRetention(db.client, NOW);
    expect(db.rows("flow_sessions").map((s) => s.id)).toEqual(["s-con"]);
    expect(db.rows("inbound_webhooks")).toHaveLength(0);
  });
});
