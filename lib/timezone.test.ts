import { describe, it, expect } from "vitest";
import { isValidTimeZone, listTimeZones, DEFAULT_TIMEZONE } from "./timezone";

describe("zona horaria (F3)", () => {
  it("acepta zonas IANA válidas", () => {
    expect(isValidTimeZone("America/Costa_Rica")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rechaza basura", () => {
    expect(isValidTimeZone("Marte/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("America/Costa_Rica; drop table")).toBe(false);
    // @ts-expect-error probando entrada no-string
    expect(isValidTimeZone(null)).toBe(false);
  });

  it("el default es una zona válida", () => {
    expect(isValidTimeZone(DEFAULT_TIMEZONE)).toBe(true);
    expect(DEFAULT_TIMEZONE).toBe("America/Costa_Rica");
  });

  it("la lista incluye el default y no está vacía", () => {
    const list = listTimeZones();
    expect(list.length).toBeGreaterThan(0);
    expect(list).toContain("America/Costa_Rica");
  });
});
