import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const upsertContactForSender = vi.fn();
vi.mock("@/lib/inbox-sync", () => ({ upsertContactForSender }));

const recordTouch = vi.fn();
vi.mock("@/lib/contacts/touch", () => ({ recordTouch }));

const getEvolutionConfig = vi.fn();
vi.mock("@/lib/evolution-config", () => ({ getEvolutionConfig }));

const downloadAttachments = vi.fn();
vi.mock("@/lib/inbound-media", () => ({ downloadAttachments, chatMediaEnabled: vi.fn(async () => true) }));

const { handleGroupMessage, handleGroupParticipants, handleGroupsUpdate, loadActiveGroup } = await import("./inbound");

const WS = "ws-1";
const CH = "ch-1";
const GROUP_JID = "120363001122334455@g.us";
const channel = {
  id: CH,
  workspace_id: WS,
  late_account_id: "evolution:ssa-1",
  platform: "whatsapp",
  username: null,
  display_name: "WhatsApp +5491100000000",
  evolution_instance: "ssa-1",
};

function groupRow(over: Record<string, unknown> = {}) {
  return {
    id: "g-1",
    workspace_id: WS,
    channel_id: CH,
    group_jid: GROUP_JID,
    subject: "Comunidad SSA",
    in_inbox: true,
    save_contacts: true,
    unread_count: 0,
    left_at: null,
    ...over,
  };
}

function setup(tables: Record<string, Array<Record<string, unknown>>> = {}) {
  return memoryDb({
    whatsapp_groups: [groupRow()],
    whatsapp_group_members: [],
    whatsapp_group_messages: [],
    whatsapp_group_reactions: [],
    whatsapp_poll_votes: [],
    contact_channels: [],
    automation_events: [],
    ...tables,
  });
}

const ANA = { id: "+5491122334455", phone: "+5491122334455", lid: "98765432101234@lid" };

beforeEach(() => {
  vi.clearAllMocks();
  upsertContactForSender.mockResolvedValue({ contactId: "contact-ana", existed: false });
  recordTouch.mockResolvedValue({ recorded: true });
  getEvolutionConfig.mockResolvedValue(null);
});

describe("loadActiveGroup", () => {
  it("un grupo sin nada prendido no cuenta como activado", async () => {
    const memory = setup({ whatsapp_groups: [groupRow({ in_inbox: false, save_contacts: false })] });
    expect(await loadActiveGroup(memory.client as never, CH, GROUP_JID)).toBeNull();
  });

  it("un grupo del que el numero salio tampoco", async () => {
    const memory = setup({ whatsapp_groups: [groupRow({ left_at: "2026-11-01T00:00:00Z" })] });
    expect(await loadActiveGroup(memory.client as never, CH, GROUP_JID)).toBeNull();
  });
});

describe("handleGroupParticipants", () => {
  it("alguien entra a un grupo que guarda contactos: miembro, contacto, toque del grupo y evento", async () => {
    const memory = setup();
    const result = await handleGroupParticipants(memory.client as never, channel, { groupJid: GROUP_JID, action: "add", participants: [ANA] });

    expect(result).toEqual({ joined: 1, emitted: 1 });
    expect(memory.rows("whatsapp_group_members")[0]).toMatchObject({ group_id: "g-1", participant_id: ANA.id, source: "join", left_at: null });
    expect(upsertContactForSender).toHaveBeenCalledWith(expect.objectContaining({ senderId: ANA.id, senderPhone: ANA.phone, stampExisting: false }));
    expect(recordTouch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contactId: "contact-ana",
        touch: expect.objectContaining({
          origin: "whatsapp_group",
          source: "whatsapp",
          medium: "whatsapp_group",
          content: "Comunidad SSA",
          dedupeKey: "wa-group:g-1:contact-ana",
          raw: expect.objectContaining({ group_jid: GROUP_JID, group_event: "join" }),
        }),
      }),
    );
    expect(memory.rows("automation_events")[0]).toMatchObject({
      event_type: "whatsapp_group_joined",
      contact_id: "contact-ana",
      payload: expect.objectContaining({ group_id: "g-1", group_name: "Comunidad SSA", channel_id: CH }),
    });
  });

  it("si el grupo NO guarda contactos no crea a nadie; solo dispara si ya era contacto", async () => {
    const memory = setup({
      whatsapp_groups: [groupRow({ save_contacts: false })],
      contact_channels: [{ id: "cc-1", channel_id: CH, contact_id: "contact-viejo", platform_sender_id: ANA.id }],
    });
    const nuevo = { id: "+5491199998888", phone: "+5491199998888", lid: null };
    const result = await handleGroupParticipants(memory.client as never, channel, { groupJid: GROUP_JID, action: "add", participants: [ANA, nuevo] });

    expect(upsertContactForSender).not.toHaveBeenCalled();
    expect(recordTouch).not.toHaveBeenCalled();
    expect(result).toEqual({ joined: 2, emitted: 1 });
    expect(memory.rows("automation_events")).toHaveLength(1);
    expect(memory.rows("automation_events")[0].contact_id).toBe("contact-viejo");
  });

  it("el propio numero del negocio no se vuelve contacto", async () => {
    const memory = setup();
    const self = { id: "+5491100000000", phone: "+5491100000000", lid: null };
    await handleGroupParticipants(memory.client as never, channel, { groupJid: GROUP_JID, action: "add", participants: [self] });
    expect(upsertContactForSender).not.toHaveBeenCalled();
    expect(memory.rows("whatsapp_group_members")).toHaveLength(0);
  });

  it("un grupo no activado no guarda nada", async () => {
    const memory = setup({ whatsapp_groups: [] });
    const result = await handleGroupParticipants(memory.client as never, channel, { groupJid: GROUP_JID, action: "add", participants: [ANA] });
    expect(result).toEqual({ joined: 0, emitted: 0 });
    expect(upsertContactForSender).not.toHaveBeenCalled();
  });

  it("una salida marca al miembro; no crea ni dispara", async () => {
    const memory = setup({ whatsapp_group_members: [{ id: "m-1", group_id: "g-1", participant_id: ANA.id, left_at: null }] });
    await handleGroupParticipants(memory.client as never, channel, { groupJid: GROUP_JID, action: "remove", participants: [ANA] });
    expect(memory.rows("whatsapp_group_members")[0].left_at).not.toBeNull();
    expect(upsertContactForSender).not.toHaveBeenCalled();
    expect(memory.rows("automation_events")).toHaveLength(0);
  });

  it("si crear el contacto falla, el miembro queda igual y no se emite nada", async () => {
    const memory = setup();
    upsertContactForSender.mockResolvedValue(null);
    const result = await handleGroupParticipants(memory.client as never, channel, { groupJid: GROUP_JID, action: "add", participants: [ANA] });
    expect(result).toEqual({ joined: 1, emitted: 0 });
    expect(memory.rows("automation_events")).toHaveLength(0);
  });
});

const groupKey = (over: Record<string, unknown> = {}) => ({
  remoteJid: GROUP_JID,
  fromMe: false,
  id: "M1",
  participant: "98765432101234@lid",
  participantAlt: "5491122334455@s.whatsapp.net",
  ...over,
});

describe("handleGroupMessage", () => {
  it("guarda el mensaje en el hilo del grupo, suma un no leido y anota al miembro", async () => {
    const memory = setup();
    const outcome = await handleGroupMessage(memory.client as never, channel, groupRow() as never, {
      key: groupKey(),
      pushName: "Ana",
      message: { conversation: "hola a todos" },
      messageTimestamp: 1_760_000_000,
    });
    expect(outcome).toBe("stored");
    expect(memory.rows("whatsapp_group_messages")[0]).toMatchObject({
      group_id: "g-1",
      platform_message_id: "M1",
      direction: "inbound",
      sender_participant_id: ANA.id,
      sender_name: "Ana",
      text: "hola a todos",
    });
    expect(memory.rows("whatsapp_groups")[0]).toMatchObject({ unread_count: 1, last_message_preview: "Ana: hola a todos" });
    expect(memory.rows("whatsapp_group_members")[0]).toMatchObject({ participant_id: ANA.id, source: "activity", display_name: "Ana" });
    // Un mensaje no crea contactos ni dispara nada.
    expect(upsertContactForSender).not.toHaveBeenCalled();
    expect(memory.rows("automation_events")).toHaveLength(0);
  });

  it("el eco de lo que ya guardamos no se duplica", async () => {
    const memory = setup({ whatsapp_group_messages: [{ id: "gm-1", group_id: "g-1", platform_message_id: "M1", direction: "outbound", origin: "app" }] });
    const outcome = await handleGroupMessage(memory.client as never, channel, groupRow() as never, {
      key: groupKey({ fromMe: true, participant: null }),
      message: { conversation: "hola" },
    });
    expect(outcome).toBe("duplicate");
    expect(memory.rows("whatsapp_group_messages")).toHaveLength(1);
    expect(memory.rows("whatsapp_group_messages")[0].origin).toBe("app");
  });

  it("una encuesta se guarda con su pregunta y opciones", async () => {
    const memory = setup();
    await handleGroupMessage(memory.client as never, channel, groupRow() as never, {
      key: groupKey({ fromMe: true, participant: null, id: "POLL1" }),
      message: { pollCreationMessageV3: { name: "¿Qué día?", options: [{ optionName: "Lunes" }, { optionName: "Martes" }], selectableOptionsCount: 1 } },
    });
    const row = memory.rows("whatsapp_group_messages")[0];
    expect(row).toMatchObject({ direction: "outbound", poll: { name: "¿Qué día?", options: ["Lunes", "Martes"], selectableCount: 1 } });
    expect(memory.rows("whatsapp_groups")[0]).toMatchObject({ unread_count: 0, last_message_preview: "📊 ¿Qué día?" });
  });

  it("alguien sin identidad no se guarda", async () => {
    const memory = setup();
    expect(await handleGroupMessage(memory.client as never, channel, groupRow() as never, { key: groupKey({ participant: null }), message: { conversation: "x" } })).toBe("ignored");
    expect(memory.rows("whatsapp_group_messages")).toHaveLength(0);
  });
});

describe("reacciones de un grupo", () => {
  const target = { id: "gm-1", group_id: "g-1", platform_message_id: "MSG-NEGOCIO", direction: "outbound", text: "¿Quién viene el jueves?", sent_by_flow_id: "flow-1", sent_by_node_id: "node-1", poll: null };
  const reactionData = (emoji: string, over: Record<string, unknown> = {}) => ({
    key: groupKey({ id: `R-${emoji || "x"}`, ...over }),
    pushName: "Ana",
    message: { reactionMessage: { key: { remoteJid: GROUP_JID, fromMe: true, id: "MSG-NEGOCIO" }, text: emoji } },
  });

  it("se guarda, crea el contacto si el grupo guarda contactos y emite el evento con el mensaje", async () => {
    const memory = setup({ whatsapp_group_messages: [target] });
    expect(await handleGroupMessage(memory.client as never, channel, groupRow() as never, reactionData("🔥"))).toBe("reaction");
    expect(memory.rows("whatsapp_group_reactions")[0]).toMatchObject({ message_id: "gm-1", participant_id: ANA.id, emoji: "🔥", from_me: false, removed_at: null });
    expect(recordTouch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ touch: expect.objectContaining({ raw: expect.objectContaining({ group_event: "activity" }) }) }));
    expect(memory.rows("automation_events")[0]).toMatchObject({
      event_type: "whatsapp_group_reaction",
      contact_id: "contact-ana",
      payload: expect.objectContaining({ emoji: "🔥", message_id: "gm-1", message_from_business: true, message_flow_id: "flow-1", message_node_id: "node-1", message_text: "¿Quién viene el jueves?" }),
    });
    // No es un mensaje.
    expect(memory.rows("whatsapp_group_messages")).toHaveLength(1);
  });

  it("cambiar el emoji pisa la anterior (una por persona); quitarla la marca", async () => {
    const memory = setup({ whatsapp_group_messages: [target] });
    await handleGroupMessage(memory.client as never, channel, groupRow() as never, reactionData("🔥"));
    await handleGroupMessage(memory.client as never, channel, groupRow() as never, reactionData("👍"));
    expect(memory.rows("whatsapp_group_reactions")).toHaveLength(1);
    expect(memory.rows("whatsapp_group_reactions")[0].emoji).toBe("👍");
    await handleGroupMessage(memory.client as never, channel, groupRow() as never, reactionData(""));
    expect(memory.rows("whatsapp_group_reactions")[0].removed_at).not.toBeNull();
    expect(memory.rows("automation_events")).toHaveLength(2);
  });

  it("la reaccion del negocio se guarda pero no dispara nada", async () => {
    const memory = setup({ whatsapp_group_messages: [target] });
    await handleGroupMessage(memory.client as never, channel, groupRow() as never, reactionData("❤️", { fromMe: true, participant: null }));
    expect(memory.rows("whatsapp_group_reactions")[0]).toMatchObject({ participant_id: "me", from_me: true });
    expect(memory.rows("automation_events")).toHaveLength(0);
  });

  it("a un mensaje que no tenemos no se guarda", async () => {
    const memory = setup();
    await handleGroupMessage(memory.client as never, channel, groupRow() as never, reactionData("🔥"));
    expect(memory.rows("whatsapp_group_reactions")).toHaveLength(0);
    expect(memory.rows("automation_events")).toHaveLength(0);
  });
});

describe("votos de una encuesta de un grupo", () => {
  const poll = { id: "gm-poll", group_id: "g-1", platform_message_id: "POLL1", direction: "outbound", text: null, poll: { name: "¿Qué día?", options: ["Lunes", "Martes"], selectableCount: 0 }, sent_by_flow_id: null, sent_by_node_id: null };
  const vote = (selectedOptions: unknown, over: Record<string, unknown> = {}) => ({
    key: groupKey({ id: `V-${JSON.stringify(selectedOptions)}`, ...over }),
    pushName: "Ana",
    message: { pollUpdateMessage: { pollCreationMessageKey: { id: "POLL1" }, vote: { selectedOptions } } },
  });

  it("guarda el voto y emite el evento con las opciones", async () => {
    const memory = setup({ whatsapp_group_messages: [poll] });
    expect(await handleGroupMessage(memory.client as never, channel, groupRow() as never, vote(["Lunes", "Martes"]))).toBe("vote");
    expect(memory.rows("whatsapp_poll_votes")[0]).toMatchObject({ message_id: "gm-poll", participant_id: ANA.id, selected_options: ["Lunes", "Martes"] });
    expect(memory.rows("automation_events")[0]).toMatchObject({
      event_type: "whatsapp_group_poll_vote",
      payload: expect.objectContaining({ poll_question: "¿Qué día?", selected: "Lunes, Martes", selected_options_json: '["Lunes","Martes"]', message_text: "¿Qué día?" }),
    });
  });

  it("sacar el voto lo guarda vacio y no dispara", async () => {
    const memory = setup({ whatsapp_group_messages: [poll] });
    await handleGroupMessage(memory.client as never, channel, groupRow() as never, vote([]));
    expect(memory.rows("whatsapp_poll_votes")[0].selected_options).toEqual([]);
    expect(memory.rows("automation_events")).toHaveLength(0);
  });

  it("un voto cifrado (Evolution no tenia la encuesta) no se guarda", async () => {
    const memory = setup({ whatsapp_group_messages: [poll] });
    await handleGroupMessage(memory.client as never, channel, groupRow() as never, {
      key: groupKey({ id: "V-enc" }),
      message: { pollUpdateMessage: { pollCreationMessageKey: { id: "POLL1" }, vote: { encPayload: "x", encIv: "y" } } },
    });
    expect(memory.rows("whatsapp_poll_votes")).toHaveLength(0);
  });

  it("un voto a algo que no es una encuesta no se guarda", async () => {
    const memory = setup({ whatsapp_group_messages: [{ ...poll, poll: null }] });
    await handleGroupMessage(memory.client as never, channel, groupRow() as never, vote(["Lunes"]));
    expect(memory.rows("whatsapp_poll_votes")).toHaveLength(0);
  });
});

describe("handleGroupsUpdate (00344)", () => {
  const COMMUNITY = "120363009999999999@g.us";

  it("actualiza un grupo guardado y nunca crea uno nuevo", async () => {
    const memory = setup();
    const changed = await handleGroupsUpdate(memory.client as never, CH, [
      { jid: GROUP_JID, isCommunity: false, patch: { subject: "Otro nombre", announce: true } },
      { jid: "120363000000000001@g.us", isCommunity: false, patch: { subject: "Desconocido" } },
    ]);
    expect(changed).toBe(2);
    const rows = memory.rows("whatsapp_groups");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subject: "Otro nombre", announce: true });
  });

  it("el nombre de la comunidad madre se copia a sus grupos; salir de la comunidad borra el nombre", async () => {
    const memory = setup({ whatsapp_groups: [groupRow({ parent_group_jid: COMMUNITY, community_subject: "Vieja" })] });
    await handleGroupsUpdate(memory.client as never, CH, [{ jid: COMMUNITY, isCommunity: true, patch: { subject: "Nueva" } }]);
    expect(memory.rows("whatsapp_groups")[0]).toMatchObject({ community_subject: "Nueva" });
    await handleGroupsUpdate(memory.client as never, CH, [{ jid: GROUP_JID, isCommunity: false, patch: { parent_group_jid: null, kind: "group" } }]);
    expect(memory.rows("whatsapp_groups")[0]).toMatchObject({ parent_group_jid: null, community_subject: null, kind: "group" });
  });
});
