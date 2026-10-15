/**
 * F31: la opción «Crear contactos desde comentarios» (Ajustes > General > Atribución).
 *
 * Con la opción APAGADA (Instagram, el valor por defecto) todo es como antes: solo vincula a quien ya es contacto.
 * Prendida, un comentarista nuevo nace como contacto con su «@usuario» (no anónimo) y el comentario queda vinculado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { memoryCentralRpc } from "@/lib/contacts/testing/memory-central";
import { defaultAttributionSettings } from "@/lib/attribution/settings";
import { attributeComment, type CommentAttributionParams } from "./attribution";

const WS = "ws-1";
const touches: Array<Record<string, unknown>> = [];

function world(settings?: unknown) {
  touches.length = 0;
  return memoryDb(
    {
      workspaces: settings === undefined ? [] : [{ id: WS, attribution_settings: settings }],
      contacts: [],
      social_post_comments: [{ id: "row-1", workspace_id: WS, platform: "instagram", external_comment_id: "c-1", contact_id: null }],
      social_posts: [],
      content_posts: [],
    },
    { rpc: { find_or_create_contact: memoryCentralRpc, record_contact_touch: (args) => (touches.push(args), { inserted: true }) } },
  );
}

const params = (over: Partial<CommentAttributionParams> = {}): CommentAttributionParams => ({
  workspaceId: WS, platform: "instagram", externalCommentId: "c-1", authorUsername: "nuevo", isOwn: false, commentedAt: "2026-10-05T12:00:00.000Z", socialPostId: null, ...over,
});

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("Instagram con la opción prendida", () => {
  const on = { ...defaultAttributionSettings(), comments_create_contact: { instagram: true, tiktok: true } };

  it("un comentarista nuevo nace como contacto NO anónimo con su «@usuario» y un toque comment", async () => {
    const db = world(on);
    const result = await attributeComment(db.client, params());
    expect(result).toMatchObject({ createdContact: true, touched: true });
    const contact = db.rows("contacts")[0];
    expect(contact).toMatchObject({ instagram_username: "nuevo", display_name: "@nuevo" });
    expect(contact.display_name).not.toBe("Unknown commenter");
    expect(db.rows("social_post_comments")[0].contact_id).toBe(contact.id);
    expect(touches[0]).toMatchObject({ p_contact_id: contact.id });
    expect((touches[0].p_touch as Record<string, unknown>).origin).toBe("comment");
  });

  it("dos comentarios del mismo usuario dan UN contacto", async () => {
    const db = world(on);
    await Promise.all([attributeComment(db.client, params()), attributeComment(db.client, params({ externalCommentId: "c-2" }))]);
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("un comentario propio nunca crea contacto", async () => {
    const db = world(on);
    await attributeComment(db.client, params({ isOwn: true }));
    expect(db.rows("contacts")).toHaveLength(0);
  });
});

describe("Instagram con la opción apagada (el valor por defecto)", () => {
  it("no crea el contacto y el comentario queda guardado sin contact_id", async () => {
    for (const settings of [undefined, defaultAttributionSettings(), "esto no es un objeto"]) {
      const db = world(settings);
      const result = await attributeComment(db.client, params());
      expect(result).toEqual({ contactId: null, createdContact: false, touched: false });
      expect(db.rows("contacts")).toHaveLength(0);
      expect(db.rows("social_post_comments")[0].contact_id).toBeNull();
      expect(touches).toHaveLength(0);
    }
  });
});

describe("TikTok", () => {
  it("por defecto crea un contacto anónimo", async () => {
    const db = world();
    db.rows("social_post_comments")[0].platform = "tiktok";
    const result = await attributeComment(db.client, params({ platform: "tiktok" }));
    expect(result.createdContact).toBe(true);
    expect(db.rows("contacts")[0]).toMatchObject({ tiktok_username: "nuevo", display_name: "Unknown commenter" });
  });

  it("apagado, solo busca", async () => {
    const db = world({ ...defaultAttributionSettings(), comments_create_contact: { instagram: false, tiktok: false } });
    db.rows("social_post_comments")[0].platform = "tiktok";
    const result = await attributeComment(db.client, params({ platform: "tiktok" }));
    expect(result.contactId).toBeNull();
    expect(db.rows("contacts")).toHaveLength(0);
  });
});
