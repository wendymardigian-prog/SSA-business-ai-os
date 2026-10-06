/**
 * Caracterizacion del receptor de Zernio (Instagram: DMs, story replies y
 * comentarios) — como funciona HOY.
 *
 * Se escribe ANTES de dos cambios de la etapa 2:
 *   - F5: el secreto de la firma pasa a leerse de Vault, con fallback a las
 *     columnas de hoy.
 *   - F46: el receptor de comentarios busca la cuenta tambien en
 *     social_accounts y guarda el comentario (incluidos los propios).
 *
 * Lo que este archivo fija tiene que seguir valiendo despues de los dos: firma
 * invalida rechazada, comentario de un tercero disparando processComment igual
 * que hoy, y comentario propio sin disparar nada.
 *
 * Nada llama afuera: Zernio, Supabase y el pipeline del mensaje estan simulados.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const afterTasks: Array<() => Promise<void> | void> = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => Promise<void> | void) => void afterTasks.push(fn) };
});

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

const upsertContactForSender = vi.fn();
vi.mock("@/lib/inbox-sync", () => ({ upsertContactForSender }));

const processComment = vi.fn();
vi.mock("@/lib/comment-processor", () => ({ processComment }));

const claimWebhookEvent = vi.fn();
const upsertConversation = vi.fn();
const persistInboundMessage = vi.fn();
const applyOptOut = vi.fn();
const runInboundAutomation = vi.fn();
const pauseSequencesOnReply = vi.fn();
const handleMessageSentEcho = vi.fn();
vi.mock("@/lib/inbound", () => ({
  claimWebhookEvent,
  upsertConversation,
  persistInboundMessage,
  applyOptOut,
  runInboundAutomation,
  pauseSequencesOnReply,
  handleMessageSentEcho,
}));

const maybeScheduleAgentTurn = vi.fn();
vi.mock("@/lib/agent/dispatch", () => ({ maybeScheduleAgentTurn }));

const supersedePendingDrafts = vi.fn();
vi.mock("@/lib/agent/drafts/lifecycle", () => ({ supersedePendingDrafts }));

const storeInboundMedia = vi.fn();
vi.mock("@/lib/inbound-media", () => ({ storeInboundMedia }));

// El registro del toque (F85) tiene sus propios tests: aca se prueba que la ruta
// lo llame con lo correcto y que un fallo suyo no frene nada. Lo demas del modulo
// (la lectura del referral) corre de verdad.
const recordInboundTouch = vi.fn();
vi.mock("@/lib/contacts/touch-inbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contacts/touch-inbound")>();
  return { ...actual, recordInboundTouch };
});

const WS = "ws-1";
const ACCOUNT = "late-account-1";
const SECRET = "secreto-del-workspace";

function channelRow(extra: Record<string, unknown> = {}) {
  return {
    id: "ch-1",
    workspace_id: WS,
    platform: "instagram",
    provider: "zernio",
    late_account_id: ACCOUNT,
    username: "minegocio",
    is_active: true,
    webhook_secret: null,
    ...extra,
  };
}

function db(
  options: {
    channels?: Array<Record<string, unknown>>;
    /** El secreto que devuelve Vault. null = no hay secreto guardado. */
    workspaceSecret?: string | null;
    /** Cuentas de publicacion y metricas (F46): TikTok solo vive aca. */
    social_accounts?: Array<Record<string, unknown>>;
  } = {},
) {
  // Ojo con `??`: workspaceSecret null es "Vault NO tiene secreto", y tiene
  // que llegar null, no convertirse en el secreto bueno.
  const vaultSecret = "workspaceSecret" in options ? options.workspaceSecret : SECRET;

  const memory = memoryDb(
    {
      channels: options.channels ?? [channelRow()],
      social_accounts: options.social_accounts ?? [],
      social_posts: [],
      social_post_comments: [],
      contacts: [],
      workspaces: [{ id: WS }],
    },
    {
      // Desde la 00090 el secreto sale SOLO de Vault: las columnas viejas se
      // borraron y el respaldo con ellas.
      rpc: {
        read_secret: (args) =>
          args.secret_name === "zernio_webhook_secret" ? vaultSecret : null,
      },
    },
  );
  createServiceClient.mockResolvedValue(memory.client);
  return memory;
}

function sign(body: string, secret = SECRET) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function post(payload: unknown, options: { signature?: string | null; secret?: string } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const signature =
    options.signature === undefined ? sign(body, options.secret ?? SECRET) : options.signature;
  if (signature) headers["x-late-signature"] = signature;
  return new Request("https://app.test/api/webhooks/late", { method: "POST", headers, body });
}

async function callRoute(request: Request) {
  const { POST } = await import("./route");
  return POST(request as never);
}

async function runAfter() {
  while (afterTasks.length) await afterTasks.shift()!();
}

/** Un DM entrante. `over.message` se mezcla con el mensaje base, no lo reemplaza. */
const dm = (over: { message?: Record<string, unknown>; [k: string]: unknown } = {}) => {
  const { message, ...rest } = over;
  return {
    id: "evt-1",
    event: "message.received",
    account: { id: ACCOUNT, platform: "instagram", username: "minegocio" },
    conversation: { id: "zconv-1" },
    ...rest,
    message: {
      id: "6ab5aaaaaaaaaaaaaaaaaaaa",
      platformMessageId: "aWdfZG1fMTIz",
      direction: "incoming",
      text: "hola, quiero info",
      sender: { id: "sender-1", username: "unlead", name: "Un Lead" },
      sentAt: "2026-09-26T12:00:00.000Z",
      ...message,
    },
  };
};

/** Un comentario. `over.comment` se mezcla con el comentario base. */
const comment = (over: { comment?: Record<string, unknown>; [k: string]: unknown } = {}) => {
  const { comment: c, ...rest } = over;
  return {
    id: "evt-c1",
    event: "comment.received",
    account: { id: ACCOUNT, platform: "instagram", username: "minegocio" },
    post: { id: "post-1", platformPostId: "ig-post-1" },
    ...rest,
    comment: {
      id: "comment-1",
      postId: "post-1",
      platformPostId: "ig-post-1",
      text: "SISTEMA",
      author: { id: "author-1", username: "unlead", name: "Un Lead" },
      ...c,
    },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks.length = 0;
  claimWebhookEvent.mockResolvedValue(true);
  upsertContactForSender.mockResolvedValue({ contactId: "contact-1", existed: true });
  upsertConversation.mockResolvedValue({ id: "conv-1", isAutomationPaused: false });
  // Desde F3 devuelve el id del mensaje: la ingesta de media lo necesita
  // para volver sobre la fila cuando el archivo termina de bajar.
  persistInboundMessage.mockResolvedValue({ stored: true, id: "msg-1" });
  applyOptOut.mockResolvedValue({ matched: false });
  runInboundAutomation.mockResolvedValue({ claimedBy: null });
  handleMessageSentEcho.mockResolvedValue({ stored: true, messageId: "msg-eco", conversationId: "conv-1" });
  storeInboundMedia.mockResolvedValue({ items: [], stored: 0, failed: 0 });
});

afterEach(() => {
  vi.resetModules();
});

describe("webhook de Zernio: la firma", () => {
  it("con la firma correcta acepta el DM y responde 200", async () => {
    db();
    const res = await callRoute(post(dm()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, queued: true });
  });

  it("con una firma equivocada responde 401 y no procesa nada", async () => {
    db();
    const res = await callRoute(post(dm(), { signature: sign("otro cuerpo") }));

    expect(res.status).toBe(401);
    await runAfter();
    expect(persistInboundMessage).not.toHaveBeenCalled();
  });

  it("sin el header de firma responde 401", async () => {
    db();
    const res = await callRoute(post(dm(), { signature: null }));

    expect(res.status).toBe(401);
  });

  it("sin secreto configurado en ningun lado responde 401, no acepta a ciegas", async () => {
    db({ workspaceSecret: null });
    const res = await callRoute(post(dm(), { signature: null }));

    expect(res.status).toBe(401);
  });

  it("el secreto viejo del canal YA NO vale: solo Vault", async () => {
    // CAMBIO DOCUMENTADO (00090). Habia dos respaldos —la columna del
    // workspace y la del canal— para que Instagram siguiera entrando
    // mientras el secreto no estuviera en Vault. El secreto se movio, las
    // columnas se borraron, y aceptar una firma hecha con el secreto viejo
    // seria aceptar una que ya no se puede rotar.
    db({ workspaceSecret: null, channels: [channelRow({ webhook_secret: "secreto-viejo-del-canal" })] });
    const res = await callRoute(post(dm(), { secret: "secreto-viejo-del-canal" }));

    expect(res.status).toBe(401);
  });

  it("el cuerpo firmado es el crudo: reordenar el JSON invalida la firma", async () => {
    db();
    const body = JSON.stringify(dm());
    const otherOrder = JSON.stringify({ ...dm(), id: "evt-1" });
    const res = await callRoute(
      new Request("https://app.test/api/webhooks/late", {
        method: "POST",
        headers: { "content-type": "application/json", "x-late-signature": sign(body + " ") },
        body: otherOrder,
      }),
    );

    expect(res.status).toBe(401);
  });
});

describe("webhook de Zernio: que eventos procesa", () => {
  it("un cuerpo que no es JSON responde 400", async () => {
    db();
    const res = await callRoute(post("{no soy json"));

    expect(res.status).toBe(400);
  });

  it("una cuenta que no es un canal activo responde 404", async () => {
    db({ channels: [channelRow({ late_account_id: "otra-cuenta" })] });
    const res = await callRoute(post(dm()));

    expect(res.status).toBe(404);
  });

  it("un canal desactivado tambien responde 404", async () => {
    db({ channels: [channelRow({ is_active: false })] });
    const res = await callRoute(post(dm()));

    expect(res.status).toBe(404);
  });

  it("un evento que no nos interesa se ignora con 200 y sin mirar la firma", async () => {
    db();
    const res = await callRoute(post({ id: "e", event: "post.scheduled" }, { signature: null }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "post.scheduled" });
  });

  it("un saliente que llega como message.received se ignora", async () => {
    db();
    const res = await callRoute(post(dm({ message: { direction: "outgoing" } })));

    expect(await res.json()).toEqual({ ok: true, skipped: "mensaje saliente" });
  });

  it("un mensaje de otra cuenta propia del workspace se ignora antes de la firma", async () => {
    db();
    const res = await callRoute(
      post(dm({ message: { sender: { id: "s", username: "minegocio" } } }), { signature: null }),
    );

    expect(await res.json()).toEqual({ ok: true, skipped: "el remitente es una cuenta propia" });
  });

  it("el mismo evento dos veces se procesa una sola vez", async () => {
    db();
    claimWebhookEvent.mockResolvedValueOnce(false);
    const res = await callRoute(post(dm()));

    expect(await res.json()).toEqual({ ok: true, skipped: "evento repetido" });
  });

  it("message.sent se guarda como eco de un saliente externo", async () => {
    db();
    const payload = {
      id: "evt-s1",
      event: "message.sent",
      account: { id: ACCOUNT, platform: "instagram", username: "minegocio" },
      conversation: { id: "zconv-1" },
      message: { id: "m-out", text: "respondido a mano", sentAt: "2026-09-26T12:05:00.000Z" },
    };
    const res = await callRoute(post(payload));

    expect(res.status).toBe(200);
    await runAfter();
    expect(handleMessageSentEcho).toHaveBeenCalled();
  });
});

describe("webhook de Zernio: el camino del DM", () => {
  it("guarda los dos ids del mensaje, automatiza y agenda al agente", async () => {
    db();
    await callRoute(post(dm()));
    await runAfter();

    expect(persistInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        text: "hola, quiero info",
        // El de Zernio es el que deduplica; el nativo de Meta va en su columna.
        platformMessageId: "6ab5aaaaaaaaaaaaaaaaaaaa",
        platformNativeMessageId: "aWdfZG1fMTIz",
      }),
    );
    expect(runInboundAutomation).toHaveBeenCalled();
    expect(maybeScheduleAgentTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: WS, conversationId: "conv-1" }),
    );
  });

  it("una nota de voz entra con el adjunto en pending y se copia el archivo (F3)", async () => {
    db();
    await callRoute(
      post(dm({ message: { text: null, attachments: [{ type: "audio", url: "https://cdn.meta/nota.m4a" }] } })),
    );
    await runAfter();

    // Se inserta con la forma nueva y el adjunto todavia sin archivo.
    const insert = persistInboundMessage.mock.calls[0][0];
    expect(insert.attachments).toEqual({
      v: 2,
      items: [expect.objectContaining({ kind: "audio", sourceUrl: "https://cdn.meta/nota.m4a", status: "pending" })],
    });

    // Y despues se baja, en el mismo after(): la URL de Meta vence.
    expect(storeInboundMedia).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, conversationId: "conv-1", messageId: "msg-1" }),
    );
  });

  it("un DM sin texto deja una etiqueta en el preview, no una fila en blanco (F15)", async () => {
    db();
    await callRoute(post(dm({ message: { text: null, attachments: [{ type: "audio", url: "https://cdn/a.m4a" }] } })));
    await runAfter();

    expect(upsertConversation).toHaveBeenCalledWith(expect.objectContaining({ preview: "🎵 Audio" }));
  });

  it("la respuesta a una historia se guarda como adjunto: hoy se descartaba (F3)", async () => {
    db();
    await callRoute(
      post(
        dm({
          message: { text: "me encanto" },
          metadata: { storyReply: { storyId: "st-1", storyUrl: "https://cdn/story.jpg" } },
        }),
      ),
    );
    await runAfter();

    const insert = persistInboundMessage.mock.calls[0][0];
    expect(insert.attachments.items).toEqual([
      expect.objectContaining({ kind: "story_reply", meta: { storyId: "st-1", storyUrl: "https://cdn/story.jpg" } }),
    ]);
  });

  it("un reel compartido en el texto queda como tarjeta con link (F3)", async () => {
    db();
    await callRoute(post(dm({ message: { text: "mira https://www.instagram.com/reel/Cabc123/" } })));
    await runAfter();

    const insert = persistInboundMessage.mock.calls[0][0];
    expect(insert.attachments.items).toEqual([
      expect.objectContaining({ kind: "share", meta: { url: "https://www.instagram.com/reel/Cabc123" } }),
    ]);
    // El texto se conserva igual: el link no lo reemplaza.
    expect(insert.text).toBe("mira https://www.instagram.com/reel/Cabc123/");
  });

  it("un DM de texto pelado no guarda adjuntos ni llama a la descarga", async () => {
    db();
    await callRoute(post(dm()));
    await runAfter();

    expect(persistInboundMessage.mock.calls[0][0].attachments).toBeNull();
    expect(storeInboundMedia).not.toHaveBeenCalled();
  });

  it("si el lead pidio que no le escriban, no se automatiza ni se agenda al agente", async () => {
    db();
    applyOptOut.mockResolvedValue({ matched: true });
    await callRoute(post(dm({ message: { text: "STOP" } })));
    await runAfter();

    expect(persistInboundMessage).toHaveBeenCalled();
    expect(runInboundAutomation).not.toHaveBeenCalled();
    expect(maybeScheduleAgentTurn).not.toHaveBeenCalled();
  });
});

describe("webhook de Zernio: comentarios", () => {
  it("un comentario de un tercero dispara processComment con el id del post", async () => {
    db();
    const res = await callRoute(post(comment()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, queued: true });
    await runAfter();
    expect(processComment).toHaveBeenCalledWith(
      expect.objectContaining({
        comment: expect.objectContaining({ id: "comment-1", postId: "post-1", text: "SISTEMA" }),
      }),
    );
  });

  it("sin postId propio usa el id del post en la plataforma", async () => {
    // Un post publicado a mano no tiene postId de Zernio: sin este fallback la
    // automatizacion por comentario no correria nunca en esos posts.
    db();
    await callRoute(post(comment({ comment: { postId: null } })));
    await runAfter();

    expect(processComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment: expect.objectContaining({ postId: "ig-post-1" }) }),
    );
  });

  it("un comentario propio no dispara automatizaciones", async () => {
    // CAMBIO DOCUMENTADO (F46): antes se cortaba antes de validar la firma y
    // se contestaba "comentario propio". Ahora se GUARDA —el hilo tiene que
    // leerse completo, con la respuesta del negocio adentro— y lo que no
    // pasa, que es lo que este caso protege, es que dispare el flow: un bot
    // contestandose solo.
    db();
    const res = await callRoute(post(comment({ comment: { author: { id: "a", username: "minegocio" } } })));

    expect(res.status).toBe(200);
    await runAfter();
    expect(processComment).not.toHaveBeenCalled();
  });

  it("una cuenta de TikTok, que no tiene canal, ya no rebota", async () => {
    // Antes de F46 la cuenta se buscaba SOLO en channels y no puede existir
    // un canal de TikTok: el comentario se perdia con un 404.
    db({
      channels: [channelRow({ late_account_id: "otra-cuenta" })],
      social_accounts: [
        {
          id: "sa-1",
          workspace_id: "ws-1",
          platform: "tiktok",
          username: "minegocio",
          external_id: "late-account-1",
        },
      ],
    });

    const res = await callRoute(post(comment()));

    expect(res.status).toBe(200);
  });

  it("un comentario con firma invalida se rechaza con 401", async () => {
    db();
    const res = await callRoute(post(comment(), { signature: sign("otra cosa") }));

    expect(res.status).toBe(401);
    await runAfter();
    expect(processComment).not.toHaveBeenCalled();
  });

  it("una cuenta que no es un canal responde 404", async () => {
    // Hoy la cuenta se busca SOLO en channels, y no puede existir un canal de
    // TikTok: por eso un comentario de TikTok rebota. F46 agrega la busqueda en
    // social_accounts, y este caso pasa a ser "cuenta que no es de nadie".
    db({ channels: [channelRow({ late_account_id: "cuenta-de-tiktok" })] });
    const res = await callRoute(post(comment()));

    expect(res.status).toBe(404);
  });

  it("el mismo comentario dos veces se procesa una sola vez", async () => {
    db();
    claimWebhookEvent.mockResolvedValueOnce(false);
    const res = await callRoute(post(comment()));

    expect(await res.json()).toEqual({ ok: true, skipped: "evento repetido" });
  });
});


describe("webhook de Zernio: el toque de atribución del DM (F85)", () => {
  it("un contacto nuevo: registra el toque con la plataforma, el mensaje y el contacto", async () => {
    db();
    upsertContactForSender.mockResolvedValue({ contactId: "contact-9", existed: false });

    await callRoute(post(dm()));
    await runAfter();

    expect(recordInboundTouch).toHaveBeenCalledTimes(1);
    expect(recordInboundTouch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: WS,
        contactId: "contact-9",
        conversationId: "conv-1",
        platform: "instagram",
        contactExisted: false,
        platformMessageId: "6ab5aaaaaaaaaaaaaaaaaaaa",
        messageId: "msg-1",
        storyId: null,
        referral: null,
      }),
    );
  });

  it("va DESPUES de guardar el mensaje", async () => {
    db();
    const order: string[] = [];
    persistInboundMessage.mockImplementation(async () => {
      order.push("mensaje");
      return { stored: true, id: "msg-1" };
    });
    recordInboundTouch.mockImplementation(async () => void order.push("toque"));

    await callRoute(post(dm()));
    await runAfter();

    expect(order).toEqual(["mensaje", "toque"]);
  });

  it("una respuesta a una historia pasa el id de la historia", async () => {
    db();

    await callRoute(post({ ...dm(), metadata: { storyReply: { storyId: "story-77" } } }));
    await runAfter();

    expect(recordInboundTouch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storyId: "story-77" }),
    );
  });

  it("un mensaje de un anuncio pasa los datos del anuncio", async () => {
    db();

    await callRoute(post({ ...dm(), metadata: { referral: { ad_id: "ad-9", ref: "promo", ads_context_data: { ad_title: "Clase gratis" } } } }));
    await runAfter();

    expect(recordInboundTouch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        referral: expect.objectContaining({ adId: "ad-9", ref: "promo", title: "Clase gratis" }),
      }),
    );
  });

  it("un referral ilegible no rompe nada: se trata como un mensaje común", async () => {
    db();

    await callRoute(post({ ...dm(), metadata: { referral: "basura" } }));
    await runAfter();

    expect(recordInboundTouch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ referral: null }));
    expect(runInboundAutomation).toHaveBeenCalled();
  });

  it("si el registro LANZA, el mensaje ya está guardado y el flow y el agente corren igual", async () => {
    db();
    recordInboundTouch.mockRejectedValue(new Error("se cayo la atribucion"));

    const response = await callRoute(post(dm()));
    await runAfter();

    expect(response.status).toBe(200);
    expect(persistInboundMessage).toHaveBeenCalled();
    expect(runInboundAutomation).toHaveBeenCalled();
    expect(maybeScheduleAgentTurn).toHaveBeenCalled();
  });

  it("el mismo webhook dos veces registra UN solo toque", async () => {
    db();
    claimWebhookEvent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await callRoute(post(dm()));
    await callRoute(post(dm()));
    await runAfter();

    expect(recordInboundTouch).toHaveBeenCalledTimes(1);
  });

  it("si el lead pidió que no le escriban, el toque se registra igual: escribió", async () => {
    db();
    applyOptOut.mockResolvedValue({ matched: true });

    await callRoute(post(dm()));
    await runAfter();

    expect(recordInboundTouch).toHaveBeenCalledTimes(1);
    expect(runInboundAutomation).not.toHaveBeenCalled();
  });
});
