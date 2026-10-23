/**
 * Caracterizacion de la REANUDACION de un flujo, ANTES de sumar el origen de las automatizaciones
 * (Tiron 2, D1). Reproduce lo que hace `/api/cron/jobs` en `resume_flow`: lee la sesion, y llama a
 * `resumeSession` con el contexto que armo el nodo "Esperar" (contacto o persona, canal, conversacion).
 *
 * Fija lo que el cambio no puede mover para los flujos CON contacto y los de persona del equipo (EOD):
 *  1. Esperar -> el siguiente paso corre y la sesion se completa con su `flow_completed`;
 *  2. Esperar -> "Ir a otro flujo": el padre se cierra y el destino abre SU sesion con el mismo contacto;
 *  3. un flujo de persona del equipo retoma con esa persona y saltea (anotando) un paso que necesita contacto.
 *
 * Sigue en verde despues del cambio: es la red de no-regresion de los flujos que ya existen.
 */
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { executeFlow, resumeSession } from "./engine";

const WS = "ws-1";

const flowRow = (id: string, nodes: unknown[], edges: unknown[]) => ({ id, workspace_id: WS, status: "published", nodes, edges });

/** Lo que hace el cron al despertar un job `resume_flow` (route.ts): la sesion y el contexto del payload. */
async function resumeLikeCron(db: ReturnType<typeof memoryDb>) {
  const job = db.rows("scheduled_jobs").find((j) => j.type === "resume_flow")!;
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
    lateConversationId: undefined,
    lateAccountId: undefined,
    variables: (payload.variables as Record<string, string>) || undefined,
    incomingMessage: {},
  });
}

const trigger = (triggerType: string) => ({ id: "n-trigger", type: "trigger", data: { triggerType } });

describe("reanudar un flujo con contacto (como el cron)", () => {
  it("Esperar -> Ir a otro flujo: el padre se completa y el destino abre su sesion con el mismo contacto", async () => {
    await import("./registry");
    const db = memoryDb({
      flows: [
        flowRow(
          "flow-1",
          [trigger("keyword"), { id: "n-delay", type: "delay", data: { duration: 5, unit: "minutes" } }, { id: "n-go", type: "goToFlow", data: { flowId: "flow-2" } }],
          [
            { id: "e1", source: "n-trigger", target: "n-delay" },
            { id: "e2", source: "n-delay", target: "n-go" },
          ],
        ),
        flowRow(
          "flow-2",
          [trigger("keyword"), { id: "n-wait2", type: "delay", data: { duration: 1, unit: "hours" } }],
          [{ id: "e1", source: "n-trigger", target: "n-wait2" }],
        ),
      ],
      channels: [{ id: "ch-1", platform: "whatsapp", late_account_id: null }],
      conversations: [],
      contacts: [{ id: "c-1", workspace_id: WS }],
      flow_sessions: [],
      analytics_events: [],
      scheduled_jobs: [],
    });
    await executeFlow(db.client, {
      triggerId: "tr-1",
      flowId: "flow-1",
      channelId: "ch-1",
      contactId: "c-1",
      conversationId: "",
      workspaceId: WS,
      incomingMessage: { text: "hola" },
      variables: {},
    });
    expect(db.rows("flow_sessions")).toHaveLength(1);

    await resumeLikeCron(db);

    const sessions = db.rows("flow_sessions");
    expect(sessions).toHaveLength(2);
    const parent = sessions.find((s) => s.flow_id === "flow-1")!;
    const child = sessions.find((s) => s.flow_id === "flow-2")!;
    expect(parent).toMatchObject({ contact_id: "c-1", status: "completed" });
    expect(child).toMatchObject({ contact_id: "c-1", channel_id: "ch-1", status: "active", current_node_id: "n-wait2" });
    // El flujo destino dejo su propio "Esperar" para el mismo contacto.
    const jobs = db.rows("scheduled_jobs").filter((j) => j.type === "resume_flow");
    expect(jobs).toHaveLength(2);
    expect((jobs[1].payload as Record<string, unknown>).contactId).toBe("c-1");
  });

  it("Esperar -> el siguiente paso corre y la sesion termina con flow_completed del contacto", async () => {
    await import("./registry");
    const db = memoryDb({
      flows: [
        flowRow(
          "flow-1",
          [trigger("keyword"), { id: "n-delay", type: "delay", data: { duration: 5, unit: "minutes" } }, { id: "n-delay2", type: "delay", data: { duration: 1, unit: "seconds" } }],
          [
            { id: "e1", source: "n-trigger", target: "n-delay" },
            { id: "e2", source: "n-delay", target: "n-delay2" },
          ],
        ),
      ],
      channels: [{ id: "ch-1", platform: "whatsapp", late_account_id: null }],
      conversations: [],
      contacts: [{ id: "c-1", workspace_id: WS }],
      flow_sessions: [],
      analytics_events: [],
      scheduled_jobs: [],
    });
    await executeFlow(db.client, { triggerId: "tr-1", flowId: "flow-1", channelId: "ch-1", contactId: "c-1", conversationId: "", workspaceId: WS, incomingMessage: { text: "hola" }, variables: {} });
    await resumeLikeCron(db);

    const events = db.rows("analytics_events").map((e) => [e.event_type, e.contact_id]);
    expect(events).toEqual([
      ["flow_started", "c-1"],
      ["node_executed", "c-1"],
      ["node_executed", "c-1"],
    ]);
    // El segundo Esperar volvio a dormir la sesion: sigue activa, con su propio job.
    expect(db.rows("flow_sessions")[0]).toMatchObject({ contact_id: "c-1", status: "active", current_node_id: "n-delay2" });
    expect(db.rows("scheduled_jobs").filter((j) => j.type === "resume_flow")).toHaveLength(2);
  });
});

describe("reanudar un flujo de persona del equipo (EOD, como el cron)", () => {
  it("retoma con la misma persona, saltea el paso que necesita contacto y lo anota", async () => {
    await import("./registry");
    const db = memoryDb({
      flows: [
        flowRow(
          "flow-1",
          [trigger("eod_submitted"), { id: "n-delay", type: "delay", data: { duration: 1, unit: "minutes" } }, { id: "n-tag", type: "action", data: { actionType: "addTag", tagId: "t-1" } }],
          [
            { id: "e1", source: "n-trigger", target: "n-delay" },
            { id: "e2", source: "n-delay", target: "n-tag" },
          ],
        ),
      ],
      channels: [],
      conversations: [],
      flow_sessions: [],
      analytics_events: [],
      scheduled_jobs: [],
    });
    await executeFlow(db.client, { triggerId: "tr-1", flowId: "flow-1", channelId: "", contactId: null, memberUserId: "u-1", conversationId: "", workspaceId: WS, incomingMessage: {}, variables: {} });
    await resumeLikeCron(db);

    const session = db.rows("flow_sessions")[0];
    expect(session).toMatchObject({ contact_id: null, member_user_id: "u-1", status: "completed" });
    const skipped = db.rows("analytics_events").filter((e) => e.event_type === "node_skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ contact_id: null, metadata: { nodeId: "n-tag", nodeType: "addTag" } });
  });
});
