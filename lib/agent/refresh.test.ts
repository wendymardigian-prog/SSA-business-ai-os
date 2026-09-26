import { describe, it, expect, vi, beforeEach } from "vitest";
import { refreshConversationFromPlatform } from "./refresh";
import type { Zernio } from "@/lib/zernio-client";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Fake mínimo de Zernio: devuelve los mensajes que se le den, orden descendente. */
function fakeZernio(messages: unknown[]): Zernio {
  return {
    messages: {
      getInboxConversationMessages: vi.fn().mockResolvedValue({ data: { messages } }),
    },
  } as unknown as Zernio;
}

/**
 * Fake supabase para refresh: canal con late_account_id, filas locales dadas,
 * registra inserts y updates.
 */
function fakeDb(localRows: Array<Record<string, unknown>>) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      if (table === "channels") {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = async () => ({ data: { late_account_id: "acc-1" }, error: null });
        return b;
      }
      // messages
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.gte = () => b;
      b.then = (cb: (r: unknown) => unknown) => cb({ data: localRows, error: null });
      b.insert = (row: Record<string, unknown>) => {
        inserts.push(row);
        return { then: (cb: (r: unknown) => unknown) => cb({ error: null }) };
      };
      b.update = (patch: Record<string, unknown>) => ({
        eq: (_col: string, id: unknown) => {
          updates.push({ id, patch });
          return { then: (cb: (r: unknown) => unknown) => cb({ error: null }) };
        },
      });
      return b;
    },
  } as never;
  return { client, inserts, updates };
}

const args = {
  conversationId: "cv-1",
  workspaceId: "ws-1",
  channelId: "ch-1",
  lateConversationId: "lc-1",
  sinceIso: "2026-09-15T16:00:00.000Z",
  runId: "run-1",
};

describe("refreshConversationFromPlatform (F5)", () => {
  it("un saliente desconocido se guarda como external", async () => {
    const { client, inserts } = fakeDb([]);
    const zernio = fakeZernio([
      { id: "z-1", message: "respuesta de ManyChat", direction: "outgoing", createdAt: "2026-09-15T16:00:05.000Z" },
    ]);
    const res = await refreshConversationFromPlatform(client, args, { zernio });
    expect(res.ok).toBe(true);
    expect(res.inserted).toBe(1);
    expect(inserts[0].origin).toBe("external");
    expect(inserts[0].platform_message_id).toBe("z-1");
  });

  it("un id ya guardado no se duplica; rellena el id que falte", async () => {
    const { client, inserts, updates } = fakeDb([
      { id: "local-1", direction: "outbound", text: "hola", created_at: "2026-09-15T16:00:05.000Z", platform_message_id: null, platform_native_message_id: null, sent_by_agent_id: "a1", agent_run_id: "run-1", status: "sent" },
    ]);
    // El historial devuelve el id nativo de Meta (no forma Zernio) para ESE mensaje.
    const zernio = fakeZernio([
      { id: "mid_meta_123", message: "hola", direction: "outgoing", createdAt: "2026-09-15T16:00:06.000Z" },
    ]);
    const res = await refreshConversationFromPlatform(client, args, { zernio });
    expect(res.inserted).toBe(0); // no se insertó nada
    // Matcheó por texto+Δt (envío propio) y rellenó el id nativo.
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.platform_native_message_id).toBe("mid_meta_123");
  });

  it("el envío propio de este turno no se marca external ni se duplica", async () => {
    const { client, inserts } = fakeDb([
      { id: "own-1", direction: "outbound", text: "respuesta del agente", created_at: "2026-09-15T16:00:10.000Z", platform_message_id: "z-own", platform_native_message_id: null, sent_by_agent_id: "a1", agent_run_id: "run-1", status: "sent" },
    ]);
    const zernio = fakeZernio([
      { id: "z-own", message: "respuesta del agente", direction: "outgoing", createdAt: "2026-09-15T16:00:10.000Z" },
    ]);
    const res = await refreshConversationFromPlatform(client, args, { zernio });
    expect(res.inserted).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it("un entrante remoto que falta no se inserta como saliente", async () => {
    const { client, inserts } = fakeDb([]);
    const zernio = fakeZernio([
      { id: "z-in", message: "hola de nuevo", direction: "incoming", createdAt: "2026-09-15T16:00:20.000Z" },
    ]);
    const res = await refreshConversationFromPlatform(client, args, { zernio });
    expect(res.inserted).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it("sin late_conversation_id no hace nada", async () => {
    const { client } = fakeDb([]);
    const res = await refreshConversationFromPlatform(client, { ...args, lateConversationId: null }, { zernio: fakeZernio([]) });
    expect(res.ok).toBe(false);
  });
});
