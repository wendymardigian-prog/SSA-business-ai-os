/**
 * El ORIGEN de una automatización (Tirón 2, D1): una sesión sin contacto sabe qué la disparó, y una reanudación
 * (el cron después de un «Esperar») lo conserva. Antes el job de «Esperar» no mandaba el envío de webhook: el flujo
 * que arrancaba «Ir a otro flujo» después de una espera, en un flujo sin contacto, abría una sesión sin contacto,
 * sin persona y sin envío; la base la rechazaba y el flujo destino no corría, sin avisar.
 *
 * La memoria no tiene CHECK: `satisfiesSessionCheck` repite la regla de la 00218 (contacto, persona, envío u origen).
 */
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { executeFlow, resumeSession, restoreOriginFromSession } from "./engine";

const WS = "ws-1";
type Row = Record<string, unknown>;

const flowRow = (id: string, nodes: unknown[], edges: unknown[]) => ({ id, workspace_id: WS, status: "published", nodes, edges });
const trigger = (triggerType: string) => ({ id: "n-trigger", type: "trigger", data: { triggerType } });

/** La regla del CHECK `flow_sessions_contact_or_source` (00218). */
const satisfiesSessionCheck = (s: Row) => !!(s.contact_id || s.member_user_id || s.inbound_webhook_id || s.source_type);

/** Lo que hace el cron al despertar un `resume_flow`: lee la sesión y arma el contexto SOLO con lo que trae el job. */
async function resumeLikeCron(db: ReturnType<typeof memoryDb>, which = 0) {
  const job = db.rows("scheduled_jobs").filter((j) => j.type === "resume_flow")[which];
  const payload = job.payload as Record<string, unknown> & { contactId: string | null; memberUserId?: string | null };
  const session = db.rows("flow_sessions").find((s) => s.id === payload.sessionId)!;
  await resumeSession(db.client, session as never, {
    triggerId: "",
    flowId: session.flow_id as string,
    channelId: payload.channelId as string,
    contactId: payload.contactId,
    memberUserId: (session.member_user_id as string | null) ?? payload.memberUserId ?? null,
    conversationId: payload.conversationId as string,
    workspaceId: payload.workspaceId as string,
    variables: (payload.variables as Record<string, string>) || undefined,
    incomingMessage: {},
  });
}

function webhookWorld() {
  return memoryDb({
    flows: [
      flowRow(
        "flow-a",
        [trigger("webhook_received"), { id: "n-wait", type: "delay", data: { duration: 5, unit: "minutes" } }, { id: "n-go", type: "goToFlow", data: { flowId: "flow-b" } }],
        [
          { id: "e1", source: "n-trigger", target: "n-wait" },
          { id: "e2", source: "n-wait", target: "n-go" },
        ],
      ),
      flowRow(
        "flow-b",
        [
          trigger("webhook_received"),
          { id: "n-tag", type: "action", data: { actionType: "addTag", tagId: "t-1" } },
          { id: "n-wait2", type: "delay", data: { duration: 1, unit: "hours" } },
        ],
        [
          { id: "e1", source: "n-trigger", target: "n-tag" },
          { id: "e2", source: "n-tag", target: "n-wait2" },
        ],
      ),
    ],
    channels: [],
    conversations: [],
    flow_sessions: [],
    analytics_events: [],
    scheduled_jobs: [],
  });
}

const startWebhookFlow = async (db: ReturnType<typeof memoryDb>) => {
  await import("./registry");
  await executeFlow(db.client, {
    triggerId: "tr-1",
    flowId: "flow-a",
    channelId: "",
    contactId: null,
    inboundWebhookId: "in-1",
    source: { type: "webhook", id: "in-1" },
    conversationId: "",
    workspaceId: WS,
    incomingMessage: {},
    variables: { webhook: { id: "in-1", payload: { email: "ana@example.com" }, query: {} } },
  });
};

describe("webhook sin contacto → Esperar → Ir a otro flujo", () => {
  it("la sesión nace con su origen: el envío que la disparó", async () => {
    const db = webhookWorld();
    await startWebhookFlow(db);
    const [session] = db.rows("flow_sessions");
    expect(session).toMatchObject({ contact_id: null, member_user_id: null, inbound_webhook_id: "in-1", source_type: "webhook", source_id: "in-1" });
    expect(satisfiesSessionCheck(session)).toBe(true);
  });

  it("el flujo destino arranca y corre sus pasos sin contacto (saltea el que lo necesita, corre el que no)", async () => {
    const db = webhookWorld();
    await startWebhookFlow(db);
    await resumeLikeCron(db);

    const sessions = db.rows("flow_sessions");
    expect(sessions).toHaveLength(2);
    const parent = sessions.find((s) => s.flow_id === "flow-a")!;
    const child = sessions.find((s) => s.flow_id === "flow-b")!;
    expect(parent.status).toBe("completed");

    // La sesión nueva no quedó huérfana: lleva el envío y el origen del padre, y la base la hubiera aceptado.
    expect(child).toMatchObject({ contact_id: null, inbound_webhook_id: "in-1", source_type: "webhook", source_id: "in-1", status: "active", current_node_id: "n-wait2" });
    expect(sessions.every(satisfiesSessionCheck)).toBe(true);

    // «Agregar tag» necesita contacto: se saltea y se anota. El «Esperar» del destino SÍ corrió (dejó su job).
    const skipped = db.rows("analytics_events").filter((e) => e.event_type === "node_skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ contact_id: null, flow_id: "flow-b", metadata: { nodeId: "n-tag", nodeType: "addTag" } });
    expect(db.rows("scheduled_jobs").filter((j) => j.type === "resume_flow")).toHaveLength(2);
  });

  it("la segunda espera (la del flujo destino) también se reanuda con el origen y termina la sesión", async () => {
    const db = webhookWorld();
    await startWebhookFlow(db);
    await resumeLikeCron(db, 0);
    await resumeLikeCron(db, 1);
    const child = db.rows("flow_sessions").find((s) => s.flow_id === "flow-b")!;
    expect(child.status).toBe("completed");
    expect(child).toMatchObject({ inbound_webhook_id: "in-1", source_type: "webhook" });
  });
});

describe("restoreOriginFromSession", () => {
  const session = { contact_id: null, member_user_id: null, inbound_webhook_id: "in-9", source_type: "webhook", source_id: "in-9" };
  const context = (over: Record<string, unknown> = {}) =>
    ({ triggerId: "", flowId: "f", channelId: "", contactId: null, conversationId: "", workspaceId: WS, incomingMessage: {}, ...over }) as never;

  it("completa lo que el job no trae: el envío y el origen", () => {
    const c = context();
    restoreOriginFromSession(c, session);
    expect(c).toMatchObject({ inboundWebhookId: "in-9", source: { type: "webhook", id: "in-9" } });
  });

  it("nunca pisa lo que quien reanuda ya sabía", () => {
    const c = context({ inboundWebhookId: "in-OTRO", source: { type: "system", id: "x" }, contactId: "c-1" });
    restoreOriginFromSession(c, { ...session, contact_id: "c-2" });
    expect(c).toMatchObject({ inboundWebhookId: "in-OTRO", source: { type: "system", id: "x" }, contactId: "c-1" });
  });

  it("una sesión con contacto (la de siempre) no cambia nada de lo que ya traía el contexto", () => {
    const c = context({ contactId: "c-1" });
    restoreOriginFromSession(c, { contact_id: "c-1", member_user_id: null, inbound_webhook_id: null, source_type: null, source_id: null });
    expect(c).toMatchObject({ contactId: "c-1" });
    expect((c as { source?: unknown }).source).toBeUndefined();
    expect((c as { inboundWebhookId?: unknown }).inboundWebhookId).toBeNull();
  });

  it("una sesión de una persona del equipo recupera a la persona", () => {
    const c = context();
    restoreOriginFromSession(c, { contact_id: null, member_user_id: "u-1", inbound_webhook_id: null, source_type: "member", source_id: "ev-1" });
    expect(c).toMatchObject({ memberUserId: "u-1", source: { type: "member", id: "ev-1" } });
  });
});

describe("el origen declarado viaja a la sesión y la hereda «Ir a otro flujo»", () => {
  it("un flujo de sistema arranca sin contacto ni persona y guarda su origen; el flujo al que salta lo hereda", async () => {
    await import("./registry");
    const db = memoryDb({
      flows: [
        flowRow("flow-a", [trigger("t"), { id: "n-go", type: "goToFlow", data: { flowId: "flow-b" } }], [{ id: "e1", source: "n-trigger", target: "n-go" }]),
        flowRow("flow-b", [trigger("t"), { id: "n-w", type: "delay", data: { duration: 1, unit: "minutes" } }], [{ id: "e1", source: "n-trigger", target: "n-w" }]),
      ],
      channels: [],
      conversations: [],
      flow_sessions: [],
      analytics_events: [],
      scheduled_jobs: [],
    });
    await executeFlow(db.client, {
      triggerId: "tr-1",
      flowId: "flow-a",
      channelId: "",
      contactId: null,
      source: { type: "system", id: "ev-77" },
      conversationId: "",
      workspaceId: WS,
      incomingMessage: {},
      variables: {},
    });
    const sessions = db.rows("flow_sessions");
    expect(sessions).toHaveLength(2);
    for (const s of sessions) expect(s).toMatchObject({ contact_id: null, source_type: "system", source_id: "ev-77" });
    expect(sessions.every(satisfiesSessionCheck)).toBe(true);
  });

  it("sin origen declarado el motor no inventa uno: lo completa la base (el flujo de siempre no cambia)", async () => {
    await import("./registry");
    const db = memoryDb({
      flows: [flowRow("flow-a", [trigger("keyword"), { id: "n-w", type: "delay", data: { duration: 1, unit: "minutes" } }], [{ id: "e1", source: "n-trigger", target: "n-w" }])],
      channels: [{ id: "ch-1", platform: "whatsapp", late_account_id: null }],
      conversations: [],
      flow_sessions: [],
      analytics_events: [],
      scheduled_jobs: [],
    });
    await executeFlow(db.client, { triggerId: "tr-1", flowId: "flow-a", channelId: "ch-1", contactId: "c-1", conversationId: "", workspaceId: WS, incomingMessage: { text: "hola" }, variables: {} });
    const [session] = db.rows("flow_sessions");
    expect(session).not.toHaveProperty("source_type");
    expect(session).not.toHaveProperty("source_id");
  });
});
