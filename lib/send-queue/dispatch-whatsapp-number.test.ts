/**
 * La cola de WhatsApp con un número que nunca escribió: antes del primer mensaje se pregunta si tiene WhatsApp.
 *
 *  - No tiene: se saltea sin vínculo, sin conversación y sin envío, y no cuenta para la pausa del carril.
 *  - Tiene: se vincula con el número en la forma que usa WhatsApp, para que su respuesta caiga en el mismo chat.
 *  - Error o respuesta rara: fallo con reintento, nunca un salteado.
 *  - Ya vinculado: no se pregunta (ya sabemos que tiene WhatsApp).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { checkWhatsappNumber, getEvolutionConfig, sendChannelMessage, recordSend, upsertConversation, notifyWorkspaceAdmins, channel } = vi.hoisted(() => ({
  checkWhatsappNumber: vi.fn(),
  getEvolutionConfig: vi.fn(),
  sendChannelMessage: vi.fn(),
  recordSend: vi.fn(),
  upsertConversation: vi.fn(),
  notifyWorkspaceAdmins: vi.fn(async () => true),
  channel: {
    id: "ch-wa",
    kind: "whatsapp",
    label: "WhatsApp · Wendy",
    evolutionInstance: "ssa-wa",
    policy: { minGapSeconds: 25, maxGapSeconds: 60, perMinute: 2, perHour: 60, perDay: 300, window: { enabled: false, days: [], start: "00:00", end: "23:59" }, pauseAfterFailures: 5 },
    connectionStatus: "open",
  },
}));
vi.mock("@/lib/evolution-client", async (original) => ({ ...(await original<typeof import("@/lib/evolution-client")>()), checkWhatsappNumber }));
vi.mock("@/lib/evolution-config", () => ({ getEvolutionConfig }));
vi.mock("@/lib/flow-engine/send", () => ({ sendChannelMessage, recordSend }));
vi.mock("@/lib/inbound", () => ({ upsertConversation }));
vi.mock("@/lib/notifications", () => ({ notifyWorkspaceAdmins }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/lib/broadcasts/channels", () => ({ loadBroadcastChannel: vi.fn(async () => channel) }));
vi.mock("@/lib/broadcasts/audience-load", () => ({
  loadRenderData: vi.fn(async (_s: unknown, _w: unknown, ids: string[]) => new Map(ids.map((id) => [id, { contact: { display_name: "Ana", email: null, phone: "+5491122334455", whatsapp_phone: null }, customValues: {} }]))),
}));

import { EvolutionError } from "@/lib/evolution-client";
import { fakeDb } from "@/lib/testing/fake-db";
import { runSendQueue } from "./dispatch";

const broadcast = {
  id: "b-1", workspace_id: "ws-1", status: "sending", channel_id: "ch-wa", name: "Clase", email_subject: null, audience_params: {},
  message_variants: ["Hola {{contact.first_name}}"], skip_missing_variables: false, pace: null, created_at: "2026-11-05T10:00:00Z",
};
const recipient = { id: "r-1", broadcast_id: "b-1", contact_id: "c-1", channel_id: "ch-wa", status: "sending", attempts: 0, variant_index: 0, target: "+5491122334455" };

function world(over: { linked?: boolean; consecutiveFailures?: number; insertError?: { message: string; code?: string } } = {}) {
  return fakeDb(
    {
      "broadcasts:select": { data: [broadcast] },
      "channel_send_lanes:select": { data: { channel_id: "ch-wa", workspace_id: "ws-1", next_send_at: "2026-11-01T00:00:00Z", paused_at: null, consecutive_failures: over.consecutiveFailures ?? 0 } },
      "channel_send_lanes:update": { data: [{ channel_id: "ch-wa" }] },
      "workspaces:select": { data: { name: "Negocio", timezone: "America/Costa_Rica" } },
      "contacts:select": { data: { id: "c-1", deleted_at: null, do_not_contact: false, is_subscribed: true, email: null } },
      "custom_field_definitions:select": { data: [] },
      "broadcast_recipients:select": { data: null, count: 0 },
      "contact_channels:select": { data: over.linked ? { contact_id: "c-1" } : null },
      "contact_channels:insert": { error: over.insertError ?? null },
      "conversations:select": { data: null },
    },
    {
      claim_lane_slot: { data: true },
      claim_broadcast_recipient: { data: [recipient] },
      refresh_broadcast_counts: { data: "sending" },
    },
  );
}

type World = ReturnType<typeof world>;
const recipientUpdate = (db: World) => db.writesTo("broadcast_recipients").find((c) => c.filters.some((f) => f.column === "id"))?.values as Record<string, unknown>;
const linkInserts = (db: World) => db.writesTo("contact_channels");
const pausedLane = (db: World) => db.writesTo("channel_send_lanes").some((c) => (c.values as Record<string, unknown>).paused_at);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T16:00:00Z"));
  vi.clearAllMocks();
  getEvolutionConfig.mockResolvedValue({ baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" });
  upsertConversation.mockResolvedValue({ id: "conv-1" });
  sendChannelMessage.mockResolvedValue({ ok: true, platformMessageId: "m-1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("un número sin WhatsApp", () => {
  beforeEach(() => checkWhatsappNumber.mockResolvedValue({ exists: false, jid: null }));

  it("queda salteado, sin vínculo, sin conversación y sin envío", async () => {
    const db = world();
    const summary = await runSendQueue(db.client);
    expect(checkWhatsappNumber).toHaveBeenCalledWith(expect.anything(), "ssa-wa", "+5491122334455");
    expect(recipientUpdate(db)).toMatchObject({ status: "skipped", skip_reason: "no_whatsapp" });
    expect(recipientUpdate(db)).not.toHaveProperty("attempts");
    expect(linkInserts(db)).toHaveLength(0);
    expect(upsertConversation).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(recordSend).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ skipped: 1, failed: 0 });
  });

  it("cinco seguidos no pausan el carril, aunque ya viniera con cuatro fallos", async () => {
    for (let i = 0; i < 5; i++) {
      const db = world({ consecutiveFailures: 4 });
      await runSendQueue(db.client);
      expect(pausedLane(db)).toBe(false);
      expect(db.writesTo("channel_send_lanes").some((c) => "consecutive_failures" in (c.values as object))).toBe(false);
    }
    expect(notifyWorkspaceAdmins).not.toHaveBeenCalled();
  });
});

describe("un número con WhatsApp", () => {
  it("se vincula con la forma que usa WhatsApp, y el mensaje sale", async () => {
    checkWhatsappNumber.mockResolvedValue({ exists: true, jid: "5491199887766@s.whatsapp.net" });
    const db = world();
    await runSendQueue(db.client);
    expect(linkInserts(db)[0].values).toMatchObject({ contact_id: "c-1", channel_id: "ch-wa", platform_sender_id: "+5491199887766" });
    expect(sendChannelMessage).toHaveBeenCalledTimes(1);
    expect(recipientUpdate(db)).toMatchObject({ status: "sent", conversation_id: "conv-1" });
  });

  it.each([
    ["no informa cómo lo identifica", null],
    ["lo identifica con un @lid", "98765432101234@lid"],
  ])("si %s, se vincula con el número cargado", async (_caso, jid) => {
    checkWhatsappNumber.mockResolvedValue({ exists: true, jid });
    const db = world();
    await runSendQueue(db.client);
    expect(linkInserts(db)[0].values).toMatchObject({ platform_sender_id: "+5491122334455" });
  });

  it("si esa forma ya es de otro contacto en el número, se saltea como siempre", async () => {
    checkWhatsappNumber.mockResolvedValue({ exists: true, jid: "5491199887766@s.whatsapp.net" });
    const db = world({ insertError: { message: "duplicate", code: "23505" } });
    await runSendQueue(db.client);
    expect(recipientUpdate(db)).toMatchObject({ status: "skipped", skip_reason: "phone_in_use" });
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });
});

describe("un contacto ya vinculado al número", () => {
  it("no pasa por la pregunta", async () => {
    const db = world({ linked: true });
    await runSendQueue(db.client);
    expect(checkWhatsappNumber).not.toHaveBeenCalled();
    expect(linkInserts(db)).toHaveLength(0);
    expect(recipientUpdate(db)).toMatchObject({ status: "sent" });
  });
});

describe("si no se puede saber", () => {
  it("un error de Evolution es un fallo con reintento, nunca un salteado", async () => {
    checkWhatsappNumber.mockRejectedValue(new EvolutionError("no contestó", 500));
    const db = world();
    const summary = await runSendQueue(db.client);
    expect(recipientUpdate(db)).toMatchObject({ status: "pending", attempts: 1 });
    expect(recipientUpdate(db).skip_reason).toBeUndefined();
    expect(recipientUpdate(db).next_attempt_at).toBeTruthy();
    expect(linkInserts(db)).toHaveLength(0);
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ failed: 1, skipped: 0 });
  });

  it("el error de la comprobación sí cuenta para la pausa: Evolution puede estar caído", async () => {
    checkWhatsappNumber.mockRejectedValue(new EvolutionError("no contestó"));
    const db = world({ consecutiveFailures: 4 });
    await runSendQueue(db.client);
    expect(pausedLane(db)).toBe(true);
    expect(notifyWorkspaceAdmins).toHaveBeenCalledTimes(1);
  });

  it("sin WhatsApp configurado, frena el carril al primer intento", async () => {
    getEvolutionConfig.mockResolvedValue(null);
    const db = world();
    await runSendQueue(db.client);
    expect(checkWhatsappNumber).not.toHaveBeenCalled();
    expect(recipientUpdate(db)).toMatchObject({ status: "failed" });
    expect(pausedLane(db)).toBe(true);
  });
});
