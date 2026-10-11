import { describe, it, expect } from "vitest";
import { canTransition, countByStatus, duplicateName, formListRow, nextSlug, parseListFilter, slugFromName, SLUG_PATTERN } from "./list";

describe("canTransition", () => {
  it("permite las transiciones del plano", () => {
    expect(canTransition("draft", "published")).toBe(true);
    expect(canTransition("published", "paused")).toBe(true);
    expect(canTransition("paused", "published")).toBe(true);
    for (const from of ["draft", "published", "paused"] as const) expect(canTransition(from, "archived")).toBe(true);
    expect(canTransition("archived", "draft")).toBe(true);
  });

  it("rechaza las demás", () => {
    expect(canTransition("archived", "published")).toBe(false);
    expect(canTransition("archived", "paused")).toBe(false);
    expect(canTransition("draft", "paused")).toBe(false);
    expect(canTransition("published", "draft")).toBe(false);
    expect(canTransition("published", "published")).toBe(false);
  });
});

describe("slugs", () => {
  it('nextSlug("aplicacion", ["aplicacion","aplicacion-2"]) da "aplicacion-3"', () => {
    expect(nextSlug("aplicacion", ["aplicacion", "aplicacion-2"])).toBe("aplicacion-3");
  });

  it("no distingue mayúsculas", () => {
    expect(nextSlug("aplicacion", ["APLICACION"])).toBe("aplicacion-2");
  });

  it("devuelve el base si está libre", () => {
    expect(nextSlug("nuevo", [])).toBe("nuevo");
  });

  it("slugFromName siempre cumple el formato", () => {
    for (const name of ["Aplicación al programa", "¿Cómo vas?", "A", "", "ñ", "x".repeat(200)]) {
      expect(slugFromName(name), name).toMatch(SLUG_PATTERN);
    }
    expect(slugFromName("Aplicación al programa")).toBe("aplicacion-al-programa");
  });

  it("nextSlug respeta el largo máximo", () => {
    const base = "a".repeat(60);
    expect(nextSlug(base, [base]).length).toBeLessThanOrEqual(60);
  });
});

describe("filas y contadores", () => {
  it("formListRow sin estadísticas", () => {
    const row = formListRow({ id: "1", name: "F", type: "custom", status: "draft", slug: "f-1", updated_at: "2026-10-10" });
    expect(row.submissions).toBe(0);
    expect(row.lastSubmissionAt).toBeNull();
  });

  it("countByStatus", () => {
    expect(countByStatus([{ status: "draft" }, { status: "draft" }, { status: "published" }])).toEqual({
      published: 1,
      draft: 2,
      paused: 0,
      archived: 0,
    });
  });

  it("parseListFilter y duplicateName", () => {
    expect(parseListFilter("paused")).toBe("paused");
    expect(parseListFilter("x")).toBe("published");
    expect(duplicateName("Aplicación")).toBe("Copia de Aplicación");
  });
});
