import { describe, it, expect } from "vitest";
import { isFormField, menuKeyAction, MENU_ITEM_SELECTOR } from "./menu-keys";

const onButton = (key: string, index = 1, count = 4, shiftKey = false) =>
  menuKeyAction({ key, shiftKey, onField: false, index, count });
const onField = (key: string, index = 1, count = 4, shiftKey = false) =>
  menuKeyAction({ key, shiftKey, onField: true, index, count });

describe("menuKeyAction: un menu de botones, igual que antes del Bloque I", () => {
  it("las flechas recorren y dan la vuelta", () => {
    expect(onButton("ArrowDown", 1)).toEqual({ kind: "focus", index: 2 });
    expect(onButton("ArrowDown", 3)).toEqual({ kind: "focus", index: 0 });
    expect(onButton("ArrowUp", 0)).toEqual({ kind: "focus", index: 3 });
  });

  it("sin item con foco, la flecha abajo va al primero y la de arriba al ultimo", () => {
    expect(onButton("ArrowDown", -1)).toEqual({ kind: "focus", index: 0 });
    expect(onButton("ArrowUp", -1)).toEqual({ kind: "focus", index: 2 });
  });

  it("Home y End van a las puntas", () => {
    expect(onButton("Home", 2)).toEqual({ kind: "focus", index: 0 });
    expect(onButton("End", 0)).toEqual({ kind: "focus", index: 3 });
  });

  it("Esc cierra (y el componente devuelve el foco al boton)", () => {
    expect(onButton("Escape")).toEqual({ kind: "close" });
  });

  it("Tab cierra sin devolver el foco, como siempre", () => {
    expect(onButton("Tab")).toEqual({ kind: "dismiss" });
    expect(onButton("Tab", 1, 4, true)).toEqual({ kind: "dismiss" });
  });

  it("cualquier otra tecla es del navegador", () => {
    expect(onButton("Enter")).toEqual({ kind: "native" });
    expect(onButton("a")).toEqual({ kind: "native" });
  });

  it("un menu vacio no navega", () => {
    expect(onButton("ArrowDown", -1, 0)).toEqual({ kind: "native" });
    expect(onButton("Tab", -1, 0)).toEqual({ kind: "dismiss" });
  });
});

describe("menuKeyAction: con el foco en un campo", () => {
  it("flechas, Home y End son del campo", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      expect(onField(key)).toEqual({ kind: "native" });
    }
  });

  it("Tab pasa al item siguiente sin cerrar, y da la vuelta", () => {
    expect(onField("Tab", 1)).toEqual({ kind: "focus", index: 2 });
    expect(onField("Tab", 3)).toEqual({ kind: "focus", index: 0 });
  });

  it("Shift+Tab vuelve al anterior", () => {
    expect(onField("Tab", 0, 4, true)).toEqual({ kind: "focus", index: 3 });
  });

  it("Esc sigue cerrando", () => {
    expect(onField("Escape")).toEqual({ kind: "close" });
  });
});

describe("isFormField y el selector de items", () => {
  it("reconoce select, input y textarea, y nada mas", () => {
    expect(isFormField("SELECT")).toBe(true);
    expect(isFormField("input")).toBe(true);
    expect(isFormField("TEXTAREA")).toBe(true);
    expect(isFormField("BUTTON")).toBe(false);
    expect(isFormField(undefined)).toBe(false);
  });

  it("el selector conserva los dos de antes y suma los campos", () => {
    expect(MENU_ITEM_SELECTOR).toContain('[role="menuitemradio"]:not([disabled])');
    expect(MENU_ITEM_SELECTOR).toContain("button:not([disabled])");
    expect(MENU_ITEM_SELECTOR).toContain("select:not([disabled])");
    expect(MENU_ITEM_SELECTOR).toContain("input:not([disabled])");
  });
});
