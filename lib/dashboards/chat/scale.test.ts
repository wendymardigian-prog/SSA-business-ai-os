import { describe, expect, it } from "vitest";
import { axisTicks, axisTop, labelEvery, niceStep } from "./scale";

describe("niceStep", () => {
  it("elige escalones redondos en cada decada", () => {
    expect(niceStep(4)).toBe(1);
    expect(niceStep(8)).toBe(2);
    expect(niceStep(9)).toBe(5);
    expect(niceStep(18)).toBe(5);
    expect(niceStep(40)).toBe(10);
    expect(niceStep(400)).toBe(100);
  });

  it("con maximo 0 no divide por cero ni devuelve 0", () => {
    expect(niceStep(0)).toBeGreaterThan(0);
  });
});

describe("axisTop", () => {
  it("cubre el maximo con un multiplo del escalon", () => {
    expect(axisTop(37, 10)).toBe(40);
    expect(axisTop(40, 10)).toBe(40);
  });
  it("con escalon invalido no se cuelga", () => {
    expect(axisTop(5, 0)).toBe(5);
  });
});

describe("axisTicks", () => {
  it("arranca en 0 y termina en el tope", () => {
    expect(axisTicks(40, 10)).toEqual([0, 10, 20, 30, 40]);
  });
  it("no se pasa por el error de coma flotante", () => {
    expect(axisTicks(1, 0.2)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});

describe("labelEvery", () => {
  it("con pocos dias escribe todos", () => {
    expect(labelEvery(7)).toBe(1);
  });
  it("con 90 dias escribe uno cada diez", () => {
    expect(labelEvery(90)).toBe(10);
  });
  it("nunca devuelve 0 (seria un bucle infinito)", () => {
    expect(labelEvery(0)).toBe(1);
  });
});
