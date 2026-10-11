import { describe, expect, it, vi } from "vitest";
import { fakeDb, type DbCall } from "@/lib/testing/fake-db";
import { applyMemory, readContactMemory, writeContactMemory } from "./memory";

const NOW = new Date("2026-10-10T12:00:00Z");

/** Un contacto "de verdad" en memoria: el UPDATE condicional solo escribe si coincide. */
function contactStore(initial: { memory: string | null; updatedAt: string | null }) {
  const state = { ...initial };
  const hooks: Array<() => void> = [];
  const db = fakeDb({
    "contacts:select": () => ({ data: { ai_conversation_summary: state.memory, ai_summary_updated_at: state.updatedAt } }),
    "contacts:update": (call: DbCall) => {
      hooks.shift()?.();
      const guard = call.filters.find((f) => f.column === "ai_summary_updated_at");
      const matches = guard?.method === "is" ? state.updatedAt === null : guard?.value === state.updatedAt;
      if (!matches) return { data: [] };
      const values = call.values as { ai_conversation_summary: string; ai_summary_updated_at: string };
      state.memory = values.ai_conversation_summary;
      state.updatedAt = values.ai_summary_updated_at;
      return { data: [{ id: "ct1" }] };
    },
  });
  return { db, state, beforeNextUpdate: (fn: () => void) => hooks.push(fn) };
}

describe("lectura y escritura condicional", () => {
  it("lee la memoria y su marca de tiempo", async () => {
    const { db } = contactStore({ memory: "vieja", updatedAt: "2026-10-01T00:00:00Z" });
    expect(await readContactMemory(db.client, "ct1")).toEqual({ memory: "vieja", updatedAt: "2026-10-01T00:00:00Z" });
  });
  it("un contacto que no existe o esta borrado no tiene memoria que leer", async () => {
    const db = fakeDb({ "contacts:select": { data: null } });
    expect(await readContactMemory(db.client, "x")).toBeNull();
  });
  it("escribe solo si la marca sigue siendo la que se leyo (y trata null como null)", async () => {
    const a = contactStore({ memory: null, updatedAt: null });
    expect(await writeContactMemory(a.db.client, { contactId: "ct1", memory: "nueva", expectedUpdatedAt: null, now: NOW })).toBe(true);
    expect(a.state.memory).toBe("nueva");
    const b = contactStore({ memory: "x", updatedAt: "2026-10-02T00:00:00Z" });
    expect(await writeContactMemory(b.db.client, { contactId: "ct1", memory: "nueva", expectedUpdatedAt: "2026-10-01T00:00:00Z", now: NOW })).toBe(false);
    expect(b.state.memory).toBe("x");
  });
});

describe("applyMemory", () => {
  it("con memoria previa: la integrada reemplaza a la vieja y se informa el valor anterior (para la auditoria)", async () => {
    const { db, state } = contactStore({ memory: "vieja", updatedAt: "2026-10-01T00:00:00Z" });
    const out = await applyMemory(db.client, { contactId: "ct1", read: { memory: "vieja", updatedAt: "2026-10-01T00:00:00Z" }, first: "integrada", produce: vi.fn(), now: NOW });
    expect(out).toEqual({ status: "applied", previous: "vieja", memory: "integrada" });
    expect(state.memory).toBe("integrada");
    expect(state.updatedAt).toBe(NOW.toISOString());
  });

  it("si el cierre de una conversacion escribio en el medio, NO se pierde lo suyo: la segunda pasada parte del valor nuevo", async () => {
    const { db, state, beforeNextUpdate } = contactStore({ memory: "vieja", updatedAt: "2026-10-01T00:00:00Z" });
    // Entre la lectura y la escritura, el cierre de una conversacion escribe.
    beforeNextUpdate(() => { state.memory = "escrita por el cierre"; state.updatedAt = "2026-10-10T11:59:00Z"; });
    const produce = vi.fn().mockImplementation(async (previous: string | null) => `integrada con (${previous})`);
    const out = await applyMemory(db.client, { contactId: "ct1", read: { memory: "vieja", updatedAt: "2026-10-01T00:00:00Z" }, first: "integrada sobre la vieja", produce, now: NOW });
    expect(produce).toHaveBeenCalledWith("escrita por el cierre");
    expect(out).toEqual({ status: "applied", previous: "escrita por el cierre", memory: "integrada con (escrita por el cierre)" });
    expect(state.memory).toBe("integrada con (escrita por el cierre)");
  });

  it("si vuelve a chocar, queda en conflicto y no pisa nada", async () => {
    const { db, state, beforeNextUpdate } = contactStore({ memory: "vieja", updatedAt: "2026-10-01T00:00:00Z" });
    beforeNextUpdate(() => { state.memory = "A"; state.updatedAt = "2026-10-10T11:58:00Z"; });
    beforeNextUpdate(() => { state.memory = "B"; state.updatedAt = "2026-10-10T11:59:00Z"; });
    const out = await applyMemory(db.client, { contactId: "ct1", read: { memory: "vieja", updatedAt: "2026-10-01T00:00:00Z" }, first: "x", produce: async () => "y", now: NOW });
    expect(out).toEqual({ status: "conflict" });
    expect(state.memory).toBe("B");
  });

  it("una memoria vacia no se escribe", async () => {
    const { db } = contactStore({ memory: "vieja", updatedAt: "t" });
    expect(await applyMemory(db.client, { contactId: "ct1", read: { memory: "vieja", updatedAt: "t" }, first: "  ", produce: vi.fn(), now: NOW })).toEqual({ status: "skipped" });
    expect(await applyMemory(db.client, { contactId: "ct1", read: { memory: "vieja", updatedAt: "t" }, first: null, produce: vi.fn(), now: NOW })).toEqual({ status: "skipped" });
    expect(db.writes()).toHaveLength(0);
  });

  it("si el modelo no logra una segunda memoria, se omite sin pisar", async () => {
    const { db, state, beforeNextUpdate } = contactStore({ memory: "vieja", updatedAt: "2026-10-01T00:00:00Z" });
    beforeNextUpdate(() => { state.updatedAt = "2026-10-10T11:59:00Z"; });
    const out = await applyMemory(db.client, { contactId: "ct1", read: { memory: "vieja", updatedAt: "2026-10-01T00:00:00Z" }, first: "x", produce: async () => null, now: NOW });
    expect(out).toEqual({ status: "skipped" });
  });
});
