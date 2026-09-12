import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

const matchTrigger = vi.hoisted(() => vi.fn());
const executeFlow = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flow-engine/trigger-matcher", () => ({ matchTrigger }));
vi.mock("@/lib/flow-engine/engine", () => ({ executeFlow }));

import {
  applyOptOut,
  claimWebhookEvent,
  pauseSequencesOnReply,
  handleGlobalKeywords,
  insertMessage,
  persistInboundMessage,
  runInboundAutomation,
  upsertConversation,
} from "./inbound";

type Db = SupabaseClient<Database>;

/**
 * Cliente falso: cada tabla declara que devuelve al leer y registra lo que se
 * escribe. Alcanza para fijar el comportamiento sin levantar una base.
 */
function fakeDb(config: {
  select?: Record<string, unknown | null>;
  insertError?: { code?: string; message?: string } | null;
  rpcResult?: { data?: unknown; error?: { message: string } | null };
}) {
  const calls = {
    inserts: [] as Array<{ table: string; values: unknown }>,
    updates: [] as Array<{ table: string; values: unknown }>,
    rpcs: [] as Array<{ name: string; args: unknown }>,
  };

  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;

      builder.select = chain;
      builder.eq = chain;
      builder.is = chain;
      builder.maybeSingle = async () => ({ data: config.select?.[table] ?? null, error: null });
      builder.single = async () => ({ data: config.select?.[table] ?? null, error: null });

      builder.insert = (values: unknown) => {
        calls.inserts.push({ table, values });
        const res: Record<string, unknown> = {
          // .select() despues de .insert() sigue hablando del insert, no de la
          // tabla: tiene que devolver la fila insertada, no la que ya estaba.
          select: () => res,
          single: async () => ({
            data: config.insertError ? null : (config.select?.[`${table}:inserted`] ?? null),
            error: config.insertError ?? null,
          }),
          then: (cb: (r: unknown) => unknown) => cb({ error: config.insertError ?? null }),
        };
        return res;
      };

      builder.update = (values: unknown) => {
        calls.updates.push({ table, values });
        return builder;
      };

      return builder;
    },
    async rpc(name: string, args: unknown) {
      calls.rpcs.push({ name, args });
      return { data: config.rpcResult?.data ?? null, error: config.rpcResult?.error ?? null };
    },
  } as unknown as Db;

  return { client, calls };
}

beforeEach(() => {
  matchTrigger.mockReset();
  executeFlow.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("claimWebhookEvent", () => {
  it("un evento sin id se procesa igual, no se descarta", async () => {
    const { client, calls } = fakeDb({});
    await expect(claimWebhookEvent(client, null)).resolves.toBe(true);
    expect(calls.inserts).toHaveLength(0);
  });

  it("reclama el id la primera vez", async () => {
    const { client, calls } = fakeDb({});
    await expect(claimWebhookEvent(client, "ev-1")).resolves.toBe(true);
    expect(calls.inserts).toEqual([{ table: "webhook_events", values: { event_id: "ev-1" } }]);
  });

  it("un reintento del proveedor con el mismo id se frena", async () => {
    const { client } = fakeDb({ insertError: { code: "23505", message: "duplicate key" } });
    await expect(claimWebhookEvent(client, "ev-1")).resolves.toBe(false);
  });

  it("ante un error de base que no es duplicado deja pasar: mejor arriesgar un duplicado que perder un mensaje", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeDb({ insertError: { code: "08006", message: "connection lost" } });
    await expect(claimWebhookEvent(client, "ev-1")).resolves.toBe(true);
  });
});

describe("upsertConversation", () => {
  const channel = { id: "ch-1", workspace_id: "ws-1", platform: "whatsapp" as const };

  it("sobre una conversacion que ya existe acumula los no leidos con increment_unread", async () => {
    // Antes se hacia un upsert con unread_count: 1, que RESETEABA el contador en
    // cada mensaje: nunca pasaba de 2 por mas mensajes que mandara el lead.
    const { client, calls } = fakeDb({
      select: { conversations: { id: "cv-1", is_automation_paused: false } },
    });

    const res = await upsertConversation({
      supabase: client, channel, contactId: "c-1",
      preview: "hola", at: "2026-09-08T10:00:00Z", incrementUnread: true,
    });

    expect(res).toEqual({ id: "cv-1", isAutomationPaused: false });
    expect(calls.rpcs).toEqual([
      { name: "increment_unread", args: { conv_id: "cv-1", preview: "hola" } },
    ]);
    expect(calls.updates.some((u) => "unread_count" in (u.values as object))).toBe(false);
  });

  it("un mensaje que mandamos nosotros no suma no leidos", async () => {
    const { client, calls } = fakeDb({
      select: { conversations: { id: "cv-1", is_automation_paused: false } },
    });

    await upsertConversation({
      supabase: client, channel, contactId: "c-1",
      preview: "ya te paso info", at: "2026-09-08T10:00:00Z", incrementUnread: false,
    });

    expect(calls.rpcs).toHaveLength(0);
    expect(calls.updates[0].values).toMatchObject({
      last_message_preview: "ya te paso info",
      status: "open",
    });
  });

  it("crea la conversacion cuando no existe, con el canal y el contacto como clave", async () => {
    const { client, calls } = fakeDb({
      select: {
        conversations: null,
        "conversations:inserted": { id: "cv-nueva", is_automation_paused: false },
      },
    });

    const res = await upsertConversation({
      supabase: client, channel, contactId: "c-1",
      externalConversationId: "zernio-123",
      preview: "hola", at: "2026-09-08T10:00:00Z", incrementUnread: true,
    });

    expect(res?.id).toBe("cv-nueva");
    expect(calls.inserts[0].values).toMatchObject({
      channel_id: "ch-1", contact_id: "c-1", platform: "whatsapp",
      late_conversation_id: "zernio-123", unread_count: 1, status: "open",
    });
  });

  it("devuelve null si la insercion falla, para que quien llama corte", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeDb({
      select: { conversations: null },
      insertError: { message: "boom" },
    });
    await expect(
      upsertConversation({
        supabase: client, channel, contactId: "c-1",
        preview: "x", at: "2026-09-08T10:00:00Z", incrementUnread: true,
      })
    ).resolves.toBeNull();
  });
});

describe("insertMessage", () => {
  it("guarda el mensaje entrante", async () => {
    const { client, calls } = fakeDb({});
    await expect(
      insertMessage({
        supabase: client, conversationId: "cv-1", direction: "inbound",
        text: "hola", platformMessageId: "WA-1", createdAt: "2026-09-08T10:00:00Z",
      })
    ).resolves.toBe(true);
    expect(calls.inserts[0].values).toMatchObject({
      conversation_id: "cv-1", direction: "inbound", platform_message_id: "WA-1",
    });
  });

  it("un mensaje ya guardado no es un error: es el eco del que mandamos nosotros", async () => {
    const { client } = fakeDb({ insertError: { code: "23505", message: "duplicate" } });
    await expect(
      insertMessage({
        supabase: client, conversationId: "cv-1", direction: "outbound",
        text: "hola", platformMessageId: "WA-1", createdAt: "2026-09-08T10:00:00Z",
      })
    ).resolves.toBe(false);
  });
});

describe("persistInboundMessage", () => {
  const zernio = { id: "ch-1", workspace_id: "ws-1", provider: "zernio" as const };
  const evolution = { id: "ch-2", workspace_id: "ws-1", provider: "evolution" as const };
  const base = {
    conversationId: "cv-1",
    text: "hola",
    platformMessageId: "zernio-msg-1",
    createdAt: "2026-09-11T10:00:00Z",
  };

  it("guarda el entrante de Zernio cuando el interruptor esta prendido", async () => {
    const { client, calls } = fakeDb({
      select: { workspaces: { persist_zernio_inbound: true } },
    });

    await expect(persistInboundMessage({ supabase: client, channel: zernio, ...base })).resolves.toBe(
      true,
    );
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].values).toMatchObject({
      conversation_id: "cv-1",
      direction: "inbound",
      platform_message_id: "zernio-msg-1",
      workspace_id: "ws-1",
    });
  });

  it("con el interruptor apagado no guarda nada: el sistema queda como antes", async () => {
    const { client, calls } = fakeDb({
      select: { workspaces: { persist_zernio_inbound: false } },
    });

    await expect(persistInboundMessage({ supabase: client, channel: zernio, ...base })).resolves.toBe(
      false,
    );
    expect(calls.inserts).toHaveLength(0);
  });

  it("WhatsApp no depende del interruptor: esta tabla es su unica fuente del hilo", async () => {
    const { client, calls } = fakeDb({
      select: { workspaces: { persist_zernio_inbound: false } },
    });

    await expect(
      persistInboundMessage({ supabase: client, channel: evolution, ...base }),
    ).resolves.toBe(true);
    expect(calls.inserts).toHaveLength(1);
  });

  it("un duplicado no es un error: lo frena el indice unico y el receptor sigue", async () => {
    const { client } = fakeDb({
      select: { workspaces: { persist_zernio_inbound: true } },
      insertError: { code: "23505", message: "duplicate key" },
    });

    await expect(persistInboundMessage({ supabase: client, channel: zernio, ...base })).resolves.toBe(
      false,
    );
  });

  it("si el insert falla, no lanza: guardar no puede tumbar la recepcion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeDb({
      select: { workspaces: { persist_zernio_inbound: true } },
      insertError: { code: "42501", message: "permission denied" },
    });

    await expect(persistInboundMessage({ supabase: client, channel: zernio, ...base })).resolves.toBe(
      false,
    );
  });

  it("si la base explota al leer el interruptor tampoco lanza", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = {
      from() {
        throw new Error("conexion caida");
      },
    } as unknown as Parameters<typeof persistInboundMessage>[0]["supabase"];

    await expect(persistInboundMessage({ supabase: client, channel: zernio, ...base })).resolves.toBe(
      false,
    );
  });

  it("guarda el link de la media, no el archivo", async () => {
    const { client, calls } = fakeDb({
      select: { workspaces: { persist_zernio_inbound: true } },
    });
    const attachments = [{ type: "image", url: "https://cdn.example/foto.jpg" }];

    await persistInboundMessage({ supabase: client, channel: zernio, ...base, attachments });

    expect(calls.inserts[0].values).toMatchObject({ attachments });
  });
});

describe("pauseSequencesOnReply", () => {
  it("delega en la funcion de base, pasandole contacto Y canal", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { client, calls } = fakeDb({ rpcResult: { data: 2 } });

    const res = await pauseSequencesOnReply({
      supabase: client,
      contactId: "c-1",
      channelId: "ch-1",
    });

    expect(res).toEqual({ paused: 2 });
    // El canal es lo que hace que responder por Instagram no frene el
    // seguimiento que corre por WhatsApp (F12).
    expect(calls.rpcs[0]).toEqual({
      name: "pause_sequences_on_reply",
      args: { p_contact_id: "c-1", p_channel_id: "ch-1" },
    });
  });

  it("si la base falla no lanza: un mensaje ya guardado no se pierde por esto", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeDb({ rpcResult: { error: { message: "boom" } } });

    await expect(
      pauseSequencesOnReply({ supabase: client, contactId: "c-1", channelId: "ch-1" })
    ).resolves.toEqual({ paused: 0 });
  });

  it("sin nada activo devuelve cero y no dice nada", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { client } = fakeDb({ rpcResult: { data: 0 } });

    await expect(
      pauseSequencesOnReply({ supabase: client, contactId: "c-1", channelId: "ch-1" })
    ).resolves.toEqual({ paused: 0 });
    expect(log).not.toHaveBeenCalled();
  });
});

describe("applyOptOut", () => {
  it("sin texto no molesta a la base", async () => {
    const { client, calls } = fakeDb({});
    await expect(applyOptOut({ supabase: client, contactId: "c-1", text: null }))
      .resolves.toEqual({ matched: false, phrase: null });
    expect(calls.rpcs).toHaveLength(0);
  });

  it("delega la decision en apply_opt_out_check", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { client, calls } = fakeDb({
      rpcResult: { data: { matched: true, phrase: "no me escribas mas" } },
    });

    const res = await applyOptOut({
      supabase: client, contactId: "c-1", conversationId: "cv-1", text: "no me escribas mas",
    });

    expect(res).toEqual({ matched: true, phrase: "no me escribas mas" });
    expect(calls.rpcs[0]).toEqual({
      name: "apply_opt_out_check",
      args: { p_contact_id: "c-1", p_conversation_id: "cv-1", p_text: "no me escribas mas" },
    });
  });

  it("si la base falla no marca a nadie, pero deja pasar el mensaje", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeDb({ rpcResult: { error: { message: "boom" } } });
    await expect(applyOptOut({ supabase: client, contactId: "c-1", text: "hola" }))
      .resolves.toEqual({ matched: false, phrase: null });
  });
});

describe("handleGlobalKeywords", () => {
  it("una palabra de baja desuscribe y consume el mensaje", async () => {
    const { client, calls } = fakeDb({
      select: { workspaces: { global_keywords: [{ keyword: "STOP", action: "unsubscribe" }] } },
    });
    await expect(handleGlobalKeywords(client, "ws-1", "c-1", "stop")).resolves.toBe(true);
    expect(calls.updates).toEqual([{ table: "contacts", values: { is_subscribed: false } }]);
  });

  it("un mensaje cualquiera no consume nada", async () => {
    const { client, calls } = fakeDb({
      select: { workspaces: { global_keywords: [{ keyword: "STOP", action: "unsubscribe" }] } },
    });
    await expect(handleGlobalKeywords(client, "ws-1", "c-1", "hola, quiero info"))
      .resolves.toBe(false);
    expect(calls.updates).toHaveLength(0);
  });
});

describe("runInboundAutomation", () => {
  const channel = { id: "ch-1", workspace_id: "ws-1" };
  const base = {
    channel, contactId: "c-1", conversationId: "cv-1",
    isFirstMessage: false, incomingMessage: { text: "hola" },
  };

  it("una conversacion tomada a mano no dispara automatizaciones", async () => {
    const { client } = fakeDb({});
    await runInboundAutomation({ supabase: client, ...base, isAutomationPaused: true });
    expect(matchTrigger).not.toHaveBeenCalled();
    expect(executeFlow).not.toHaveBeenCalled();
  });

  it("una palabra clave global corta antes de evaluar triggers", async () => {
    // Un "STOP" no puede ademas disparar el flow de bienvenida.
    const { client } = fakeDb({
      select: { workspaces: { global_keywords: [{ keyword: "hola", action: "unsubscribe" }] } },
    });
    await runInboundAutomation({ supabase: client, ...base, isAutomationPaused: false });
    expect(matchTrigger).not.toHaveBeenCalled();
  });

  it("con un trigger que matchea ejecuta el flow", async () => {
    matchTrigger.mockResolvedValue({ id: "tr-1", flow_id: "fl-1" });
    const { client } = fakeDb({ select: { workspaces: { global_keywords: [] } } });

    await runInboundAutomation({
      supabase: client, ...base, isAutomationPaused: false,
      lateConversationId: "zc-1", lateAccountId: "za-1",
    });

    expect(executeFlow).toHaveBeenCalledWith(client, expect.objectContaining({
      triggerId: "tr-1", flowId: "fl-1", channelId: "ch-1",
      contactId: "c-1", conversationId: "cv-1", workspaceId: "ws-1",
      lateConversationId: "zc-1", lateAccountId: "za-1",
    }));
  });

  it("sin trigger no pasa nada", async () => {
    matchTrigger.mockResolvedValue(null);
    const { client } = fakeDb({ select: { workspaces: { global_keywords: [] } } });
    await runInboundAutomation({ supabase: client, ...base, isAutomationPaused: false });
    expect(executeFlow).not.toHaveBeenCalled();
  });

  it("si el flow explota, el mensaje ya guardado no se pierde", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    matchTrigger.mockResolvedValue({ id: "tr-1", flow_id: "fl-1" });
    executeFlow.mockRejectedValue(new Error("el nodo de IA fallo"));
    const { client } = fakeDb({ select: { workspaces: { global_keywords: [] } } });

    await expect(
      runInboundAutomation({ supabase: client, ...base, isAutomationPaused: false })
    ).resolves.toBeUndefined();
  });
});
