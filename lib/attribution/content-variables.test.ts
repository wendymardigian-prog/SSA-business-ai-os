import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { contentVariablesFor, flowContentOrigin, resolveContentForAd, resolveContentForIncoming, resolveContentForPost } from "./content-variables";

const WS = "ws-1";
const world = () =>
  memoryDb({
    social_posts: [{ id: "sp-1", workspace_id: WS, platform: "instagram", external_post_id: "ext-1", content_post_id: "cp-1", caption: "Caption", deleted_at: null }],
    content_posts: [{ id: "cp-1", workspace_id: WS, title: "Reel de dólares", attribution_code: "c8k2f" }],
    meta_ads: [{ id: "ad-row", workspace_id: WS, ad_id: "120001", social_post_id: "sp-1", content_post_id: "cp-1" }],
  }).client;

describe("contentVariablesFor", () => {
  it("arma las cuatro variables", () => {
    expect(contentVariablesFor({ socialPostId: "sp", contentPostId: "cp", attributionCode: "c8k2f", title: " Reel " })).toEqual({ social_post_id: "sp", content_post_id: "cp", code: "c8k2f", title: "Reel" });
  });
  it("sin publicación ni pieza es null", () => {
    expect(contentVariablesFor(null)).toBeNull();
    expect(contentVariablesFor({ socialPostId: null, contentPostId: " ", attributionCode: "x", title: "y" })).toBeNull();
  });
});

describe("resolvedores", () => {
  it("la publicación comentada resuelve su pieza, su código y su título", async () => {
    expect(await resolveContentForPost(world(), { workspaceId: WS, platform: "instagram", externalPostId: "ext-1" })).toEqual({ social_post_id: "sp-1", content_post_id: "cp-1", code: "c8k2f", title: "Reel de dólares" });
  });
  it("una publicación que no es del sistema, o de otro workspace, da null", async () => {
    expect(await resolveContentForPost(world(), { workspaceId: WS, platform: "instagram", externalPostId: "otra" })).toBeNull();
    expect(await resolveContentForPost(world(), { workspaceId: "otro", platform: "instagram", externalPostId: "ext-1" })).toBeNull();
    expect(await resolveContentForPost(world(), { workspaceId: WS, platform: "instagram", externalPostId: null })).toBeNull();
  });
  it("un anuncio vinculado a una pieza resuelve la pieza", async () => {
    expect(await resolveContentForAd(world(), { workspaceId: WS, adId: "120001" })).toMatchObject({ content_post_id: "cp-1", code: "c8k2f" });
    expect(await resolveContentForAd(world(), { workspaceId: WS, adId: "999" })).toBeNull();
  });
  it("un mensaje entrante: la historia gana a la herencia y esta al anuncio", async () => {
    const db = world();
    const story = { socialPostId: "sp-1", contentPostId: "cp-1", title: "x" };
    const inherited = { social_post_id: "sp-1", content_post_id: "cp-1", title: "y" };
    expect(await resolveContentForIncoming(db, { workspaceId: WS, storyPiece: story, inherited, adId: "120001" })).toMatchObject({ title: "Reel de dólares" });
    expect(await resolveContentForIncoming(db, { workspaceId: WS, storyPiece: null, inherited, adId: null })).toMatchObject({ content_post_id: "cp-1" });
    expect(await resolveContentForIncoming(db, { workspaceId: WS, storyPiece: null, inherited: null, adId: "120001" })).toMatchObject({ content_post_id: "cp-1" });
    expect(await resolveContentForIncoming(db, { workspaceId: WS, storyPiece: null, inherited: null, adId: null })).toBeNull();
  });
  it("nunca lanzan", async () => {
    const broken = { from: () => { throw new Error("x"); } } as never;
    expect(await resolveContentForPost(broken, { workspaceId: WS, platform: "instagram", externalPostId: "e" })).toBeNull();
    expect(await resolveContentForAd(broken, { workspaceId: WS, adId: "1" })).toBeNull();
  });
});

describe("flowContentOrigin (lo que guarda el DM saliente)", () => {
  it("con una pieza en las variables guarda via flow, el flujo y el título", () => {
    expect(flowContentOrigin({ content: { social_post_id: "sp-1", content_post_id: "cp-1", code: "c8k2f", title: "Reel" } }, "flow-1")).toEqual({ social_post_id: "sp-1", content_post_id: "cp-1", via: "flow", flow_id: "flow-1", title: "Reel" });
  });
  it("sin pieza, o con basura, es null (el saliente no cambia)", () => {
    expect(flowContentOrigin({}, "f")).toBeNull();
    expect(flowContentOrigin({ content: null }, "f")).toBeNull();
    expect(flowContentOrigin({ content: "texto" }, "f")).toBeNull();
    expect(flowContentOrigin({ content: { social_post_id: null, content_post_id: null } }, "f")).toBeNull();
    expect(flowContentOrigin(undefined, "f")).toBeNull();
  });
});
