/**
 * Caracterizacion ANTES de los cambios de la clase (C1, C2 y C3). Fija lo que NO puede cambiar:
 *  - «Esperar» con fecha futura (ISO de siempre) o con duracion: espera y el paso siguiente corre despues.
 *  - Un disparador de contacto SIN la opcion «una sola vez por contacto»: cada envio arranca el flujo, como siempre.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const mocks = vi.hoisted(() => ({ audit: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import "@/lib/flow-engine/registry";
import { registerNode, registerTrigger } from "@/lib/flow-engine/registry/registry";
import { executeFlow, resumeSession } from "./engine";
import { processEvent, type AutomationEvent } from "./automation-events";

const WS = "ws-1";
const ran: string[] = [];
registerNode({ type: "zzClaseMarker", label: "Marca", needsContact: false, execute: ({ node }) => { ran.push(node.id); } });
registerTrigger({ type: "zz_clase_trigger", label: "Prueba", scope: "event", priority: 45, eventTypes: ["zz_clase_event"], dedupeKeyFor: (a) => `zz:${a.event.id}` });

const trigger = { id: "n-trigger", type: "trigger", data: { triggerType: "keyword" } };
const marker = (id: string) => ({ id, type: "zzClaseMarker", data: {} });
const flowRow = (nodes: unknown[], edges: unknown[]) => ({ id: "flow-1", workspace_id: WS, status: "published", nodes, edges });
// Uno nuevo por uso: el motor le anota al contexto la cadena de saltos, y reusarlo se leeria como un ciclo.
const ctx = () => ({ triggerId: "tr-1", flowId: "flow-1", channelId: "", contactId: "c-1", conversationId: "", workspaceId: WS, incomingMessage: {}, variables: {} });

beforeEach(() => {
  ran.length = 0;
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
});

function waitFlow(delay: Record<string, unknown>) {
  return memoryDb({
    flows: [
      flowRow(
        [trigger, { id: "n-wait", type: "delay", data: delay }, marker("n-after"), marker("n-end")],
        [
          { id: "e1", source: "n-trigger", target: "n-wait" },
          { id: "e2", source: "n-wait", target: "n-after" },
          { id: "e3", source: "n-after", target: "n-end" },
        ],
      ),
    ],
    contacts: [{ id: "c-1", workspace_id: WS }],
    workspaces: [{ id: WS, name: "N", timezone: "America/Costa_Rica" }],
    flow_sessions: [],
    analytics_events: [],
    scheduled_jobs: [],
  });
}

describe("caracterizacion: «Esperar»", () => {
  it("fecha futura en ISO: espera hasta esa hora y el paso siguiente corre recien al despertar", async () => {
    const db = waitFlow({ waitUntil: "2026-11-07T16:00:00.000Z" });
    await executeFlow(db.client, ctx() as never);
    expect(ran).toEqual([]);
    const job = db.rows("scheduled_jobs")[0];
    expect(job).toMatchObject({ type: "resume_flow", run_at: "2026-11-07T16:00:00.000Z" });
    const session = db.rows("flow_sessions")[0];
    expect(session).toMatchObject({ status: "active", current_node_id: "n-wait", waiting_until: "2026-11-07T16:00:00.000Z" });

    await resumeSession(db.client, session as never, { ...ctx(), triggerId: "" } as never);
    expect(ran).toEqual(["n-after", "n-end"]);
  });

  it("por duracion: igual que siempre", async () => {
    const db = waitFlow({ duration: 2, unit: "hours" });
    await executeFlow(db.client, ctx() as never);
    expect(ran).toEqual([]);
    expect(db.rows("scheduled_jobs")[0]).toMatchObject({ type: "resume_flow", run_at: "2026-11-05T17:00:00.000Z" });
  });

  it("sin duracion ni fecha: sigue de largo y NO saltea nada", async () => {
    const db = waitFlow({});
    await executeFlow(db.client, ctx() as never);
    expect(ran).toEqual(["n-after", "n-end"]);
    expect(db.rows("analytics_events").some((e) => e.event_type === "node_skipped")).toBe(false);
  });
});

describe("caracterizacion: un disparador de contacto sin la opcion nueva", () => {
  it("dos eventos del mismo contacto arrancan dos sesiones", async () => {
    const db = memoryDb(
      {
        flows: [flowRow([{ ...trigger, data: { triggerType: "zz_clase_trigger" } }, marker("n-a")], [{ id: "e1", source: "n-trigger", target: "n-a" }])],
        triggers: [{ id: "tr-1", workspace_id: WS, flow_id: "flow-1", channel_id: null, type: "zz_clase_trigger", config: {}, priority: 45, is_active: true }],
        conversations: [],
        contacts: [{ id: "c-1", workspace_id: WS }],
        workspaces: [{ id: WS, name: "N" }],
        trigger_fires: [],
        bookings: [],
        flow_sessions: [],
        analytics_events: [],
      },
      { unique: { trigger_fires: (a, b) => a.trigger_id === b.trigger_id && a.dedupe_key === b.dedupe_key } },
    );
    const event = (id: string) => ({ id, workspace_id: WS, event_type: "zz_clase_event", contact_id: "c-1", member_user_id: null, source_type: "contact", source_id: null, payload: {} }) as unknown as AutomationEvent;
    expect(await processEvent(db.client as never, event("ev-1"))).toBe(1);
    expect(await processEvent(db.client as never, event("ev-2"))).toBe(1);
    expect(db.rows("flow_sessions")).toHaveLength(2);
    expect(ran).toEqual(["n-a", "n-a"]);
  });
});
