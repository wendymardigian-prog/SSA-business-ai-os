import { describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { parseManualChoice, type ManualChoice } from "./manual-channel";
import { registerManualSaleTouch } from "./manual-touch";
import { memoryRecordTouch } from "./test-support/touch-rpc";

const WS = "ws-1";
const OTHER_WS = "ws-2";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CONTACT = U(10);
const REFERRER = U(11);
const PIECE = U(20);
const FOREIGN_PIECE = U(21);
const POST = U(30);
const MEMBER = U(40);
const FOREIGN_MEMBER = U(41);

const choice = (raw: unknown): ManualChoice => {
  const parsed = parseManualChoice(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.choice;
};

const seed = (): MemoryDb =>
  memoryDb(
    {
      contacts: [
        { id: CONTACT, workspace_id: WS, deleted_at: null, referred_by_user_id: null, referred_by_contact_id: null },
        { id: REFERRER, workspace_id: WS, deleted_at: null },
      ],
      content_posts: [
        { id: PIECE, workspace_id: WS, title: "Reel: 3 errores", deleted_at: null },
        { id: FOREIGN_PIECE, workspace_id: OTHER_WS, title: "De otro negocio", deleted_at: null },
      ],
      social_posts: [{ id: POST, workspace_id: WS, content_post_id: PIECE, platform: "instagram", deleted_at: null }],
      meta_ads: [{ workspace_id: WS, ad_id: "33", adset_id: "22", campaign_id: "11", name: "Video 1" }],
      meta_adsets: [{ workspace_id: WS, adset_id: "22", campaign_id: "11" }],
      meta_campaigns: [{ workspace_id: WS, campaign_id: "11" }],
      workspace_members: [{ workspace_id: WS, user_id: MEMBER }, { workspace_id: OTHER_WS, user_id: FOREIGN_MEMBER }],
      contact_touches: [],
    },
    { rpc: { record_contact_touch: memoryRecordTouch } },
  );

const params = (over: Record<string, unknown> = {}) => ({ workspaceId: WS, contactId: CONTACT, saleDate: "2026-10-10", timeZone: "UTC", saleKey: "key-1234", ...over });

describe("registerManualSaleTouch", () => {
  it("contenido orgánico: toque manual al mediodía de la venta, con el título de la BASE y la publicación única de la red", async () => {
    const db = seed();
    const result = await registerManualSaleTouch(
      db.client,
      params({ choice: choice({ kind: "organic", network: "instagram", piece: { contentPostId: PIECE, title: "Un título que mandó el navegador" } }) }) as never,
    );
    expect(result).toMatchObject({ ok: true, channel: "organic" });
    const touch = db.rows("contact_touches")[0];
    expect(touch).toMatchObject({
      workspace_id: WS,
      contact_id: CONTACT,
      origin: "manual",
      source: "instagram",
      medium: "organic_social",
      content_label: "Reel: 3 errores",
      content_post_id: PIECE,
      social_post_id: POST,
      occurred_at: "2026-10-10T12:00:00.000Z",
      dedupe_key: "sale-manual:key-1234",
      channel: "organic",
    });
  });

  it("la publicación la decide el servidor: lo que mande el navegador no cuenta", async () => {
    const db = seed();
    await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "organic", network: "tiktok", piece: { contentPostId: PIECE, socialPostId: U(99) } }) }) as never);
    expect(db.rows("contact_touches")[0].social_post_id).toBeNull();
  });

  it("una pieza de OTRO workspace se rechaza y no deja ningún toque", async () => {
    const db = seed();
    const result = await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "organic", network: "instagram", piece: { contentPostId: FOREIGN_PIECE } }) }) as never);
    expect(result).toMatchObject({ ok: false, error: "Esa pieza no existe" });
    expect(db.rows("contact_touches")).toHaveLength(0);
  });

  it("anuncio: el adset y la campaña salen del catálogo, no del navegador; el canal es pauta", async () => {
    const db = seed();
    const result = await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "paid", network: "facebook", ad: { adId: "33", adsetId: "999", campaignId: "888" } }) }) as never);
    expect(result).toMatchObject({ ok: true, channel: "paid" });
    expect(db.rows("contact_touches")[0]).toMatchObject({ source: "facebook", medium: "paid_social", ad_id: "33", adset_id: "22", campaign_id: "11" });
  });

  it("un anuncio que no está en el catálogo del workspace se rechaza", async () => {
    const db = seed();
    const result = await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "paid", network: "facebook", ad: { adId: "77" } }) }) as never);
    expect(result).toMatchObject({ ok: false, error: "Ese anuncio no está en el catálogo de Meta" });
    expect(db.rows("contact_touches")).toHaveLength(0);
  });

  it("«No sé qué anuncio»: solo la red, y sigue siendo pauta", async () => {
    const db = seed();
    await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "paid", network: "instagram", ad: null }) }) as never);
    expect(db.rows("contact_touches")[0]).toMatchObject({ channel: "paid", ad_id: null });
  });

  it("referido por un contacto: guarda quién en el raw y completa al contacto si no tenía referidor", async () => {
    const db = seed();
    const result = await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "referral", referrer: { type: "contact", contactId: REFERRER } }) }) as never);
    expect(result).toMatchObject({ ok: true, channel: "referral" });
    expect(db.rows("contact_touches")[0].raw).toMatchObject({ channel: "referral", referrer_contact_id: REFERRER });
    expect(db.rows("contacts").find((c) => c.id === CONTACT)).toMatchObject({ referred_by_contact_id: REFERRER });
  });

  it("referido: nunca pisa a quien el contacto ya tenía como referidor", async () => {
    const db = seed();
    db.rows("contacts").find((c) => c.id === CONTACT)!.referred_by_user_id = MEMBER;
    await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "referral", referrer: { type: "contact", contactId: REFERRER } }) }) as never);
    const contact = db.rows("contacts").find((c) => c.id === CONTACT)!;
    expect(contact.referred_by_user_id).toBe(MEMBER);
    expect(contact.referred_by_contact_id).toBeNull();
  });

  it("referido por alguien del equipo: tiene que ser del workspace", async () => {
    const db = seed();
    expect(await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "referral", referrer: { type: "member", userId: FOREIGN_MEMBER } }) }) as never)).toMatchObject({
      ok: false,
      error: "Esa persona no es parte del equipo",
    });
    expect(await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "referral", referrer: { type: "member", userId: MEMBER } }) }) as never)).toMatchObject({ ok: true });
    expect(db.rows("contacts").find((c) => c.id === CONTACT)).toMatchObject({ referred_by_user_id: MEMBER });
  });

  it("un contacto no puede ser su propio referido, ni uno de otro workspace", async () => {
    const db = seed();
    expect(await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "referral", referrer: { type: "contact", contactId: CONTACT } }) }) as never)).toMatchObject({ ok: false });
    expect(await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "referral", referrer: { type: "contact", contactId: U(77) } }) }) as never)).toMatchObject({ ok: false, error: "Ese contacto no existe" });
    expect(db.rows("contact_touches")).toHaveLength(0);
  });

  it("evento y otro: canal directo", async () => {
    const db = seed();
    expect(await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "event", name: "Expo 2026" }) }) as never)).toMatchObject({ ok: true, channel: "direct" });
    expect(db.rows("contact_touches")[0]).toMatchObject({ medium: "event", campaign: "Expo 2026" });
  });

  it("enviar dos veces la misma eleccion deja UN solo toque y devuelve el mismo id (doble clic)", async () => {
    const db = seed();
    const p = params({ choice: choice({ kind: "organic", network: "instagram", piece: { contentPostId: PIECE } }) }) as never;
    const a = await registerManualSaleTouch(db.client, p);
    const b = await registerManualSaleTouch(db.client, p);
    expect(a).toMatchObject({ ok: true });
    expect(b).toEqual(a);
    expect(db.rows("contact_touches")).toHaveLength(1);
  });

  it("si la persona cambió de idea con la misma clave, queda el toque nuevo (con la clave de reintento) y no el viejo", async () => {
    const db = seed();
    const first = await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "event", name: "Expo 2026" }) }) as never);
    const second = await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "organic", network: "instagram", piece: { contentPostId: PIECE } }) }) as never);
    expect(first.ok && second.ok).toBe(true);
    expect(first.ok && second.ok && first.touchId !== second.touchId).toBe(true);
    expect(db.rows("contact_touches")).toHaveLength(2);
    expect(db.rows("contact_touches")[1].dedupe_key).toMatch(/^sale-manual:key-1234:[0-9a-f]{8}$/);
    // Y el reintento con la misma eleccion nueva tampoco duplica.
    const third = await registerManualSaleTouch(db.client, params({ choice: choice({ kind: "organic", network: "instagram", piece: { contentPostId: PIECE } }) }) as never);
    expect(third).toEqual(second);
    expect(db.rows("contact_touches")).toHaveLength(2);
  });

  it("un contacto inexistente o una fecha inválida devuelven un error, sin lanzar", async () => {
    const db = seed();
    expect(await registerManualSaleTouch(db.client, params({ contactId: U(99), choice: choice({ kind: "other" }) }) as never)).toMatchObject({ ok: false });
    expect(await registerManualSaleTouch(db.client, params({ saleDate: "2026-02-31", choice: choice({ kind: "other" }) }) as never)).toMatchObject({ ok: false });
  });

  it("nunca loguea el contenido del toque", async () => {
    const db = seed();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await registerManualSaleTouch(db.client, params({ contactId: U(99), choice: choice({ kind: "event", name: "Secreto del evento" }) }) as never);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Secreto del evento");
    spy.mockRestore();
  });
});
