import { describe, expect, it } from "vitest";
import { bodySegments, commentErrorMessage, threadItems, type CommentRow } from "./thread";

const row = (over: Partial<CommentRow>): CommentRow => ({
  id: "c1",
  kind: "comment",
  author_id: "u1",
  body: "hola",
  mentions: [],
  edited_at: null,
  deleted_at: null,
  created_at: "2026-11-12T10:00:00Z",
  ...over,
});

describe("threadItems", () => {
  it("ordena del más viejo al más nuevo y oculta los borrados", () => {
    const items = threadItems([
      row({ id: "b", created_at: "2026-11-12T11:00:00Z" }),
      row({ id: "a", created_at: "2026-11-12T10:00:00Z" }),
      row({ id: "x", deleted_at: "2026-11-12T12:00:00Z" }),
    ], "u1");
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("solo el autor edita y borra; el de sistema, nadie", () => {
    const [mine, other, system] = threadItems([
      row({ id: "1", author_id: "u1", created_at: "2026-11-12T10:00:00Z" }),
      row({ id: "2", author_id: "u2", created_at: "2026-11-12T10:01:00Z" }),
      row({ id: "3", kind: "system", author_id: null, created_at: "2026-11-12T10:02:00Z" }),
    ], "u1");
    expect([mine.canEdit, other.canEdit, system.canEdit]).toEqual([true, false, false]);
    expect(threadItems([row({})], null)[0].canEdit).toBe(false);
  });
  it("marca editado y destaca las menciones sin leer", () => {
    const [a] = threadItems([row({ id: "m", edited_at: "2026-11-12T10:05:00Z" })], "u2", ["m"]);
    expect(a.edited).toBe(true);
    expect(a.highlighted).toBe(true);
  });
});

describe("bodySegments", () => {
  it("resalta solo las menciones conocidas, la más larga primero", () => {
    expect(bodySegments("Hola @Ana Pérez y @Ana", ["Ana Pérez"])).toEqual([
      { text: "Hola ", mention: false },
      { text: "@Ana Pérez", mention: true },
      { text: " y @Ana", mention: false },
    ]);
    expect(bodySegments("sin nada", [])).toEqual([{ text: "sin nada", mention: false }]);
  });
});

describe("commentErrorMessage", () => {
  it("traduce los códigos", () => {
    expect(commentErrorMessage("CM001", "x")).toMatch(/No podés comentar/);
    expect(commentErrorMessage("CM002", "x")).toMatch(/tus comentarios/);
    expect(commentErrorMessage(undefined, "otro")).toBe("otro");
  });
});
