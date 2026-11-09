// @plantilla-quitar(ventas)
import { describe, expect, it, vi } from "vitest";
import { affErrorMessage, affRpc } from "./rpc";

describe("affErrorMessage", () => {
  it("muestra el texto de la base solo si es nuestro", () => {
    expect(affErrorMessage({ code: "AF011", message: "Escribí el motivo" })).toBe("Escribí el motivo");
    expect(affErrorMessage({ code: "CM022", message: "Ya está en un gasto" })).toBe("Ya está en un gasto");
    expect(affErrorMessage({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe("No se pudo hacer. Probá de nuevo en un rato.");
    expect(affErrorMessage({ code: "42501", message: "permission denied" })).toBe("No tenés permiso para hacer esto");
  });
});

describe("affRpc", () => {
  it("devuelve el dato o el error traducido", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = { rpc: vi.fn().mockResolvedValue({ data: "abcd12", error: null }) };
    expect(await affRpc(ok, "affiliate_ensure_code", {})).toEqual({ ok: true, data: "abcd12" });
    const bad = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "AF012", message: "El afiliado no puede ser el que compra" } }) };
    expect(await affRpc(bad, "affiliate_set_sale", {})).toEqual({ ok: false, error: { code: "AF012", message: "El afiliado no puede ser el que compra" } });
  });
});
