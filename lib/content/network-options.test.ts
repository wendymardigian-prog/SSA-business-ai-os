import { describe, it, expect } from "vitest";
import {
  parseNetworkOptions,
  missingRequiredOptions,
  defaultOptionsFor,
} from "./network-options";

describe("opciones por red (§9.5)", () => {
  it("limpia lo que no encaja en vez de romper", () => {
    // Una opcion vieja o de otra red no puede impedir que la pieza se abra.
    expect(parseNetworkOptions("instagram", { contentType: "story", cualquiera: 1 })).toEqual({
      contentType: "story",
    });
  });

  it("una red sin opciones propias no tiene ninguna", () => {
    expect(parseNetworkOptions("facebook", { lo: "que sea" })).toEqual({});
  });

  it("A9 · Instagram puede elegir historia", () => {
    expect(parseNetworkOptions("instagram", { contentType: "story" })).toMatchObject({
      contentType: "story",
    });
  });

  it("A17 · YouTube arranca en privada y se puede poner publica", () => {
    expect(defaultOptionsFor("youtube")).toMatchObject({ visibility: "private" });
    expect(parseNetworkOptions("youtube", { visibility: "public" })).toMatchObject({
      visibility: "public",
    });
  });
});

describe("A8 · lo que TikTok exige antes de programar", () => {
  it("sin las dos confirmaciones no se puede programar", () => {
    const missing = missingRequiredOptions("tiktok", defaultOptionsFor("tiktok"));

    expect(missing).toHaveLength(2);
    expect(missing.join(" ")).toContain("como va a quedar");
    expect(missing.join(" ")).toContain("consentimiento");
  });

  it("con todo confirmado, no falta nada", () => {
    expect(
      missingRequiredOptions("tiktok", {
        ...defaultOptionsFor("tiktok"),
        contentPreviewConfirmed: true,
        expressConsentGiven: true,
      }),
    ).toEqual([]);
  });

  it("un borrador no necesita confirmaciones: no se publica", () => {
    expect(missingRequiredOptions("tiktok", { mode: "draft" })).toEqual([]);
  });

  it("sin privacidad elegida tampoco se puede", () => {
    expect(
      missingRequiredOptions("tiktok", {
        mode: "public",
        contentPreviewConfirmed: true,
        expressConsentGiven: true,
      }).join(" "),
    ).toContain("quien puede ver");
  });

  it("las otras redes no piden nada de esto", () => {
    expect(missingRequiredOptions("instagram", {})).toEqual([]);
    expect(missingRequiredOptions("youtube", {})).toEqual([]);
  });
});
