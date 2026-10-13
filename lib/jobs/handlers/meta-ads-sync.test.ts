/**
 * F23 en el job real: el catalogo (campañas, conjuntos y anuncios) se sincroniza antes de las
 * metricas, es independiente de ellas, y deja el estado en las filas de insights.
 *
 * `fetch` se simula con respuestas del grafo (v21): NINGUNA llamada sale a internet. El handler,
 * `syncCatalog`, `persistInsights` y los guardados corren de verdad sobre la base en memoria.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const ACC = "act_1";
const NOW = new Date("2026-10-13T09:00:00Z");

vi.mock("@/lib/meta/token", () => ({
  getMetaToken: async () => "token-simulado",
}));
const scheduled: Array<{ type: string; payload: unknown }> = [];
vi.mock("@/lib/scheduler", () => ({
  scheduleJob: async (_s: unknown, type: string, payload: unknown) => {
    scheduled.push({ type, payload });
    return { id: "job-1" };
  },
}));

const { getJobHandler, resetJobHandlers } = await import("@/lib/jobs/registry");
const { registerMetaAdsHandlers, META_ADS_SYNC_JOB } =
  await import("./meta-ads-sync");

let db: MemoryDb;

const res = (body: unknown, headers: Record<string, string> = {}) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers(headers),
  }) as unknown as Response;

type Routes = Partial<
  Record<"campaigns" | "adsets" | "ads" | "insights", (url: URL) => Response>
>;

/** Un grafo de mentira: cada borde responde lo que el test le pida. */
function graph(routes: Routes) {
  const calls: URL[] = [];
  const stub = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    calls.push(url);
    const edge = url.pathname.split("/").pop() as keyof Routes;
    const handler = routes[edge];
    return handler ? handler(url) : res({ data: [] });
  });
  vi.stubGlobal("fetch", stub);
  return { calls, stub };
}

const PAGE = {
  campaigns: {
    data: [
      {
        id: "c1",
        name: "Campaña Octubre",
        status: "ACTIVE",
        effective_status: "ACTIVE",
      },
      { id: "c2", name: "Vieja", status: "PAUSED", effective_status: "PAUSED" },
    ],
  },
  adsets: {
    data: [
      {
        id: "s1",
        name: "Conjunto 1",
        campaign_id: "c1",
        status: "ACTIVE",
        effective_status: "ACTIVE",
      },
    ],
  },
  ads: {
    data: [
      {
        id: "a1",
        name: "Anuncio 1",
        campaign_id: "c1",
        adset_id: "s1",
        status: "ACTIVE",
        effective_status: "ACTIVE",
        creative: { id: "cr1", thumbnail_url: "https://x.fbcdn.net/1.jpg" },
      },
      {
        id: "a2",
        name: "Anuncio archivado",
        campaign_id: "c1",
        adset_id: "s1",
        status: "ARCHIVED",
        effective_status: "ARCHIVED",
      },
      {
        id: "a3",
        name: "Anuncio pausado",
        campaign_id: "c1",
        adset_id: "s1",
        status: "PAUSED",
        effective_status: "PAUSED",
      },
    ],
  },
};

const insight = (level: string) =>
  level === "ad"
    ? {
        data: [
          {
            date_start: "2026-10-12",
            ad_id: "a1",
            ad_name: "Anuncio 1",
            adset_id: "s1",
            adset_name: "Conjunto 1",
            campaign_id: "c1",
            campaign_name: "Campaña Octubre",
            spend: "10",
            impressions: "100",
            clicks: "5",
          },
        ],
      }
    : { data: [] };

const run = (
  payload: Record<string, unknown> = { workspaceId: WS, adAccountId: ACC },
) => {
  const handler = getJobHandler(META_ADS_SYNC_JOB)!;
  return handler({
    supabase: db.client,
    job: { id: "job-1", type: META_ADS_SYNC_JOB, payload, attempts: 0 },
  });
};

const accountConfig = (over: Record<string, unknown> = {}) =>
  (
    db.rows("integration_configs")[0].config as {
      ad_accounts: Array<Record<string, unknown>>;
    }
  ).ad_accounts.find((a) => a.ad_account_id === ACC) ?? over;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  scheduled.length = 0;
  resetJobHandlers();
  registerMetaAdsHandlers();
  db = memoryDb(
    {
      integration_configs: [
        {
          id: "ic-1",
          workspace_id: WS,
          type: "meta",
          provider: "meta",
          config: {
            ad_accounts: [
              {
                ad_account_id: ACC,
                sync_enabled: true,
                first_sync_completed_at: "2026-10-01T00:00:00Z",
              },
            ],
          },
        },
      ],
    },
    {
      // Los defaults de la base (la tabla en memoria no los conoce).
      generated: {
        meta_ads: (row) => {
          row.content_link_manual ??= false;
          row.thumbnail_attempts ??= 0;
          row.thumbnail_path ??= null;
          row.social_post_id ??= null;
          row.content_post_id ??= null;
        },
      },
    },
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el catalogo", () => {
  it("guarda campañas, conjuntos y anuncios, incluidos los PAUSED y ARCHIVED", async () => {
    graph({
      campaigns: () => res(PAGE.campaigns),
      adsets: () => res(PAGE.adsets),
      ads: () => res(PAGE.ads),
      insights: (url) => res(insight(url.searchParams.get("level") ?? "")),
    });
    await run();

    expect(
      db.rows("meta_campaigns").map((r) => [r.campaign_id, r.effective_status]),
    ).toEqual([
      ["c1", "ACTIVE"],
      ["c2", "PAUSED"],
    ]);
    expect(db.rows("meta_adsets")).toHaveLength(1);
    expect(
      db.rows("meta_ads").map((r) => [r.ad_id, r.effective_status]),
    ).toEqual([
      ["a1", "ACTIVE"],
      ["a2", "ARCHIVED"],
      ["a3", "PAUSED"],
    ]);
    expect(db.rows("meta_ads")[0]).toMatchObject({
      name_key: "anuncio 1",
      thumbnail_source_url: "https://x.fbcdn.net/1.jpg",
      workspace_id: WS,
      ad_account_id: ACC,
    });
  });

  it("las filas nuevas de insights llevan el estado del catalogo", async () => {
    graph({
      campaigns: () => res(PAGE.campaigns),
      adsets: () => res(PAGE.adsets),
      ads: () => res(PAGE.ads),
      insights: (url) => res(insight(url.searchParams.get("level") ?? "")),
    });
    await run();

    const rows = db.rows("meta_ads_insights_daily");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      level: "ad",
      object_id: "a1",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      object_name: "Anuncio 1",
    });
  });

  it("si las entidades fallan con 500, las metricas se sincronizan igual (y queda anotado)", async () => {
    graph({
      campaigns: () => res({ error: { code: 500, message: "boom" } }),
      adsets: () => res({ error: { code: 500, message: "boom" } }),
      ads: () => res({ error: { code: 500, message: "boom" } }),
      insights: (url) => res(insight(url.searchParams.get("level") ?? "")),
    });
    await run();

    expect(db.rows("meta_ads")).toHaveLength(0);
    expect(db.rows("meta_ads_insights_daily")).toHaveLength(1);
    // Sin catalogo el estado queda null, como antes de este bloque.
    expect(db.rows("meta_ads_insights_daily")[0]).toMatchObject({
      status: null,
      effective_status: null,
    });
    expect(String(accountConfig().last_error)).toContain("Catálogo");
    // El catalogo NO se marca como completo: el proximo sync vuelve a pedir desde la ultima vez completa.
    expect(accountConfig().catalog_synced_at ?? null).toBeNull();
  });

  it("al reves: si las metricas fallan, el catalogo se guarda igual", async () => {
    graph({
      campaigns: () => res(PAGE.campaigns),
      adsets: () => res(PAGE.adsets),
      ads: () => res(PAGE.ads),
      insights: () => res({ error: { code: 190, message: "token" } }),
    });
    await run();
    expect(db.rows("meta_ads")).toHaveLength(3);
    expect(db.rows("meta_ads_insights_daily")).toHaveLength(0);
  });

  it("la primera vez lee todo (sin updated_since) y marca el catalogo completo; la segunda es incremental", async () => {
    const g = graph({
      campaigns: () => res(PAGE.campaigns),
      adsets: () => res(PAGE.adsets),
      ads: () => res(PAGE.ads),
    });
    await run();
    const entityCalls = () =>
      g.calls.filter((u) =>
        ["campaigns", "adsets", "ads"].includes(u.pathname.split("/").pop()!),
      );
    expect(
      entityCalls().every((u) => u.searchParams.get("updated_since") === null),
    ).toBe(true);
    expect(accountConfig().catalog_synced_at).toBe(NOW.toISOString());

    g.calls.length = 0;
    await run();
    const expected = String(Math.floor((NOW.getTime() - 86_400_000) / 1000));
    expect(
      entityCalls().every(
        (u) => u.searchParams.get("updated_since") === expected,
      ),
    ).toBe(true);
  });

  it("cuando x-business-use-case-usage pasa el 90 % corta el catalogo y lo dice", async () => {
    const hot = JSON.stringify({
      "1": [{ call_count: 95, total_cputime: 1, total_time: 1 }],
    });
    const g = graph({
      campaigns: () =>
        res(
          {
            ...PAGE.campaigns,
            paging: {
              next: "https://graph.facebook.com/v21.0/act_1/campaigns?after=x",
            },
          },
          { "x-business-use-case-usage": hot },
        ),
      adsets: () => res(PAGE.adsets),
      ads: () => res(PAGE.ads),
    });
    await run();

    expect(db.rows("meta_campaigns")).toHaveLength(2);
    // No siguio con conjuntos ni anuncios.
    expect(g.calls.some((u) => u.pathname.endsWith("/adsets"))).toBe(false);
    expect(String(accountConfig().last_error)).toContain("límite de uso");
    expect(accountConfig().catalog_synced_at ?? null).toBeNull();
  });

  it("al llegar al tope de paginas lo anota en la cuenta (no en silencio)", async () => {
    graph({
      campaigns: () =>
        res({
          data: [{ id: "c1", name: "x" }],
          paging: {
            next: "https://graph.facebook.com/v21.0/act_1/campaigns?after=x",
          },
        }),
      adsets: () => res(PAGE.adsets),
      ads: () => res(PAGE.ads),
    });
    await run();
    expect(String(accountConfig().last_error)).toContain(
      "tope de 50 páginas en campañas",
    );
  });

  it("un sync completo no deja error y encola las miniaturas", async () => {
    graph({
      campaigns: () => res(PAGE.campaigns),
      adsets: () => res(PAGE.adsets),
      ads: () => res(PAGE.ads),
    });
    await run();
    expect(accountConfig().last_error).toBeNull();
    expect(scheduled).toEqual([
      {
        type: "meta_ad_thumbnails",
        payload: { workspaceId: WS, adAccountId: ACC },
      },
    ]);
  });

  it("enlaza el anuncio con la publicacion de Instagram que promociona", async () => {
    db.rows("social_posts").push({
      id: "sp-1",
      workspace_id: WS,
      platform: "instagram",
      external_post_id: "ig-77",
      content_post_id: "cp-1",
    });
    graph({
      campaigns: () => res(PAGE.campaigns),
      adsets: () => res(PAGE.adsets),
      ads: () =>
        res({
          data: [
            {
              id: "a1",
              name: "Promo",
              campaign_id: "c1",
              adset_id: "s1",
              effective_status: "ACTIVE",
              creative: { effective_instagram_media_id: "ig-77" },
            },
          ],
        }),
    });
    await run();
    expect(db.rows("meta_ads")[0]).toMatchObject({
      instagram_media_id: "ig-77",
      social_post_id: "sp-1",
      content_post_id: "cp-1",
    });
  });

  it("un sync posterior NO borra un enlace manual ni una miniatura ya bajada", async () => {
    db.rows("meta_ads").push({
      id: "row-1",
      workspace_id: WS,
      ad_account_id: ACC,
      ad_id: "a1",
      name: "viejo",
      social_post_id: "sp-m",
      content_post_id: "cp-m",
      content_link_manual: true,
      thumbnail_path: "ws-1/a1.png",
      thumbnail_attempts: 1,
    });
    graph({
      campaigns: () => res(PAGE.campaigns),
      adsets: () => res(PAGE.adsets),
      ads: () =>
        res({
          data: [
            {
              id: "a1",
              name: "Nuevo nombre",
              campaign_id: "c1",
              adset_id: "s1",
              effective_status: "PAUSED",
            },
          ],
        }),
    });
    await run();
    expect(db.rows("meta_ads")[0]).toMatchObject({
      name: "Nuevo nombre",
      effective_status: "PAUSED",
      social_post_id: "sp-m",
      content_post_id: "cp-m",
      content_link_manual: true,
      thumbnail_path: "ws-1/a1.png",
      thumbnail_attempts: 1,
    });
  });
});
