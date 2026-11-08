import { describe, expect, it } from "vitest";
import { alignSelection, intersects, nudge, pointerAngle, resizeFont, resizeHeight, resizeWidth, rotate, scaleBox, screenToPct, snap, snapTolerance } from "./canvas-math";
import { FORMATS } from "./formats";

const page = { width: 1080, height: 1350 };
const safe = FORMATS.v45.safeZone;
// Escala 0,5: 6 px de pantalla = 12 px de diseño = 1,11 % del ancho y 0,89 % del alto.
const base = { others: [], safeZone: safe, pageSize: page, scale: 0.5 };

describe("imanes (F14)", () => {
  it("la tolerancia depende del zoom", () => {
    const t = snapTolerance(page, 0.5);
    expect(t.x).toBeCloseTo(1.111, 2);
    expect(snapTolerance(page, 2).x).toBeLessThan(t.x);
  });

  it("se pega al centro dentro de la tolerancia", () => {
    const r = snap({ ...base, box: { x: 50.8, y: 20, w: 30, h: 10 } });
    expect(r.x).toBe(50);
    expect(r.guides).toContainEqual({ axis: "x", at: 50, kind: "center" });
  });

  it("no se pega al centro fuera de la tolerancia", () => {
    const r = snap({ ...base, box: { x: 52, y: 20, w: 30, h: 10 } });
    expect(r.x).toBe(52);
    expect(r.guides.filter((g) => g.axis === "x")).toEqual([]);
  });

  it("se pega al margen izquierdo considerando el ancho", () => {
    // Margen 6 %, ancho 20 %: el centro queda en 16.
    const r = snap({ ...base, box: { x: 16.7, y: 30, w: 20, h: 10 } });
    expect(r.x).toBe(16);
    expect(r.guides).toContainEqual({ axis: "x", at: 6, kind: "margin" });
  });

  it("se pega al margen derecho", () => {
    const r = snap({ ...base, box: { x: 83.5, y: 30, w: 20, h: 10 } });
    expect(r.x).toBe(84);
  });

  it("dos imanes a la vez (x e y)", () => {
    const r = snap({ ...base, box: { x: 50.5, y: 49.6, w: 30, h: 10 } });
    expect([r.x, r.y]).toEqual([50, 50]);
    expect(r.guides).toHaveLength(2);
  });

  it("con Alt no hay imanes", () => {
    const r = snap({ ...base, box: { x: 50.5, y: 49.6, w: 30, h: 10 }, disabled: true });
    expect([r.x, r.y, r.guides.length]).toEqual([50.5, 49.6, 0]);
  });

  it("se alinea con el borde izquierdo de otro elemento", () => {
    // Otro: x 40, w 20 → borde izquierdo en 30. Esta caja de ancho 10 se pega con su borde izquierdo en 30 (centro 35).
    const r = snap({ ...base, box: { x: 35.6, y: 80, w: 10, h: 5 }, others: [{ x: 40, y: 20, w: 20, h: 10 }] });
    expect(r.x).toBe(35);
    expect(r.guides).toContainEqual({ axis: "x", at: 30, kind: "element" });
  });

  it("se alinea con el centro de otro elemento", () => {
    const r = snap({ ...base, box: { x: 70.5, y: 80, w: 10, h: 5 }, others: [{ x: 70, y: 20, w: 20, h: 10 }] });
    expect(r.x).toBe(70);
  });

  it("a igual distancia gana el centro de la página antes que un elemento", () => {
    const r = snap({ ...base, box: { x: 50.5, y: 80, w: 10, h: 5 }, others: [{ x: 51, y: 20, w: 20, h: 10 }] });
    expect(r.guides.find((g) => g.axis === "x")?.kind).toBe("center");
  });
});

describe("mover, tamaño y rotación", () => {
  it("flechas: 0,5 % y 2 % con Shift, sin salirse de la página", () => {
    expect(nudge({ x: 50, y: 50 }, "right")).toEqual({ x: 50.5, y: 50 });
    expect(nudge({ x: 50, y: 50 }, "up", true)).toEqual({ x: 50, y: 48 });
    expect(nudge({ x: 0.2, y: 50 }, "left")).toEqual({ x: 0, y: 50 });
  });

  it("ancho desde la derecha: el lado izquierdo queda quieto", () => {
    const r = resizeWidth({ x: 50, w: 20 }, "right", 10);
    expect(r).toEqual({ x: 55, w: 30 });
    expect(r.x - r.w / 2).toBe(40);
  });

  it("ancho desde la izquierda, con mínimo 1 %", () => {
    expect(resizeWidth({ x: 50, w: 20 }, "left", 10)).toEqual({ x: 45, w: 30 });
    expect(resizeWidth({ x: 50, w: 2 }, "left", -10).w).toBe(1);
  });

  it("alto desde abajo", () => {
    expect(resizeHeight({ y: 50, h: 10 }, "bottom", 4)).toEqual({ y: 52, h: 14 });
  });

  it("la esquina de un texto cambia la letra en proporción", () => {
    expect(resizeFont(40, 1.5)).toBe(60);
    expect(resizeFont(5, 0.1)).toBe(4);
  });

  it("la esquina de una imagen mantiene la proporción", () => {
    const b = scaleBox({ x: 50, y: 50, w: 20, h: 10 }, 2);
    expect(b.w / b.h).toBeCloseTo(2, 5);
  });

  it("rotar con Shift va de a 15°", () => {
    expect(rotate(37, true)).toBe(30);
    expect(rotate(38, true)).toBe(45);
    expect(rotate(190)).toBe(-170);
    expect(rotate(-180)).toBe(180);
  });

  it("el ángulo del puntero: arriba 0, derecha 90", () => {
    expect(pointerAngle({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(0, 5);
    expect(pointerAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90, 5);
  });
});

describe("alinear, seleccionar y convertir", () => {
  it("alinea a los bordes y al centro de la página", () => {
    const [l] = alignSelection([{ x: 30, y: 30, w: 20, h: 10 }], "left");
    expect(l.x).toBe(10);
    const [b] = alignSelection([{ x: 30, y: 30, w: 20, h: 10 }], "bottom");
    expect(b.y).toBe(95);
    expect(alignSelection([{ x: 30, y: 30, w: 20, h: 10 }], "middle")[0].y).toBe(50);
  });

  it("detecta si dos cajas se tocan (selección con rectángulo)", () => {
    expect(intersects({ x: 10, y: 10, w: 10, h: 10 }, { x: 14, y: 14, w: 10, h: 10 })).toBe(true);
    expect(intersects({ x: 10, y: 10, w: 10, h: 10 }, { x: 30, y: 30, w: 10, h: 10 })).toBe(false);
  });

  it("pasa px de pantalla a % de la página", () => {
    expect(screenToPct({ dx: 54, dy: 0 }, page, 0.5).dx).toBeCloseTo(10, 5);
  });
});
