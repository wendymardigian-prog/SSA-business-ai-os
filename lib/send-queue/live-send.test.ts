/**
 * La cola le hace lugar a lo que sale en el momento (decision del 7/11/2026).
 *
 * Lo que se prueba, sin red y con la base en memoria:
 *   1. Un envio por WhatsApp fuera de la cola corre el proximo turno del carril a ahora + la espera minima del numero.
 *   2. Nunca lo adelanta: un turno que ya estaba mas lejos queda igual.
 *   3. Sin carril (el numero nunca mando un broadcast) no se escribe nada.
 *   4. Lo que manda la cola misma (`origin: "broadcast"`) no corre su propio turno.
 *   5. Un fallo al correr el carril no tumba ni hace fallar el envio.
 *   6. Instagram no toca el carril.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { sendText, sendPoll, getEvolutionConfig, sendInboxMessage } = vi.hoisted(() => ({
  sendText: vi.fn(async () => ({ id: "wa-text-1" })),
  sendPoll: vi.fn(async () => ({ id: "wa-poll-1" })),
  getEvolutionConfig: vi.fn(async () => ({ baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" })),
  sendInboxMessage: vi.fn(async () => ({ data: { data: { messageId: "ig-1" } } })),
}));

vi.mock("@/lib/evolution-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/evolution-client")>();
  return { ...actual, sendText, sendPoll };
});
vi.mock("@/lib/evolution-config", () => ({ getEvolutionConfig }));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: () => ({ messages: { sendInboxMessage } }) }));
vi.mock("@/lib/integrations/zernio-key", () => ({ getZernioApiKey: vi.fn(async () => "api-key-1") }));

import { makeRoomForLiveSend } from "./live-send";
import { sendChannelMessage, sendEvolutionDirect, type SendContext } from "@/lib/flow-engine/send";
import { sendToGroup } from "@/lib/whatsapp-groups/send";

const WS = "ws-1";
const NOW = new Date("2026-11-07T15:00:00Z");
const at = (secondsFromNow: number) => new Date(NOW.getTime() + secondsFromNow * 1000).toISOString();

function db(lane: { next_send_at: string } | null, sendPolicy: unknown = null) {
  return memoryDb(
    {
      channels: [
        { id: "ch-wa", workspace_id: WS, provider: "evolution", platform: "whatsapp", evolution_instance: "ssa-1", is_active: true, send_policy: sendPolicy },
        { id: "ch-ig", workspace_id: WS, provider: "late", platform: "instagram", late_account_id: "acc-1", is_active: true, send_policy: null },
      ],
      channel_send_lanes: lane ? [{ channel_id: "ch-wa", workspace_id: WS, consecutive_failures: 0, paused_at: null, ...lane }] : [],
      contact_channels: [
        { channel_id: "ch-wa", contact_id: "c-1", platform_sender_id: "5491122334455" },
        { channel_id: "ch-ig", contact_id: "c-1", platform_sender_id: "ig-sender-1" },
      ],
      conversations: [{ id: "cv-1", late_conversation_id: "late-cv-1" }],
    },
    { rpc: { claim_automated_send: () => true } },
  );
}

const laneOf = (memory: ReturnType<typeof db>) => memory.rows("channel_send_lanes").find((r) => r.channel_id === "ch-wa");

/** Un cliente que explota en cualquier consulta: el peor caso para el carril. */
const brokenClient = {
  from: () => {
    throw new Error("la base no contesta");
  },
} as unknown as SupabaseClient<Database>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  sendText.mockResolvedValue({ id: "wa-text-1" });
  getEvolutionConfig.mockResolvedValue({ baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" });
});

describe("makeRoomForLiveSend", () => {
  it("corre el turno a ahora + la espera minima del numero (25 s por defecto)", async () => {
    const memory = db({ next_send_at: at(-30) });
    await makeRoomForLiveSend({ client: memory.client, channelId: "ch-wa" }, NOW);
    expect(laneOf(memory)?.next_send_at).toBe(at(25));
  });

  it("usa la espera minima que el negocio le puso al numero", async () => {
    const memory = db({ next_send_at: at(10) }, { minGapSeconds: 90, maxGapSeconds: 120 });
    await makeRoomForLiveSend({ client: memory.client, channelId: "ch-wa" }, NOW);
    expect(laneOf(memory)?.next_send_at).toBe(at(90));
  });

  it("nunca lo adelanta: un turno que ya estaba mas lejos queda igual", async () => {
    const memory = db({ next_send_at: at(300) });
    await makeRoomForLiveSend({ client: memory.client, channelId: "ch-wa" }, NOW);
    expect(laneOf(memory)?.next_send_at).toBe(at(300));
  });

  it("sin carril (el numero nunca mando un broadcast) no escribe nada", async () => {
    const memory = db(null);
    await makeRoomForLiveSend({ client: memory.client, channelId: "ch-wa" }, NOW);
    expect(memory.rows("channel_send_lanes")).toEqual([]);
  });

  it("null (un envio de la cola misma) no consulta nada", async () => {
    await expect(makeRoomForLiveSend(null, NOW)).resolves.toBeUndefined();
  });

  it("si la base falla, no lanza", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(makeRoomForLiveSend({ client: brokenClient, channelId: "ch-wa" }, NOW)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("los envios que salen en el momento le corren el turno a la cola", () => {
  const ctx = (origin?: SendContext["origin"]): SendContext => ({
    workspaceId: WS,
    channelId: "ch-wa",
    contactId: "c-1",
    conversationId: "cv-1",
    ...(origin ? { origin } : {}),
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  it("un flujo, el agente o la bandeja (sendChannelMessage) corren el turno", async () => {
    const memory = db({ next_send_at: at(-5) });
    const outcome = await sendChannelMessage(memory.client, ctx("flow"), { text: "hola" });
    expect(outcome.ok).toBe(true);
    expect(laneOf(memory)?.next_send_at).toBe(at(25));
  });

  it("la bandeja manda con el cliente de la persona: el carril se escribe con el de servicio (`secrets`)", async () => {
    const service = db({ next_send_at: at(-5) });
    const user = db(null);
    const outcome = await sendChannelMessage(user.client, ctx(), { text: "hola" }, { secrets: service.client });
    expect(outcome.ok).toBe(true);
    expect(laneOf(service)?.next_send_at).toBe(at(25));
  });

  it("lo que manda la cola de broadcasts no corre su propio turno", async () => {
    const memory = db({ next_send_at: at(40) });
    const outcome = await sendChannelMessage(memory.client, ctx("broadcast"), { text: "hola" });
    expect(outcome.ok).toBe(true);
    expect(laneOf(memory)?.next_send_at).toBe(at(40));
  });

  it("«Enviar WhatsApp a un número» y los avisos al equipo (sendEvolutionDirect con carril) lo corren", async () => {
    const memory = db({ next_send_at: at(-5) });
    const config = { baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" };
    const outcome = await sendEvolutionDirect(memory.client, config, "ssa-1", "5491100000000", { text: "aviso" }, { client: memory.client, channelId: "ch-wa" });
    expect(outcome.ok).toBe(true);
    expect(laneOf(memory)?.next_send_at).toBe(at(25));
  });

  it("si WhatsApp rechaza el mensaje igual lo corre (pudo haberle llegado)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    sendText.mockRejectedValueOnce(new Error("timeout"));
    const memory = db({ next_send_at: at(-5) });
    const outcome = await sendChannelMessage(memory.client, ctx("flow"), { text: "hola" });
    expect(outcome.ok).toBe(false);
    expect(laneOf(memory)?.next_send_at).toBe(at(25));
  });

  it("un fallo al correr la cola no tumba el envio", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = db(null);
    const outcome = await sendChannelMessage(user.client, ctx(), { text: "hola" }, { secrets: brokenClient });
    // getEvolutionConfig esta simulado: el cliente roto solo lo usa el carril.
    expect(outcome).toEqual({ ok: true, platformMessageId: "wa-text-1" });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("no pude correr el turno"), expect.anything());
  });

  it("un mensaje o una encuesta a un grupo (sendToGroup) tambien lo corren", async () => {
    const memory = db({ next_send_at: at(-5) });
    const group = { id: "g-1", workspace_id: WS, channel_id: "ch-wa", group_jid: "123@g.us" };
    const result = await sendToGroup(memory.client, group, { poll: { name: "¿Venís?", values: ["Sí", "No"], selectableCount: 1 } }, { userId: null });
    expect(result.ok).toBe(true);
    expect(sendPoll).toHaveBeenCalledTimes(1);
    expect(laneOf(memory)?.next_send_at).toBe(at(25));
  });

  it("Instagram no toca el carril", async () => {
    const memory = db({ next_send_at: at(-5) });
    const outcome = await sendChannelMessage(memory.client, { ...ctx("flow"), channelId: "ch-ig" }, { text: "hola" });
    expect(outcome.ok).toBe(true);
    expect(laneOf(memory)?.next_send_at).toBe(at(-5));
  });
});
