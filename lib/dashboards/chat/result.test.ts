import { describe, expect, it, vi } from "vitest";
import { blockResult, errorMessage, fail, fromRpc, ok } from "./result";

describe("blockResult", () => {
  it("devuelve los datos cuando la consulta anduvo", async () => {
    const r = await blockResult("las tendencias", async () => ({ data: [1, 2] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual([1, 2]);
      expect(typeof r.loadedAt).toBe("string");
    }
  });

  it("un error de la base es un bloque caido, no un cero", async () => {
    const r = await blockResult("las tendencias", async () => ({ error: "function does not exist" }));
    expect(r).toEqual({ ok: false, error: "No pudimos cargar las tendencias: function does not exist" });
  });

  it("nunca lanza: una promesa rota tambien es un bloque caido", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await blockResult("el equipo", async () => {
      throw new Error("se cayo la red");
    });
    expect(r).toEqual({ ok: false, error: "No pudimos cargar el equipo." });
    spy.mockRestore();
  });

  it("una consulta colgada se corta por tiempo", async () => {
    vi.useFakeTimers();
    const promise = blockResult("los patrones", () => new Promise(() => {}), 10);
    await vi.advanceTimersByTimeAsync(11);
    const r = await promise;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("tardó demasiado");
    vi.useRealTimers();
  });
});

describe("fromRpc", () => {
  it("mapea las filas", () => {
    expect(fromRpc<{ n: number }, number>({ data: [{ n: 3 }], error: null }, (rows) => rows[0].n)).toEqual({ data: 3 });
  });

  it("una fila sola (no array) tambien entra", () => {
    expect(fromRpc<number, number>({ data: 7 as unknown, error: null }, (rows) => rows[0])).toEqual({ data: 7 });
  });

  it("pasa el error tal cual", () => {
    expect(fromRpc({ data: null, error: { message: "permission denied" } }, () => 1)).toEqual({ error: "permission denied" });
  });

  it("sin datos, la lista vacia (no un error)", () => {
    expect(fromRpc<number, number[]>({ data: null, error: null }, (rows) => rows)).toEqual({ data: [] });
  });
});

describe("ok / fail / errorMessage", () => {
  it("ok lleva la marca de tiempo que se le pasa", () => {
    expect(ok(1, "2026-09-28T00:00:00.000Z")).toEqual({ ok: true, data: 1, loadedAt: "2026-09-28T00:00:00.000Z" });
  });
  it("fail lleva el motivo", () => {
    expect(fail("roto")).toEqual({ ok: false, error: "roto" });
  });
  it("errorMessage no devuelve objetos", () => {
    expect(errorMessage(new Error("x"))).toBe("x");
    expect(errorMessage("y")).toBe("y");
    expect(errorMessage({ secreto: 1 })).toBe("Error inesperado");
  });
});
