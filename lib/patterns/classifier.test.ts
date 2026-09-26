import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectPending, applyClassification } from "./classifier";
import { memoryDb } from "../agent/testing/memory-db";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function db(texts: Array<Record<string, unknown>>) {
  return memoryDb({ message_texts: texts, message_categories: [] });
}

const pending = (id: string, over = {}) => ({ id, workspace_id: "ws-1", direction: "inbound", normalized_text: id, sample_text: id, category_id: null, source: null, ...over });

describe("selectPending (F20)", () => {
  it("solo toma category_id NULL y source NULL", async () => {
    const m = db([
      pending("a"),
      pending("b", { source: "human", category_id: "c1" }),
      pending("c", { source: "rule" }),
      pending("d"),
    ]);
    const rows = await selectPending(m.client, "ws-1", "inbound");
    expect(rows.map((r) => r.id).sort()).toEqual(["a", "d"]);
  });
});

describe("applyClassification (F20)", () => {
  const baseArgs = (m: ReturnType<typeof db>, over: Record<string, unknown> = {}) => ({
    workspaceId: "ws-1", direction: "inbound" as const,
    pendingIds: new Set(["a", "b", "c", "d"]),
    existingCategoryIds: new Set(["cat-precio"]),
    fallbackCategoryId: "cat-otro", runId: "run-1", promptVersion: 1,
    createCategory: async (name: string) => `new-${name}`,
    now: new Date("2026-09-25T00:00:00Z"),
    ...over,
  } as unknown as Parameters<typeof applyClassification>[1]);

  it("asigna a una categoría existente", async () => {
    const m = db([pending("a")]);
    const r = await applyClassification(m.client, baseArgs(m, {
      items: { items: [{ text_id: "a", category_id: "cat-precio", confidence: 0.9 }] },
      pendingIds: new Set(["a"]),
    }));
    expect(r.classified).toBe(1);
    expect(m.rows("message_texts")[0].category_id).toBe("cat-precio");
    expect(m.rows("message_texts")[0].source).toBe("model");
  });

  it("crea como máximo 3 categorías nuevas; el resto va a Otro", async () => {
    const m = db([pending("a"), pending("b"), pending("c"), pending("d")]);
    const created: string[] = [];
    const r = await applyClassification(m.client, baseArgs(m, {
      items: { items: [
        { text_id: "a", new_category: { name: "N1" }, confidence: 0.8 },
        { text_id: "b", new_category: { name: "N2" }, confidence: 0.8 },
        { text_id: "c", new_category: { name: "N3" }, confidence: 0.8 },
        { text_id: "d", new_category: { name: "N4" }, confidence: 0.8 },
      ] },
      createCategory: async (name: string) => { created.push(name); return `new-${name}`; },
    }));
    expect(r.newCategories).toBe(3);
    expect(r.toFallback).toBe(1);
    expect(created).toEqual(["N1", "N2", "N3"]);
    expect(m.rows("message_texts").find((t) => t.id === "d")?.category_id).toBe("cat-otro");
  });

  it("nunca toca filas source human/rule (update filtra por source null)", async () => {
    const m = db([pending("a", { source: "human", category_id: "cat-x" })]);
    const r = await applyClassification(m.client, baseArgs(m, {
      items: { items: [{ text_id: "a", category_id: "cat-precio", confidence: 0.9 }] },
      pendingIds: new Set(["a"]),
    }));
    // El update con .is('source', null) no matchea → no se clasificó.
    expect(m.rows("message_texts")[0].category_id).toBe("cat-x");
    expect(m.rows("message_texts")[0].source).toBe("human");
    expect(r.invalid + r.classified).toBeGreaterThan(0);
  });

  it("un id que no está entre los pendientes es inválido", async () => {
    const m = db([pending("a")]);
    const r = await applyClassification(m.client, baseArgs(m, {
      items: { items: [{ text_id: "zzz", category_id: "cat-precio", confidence: 0.9 }] },
      pendingIds: new Set(["a"]),
    }));
    expect(r.invalid).toBe(1);
    expect(r.classified).toBe(0);
  });

  it("JSON inválido → todos quedan sin clasificar", async () => {
    const m = db([pending("a")]);
    const r = await applyClassification(m.client, baseArgs(m, { items: { garbage: true }, pendingIds: new Set(["a"]) }));
    expect(r.classified).toBe(0);
    expect(r.invalid).toBe(1);
  });
});
