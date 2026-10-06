/**
 * F86: la atribución de un comentario.
 *
 * Lo que se fija son las dos reglas que no son obvias: Instagram NO crea un
 * contacto por cada comentarista (solo vincula si ya existe), y TikTok SÍ crea
 * uno anónimo porque el comentario es lo único que va a haber. Además, un
 * comentario propio no hace nada y nada de esto puede lanzar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { attributeComment, type CommentAttributionParams } from "./attribution";

const WS = "ws-1";
const AT = "2026-10-05T12:00:00.000Z";
const touches: Array<Record<string, unknown>> = [];

function world(
  seed: Record<string, Array<Record<string, unknown>>> = {},
  rpc: "ok" | "throws" = "ok",
) {
  touches.length = 0;
  return memoryDb(
    {
      contacts: [],
      social_post_comments: [{ id: "row-1", workspace_id: WS, platform: "instagram", external_comment_id: "c-1", contact_id: null }],
      social_posts: [],
      content_posts: [],
      ...seed,
    },
    {
      rpc: {
        record_contact_touch: (args) => {
          if (rpc === "throws") throw new Error("la base se cayo");
          touches.push(args);
          return { inserted: true };
        },
      },
    },
  );
}

const params = (over: Partial<CommentAttributionParams> = {}): CommentAttributionParams => ({
  workspaceId: WS,
  platform: "instagram",
  externalCommentId: "c-1",
  authorUsername: "unlead",
  isOwn: false,
  commentedAt: AT,
  socialPostId: null,
  ...over,
});

const touchOf = () => touches[0]?.p_touch as Record<string, unknown> | undefined;

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("Instagram: solo vincula a quien YA es contacto (F86)", () => {
  it("alguien que ya es contacto: se vincula el comentario y se anota el toque", async () => {
    const db = world({ contacts: [{ id: "ct-1", workspace_id: WS, instagram_username: "unlead", deleted_at: null }] });

    const result = await attributeComment(db.client, params());

    expect(result).toMatchObject({ contactId: "ct-1", createdContact: false, touched: true });
    expect(db.rows("social_post_comments")[0].contact_id).toBe("ct-1");
    expect(touches[0]).toMatchObject({ p_workspace_id: WS, p_contact_id: "ct-1" });
    expect(touchOf()).toMatchObject({ source: "instagram", medium: "comment", origin: "comment", dedupe_key: "comment:c-1" });
  });

  it("alguien que NO es contacto: no se crea nada ni se anota nada", async () => {
    const db = world();

    const result = await attributeComment(db.client, params());

    expect(result).toEqual({ contactId: null, createdContact: false, touched: false });
    expect(db.rows("contacts")).toHaveLength(0);
    expect(touches).toHaveLength(0);
    expect(db.rows("social_post_comments")[0].contact_id).toBeNull();
  });

  it("si el flow lo crea DESPUES, la segunda llamada lo vincula y lo anota", async () => {
    const db = world();
    await attributeComment(db.client, params());
    expect(touches).toHaveLength(0);

    // Lo que hace processComment al disparar el flow por palabra clave.
    db.rows("contacts").push({ id: "ct-2", workspace_id: WS, instagram_username: "unlead", deleted_at: null });
    const second = await attributeComment(db.client, params());

    expect(second).toMatchObject({ contactId: "ct-2", touched: true });
    expect(db.rows("social_post_comments")[0].contact_id).toBe("ct-2");
  });

  it("no vincula a un contacto borrado ni al de otro workspace", async () => {
    const db = world({
      contacts: [
        { id: "borrado", workspace_id: WS, instagram_username: "unlead", deleted_at: "2026-10-01T00:00:00Z" },
        { id: "ajeno", workspace_id: "ws-otro", instagram_username: "unlead", deleted_at: null },
      ],
    });

    expect((await attributeComment(db.client, params())).contactId).toBeNull();
  });

  it("el usuario de Instagram no se confunde con el de TikTok", async () => {
    const db = world({ contacts: [{ id: "ct-tt", workspace_id: WS, tiktok_username: "unlead", deleted_at: null }] });

    expect((await attributeComment(db.client, params())).contactId).toBeNull();
  });
});

describe("TikTok: crea un contacto anónimo (F86, D8)", () => {
  const tiktok = (over: Partial<CommentAttributionParams> = {}) => params({ platform: "tiktok", ...over });

  it("alguien desconocido: se crea un contacto anónimo con su usuario y se anota el toque", async () => {
    const db = world({ social_post_comments: [{ id: "row-1", workspace_id: WS, platform: "tiktok", external_comment_id: "c-1", contact_id: null }] });

    const result = await attributeComment(db.client, tiktok());

    expect(result).toMatchObject({ createdContact: true, touched: true });
    const created = db.rows("contacts")[0];
    expect(created).toMatchObject({ workspace_id: WS, tiktok_username: "unlead", display_name: "Unknown commenter" });
    // Sin ningun otro dato: es lo que mantiene al contacto anonimo (columna generada).
    expect(created.email).toBeUndefined();
    expect(created.phone).toBeUndefined();
    expect(created.instagram_username).toBeUndefined();
    expect(touchOf()).toMatchObject({ source: "tiktok", medium: "comment" });
    expect(db.rows("social_post_comments")[0].contact_id).toBe(created.id);
  });

  it("alguien que ya es contacto: NO se crea otro", async () => {
    const db = world({ contacts: [{ id: "ct-1", workspace_id: WS, tiktok_username: "unlead", deleted_at: null }] });

    const result = await attributeComment(db.client, tiktok());

    expect(result).toMatchObject({ contactId: "ct-1", createdContact: false });
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("el mismo comentario dos veces: un solo contacto y la misma clave de toque", async () => {
    const db = world();

    await attributeComment(db.client, tiktok());
    await attributeComment(db.client, tiktok());

    expect(db.rows("contacts")).toHaveLength(1);
    expect(touches).toHaveLength(2);
    expect((touches[0].p_touch as Record<string, unknown>).dedupe_key).toBe("comment:c-1");
    expect((touches[1].p_touch as Record<string, unknown>).dedupe_key).toBe("comment:c-1");
  });

  it("sin usuario no se puede crear un contacto que luego se encuentre", async () => {
    const db = world();

    const result = await attributeComment(db.client, tiktok({ authorUsername: null }));

    expect(result.contactId).toBeNull();
    expect(db.rows("contacts")).toHaveLength(0);
  });
});

describe("los comentarios propios y los de otras redes (F86)", () => {
  it("un comentario PROPIO no crea contacto ni toque", async () => {
    const db = world({ contacts: [{ id: "ct-1", workspace_id: WS, tiktok_username: "unlead", deleted_at: null }] });

    expect(await attributeComment(db.client, params({ platform: "tiktok", isOwn: true }))).toEqual({
      contactId: null, createdContact: false, touched: false,
    });
    expect(touches).toHaveLength(0);
  });

  it("YouTube y otras redes no se tocan: sin columna de usuario no hay contacto que buscar", async () => {
    const db = world();

    expect((await attributeComment(db.client, params({ platform: "youtube" }))).contactId).toBeNull();
    expect(db.rows("contacts")).toHaveLength(0);
  });
});

describe("la pieza comentada (F86)", () => {
  // Ids reales: `recordTouch` valida que los de pieza sean UUID.
  const SP = "11111111-1111-4111-8111-111111111111";
  const CP = "22222222-2222-4222-8222-222222222222";
  const known = { contacts: [{ id: "ct-1", workspace_id: WS, instagram_username: "unlead", deleted_at: null }] };

  it("con la publicacion conocida, el toque lleva la pieza: su id, el del contenido y su titulo", async () => {
    const db = world({
      ...known,
      social_posts: [{ id: SP, content_post_id: CP, caption: "caption largo" }],
      content_posts: [{ id: CP, title: "Cómo cobrar en dólares" }],
    });

    await attributeComment(db.client, params({ socialPostId: SP }));

    expect(touchOf()).toMatchObject({ social_post_id: SP, content_post_id: CP, content: "Cómo cobrar en dólares" });
  });

  it("una publicacion hecha a mano (sin pieza): usa la primera linea del caption", async () => {
    const db = world({
      ...known,
      social_posts: [{ id: SP, content_post_id: null, caption: "\nPrimera línea del reel\nSegunda" }],
    });

    await attributeComment(db.client, params({ socialPostId: SP }));

    expect(touchOf()).toMatchObject({ social_post_id: SP, content: "Primera línea del reel" });
    expect(touchOf()).not.toHaveProperty("content_post_id");
  });

  it("un comentario huérfano (sin publicación) se anota igual, sin pieza", async () => {
    const db = world(known);

    await attributeComment(db.client, params({ socialPostId: null }));

    expect(touches).toHaveLength(1);
    expect(touchOf()).not.toHaveProperty("social_post_id");
    expect(touchOf()).not.toHaveProperty("content");
  });
});

describe("nunca lanza (F86)", () => {
  it("si el registro del toque explota, devuelve sin lanzar", async () => {
    const db = world({ contacts: [{ id: "ct-1", workspace_id: WS, instagram_username: "unlead", deleted_at: null }] }, "throws");

    await expect(attributeComment(db.client, params())).resolves.toMatchObject({ contactId: "ct-1", touched: false });
  });

  it("si la base entera falla, tampoco", async () => {
    const broken = { from: () => { throw new Error("base caida"); } } as never;

    await expect(attributeComment(broken, params())).resolves.toEqual({ contactId: null, createdContact: false, touched: false });
  });
});
