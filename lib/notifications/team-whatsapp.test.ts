/**
 * Los WhatsApp al equipo cuentan en el tope UNICO del numero (decision del 7/11/2026): `claim_automated_send` con el
 * mismo limite que todo lo que sale por WhatsApp. Sin red: Evolution y su configuracion estan simulados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { sendText, getEvolutionConfig } = vi.hoisted(() => ({
  sendText: vi.fn(async () => ({ id: "wa-1" })),
  getEvolutionConfig: vi.fn(async () => ({ baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" })),
}));
vi.mock("@/lib/evolution-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/evolution-client")>();
  return { ...actual, sendText };
});
vi.mock("@/lib/evolution-config", () => ({ getEvolutionConfig }));

import { sendTeamWhatsApp, TEAM_WHATSAPP_RATE_LIMITED } from "./team-whatsapp";
import { WHATSAPP_HOURLY_LIMIT, nextHourlyWindowStart } from "@/lib/channels/whatsapp-limits";

const WS = "ws-1";
const CHANNEL = { id: "ch-avisos", name: "Avisos", instance: "ssa-avisos" };
const NOW = new Date("2026-11-07T15:42:10Z");

function db(claim: boolean | Error, lane: { next_send_at: string } | null = null) {
  return memoryDb(
    {
      channels: [{ id: "ch-avisos", workspace_id: WS, send_policy: null }],
      channel_send_lanes: lane ? [{ channel_id: "ch-avisos", workspace_id: WS, ...lane }] : [],
    },
    {
      rpc: {
        claim_automated_send: () => {
          if (claim instanceof Error) throw claim;
          return claim;
        },
      },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sendText.mockResolvedValue({ id: "wa-1" });
});

describe("sendTeamWhatsApp", () => {
  it("reclama un lugar en el tope del numero de avisos, con el mismo limite que todo WhatsApp", async () => {
    const memory = db(true);
    const result = await sendTeamWhatsApp(memory.client, WS, "5491100000000", "Agenda nueva", CHANNEL, () => NOW);
    expect(result).toEqual({ ok: true });
    expect(memory.rpcCalls).toEqual([{ name: "claim_automated_send", args: { p_channel_id: "ch-avisos", p_limit: WHATSAPP_HOURLY_LIMIT } }]);
    expect(WHATSAPP_HOURLY_LIMIT).toBe(200);
    expect(sendText).toHaveBeenCalledWith(expect.anything(), "ssa-avisos", "5491100000000", "Agenda nueva");
  });

  it("en el tope no manda y dice cuando vuelve a haber lugar (el inicio de la hora siguiente)", async () => {
    const memory = db(false);
    const result = await sendTeamWhatsApp(memory.client, WS, "5491100000000", "Agenda nueva", CHANNEL, () => NOW);
    expect(result).toEqual({ ok: false, reason: "rate_limited", retryable: true, retryAt: new Date("2026-11-07T16:00:00Z"), error: TEAM_WHATSAPP_RATE_LIMITED });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("si el contador falla (no por tope), deja pasar el aviso, como el resto del motor", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const memory = db(new Error("rpc caida"));
    // memoryDb convierte la excepcion de la rpc en un error de la respuesta, igual que PostgREST.
    const result = await sendTeamWhatsApp(memory.client, WS, "5491100000000", "Agenda nueva", CHANNEL, () => NOW);
    expect(result.ok).toBe(true);
    expect(sendText).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("despues de salir, corre el turno de la cola de broadcasts de ese numero", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      const memory = db(true, { next_send_at: new Date(NOW.getTime() - 1000).toISOString() });
      await sendTeamWhatsApp(memory.client, WS, "5491100000000", "Agenda nueva", CHANNEL, () => NOW);
      expect(memory.rows("channel_send_lanes")[0].next_send_at).toBe(new Date(NOW.getTime() + 25_000).toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it("sin canal de avisos no gasta un lugar del tope", async () => {
    const memory = db(true);
    const result = await sendTeamWhatsApp(memory.client, WS, "5491100000000", "x", null, () => NOW);
    expect(result).toMatchObject({ ok: false, reason: "no_channel" });
    expect(memory.rpcCalls).toEqual([]);
  });
});

describe("nextHourlyWindowStart", () => {
  it("el inicio de la hora siguiente, tambien en el borde", () => {
    expect(nextHourlyWindowStart(new Date("2026-11-07T15:42:10Z")).toISOString()).toBe("2026-11-07T16:00:00.000Z");
    expect(nextHourlyWindowStart(new Date("2026-11-07T15:00:00Z")).toISOString()).toBe("2026-11-07T16:00:00.000Z");
    expect(nextHourlyWindowStart(new Date("2026-11-07T23:59:59Z")).toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });
});
