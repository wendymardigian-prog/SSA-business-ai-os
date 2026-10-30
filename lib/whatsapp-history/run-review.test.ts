import { describe, it, expect, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { EvolutionError } from "@/lib/evolution-client";
import { runHistoryReview, REVIEW_CHAT_LIMIT } from "./run-review";

const config = { baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" };

function setup(channelOver: Record<string, unknown> = {}) {
  return memoryDb({
    channels: [
      {
        id: "ch-wa",
        workspace_id: "ws-1",
        provider: "evolution",
        evolution_instance: "ssa-abc",
        created_at: "2026-10-16T13:28:43.000Z",
        ...channelOver,
      },
    ],
    contact_channels: [{ id: "cc-1", channel_id: "ch-wa", contact_id: "c-1", platform_sender_id: "+5491122334455" }],
  });
}

function deps(over: Record<string, unknown> = {}) {
  const findMessagesPage = vi.fn(async (_c: unknown, _i: unknown, page: number, _offset: number) => ({
    total: 40,
    pages: 40,
    records: [{ messageTimestamp: page === 1 ? 1_761_800_000 : 1_751_000_000 }],
  }));
  return {
    findMessagesPage,
    d: {
      getConfig: async () => config,
      findChats: vi.fn(async () => [
        { remoteJid: "5491122334455@s.whatsapp.net" },
        { remoteJid: "98765432101234@lid" },
        { remoteJid: "120363001122334455@g.us" },
      ]),
      findMessagesPage,
      ...over,
    },
  };
}

describe("runHistoryReview", () => {
  it("lee Evolution, cruza con la bandeja y resume, sin escribir nada", async () => {
    const db = setup();
    const { d, findMessagesPage } = deps();

    const res = await runHistoryReview(db.client as never, { workspaceId: "ws-1", channelId: "ch-wa" }, d as never);

    expect(res).toEqual({
      ok: true,
      review: expect.objectContaining({ people: 2, peopleWithoutNumber: 1, missingInInbox: 1, groups: 1, messages: 40, hasHistoryBeforeConnection: true }),
    });
    expect(d.findChats).toHaveBeenCalledWith(config, "ssa-abc", REVIEW_CHAT_LIMIT);
    // El mas nuevo es la pagina 1 y el mas viejo, la ultima (de a uno).
    expect(findMessagesPage.mock.calls.map((c) => [c[2], c[3]])).toEqual([[1, 1], [40, 1]]);
    expect(db.rows("contact_channels")).toHaveLength(1);
  });

  it("un canal de otro negocio no se encuentra", async () => {
    const db = setup({ workspace_id: "ws-otro" });
    expect(await runHistoryReview(db.client as never, { workspaceId: "ws-1", channelId: "ch-wa" }, deps().d as never)).toEqual({
      ok: false,
      error: "No encontré ese canal.",
    });
  });

  it("un canal que no es de Evolution, no", async () => {
    const db = setup({ provider: "zernio", evolution_instance: null });
    const res = await runHistoryReview(db.client as never, { workspaceId: "ws-1", channelId: "ch-wa" }, deps().d as never);
    expect(res).toMatchObject({ ok: false });
  });

  it("si Evolution rechaza la clave o no responde, lo dice en simple y no lanza", async () => {
    const db = setup();
    const rechazo = deps({ findChats: vi.fn(async () => { throw new EvolutionError("x", 401); }) }).d;
    expect(await runHistoryReview(db.client as never, { workspaceId: "ws-1", channelId: "ch-wa" }, rechazo as never)).toEqual({
      ok: false,
      error: "Evolution rechazó la clave. Revisala en Integraciones.",
    });
    const caido = deps({ findChats: vi.fn(async () => { throw new Error("timeout"); }) }).d;
    expect(await runHistoryReview(db.client as never, { workspaceId: "ws-1", channelId: "ch-wa" }, caido as never)).toEqual({
      ok: false,
      error: "Evolution no respondió. Probá de nuevo en un rato.",
    });
  });

  it("sin configuracion de Evolution, avisa", async () => {
    const db = setup();
    const res = await runHistoryReview(db.client as never, { workspaceId: "ws-1", channelId: "ch-wa" }, deps({ getConfig: async () => null }).d as never);
    expect(res).toEqual({ ok: false, error: "Falta la configuración de Evolution en Integraciones." });
  });
});
