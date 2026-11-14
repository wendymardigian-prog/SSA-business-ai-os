// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { digestHtml, digestSections, localTimeToUtc, weekday } from "./digest";

describe("el resumen semanal", () => {
  it("un estudiante sin reto ni novedades: solo lo que tiene y referidos al final", () => {
    const s = digestSections({ done: 2, pending: 0, challenge: 0, content: 0, community: 0 });
    expect(s.map((x) => x.key)).toEqual(["done", "referrals"]);
  });
  it("todas las secciones, en orden, y referidos siempre al final", () => {
    const s = digestSections({ done: 1, pending: 3, challenge: 5, content: 1, community: 2 });
    expect(s.map((x) => x.key)).toEqual(["done", "pending", "challenge", "content", "community", "referrals"]);
    expect(s[0].text).toBe("Completaste 1 paso esta semana.");
  });
  it("sin nada igual lleva referidos", () => expect(digestSections({ done: 0, pending: 0, challenge: 0, content: 0, community: 0 }).map((x) => x.key)).toEqual(["referrals"]));
  it("el HTML escapa los nombres", () => expect(digestHtml("Ana<b> Pérez", "Prog & Co", [])).toContain("Ana&lt;b&gt;"));
});

describe("cuándo sale", () => {
  it("el lunes", () => {
    expect(weekday("2026-11-16")).toBe(1);
    expect(weekday("2026-11-15")).toBe(0);
  });
  it("las 8:00 en la zona del estudiante", () => {
    expect(localTimeToUtc("2026-11-16", 8, "America/Costa_Rica")).toBe("2026-11-16T14:00:00.000Z");
    expect(localTimeToUtc("2026-11-16", 8, "Europe/Madrid")).toBe("2026-11-16T07:00:00.000Z");
    expect(localTimeToUtc("2026-11-16", 8, "UTC")).toBe("2026-11-16T08:00:00.000Z");
  });
});
