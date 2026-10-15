import { describe, expect, it } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { buildOriginViews, loadOriginParts } from "./attribution-load";

const WS = "ws-1";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEO = U(1);
const REFERRER_CONTACT = U(2);

const touch = (over: Record<string, unknown>) => ({
  workspace_id: WS,
  occurred_at: "2026-10-03T15:00:00Z",
  channel: null,
  origin: "manual",
  source: null,
  medium: null,
  campaign: null,
  content_label: null,
  content_post_id: null,
  social_post_id: null,
  ad_id: null,
  adset_id: null,
  campaign_id: null,
  meta_ad_id: null,
  meta_adset_id: null,
  meta_campaign_id: null,
  raw: {},
  ...over,
});

function seed(): MemoryDb {
  return memoryDb({
    contact_touches: [
      touch({ id: "t-org", channel: "organic", source: "instagram", medium: "organic_social", content_post_id: "p1", social_post_id: "s1" }),
      touch({ id: "t-paid", channel: "paid", source: "facebook", medium: "paid_social", meta_ad_id: "33", meta_adset_id: "22", meta_campaign_id: "11" }),
      touch({ id: "t-ref", channel: "referral", source: "referral", medium: "referral_person", raw: { referrer_contact_id: REFERRER_CONTACT } }),
      touch({ id: "t-direct", channel: "direct", source: "whatsapp", medium: "dm" }),
    ],
    content_posts: [{ id: "p1", workspace_id: WS, title: "Reel: 3 errores", assigned_to: LEO }],
    social_posts: [{ id: "s1", workspace_id: WS, platform: "instagram", assigned_to: null, content_post_id: "p1" }],
    meta_ads: [{ workspace_id: WS, ad_id: "33", name: "Video 1", ad_account_id: "act_9", adset_id: "22", campaign_id: "11", thumbnail_path: null }],
    meta_adsets: [{ workspace_id: WS, adset_id: "22", name: "Lookalike" }],
    meta_campaigns: [{ workspace_id: WS, campaign_id: "11", name: "Octubre" }],
    contacts: [{ id: REFERRER_CONTACT, workspace_id: WS, display_name: "Ana Gómez" }],
  });
}

const sales = ["t-org", "t-paid", "t-ref", "t-direct"].map((t) => ({ id: `sale-${t}`, attribution_type: "manual", attribution: null, attribution_touch_id: t }));
const members = new Map([[LEO, "Leo Pérez"]]);

describe("loadOriginParts + buildOriginViews", () => {
  it("arma los cuatro casos con la pieza, su responsable, el anuncio y quien refirió", async () => {
    const db = seed();
    const parts = await loadOriginParts(db.client, { workspaceId: WS, touchIds: sales.map((s) => s.attribution_touch_id), memberNames: members, canViewAds: true });
    const views = buildOriginViews(sales, parts, true);

    expect(views["sale-t-org"]).toMatchObject({ channel: "organic", piece: { title: "Reel: 3 errores", network: "Instagram", responsible: { id: LEO, name: "Leo Pérez" } } });
    expect(views["sale-t-paid"].ad).toMatchObject({ path: ["Octubre", "Lookalike", "Video 1"], href: "/dashboard/dashboards/ads/ads/33?cuenta=act_9" });
    expect(views["sale-t-ref"]).toMatchObject({ channel: "referral", referrer: { name: "Ana Gómez", href: `/dashboard/contacts/${REFERRER_CONTACT}` } });
    expect(views["sale-t-direct"]).toMatchObject({ channel: "direct", unidentified: true });
  });

  it("sin dashboards.ads.view ni se lee el catálogo de Meta: se muestran los ids y no hay link", async () => {
    const db = seed();
    const reads: string[] = [];
    const spy = { ...db.client, from: (t: string) => (reads.push(t), db.client.from(t as never)) } as unknown as typeof db.client;
    const parts = await loadOriginParts(spy, { workspaceId: WS, touchIds: ["t-paid"], memberNames: members, canViewAds: false });
    expect(reads).not.toContain("meta_ads");
    expect(reads).not.toContain("meta_campaigns");
    const view = buildOriginViews([sales[1]], parts, false)["sale-t-paid"];
    expect(view.ad).toMatchObject({ path: ["Campaña 11", "Conjunto 22", "Anuncio 33"], href: null });
  });

  it("una consulta por tabla, no una por venta", async () => {
    const db = seed();
    const reads: string[] = [];
    const spy = { ...db.client, from: (t: string) => (reads.push(t), db.client.from(t as never)) } as unknown as typeof db.client;
    await loadOriginParts(spy, { workspaceId: WS, touchIds: sales.map((s) => s.attribution_touch_id), memberNames: members, canViewAds: true });
    const counts = reads.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {});
    expect(Object.values(counts).every((n) => n === 1)).toBe(true);
  });

  it("un toque que la RLS no deja ver cae a la copia congelada de la venta", async () => {
    const db = seed();
    const hidden = { id: "sale-x", attribution_type: "last_touch", attribution: { source: "instagram", medium: "paid_social", ad_id: "5" }, attribution_touch_id: "t-ajeno" };
    const parts = await loadOriginParts(db.client, { workspaceId: WS, touchIds: ["t-ajeno"], memberNames: members, canViewAds: true });
    expect(buildOriginViews([hidden], parts, true)["sale-x"]).toMatchObject({ channel: "paid", ad: { path: ["Anuncio 5"] } });
  });

  it("sin toques no consulta nada", async () => {
    const db = seed();
    const reads: string[] = [];
    const spy = { ...db.client, from: (t: string) => (reads.push(t), db.client.from(t as never)) } as unknown as typeof db.client;
    expect((await loadOriginParts(spy, { workspaceId: WS, touchIds: [], memberNames: members, canViewAds: true })).size).toBe(0);
    expect(reads).toHaveLength(0);
  });

  it("un workspace ajeno no se lee", async () => {
    const db = seed();
    db.rows("contact_touches").push(touch({ id: "t-foreign", workspace_id: "ws-2", channel: "organic" }));
    const parts = await loadOriginParts(db.client, { workspaceId: WS, touchIds: ["t-foreign"], memberNames: members, canViewAds: true });
    expect(parts.get("t-foreign")?.touch).toBeNull();
  });
});
