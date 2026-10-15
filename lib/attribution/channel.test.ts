/**
 * La gemela en TypeScript de `touch_channel`: corre los casos compartidos con la funcion SQL.
 * (Los mismos casos corren contra la base en scripts/verify-organic-attribution.mjs.)
 */
import { describe, expect, it } from "vitest";
import cases from "./channel.cases.json";
import { CHANNEL_LABELS, TOUCH_CHANNELS, isOriginChannel, touchChannel, type TouchChannelInput } from "./channel";

describe("touchChannel (casos compartidos con la funcion SQL)", () => {
  it("hay al menos 20 casos y todos traen los 15 campos de la funcion SQL", () => {
    expect(cases.cases.length).toBeGreaterThanOrEqual(20);
    for (const c of cases.cases) {
      expect(Object.keys(c.input).sort(), c.name).toEqual([...cases.keys].sort());
      expect(TOUCH_CHANNELS as readonly string[], c.name).toContain(c.expected);
    }
  });

  it.each(cases.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(touchChannel(c.input as TouchChannelInput)).toBe(c.expected);
  });

  it("los casos cubren los cuatro canales", () => {
    expect(new Set(cases.cases.map((c) => c.expected))).toEqual(new Set(TOUCH_CHANNELS));
  });
});

describe("touchChannel (propiedades)", () => {
  it("nunca lanza con entradas rotas", () => {
    expect(touchChannel(null)).toBe("direct");
    expect(touchChannel(undefined)).toBe("direct");
    expect(touchChannel({})).toBe("direct");
    expect(touchChannel({ medium: 5 as unknown as string, ad_id: 7 as unknown as string })).toBe("direct");
  });

  it("los campos omitidos valen lo mismo que null", () => {
    expect(touchChannel({ origin: "form" })).toBe(touchChannel({ origin: "form", medium: null, ad_id: null }));
  });

  it("el orden es paid > referral > organic > direct", () => {
    const todo: TouchChannelInput = { origin: "dm", source: "instagram", medium: "referral_person", content_post_id: "x", ad_id: "1" };
    expect(touchChannel(todo)).toBe("paid");
    expect(touchChannel({ ...todo, ad_id: null })).toBe("referral");
    expect(touchChannel({ ...todo, ad_id: null, medium: null })).toBe("organic");
    expect(touchChannel({ origin: "form" })).toBe("direct");
  });
});

describe("isOriginChannel", () => {
  it("todo menos direct tiene origen", () => {
    expect(isOriginChannel("organic")).toBe(true);
    expect(isOriginChannel("paid")).toBe(true);
    expect(isOriginChannel("referral")).toBe(true);
    expect(isOriginChannel("direct")).toBe(false);
    expect(isOriginChannel(null)).toBe(false);
    expect(isOriginChannel("otro")).toBe(false);
  });
});

describe("CHANNEL_LABELS", () => {
  it("hay una etiqueta por canal", () => {
    expect(Object.keys(CHANNEL_LABELS).sort()).toEqual([...TOUCH_CHANNELS].sort());
    expect(CHANNEL_LABELS).toEqual({ organic: "Orgánico", paid: "Pauta", referral: "Referido", direct: "Directo" });
  });
});
