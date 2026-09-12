import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { Zernio } from "@/lib/zernio-client";
import {
  backfillConversation,
  fetchConversationHistory,
  toMessageRow,
  toMessageStatus,
  addStats,
  emptyStats,
} from "./backfill-messages";

type Db = SupabaseClient<Database>;

interface FakePage {
  messages: unknown[];
  pagination?: { hasMore?: boolean; nextCursor?: string | null };
}

/** Cliente Zernio falso: una pagina preparada por llamada. */
function fakeZernio(pages: FakePage[]) {
  let call = 0;
  const get = vi.fn().mockImplementation(() => {
    const page = pages[Math.min(call, pages.length - 1)];
    call++;
    return Promise.resolve({ data: page });
  });
  return { client: { messages: { getInboxConversationMessages: get } } as unknown as Zernio, get };
}

/**
 * Supabase falso: declara que ids ya estan guardados y registra lo que se
 * inserta. Los inserts pueden fallar segun una cola de errores, para probar el
 * camino de reintento fila por fila.
 */
function fakeDb(config: {
  existing?: Array<{ platform_message_id: string }>;
  insertErrors?: Array<{ code?: string; message?: string } | null>;
  readError?: { message: string };
}) {
  const inserts: unknown[] = [];
  const errors = [...(config.insertErrors ?? [])];

  const client = {
    from() {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.not = async () => ({
        data: config.readError ? null : (config.existing ?? []),
        error: config.readError ?? null,
      });
      builder.insert = (values: unknown) => {
        inserts.push(values);
        const error = errors.length > 0 ? errors.shift() : null;
        return {
          then: (cb: (r: unknown) => unknown) => cb({ error: error ?? null }),
        };
      };
      return builder;
    },
  } as unknown as Db;

  return { client, inserts };
}

const base = {
  conversationId: "cv-1",
  lateConversationId: "late-cv-1",
  accountId: "acc-1",
  workspaceId: "ws-1",
};

const msg = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  message: `texto de ${id}`,
  direction: "incoming",
  createdAt: "2026-09-11T10:00:00Z",
  ...extra,
});

describe("toMessageStatus", () => {
  it("deja pasar los estados que la tabla acepta", () => {
    expect(toMessageStatus("sent")).toBe("sent");
    expect(toMessageStatus("delivered")).toBe("delivered");
    expect(toMessageStatus("failed")).toBe("failed");
    expect(toMessageStatus("pending")).toBe("pending");
  });

  it("traduce 'read', que la tabla no tiene y el CHECK rechazaria", () => {
    expect(toMessageStatus("read")).toBe("delivered");
  });

  it("ante cualquier otra cosa cae en 'sent' en vez de romper el insert", () => {
    expect(toMessageStatus("deleted")).toBe("sent");
    expect(toMessageStatus(undefined)).toBe("sent");
    expect(toMessageStatus(null)).toBe("sent");
  });
});

describe("toMessageRow", () => {
  it("guarda el id de Zernio como platform_message_id: es el que deduplica", () => {
    const row = toMessageRow(msg("zernio-1"), "cv-1", "ws-1");
    expect(row?.platform_message_id).toBe("zernio-1");
  });

  it("traduce la direccion de Zernio al vocabulario de la tabla", () => {
    expect(toMessageRow(msg("a", { direction: "incoming" }), "cv-1", "ws-1")?.direction).toBe(
      "inbound",
    );
    expect(toMessageRow(msg("b", { direction: "outgoing" }), "cv-1", "ws-1")?.direction).toBe(
      "outbound",
    );
  });

  it("no trae lo que el remitente borro: las reglas de Meta sobre borrados", () => {
    expect(toMessageRow(msg("c", { isDeleted: true }), "cv-1", "ws-1")).toBeNull();
  });

  it("descarta el mensaje sin id, que no habria forma de deduplicar", () => {
    expect(toMessageRow({ message: "sin id", direction: "incoming" }, "cv-1", "ws-1")).toBeNull();
  });

  it("lleva el workspace_id y la conversacion", () => {
    const row = toMessageRow(msg("d"), "cv-9", "ws-9");
    expect(row).toMatchObject({ conversation_id: "cv-9", workspace_id: "ws-9" });
  });
});

describe("fetchConversationHistory", () => {
  it("sigue el cursor hasta que la API dice que no hay mas", async () => {
    const { client, get } = fakeZernio([
      { messages: [msg("1")], pagination: { hasMore: true, nextCursor: "c2" } },
      { messages: [msg("2")], pagination: { hasMore: false, nextCursor: null } },
    ]);

    const res = await fetchConversationHistory(client, {
      lateConversationId: "late-cv-1",
      accountId: "acc-1",
    });

    expect(res.messages).toHaveLength(2);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0].query.cursor).toBe("c2");
  });

  it("corta en el tope de paginas aunque la API insista con que hay mas", async () => {
    const { client, get } = fakeZernio([
      { messages: [msg("x")], pagination: { hasMore: true, nextCursor: "otro" } },
    ]);

    const res = await fetchConversationHistory(client, {
      lateConversationId: "late-cv-1",
      accountId: "acc-1",
      maxPages: 3,
    });

    expect(get).toHaveBeenCalledTimes(3);
    expect(res.messages).toHaveLength(3);
  });

  it("un error de red devuelve lo que alcanzo a traer, sin lanzar", async () => {
    const get = vi.fn().mockRejectedValue(new Error("timeout"));
    const client = {
      messages: { getInboxConversationMessages: get },
    } as unknown as Zernio;

    const res = await fetchConversationHistory(client, {
      lateConversationId: "late-cv-1",
      accountId: "acc-1",
    });

    expect(res.error).toBe("timeout");
    expect(res.messages).toEqual([]);
  });
});

describe("backfillConversation", () => {
  it("inserta en lote lo que no estaba", async () => {
    const { client: zernio } = fakeZernio([{ messages: [msg("1"), msg("2")] }]);
    const { client: db, inserts } = fakeDb({ existing: [] });

    const stats = await backfillConversation({
      supabase: db,
      zernio,
      ...base,
      apply: true,
    });

    expect(stats).toMatchObject({ fetched: 2, inserted: 2, skipped: 0, failed: 0 });
    expect(inserts).toHaveLength(1);
    expect((inserts[0] as unknown[]).length).toBe(2);
  });

  it("lo que ya estaba guardado no se vuelve a insertar", async () => {
    const { client: zernio } = fakeZernio([{ messages: [msg("1"), msg("2")] }]);
    const { client: db, inserts } = fakeDb({ existing: [{ platform_message_id: "1" }] });

    const stats = await backfillConversation({
      supabase: db,
      zernio,
      ...base,
      apply: true,
    });

    expect(stats).toMatchObject({ fetched: 2, inserted: 1, skipped: 1 });
    expect((inserts[0] as unknown[]).length).toBe(1);
  });

  it("correrlo dos veces no duplica nada", async () => {
    const { client: zernio } = fakeZernio([{ messages: [msg("1"), msg("2")] }]);
    const { client: db, inserts } = fakeDb({
      existing: [{ platform_message_id: "1" }, { platform_message_id: "2" }],
    });

    const stats = await backfillConversation({
      supabase: db,
      zernio,
      ...base,
      apply: true,
    });

    expect(stats).toMatchObject({ inserted: 0, skipped: 2 });
    expect(inserts).toHaveLength(0);
  });

  it("en dry-run cuenta lo que escribiria y no escribe", async () => {
    const { client: zernio } = fakeZernio([{ messages: [msg("1"), msg("2")] }]);
    const { client: db, inserts } = fakeDb({ existing: [] });

    const stats = await backfillConversation({
      supabase: db,
      zernio,
      ...base,
      apply: false,
    });

    expect(stats.inserted).toBe(2);
    expect(inserts).toHaveLength(0);
  });

  it("si el lote choca, reintenta fila por fila y cuenta el duplicado como visto", async () => {
    const { client: zernio } = fakeZernio([{ messages: [msg("1"), msg("2")] }]);
    const { client: db, inserts } = fakeDb({
      existing: [],
      // el lote falla, despues una fila entra y la otra ya estaba
      insertErrors: [{ code: "23505" }, null, { code: "23505" }],
    });

    const stats = await backfillConversation({
      supabase: db,
      zernio,
      ...base,
      apply: true,
    });

    expect(stats).toMatchObject({ inserted: 1, skipped: 1, failed: 0 });
    expect(inserts).toHaveLength(3); // el lote + las dos filas sueltas
  });

  it("los mensajes borrados por el remitente se cuentan aparte y no se guardan", async () => {
    const { client: zernio } = fakeZernio([
      { messages: [msg("1"), msg("2", { isDeleted: true })] },
    ]);
    const { client: db } = fakeDb({ existing: [] });

    const stats = await backfillConversation({
      supabase: db,
      zernio,
      ...base,
      apply: true,
    });

    expect(stats).toMatchObject({ fetched: 2, discarded: 1, inserted: 1 });
  });

  it("si no puede leer lo ya guardado, no inserta a ciegas", async () => {
    const { client: zernio } = fakeZernio([{ messages: [msg("1")] }]);
    const { client: db, inserts } = fakeDb({ readError: { message: "permission denied" } });

    const stats = await backfillConversation({
      supabase: db,
      zernio,
      ...base,
      apply: true,
    });

    expect(stats.error).toContain("no pude leer lo ya guardado");
    expect(inserts).toHaveLength(0);
  });
});

describe("addStats", () => {
  it("acumula el total del barrido", () => {
    const a = { ...emptyStats(), fetched: 2, inserted: 1, skipped: 1 };
    const b = { ...emptyStats(), fetched: 3, inserted: 3, discarded: 1 };
    expect(addStats(a, b)).toEqual({
      fetched: 5,
      inserted: 4,
      skipped: 1,
      discarded: 1,
      failed: 0,
    });
  });
});
