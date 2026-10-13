import { describe, expect, it } from "vitest";
import { metaNameKey } from "./name-key";

// Los mismos casos que se corren contra `public.meta_name_key` en la base (verify-ads-attribution.mjs):
// si uno cambia, el otro tiene que cambiar con el.
export const NAME_KEY_CASES: Array<[string | null, string]> = [
  ["  Video  Testimonio Ána ", "video testimonio ana"],
  ["REEL — Cómo cobrar en dólares", "reel — como cobrar en dolares"],
  ["Niño   pequeño", "nino pequeno"],
  ["", ""],
  [null, ""],
  ["a\tb\nc", "a b c"],
];

describe("metaNameKey", () => {
  it.each(NAME_KEY_CASES)("%j -> %j", (raw, expected) => {
    expect(metaNameKey(raw)).toBe(expected);
  });

  it("dos nombres que solo difieren en mayusculas, tildes o espacios dan la misma clave", () => {
    expect(metaNameKey("Video Testimonio")).toBe(metaNameKey("  video   TESTIMONIO "));
    expect(metaNameKey("Reunión")).toBe(metaNameKey("reunion"));
  });
});
