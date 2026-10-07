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

const storeEvolutionMedia = vi.fn();
const describeWhatsappMessage = vi.fn();
vi.mock("@/lib/evolution-media", async (importOriginal) => {
  // describeWhatsappMessage es puro (normaliza el nodo de Baileys) y se quiere
  // el de verdad: es lo que fija que una foto con caption conserve la foto.
  const actual = await importOriginal<typeof import("@/lib/evolution-media")>();
  return { ...actual, storeEvolutionMedia };
});

// El registro del toque (F85) tiene sus propios tests: aca se prueba que la ruta
// lo llame con lo correcto y que un fallo suyo no frene nada. La lectura del
// anuncio de Baileys corre de verdad.
const recordInboundTouch = vi.fn();
vi.mock("@/lib/contacts/touch-inbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contacts/touch-inbound")>();
  return { ...actual, recordInboundTouch };
});

const getEvolutionConfig = vi.fn();
vi.mock("@/lib/evolution-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/evolution-config")>();
  return { ...actual, getEvolutionConfig };
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
  // Desde F4 devuelve el id: la ingesta de media vuelve sobre la fila cuando
  // el archivo termina de bajar.
  insertMessage.mockResolvedValue({ stored: true, id: "msg-1" });
  storeEvolutionMedia.mockResolvedValue({ items: [], stored: 0, failed: 0 });
  getEvolutionConfig.mockResolvedValue({ baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" });
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

  it("con un token equivocado responde 401 sin procesar el mensaje", async () => {
    // Desde F4 el token es por workspace, y para saber de que workspace es
    // este mensaje hay que buscar el canal por su instancia. Por eso la ruta
    // consulta la base ANTES de validar el token, que es lo unico que cambio:
    // el codigo sigue siendo 401 y no se escribe ni se procesa nada.
    db();
    const res = await callRoute(post(message(), { "x-webhook-token": "otro" }));

    expect(res.status).toBe(401);
    await runAfter();
    expect(insertMessage).not.toHaveBeenCalled();
    expect(claimWebhookEvent).not.toHaveBeenCalled();
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

  it("un mensaje sin texto guarda el adjunto normalizado (F1, F4)", async () => {
    db();
    await callRoute(
      post(message({ message: { imageMessage: { url: "x", mimetype: "image/jpeg" } }, messageType: "imageMessage" })),
    );
    await runAfter();

    // Antes se guardaba el nodo crudo de Baileys, que la burbuja no entiende.
    expect(insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: {
          v: 2,
          items: [expect.objectContaining({ kind: "image", mime: "image/jpeg", status: "pending" })],
        },
      }),
    );
  });

  it("EL ARREGLO (F4): una imagen CON caption guarda el texto Y el adjunto", async () => {
    db();
    await callRoute(
      post(
        message({
          message: { imageMessage: { url: "x", mimetype: "image/jpeg", caption: "mira el presupuesto" } },
          messageType: "imageMessage",
        }),
      ),
    );
    await runAfter();

    const insert = insertMessage.mock.calls[0][0];
    // Hasta ahora era `attachments: text ? null : data.message`: con caption,
    // la media se perdia sin que nada lo indicara.
    expect(insert.text).toBe("mira el presupuesto");
    expect(insert.attachments.items).toEqual([expect.objectContaining({ kind: "image", status: "pending" })]);
    expect(storeEvolutionMedia).toHaveBeenCalled();
  });

  it("una nota de voz guarda su duracion y su mime, y se le pide el archivo a Evolution (F4)", async () => {
    db();
    await callRoute(
      post(
        message({
          message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 12, ptt: true } },
          messageType: "audioMessage",
        }),
      ),
    );
    await runAfter();

    expect(insertMessage.mock.calls[0][0].attachments.items).toEqual([
      expect.objectContaining({ kind: "voice", durationSeconds: 12, mime: "audio/ogg", status: "pending" }),
    ]);
    expect(storeEvolutionMedia).toHaveBeenCalledWith(
      // El objeto completo, no solo el id (F4, §14c).
      expect.objectContaining({
        messageId: "msg-1",
        rawMessage: expect.objectContaining({ audioMessage: expect.anything() }),
        instance: INSTANCE,
      }),
    );
    // Y el preview de la lista lo dice con palabras.
    expect(upsertConversation).toHaveBeenCalledWith(expect.objectContaining({ preview: "🎤 Nota de voz" }));
  });

  it("una ubicacion se guarda como etiqueta y NO se le pide ningun archivo (F4)", async () => {
    db();
    await callRoute(
      post(
        message({
          message: { locationMessage: { degreesLatitude: -34.6, degreesLongitude: -58.4 } },
          messageType: "locationMessage",
        }),
      ),
    );
    await runAfter();

    expect(insertMessage.mock.calls[0][0].attachments.items).toEqual([
      expect.objectContaining({ kind: "location", status: "none" }),
    ]);
    // Si se intentara bajar, el spinner quedaria girando para siempre.
    expect(storeEvolutionMedia).not.toHaveBeenCalled();
  });

  it("sin configuracion de Evolution no se rompe: el mensaje queda guardado (F4)", async () => {
    db();
    getEvolutionConfig.mockResolvedValue(null);

    await callRoute(
      post(message({ message: { audioMessage: { mimetype: "audio/ogg", ptt: true } }, messageType: "audioMessage" })),
    );
    await runAfter();

    expect(insertMessage).toHaveBeenCalled();
    expect(storeEvolutionMedia).not.toHaveBeenCalled();
  });

  it("un mensaje de texto pelado no pide ningun archivo", async () => {
    db();
    await callRoute(post(message()));
    await runAfter();

    expect(insertMessage.mock.calls[0][0].attachments).toBeNull();
    expect(storeEvolutionMedia).not.toHaveBeenCalled();
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
          pushName: "Ana",
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


describe("webhook de Evolution: el toque de atribución del mensaje (F85)", () => {
  it("un contacto nuevo: registra el toque de WhatsApp con el mensaje y el contacto", async () => {
    db();
    upsertContactForSender.mockResolvedValue({ contactId: "contact-9", existed: false });

    await callRoute(post(message()));
    await runAfter();

    expect(recordInboundTouch).toHaveBeenCalledTimes(1);
    expect(recordInboundTouch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contactId: "contact-9",
        conversationId: "conv-1",
        platform: "whatsapp",
        contactExisted: false,
        platformMessageId: "msg-1",
        messageId: "msg-1",
        referral: null,
      }),
    );
  });

  it("un mensaje de un anuncio de 'clic a WhatsApp': pasa el ctwa_clid y el anuncio", async () => {
    db();
    const externalAdReply = { sourceType: "ad", sourceId: "ad-55", ctwaClid: "ctwa-1", title: "Mentoría" };

    await callRoute(
      post(message({ message: { extendedTextMessage: { text: "hola", contextInfo: { externalAdReply } } } })),
    );
    await runAfter();

    expect(recordInboundTouch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        referral: expect.objectContaining({ adId: "ad-55", ctwaClid: "ctwa-1", title: "Mentoría" }),
      }),
    );
  });

  it("lo que sale desde el teléfono NO es un toque del lead", async () => {
    db();

    await callRoute(post(message({ key: { remoteJid: "5491122223333@s.whatsapp.net", fromMe: true, id: "msg-eco" } })));
    await runAfter();

    expect(recordInboundTouch).not.toHaveBeenCalled();
  });

  it("va DESPUES de guardar el mensaje", async () => {
    db();
    const order: string[] = [];
    insertMessage.mockImplementation(async () => {
      order.push("mensaje");
      return { stored: true, id: "msg-1" };
    });
    recordInboundTouch.mockImplementation(async () => void order.push("toque"));

    await callRoute(post(message()));
    await runAfter();

    expect(order).toEqual(["mensaje", "toque"]);
  });

  it("si el registro LANZA, el mensaje ya está guardado y el flow y el agente corren igual", async () => {
    db();
    recordInboundTouch.mockRejectedValue(new Error("se cayo la atribucion"));

    const response = await callRoute(post(message()));
    await runAfter();

    expect(response.status).toBe(200);
    expect(insertMessage).toHaveBeenCalled();
    expect(runInboundAutomation).toHaveBeenCalled();
    expect(maybeScheduleAgentTurn).toHaveBeenCalled();
  });

  it("el mismo mensaje dos veces registra UN solo toque", async () => {
    db();
    claimWebhookEvent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await callRoute(post(message()));
    await callRoute(post(message()));
    await runAfter();

    expect(recordInboundTouch).toHaveBeenCalledTimes(1);
  });
});
