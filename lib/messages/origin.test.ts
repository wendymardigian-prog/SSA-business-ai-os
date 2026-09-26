import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { insertMessage, handleMessageSentEcho } from "@/lib/inbound";
import { toMessageRow } from "@/lib/backfill-messages";

type Db = SupabaseClient<Database>;

/** Cliente falso que registra inserts y sirve una fila fija en las lecturas. */
function fakeDb(config: { conversation?: unknown; insertError?: { code?: string } | null } = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.maybeSingle = async () => ({ data: config.conversation ?? null, error: null });
      builder.single = async () => ({ data: config.conversation ?? null, error: null });
      builder.insert = (values: Record<string, unknown>) => {
        inserts.push(values);
        return {
          select: () => builder,
          single: async () => ({ data: null, error: config.insertError ?? null }),
          then: (cb: (r: unknown) => unknown) => cb({ error: config.insertError ?? null }),
        };
      };
      return builder;
    },
  } as unknown as Db;
  return { client, inserts };
}

describe("insertMessage y origin (F2)", () => {
  it("un entrante nunca lleva origin, aunque se lo pasen", async () => {
    const { client, inserts } = fakeDb();
    await insertMessage({
      supabase: client,
      conversationId: "c1",
      direction: "inbound",
      text: "hola",
      platformMessageId: "m1",
      createdAt: "2026-09-01T00:00:00Z",
      origin: "external",
    });
    expect(inserts[0].origin).toBeNull();
  });

  it("el eco de WhatsApp (fromMe) se guarda como external", async () => {
    const { client, inserts } = fakeDb();
    await insertMessage({
      supabase: client,
      conversationId: "c1",
      direction: "outbound",
      text: "respuesta desde el celular",
      platformMessageId: "m1",
      createdAt: "2026-09-01T00:00:00Z",
      origin: "external",
    });
    expect(inserts[0].origin).toBe("external");
    expect(inserts[0].sent_by_user_id).toBeNull();
  });
});

describe("toMessageRow del backfill (F2)", () => {
  it("un saliente del historial es external", () => {
    const row = toMessageRow(
      { id: "mid1", message: "hola", direction: "outgoing", createdAt: "2026-09-01T00:00:00Z" },
      "c1",
      "w1",
    );
    expect(row?.origin).toBe("external");
  });

  it("un entrante del historial no lleva origin", () => {
    const row = toMessageRow(
      { id: "mid2", message: "hola", direction: "incoming", createdAt: "2026-09-01T00:00:00Z" },
      "c1",
      "w1",
    );
    expect(row?.origin).toBeNull();
  });
});

describe("handleMessageSentEcho (F2)", () => {
  const channel = { id: "ch1", workspace_id: "w1" };
  const message = {
    id: "z-msg-1",
    conversationId: "late-conv-1",
    platformMessageId: "meta-mid-1",
    direction: "outgoing",
    text: "respuesta desde la app de Instagram",
    sentAt: "2026-09-01T00:00:00Z",
  };

  it("guarda el eco externo cuando encuentra la conversación", async () => {
    const { client, inserts } = fakeDb({ conversation: { id: "c1" } });
    const res = await handleMessageSentEcho({ supabase: client, channel, message });
    expect(res.stored).toBe(true);
    expect(inserts[0].origin).toBe("external");
    expect(inserts[0].direction).toBe("outbound");
    expect(inserts[0].platform_message_id).toBe("z-msg-1");
    expect(inserts[0].platform_native_message_id).toBe("meta-mid-1");
  });

  it("se saltea si la conversación no existe todavía", async () => {
    const { client, inserts } = fakeDb({ conversation: null });
    const res = await handleMessageSentEcho({ supabase: client, channel, message });
    expect(res.stored).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("un id duplicado (eco de un envío propio) no vuelve a guardar", async () => {
    const { client } = fakeDb({ conversation: { id: "c1" }, insertError: { code: "23505" } });
    const res = await handleMessageSentEcho({ supabase: client, channel, message });
    expect(res.stored).toBe(false);
  });

  it("ignora un message.sent que no es saliente", async () => {
    const { client, inserts } = fakeDb({ conversation: { id: "c1" } });
    const res = await handleMessageSentEcho({
      supabase: client,
      channel,
      message: { ...message, direction: "incoming" },
    });
    expect(res.stored).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});
