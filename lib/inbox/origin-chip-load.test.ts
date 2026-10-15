import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { loadOriginChips, withOriginChips } from "./origin-chip-load";

const WS = "ws-1";
const inbound = (id: string, origin_context: unknown) => ({ id, direction: "inbound" as const, origin_context });

function world() {
  return memoryDb({
    content_posts: [
      { id: "p1", workspace_id: WS, title: "Tres errores", format: "Reel" },
      { id: "p-otro", workspace_id: "ws-2", title: "De otro negocio", format: "Reel" },
    ],
    social_posts: [{ id: "s1", workspace_id: WS, content_post_id: "p1", caption: "x", media_type: "reel" }],
    meta_ads: [{ id: "a", workspace_id: WS, ad_id: "ad1", ad_account_id: "act_1", name: "Testimonio" }],
  });
}

describe("loadOriginChips", () => {
  it("resuelve los chips de un hilo con una lectura por tabla", async () => {
    const db = world();
    const chips = await loadOriginChips(db.client, {
      workspaceId: WS,
      canSeeAds: true,
      messages: [inbound("m1", { content: { social_post_id: "s1" } }), inbound("m2", null), inbound("m3", { ad: { ad_id: "ad1", platform: "instagram" } })],
    });
    expect(chips.m1.text).toBe("Vino de: Reel «Tres errores»");
    expect(chips.m3.href).toContain("act_1");
    expect(chips.m2).toBeUndefined();
  });

  it("no lee el catalogo de anuncios sin el permiso", async () => {
    const db = world();
    const chips = await loadOriginChips(db.client, {
      workspaceId: WS,
      canSeeAds: false,
      messages: [inbound("m1", { ad: { ad_id: "ad1", platform: "instagram" } })],
    });
    expect(chips.m1).toMatchObject({ text: "Anuncio", href: null });
  });

  it("filtra por el workspace: una pieza de otro negocio no se resuelve", async () => {
    const chips = await loadOriginChips(world().client, {
      workspaceId: WS,
      canSeeAds: false,
      messages: [inbound("m1", { content: { content_post_id: "p-otro" } })],
    });
    expect(chips.m1.href).toBeNull();
    expect(chips.m1.text).not.toContain("De otro negocio");
  });

  it("sin origenes no consulta nada", async () => {
    const db = world();
    const chips = await loadOriginChips(db.client, { workspaceId: WS, canSeeAds: true, messages: [inbound("m1", null)] });
    expect(chips).toEqual({});
  });

  it("si la base falla devuelve {} y no lanza", async () => {
    const broken = { from: () => { throw new Error("boom"); } } as never;
    const chips = await loadOriginChips(broken, { workspaceId: WS, canSeeAds: true, messages: [inbound("m1", { content: { content_post_id: "p1" } })] });
    expect(chips).toEqual({});
  });
});

describe("withOriginChips", () => {
  it("solo toca los mensajes con chip", () => {
    const out = withOriginChips([{ id: "a" }, { id: "b" }], { b: { kind: "ad", text: "Anuncio", href: null } });
    expect(out[0]).toEqual({ id: "a" });
    expect(out[1].origin_chip?.text).toBe("Anuncio");
  });
});
