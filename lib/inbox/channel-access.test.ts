import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import type { ChannelsConfig } from "@/lib/auth/channel-permissions";
import {
  canReplyChannel,
  canUseInbox,
  canViewChannel,
  channelFilterFor,
  replyFilterFor,
  visibleChannelIds,
} from "./channel-access";

// Dos Instagram (A, B) y un WhatsApp (W).
const A = "11111111-0000-4000-8000-00000000000a";
const B = "11111111-0000-4000-8000-00000000000b";
const W = "11111111-0000-4000-8000-00000000000c";
const CHANNELS = [
  { id: A, platform: "instagram" },
  { id: B, platform: "instagram" },
  { id: W, platform: "whatsapp" },
];
const perms = (channels: ChannelsConfig) => ({ channels });

describe("la bandeja por cuenta (00249)", () => {
  it("con dos Instagram, un rol puede ver uno y no el otro", () => {
    const p = perms({ mode: "custom", byChannel: { [A]: { scope: "all", reply: true } } });
    expect(canViewChannel(p, A)).toBe(true);
    expect(canViewChannel(p, B)).toBe(false);
    expect(visibleChannelIds(p, CHANNELS)).toEqual([A]);
  });

  it("ver sin responder: ve la cuenta pero no escribe", () => {
    const p = perms({ mode: "custom", byChannel: { [W]: { scope: "own", reply: false } } });
    expect(canViewChannel(p, W)).toBe(true);
    expect(canReplyChannel(p, W)).toBe(false);
    expect(replyFilterFor(p)).toEqual([]);
  });

  it("«todas las cuentas» vale tambien para una cuenta que se conecta despues", () => {
    const p = perms({ mode: "all", all: { scope: "own_unassigned", reply: true } });
    const nueva = "11111111-0000-4000-8000-0000000000ff";
    expect(canViewChannel(p, nueva)).toBe(true);
    expect(canReplyChannel(p, nueva)).toBe(true);
    // Viendo todas no hace falta filtrar la consulta.
    expect(channelFilterFor(p)).toBeNull();
    expect(replyFilterFor(p)).toBeNull();
  });

  it("«elegir por cuenta» filtra la consulta por las cuentas que tiene, conectadas o no", () => {
    const p = perms({ mode: "custom", byChannel: { [A]: { scope: "own", reply: true }, [W]: { scope: "all", reply: false } } });
    expect(channelFilterFor(p)?.sort()).toEqual([A, W].sort());
    expect(replyFilterFor(p)).toEqual([A]);
  });

  it("sin ninguna cuenta: la bandeja no aparece y la consulta no trae nada", () => {
    const p = perms({ mode: "custom", byChannel: {} });
    expect(canUseInbox(p)).toBe(false);
    expect(channelFilterFor(p)).toEqual([]);
    expect(canUseInbox(null)).toBe(false);
    expect(channelFilterFor(null)).toEqual([]);
  });

  it("el Member de sistema ve y responde en todas las cuentas (lo de siempre)", () => {
    const member = SYSTEM_ROLE_PERMISSIONS.member;
    expect(canUseInbox(member)).toBe(true);
    for (const c of CHANNELS) {
      expect(canViewChannel(member, c.id)).toBe(true);
      expect(canReplyChannel(member, c.id)).toBe(true);
    }
    expect(channelFilterFor(member)).toBeNull();
  });

  it("una conversacion sin cuenta conocida no se ve en «elegir por cuenta»", () => {
    const p = perms({ mode: "custom", byChannel: { [A]: { scope: "all", reply: true } } });
    expect(canViewChannel(p, null)).toBe(false);
    expect(canReplyChannel(p, undefined)).toBe(false);
  });
});
