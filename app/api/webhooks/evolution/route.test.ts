/**
 * Caracterizacion del receptor de Evolution (WhatsApp) — como funciona HOY.
 *
 * Se escribe ANTES de tocar de donde sale el token (F4 de la etapa 2: pasa de
 * las variables de entorno a Vault, por workspace, con fallback a las
 * variables). Este archivo es la red: los codigos de respuesta y el camino del
 * mensaje tienen que quedar iguales despues del cambio.
 *
 * Nada llama afuera: Evolution, Supabase y todo el pipeline del mensaje estan
 * simulados.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

// `after()` necesita el contexto de un request de Next, que en un test no
// existe. Se junta la tarea y el test la corre cuando quiere: asi las
// afirmaciones sobre el procesamiento son deterministas.
const afterTasks: Array<() => Promise<void> | void> = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => Promise<void> | void) => void afterTasks.push(fn) };
});

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

const upsertContactForSender = vi.fn();
vi.mock("@/lib/inbox-sync", () => ({ upsertContactForSender }));

const claimWebhookEvent = vi.fn();
const upsertConversation = vi.fn();
const insertMessage = vi.fn();
const applyOptOut = vi.fn();
const runInboundAutomation = vi.fn();
const pauseSequencesOnReply = vi.fn();
vi.mock("@/lib/inbound", () => ({
  claimWebhookEvent,
  upsertConversation,
  insertMessage,
  applyOptOut,
  runInboundAutomation,
  pauseSequencesOnReply,
}));

const maybeScheduleAgentTurn = vi.fn();
vi.mock("@/lib/agent/dispatch", () => ({ maybeScheduleAgentTurn }));

const discardPendingDrafts = vi.fn();
const supersedePendingDrafts = vi.fn();
vi.mock("@/lib/agent/drafts/lifecycle", () => ({ discardPendingDrafts, supersedePendingDrafts }));

const TOKEN = "token-de-prueba";
const WS = "ws-1";
const CHANNEL_ID = "ch-1";
const INSTANCE = "ssa-abcd1234";

function channelRow(extra: Record<string, unknown> = {}) {
  return {
    id: CHANNEL_ID,
    workspace_id: WS,
    platform: "whatsapp",
    provider: "evolution",
    evolution_instance: INSTANCE,
    late_account_id: `evolution:${INSTANCE}`,
    username: "wa",
    is_active: true,
    connection_status: "connected",
    webhook_secret: null,
    ...extra,
  };
}

function db(channels: Array<Record<string, unknown>> = [channelRow()]) {
  const memory = memoryDb({ channels });
  createServiceClient.mockResolvedValue(memory.client);
  return memory;
}

function post(body: unknown, headers: Record<string, string> = { "x-webhook-token": TOKEN }) {
  return new Request("https://app.test/api/webhooks/evolution", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** El handler de la ruta, importado despues de los mocks. */
async function callRoute(request: Request) {
  const { POST } = await import("./route");
  // NextRequest y Request son compatibles para lo que usa el handler.
  return POST(request as never);
}

async function runAfter() {
  while (afterTasks.length) await afterTasks.shift()!();
}

const message = (over: Record<string, unknown> = {}) => ({
  event: "messages.upsert",
  instance: INSTANCE,
  data: {
    key: { remoteJid: "5491122223333@s.whatsapp.net", fromMe: false, id: "msg-1" },
    pushName: "Lead de prueba",
    message: { conversation: "hola, me interesa" },
    messageType: "conversation",
    messageTimestamp: 1_760_000_000,
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks.length = 0;
  process.env.EVOLUTION_WEBHOOK_TOKEN = TOKEN;
  claimWebhookEvent.mockResolvedValue(true);
  upsertContactForSender.mockResolvedValue({ contactId: "contact-1", existed: true });
  upsertConversation.mockResolvedValue({ id: "conv-1", isAutomationPaused: false });
  insertMessage.mockResolvedValue(undefined);
  applyOptOut.mockResolvedValue({ matched: false });
  runInboundAutomation.mockResolvedValue({ claimedBy: null });
});

afterEach(() => {
  vi.resetModules();
});

describe("webhook de Evolution: el token", () => {
  it("con el token correcto acepta el mensaje y responde 200", async () => {
    db();
    const res = await callRoute(post(message()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, queued: true });
  });

  it("con un token equivocado responde 401 y no mira la base", async () => {
    db();
    const res = await callRoute(post(message(), { "x-webhook-token": "otro" }));

    expect(res.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("sin el header responde 401", async () => {
    db();
    const res = await callRoute(post(message(), {}));

    expect(res.status).toBe(401);
  });

  it("sin token configurado en el entorno responde 500, no 401", async () => {
    // El 401 mentiria: no es que el que llama se equivoco, es que falta
    // configurar el sistema.
    delete process.env.EVOLUTION_WEBHOOK_TOKEN;
    db();
    const res = await callRoute(post(message()));

    expect(res.status).toBe(500);
  });
});

describe("webhook de Evolution: que mensajes procesa", () => {
  it("un cuerpo que no es JSON responde 400", async () => {
    db();
    const res = await callRoute(post("{no soy json"));

    expect(res.status).toBe(400);
  });

  it("una instancia que no es nuestra se ignora con 200", async () => {
    // El mismo Evolution puede estar compartido con otro sistema.
    db([channelRow({ evolution_instance: "otra-instancia" })]);
    const res = await callRoute(post(message()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "instancia desconocida" });
    expect(claimWebhookEvent).not.toHaveBeenCalled();
  });

  it("un evento que no nos interesa se ignora con 200", async () => {
    db();
    const res = await callRoute(post({ event: "CHATS_SET", instance: INSTANCE }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "chats.set" });
  });

  it("un mensaje de grupo no se procesa: no hay un lead detras", async () => {
    db();
    const res = await callRoute(
      post(message({ key: { remoteJid: "123-456@g.us", fromMe: false, id: "m" } })),
    );

    expect(await res.json()).toEqual({ ok: true, skipped: "sin telefono utilizable" });
  });

  it("el mismo mensaje dos veces se procesa una sola vez", async () => {
    db();
    claimWebhookEvent.mockResolvedValueOnce(false);
    const res = await callRoute(post(message()));

    expect(await res.json()).toEqual({ ok: true, skipped: "evento repetido" });
    await runAfter();
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it("la idempotencia usa el id del canal y del mensaje", async () => {
    db();
    await callRoute(post(message()));

    expect(claimWebhookEvent).toHaveBeenCalledWith(expect.anything(), `evolution:${CHANNEL_ID}:msg-1`);
  });
});

describe("webhook de Evolution: el camino del mensaje del lead", () => {
  it("guarda el entrante, pausa secuencias, evalua opt-out, automatiza y agenda al agente", async () => {
    db();
    await callRoute(post(message()));
    await runAfter();

    expect(upsertContactForSender).toHaveBeenCalledWith(
      expect.objectContaining({ senderPhone: "+5491122223333", senderName: "Lead de prueba" }),
    );
    expect(insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        direction: "inbound",
        text: "hola, me interesa",
        platformMessageId: "msg-1",
        workspaceId: WS,
        origin: null,
      }),
    );
    expect(supersedePendingDrafts).toHaveBeenCalledWith(expect.anything(), "conv-1");
    expect(pauseSequencesOnReply).toHaveBeenCalled();
    expect(applyOptOut).toHaveBeenCalled();
    expect(runInboundAutomation).toHaveBeenCalled();
    expect(maybeScheduleAgentTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: WS, channelId: CHANNEL_ID, conversationId: "conv-1" }),
    );
  });

  it("si el lead pidio que no le escriban, no se automatiza ni se agenda al agente", async () => {
    db();
    applyOptOut.mockResolvedValue({ matched: true });
    await callRoute(post(message({ message: { conversation: "stop" } })));
    await runAfter();

    expect(insertMessage).toHaveBeenCalled();
    expect(runInboundAutomation).not.toHaveBeenCalled();
    expect(maybeScheduleAgentTurn).not.toHaveBeenCalled();
  });

  it("un mensaje sin texto guarda el adjunto crudo", async () => {
    db();
    await callRoute(post(message({ message: { imageMessage: { url: "x" } }, messageType: "imageMessage" })));
    await runAfter();

    expect(insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: { imageMessage: { url: "x" } } }),
    );
  });
});

describe("webhook de Evolution: lo que se manda desde el telefono", () => {
  it("se guarda como saliente externo y no dispara nada", async () => {
    db();
    await callRoute(post(message({ key: { remoteJid: "5491122223333@s.whatsapp.net", fromMe: true, id: "m2" } })));
    await runAfter();

    expect(insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "outbound", origin: "external" }),
    );
    // Es una respuesta real por otro lado: el borrador pendiente se descarta,
    // no se reemplaza.
    expect(discardPendingDrafts).toHaveBeenCalled();
    expect(supersedePendingDrafts).not.toHaveBeenCalled();
    expect(pauseSequencesOnReply).not.toHaveBeenCalled();
    expect(applyOptOut).not.toHaveBeenCalled();
    expect(runInboundAutomation).not.toHaveBeenCalled();
    expect(maybeScheduleAgentTurn).not.toHaveBeenCalled();
  });

  it("no usa nuestro nombre para la ficha del lead", async () => {
    db();
    await callRoute(
      post(
        message({
          key: { remoteJid: "5491122223333@s.whatsapp.net", fromMe: true, id: "m3" },
          pushName: "Wendy",
        }),
      ),
    );
    await runAfter();

    expect(upsertContactForSender).toHaveBeenCalledWith(
      expect.objectContaining({ senderName: "+5491122223333" }),
    );
  });
});

describe("webhook de Evolution: el estado de la conexion", () => {
  it("state open deja el canal conectado y limpia el aviso de caida", async () => {
    const memory = db();
    const res = await callRoute(post({ event: "connection.update", instance: INSTANCE, data: { state: "open" } }));

    expect(await res.json()).toEqual({ ok: true, state: "open" });
    const channel = memory.rows("channels")[0];
    expect(channel.connection_status).toBe("connected");
    expect(channel.is_active).toBe(true);
    expect(channel.last_error).toBeNull();
    expect(channel.disconnected_notified_at).toBeNull();
  });

  it("state close con motivo 401 pide volver a escanear el QR", async () => {
    const memory = db();
    await callRoute(
      post({ event: "connection.update", instance: INSTANCE, data: { state: "close", statusReason: 401 } }),
    );

    const channel = memory.rows("channels")[0];
    expect(channel.connection_status).toBe("disconnected");
    expect(String(channel.last_error)).toContain("QR");
  });

  it("state connecting queda en conectando", async () => {
    const memory = db();
    await callRoute(post({ event: "connection.update", instance: INSTANCE, data: { state: "connecting" } }));

    expect(memory.rows("channels")[0].connection_status).toBe("connecting");
  });
});
