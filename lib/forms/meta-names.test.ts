import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMetaNames, metaIdsFrom, metaNamesFor } from "./meta-names";

const AD_URL = { utm_id: "120248421362650108", utm_term: "120248421367730108", utm_content: "ad-n6-12veces" };

describe("metaIdsFrom", () => {
  it("lee los ids de los UTM y no toma una etiqueta propia por un id", () => {
    expect(metaIdsFrom(AD_URL)).toEqual({ campaign: "120248421362650108", adset: "120248421367730108", ad: null });
  });

  it("la clave propia gana sobre el UTM", () => {
    expect(metaIdsFrom({ ad_id: "111111", utm_content: "222222", adset_id: "333333", utm_term: "444444", campaign_id: "555555", utm_id: "666666" })).toEqual({
      campaign: "555555",
      adset: "333333",
      ad: "111111",
    });
  });

  it("sin datos no inventa nada", () => {
    expect(metaIdsFrom(null)).toEqual({ campaign: null, adset: null, ad: null });
    expect(metaIdsFrom({ utm_campaign: "clase-9-nov", utm_term: "123" })).toEqual({ campaign: null, adset: null, ad: null });
  });
});

describe("metaNamesFor", () => {
  it("devuelve el nombre de lo que está en el catálogo", () => {
    const names = { campaigns: { "120248421362650108": "Clase" }, adsets: { "120248421367730108": "N6" }, ads: {} };
    expect(metaNamesFor(AD_URL, names)).toEqual({ campaign: "Clase", adset: "N6", ad: null });
  });
});

function clientWith(result: (table: string, ids: string[]) => { data: unknown; error: { code: string } | null }) {
  const calls: Array<{ table: string; ids: string[] }> = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          in: (_column: string, ids: string[]) => {
            calls.push({ table, ids });
            return Promise.resolve(result(table, ids));
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("loadMetaNames", () => {
  it("pide solo los ids que hay, sin repetir, y arma los nombres", async () => {
    const { client, calls } = clientWith((table) =>
      table === "meta_adsets" ? { data: [{ adset_id: "120248421367730108", name: "N6" }], error: null } : { data: [], error: null },
    );
    const names = await loadMetaNames(client, "ws", [AD_URL, AD_URL]);
    expect(names.adsets).toEqual({ "120248421367730108": "N6" });
    expect(calls.find((c) => c.table === "meta_adsets")?.ids).toEqual(["120248421367730108"]);
    expect(calls.some((c) => c.table === "meta_ads")).toBe(false);
  });

  it("parte los ids en tandas", async () => {
    const { client, calls } = clientWith(() => ({ data: [], error: null }));
    const many = Array.from({ length: 250 }, (_, i) => ({ ad_id: String(1000000 + i) }));
    await loadMetaNames(client, "ws", many);
    expect(calls.filter((c) => c.table === "meta_ads").map((c) => c.ids.length)).toEqual([100, 100, 50]);
  });

  it("un error de la base deja los nombres vacíos y no lanza", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = clientWith(() => ({ data: null, error: { code: "42501" } }));
    await expect(loadMetaNames(client, "ws", [AD_URL])).resolves.toEqual({ campaigns: {}, adsets: {}, ads: {} });
    spy.mockRestore();
  });
});
