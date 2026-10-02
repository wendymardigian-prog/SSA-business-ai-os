import { describe, it, expect } from "vitest";
import { channelAcceptsMedia } from "./media";

describe("channelAcceptsMedia", () => {
  it("un canal de email no acepta media", () => {
    expect(channelAcceptsMedia("resend")).toBe(false);
  });

  it("whatsapp y instagram si aceptan", () => {
    expect(channelAcceptsMedia("evolution")).toBe(true);
    expect(channelAcceptsMedia("zernio")).toBe(true);
  });

  it("un provider desconocido o ausente acepta por defecto (solo email esta excluido)", () => {
    expect(channelAcceptsMedia(null)).toBe(true);
    expect(channelAcceptsMedia(undefined)).toBe(true);
    expect(channelAcceptsMedia("lo-que-sea")).toBe(true);
  });
});
