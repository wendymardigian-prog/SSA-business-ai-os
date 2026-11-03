/**
 * Los disparadores de grupos de WhatsApp por la cola de punta a punta: el flujo corre sobre el contacto, responde
 * por el chat PRIVADO en el numero del grupo (creando la conversacion si no hay) y un «no contactar» no arranca.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const mocks = vi.hoisted(() => ({
  executeFlow: vi.fn(async () => undefined),
  audit: vi.fn(async () => null),
  upsertConversation: vi.fn(async () => ({ id: "cv-nueva", isAutomationPaused: false })),
}));
vi.mock("@/lib/flow-engine/engine", () => ({ executeFlow: mocks.executeFlow }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/inbound", () => ({ upsertConversation: mocks.upsertConversation }));

import "@/lib/flow-engine/registry";
import { processEvent, type AutomationEvent } from "@/lib/flow-engine/automation-events";
import { reactionPayload } from "./payload";

const WS = "ws-1";
const group = { id: "g-1", group_jid: "120363001122334455@g.us", subject: "Comunidad", channel_id: "ch-wa" };
const msg = { id: "m-1", text: "¿Quién viene?", direction: "outbound" as const, sent_by_flow_id: null, sent_by_node_id: null };

function world(over: { conversations?: Record<string, unknown>[]; doNotContact?: boolean; config?: Record<string, unknown> } = {}) {
  return memoryDb(
    {
      triggers: [{ id: "tr-1", workspace_id: WS, flow_id: "flow-1", channel_id: null, type: "whatsapp_group_reaction", config: over.config ?? {}, priority: 45, is_active: true }],
      channels: [{ id: "ch-wa", workspace_id: WS, platform: "whatsapp" }],
      contacts: [{ id: "c-1", workspace_id: WS, do_not_contact: over.doNotContact ?? false }],
      // La conversacion mas reciente del contacto es de OTRO canal (Instagram).
      conversations: over.conversations ?? [{ id: "cv-ig", channel_id: "ch-ig", contact_id: "c-1", deleted_at: null, last_message_at: "2026-11-01T00:00:00Z" }],
      trigger_fires: [],
      bookings: [],
    },
    { unique: { trigger_fires: (a, b) => a.trigger_id === b.trigger_id && a.dedupe_key === b.dedupe_key } },
  );
}

const event = (emoji = "🔥", id = "ev-1"): AutomationEvent =>
  ({ id, workspace_id: WS, event_type: "whatsapp_group_reaction", contact_id: "c-1", member_user_id: null, source_type: "contact", source_id: "c-1", payload: reactionPayload(group, "+5491122334455", msg, emoji) }) as AutomationEvent;

const lastContext = () => (mocks.executeFlow.mock.calls.at(-1) as unknown[])[1] as Record<string, unknown>;

beforeEach(() => vi.clearAllMocks());

describe("reacciono a un mensaje de un grupo (por la cola)", () => {
  it("responde por el chat privado en el numero del grupo, creandolo si no existe, con las variables del grupo", async () => {
    const db = world();
    expect(await processEvent(db.client as never, event())).toBe(1);
    expect(mocks.upsertConversation).toHaveBeenCalledWith(expect.objectContaining({ contactId: "c-1", incrementUnread: false, channel: expect.objectContaining({ id: "ch-wa" }) }));
    expect(lastContext()).toMatchObject({ contactId: "c-1", channelId: "ch-wa", conversationId: "cv-nueva", source: { type: "contact", id: "ev-1" } });
    expect(lastContext().variables).toMatchObject({ group: { name: "Comunidad", id: "g-1" }, reaction: { emoji: "🔥" }, message: { text: "¿Quién viene?" }, event_group_name: "Comunidad" });
  });

  it("si ya hay chat privado en ese numero, usa ese y no crea otro", async () => {
    const db = world({
      conversations: [
        { id: "cv-ig", channel_id: "ch-ig", contact_id: "c-1", deleted_at: null, last_message_at: "2026-11-01T00:00:00Z" },
        { id: "cv-wa", channel_id: "ch-wa", contact_id: "c-1", deleted_at: null, last_message_at: "2026-10-01T00:00:00Z" },
      ],
    });
    await processEvent(db.client as never, event());
    expect(mocks.upsertConversation).not.toHaveBeenCalled();
    expect(lastContext()).toMatchObject({ channelId: "ch-wa", conversationId: "cv-wa" });
  });

  it("un contacto con «no contactar» no arranca nada ni gasta el disparo", async () => {
    const db = world({ doNotContact: true });
    expect(await processEvent(db.client as never, event())).toBe(0);
    expect(mocks.executeFlow).not.toHaveBeenCalled();
    expect(db.rows("trigger_fires")).toHaveLength(0);
  });

  it("cambiar de emoji no vuelve a disparar el mismo flujo", async () => {
    const db = world();
    await processEvent(db.client as never, event("🔥", "ev-1"));
    await processEvent(db.client as never, event("👍", "ev-2"));
    expect(mocks.executeFlow).toHaveBeenCalledTimes(1);
  });

  it("un emoji que no esta en el filtro no dispara ni crea conversacion", async () => {
    const db = world({ config: { emojis: ["❤️"] } });
    expect(await processEvent(db.client as never, event("🔥"))).toBe(0);
    expect(mocks.upsertConversation).not.toHaveBeenCalled();
  });
});
