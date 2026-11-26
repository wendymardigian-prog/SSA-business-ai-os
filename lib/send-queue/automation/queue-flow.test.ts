/**
 * La cola de WhatsApp de punta a punta, en memoria y con el WhatsApp simulado (nada sale de la PC):
 *   - «Enviar WhatsApp a un número» en una automatización que arranca por una etiqueta → entra en la cola (no sale);
 *   - la misma con un disparador de palabra clave → sale al instante como siempre (no pasa por la cola);
 *   - el despachador saca el envío por el carril del número, con su espera, y lo deja enviado;
 *   - fuera del horario del número no sale nada y el carril espera la apertura;
 *   - un rechazo de WhatsApp no se reintenta; un fallo de transporte sí.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import type { FlowExecutionContext } from "@/lib/flow-engine/types";

const sendText = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ id: "wamid-1" })));
vi.mock("@/lib/evolution-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/evolution-client")>("@/lib/evolution-client");
  return { ...actual, sendText };
});
vi.mock("@/lib/evolution-config", () => {
  const config = { baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "t" };
  return { getEvolutionConfig: vi.fn(async () => config), getEvolutionConfigStrict: vi.fn(async () => ({ kind: "ok", config })) };
});
vi.mock("@/lib/notifications", () => ({ notifyWorkspaceAdmins: vi.fn(async () => {}) }));

const { sendWhatsAppNumberNode } = await import("@/lib/flow-engine/nodes/send-whatsapp-number");
const { runAutomationQueue } = await import("./run-queue");
const { EvolutionError } = await import("@/lib/evolution-client");

const WS = "ws-1";
const CH = "ch-wa";
/** Martes 10:00 en Costa Rica (UTC-6): dentro del horario del número. */
const OPEN = new Date("2026-11-17T16:00:00Z");
/** Martes 21:00 en Costa Rica: fuera del horario (08:00 a 20:00). */
const CLOSED = new Date("2026-11-18T03:00:00Z");

let db: MemoryDb;

function world(triggerType: string) {
  return memoryDb(
    {
      workspaces: [{ id: WS, timezone: "America/Costa_Rica", send_contact_caps: null, send_lane_alert: null }],
      flows: [{ id: "flow-1", workspace_id: WS, nodes: [{ id: "t", type: "trigger", data: { triggerType } }] }],
      channels: [
        {
          id: CH,
          workspace_id: WS,
          provider: "evolution",
          platform: "whatsapp",
          evolution_instance: "inst-1",
          is_active: true,
          display_name: "Número de prueba",
          created_at: "2026-01-01T00:00:00Z",
          send_policy: { minGapSeconds: 20, maxGapSeconds: 40, perMinute: 2, perHour: 60, perDay: 300, window: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: "08:00", end: "20:00" } },
        },
      ],
      contacts: [],
      conversations: [],
      flow_send_claims: [],
      analytics_events: [],
      send_queue_items: [],
      channel_send_lanes: [],
    },
    {
      unique: {
        flow_send_claims: (a, b) => a.session_id === b.session_id && a.node_id === b.node_id && a.target === b.target,
        send_queue_items: (a, b) => a.workspace_id === b.workspace_id && a.dedupe_key === b.dedupe_key,
      },
      rpc: {
        find_or_create_contact: () => ({ contact_id: null, created: false, matched_by: null, conflicts: [], status: "not_found" }),
        claim_automated_send: () => true,
        expire_send_queue_items: () => 0,
        release_scheduled_send_queue_items: () => 0,
        send_lane_counts: () => [{ last_minute: 0, last_hour: 0, today: 0 }],
        claim_lane_slot_at: (args, d) => {
          const lane = d.rows("channel_send_lanes").find((l) => l.channel_id === args.p_channel_id);
          if (!lane || lane.paused_at || String(lane.next_send_at) > String(args.p_now)) return false;
          lane.next_send_at = args.p_next;
          return true;
        },
        claim_send_queue_item: (args, d) => {
          const item = d
            .rows("send_queue_items")
            .find((q) => q.channel_id === args.p_channel_id && q.status === "queued" && (args.p_priorities as string[]).includes(String(q.priority)) && (!q.next_attempt_at || String(q.next_attempt_at) <= String(args.p_now)));
          if (!item) return [];
          item.status = "sending";
          item.claimed_at = args.p_now;
          return [{ ...item }];
        },
      },
    },
  );
}

const ctx = (): FlowExecutionContext => ({
  triggerId: "t",
  flowId: "flow-1",
  channelId: "",
  contactId: null,
  conversationId: "",
  workspaceId: WS,
  incomingMessage: {},
  variables: {},
});

const runStep = () =>
  sendWhatsAppNumberNode.execute({
    supabase: db.client,
    node: { id: "n1", type: "action", position: { x: 0, y: 0 }, data: {} } as never,
    data: { to: "fixed", fixedPhone: "+54 9 11 7777-0000", channelId: CH, text: "Hola, te escribo por tu inscripción" },
    context: ctx(),
    sessionId: "sess-1",
    runtime: { executeFlow: async () => {} },
  } as never);

/** Encola con el reloj de verdad y corre la hora prevista a antes del reloj del despachador. */
async function enqueueBefore(at: Date) {
  await runStep();
  for (const q of db.rows("send_queue_items")) q.scheduled_for = new Date(at.getTime() - 60_000).toISOString();
}

beforeEach(() => {
  sendText.mockReset();
  sendText.mockResolvedValue({ id: "wamid-1" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("qué entra en la cola", () => {
  it("una automatización que arranca por una etiqueta: el WhatsApp entra en la cola y no sale en el momento", async () => {
    db = world("crm_event");
    await runStep();
    expect(sendText).not.toHaveBeenCalled();
    const items = db.rows("send_queue_items");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ channel_id: CH, target_kind: "number", to_number: "+5491177770000", status: "queued", priority: "normal", preview: "Hola, te escribo por tu inscripción" });
  });

  it("una automatización de palabra clave: sale al instante como siempre y no pasa por la cola", async () => {
    db = world("keyword");
    await runStep();
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(db.rows("send_queue_items")).toHaveLength(0);
  });

  it("el paso puede elegir «al instante» aunque el disparador sea una etiqueta", async () => {
    db = world("crm_event");
    await sendWhatsAppNumberNode.execute({
      supabase: db.client,
      node: { id: "n1", type: "action", position: { x: 0, y: 0 }, data: {} } as never,
      data: { to: "fixed", fixedPhone: "+54 9 11 7777-0000", channelId: CH, text: "Hola", delivery: { mode: "immediate" } } as never,
      context: ctx(),
      sessionId: "sess-1",
      runtime: { executeFlow: async () => {} },
    } as never);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(db.rows("send_queue_items")).toHaveLength(0);
  });
});

describe("el despachador", () => {
  it("dentro del horario: lo saca por el carril del número, con su espera al azar, y queda enviado", async () => {
    db = world("crm_event");
    await enqueueBefore(OPEN);
    const summary = await runAutomationQueue(db.client, OPEN, () => 0);
    expect(summary).toMatchObject({ lanes: 1, sent: 1, failed: 0 });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0].slice(1)).toEqual(["inst-1", "+5491177770000", "Hola, te escribo por tu inscripción"]);
    expect(db.rows("send_queue_items")[0]).toMatchObject({ status: "sent", platform_message_id: "wamid-1" });
    // El próximo turno del número, a la espera mínima (20 s con rand = 0).
    expect(db.rows("channel_send_lanes")[0].next_send_at).toBe(new Date(OPEN.getTime() + 20_000).toISOString());
    expect(db.rows("analytics_events").some((e) => e.event_type === "whatsapp_number_sent")).toBe(true);
  });

  it("fuera del horario no sale nada y el carril espera la apertura (08:00)", async () => {
    db = world("crm_event");
    await enqueueBefore(CLOSED);
    const summary = await runAutomationQueue(db.client, CLOSED, () => 0);
    expect(summary.sent).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
    expect(db.rows("send_queue_items")[0].status).toBe("queued");
    expect(db.rows("channel_send_lanes")[0].next_send_at).toBe("2026-11-18T14:00:00.000Z");
  });

  it("un rechazo de WhatsApp (400) queda fallido sin reintento", async () => {
    db = world("crm_event");
    await enqueueBefore(OPEN);
    sendText.mockRejectedValueOnce(new EvolutionError("no existe", 400));
    await runAutomationQueue(db.client, OPEN, () => 0);
    expect(db.rows("send_queue_items")[0]).toMatchObject({ status: "failed", error_kind: "rejected", attempts: 1 });
  });

  it("un fallo de transporte (503) vuelve a la cola para dentro de 1 minuto", async () => {
    db = world("crm_event");
    await enqueueBefore(OPEN);
    sendText.mockRejectedValueOnce(new EvolutionError("caído", 503));
    await runAutomationQueue(db.client, OPEN, () => 0);
    expect(db.rows("send_queue_items")[0]).toMatchObject({ status: "queued", error_kind: "transport", attempts: 1, next_attempt_at: new Date(OPEN.getTime() + 60_000).toISOString() });
  });

  it("con el número pausado no sale nada", async () => {
    db = world("crm_event");
    await enqueueBefore(OPEN);
    db.rows("channel_send_lanes").push({ channel_id: CH, workspace_id: WS, next_send_at: OPEN.toISOString(), paused_at: OPEN.toISOString(), consecutive_failures: 0, bulk_paused_at: null, undelivered_since: null });
    await runAutomationQueue(db.client, OPEN, () => 0);
    expect(sendText).not.toHaveBeenCalled();
    expect(db.rows("send_queue_items")[0].status).toBe("queued");
  });
});
