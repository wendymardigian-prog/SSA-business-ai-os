/**
 * Auditoria de automatizaciones (oct 2026): los bugs graves del motor, cada uno con el caso que lo prueba.
 */
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { executeFlow, resumeSession } from "./engine";
import { registerNode } from "./registry";
import { pickSplitIndex } from "./nodes/ab-split";
import { delayRunAt, waitTimeoutMs } from "./nodes/delay";
import { handleFlowWaitTimeout } from "@/lib/jobs/handlers/flow-wait-timeout";

const WS = "ws-1";
const ran: string[] = [];
registerNode({
  type: "zzAuditMarker",
  label: "Marcador",
  needsContact: false,
  execute: ({ node }) => {
    ran.push(node.id);
  },
});

const trigger = { id: "t", type: "trigger", data: { triggerType: "crm_event" } };
const flow = (id: string, nodes: unknown[], edges: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  workspace_id: WS,
  status: "published",
  nodes: [trigger, ...nodes],
  edges,
  ...extra,
});

const baseContext = (flowId: string) => ({
  triggerId: "tr-1",
  flowId,
  channelId: "ch-1",
  contactId: "c-1",
  conversationId: "cv-1",
  workspaceId: WS,
  incomingMessage: {},
  variables: {},
});

describe("un evento no secuestra una sesion en 'Esperar respuesta'", () => {
  it("arranca SU flujo aunque el contacto tenga otra automatizacion esperando en el mismo canal", async () => {
    ran.length = 0;
    const db = memoryDb({
      flows: [flow("flow-evento", [{ id: "m-evento", type: "zzAuditMarker", data: {} }], [{ id: "e1", source: "t", target: "m-evento" }])],
      channels: [{ id: "ch-1", platform: "instagram", late_account_id: null }],
      conversations: [],
      flow_sessions: [
        { id: "ses-vieja", flow_id: "flow-otro", contact_id: "c-1", channel_id: "ch-1", status: "active", waiting_for_input: true, current_node_id: "espera" },
      ],
      analytics_events: [],
    });
    await executeFlow(db.client, baseContext("flow-evento"));
    expect(ran).toEqual(["m-evento"]);
    // La sesion vieja sigue esperando, intacta.
    expect(db.rows("flow_sessions").find((s) => s.id === "ses-vieja")).toMatchObject({ status: "active", waiting_for_input: true });
  });
});

describe("A/B split", () => {
  it("sigue por la salida `split-N` que dibuja el lienzo", async () => {
    ran.length = 0;
    const db = memoryDb({
      flows: [
        flow(
          "flow-ab",
          [
            { id: "ab", type: "action", data: { actionType: "abSplit", paths: [{ name: "A", weight: 0 }, { name: "B", weight: 100 }] } },
            { id: "m-a", type: "zzAuditMarker", data: {} },
            { id: "m-b", type: "zzAuditMarker", data: {} },
          ],
          [
            { id: "e1", source: "t", target: "ab" },
            { id: "e2", source: "ab", sourceHandle: "split-0", target: "m-a" },
            { id: "e3", source: "ab", sourceHandle: "split-1", target: "m-b" },
          ],
        ),
      ],
      channels: [],
      conversations: [],
      flow_sessions: [],
      analytics_events: [],
    });
    await executeFlow(db.client, baseContext("flow-ab"));
    expect(ran).toEqual(["m-b"]);
  });

  it("pickSplitIndex: sin caminos es null; pesos invalidos no cuentan; todos invalidos reparten parejo", () => {
    expect(pickSplitIndex([])).toBeNull();
    expect(pickSplitIndex(undefined)).toBeNull();
    expect(pickSplitIndex([{ name: "A", weight: -5 }, { name: "B", weight: 10 }], 0.01)).toBe(1);
    expect(pickSplitIndex([{ name: "A", weight: 0 }, { name: "B", weight: 0 }], 0.99)).toBe(1);
    expect(pickSplitIndex([{ name: "A", weight: 50 }, { name: "B", weight: 50 }], 0.2)).toBe(0);
  });
});

describe("retomar 'Esperar respuesta' es un reclamo", () => {
  it("dos mensajes que llegan juntos: el resto del flujo corre UNA vez", async () => {
    ran.length = 0;
    const session = { id: "ses-1", flow_id: "flow-w", contact_id: "c-1", channel_id: "ch-1", status: "active", waiting_for_input: true, current_node_id: "espera", variables: {} };
    const db = memoryDb({
      flows: [
        flow(
          "flow-w",
          [
            { id: "espera", type: "smartDelay", data: {} },
            { id: "m-despues", type: "zzAuditMarker", data: {} },
          ],
          [
            { id: "e1", source: "t", target: "espera" },
            { id: "e2", source: "espera", target: "m-despues" },
          ],
        ),
      ],
      channels: [{ id: "ch-1", platform: "instagram", late_account_id: null }],
      conversations: [],
      flow_sessions: [session],
      analytics_events: [],
    });
    const ctx = { ...baseContext("flow-w"), incomingMessage: { text: "hola" } };
    // Los dos leyeron la sesion esperando antes de que el otro la tome.
    await Promise.all([resumeSession(db.client, { ...session } as never, ctx), resumeSession(db.client, { ...session } as never, { ...ctx })]);
    expect(ran).toEqual(["m-despues"]);
  });

  it("una sesion de un flujo despublicado se cancela en vez de seguir", async () => {
    ran.length = 0;
    const session = { id: "ses-2", flow_id: "flow-off", contact_id: "c-1", channel_id: "ch-1", status: "active", waiting_for_input: false, current_node_id: "d", variables: {} };
    const db = memoryDb({
      flows: [flow("flow-off", [{ id: "d", type: "delay", data: { duration: 1, unit: "minutes" } }, { id: "m", type: "zzAuditMarker", data: {} }], [{ id: "e", source: "d", target: "m" }], { status: "draft" })],
      channels: [],
      conversations: [],
      flow_sessions: [session],
      analytics_events: [],
    });
    await resumeSession(db.client, session as never, baseContext("flow-off"));
    expect(ran).toEqual([]);
    expect(db.rows("flow_sessions")[0]).toMatchObject({ status: "cancelled" });
  });
});

describe("'Esperar respuesta' con tiempo maximo", () => {
  function waitWorld(edges: unknown[], data: Record<string, unknown> = { timeoutEnabled: true, timeout: 2, timeoutUnit: "hours" }) {
    return memoryDb({
      flows: [
        flow(
          "flow-t",
          [
            { id: "espera", type: "action", data: { actionType: "smartDelay", ...data } },
            { id: "m-respondio", type: "zzAuditMarker", data: {} },
            { id: "m-no-respondio", type: "zzAuditMarker", data: {} },
          ],
          edges,
        ),
      ],
      channels: [{ id: "ch-1", platform: "instagram", late_account_id: null }],
      conversations: [],
      contacts: [{ id: "c-1", workspace_id: WS }],
      flow_sessions: [],
      analytics_events: [],
      scheduled_jobs: [],
    });
  }
  const twoExits = [
    { id: "e1", source: "t", target: "espera" },
    { id: "e2", source: "espera", target: "m-respondio" },
    { id: "e3", source: "espera", sourceHandle: "timeout", target: "m-no-respondio" },
  ];

  it("al vencer sigue por 'Si no responde a tiempo'", async () => {
    ran.length = 0;
    const db = waitWorld(twoExits);
    await executeFlow(db.client, baseContext("flow-t"));
    const job = db.rows("scheduled_jobs").find((j) => j.type === "flow_wait_timeout")!;
    expect(job).toBeTruthy();
    expect((job.payload as { exit: string }).exit).toBe("timeout");
    await handleFlowWaitTimeout({ supabase: db.client, job: { id: "j", type: "flow_wait_timeout", payload: job.payload, attempts: 0 } });
    expect(ran).toEqual(["m-no-respondio"]);
  });

  it("si respondio antes, el vencimiento no hace nada y la respuesta nunca toma la salida de timeout", async () => {
    ran.length = 0;
    const db = waitWorld(twoExits);
    await executeFlow(db.client, baseContext("flow-t"));
    const session = db.rows("flow_sessions")[0];
    await resumeSession(db.client, { ...session } as never, { ...baseContext("flow-t"), incomingMessage: { text: "si" } });
    const job = db.rows("scheduled_jobs").find((j) => j.type === "flow_wait_timeout")!;
    await handleFlowWaitTimeout({ supabase: db.client, job: { id: "j", type: "flow_wait_timeout", payload: job.payload, attempts: 0 } });
    expect(ran).toEqual(["m-respondio"]);
  });

  it("sin tiempo maximo, la espera vence a los 7 dias y la sesion se cierra sin seguir", async () => {
    ran.length = 0;
    const db = waitWorld(twoExits.slice(0, 2), { timeoutEnabled: false });
    await executeFlow(db.client, baseContext("flow-t"));
    const job = db.rows("scheduled_jobs").find((j) => j.type === "flow_wait_timeout")!;
    expect((job.payload as { exit: string }).exit).toBe("expire");
    await handleFlowWaitTimeout({ supabase: db.client, job: { id: "j", type: "flow_wait_timeout", payload: job.payload, attempts: 0 } });
    expect(ran).toEqual([]);
    expect(db.rows("flow_sessions")[0]).toMatchObject({ status: "completed" });
  });

  it("waitTimeoutMs: el interruptor manda; un nodo viejo con tiempo guardado lo respeta", () => {
    expect(waitTimeoutMs({ timeoutEnabled: false, timeout: 5, timeoutUnit: "minutes" })).toBeNull();
    expect(waitTimeoutMs({ timeout: 5, timeoutUnit: "minutes" })).toBe(5 * 60 * 1000);
    expect(waitTimeoutMs({})).toBeNull();
  });
});

describe("'Esperar'", () => {
  it("delayRunAt: 'esperar hasta' gana; una fecha pasada o sin duracion no espera", () => {
    const now = Date.parse("2026-10-23T10:00:00Z");
    expect(delayRunAt({ waitUntil: "2026-10-24T10:00:00Z", duration: 5, unit: "minutes" }, now)?.toISOString()).toBe("2026-10-24T10:00:00.000Z");
    expect(delayRunAt({ waitUntil: "2026-10-01T10:00:00Z" }, now)).toBeNull();
    expect(delayRunAt({ duration: NaN as unknown as number, unit: "minutes" }, now)).toBeNull();
    expect(delayRunAt({ duration: 2, unit: "hours" }, now)?.toISOString()).toBe("2026-10-23T12:00:00.000Z");
  });
});

describe("'Ir a otro flujo'", () => {
  it("un ciclo A -> B -> A se corta y queda anotado", async () => {
    const db = memoryDb({
      flows: [
        flow("flow-a", [{ id: "go-b", type: "goToFlow", data: { flowId: "flow-b" } }], [{ id: "e", source: "t", target: "go-b" }]),
        flow("flow-b", [{ id: "go-a", type: "goToFlow", data: { flowId: "flow-a" } }], [{ id: "e", source: "t", target: "go-a" }]),
      ],
      channels: [],
      conversations: [],
      flow_sessions: [],
      analytics_events: [],
    });
    await executeFlow(db.client, baseContext("flow-a"));
    expect(db.rows("flow_sessions").map((s) => s.flow_id)).toEqual(["flow-a", "flow-b"]);
    expect(db.rows("analytics_events").some((e) => e.event_type === "flow_loop_blocked")).toBe(true);
  });

  it("no corre un flujo de otro workspace", async () => {
    const db = memoryDb({
      flows: [
        flow("flow-a", [{ id: "go", type: "goToFlow", data: { flowId: "flow-ajeno" } }], [{ id: "e", source: "t", target: "go" }]),
        { ...flow("flow-ajeno", [], []), workspace_id: "ws-otro" },
      ],
      channels: [],
      conversations: [],
      flow_sessions: [],
      analytics_events: [],
    });
    await executeFlow(db.client, baseContext("flow-a"));
    expect(db.rows("flow_sessions").map((s) => s.flow_id)).toEqual(["flow-a"]);
  });
});

describe("una sesion nunca queda viva para siempre", () => {
  it("si un paso lanza, la sesion se cancela y queda flow_failed", async () => {
    registerNode({ type: "zzAuditBoom", label: "Boom", needsContact: false, execute: () => { throw new Error("boom"); } });
    const db = memoryDb({
      flows: [flow("flow-boom", [{ id: "b", type: "zzAuditBoom", data: {} }], [{ id: "e", source: "t", target: "b" }])],
      channels: [],
      conversations: [],
      flow_sessions: [],
      analytics_events: [],
    });
    await expect(executeFlow(db.client, baseContext("flow-boom"))).rejects.toThrow("boom");
    expect(db.rows("flow_sessions")[0]).toMatchObject({ status: "cancelled" });
    expect(db.rows("analytics_events").map((e) => e.event_type)).toContain("flow_failed");
  });
});
