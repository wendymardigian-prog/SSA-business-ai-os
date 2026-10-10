import { describe, it, expect } from "vitest";
import { isShortcutActive, RUN_SHORTCUTS, shortcutParams } from "./runs-shortcuts";

const current = (patch: Partial<{ resultado: string; sinPrecio: boolean; masLentas: boolean; orden: string }> = {}) => ({
  resultado: "", sinPrecio: false, masLentas: false, orden: "recientes", ...patch,
});

describe("RUN_SHORTCUTS", () => {
  it("son los cinco del documento, en orden", () => {
    expect(RUN_SHORTCUTS.map((s) => s.key)).toEqual(["errores", "escaladas", "sin_precio", "lentas", "caras"]);
  });

  it("sin precio y mas caras necesitan ai_costs.view; los demas no", () => {
    expect(RUN_SHORTCUTS.filter((s) => s.needsCost).map((s) => s.key)).toEqual(["sin_precio", "caras"]);
  });
});

describe("shortcutParams", () => {
  it("errores y escaladas son el filtro de resultado que ya existe", () => {
    expect(shortcutParams("errores")).toEqual({ resultado: "error" });
    expect(shortcutParams("escaladas")).toEqual({ resultado: "escalated" });
  });

  it("sin_precio y lentas son flags propios", () => {
    expect(shortcutParams("sin_precio")).toEqual({ sin_precio: "1" });
    expect(shortcutParams("lentas")).toEqual({ lentas: "1" });
  });

  it("caras pone el orden directo (Bloque Agentes IA)", () => {
    expect(shortcutParams("caras")).toEqual({ orden: "caras" });
  });
});

describe("isShortcutActive", () => {
  it("errores esta activo solo cuando resultado=error", () => {
    expect(isShortcutActive("errores", current({ resultado: "error" }))).toBe(true);
    expect(isShortcutActive("errores", current({ resultado: "escalated" }))).toBe(false);
  });

  it("los flags propios reflejan su campo", () => {
    expect(isShortcutActive("sin_precio", current({ sinPrecio: true }))).toBe(true);
    expect(isShortcutActive("lentas", current({ masLentas: true }))).toBe(true);
    expect(isShortcutActive("caras", current({ orden: "caras" }))).toBe(true);
    expect(isShortcutActive("caras", current({ orden: "baratas" }))).toBe(false);
  });

  it("nada activo por defecto", () => {
    for (const s of RUN_SHORTCUTS) expect(isShortcutActive(s.key, current())).toBe(false);
  });
});
