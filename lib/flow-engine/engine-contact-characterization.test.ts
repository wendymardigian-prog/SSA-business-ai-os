/**
 * Caracterizacion del motor ANTES de los flujos de webhook (Extra L, WH2).
 *
 * Fija tres comportamientos que el cambio no puede mover:
 *  1. un flujo disparado por un mensaje, con contacto, crea su sesion con ese
 *     contacto, siembra `{{message}}` y deja el contacto en el payload del
 *     job de "Esperar";
 *  2. un flujo de persona del equipo (EOD) arranca con `member_user_id`, sin
 *     contacto, y un paso que necesita contacto se saltea y se anota
 *     (`node_skipped`) en lugar de cortar la sesion;
 *  3. `memberFlowProblems` rechaza lo mismo que hoy en un flujo de EOD.
 *
 * Sigue en verde despues del cambio: es la red de no-regresion de §12.5.
 */
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { executeFlow } from "./engine";
import { memberFlowProblems } from "./member-flow";

const WS = "ws-1";

function flowRow(nodes: unknown[], edges: unknown[]) {
  return { id: "flow-1", workspace_id: WS, status: "published", nodes, edges };
}

describe("flujo disparado por un mensaje, con contacto", () => {
  it("crea la sesion con el contacto, siembra {{message}} y el Esperar lleva el contacto", async () => {
    await import("./registry");
    const db = memoryDb({
      flows: [
        flowRow(
          [
            { id: "n-trigger", type: "trigger", data: { triggerType: "keyword" } },
            { id: "n-delay", type: "delay", data: { duration: 5, unit: "minutes" } },
          ],
          [{ id: "e1", source: "n-trigger", target: "n-delay" }],
        ),
      ],
      channels: [{ id: "ch-1", platform: "whatsapp", late_account_id: null }],
      conversations: [],
      contacts: [{ id: "c-1", workspace_id: WS }],
      flow_sessions: [],
      analytics_events: [],
      scheduled_jobs: [],
    });
    const context = {
      triggerId: "tr-1",
      flowId: "flow-1",
      channelId: "ch-1",
      contactId: "c-1",
      conversationId: "",
      workspaceId: WS,
      incomingMessage: { text: "hola precio" },
      variables: {} as Record<string, unknown>,
    };
    await executeFlow(db.client, context);

    expect(context.variables.message).toBe("hola precio");
    const sessions = db.rows("flow_sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ contact_id: "c-1", channel_id: "ch-1", flow_id: "flow-1", status: "active", current_node_id: "n-delay" });
    expect(db.rows("analytics_events").map((e) => [e.event_type, e.contact_id])).toEqual([
      ["flow_started", "c-1"],
      ["node_executed", "c-1"],
    ]);
    const job = db.rows("scheduled_jobs")[0];
    expect(job).toMatchObject({ type: "resume_flow" });
    expect((job.payload as Record<string, unknown>).contactId).toBe("c-1");
  });
});

describe("flujo de persona del equipo (sin contacto)", () => {
  it("arranca con member_user_id y saltea un paso que necesita contacto, anotandolo", async () => {
    await import("./registry");
    const db = memoryDb({
      flows: [
        flowRow(
          [
            { id: "n-trigger", type: "trigger", data: { triggerType: "eod_submitted" } },
            { id: "n-tag", type: "action", data: { actionType: "addTag", tagId: "t-1" } },
            { id: "n-delay", type: "delay", data: { duration: 1, unit: "minutes" } },
          ],
          [
            { id: "e1", source: "n-trigger", target: "n-tag" },
            { id: "e2", source: "n-tag", target: "n-delay" },
          ],
        ),
      ],
      channels: [],
      conversations: [],
      flow_sessions: [],
      analytics_events: [],
      scheduled_jobs: [],
    });
    await executeFlow(db.client, {
      triggerId: "tr-1",
      flowId: "flow-1",
      channelId: "",
      contactId: null,
      memberUserId: "u-1",
      conversationId: "",
      workspaceId: WS,
      incomingMessage: {},
      variables: {},
    });

    const sessions = db.rows("flow_sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ contact_id: null, member_user_id: "u-1", status: "active", current_node_id: "n-delay" });
    const skipped = db.rows("analytics_events").filter((e) => e.event_type === "node_skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ contact_id: null, metadata: { nodeId: "n-tag", nodeType: "addTag" } });
    const job = db.rows("scheduled_jobs")[0];
    expect(job).toMatchObject({ type: "resume_flow" });
    expect((job.payload as Record<string, unknown>).contactId).toBeNull();
    expect((job.payload as Record<string, unknown>).memberUserId).toBe("u-1");
  });
});

// @plantilla-desde(formularios)
describe("memberFlowProblems (validacion de EOD)", () => {
  const trigger = { id: "n-trigger", type: "trigger", data: { triggerType: "eod_submitted" } };

  it("un flujo de EOD con un paso que necesita contacto se rechaza", () => {
    const problems = memberFlowProblems([trigger, { id: "n-msg", type: "sendMessage", data: {} }] as never);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("un flujo de EOD con pasos que no necesitan contacto es valido", () => {
    const problems = memberFlowProblems([trigger, { id: "n-delay", type: "delay", data: {} }] as never);
    expect(problems).toEqual([]);
  });

  it("un flujo con contacto no se valida contra esta regla", () => {
    const problems = memberFlowProblems([{ id: "n-trigger", type: "trigger", data: { triggerType: "keyword" } }, { id: "n-msg", type: "sendMessage", data: {} }] as never);
    expect(problems).toEqual([]);
  });
});
// @plantilla-hasta(formularios)
