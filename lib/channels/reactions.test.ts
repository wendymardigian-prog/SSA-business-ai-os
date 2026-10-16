import { describe, expect, it } from "vitest";
import { canReactToMessage, isAllowedReaction, isSingleEmoji, reactionCapability } from "@/lib/channels/reactions";

describe("capacidades por canal", () => {
  it("WhatsApp: cualquier emoji, con seis a mano", () => {
    const c = reactionCapability("evolution");
    expect(c).toMatchObject({ supported: true, anyEmoji: true });
    expect(c.quick).toHaveLength(6);
  });

  it("Instagram: solo el corazon", () => {
    const c = reactionCapability("zernio");
    expect(c).toMatchObject({ supported: true, anyEmoji: false });
    expect(c.quick).toEqual(["❤️"]);
  });

  it("email y desconocidos: ninguna, con el motivo", () => {
    expect(reactionCapability("resend")).toMatchObject({ supported: false, reason: expect.stringMatching(/email/i) });
    expect(reactionCapability("otro").supported).toBe(false);
    expect(reactionCapability(null).supported).toBe(false);
    expect(reactionCapability(undefined).supported).toBe(false);
  });
});

describe("canReactToMessage", () => {
  const base = { provider: "evolution", direction: "inbound" as const, platformMessageId: "ABC" };

  it("un mensaje del contacto con id del canal, si", () => {
    expect(canReactToMessage(base)).toEqual({ ok: true });
  });

  it("a un mensaje nuestro no", () => {
    expect(canReactToMessage({ ...base, direction: "outbound" })).toMatchObject({ ok: false });
  });

  it("sin id del canal no hay a que reaccionar", () => {
    expect(canReactToMessage({ ...base, platformMessageId: null })).toMatchObject({ ok: false });
    expect(canReactToMessage({ ...base, platformMessageId: "" })).toMatchObject({ ok: false });
  });

  it("en email nunca", () => {
    expect(canReactToMessage({ ...base, provider: "resend" })).toMatchObject({ ok: false });
  });
});

describe("isSingleEmoji", () => {
  it("acepta emojis simples, con variacion, compuestos, con tono y banderas", () => {
    for (const e of ["👍", "❤️", "👨‍👩‍👧", "👍🏽", "🇦🇷", "😂"]) expect(isSingleEmoji(e), e).toBe(true);
  });

  it("rechaza texto, varios emojis y vacio", () => {
    for (const e of ["", " ", "a", "hola", "👍👍", "👍 a", "x".repeat(40)]) expect(isSingleEmoji(e), JSON.stringify(e)).toBe(false);
  });
});

describe("isAllowedReaction", () => {
  it("WhatsApp acepta cualquier emoji y la reaccion vacia (quitarla)", () => {
    expect(isAllowedReaction("evolution", "🔥")).toBe(true);
    expect(isAllowedReaction("evolution", "")).toBe(true);
    expect(isAllowedReaction("evolution", "texto")).toBe(false);
  });

  it("Instagram solo el corazon", () => {
    expect(isAllowedReaction("zernio", "❤️")).toBe(true);
    expect(isAllowedReaction("zernio", "🔥")).toBe(false);
    expect(isAllowedReaction("zernio", "")).toBe(true);
  });

  it("un canal sin reacciones no acepta nada, ni siquiera quitar", () => {
    expect(isAllowedReaction("resend", "❤️")).toBe(false);
    expect(isAllowedReaction("resend", "")).toBe(false);
  });
});
