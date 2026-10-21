import { describe, expect, it, vi } from "vitest";
import { openPickerFor, shouldOpenPicker } from "./date-picker-click";

describe("shouldOpenPicker", () => {
  it("abre en los campos de fecha, fecha y hora, mes, semana y hora", () => {
    for (const type of ["date", "datetime-local", "month", "week", "time", "DATE"]) {
      expect(shouldOpenPicker({ tagName: "input", type })).toBe(true);
    }
  });

  it("no abre en otros campos ni en elementos que no son campos", () => {
    expect(shouldOpenPicker({ tagName: "INPUT", type: "text" })).toBe(false);
    expect(shouldOpenPicker({ tagName: "INPUT", type: "number" })).toBe(false);
    expect(shouldOpenPicker({ tagName: "INPUT" })).toBe(false);
    expect(shouldOpenPicker({ tagName: "BUTTON", type: "date" })).toBe(false);
    expect(shouldOpenPicker(null)).toBe(false);
  });

  it("no abre un campo deshabilitado o de solo lectura", () => {
    expect(shouldOpenPicker({ tagName: "INPUT", type: "date", disabled: true })).toBe(false);
    expect(shouldOpenPicker({ tagName: "INPUT", type: "date", readOnly: true })).toBe(false);
  });
});

describe("openPickerFor", () => {
  it("llama a showPicker en un campo de fecha", () => {
    const showPicker = vi.fn();
    expect(openPickerFor({ tagName: "INPUT", type: "date", showPicker })).toBe(true);
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it("no lanza si el navegador no tiene showPicker o lo rechaza (iframe de otro dominio, ya abierto)", () => {
    expect(openPickerFor({ tagName: "INPUT", type: "date" })).toBe(false);
    const throwing = vi.fn(() => {
      throw new DOMException("cross-origin", "SecurityError");
    });
    expect(openPickerFor({ tagName: "INPUT", type: "date", showPicker: throwing })).toBe(false);
  });

  it("no toca un campo que no califica", () => {
    const showPicker = vi.fn();
    expect(openPickerFor({ tagName: "INPUT", type: "text", showPicker })).toBe(false);
    expect(openPickerFor({ tagName: "INPUT", type: "date", disabled: true, showPicker })).toBe(false);
    expect(showPicker).not.toHaveBeenCalled();
  });
});
