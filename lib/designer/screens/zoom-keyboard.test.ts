import { describe, expect, it } from "vitest";
import { commandForKey, SHORTCUTS, type KeyInput } from "./keyboard";
import { inverseScale, MAX_SCALE, MIN_SCALE, pinchScale, scaledSize, wheelZoom, zoomScale } from "./zoom";

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({ key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...extra });
const sel = { typing: false, hasSelection: true };

describe("zoom del lienzo (F18)", () => {
  it("Ajustar entra la página completa en el espacio; 50, 100 y 200 son fijos", () => {
    const viewport = { width: 1044, height: 644 };
    expect(zoomScale("fit", viewport, { width: 1000, height: 1000 })).toBeCloseTo(0.6, 5);
    expect(zoomScale("fit", viewport, { width: 2000, height: 500 })).toBeCloseTo(0.5, 5);
    expect(zoomScale(50, viewport, { width: 1000, height: 1000 })).toBe(0.5);
    expect(zoomScale(100, viewport, { width: 1000, height: 1000 })).toBe(1);
    expect(zoomScale(200, viewport, { width: 1000, height: 1000 })).toBe(2);
  });

  it("una página web se ajusta por el ancho (su alto es libre)", () => {
    expect(zoomScale("fit", { width: 1044, height: 300 }, { width: 1280, height: 6000 }, { fitWidthOnly: true })).toBeCloseTo(1000 / 1280, 5);
  });

  it("Ctrl/⌘ + rueda sube y baja entre 50, 100 y 200 y se queda en los extremos", () => {
    expect(wheelZoom(100, -1)).toBe(200);
    expect(wheelZoom(200, -1)).toBe(200);
    expect(wheelZoom(100, 1)).toBe(50);
    expect(wheelZoom(50, 1)).toBe(50);
    expect(wheelZoom("fit", -1)).toBe(100);
    expect(wheelZoom("fit", 1)).toBe(50);
  });

  it("el pellizco sigue la distancia entre los dedos, dentro de un rango", () => {
    expect(pinchScale(1, 100, 200)).toBe(2);
    expect(pinchScale(1, 100, 50)).toBe(0.5);
    expect(pinchScale(1, 100, 100_000)).toBe(MAX_SCALE);
    expect(pinchScale(1, 100, 0.0001)).toBe(MIN_SCALE);
    expect(pinchScale(1.5, 0, 100)).toBe(1.5);
  });

  it("la inversa y el tamaño escalado", () => {
    expect(inverseScale(0.5)).toBe(2);
    expect(scaledSize({ width: 1080, height: 1350 }, 0.5)).toEqual({ width: 540, height: 675 });
  });
});

describe("atajos de teclado (F18–F20, F26)", () => {
  it("las flechas mueven; con Shift, más", () => {
    expect(commandForKey(key("ArrowLeft"), sel)).toEqual({ type: "nudge", direction: "left", big: false });
    expect(commandForKey(key("ArrowDown", { shiftKey: true }), sel)).toEqual({ type: "nudge", direction: "down", big: true });
    expect(commandForKey(key("ArrowUp"), { typing: false, hasSelection: false })).toBeNull();
  });

  it("eliminar, duplicar y entrar a escribir", () => {
    expect(commandForKey(key("Delete"), sel)).toEqual({ type: "delete" });
    expect(commandForKey(key("Backspace"), sel)).toEqual({ type: "delete" });
    expect(commandForKey(key("d", { metaKey: true }), sel)).toEqual({ type: "duplicate" });
    expect(commandForKey(key("D", { ctrlKey: true }), sel)).toEqual({ type: "duplicate" });
    expect(commandForKey(key("Enter"), sel)).toEqual({ type: "edit-text" });
  });

  it("] y [ van adelante y atrás; con ⌘, al frente y al fondo", () => {
    expect(commandForKey(key("]"), sel)).toEqual({ type: "forward" });
    expect(commandForKey(key("["), sel)).toEqual({ type: "backward" });
    expect(commandForKey(key("]", { metaKey: true }), sel)).toEqual({ type: "front" });
    expect(commandForKey(key("[", { ctrlKey: true }), sel)).toEqual({ type: "back" });
  });

  it("⌘Z deshace y ⌘⇧Z rehace, aunque no haya selección", () => {
    const none = { typing: false, hasSelection: false };
    expect(commandForKey(key("z", { metaKey: true }), none)).toEqual({ type: "undo" });
    expect(commandForKey(key("z", { metaKey: true, shiftKey: true }), none)).toEqual({ type: "redo" });
    expect(commandForKey(key("y", { ctrlKey: true }), none)).toEqual({ type: "redo" });
  });

  it("escribiendo, las teclas son del texto; solo Esc sale", () => {
    const typing = { typing: true, hasSelection: true };
    expect(commandForKey(key("Delete"), typing)).toBeNull();
    expect(commandForKey(key("ArrowLeft"), typing)).toBeNull();
    expect(commandForKey(key("z", { metaKey: true }), typing)).toBeNull();
    expect(commandForKey(key("Escape"), typing)).toEqual({ type: "escape" });
  });

  it("las teclas que no son atajos no hacen nada", () => {
    expect(commandForKey(key("a"), sel)).toBeNull();
    expect(commandForKey(key("ArrowLeft", { metaKey: true }), sel)).toBeNull();
  });

  it("la ayuda de atajos lista los principales", () => {
    expect(SHORTCUTS.map((s) => s.does)).toEqual(expect.arrayContaining(["eliminar", "duplicar", "escribir", "soltar"]));
  });
});
