import { describe, expect, it } from "vitest";
import { shouldAlert } from "./alerts";

const NOW = new Date("2026-10-12T12:00:00Z");

describe("shouldAlert", () => {
  it("menos de 5 errores no avisa", () => expect(shouldAlert(4, null, NOW)).toBe(false));
  it("5 errores y nunca se aviso: avisa", () => expect(shouldAlert(5, null, NOW)).toBe(true));
  it("5 errores y se aviso hace 59 minutos: no", () => expect(shouldAlert(9, new Date(NOW.getTime() - 59 * 60_000), NOW)).toBe(false));
  it("5 errores y se aviso hace 1 hora: si", () => expect(shouldAlert(5, new Date(NOW.getTime() - 60 * 60_000), NOW)).toBe(true));
  it("un aviso con fecha ilegible no frena", () => expect(shouldAlert(5, "x", NOW)).toBe(true));
});
