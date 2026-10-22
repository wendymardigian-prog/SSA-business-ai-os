import { describe, expect, it } from "vitest";
import cases from "./channel-permissions.cases.json";
import {
  ALL_CHANNELS,
  applyToEveryChannel,
  canGrantChannels,
  grantFor,
  hasAnyChannel,
  MEMBER_CHANNELS,
  NO_CHANNELS,
  parseChannels,
  sameChannels,
  setAllChannels,
  setChannelGrant,
  toCustomChannels,
  type ChannelsConfig,
} from "./channel-permissions";

const IDS = cases.ids as Record<string, string>;

/** Los casos usan A, B y C: se cambian por los uuid (en `byChannel` y en `channel`). */
function resolveIds<T>(value: T): T {
  if (Array.isArray(value)) return value.map(resolveIds) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[IDS[k] ?? k] = resolveIds(v);
  return out as T;
}

const actorChannels = (actor: unknown): ChannelsConfig =>
  actor === "owner" || actor === "admin" ? ALL_CHANNELS : actor === "member" ? MEMBER_CHANNELS : parseChannels(resolveIds(actor));

describe("grantFor: los casos compartidos con private.role_channel_grant", () => {
  for (const c of cases.grantFor) {
    it(c.name, () => {
      expect(grantFor(parseChannels(resolveIds(c.channels)), IDS[c.channel])).toEqual(c.expected);
    });
  }
});

describe("canGrantChannels: los casos compartidos con public.can_grant_channels", () => {
  for (const c of cases.canGrant) {
    it(c.name, () => {
      const wanted = parseChannels(resolveIds(c.wanted));
      const before = c.before ? parseChannels(resolveIds(c.before)) : null;
      expect(canGrantChannels(actorChannels(c.actor), wanted, before)).toBe(c.allowed);
    });
  }
});

describe("editar la bandeja de un rol", () => {
  const channels = [
    { id: IDS.A, platform: "instagram" },
    { id: IDS.B, platform: "instagram" },
    { id: IDS.C, platform: "whatsapp" },
  ];

  it("cambiar una cuenta estando en «todas» precarga las demas con lo que tenia «todas»", () => {
    const next = setChannelGrant(setAllChannels({ scope: "own", reply: true }), channels, IDS.B, null);
    expect(next).toEqual({
      mode: "custom",
      byChannel: { [IDS.A]: { scope: "own", reply: true }, [IDS.C]: { scope: "own", reply: true } },
    });
  });

  it("pasar a «elegir por cuenta» no saca nada", () => {
    const next = toCustomChannels(setAllChannels({ scope: "all", reply: false }), channels);
    for (const c of channels) expect(grantFor(next, c.id)).toEqual({ scope: "all", reply: false });
  });

  it("«aplicar a todas las cuentas» no da las futuras", () => {
    const next = applyToEveryChannel(channels, { scope: "own_unassigned", reply: true });
    expect(next.mode).toBe("custom");
    expect(grantFor(next, "dddddddd-0000-4000-8000-000000000004")).toBeNull();
  });

  it("sacar la ultima cuenta deja el rol sin bandeja", () => {
    const one: ChannelsConfig = { mode: "custom", byChannel: { [IDS.A]: { scope: "own", reply: false } } };
    const next = setChannelGrant(one, channels, IDS.A, null);
    expect(hasAnyChannel(next)).toBe(false);
  });

  it("sameChannels no depende del orden de las cuentas", () => {
    const a: ChannelsConfig = { mode: "custom", byChannel: { [IDS.A]: { scope: "own", reply: true }, [IDS.B]: { scope: "all", reply: false } } };
    const b: ChannelsConfig = { mode: "custom", byChannel: { [IDS.B]: { scope: "all", reply: false }, [IDS.A]: { scope: "own", reply: true } } };
    expect(sameChannels(a, b)).toBe(true);
    expect(sameChannels(a, NO_CHANNELS)).toBe(false);
  });
});

describe("los roles de sistema", () => {
  it("el Member de sistema ve todas las cuentas, solo lo asignado, y responde (lo de siempre)", () => {
    expect(MEMBER_CHANNELS).toEqual({ mode: "all", all: { scope: "own", reply: true } });
  });
  it("Owner y Admin: todas, todas, responden", () => {
    expect(ALL_CHANNELS).toEqual({ mode: "all", all: { scope: "all", reply: true } });
  });
});
