/**
 * A2: el vinculo MANUAL entre un anuncio y una pieza. La base es en memoria (los filtros se aplican de verdad); la RLS
 * y los privilegios se prueban contra la base real. Aca se prueba el contrato de las acciones: permisos, workspace de
 * la sesion, que el vinculo manual quede marcado, que desvincular vuelva al automatico y que todo quede en el historial.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
let db: MemoryDb;
let granted = new Set<string>();
const audits: Array<Record<string, unknown>> = [];
const revalidated: string[] = [];

vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void revalidated.push(path) }));
vi.mock("@/lib/audit", () => ({ logAudit: async (args: Record<string, unknown>) => void audits.push(args) }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) =>
    granted.has(key) ? { workspace: { id: WS, timezone: "UTC" }, user: { id: "u-1" }, supabase: db.client, can: (k: string) => granted.has(k) } : null,
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async () => "UTC" }));

const { linkAdToPiece, unlinkAdFromPiece, searchPiecesForAd, searchAdsForPiece, loadPieceAdsSummary } = await import("./content-ad-link");

const ad = (over: Record<string, unknown> = {}) => ({
  id: "row-a", workspace_id: WS, ad_account_id: "act_1", ad_id: "a-1", name: "Anuncio uno", name_key: "anuncio uno", adset_id: "s-1", campaign_id: "c-1",
  content_post_id: null, social_post_id: null, content_link_manual: false, effective_status: "ACTIVE", status: "ACTIVE", ...over,
});
const piece = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, workspace_id: WS, title, networks: [], created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", deleted_at: null, archived_at: null, ...over });

beforeEach(() => {
  granted = new Set(["content.create", "dashboards.ads.view", "content.view"]);
  audits.length = 0;
  revalidated.length = 0;
  db = memoryDb({
    meta_ads: [ad(), ad({ id: "row-b", ad_id: "a-2", name: "Anuncio dos", name_key: "anuncio dos" }), ad({ id: "row-x", workspace_id: "ws-otro", ad_id: "a-9", name: "De otro", name_key: "de otro" })],
    content_posts: [piece("p-1", "Cómo cobrar sin miedo"), piece("p-2", "Tres errores al vender"), piece("p-x", "Pieza ajena", { workspace_id: "ws-otro" }), piece("p-del", "Borrada", { deleted_at: "2026-10-03T00:00:00Z" })],
    social_posts: [
      { id: "sp-ig", workspace_id: WS, content_post_id: "p-1", platform: "instagram", status: "published", published_at: "2026-10-05T00:00:00Z", scheduled_at: null, thumbnail_url: "https://cdn/x.jpg", deleted_at: null },
      { id: "sp-yt", workspace_id: WS, content_post_id: "p-1", platform: "youtube", status: "published", published_at: "2026-10-06T00:00:00Z", scheduled_at: null, thumbnail_url: null, deleted_at: null },
    ],
    meta_campaigns: [{ workspace_id: WS, campaign_id: "c-1", name: "Camp uno" }],
    meta_adsets: [{ workspace_id: WS, adset_id: "s-1", name: "Conj uno" }],
    integration_configs: [],
    meta_ads_insights_daily: [],
  });
});

const adRow = (id: string) => db.rows("meta_ads").find((r) => r.id === id)!;

describe("linkAdToPiece", () => {
  it("vincula a mano: guarda la pieza, la publicacion de Instagram y marca el vinculo como manual", async () => {
    const r = await linkAdToPiece({ adId: "a-1", pieceId: "p-1" });
    expect(r).toEqual({ ok: true });
    expect(adRow("row-a")).toMatchObject({ content_post_id: "p-1", social_post_id: "sp-ig", content_link_manual: true });
  });

  it("queda en el historial con el antes y el despues, a nombre de quien lo hizo", async () => {
    await linkAdToPiece({ adId: "a-1", pieceId: "p-1" });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      workspaceId: WS, entityType: "meta_ad", entityId: "row-a", action: "content_link.linked", performedBy: "u-1",
      changes: { content_post_id: { old: null, new: "p-1" }, content_link_manual: { old: false, new: true } },
      metadata: { ad_id: "a-1", piece_title: "Cómo cobrar sin miedo" },
    });
  });

  it("una pieza sin publicacion de Instagram se vincula igual, con social_post_id vacio", async () => {
    await linkAdToPiece({ adId: "a-1", pieceId: "p-2" });
    expect(adRow("row-a")).toMatchObject({ content_post_id: "p-2", social_post_id: null, content_link_manual: true });
  });

  it("si el anuncio ya tenia otra pieza, pasa a esta y el historial guarda la anterior", async () => {
    adRow("row-a").content_post_id = "p-2";
    await linkAdToPiece({ adId: "a-1", pieceId: "p-1" });
    expect(adRow("row-a").content_post_id).toBe("p-1");
    expect((audits[0].changes as Record<string, { old: unknown }>).content_post_id.old).toBe("p-2");
  });

  it("pide los DOS permisos: sin content.create o sin dashboards.ads.view se rechaza y no escribe nada", async () => {
    for (const missing of ["content.create", "dashboards.ads.view"]) {
      granted = new Set(["content.create", "dashboards.ads.view"]);
      granted.delete(missing);
      const r = await linkAdToPiece({ adId: "a-1", pieceId: "p-1" });
      expect(r.ok).toBe(false);
    }
    expect(adRow("row-a")).toMatchObject({ content_post_id: null, content_link_manual: false });
    expect(audits).toHaveLength(0);
  });

  it("el anuncio o la pieza de OTRO workspace no existen (el workspace sale de la sesion)", async () => {
    expect(await linkAdToPiece({ adId: "a-9", pieceId: "p-1" })).toEqual({ ok: false, error: expect.stringContaining("No encontré ese anuncio") });
    expect(await linkAdToPiece({ adId: "a-1", pieceId: "p-x" })).toEqual({ ok: false, error: expect.stringContaining("No encontré esa pieza") });
    expect(await linkAdToPiece({ adId: "a-1", pieceId: "p-del" })).toEqual({ ok: false, error: expect.stringContaining("No encontré esa pieza") });
    expect(adRow("row-a").content_post_id).toBeNull();
    expect(adRow("row-x").content_post_id).toBeNull();
    expect(audits).toHaveLength(0);
  });

  it("ids vacios o que no son texto se rechazan sin tocar la base", async () => {
    expect((await linkAdToPiece({ adId: "", pieceId: "p-1" })).ok).toBe(false);
    expect((await linkAdToPiece({ adId: "a-1", pieceId: "  " })).ok).toBe(false);
    expect((await linkAdToPiece({ adId: 5 as unknown as string, pieceId: "p-1" })).ok).toBe(false);
    expect(audits).toHaveLength(0);
  });

  it("refresca las pantallas que muestran el vinculo", async () => {
    await linkAdToPiece({ adId: "a-1", pieceId: "p-1" });
    expect(revalidated).toEqual(expect.arrayContaining(["/dashboard/content", "/dashboard/content/p-1", "/dashboard/dashboards/ads"]));
  });
});

describe("unlinkAdFromPiece", () => {
  it("desvincula: vacia los ids y vuelve a content_link_manual = false para que el automatico lo intente", async () => {
    Object.assign(adRow("row-a"), { content_post_id: "p-1", social_post_id: "sp-ig", content_link_manual: true });
    expect(await unlinkAdFromPiece({ adId: "a-1" })).toEqual({ ok: true });
    expect(adRow("row-a")).toMatchObject({ content_post_id: null, social_post_id: null, content_link_manual: false });
    expect(audits[0]).toMatchObject({
      entityType: "meta_ad", entityId: "row-a", action: "content_link.unlinked",
      changes: { content_post_id: { old: "p-1", new: null }, content_link_manual: { old: true, new: false } },
    });
  });

  it("un anuncio que ya estaba sin vinculo no escribe ni deja historial", async () => {
    expect(await unlinkAdFromPiece({ adId: "a-1" })).toEqual({ ok: true });
    expect(audits).toHaveLength(0);
  });

  it("sin permisos se rechaza, y un anuncio de otro workspace no se toca", async () => {
    Object.assign(adRow("row-x"), { content_post_id: "p-x", content_link_manual: true });
    expect(await unlinkAdFromPiece({ adId: "a-9" })).toEqual({ ok: false, error: expect.stringContaining("No encontré ese anuncio") });
    expect(adRow("row-x")).toMatchObject({ content_post_id: "p-x", content_link_manual: true });
    granted = new Set();
    expect((await unlinkAdFromPiece({ adId: "a-1" })).ok).toBe(false);
  });
});

describe("los buscadores", () => {
  it("piezas: por titulo, sin mayusculas; solo las del workspace, sin borradas", async () => {
    const r = await searchPiecesForAd("COBRAR");
    expect(r.ok && r.options.map((o) => o.id)).toEqual(["p-1"]);
    const all = await searchPiecesForAd("");
    expect(all.ok && all.options.map((o) => o.id).sort()).toEqual(["p-1", "p-2"]);
  });

  it("piezas: trae titulo, fecha y miniatura, y marca las que ya estan pautadas", async () => {
    adRow("row-b").content_post_id = "p-1";
    const r = await searchPiecesForAd("cobrar");
    expect(r.ok && r.options[0]).toMatchObject({ id: "p-1", title: "Cómo cobrar sin miedo", thumbnailUrl: "https://cdn/x.jpg", paid: true });
    expect(r.ok && r.options[0].date).toBe("2026-10-05T00:00:00Z");
  });

  it("anuncios: por nombre o por id, con su camino y la pieza a la que ya estan vinculados", async () => {
    adRow("row-a").content_post_id = "p-2";
    const byName = await searchAdsForPiece("uno");
    expect(byName.ok && byName.options).toEqual([{ adId: "a-1", name: "Anuncio uno", adAccountId: "act_1", path: "Conj uno › Camp uno", linkedTo: "Tres errores al vender" }]);
    const byId = await searchAdsForPiece("a-2");
    expect(byId.ok && byId.options.map((o) => o.adId)).toEqual(["a-2"]);
  });

  it("anuncios: con menos de 2 letras no busca; los de otro workspace no aparecen", async () => {
    const short = await searchAdsForPiece("a");
    expect(short.ok && short.options).toEqual([]);
    const other = await searchAdsForPiece("otro");
    expect(other.ok && other.options).toEqual([]);
  });

  it("sin permisos los dos buscadores se rechazan", async () => {
    granted = new Set(["content.create"]);
    expect((await searchPiecesForAd("x")).ok).toBe(false);
    expect((await searchAdsForPiece("xx")).ok).toBe(false);
  });
});

describe("loadPieceAdsSummary", () => {
  it("sin anuncios vinculados: state none (la seccion no se muestra)", async () => {
    const r = await loadPieceAdsSummary({ pieceId: "p-1", period: "historico" });
    expect(r.ok && r.summary.state).toBe("none");
  });

  it("con un anuncio: suma sus insights del periodo y toma los leads de la funcion de la tabla Meta vs CRM", async () => {
    adRow("row-a").content_post_id = "p-1";
    db.tables.meta_ads_insights_daily.push(
      { id: "i1", workspace_id: WS, level: "ad", object_id: "a-1", date: "2026-10-01", spend: 60, impressions: 1000, clicks: 30 },
      { id: "i2", workspace_id: WS, level: "ad", object_id: "a-1", date: "2026-10-02", spend: 40, impressions: 500, clicks: 20 },
      { id: "i3", workspace_id: WS, level: "ad", object_id: "a-2", date: "2026-10-02", spend: 999, impressions: 1, clicks: 1 },
    );
    const rpcRows = [
      { object_id: "a-1", is_total: false, leads_first: 2, leads_total: 3, bookings: 1, sales: 1 },
      { object_id: null, is_total: true, leads_first: null, leads_total: 3, bookings: null, sales: null },
    ];
    const calls: Array<Record<string, unknown>> = [];
    (db.client as unknown as { rpc: unknown }).rpc = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, ...args });
      return { data: rpcRows, error: null };
    };
    const r = await loadPieceAdsSummary({ pieceId: "p-1", period: "historico" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toMatchObject({ state: "single", spend: 100, impressions: 1500, clicks: 50, leadsNew: 2, leadsTotal: 3, cplNew: 50, bookings: 1, sales: 1 });
    expect(calls[0]).toMatchObject({ name: "ads_crm_metrics_v2", p_level: "ad", p_workspace_id: WS, p_object_ids: ["a-1"] });
  });

  it("pide dashboards.ads.view y content.view", async () => {
    granted = new Set(["content.view"]);
    expect((await loadPieceAdsSummary({ pieceId: "p-1", period: "historico" })).ok).toBe(false);
    granted = new Set(["dashboards.ads.view"]);
    expect((await loadPieceAdsSummary({ pieceId: "p-1", period: "historico" })).ok).toBe(false);
  });
});
