/**
 * Un email de marketing de un FLUJO que excede el tope del dia (la guardia de entrega, 00287): no falla ni se pierde.
 *
 * El paso «Enviar email» vuelve `deferred` con la hora (el inicio del dia siguiente del negocio): agenda un
 * `resume_flow` con `rerunNode` a esa hora y la sesion queda dormida en ESE paso. Al dia siguiente el cron la despierta,
 * el MISMO paso se vuelve a correr, el email sale y el flujo sigue con el paso que viene. Con reloj simulado y un espia
 * sobre el envio (el tope real lo decide la base: `verify-email-subscription.mjs`).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { sendTransactionalEmail, recordSkippedEmail } = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(),
  recordSkippedEmail: vi.fn(async () => undefined),
}));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail, recordSkippedEmail }));

import { memoryDb } from "@/lib/agent/testing/memory-db";
import { executeFlow, resumeSession } from "./engine";

const WS = "ws-1";
const TOMORROW = new Date("2026-11-06T06:00:00Z");

const flowRow = (nodes: unknown[], edges: unknown[]) => ({ id: "flow-1", workspace_id: WS, status: "published", nodes, edges, form_id: null, event_type_id: null, template_key: null });

/** Lo que hace `/api/cron/jobs` con un `resume_flow` (route.ts), incluido `rerunNode`. */
async function resumeLikeCron(db: ReturnType<typeof memoryDb>, jobIndex: number) {
  const job = db.rows("scheduled_jobs").filter((j) => j.type === "resume_flow")[jobIndex];
  const payload = job.payload as Record<string, unknown> & { contactId: string | null };
  const session = db.rows("flow_sessions").find((s) => s.id === payload.sessionId)!;
  await resumeSession(
    db.client,
    session as never,
    {
      triggerId: "",
      flowId: session.flow_id as string,
      channelId: payload.channelId as string,
      contactId: payload.contactId,
      conversationId: payload.conversationId as string,
      workspaceId: payload.workspaceId as string,
      variables: (payload.variables as Record<string, string>) || undefined,
      incomingMessage: {},
    },
    "reply",
    { rerunNode: payload.rerunNode === true },
  );
}

function world() {
  return memoryDb({
    flows: [
      flowRow(
        [
          { id: "n-trigger", type: "trigger", data: { triggerType: "keyword" } },
          { id: "n-email", type: "send_email", data: { to: "contact", subject: "Webinar", body: "Hola", category: "marketing" } },
          { id: "n-wait", type: "delay", data: { duration: 1, unit: "hours" } },
        ],
        [
          { id: "e1", source: "n-trigger", target: "n-email" },
          { id: "e2", source: "n-email", target: "n-wait" },
        ],
      ),
    ],
    channels: [],
    conversations: [],
    contacts: [{ id: "c-1", workspace_id: WS, email: "ana@x.test", display_name: "Ana", phone: null, do_not_contact: false }],
    workspaces: [{ id: WS, name: "Negocio" }],
    flow_sessions: [],
    analytics_events: [],
    scheduled_jobs: [],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("flujos: el email que excede el tope sale al dia siguiente", () => {
  it("hoy queda para manana en el MISMO paso; manana sale y el flujo sigue", async () => {
    await import("./registry");
    const db = world();
    sendTransactionalEmail.mockResolvedValueOnce({ ok: false, reason: "deferred", defer: "daily_cap", retryAt: TOMORROW, error: "tope" });

    await executeFlow(db.client, { triggerId: "tr-1", flowId: "flow-1", channelId: "", contactId: "c-1", conversationId: "", workspaceId: WS, incomingMessage: { text: "hola" }, variables: {} });

    // Hoy: un intento, el paso queda dormido con un job a manana que vuelve a correr ESE paso.
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail.mock.calls[0][0]).toMatchObject({ category: "marketing", flowNodeId: "n-email", to: "ana@x.test" });
    const jobs = db.rows("scheduled_jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: "resume_flow", run_at: TOMORROW.toISOString() });
    expect(jobs[0].payload).toMatchObject({ nodeId: "n-email", rerunNode: true, contactId: "c-1" });
    const session = db.rows("flow_sessions")[0];
    expect(session).toMatchObject({ status: "active", current_node_id: "n-email", waiting_until: TOMORROW.toISOString() });
    const events = db.rows("analytics_events").map((e) => e.event_type);
    expect(events).toContain("node_deferred");
    expect(events).not.toContain("node_failed");
    expect(events).not.toContain("node_skipped");

    // Manana: el cron despierta la sesion, el mismo paso se corre de nuevo, el email sale y sigue el "Esperar".
    vi.setSystemTime(new Date("2026-11-06T06:01:00Z"));
    sendTransactionalEmail.mockResolvedValueOnce({ ok: true, id: "re_1" });
    await resumeLikeCron(db, 0);

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
    expect(sendTransactionalEmail.mock.calls[1][0]).toMatchObject({ to: "ana@x.test", subject: "Webinar", category: "marketing" });
    const after = db.rows("scheduled_jobs").filter((j) => j.type === "resume_flow");
    expect(after).toHaveLength(2);
    expect(after[1].payload).toMatchObject({ nodeId: "n-wait" });
    expect(after[1].payload).not.toHaveProperty("rerunNode");
    expect(db.rows("flow_sessions")[0]).toMatchObject({ status: "active", current_node_id: "n-wait" });
  });

  it("a quien ya le mando antes de quedar para despues no le manda de nuevo", async () => {
    await import("./registry");
    const db = memoryDb({
      flows: [
        flowRow(
          [
            { id: "n-trigger", type: "trigger", data: { triggerType: "keyword" } },
            { id: "n-email", type: "send_email", data: { to: "users", userIds: ["u-1", "u-2"], subject: "Aviso", body: "Hola", category: "marketing" } },
          ],
          [{ id: "e1", source: "n-trigger", target: "n-email" }],
        ),
      ],
      contacts: [{ id: "c-1", workspace_id: WS, email: "ana@x.test", display_name: "Ana", do_not_contact: false }],
      workspaces: [{ id: WS, name: "Negocio" }],
      flow_sessions: [],
      analytics_events: [],
      scheduled_jobs: [],
    }, {
      rpc: { workspace_member_profiles: () => [{ user_id: "u-1", email: "uno@n.test" }, { user_id: "u-2", email: "dos@n.test" }] },
    });
    sendTransactionalEmail
      .mockResolvedValueOnce({ ok: true, id: "re_1" })
      .mockResolvedValueOnce({ ok: false, reason: "deferred", defer: "daily_cap", retryAt: TOMORROW, error: "tope" });

    await executeFlow(db.client, { triggerId: "tr-1", flowId: "flow-1", channelId: "", contactId: "c-1", conversationId: "", workspaceId: WS, incomingMessage: {}, variables: {} });
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-11-06T06:01:00Z"));
    sendTransactionalEmail.mockResolvedValueOnce({ ok: true, id: "re_2" });
    await resumeLikeCron(db, 0);

    // Al volver, solo al que faltaba.
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(3);
    expect(sendTransactionalEmail.mock.calls[2][0]).toMatchObject({ to: "dos@n.test" });
    expect(db.rows("flow_sessions")[0]).toMatchObject({ status: "completed" });
  });

  it("caracterizacion: sin `rerunNode`, reanudar sigue con el paso SIGUIENTE como siempre", async () => {
    await import("./registry");
    const db = world();
    // Un "Esperar" comun: se arma a mano el job que dejaria.
    sendTransactionalEmail.mockResolvedValue({ ok: true, id: "re_1" });
    await executeFlow(db.client, { triggerId: "tr-1", flowId: "flow-1", channelId: "", contactId: "c-1", conversationId: "", workspaceId: WS, incomingMessage: {}, variables: {} });
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    // El "Esperar" dejo su job (sin rerunNode): al despertar, la sesion termina (no hay paso despues) y el email NO se repite.
    await resumeLikeCron(db, 0);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(db.rows("flow_sessions")[0]).toMatchObject({ status: "completed" });
  });
});
