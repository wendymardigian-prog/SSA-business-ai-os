import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { EvolutionError, type EvolutionStoredChat, type EvolutionStoredMessage } from "@/lib/evolution-client";
import { newWhatsappImportState, parseWhatsappImportState } from "./import-state";
import { chatsToImport, CHATS_PER_STEP, runWhatsappImportStep, startWhatsappImport } from "./run-import";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const CONFIG = { baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" };
const OLD = Math.floor(new Date("2026-04-01T12:00:00.000Z").getTime() / 1000);
const RECENT = Math.floor(new Date("2026-11-04T12:00:00.000Z").getTime() / 1000);

function record(id: string, jid: string, text: string, at = OLD, fromMe = false): EvolutionStoredMessage {
  return { key: { id, fromMe, remoteJid: jid }, pushName: fromMe ? "Equipo" : "Ana", message: { conversation: text }, messageTimestamp: at };
}

function setup(state: unknown = null, seed: Record<string, Array<Record<string, unknown>>> = {}) {
  const db = memoryDb(
    {
      channels: [
        { id: "ch-wa", workspace_id: "ws-1", platform: "whatsapp", provider: "evolution", is_active: true, evolution_instance: "ssa-abc", inbox_import: state },
      ],
      conversations: [],
      messages: [],
      contact_channels: [],
      automation_events: [],
      scheduled_jobs: [],
      ...seed,
    },
    {
      unique: { conversations: (a, b) => a.channel_id === b.channel_id && a.contact_id === b.contact_id },
      rpc: {
        find_or_link_contact: (args) => ({ contact_id: `contact-${args.p_sender_id}`, existed: false }),
      },
    },
  );
  return db;
}

function deps(chats: EvolutionStoredChat[], messages: Record<string, EvolutionStoredMessage[]>, over: Record<string, unknown> = {}) {
  const schedule = vi.fn(async () => undefined);
  return {
    schedule,
    d: {
      now: () => NOW,
      getConfig: async () => CONFIG,
      findChats: vi.fn(async () => chats),
      findMessages: vi.fn(async (_c: unknown, _i: unknown, jid: string) => ({ total: 1, pages: 1, records: messages[jid] ?? [] })),
      schedule: schedule as never,
      newRunId: () => "run-1",
      ...over,
    },
  };
}

const PAYLOAD = { workspaceId: "ws-1", channelId: "ch-wa", runId: "run-1", step: 0 };
const stateOf = (db: ReturnType<typeof setup>) => parseWhatsappImportState(db.rows("channels")[0].inbox_import);

describe("startWhatsappImport", () => {
  it("arma la corrida y encola la primera vuelta", async () => {
    const db = setup();
    const { d, schedule } = deps([], {});
    expect(await startWhatsappImport(db.client, { workspaceId: "ws-1", channelId: "ch-wa" }, d)).toEqual({ started: true, runId: "run-1" });
    expect(stateOf(db)?.status).toBe("running");
    expect(schedule).toHaveBeenCalledOnce();
  });

  it("un canal de otro negocio no se encuentra", async () => {
    const { d } = deps([], {});
    expect(await startWhatsappImport(setup().client, { workspaceId: "ws-2", channelId: "ch-wa" }, d)).toEqual({ started: false, reason: "not_found" });
  });

  it("dos clics no arman dos importaciones", async () => {
    const db = setup(newWhatsappImportState("vieja", NOW));
    const { d, schedule } = deps([], {});
    expect(await startWhatsappImport(db.client, { workspaceId: "ws-1", channelId: "ch-wa" }, d)).toEqual({ started: false, reason: "running" });
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("chatsToImport", () => {
  it("saca grupos y estados, y ordena por id: un chat con un mensaje nuevo no cambia de lugar", () => {
    const chats = chatsToImport([
      { remoteJid: "99999999999@lid" },
      { remoteJid: "120363001122334455@g.us" },
      { remoteJid: "status@broadcast" },
      { remoteJid: "11111111111@lid" },
    ]);
    expect(chats.map((c) => c.remoteJid)).toEqual(["11111111111@lid", "99999999999@lid"]);
  });
});

describe("runWhatsappImportStep", () => {
  it("guarda contacto, conversacion y mensajes como historia", async () => {
    const db = setup(newWhatsappImportState("run-1", NOW));
    const { d, schedule } = deps(
      [{ remoteJid: "11111111111@lid" }],
      { "11111111111@lid": [record("m2", "11111111111@lid", "gracias", OLD + 60, true), record("m1", "11111111111@lid", "ANALIZADOR")] },
    );
    expect(await runWhatsappImportStep(db.client, PAYLOAD, d)).toBe("finished");
    expect(schedule).not.toHaveBeenCalled();

    const [conversation] = db.rows("conversations");
    expect(conversation).toMatchObject({ contact_id: "contact-11111111111@lid", status: "closed", unread_count: 0, last_message_preview: "gracias" });

    const messages = db.rows("messages");
    expect(messages.map((m) => m.text)).toEqual(["ANALIZADOR", "gracias"]);
    expect(messages[0]).toMatchObject({ direction: "inbound", origin: null, workspace_id: "ws-1", conversation_id: conversation.id });
    expect(messages[1]).toMatchObject({ direction: "outbound", origin: "external" });
    expect(stateOf(db)).toMatchObject({ status: "done", conversations: 1, messages: 2, scanned: 1, total: 1 });
  });

  it("usa el telefono para buscar el contacto y no sella la interaccion de uno existente", async () => {
    const db = setup(newWhatsappImportState("run-1", NOW));
    const withPhone = record("m1", "11111111111@lid", "hola");
    withPhone.key = { ...withPhone.key, remoteJidAlt: "5491122334455@s.whatsapp.net" };
    const { d } = deps([{ remoteJid: "11111111111@lid" }], { "11111111111@lid": [withPhone] });
    await runWhatsappImportStep(db.client, PAYLOAD, d);
    expect(db.rpcCalls.find((c) => c.name === "find_or_link_contact")?.args).toMatchObject({
      p_sender_id: "+5491122334455",
      p_phone: "+5491122334455",
      p_display_name: "Ana",
      p_stamp_existing: false,
    });
  });

  it("una conversacion reciente queda abierta y sin no leidos", async () => {
    const db = setup(newWhatsappImportState("run-1", NOW));
    const { d } = deps([{ remoteJid: "11111111111@lid" }], { "11111111111@lid": [record("m1", "11111111111@lid", "hola", RECENT)] });
    await runWhatsappImportStep(db.client, PAYLOAD, d);
    expect(db.rows("conversations")[0]).toMatchObject({ status: "open", unread_count: 0 });
  });

  it("volver a importar no duplica nada, y no le toca el estado a una conversacion existente", async () => {
    const db = setup(newWhatsappImportState("run-1", NOW), {
      conversations: [{ id: "conv-1", channel_id: "ch-wa", contact_id: "contact-11111111111@lid", status: "open", unread_count: 3, last_message_preview: "lo de hoy" }],
      messages: [{ id: "x", conversation_id: "conv-1", platform_message_id: "m1", text: "ya estaba" }],
    });
    const { d } = deps([{ remoteJid: "11111111111@lid" }], { "11111111111@lid": [record("m1", "11111111111@lid", "ya estaba"), record("m0", "11111111111@lid", "viejo", OLD - 60)] });
    await runWhatsappImportStep(db.client, PAYLOAD, d);

    expect(db.rows("conversations")).toHaveLength(1);
    expect(db.rows("conversations")[0]).toMatchObject({ status: "open", unread_count: 3, last_message_preview: "lo de hoy" });
    expect(db.rows("messages").map((m) => m.platform_message_id).sort()).toEqual(["m0", "m1"]);
    expect(stateOf(db)).toMatchObject({ conversations: 0, messages: 1 });
  });

  it("no dispara automatizaciones ni la asignacion de un contacto nuevo", async () => {
    const event = { id: "e1", contact_id: "contact-11111111111@lid", event_type: "contact_created", processed_at: null, created_at: NOW.toISOString() };
    const otherEvent = { id: "e2", contact_id: "contact-11111111111@lid", event_type: "tag_added", processed_at: null, created_at: NOW.toISOString() };
    const job = { id: "j1", type: "sales_contact_eval", status: "pending", payload: { contact_id: "contact-11111111111@lid" } };
    const db = setup(newWhatsappImportState("run-1", NOW), { automation_events: [event, otherEvent], scheduled_jobs: [job] });
    const { d } = deps([{ remoteJid: "11111111111@lid" }], { "11111111111@lid": [record("m1", "11111111111@lid", "hola")] });
    await runWhatsappImportStep(db.client, PAYLOAD, d);

    const events = db.rows("automation_events");
    expect(events.find((e) => e.id === "e1")?.processed_at).toBeTruthy();
    expect(events.find((e) => e.id === "e2")?.processed_at).toBeNull();
    expect(db.rows("scheduled_jobs")[0].status).toBe("cancelled");
  });

  it("no crea un contacto para un chat sin mensajes reales", async () => {
    const db = setup(newWhatsappImportState("run-1", NOW));
    const { d } = deps([{ remoteJid: "11111111111@lid" }], { "11111111111@lid": [{ key: { id: "p", remoteJid: "11111111111@lid" }, message: { protocolMessage: {} }, messageTimestamp: OLD }] });
    await runWhatsappImportStep(db.client, PAYLOAD, d);
    expect(db.rpcCalls.filter((c) => c.name === "find_or_link_contact")).toHaveLength(0);
    expect(stateOf(db)).toMatchObject({ status: "done", scanned: 1, conversations: 0 });
  });

  it("va por partes: encola la vuelta siguiente desde donde quedo", async () => {
    const chats = Array.from({ length: CHATS_PER_STEP + 2 }, (_, i) => ({ remoteJid: `${String(i).padStart(11, "0")}@lid` }));
    const messages = Object.fromEntries(chats.map((c, i) => [c.remoteJid, [record(`m${i}`, c.remoteJid, "hola")]]));
    const db = setup(newWhatsappImportState("run-1", NOW));
    const first = deps(chats, messages);
    expect(await runWhatsappImportStep(db.client, PAYLOAD, first.d)).toBe("continued");
    expect(stateOf(db)).toMatchObject({ scanned: CHATS_PER_STEP, step: 1, cursor: "00000000024@lid", status: "running" });
    expect(first.schedule).toHaveBeenCalledOnce();

    const second = deps(chats, messages);
    expect(await runWhatsappImportStep(db.client, { ...PAYLOAD, step: 1 }, second.d)).toBe("finished");
    expect(stateOf(db)).toMatchObject({ scanned: CHATS_PER_STEP + 2, conversations: CHATS_PER_STEP + 2, status: "done" });
  });

  it("una vuelta repetida por la cola no avanza dos veces", async () => {
    const db = setup({ ...newWhatsappImportState("run-1", NOW), step: 1 });
    const { d } = deps([{ remoteJid: "11111111111@lid" }], {});
    expect(await runWhatsappImportStep(db.client, PAYLOAD, d)).toBe("superseded");
    expect(d.findChats).not.toHaveBeenCalled();
  });

  it("un fallo de Evolution no lanza: espera, y lo terminado queda", async () => {
    const db = setup(newWhatsappImportState("run-1", NOW));
    const findMessages = vi.fn(async (_c: unknown, _i: unknown, jid: string) => {
      if (jid === "22222222222@lid") throw new EvolutionError("caido", 503);
      return { total: 1, pages: 1, records: [record("m1", jid, "hola")] };
    });
    const { d, schedule } = deps([{ remoteJid: "11111111111@lid" }, { remoteJid: "22222222222@lid" }], {}, { findMessages });
    expect(await runWhatsappImportStep(db.client, PAYLOAD, d)).toBe("waiting");
    expect(stateOf(db)).toMatchObject({ status: "running", cursor: "11111111111@lid", scanned: 1, messages: 1, retries: 1 });
    expect(schedule).toHaveBeenCalledOnce();
  });

  it("una clave rechazada corta con el motivo", async () => {
    const db = setup(newWhatsappImportState("run-1", NOW));
    const findChats = vi.fn(async () => {
      throw new EvolutionError("no", 401);
    });
    const { d, schedule } = deps([], {}, { findChats });
    expect(await runWhatsappImportStep(db.client, PAYLOAD, d)).toBe("finished");
    expect(stateOf(db)?.status).toBe("partial");
    expect(stateOf(db)?.last_error).toContain("rechazó la clave");
    expect(schedule).not.toHaveBeenCalled();
  });

  it("sin configuracion de Evolution queda incompleta", async () => {
    const db = setup(newWhatsappImportState("run-1", NOW));
    const { d } = deps([], {}, { getConfig: async () => null });
    expect(await runWhatsappImportStep(db.client, PAYLOAD, d)).toBe("finished");
    expect(stateOf(db)?.last_error).toContain("Falta la configuración");
  });

  it("un chat cortado en el tope se avisa, no se pierde en silencio", async () => {
    const db = setup(newWhatsappImportState("run-1", NOW));
    const findMessages = vi.fn(async (_c: unknown, _i: unknown, jid: string, page: number) => ({
      total: 99_999,
      pages: 500,
      records: [record(`m${page}`, jid, "hola")],
    }));
    const { d } = deps([{ remoteJid: "11111111111@lid" }], {}, { findMessages });
    await runWhatsappImportStep(db.client, PAYLOAD, d);
    expect(findMessages).toHaveBeenCalledTimes(100);
    expect(stateOf(db)).toMatchObject({ status: "partial", failed: 1, messages: 100 });
  });
});
