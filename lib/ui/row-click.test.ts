import { describe, expect, it } from "vitest";
import { rowClickIntent, type RowClickInput } from "./row-click";

const base: RowClickInput = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, targetIsInteractive: false, hasTextSelection: false, hasHref: true };

describe("rowClickIntent", () => {
  it("un clic común abre la fila", () => {
    expect(rowClickIntent(base)).toBe("open");
    expect(rowClickIntent({ ...base, hasHref: false })).toBe("open");
  });

  it("un control adentro de la fila gana", () => {
    expect(rowClickIntent({ ...base, targetIsInteractive: true })).toBe("ignore");
    expect(rowClickIntent({ ...base, targetIsInteractive: true, metaKey: true })).toBe("ignore");
  });

  it("seleccionar texto no abre nada", () => {
    expect(rowClickIntent({ ...base, hasTextSelection: true })).toBe("ignore");
  });

  it("Cmd, Ctrl, Shift o el botón del medio abren otra pestaña si hay dirección", () => {
    expect(rowClickIntent({ ...base, metaKey: true })).toBe("new-tab");
    expect(rowClickIntent({ ...base, ctrlKey: true })).toBe("new-tab");
    expect(rowClickIntent({ ...base, shiftKey: true })).toBe("new-tab");
    expect(rowClickIntent({ ...base, button: 1 })).toBe("new-tab");
  });

  it("sin dirección: con una tecla abre igual, el botón del medio no hace nada", () => {
    expect(rowClickIntent({ ...base, hasHref: false, metaKey: true })).toBe("open");
    expect(rowClickIntent({ ...base, hasHref: false, button: 1 })).toBe("ignore");
  });

  it("el botón derecho nunca abre", () => {
    expect(rowClickIntent({ ...base, button: 2 })).toBe("ignore");
  });
});
