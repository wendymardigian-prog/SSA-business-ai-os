import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { applyResumeOutcome, settleInboundAfterResume, settleResumedSession } from "./session-result";
import type { FlowResult } from "./types";

const NOW = new Date("2026-10-14T12:00:00Z");
const pending: FlowResult = { status: "pending", flow_name: "Bienvenida", contact_id: "c-1" };

describe("applyResumeOutcome (puro)", () => {
  it("un flujo que termina después de la pausa queda completed con su fecha", () => {
    const out = applyResumeOutcome({ flows: { f1: pending }, flowId: "f1", outcome: { status: "completed" }, now: NOW });
    expect(out.f1).toMatchObject({ status: "completed", flow_name: "Bienvenida", contact_id: "c-1", error: null, finished_at: NOW.toISOString() });
  });

  it("un flujo que falla queda failed con el motivo", () => {
    const out = applyResumeOutcome({ flows: { f1: pending }, flowId: "f1", outcome: { status: "failed", error: "HTTP 500" }, now: NOW });
    expect(out.f1).toMatchObject({ status: "failed", error: "HTTP 500" });
  });

  it("si vuelve a quedar esperando sigue pending y no se fecha como terminado", () => {
    const out = applyResumeOutcome({ flows: { f1: pending }, flowId: "f1", outcome: { status: "pending" }, now: NOW });
    expect(out.f1.status).toBe("pending");
    expect(out.f1.finished_at).toBeNull();
  });

  it("los pasos salteados se suman sin repetir los que ya estaban", () => {
    const flows = { f1: { ...pending, skipped_steps: ["Agregar tag"] } };
    const out = applyResumeOutcome({ flows, flowId: "f1", outcome: { status: "completed" }, skippedSteps: ["Agregar tag", "Enviar mensaje"], now: NOW });
    expect(out.f1.skipped_steps).toEqual(["Agregar tag", "Enviar mensaje"]);
  });

  it("un flujo que no estaba en el resultado (el destino de «Ir a otro flujo») se agrega con su nombre", () => {
    const out = applyResumeOutcome({ flows: { f1: pending }, flowId: "f2", flowName: "Destino", outcome: { status: "failed", error: "x" }, now: NOW });
    expect(Object.keys(out).sort()).toEqual(["f1", "f2"]);
    expect(out.f2).toMatchObject({ flow_name: "Destino", status: "failed" });
  });

  it("no toca los demás flujos ni muta lo que recibe", () => {
    const flows = { f1: pending, f2: { status: "completed" as const } };
    const copy = JSON.parse(JSON.stringify(flows));
    const out = applyResumeOutcome({ flows, flowId: "f1", outcome: { status: "completed" }, now: NOW });
    expect(flows).toEqual(copy);
    expect(out.f2).toEqual({ status: "completed" });
  });

  it("recorta un error larguísimo", () => {
    const out = applyResumeOutcome({ flows: {}, flowId: "f1", outcome: { status: "failed", error: "x".repeat(2000) }, now: NOW });
    expect(out.f1.error?.length).toBe(500);
  });
});

function world(row: Record<string, unknown>) {
  return memoryDb({
    inbound_webhooks: [{ id: "in-1", status: "processed", contact_id: "c-1", error_message: null, result: { flows: { f1: pending }, summary: "1 flujo en curso" }, ...row }],
    flows: [{ id: "f2", name: "Destino" }],
  });
}

describe("settleInboundAfterResume (con la base)", () => {
  it("un flujo retomado que FALLA deja el envío en error con el motivo legible", async () => {
    const db = world({});
    await settleInboundAfterResume(db.client, { inboundId: "in-1", flowId: "f1", outcome: { status: "failed", error: "HTTP 500 en «Llamada HTTP»" }, now: NOW });
    const saved = db.rows("inbound_webhooks")[0];
    expect(saved).toMatchObject({ status: "error", error_message: "HTTP 500 en «Llamada HTTP»" });
    expect((saved.result as { summary: string }).summary).toContain("falló");
  });

  it("un flujo retomado que TERMINA deja de estar «en curso»", async () => {
    const db = world({});
    await settleInboundAfterResume(db.client, { inboundId: "in-1", flowId: "f1", outcome: { status: "completed" }, now: NOW });
    const saved = db.rows("inbound_webhooks")[0];
    expect(saved.status).toBe("processed");
    expect((saved.result as { summary: string }).summary).toBe("1 flujo corrió");
  });

  it("el flujo destino de un «Ir a otro flujo» se agrega con el nombre que tiene en la base", async () => {
    const db = world({});
    await settleInboundAfterResume(db.client, { inboundId: "in-1", flowId: "f2", outcome: { status: "failed", error: "boom" }, now: NOW });
    const flows = (db.rows("inbound_webhooks")[0].result as { flows: Record<string, FlowResult> }).flows;
    expect(flows.f2).toMatchObject({ flow_name: "Destino", status: "failed" });
    expect(flows.f1.status).toBe("pending");
  });

  it("un envío que se está reprocesando (processing) no se toca", async () => {
    const db = world({ status: "processing" });
    await settleInboundAfterResume(db.client, { inboundId: "in-1", flowId: "f1", outcome: { status: "failed", error: "x" }, now: NOW });
    expect(db.rows("inbound_webhooks")[0].status).toBe("processing");
  });

  it("un envío que no existe no lanza", async () => {
    const db = world({});
    await expect(settleInboundAfterResume(db.client, { inboundId: "nope", flowId: "f1", outcome: { status: "completed" }, now: NOW })).resolves.toBeUndefined();
  });

  it("dos flujos del MISMO envío que terminan a la vez: no se pisan", async () => {
    const db = memoryDb({
      inbound_webhooks: [{ id: "in-1", status: "processed", contact_id: null, error_message: null, result: { flows: { f1: { status: "pending" }, f2: { status: "pending" } }, summary: "x" } }],
      flows: [],
    });
    await Promise.all([
      settleInboundAfterResume(db.client, { inboundId: "in-1", flowId: "f1", outcome: { status: "completed" }, now: NOW }),
      settleInboundAfterResume(db.client, { inboundId: "in-1", flowId: "f2", outcome: { status: "failed", error: "se cayó" }, now: NOW }),
    ]);
    const saved = db.rows("inbound_webhooks")[0];
    const flows = (saved.result as { flows: Record<string, FlowResult> }).flows;
    expect(flows.f1.status).toBe("completed");
    expect(flows.f2.status).toBe("failed");
    expect(saved).toMatchObject({ status: "error", error_message: "se cayó" });
  });
});

describe("settleResumedSession (lo que llama el cron)", () => {
  const withSession = (session: Record<string, unknown>) =>
    memoryDb({
      inbound_webhooks: [{ id: "in-1", status: "processed", contact_id: null, error_message: null, result: { flows: { f1: { status: "pending", flow_name: "Bienvenida" } }, summary: "x" } }],
      flows: [],
      flow_sessions: [{ id: "s-1", inbound_webhook_id: "in-1", flow_id: "f1", status: "completed", ...session }],
    });
  const statusOfFlow = (db: ReturnType<typeof withSession>) => (db.rows("inbound_webhooks")[0].result as { flows: Record<string, FlowResult> }).flows.f1;

  it("la sesión terminó: el flujo queda completed", async () => {
    const db = withSession({ status: "completed" });
    await settleResumedSession(db.client, { sessionId: "s-1", now: NOW });
    expect(statusOfFlow(db).status).toBe("completed");
  });

  it("la sesión volvió a esperar: sigue pending", async () => {
    const db = withSession({ status: "active" });
    await settleResumedSession(db.client, { sessionId: "s-1", now: NOW });
    expect(statusOfFlow(db).status).toBe("pending");
  });

  it("la sesión se canceló por dentro: queda failed con un motivo legible", async () => {
    const db = withSession({ status: "cancelled" });
    await settleResumedSession(db.client, { sessionId: "s-1", now: NOW });
    expect(statusOfFlow(db)).toMatchObject({ status: "failed" });
    expect(statusOfFlow(db).error).toContain("el paso donde esperaba ya no existe");
    expect(db.rows("inbound_webhooks")[0].status).toBe("error");
  });

  it("con un motivo de fallo, queda failed con ESE motivo", async () => {
    const db = withSession({ status: "cancelled" });
    await settleResumedSession(db.client, { sessionId: "s-1", failure: "HTTP 503", now: NOW });
    expect(statusOfFlow(db)).toMatchObject({ status: "failed", error: "HTTP 503" });
    expect(db.rows("inbound_webhooks")[0]).toMatchObject({ status: "error", error_message: "HTTP 503" });
  });

  it("una sesión que no es de un webhook no toca nada", async () => {
    const db = withSession({ inbound_webhook_id: null });
    await settleResumedSession(db.client, { sessionId: "s-1", failure: "x", now: NOW });
    expect(db.rows("inbound_webhooks")[0].status).toBe("processed");
  });

  it("una sesión que no existe no lanza", async () => {
    const db = withSession({});
    await expect(settleResumedSession(db.client, { sessionId: "nope", failure: "x", now: NOW })).resolves.toBeUndefined();
  });

  it("los pasos salteados después de la pausa quedan en el resultado", async () => {
    const db = withSession({ status: "completed" });
    await settleResumedSession(db.client, { sessionId: "s-1", skippedSteps: ["Agregar tag"], now: NOW });
    expect(statusOfFlow(db).skipped_steps).toEqual(["Agregar tag"]);
  });
});
