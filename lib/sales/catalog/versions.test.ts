import { describe, expect, it } from "vitest";
import { canDeleteVersion, canEditVersion, canPublish, checkVersionInput, nextVersionNumber, resolveActiveVersion } from "./versions";

const v = (id: string, status: string, n: number, price = 100, notes: string | null = null) => ({ id, status, version_number: n, price, change_notes: notes });

describe("resolveActiveVersion", () => {
  it("devuelve la activa", () => {
    expect(resolveActiveVersion([v("a", "deprecated", 1), v("b", "active", 2), v("c", "draft", 3)])?.id).toBe("b");
  });
  it("sin activa devuelve null", () => {
    expect(resolveActiveVersion([v("a", "draft", 1)])).toBeNull();
  });
  it("con dos activas (estado imposible) LANZA, no elige una", () => {
    expect(() => resolveActiveVersion([v("a", "active", 1), v("b", "active", 2)])).toThrow(/imposible/);
  });
});

describe("checkVersionInput", () => {
  it("acepta un precio con coma o punto y lo deja en dos decimales", () => {
    expect(checkVersionInput("1297,5", null)).toEqual({ ok: true, price: 1297.5 });
    expect(checkVersionInput(416.67, null)).toEqual({ ok: true, price: 416.67 });
  });
  it("precio 0 solo con notas del cambio", () => {
    expect(checkVersionInput(0, null)).toMatchObject({ ok: false });
    expect(checkVersionInput(0, "   ")).toMatchObject({ ok: false });
    expect(checkVersionInput(0, "Cortesía")).toEqual({ ok: true, price: 0 });
  });
  it("rechaza vacío, negativo y texto", () => {
    expect(checkVersionInput("", null)).toMatchObject({ ok: false });
    expect(checkVersionInput(-5, null)).toMatchObject({ ok: false });
    expect(checkVersionInput("abc", null)).toMatchObject({ ok: false });
  });
});

describe("canPublish / canEdit / canDelete", () => {
  it("un borrador con precio se publica", () => {
    expect(canPublish(v("c", "draft", 3), [v("b", "active", 2)])).toEqual({ ok: true });
  });
  it("una deprecated no se publica", () => {
    expect(canPublish(v("a", "deprecated", 1))).toMatchObject({ ok: false });
  });
  it("una publicada no se edita: 'creá una nueva'", () => {
    expect(canEditVersion("active")).toEqual({ ok: false, error: "Una versión publicada no se edita: creá una nueva" });
    expect(canEditVersion("draft")).toEqual({ ok: true });
  });
  it("una publicada o con ventas no se borra", () => {
    expect(canDeleteVersion({ status: "active" }, 0)).toMatchObject({ ok: false });
    expect(canDeleteVersion({ status: "draft" }, 2)).toMatchObject({ ok: false });
    expect(canDeleteVersion({ status: "draft" }, 0)).toEqual({ ok: true });
  });
});

it("nextVersionNumber suma uno al mayor", () => {
  expect(nextVersionNumber([])).toBe(1);
  expect(nextVersionNumber([{ version_number: 1 }, { version_number: 4 }])).toBe(5);
});
