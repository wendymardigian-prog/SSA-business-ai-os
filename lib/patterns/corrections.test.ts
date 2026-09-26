import { describe, it, expect, vi, beforeEach } from "vitest";
import { moveText, createCategoryAndMove, renameCategory, mergeCategory } from "./corrections";
import { memoryDb } from "../agent/testing/memory-db";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function world() {
  return memoryDb({
    message_categories: [
      { id: "cat-otro", workspace_id: "ws-1", direction: "inbound", name: "Otro", is_fallback: true, created_by: "system" },
      { id: "cat-si", workspace_id: "ws-1", direction: "inbound", name: "Dice que sí", is_fallback: false, created_by: "model" },
      { id: "cat-no", workspace_id: "ws-1", direction: "inbound", name: "Dice que no", is_fallback: false, created_by: "model" },
    ],
    message_texts: [
      { id: "t1", workspace_id: "ws-1", direction: "inbound", normalized_text: "ok", sample_text: "ok", category_id: "cat-no", source: "model" },
      { id: "t2", workspace_id: "ws-1", direction: "inbound", normalized_text: "dale", sample_text: "dale", category_id: "cat-no", source: "model" },
    ],
    audit_log: [],
  });
}

describe("correcciones (F21)", () => {
  it("mover marca source human y review_result corrected", async () => {
    const m = world();
    const r = await moveText(m.client, { workspaceId: "ws-1", textId: "t1", categoryId: "cat-si", userId: "u1" });
    expect(r.ok).toBe(true);
    const t = m.rows("message_texts").find((x) => x.id === "t1")!;
    expect(t.category_id).toBe("cat-si");
    expect(t.source).toBe("human");
    expect(t.review_result).toBe("corrected");
    expect(m.rows("audit_log")).toHaveLength(1);
  });

  it("crear categoría nueva la crea con created_by user y mueve el texto", async () => {
    const m = world();
    const r = await createCategoryAndMove(m.client, { workspaceId: "ws-1", direction: "inbound", name: "Pregunta precio", textId: "t1", userId: "u1" });
    expect(r.ok).toBe(true);
    const cat = m.rows("message_categories").find((c) => c.name === "Pregunta precio")!;
    expect(cat.created_by).toBe("user");
    expect(m.rows("message_texts").find((x) => x.id === "t1")!.category_id).toBe(cat.id);
  });

  it('"Otro" no se puede renombrar', async () => {
    const m = world();
    const r = await renameCategory(m.client, { workspaceId: "ws-1", categoryId: "cat-otro", name: "Otra cosa", userId: "u1" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Otro/);
  });

  it("renombrar una categoría normal funciona", async () => {
    const m = world();
    const r = await renameCategory(m.client, { workspaceId: "ws-1", categoryId: "cat-si", name: "Acepta", userId: "u1" });
    expect(r.ok).toBe(true);
    expect(m.rows("message_categories").find((c) => c.id === "cat-si")!.name).toBe("Acepta");
  });

  it("unir mueve las filas y archiva la origen", async () => {
    const m = world();
    const r = await mergeCategory(m.client, { workspaceId: "ws-1", sourceId: "cat-no", targetId: "cat-si", userId: "u1", now: new Date("2026-09-25T00:00:00Z") });
    expect(r.ok).toBe(true);
    expect(m.rows("message_texts").every((t) => t.category_id === "cat-si")).toBe(true);
    const src = m.rows("message_categories").find((c) => c.id === "cat-no")!;
    expect(src.merged_into_id).toBe("cat-si");
    expect(src.archived_at).toBeTruthy();
  });

  it('"Otro" no se puede unir', async () => {
    const m = world();
    const r = await mergeCategory(m.client, { workspaceId: "ws-1", sourceId: "cat-otro", targetId: "cat-si", userId: "u1" });
    expect(r.ok).toBe(false);
  });
});
