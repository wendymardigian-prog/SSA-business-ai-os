/**
 * F79 en el job real: la regla de frecuencia por antiguedad.
 *
 * `shouldCollect` y `postsDueForSync` estaban escritos y nadie los llamaba, asi
 * que un post de 31 a 90 dias no se volvia a leer nunca. Los tests de
 * `rules.test.ts` prueban la regla; este prueba que el JOB la use: que pida la
 * ventana estirada solo cuando toca, y que no guarde lo que no corresponde.
 *
 * Se simulan el lector de Zernio, el cliente de Zernio (el job tambien lee los
 * comentarios de cada post guardado) y la clave. El handler, `persistPosts` y
 * `storedPosts` corren de verdad sobre la base en memoria.
 *
 * NINGUNA llamada sale a internet: ademas de los mocks, `fetch` falla ruidoso.
 * Una version anterior de este test no simulaba el cliente de los comentarios y
 * hizo pedidos reales a la API de Zernio con una clave falsa.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const ACCOUNT = "sa-tt";
// El 1 de octubre a las 09:30 UTC: la hora del cron de las 3 de Costa Rica.
const NOW = new Date("2026-10-01T09:30:00Z");

const readZernioMetrics = vi.fn();
const getInboxPostComments = vi.fn();
vi.mock("@/lib/metrics/zernio", () => ({ readZernioMetrics }));
vi.mock("@/lib/integrations/zernio-key", () => ({ getZernioApiKey: async () => "key-simulada" }));
// El cliente de mentira: solo sabe leer comentarios, y devuelve que no hay.
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ comments: { getInboxPostComments } }),
}));

const { getJobHandler } = await import("@/lib/jobs/registry");
const { registerMetricsHandlers, METRICS_SYNC_JOB } = await import("./metrics-sync");

let db: MemoryDb;

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** Un post ya guardado, publicado hace `age` dias y leido por ultima vez hace `synced`. */
const stored = (id: string, age: number, synced: number | null) => ({
  id: `sp-${id}`,
  workspace_id: WS,
  social_account_id: ACCOUNT,
  platform: "tiktok",
  external_post_id: id,
  origin: "external",
  published_at: daysAgo(age),
  last_synced_at: synced === null ? null : daysAgo(synced),
  deleted_at: null,
  d7_computed_at: daysAgo(1),
});

/** Lo que devolveria la red para ese post. */
const fromNetwork = (id: string, age: number) => ({
  platform: "tiktok",
  externalPostId: id,
  publisherRef: null,
  url: null,
  caption: `caption de ${id}`,
  mediaType: "video",
  thumbnailUrl: null,
  publishedAt: daysAgo(age),
  metrics: {
    views: 100, impressions: null, reach: null, likes: 5, comments: 1, shares: 0,
    saves: null, watchTimeSeconds: null, avgViewDurationSeconds: null, engagementRate: null, extra: {},
  },
});

async function run() {
  registerMetricsHandlers();
  const handler = getJobHandler(METRICS_SYNC_JOB)!;
  await handler({
    supabase: db.client,
    job: { id: "job-1", payload: { workspaceId: WS, socialAccountId: ACCOUNT } },
  } as never);
}

const syncedAt = (id: string) => db.rows("social_posts").find((r) => r.external_post_id === id)?.last_synced_at;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  readZernioMetrics.mockReset();
  readZernioMetrics.mockResolvedValue({ posts: [], accountDaily: [], warnings: [] });
  getInboxPostComments.mockReset();
  getInboxPostComments.mockResolvedValue({ data: { comments: [] } });
  // Red de seguridad: si algo se escapa de los mocks, el test se rompe en
  // lugar de hablarle a un proveedor real.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      throw new Error(`pedido de red real en un test: ${String(url)}`);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function seed(posts: Array<Record<string, unknown>>) {
  db = memoryDb({
    social_accounts: [
      { id: ACCOUNT, workspace_id: WS, platform: "tiktok", external_id: "zr-tt", channel_id: null, profile_synced_at: null },
    ],
    workspaces: [{ id: WS, timezone: "America/Costa_Rica" }],
    social_posts: posts,
    social_post_metrics_daily: [],
    social_post_comments: [],
    channels: [],
  });
}

describe("el job de metricas aplica la regla de frecuencia (F79)", () => {
  it("sin posts viejos pide la ventana de siempre: 30 dias", async () => {
    seed([stored("reciente", 5, 1)]);

    await run();

    expect(readZernioMetrics.mock.calls[0][0].fromDate).toBe("2026-09-01");
  });

  it("un post de 45 dias leido hace 3 NO estira la ventana ni se vuelve a guardar", async () => {
    seed([stored("p45", 45, 3)]);
    const antes = syncedAt("p45");
    readZernioMetrics.mockResolvedValue({ posts: [fromNetwork("p45", 45)], accountDaily: [], warnings: [] });

    await run();

    expect(readZernioMetrics.mock.calls[0][0].fromDate).toBe("2026-09-01");
    expect(syncedAt("p45")).toBe(antes);
  });

  it("un post de 45 dias leido hace 8 SI estira la ventana y se actualiza", async () => {
    seed([stored("p45", 45, 8)]);
    const antes = syncedAt("p45");
    readZernioMetrics.mockResolvedValue({ posts: [fromNetwork("p45", 45)], accountDaily: [], warnings: [] });

    await run();

    // Cubre el dia en que se publico (el 17 de agosto) y no mas.
    expect(readZernioMetrics.mock.calls[0][0].fromDate).toBe("2026-08-16");
    expect(syncedAt("p45")).not.toBe(antes);
    expect(syncedAt("p45")).toBe(NOW.toISOString());
  });

  it("un post de 100 dias nunca se pide ni se guarda, aunque la red lo devuelva", async () => {
    seed([stored("p100", 100, null)]);
    const antes = syncedAt("p100");
    readZernioMetrics.mockResolvedValue({ posts: [fromNetwork("p100", 100)], accountDaily: [], warnings: [] });

    await run();

    expect(readZernioMetrics.mock.calls[0][0].fromDate).toBe("2026-09-01");
    expect(syncedAt("p100")).toBe(antes);
  });

  it("los de los ultimos 30 dias se guardan siempre, aunque se hayan leido hoy", async () => {
    seed([stored("hoy", 10, 0)]);
    readZernioMetrics.mockResolvedValue({ posts: [fromNetwork("hoy", 10)], accountDaily: [], warnings: [] });

    await run();

    expect(syncedAt("hoy")).toBe(NOW.toISOString());
  });

  it("una publicacion nueva de la red entra", async () => {
    seed([]);
    readZernioMetrics.mockResolvedValue({ posts: [fromNetwork("nueva", 2)], accountDaily: [], warnings: [] });

    await run();

    expect(db.rows("social_posts").map((r) => r.external_post_id)).toEqual(["nueva"]);
  });
});
