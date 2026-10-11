import { describe, it, expect } from "vitest";
import { countStrokes, hasSignature, canSign, toCanvasPoint } from "./signature-input";

describe("trazos", () => {
  it("un toque suelto (un punto) no cuenta; dos puntos sí", () => {
    expect(countStrokes([[{ x: 1, y: 1 }]])).toBe(0);
    expect(countStrokes([[{ x: 1, y: 1 }, { x: 2, y: 2 }]])).toBe(1);
  });
  it("cuenta cada trazo válido", () => {
    const stroke = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
    expect(countStrokes([stroke, [{ x: 9, y: 9 }], stroke, stroke])).toBe(3);
    expect(hasSignature([])).toBe(false);
    expect(hasSignature([stroke])).toBe(true);
  });
});

describe("canSign", () => {
  it("sin la casilla no se firma, pida lo que pida el contrato", () => {
    expect(canSign({ accepted: false, signatureRequired: false, drawn: true })).toBe(false);
  });
  it("con firma obligatoria hace falta dibujarla", () => {
    expect(canSign({ accepted: true, signatureRequired: true, drawn: false })).toBe(false);
    expect(canSign({ accepted: true, signatureRequired: true, drawn: true })).toBe(true);
  });
  it("con firma opcional alcanza la casilla", () => {
    expect(canSign({ accepted: true, signatureRequired: false, drawn: false })).toBe(true);
  });
});

describe("toCanvasPoint", () => {
  it("convierte del puntero al lienzo aunque CSS lo escale (390 px usables para un lienzo de 780)", () => {
    expect(toCanvasPoint({ x: 100, y: 50 }, { left: 10, top: 20, width: 390, height: 90 }, { width: 780, height: 180 })).toEqual({ x: 180, y: 60 });
  });
  it("con un rectángulo vacío no divide por cero", () => {
    expect(toCanvasPoint({ x: 3, y: 4 }, { left: 0, top: 0, width: 0, height: 0 }, { width: 780, height: 180 })).toEqual({ x: 3, y: 4 });
  });
});
