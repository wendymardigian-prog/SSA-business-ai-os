import { describe, expect, it } from "vitest";
import { myReaction, reactionBelongsTo, reactionsForMessage, type ReactionRow } from "@/lib/messages/reactions";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { findMessageId, recordReaction } from "@/lib/messages/reactions-store";

const row = (over: Partial<ReactionRow> = {}): ReactionRow => ({
  message_id: null,
  platform_message_id: "p1",
  emoji: "❤️",
  actor_key: "contact",
  removed_at: null,
  created_at: "2026-10-16T10:00:00Z",
  ...over,
});
const msg = { id: "m1", platform_message_id: "p1", platform_native_message_id: "n1" };

describe("a que mensaje pertenece una reaccion", () => {
  it("por message_id, por el id del proveedor o por el nativo", () => {
    expect(reactionBelongsTo(row({ message_id: "m1", platform_message_id: "otro" }), msg)).toBe(true);
    expect(reactionBelongsTo(row({ platform_message_id: "p1" }), msg)).toBe(true);
    expect(reactionBelongsTo(row({ platform_message_id: "n1" }), msg)).toBe(true);
  });

  it("de otro mensaje, no", () => {
    expect(reactionBelongsTo(row({ platform_message_id: "zzz" }), msg)).toBe(false);
    expect(reactionBelongsTo(row({ message_id: "m2", platform_message_id: "zzz" }), msg)).toBe(false);
  });

  it("un mensaje sin ids del proveedor solo se une por message_id", () => {
    expect(reactionBelongsTo(row({ platform_message_id: "p1" }), { id: "m9" })).toBe(false);
  });
});

describe("chips de un mensaje", () => {
  it("agrupa por emoji y marca quien la puso", () => {
    const rows = [row({ actor_key: "contact" }), row({ actor_key: "business", emoji: "👍", created_at: "2026-10-16T10:05:00Z" })];
    expect(reactionsForMessage(rows, msg)).toEqual([
      { emoji: "❤️", count: 1, mine: false, fromContact: true },
      { emoji: "👍", count: 1, mine: true, fromContact: false },
    ]);
  });

  it("el mismo emoji de los dos suma 2 y queda como tuyo", () => {
    const rows = [row({ actor_key: "contact" }), row({ actor_key: "business" })];
    expect(reactionsForMessage(rows, msg)).toEqual([{ emoji: "❤️", count: 2, mine: true, fromContact: true }]);
  });

  it("las quitadas y las de otros mensajes no cuentan", () => {
    const rows = [row({ removed_at: "2026-10-16T11:00:00Z" }), row({ platform_message_id: "zzz" })];
    expect(reactionsForMessage(rows, msg)).toEqual([]);
  });

  it("myReaction devuelve la del negocio o null", () => {
    expect(myReaction([row({ actor_key: "business", emoji: "🔥" })], msg)).toBe("🔥");
    expect(myReaction([row({ actor_key: "contact" })], msg)).toBeNull();
    expect(myReaction([row({ actor_key: "business", removed_at: "2026-10-16T11:00:00Z" })], msg)).toBeNull();
  });
});

describe("guardar reacciones", () => {
  const input = { workspaceId: "ws-1", conversationId: "cv-1", platformMessageId: "p1", actor: "contact" as const };

  it("la primera inserta, enlazada al mensaje si existe", async () => {
    const db = memoryDb({ messages: [{ id: "m1", conversation_id: "cv-1", platform_message_id: "p1", platform_native_message_id: null }], message_reactions: [] });
    expect(await recordReaction(db.client, { ...input, emoji: "❤️" })).toBe(true);
    expect(db.rows("message_reactions")).toHaveLength(1);
    expect(db.rows("message_reactions")[0]).toMatchObject({ message_id: "m1", emoji: "❤️", direction: "in", actor_key: "contact", removed_at: null });
  });

  it("otra del mismo actor la reemplaza (una por actor y mensaje)", async () => {
    const db = memoryDb({ messages: [], message_reactions: [] });
    await recordReaction(db.client, { ...input, emoji: "❤️" });
    await recordReaction(db.client, { ...input, emoji: "😂" });
    expect(db.rows("message_reactions")).toHaveLength(1);
    expect(db.rows("message_reactions")[0].emoji).toBe("😂");
  });

  it("quitarla pone removed_at y no borra la fila", async () => {
    const db = memoryDb({ messages: [], message_reactions: [] });
    await recordReaction(db.client, { ...input, emoji: "❤️" });
    await recordReaction(db.client, { ...input, emoji: "" });
    expect(db.rows("message_reactions")).toHaveLength(1);
    expect(db.rows("message_reactions")[0].removed_at).not.toBeNull();
  });

  it("volver a reaccionar despues de quitar la reactiva", async () => {
    const db = memoryDb({ messages: [], message_reactions: [] });
    await recordReaction(db.client, { ...input, emoji: "❤️" });
    await recordReaction(db.client, { ...input, emoji: "" });
    await recordReaction(db.client, { ...input, emoji: "🔥" });
    expect(db.rows("message_reactions")[0]).toMatchObject({ emoji: "🔥", removed_at: null });
  });

  it("la del negocio queda como saliente y con la persona que la puso", async () => {
    const db = memoryDb({ messages: [], message_reactions: [] });
    await recordReaction(db.client, { ...input, actor: "business", userId: "u-1", emoji: "👍" });
    expect(db.rows("message_reactions")[0]).toMatchObject({ direction: "out", actor_key: "business", reacted_by_user_id: "u-1" });
  });

  it("encuentra el mensaje por el id nativo tambien", async () => {
    const db = memoryDb({ messages: [{ id: "m2", conversation_id: "cv-1", platform_message_id: "zz", platform_native_message_id: "nat" }] });
    expect(await findMessageId(db.client, "cv-1", "nat")).toBe("m2");
    expect(await findMessageId(db.client, "cv-1", "nadie")).toBeNull();
  });
});
