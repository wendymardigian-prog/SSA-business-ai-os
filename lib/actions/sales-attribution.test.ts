import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
let db: MemoryDb;
let role = "admin";
let roleId: string | null = null;

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: "user-1" }, workspace: { id: WS }, role, roleId, supabase: db.client }),
}));

const { searchPiecesForSale, searchAdsForSale, pieceTitleForSale } = await import("./sales-attribution");

beforeEach(() => {
  role = "admin";
  roleId = null;
  db = memoryDb({
    workspace_roles: [],
    content_posts: [
      { id: "11111111-1111-4111-8111-111111111111", workspace_id: WS, title: "Reel: 3 errores", attribution_code: "cab2c3", format: "reel", deleted_at: null, updated_at: "2026-10-02T00:00:00Z" },
      { id: "22222222-2222-4222-8222-222222222222", workspace_id: "ws-2", title: "De otro negocio", attribution_code: "cxyz22", format: null, deleted_at: null, updated_at: "2026-10-02T00:00:00Z" },
    ],
    meta_ads: [{ workspace_id: WS, ad_id: "33", name: "Video 1", adset_id: "22", campaign_id: "11", created_time: "2026-10-01T00:00:00Z" }],
    meta_adsets: [{ workspace_id: WS, adset_id: "22", name: "Lookalike", campaign_id: "11", created_time: "2026-10-01T00:00:00Z" }],
    meta_campaigns: [{ workspace_id: WS, campaign_id: "11", name: "Octubre", created_time: "2026-10-01T00:00:00Z" }],
  });
});

describe("searchPiecesForSale", () => {
  it("devuelve las piezas del workspace de la sesión con su código", async () => {
    expect(await searchPiecesForSale("reel")).toEqual([{ id: "11111111-1111-4111-8111-111111111111", title: "Reel: 3 errores", code: "cab2c3", format: "reel" }]);
  });

  it("con menos de dos letras no busca", async () => {
    expect(await searchPiecesForSale("r")).toEqual([]);
  });

  it("sin sales.view responde vacío", async () => {
    role = "member";
    roleId = "rol-1";
    db.rows("workspace_roles").push({ id: "rol-1", workspace_id: WS, system_role: null, permissions: { keys: ["contacts.view"], scopes: {} } });
    expect(await searchPiecesForSale("reel")).toEqual([]);
  });
});

describe("pieceTitleForSale", () => {
  it("el título de una pieza del workspace; una de otro workspace o un id inválido, null", async () => {
    expect(await pieceTitleForSale("11111111-1111-4111-8111-111111111111")).toBe("Reel: 3 errores");
    expect(await pieceTitleForSale("22222222-2222-4222-8222-222222222222")).toBeNull();
    expect(await pieceTitleForSale("no-es-un-id")).toBeNull();
  });
});

describe("searchAdsForSale", () => {
  it("anuncios, conjuntos y campañas del catálogo, cada uno con su camino", async () => {
    const options = await searchAdsForSale("octubre");
    const byLevel = Object.fromEntries(options.map((o) => [o.level, o]));
    expect(byLevel.ad).toMatchObject({ adId: "33", adsetId: "22", campaignId: "11", label: "Octubre › Lookalike › Video 1" });
    expect(byLevel.adset).toMatchObject({ adId: null, adsetId: "22", campaignId: "11", label: "Octubre › Lookalike" });
    expect(byLevel.campaign).toMatchObject({ adId: null, adsetId: null, campaignId: "11", label: "Octubre" });
  });

  it("con menos de dos letras no busca", async () => {
    expect(await searchAdsForSale("x")).toEqual([]);
  });
});
