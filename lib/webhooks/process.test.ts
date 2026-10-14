import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { processInbound, reprocessInbound } from "./process";
import { reapInboundWebhooks } from "./reaper";
import type { RunFlows } from "./run-flows";

const WS = "ws-1";
const NOW = new Date("2026-10-12T12:00:00Z");

function world(inbound: Record<string, unknown>[] = []) {
  return memoryDb({
    webhook_endpoints: [{ id: "ep-1", workspace_id: WS, name: "Typeform", created_by: "u-1", last_error_alert_at: null }],
    inbound_webhooks: inbound,
    notifications: [],
    workspace_members: [],
  });
}

const received = (over: Record<string, unknown> = {}) => ({
  id: "in-1", workspace_id: WS, endpoint_id: "ep-1", status: "received", payload: { email: "a@b.com" }, query: {},
  received_at: "2026-10-12T11:50:00Z", reprocess_count: 0, ...over,
});

describe("processInbound", () => {
  it("sin flujos que lo escuchen queda processed con el motivo", async () => {
    const db = world([received()]);
    const out = await processInbound(db.client, "in-1", { now: () => NOW });
    expect(out).toEqual({ kind: "processed", status: "processed" });
    expect(db.rows("inbound_webhooks")[0]).toMatchObject({ status: "processed", result: { flows: {}, summary: "Ningún flujo publicado escucha este webhook" } });
  });

  it("corre los flujos una sola vez: el claim received -> processing", async () => {
    const db = world([received()]);
    const runFlows: RunFlows = vi.fn(async () => ({ f1: { status: "completed" as const, contact_id: "c-1" } }));
    const [a, b] = await Promise.all([
      processInbound(db.client, "in-1", { runFlows, now: () => NOW }),
      processInbound(db.client, "in-1", { runFlows, now: () => NOW }),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["not_claimed", "processed"]);
    expect(runFlows).toHaveBeenCalledTimes(1);
    expect(db.rows("inbound_webhooks")[0]).toMatchObject({ status: "processed", contact_id: "c-1" });
  });

  it("si un flujo falla el envio queda error con el motivo, sin lanzar", async () => {
    const db = world([received()]);
    const runFlows: RunFlows = async () => ({ f1: { status: "failed", error: "HTTP 500" } });
    const out = await processInbound(db.client, "in-1", { runFlows, now: () => NOW });
    expect(out).toEqual({ kind: "processed", status: "error" });
    expect(db.rows("inbound_webhooks")[0]).toMatchObject({ status: "error", error_message: "HTTP 500" });
  });

  it("si el procesamiento revienta, queda error para poder reprocesar", async () => {
    const db = world([received()]);
    const runFlows: RunFlows = async () => { throw new Error("se cayo"); };
    await processInbound(db.client, "in-1", { runFlows, now: () => NOW });
    expect(db.rows("inbound_webhooks")[0]).toMatchObject({ status: "error", error_message: "se cayo" });
  });

  it("no toca un envio que no esta received", async () => {
    const db = world([received({ status: "paused" })]);
    expect((await processInbound(db.client, "in-1")).kind).toBe("not_claimed");
    expect(db.rows("inbound_webhooks")[0].status).toBe("paused");
  });
});

describe("reprocessInbound", () => {
  it("incrementa el contador y corre otra vez; un doble clic corre una sola vez", async () => {
    const db = world([received({ status: "error", reprocess_count: 0 })]);
    const runFlows: RunFlows = vi.fn(async () => ({}));
    const [a, b] = await Promise.all([
      reprocessInbound(db.client, "in-1", 0, { runFlows, now: () => NOW }),
      reprocessInbound(db.client, "in-1", 0, { runFlows, now: () => NOW }),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["not_claimed", "processed"]);
    expect(runFlows).toHaveBeenCalledTimes(1);
    expect(db.rows("inbound_webhooks")[0]).toMatchObject({ reprocess_count: 1, status: "processed" });
  });

  it("recibe el numero de reproceso en el envio que le pasa a los flujos", async () => {
    const db = world([received({ status: "processed", reprocess_count: 2 })]);
    const runFlows: RunFlows = vi.fn(async () => ({}));
    await reprocessInbound(db.client, "in-1", 2, { runFlows, now: () => NOW });
    expect((runFlows as ReturnType<typeof vi.fn>).mock.calls[0][0].inbound.reprocess_count).toBe(3);
  });

  it("la casilla «volver a correr también los flujos que ya corrieron» viaja a los flujos y está apagada por defecto", async () => {
    const db = world([received({ status: "processed", reprocess_count: 0 })]);
    const runFlows: RunFlows = vi.fn(async () => ({}));
    await reprocessInbound(db.client, "in-1", 0, { runFlows, now: () => NOW });
    expect((runFlows as ReturnType<typeof vi.fn>).mock.calls[0][0].rerunCompleted).toBeFalsy();

    await reprocessInbound(db.client, "in-1", 1, { runFlows, now: () => NOW, rerunCompleted: true });
    expect((runFlows as ReturnType<typeof vi.fn>).mock.calls[1][0].rerunCompleted).toBe(true);
  });

  it("lo que ya se sabía de otros flujos NO se pierde: se fusiona con lo que corrió ahora", async () => {
    const before = { flows: { f1: { status: "completed", flow_name: "Bienvenida", contact_id: "c-1" } }, summary: "1 flujo corrió" };
    const db = world([received({ status: "processed", result: before })]);
    // Ahora solo corre el flujo nuevo (f2): f1 ya había corrido y no se repite.
    const runFlows: RunFlows = async () => ({ f2: { status: "completed", flow_name: "Aviso", contact_id: "c-1" } });
    await reprocessInbound(db.client, "in-1", 0, { runFlows, now: () => NOW });
    const saved = db.rows("inbound_webhooks")[0];
    expect(Object.keys((saved.result as { flows: object }).flows).sort()).toEqual(["f1", "f2"]);
    expect((saved.result as { summary: string }).summary).toBe("2 flujos corrieron");
    expect(saved.status).toBe("processed");
  });

  it("un flujo que fallaba y ahora anduvo reemplaza a su propia entrada: el envío deja de estar en error", async () => {
    const before = { flows: { f1: { status: "failed", error: "base caida" } }, summary: "x" };
    const db = world([received({ status: "error", error_message: "base caida", result: before })]);
    const runFlows: RunFlows = async () => ({ f1: { status: "completed", contact_id: "c-1" } });
    await reprocessInbound(db.client, "in-1", 0, { runFlows, now: () => NOW });
    expect(db.rows("inbound_webhooks")[0]).toMatchObject({ status: "processed", error_message: null, contact_id: "c-1" });
  });

  it("un envio cuyo payload ya se vacio no se puede reprocesar", async () => {
    const db = world([received({ status: "error", payload: null })]);
    expect((await reprocessInbound(db.client, "in-1", 0)).kind).toBe("no_payload");
  });

  it("uno que no existe", async () => {
    expect((await reprocessInbound(world().client, "nope", 0)).kind).toBe("not_found");
  });
});

describe("reapInboundWebhooks", () => {
  it("procesa una sola vez los received viejos y no toca los recientes", async () => {
    const db = world([
      received({ id: "viejo", received_at: "2026-10-12T11:50:00Z" }),
      received({ id: "reciente", received_at: "2026-10-12T11:59:30Z" }),
    ]);
    const first = await reapInboundWebhooks(db.client, NOW);
    expect(first.processed).toBe(1);
    const status = (id: string) => db.rows("inbound_webhooks").find((r) => r.id === id)?.status;
    expect(status("viejo")).toBe("processed");
    expect(status("reciente")).toBe("received");
    // Una segunda pasada no vuelve a procesar el que ya esta.
    expect((await reapInboundWebhooks(db.client, NOW)).processed).toBe(0);
  });

  it("un processing colgado se marca error y NO se vuelve a correr", async () => {
    const db = world([received({ id: "colgado", status: "processing", processing_started_at: "2026-10-12T11:30:00Z" })]);
    const out = await reapInboundWebhooks(db.client, NOW);
    expect(out.recovered).toBe(1);
    expect(db.rows("inbound_webhooks")[0]).toMatchObject({ status: "error" });
  });
});
