/**
 * Guardar comentarios (F46).
 */

import { describe, it, expect } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { findOrCreatePublication, isOwnComment, linkCommentToContact, storeComment } from "./store";

const WS = "ws-1";

const comment = (over = {}) => ({
  platform: "instagram",
  externalCommentId: "c-1",
  externalPostId: "ig-9",
  authorUsername: "unlead",
  authorName: "Un lead",
  isOwn: false,
  text: "SISTEMA",
  commentedAt: "2026-10-01T15:00:00Z",
  source: "webhook" as const,
  ...over,
});

const db = (over: Record<string, unknown[]> = {}) =>
  memoryDb(
    {
      social_posts: [],
      social_post_comments: [],
      contacts: [],
      ...over,
    },
    {
      unique: {
        social_post_comments: (a, b) =>
          a.workspace_id === b.workspace_id &&
          a.platform === b.platform &&
          a.external_comment_id === b.external_comment_id,
      },
    },
  );

describe("si el comentario es nuestro (F46)", () => {
  it("por el nombre de usuario de la cuenta", () => {
    // Sin esto, la respuesta publica del flow dispararia el mismo flow.
    expect(isOwnComment({ username: "minegocio" }, { username: "minegocio" })).toBe(true);
    expect(isOwnComment({ username: "unlead" }, { username: "minegocio" })).toBe(false);
  });

  it("si la red lo dice, alcanza", () => {
    expect(isOwnComment({ isOwnAccount: true }, { username: "otra" })).toBe(true);
  });

  it("tambien por el id de la cuenta", () => {
    expect(isOwnComment({ id: "ig-acc" }, { externalId: "ig-acc" })).toBe(true);
  });

  it("sin autor, no", () => {
    expect(isOwnComment(null, { username: "minegocio" })).toBe(false);
  });
});

describe("la publicacion del comentario (F46)", () => {
  it("si ya existe, se usa esa", async () => {
    const memory = db({
      social_posts: [{ id: "sp-1", social_account_id: "sa-1", external_post_id: "ig-9" }],
    });

    const result = await findOrCreatePublication(memory.client, {
      workspaceId: WS,
      socialAccountId: "sa-1",
      platform: "instagram",
      externalPostId: "ig-9",
    });

    expect(result).toEqual({ id: "sp-1", created: false });
    expect(memory.rows("social_posts")).toHaveLength(1);
  });

  it("si no existe, se crea como externa", async () => {
    // Un comentario sobre un post hecho a mano igual tiene que poder
    // guardarse: la fila external es el lugar donde colgarlo.
    const memory = db();

    const result = await findOrCreatePublication(memory.client, {
      workspaceId: WS,
      socialAccountId: "sa-1",
      platform: "tiktok",
      externalPostId: "tt-5",
    });

    expect(result.created).toBe(true);
    expect(memory.rows("social_posts")[0]).toMatchObject({
      origin: "external",
      status: null,
      external_post_id: "tt-5",
    });
  });
});

describe("guardar (F46)", () => {
  it("un comentario nuevo queda vinculado a su publicacion", async () => {
    const memory = db({
      social_posts: [{ id: "sp-1", social_account_id: "sa-1", external_post_id: "ig-9" }],
    });

    const result = await storeComment(memory.client, {
      workspaceId: WS,
      socialAccountId: "sa-1",
      comment: comment(),
    });

    expect(result.stored).toBe(true);
    expect(memory.rows("social_post_comments")[0]).toMatchObject({
      social_post_id: "sp-1",
      text: "SISTEMA",
      source: "webhook",
    });
  });

  it("el mismo comentario dos veces queda uno solo, actualizado", async () => {
    // El webhook y la relectura traen el mismo: no puede duplicarse.
    const memory = db();

    await storeComment(memory.client, {
      workspaceId: WS,
      socialAccountId: "sa-1",
      comment: comment({ likeCount: 1 }),
    });
    await storeComment(memory.client, {
      workspaceId: WS,
      socialAccountId: "sa-1",
      comment: comment({ likeCount: 9, source: "sync" as const }),
    });

    const rows = memory.rows("social_post_comments");
    expect(rows).toHaveLength(1);
    expect(rows[0].like_count).toBe(9);
  });

  it("uno propio se guarda igual", async () => {
    // El hilo tiene que leerse completo, con la respuesta del negocio.
    const memory = db();

    await storeComment(memory.client, {
      workspaceId: WS,
      socialAccountId: "sa-1",
      comment: comment({ externalCommentId: "c-2", isOwn: true, text: "Te lo mando por DM" }),
    });

    expect(memory.rows("social_post_comments")[0].is_own).toBe(true);
  });

  it("sin cuenta conocida se guarda igual, sin publicacion", async () => {
    // Descartarlo seria perder el comentario.
    const memory = db();

    const result = await storeComment(memory.client, {
      workspaceId: WS,
      socialAccountId: null,
      comment: comment(),
    });

    expect(result.stored).toBe(true);
    expect(memory.rows("social_post_comments")[0].social_post_id).toBeNull();
    expect(memory.rows("social_posts")).toHaveLength(0);
  });
});

describe("vincular con un contacto (F46)", () => {
  it("si el autor ya es un contacto, queda vinculado", async () => {
    const memory = db({
      social_post_comments: [
        {
          id: "c-row",
          workspace_id: WS,
          platform: "instagram",
          external_comment_id: "c-1",
          contact_id: null,
        },
      ],
      contacts: [{ id: "ct-1", workspace_id: WS, instagram_username: "unlead", deleted_at: null }],
    });

    const linked = await linkCommentToContact(memory.client, {
      workspaceId: WS,
      // El id de la RED, que es el que trae el webhook.
      externalCommentId: "c-1",
      platform: "instagram",
      authorUsername: "unlead",
    });

    expect(linked).toBe(true);
    expect(memory.rows("social_post_comments")[0].contact_id).toBe("ct-1");
  });

  it("el nombre se busca en la columna de SU red", async () => {
    // El mismo nombre en Instagram y en TikTok puede ser otra persona.
    const memory = db({
      social_post_comments: [
        {
          id: "c-row",
          workspace_id: WS,
          platform: "tiktok",
          external_comment_id: "c-1",
          contact_id: null,
        },
      ],
      contacts: [{ id: "ct-1", workspace_id: WS, instagram_username: "unlead", deleted_at: null }],
    });

    const linked = await linkCommentToContact(memory.client, {
      workspaceId: WS,
      externalCommentId: "c-1",
      platform: "tiktok",
      authorUsername: "unlead",
    });

    expect(linked).toBe(false);
  });

  it("si no es contacto, no pasa nada", async () => {
    const memory = db({
      social_post_comments: [
        { id: "c-row", workspace_id: WS, platform: "instagram", external_comment_id: "c-1" },
      ],
    });

    expect(
      await linkCommentToContact(memory.client, {
        workspaceId: WS,
        externalCommentId: "c-1",
        platform: "instagram",
        authorUsername: "desconocido",
      }),
    ).toBe(false);
  });
});
