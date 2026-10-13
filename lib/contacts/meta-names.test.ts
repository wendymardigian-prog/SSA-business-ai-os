import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { loadMetaNames } from "./meta-names";

const WS = "ws-1";

function dbWithCatalog() {
  const db = memoryDb({
    meta_campaigns: [{ workspace_id: WS, campaign_id: "1001", name: "Campaña Octubre" }],
    meta_adsets: [{ workspace_id: WS, adset_id: "2001", name: "Conjunto Frío" }],
    meta_ads: [
      { workspace_id: WS, ad_id: "3001", name: "Video Testimonio", thumbnail_path: "ws-1/3001.png" },
      { workspace_id: WS, ad_id: "3002", name: "Sin miniatura", thumbnail_path: null },
      { workspace_id: "otro", ad_id: "3001", name: "De otro workspace", thumbnail_path: null },
    ],
  });
  const sign = vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}` }, error: null }));
  (db.client as unknown as { storage: unknown }).storage = { from: () => ({ createSignedUrl: sign }) };
  return { db, sign };
}

describe("loadMetaNames", () => {
  it("devuelve los nombres y firma la miniatura (con la sesion de quien mira)", async () => {
    const { db, sign } = dbWithCatalog();
    const names = await loadMetaNames(db.client, WS, [{ meta_campaign_id: "1001", meta_adset_id: "2001", meta_ad_id: "3001" }, { meta_ad_id: "3002" }]);
    expect(names?.campaigns).toEqual({ "1001": "Campaña Octubre" });
    expect(names?.adsets).toEqual({ "2001": "Conjunto Frío" });
    expect(names?.ads["3001"]).toEqual({ name: "Video Testimonio", thumbnailUrl: "https://signed.example/ws-1/3001.png" });
    expect(names?.ads["3002"]).toEqual({ name: "Sin miniatura", thumbnailUrl: null });
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("solo mira el catalogo de este workspace", async () => {
    const { db } = dbWithCatalog();
    const names = await loadMetaNames(db.client, "otro", [{ meta_ad_id: "3001" }]);
    expect(names?.ads["3001"]?.name).toBe("De otro workspace");
  });

  it("sin ids de Meta en los toques no consulta nada", async () => {
    const { db } = dbWithCatalog();
    const from = vi.spyOn(db.client, "from");
    expect(await loadMetaNames(db.client, WS, [{}, { meta_ad_id: null }])).toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });

  it("un fallo no rompe la ficha: devuelve undefined (y se muestran los ids)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = dbWithCatalog();
    (db.client as unknown as { from: unknown }).from = () => {
      throw new Error("base caida");
    };
    expect(await loadMetaNames(db.client, WS, [{ meta_ad_id: "3001" }])).toBeUndefined();
  });
});
