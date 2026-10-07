/**
 * F80: la prueba de punta a punta que faltaba.
 *
 * Hasta Contenido v3 había miles de tests en verde y el sistema no publicaba:
 * ninguno verificaba que alguien DISPARARA la creación de las cuentas sociales.
 * Probaban `computeAccounts` (la parte pura), no la cadena. Sin cuenta social no
 * se puede programar, y sin programar no se publica nada.
 *
 * Este test recorre la cadena entera con el código real:
 *
 *   guardar la integración -> sincronizar cuentas -> crear la pieza -> adjuntar
 *   media -> revisar y aprobar -> programar -> el cron real que sube la media y
 *   agenda en Zernio -> el webhook firmado de Zernio -> `published`.
 *
 * Y lo hace una vez por CADA disparador de la sincronización (guardar Zernio,
 * guardar Postproxy, "Sincronizar canales", "Sincronizar cuentas" y desconectar),
 * cada uno arrancando sin ninguna cuenta: si alguien quita la llamada a la
 * sincronización de cualquiera de esos lugares, su caso se pone rojo.
 *
 * QUE SE SIMULA, y nada más:
 *  - El cliente de Zernio (`@/lib/zernio-client`): es el proveedor externo.
 *  - La base y su Vault, en memoria, porque no hay una base de pruebas.
 *  - La sesión (`@/lib/workspace`), `next/cache` y el `after()` de Next.
 *  - El storage (URLs firmadas) y `fetch` (los bytes y la subida a Zernio).
 *  - El reloj.
 *
 * QUE NO SE SIMULA, a propósito: `syncSocialAccounts`, `canScheduleNetwork`,
 * `runScheduleNetworks`, `runProviderSchedule`, `settlePublication`,
 * `claimWebhookEvent` ni las rutas. Si se simulara cualquiera de esas, el test
 * dejaría de poder detectar justamente lo que no se detectaba.
 *
 * NINGUNA llamada sale a internet: `fetch` falla ruidoso con lo que no conoce.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-e2e";
const USER = "user-e2e";
const ZERNIO_KEY = "zernio-clave-de-prueba-1234";
const CRON_SECRET = "cron-secreto-de-prueba";
// El 3 de octubre de 2026, 12:00 en Costa Rica (UTC-6).
const NOW = new Date("2026-10-03T18:00:00Z");
const PLANNED = new Date(NOW.getTime() + 60 * 60_000).toISOString();

/** Lo que "tiene" Zernio y lo que le fuimos pidiendo. Se reinicia en cada caso. */
const zernio = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
  created: [] as Array<{ body: Record<string, any>; headers?: Record<string, string> }>,
  presigned: 0,
  webhooksCreated: 0,
  uploads: [] as string[],
}));

let db: MemoryDb;
/** El Vault: `workspace:nombre` -> valor. */
const vault = new Map<string, string>();
let role = "owner";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// `after()` no existe fuera de un pedido de Next: se junta y se corre a mano.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: () => undefined };
});
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: USER },
    workspace: { id: WS, timezone: "America/Costa_Rica" },
    role,
    roleId: null,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => db.client,
  createServiceClient: async () => db.client,
}));
// El UNICO proveedor simulado: el cliente de Zernio.
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({
    accounts: {
      listAccounts: async () => ({ data: { accounts: zernio.accounts, hasAnalyticsAccess: true } }),
      getFollowerStats: async () => ({ data: { accounts: [] } }),
    },
    media: {
      getMediaPresignedUrl: async () => {
        zernio.presigned += 1;
        return {
          data: {
            uploadUrl: `https://upload.zernio.test/${zernio.presigned}`,
            publicUrl: `https://cdn.zernio.test/${zernio.presigned}.mp4`,
          },
        };
      },
    },
    posts: {
      createPost: async (options: { body: Record<string, any>; headers?: Record<string, string> }) => {
        zernio.created.push(options);
        return { data: { post: { _id: `zpost-${options.body.platforms[0].platform}` } } };
      },
    },
    webhooks: {
      getWebhookSettings: async () => ({ data: { webhooks: [] } }),
      createWebhookSettings: async () => {
        zernio.webhooksCreated += 1;
        return { data: {} };
      },
      updateWebhookSettings: async () => ({ data: {} }),
    },
    messages: { listInboxConversations: async () => ({ data: { data: [] } }) },
    comments: { getInboxPostComments: async () => ({ data: { comments: [] } }) },
  }),
}));

// Las acciones y las rutas se importan DESPUES de declarar los mocks.
const { createPost, savePostDraft } = await import("@/lib/actions/content");
const { attachMedia } = await import("@/lib/actions/content-media");
const { requestReview, approvePost } = await import("@/lib/actions/content-review");
const { scheduleNetworks } = await import("@/lib/actions/content-schedule");
const { saveIntegration, disconnectIntegration } = await import("@/lib/actions/integrations");
const { syncSocialAccountsNow } = await import("@/lib/actions/social-accounts");
const { POST: saveZernioKey } = await import("@/app/api/v1/channels/test-key/route");
const { POST: syncChannels } = await import("@/app/api/v1/channels/sync/route");
const { GET: runCron } = await import("@/app/api/cron/content-upload/route");
const { POST: receiveWebhook } = await import("@/app/api/webhooks/late/route");

// ── El mundo ─────────────────────────────────────────────────────────────────

const vaultKey = (workspace: string, name: string) => `${workspace}:${name}`;

function freshWorld() {
  zernio.accounts = [
    { _id: "zr-ig", platform: "instagram", username: "cuenta_demo", displayName: "Ana", isActive: true },
    { _id: "zr-tt", platform: "tiktok", username: "cuenta_demo", displayName: "Ana TikTok", isActive: true },
  ];
  zernio.created = [];
  zernio.presigned = 0;
  zernio.webhooksCreated = 0;
  zernio.uploads = [];
  vault.clear();
  role = "owner";

  db = memoryDb(
    {
      workspaces: [{ id: WS, timezone: "America/Costa_Rica" }],
      workspace_members: [{ workspace_id: WS, user_id: USER, role: "owner" }],
      workspace_roles: [],
      integration_configs: [],
      channels: [],
      social_accounts: [],
      oauth_connections: [],
      content_posts: [],
      social_posts: [],
      scheduled_jobs: [],
      provider_media: [],
      webhook_events: [],
      audit_log: [],
      notifications: [],
      triggers: [],
      agents: [],
    },
    {
      rpc: {
        read_secret: (a) => vault.get(vaultKey(String(a.workspace_id), String(a.secret_name))) ?? null,
        store_secret: (a) => {
          vault.set(vaultKey(String(a.workspace_id), String(a.secret_name)), String(a.secret_value));
          return null;
        },
        delete_secret: (a) => vault.delete(vaultKey(String(a.workspace_id), String(a.secret_name))),
        list_secret_names: (a) =>
          [...vault.keys()].filter((k) => k.startsWith(`${a.workspace_id}:`)).map((k) => k.split(":")[1]),
      },
      // Los defaults de columna que Postgres pone solo.
      generated: {
        content_posts: (row) => {
          row.status ??= "draft";
          row.media ??= [];
        },
        scheduled_jobs: (row) => {
          row.status ??= "pending";
          row.attempts ??= 0;
        },
      },
      // Los indices unicos que la base de verdad tiene.
      unique: {
        webhook_events: (a, b) => a.event_id === b.event_id,
        social_accounts: (a, b) => a.workspace_id === b.workspace_id && a.platform === b.platform,
        social_posts: (a, b) =>
          Boolean(a.content_post_id) &&
          a.content_post_id === b.content_post_id &&
          a.platform === b.platform &&
          !a.deleted_at &&
          !b.deleted_at,
      },
    },
  );

  // El storage: lo unico que `publishDeps` le pide al cliente ademas de las tablas.
  Object.assign(db.client, {
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((p) => ({ signedUrl: `https://storage.test/${p}` })),
          error: null,
        }),
      }),
    },
  });
}

/** La clave de Zernio ya guardada, como si alguien la hubiera pegado antes. */
function zernioAlreadyConnected() {
  vault.set(vaultKey(WS, "zernio_api_key"), ZERNIO_KEY);
}

const accountOf = (platform: string) => db.rows("social_accounts").find((a) => a.platform === platform);

// ── Los disparadores, tal como los aprieta una persona ───────────────────────

const request = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://ssa.example.com${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...init.headers },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const trigger = {
  /** Pegar la clave de Zernio en Integraciones (su ruta propia). */
  saveZernio: () => saveZernioKey(request("/api/v1/channels/test-key", { method: "POST", body: { apiKey: ZERNIO_KEY } })),
  /** Pegar la clave de Postproxy. */
  savePostproxy: () => saveIntegration({ providerId: "postproxy", secrets: { api_key: "postproxy-clave-1234" } }),
  /** El boton "Sincronizar canales". */
  syncChannels: () => syncChannels(),
  /** El boton "Sincronizar cuentas". */
  syncAccounts: () => syncSocialAccountsNow(),
  /** Desconectar Zernio. */
  disconnectZernio: () => disconnectIntegration("zernio"),
};

// ── La pieza y el camino hasta publicar ──────────────────────────────────────

const OPTIONS: Record<string, Record<string, unknown>> = {
  instagram: {},
  // TikTok no sale sin las dos confirmaciones y la privacidad (A8).
  tiktok: { privacyLevel: "PUBLIC_TO_EVERYONE", contentPreviewConfirmed: true, expressConsentGiven: true },
};

/** Crea una pieza lista para programar en esa red, como la deja el editor. */
async function aprobadaConVideo(platform: string): Promise<string> {
  const created = await createPost({ title: `Pieza de ${platform}`, platforms: [platform] });
  if (!created.ok) throw new Error(`createPost: ${created.error}`);
  const postId = created.data.id;

  const media = await attachMedia({
    postId,
    path: `${WS}/${postId}/video.mp4`,
    mime: "video/mp4",
    kind: "video",
    sizeBytes: 5_000_000,
  });
  if (!media.ok) throw new Error(`attachMedia: ${media.error}`);

  const saved = await savePostDraft({
    postId,
    caption: "Un caption de prueba",
    networks: [
      {
        platform,
        planned_at: PLANNED,
        caption: null,
        media: null,
        cta: { type: "none", keyword: null },
        options: OPTIONS[platform],
      },
    ],
  });
  if (!saved.ok) throw new Error(`savePostDraft: ${saved.error}`);

  const review = await requestReview({ postId });
  if (!review.ok) throw new Error(`requestReview: ${review.error}`);
  const approved = await approvePost({ postId });
  if (!approved.ok) throw new Error(`approvePost: ${approved.error}`);
  return postId;
}

/** Zernio le avisa al sistema que la publicacion salio. Firmado como Zernio. */
async function webhookDePublicado(platform: string, eventId: string) {
  const body = JSON.stringify({
    id: eventId,
    event: "post.platform.published",
    post: { id: `zpost-${platform}` },
    platform: {
      name: platform,
      status: "published",
      platformPostId: `ext-${platform}-1`,
      publishedUrl: `https://${platform}.test/p/1`,
    },
  });
  // El secreto es el que el propio sistema genero al guardar Zernio y registro
  // en Zernio: no se inventa uno para el test.
  const secret = vault.get(vaultKey(WS, "zernio_webhook_secret"));
  if (!secret) throw new Error("el sistema no genero ningun secreto de webhook al guardar Zernio");
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  return receiveWebhook(
    new NextRequest("https://ssa.example.com/api/webhooks/late", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "x-late-signature": signature },
    }),
  );
}

const cron = () =>
  runCron(request("/api/cron/content-upload", { headers: { authorization: `Bearer ${CRON_SECRET}` } }));

// ── Preparacion ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ssa.example.com");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  freshWorld();

  // Los unicos pedidos de red que se conocen; cualquier otro rompe el test.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const u = String(url);
      if (u.startsWith("https://storage.test/")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (u.startsWith("https://upload.zernio.test/")) {
        zernio.uploads.push(`${init?.method ?? "GET"} ${u}`);
        return new Response(null, { status: 200 });
      }
      if (u.startsWith("https://api.postproxy.dev/")) {
        return new Response(JSON.stringify({ profiles: [{ id: "pp-yt", platform: "youtube" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`pedido de red real en un test: ${u}`);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Cada disparador de la sincronizacion, desde cero
// ═════════════════════════════════════════════════════════════════════════════

describe("cada disparador crea las cuentas, y programar deja de estar bloqueado (F74)", () => {
  it("antes de conectar nada, programar esta bloqueado: es el sintoma original", async () => {
    // Sin esta linea base el resto no prueba nada: si programar anduviera igual
    // sin conectar, los casos de abajo pasarian aunque no hubiera ningun disparador.
    const postId = await aprobadaConVideo("instagram");

    const result = await scheduleNetworks({ postId, platform: "instagram" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No hay una cuenta de instagram conectada/);
    expect(db.rows("social_posts")).toHaveLength(0);
  });

  it("guardar la clave de Zernio crea Instagram y TikTok, y Instagram programa", async () => {
    const saved = await trigger.saveZernio();
    expect(saved.status).toBe(200);

    expect(accountOf("instagram")?.default_publisher).toBe("zernio");
    expect(accountOf("tiktok")?.default_publisher).toBe("zernio");

    const postId = await aprobadaConVideo("instagram");
    const result = await scheduleNetworks({ postId, platform: "instagram" });
    expect(result.ok).toBe(true);
  });

  it("guardar Postproxy tambien arma las cuentas (y YouTube por Postproxy)", async () => {
    // Zernio ya estaba conectado y la lista de cuentas vacia de nuestro lado:
    // lo unico que se aprieta es guardar Postproxy.
    zernioAlreadyConnected();

    const saved = await trigger.savePostproxy();
    expect(saved.ok).toBe(true);

    const youtube = accountOf("youtube");
    expect(youtube?.default_publisher).toBe("postproxy");
    expect(JSON.stringify(youtube?.publishers)).toContain("pp-yt");
    expect(accountOf("instagram")).toBeDefined();

    const postId = await aprobadaConVideo("instagram");
    expect((await scheduleNetworks({ postId, platform: "instagram" })).ok).toBe(true);
  });

  it("'Sincronizar canales' crea el canal de Instagram y lo enlaza a su cuenta; TikTok queda sin canal", async () => {
    zernioAlreadyConnected();

    const synced = await trigger.syncChannels();
    expect(synced.status).toBe(200);

    const channel = db.rows("channels").find((c) => c.platform === "instagram");
    expect(channel).toBeDefined();
    expect(accountOf("instagram")?.channel_id).toBe(channel?.id);
    // TikTok no es un canal de bandeja (no tiene mensajes directos).
    expect(db.rows("channels").some((c) => c.platform === "tiktok")).toBe(false);
    expect(accountOf("tiktok")).toBeDefined();
    expect(accountOf("tiktok")?.channel_id ?? null).toBeNull();

    const postId = await aprobadaConVideo("instagram");
    expect((await scheduleNetworks({ postId, platform: "instagram" })).ok).toBe(true);
  });

  it("'Sincronizar cuentas' crea las cuentas", async () => {
    zernioAlreadyConnected();

    const result = await trigger.syncAccounts();
    expect(result.ok).toBe(true);

    expect(accountOf("instagram")).toBeDefined();
    expect(accountOf("tiktok")).toBeDefined();

    const postId = await aprobadaConVideo("instagram");
    expect((await scheduleNetworks({ postId, platform: "instagram" })).ok).toBe(true);
  });

  it("desconectar Zernio deja a Instagram sin por donde publicar, y programar se rechaza", async () => {
    await trigger.saveZernio();
    expect(accountOf("instagram")?.default_publisher).toBe("zernio");
    const postId = await aprobadaConVideo("instagram");

    const disconnected = await trigger.disconnectZernio();
    expect(disconnected.ok).toBe(true);

    const instagram = accountOf("instagram");
    expect(instagram?.default_publisher).toBeNull();
    expect(JSON.stringify(instagram?.publishers)).toContain('"unavailable"');

    const result = await scheduleNetworks({ postId, platform: "instagram" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/por donde se publica instagram/i);
    expect(db.rows("social_posts")).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. El recorrido completo, por red
// ═════════════════════════════════════════════════════════════════════════════

describe.each([
  ["instagram", "zr-ig"],
  ["tiktok", "zr-tt"],
] as const)("de guardar la clave a publicado: %s", (platform, zernioAccountId) => {
  it("recorre toda la cadena y termina publicada", async () => {
    // 1. Guardar la integracion crea las cuentas. Sin esto no hay nada mas.
    expect((await trigger.saveZernio()).status).toBe(200);
    expect(accountOf(platform)?.external_id).toBe(zernioAccountId);

    // 2. La pieza, hasta aprobada.
    const postId = await aprobadaConVideo(platform);

    // 3. Programar: una fila esperando la subida y un job para el cron.
    const scheduled = await scheduleNetworks({ postId, platform });
    expect(scheduled.ok).toBe(true);
    const row = () => db.rows("social_posts").find((p) => p.platform === platform)!;
    expect(row().status).toBe("uploading");
    expect(row().publisher).toBe("zernio");
    expect(db.rows("scheduled_jobs")).toHaveLength(1);
    expect(db.rows("scheduled_jobs")[0].type).toBe("content_provider_schedule");

    // 4. El cron REAL sube la media y agenda el post en Zernio.
    const ran = await cron();
    expect(await ran.json()).toMatchObject({ ok: true, processed: 1, failed: 0 });

    expect(row().status).toBe("scheduled");
    expect(row().publisher_ref).toBe(`zpost-${platform}`);
    expect(db.rows("provider_media")).toHaveLength(1);
    expect(zernio.uploads[0]).toMatch(/^PUT https:\/\/upload\.zernio\.test\//);

    // Lo que le llego a Zernio: la cuenta, la fecha y la zona del negocio.
    expect(zernio.created).toHaveLength(1);
    const { body, headers } = zernio.created[0];
    expect(body.platforms[0]).toMatchObject({ platform, accountId: zernioAccountId });
    expect(new Date(body.scheduledFor).toISOString()).toBe(PLANNED);
    expect(body.timezone).toBe("America/Costa_Rica");
    expect(body.mediaItems[0].url).toMatch(/^https:\/\/cdn\.zernio\.test\//);
    expect(headers?.["x-request-id"]).toBe(`${row().id}:1`);
    if (platform === "tiktok") {
      expect(body.platforms[0].platformSpecificData).toMatchObject({
        privacyLevel: "PUBLIC_TO_EVERYONE",
        contentPreviewConfirmed: true,
        expressConsentGiven: true,
      });
    }
    expect(db.rows("content_posts")[0].status).toBe("scheduled");

    // 5. Zernio avisa que salio, firmado con el secreto que el sistema le registro.
    const webhook = await webhookDePublicado(platform, `evt-${platform}-1`);
    expect(await webhook.json()).toMatchObject({ ok: true });

    expect(row().status).toBe("published");
    expect(row().external_post_id).toBe(`ext-${platform}-1`);
    expect(row().url).toBe(`https://${platform}.test/p/1`);
    expect(db.rows("content_posts")[0].status).toBe("published");
  });

  it("el mismo aviso dos veces se procesa una sola vez (idempotencia real)", async () => {
    await trigger.saveZernio();
    const postId = await aprobadaConVideo(platform);
    await scheduleNetworks({ postId, platform });
    await cron();

    const first = await webhookDePublicado(platform, `evt-${platform}-dup`);
    const second = await webhookDePublicado(platform, `evt-${platform}-dup`);

    expect(await first.json()).toMatchObject({ ok: true, settled: expect.anything() });
    expect(await second.json()).toMatchObject({ ok: true, skipped: "evento repetido" });
  });

  it("un aviso con la firma equivocada se rechaza y no cambia nada", async () => {
    await trigger.saveZernio();
    const postId = await aprobadaConVideo(platform);
    await scheduleNetworks({ postId, platform });
    await cron();

    const response = await receiveWebhook(
      new NextRequest("https://ssa.example.com/api/webhooks/late", {
        method: "POST",
        body: JSON.stringify({
          id: `evt-${platform}-mala`,
          event: "post.platform.published",
          post: { id: `zpost-${platform}` },
          platform: { name: platform, platformPostId: "x" },
        }),
        headers: { "content-type": "application/json", "x-late-signature": "no-es-la-firma" },
      }),
    );

    expect(response.status).toBe(401);
    expect(db.rows("social_posts").find((p) => p.platform === platform)?.status).toBe("scheduled");
  });
});
