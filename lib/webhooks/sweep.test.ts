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
    expect(out).toMatchObject({ cleared: 1, deleted: 1 });
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

describe("sweepInboundRetention: las copias del envío (Tirón 2, C4)", () => {
  const copy = { id: "in-1", endpoint_name: "Typeform", payload: { email: "ana@example.com" }, query: { utm_source: "fb" } };
  const vars = (extra: Record<string, unknown> = {}) => ({ message: "hola", webhook: { ...copy, ...extra } });

  function world() {
    return memoryDb({
      inbound_webhooks: [],
      flow_sessions: [
        { id: "s-vieja-terminada", status: "completed", updated_at: daysAgo(100), variables: vars() },
        { id: "s-vieja-cancelada", status: "cancelled", updated_at: daysAgo(200), variables: vars() },
        { id: "s-vieja-solo-query", status: "completed", updated_at: daysAgo(100), variables: { webhook: { id: "in-9", payload: {}, query: { email: "a@b.com" } } } },
        { id: "s-reciente", status: "completed", updated_at: daysAgo(10), variables: vars() },
        { id: "s-viva", status: "active", updated_at: daysAgo(150), variables: vars() },
        { id: "s-ya-vacia", status: "completed", updated_at: daysAgo(100), variables: { webhook: { id: "in-2", payload: {}, query: {} } } },
        { id: "s-sin-webhook", status: "completed", updated_at: daysAgo(100), variables: { message: "hola" } },
      ],
      scheduled_jobs: [
        { id: "j-viejo", type: "resume_flow", status: "completed", run_at: daysAgo(100), payload: { sessionId: "s-1", variables: vars() } },
        { id: "j-fallido", type: "resume_flow", status: "failed", run_at: daysAgo(100), payload: { sessionId: "s-2", variables: vars() } },
        { id: "j-pendiente", type: "resume_flow", status: "pending", run_at: daysAgo(100), payload: { sessionId: "s-3", variables: vars() } },
        { id: "j-reciente", type: "resume_flow", status: "completed", run_at: daysAgo(5), payload: { sessionId: "s-4", variables: vars() } },
        { id: "j-otro-tipo", type: "send_broadcast", status: "completed", run_at: daysAgo(100), payload: { variables: vars() } },
      ],
    });
  }
  const session = (db: ReturnType<typeof world>, id: string) => db.rows("flow_sessions").find((r) => r.id === id)!;
  const job = (db: ReturnType<typeof world>, id: string) => db.rows("scheduled_jobs").find((r) => r.id === id)!;

  it("vacía la copia de las sesiones TERMINADAS de más de 90 días y de nadie más", async () => {
    const db = world();
    const out = await sweepInboundRetention(db.client, NOW);
    expect(out.sessionCopiesCleared).toBe(3);
    for (const id of ["s-vieja-terminada", "s-vieja-cancelada", "s-vieja-solo-query"]) {
      expect((session(db, id).variables as { webhook: { payload: unknown; query: unknown } }).webhook).toMatchObject({ payload: {}, query: {} });
    }
    // La reciente y la que sigue esperando conservan sus datos: todavía los necesitan.
    expect((session(db, "s-reciente").variables as { webhook: { payload: unknown } }).webhook.payload).toEqual({ email: "ana@example.com" });
    expect((session(db, "s-viva").variables as { webhook: { payload: unknown } }).webhook.payload).toEqual({ email: "ana@example.com" });
  });

  it("de la sesión conserva todo lo demás: el mensaje, el id y el nombre del endpoint", async () => {
    const db = world();
    await sweepInboundRetention(db.client, NOW);
    expect(session(db, "s-vieja-terminada").variables).toEqual({ message: "hola", webhook: { id: "in-1", endpoint_name: "Typeform", payload: {}, query: {} } });
    expect(session(db, "s-sin-webhook").variables).toEqual({ message: "hola" });
  });

  it("vacía el payload de los jobs resume_flow TERMINADOS de más de 90 días (completados o fallidos)", async () => {
    const db = world();
    const out = await sweepInboundRetention(db.client, NOW);
    expect(out.jobCopiesCleared).toBe(2);
    const cleaned = (id: string) => (job(db, id).payload as { variables: { webhook: { payload: unknown; query: unknown } } }).variables.webhook;
    expect(cleaned("j-viejo")).toMatchObject({ payload: {}, query: {} });
    expect(cleaned("j-fallido")).toMatchObject({ payload: {}, query: {} });
    // Un job que todavía va a correr, uno reciente y uno de otro tipo no se tocan.
    expect(cleaned("j-pendiente").payload).toEqual({ email: "ana@example.com" });
    expect(cleaned("j-reciente").payload).toEqual({ email: "ana@example.com" });
    expect(cleaned("j-otro-tipo").payload).toEqual({ email: "ana@example.com" });
    expect((job(db, "j-viejo").payload as { sessionId: string }).sessionId).toBe("s-1");
  });

  it("es idempotente: la segunda corrida no encuentra nada por vaciar", async () => {
    const db = world();
    await sweepInboundRetention(db.client, NOW);
    const again = await sweepInboundRetention(db.client, NOW);
    expect(again).toMatchObject({ sessionCopiesCleared: 0, jobCopiesCleared: 0 });
  });

  it("un fallo al vaciar las sesiones no frena el vaciado de los jobs ni la retención de los envíos", async () => {
    const db = world();
    const realFrom = db.client.from.bind(db.client);
    db.client.from = ((table: string) => {
      if (table === "flow_sessions") throw new Error("base caida");
      return realFrom(table as never);
    }) as never;
    const out = await sweepInboundRetention(db.client, NOW);
    expect(out.sessionCopiesCleared).toBe(0);
    expect(out.jobCopiesCleared).toBe(2);
  });
});
