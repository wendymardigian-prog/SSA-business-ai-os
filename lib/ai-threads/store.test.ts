import { describe, expect, it, vi } from "vitest";
import { appendMessage, getOrCreateDesignerThread } from "./store";

const WS = "11111111-2222-3333-4444-555555555555";

function fakeDb(opts: { existing?: Record<string, unknown> | null; insertError?: { code: string; message: string } | null; after?: Record<string, unknown> | null } = {}) {
  let lookups = 0;
  const inserts: Record<string, unknown>[] = [];
  const db = {
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          maybeSingle: async () => {
            lookups++;
            return { data: lookups === 1 ? (opts.existing ?? null) : (opts.after ?? null), error: null };
          },
        };
        return chain;
      },
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, ...row });
        return {
          select: () => ({
            single: async () =>
              opts.insertError ? { data: null, error: opts.insertError } : { data: { id: "nuevo", created_at: "2026-11-07T00:00:00Z", ...row }, error: null },
          }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
  return { db: db as never, inserts };
}

describe("ai_threads: el hilo del Diseñador IA", () => {
  it("lo crea si no existe, con canal y sujeto", async () => {
    const { db, inserts } = fakeDb();
    const t = await getOrCreateDesignerThread(db, { workspaceId: WS, kind: "template", subjectId: "t1", userId: "u1" });
    expect(t.id).toBe("nuevo");
    expect(inserts[0]).toMatchObject({ channel: "designer", subject_type: "design_template", subject_id: "t1", workspace_id: WS });
  });

  it("devuelve el existente sin crear otro", async () => {
    const { db, inserts } = fakeDb({ existing: { id: "viejo", workspace_id: WS } });
    expect((await getOrCreateDesignerThread(db, { workspaceId: WS, kind: "design", subjectId: "d1", userId: "u1" })).id).toBe("viejo");
    expect(inserts).toEqual([]);
  });

  it("si otro pedido lo creó en el mismo instante (23505), usa ese", async () => {
    const { db } = fakeDb({ insertError: { code: "23505", message: "duplicado" }, after: { id: "ganador", workspace_id: WS } });
    expect((await getOrCreateDesignerThread(db, { workspaceId: WS, kind: "design", subjectId: "d1", userId: null })).id).toBe("ganador");
  });

  it("nunca devuelve un hilo de otro negocio", async () => {
    const { db } = fakeDb({ existing: { id: "ajeno", workspace_id: "99999999-2222-3333-4444-555555555555" } });
    await expect(getOrCreateDesignerThread(db, { workspaceId: WS, kind: "design", subjectId: "d1", userId: null })).rejects.toThrow(/otro negocio/);
  });
});

describe("ai_messages: la forma se valida antes de escribir", () => {
  const thread = { id: "t", workspace_id: WS, channel: "designer" as const };
  it("guarda un mensaje del Diseñador con su alcance y su resultado", async () => {
    const { db, inserts } = fakeDb();
    await appendMessage(db, thread, { role: "assistant", content: "Listo", context: { scope: { page: 2 } }, result: { changed_pages: [2], summary: "Cambió la página 3" } });
    expect(inserts[0]).toMatchObject({ role: "assistant", context: { scope: { page: 2 } }, result: { changed_pages: [2] } });
  });

  it("rechaza un resultado que no tiene la forma del canal", async () => {
    const { db } = fakeDb();
    await expect(appendMessage(db, thread, { role: "assistant", content: "x", result: { lo_que_sea: true } })).rejects.toThrow(/no es válido/);
  });

  it("rechaza adjuntos mal formados", async () => {
    const { db } = fakeDb();
    const spy = vi.fn();
    await expect(appendMessage(db, thread, { role: "user", content: "x", attachments: [{ name: "a" } as never] })).rejects.toThrow(/adjuntos/);
    expect(spy).not.toHaveBeenCalled();
  });
});
