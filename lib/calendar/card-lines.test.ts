import { describe, expect, it } from "vitest";
import { clampStyle, linesThatFit } from "./card-lines";

describe("líneas que entran en un bloque", () => {
  it("un bloque bajo queda en una línea", () => {
    expect(linesThatFit(26)).toBe(1);
    expect(linesThatFit(0)).toBe(1);
  });
  it("uno de una hora (44 px) entra en dos; uno de dos horas, en cinco", () => {
    expect(linesThatFit(44)).toBe(2);
    expect(linesThatFit(88)).toBe(5);
  });
  it("lo que se reserva (la fila del estado) se descuenta", () => {
    expect(linesThatFit(88, { reservedPx: 16 })).toBe(4);
  });
  it("el estilo nunca pide menos de una línea", () => {
    expect(clampStyle(0).WebkitLineClamp).toBe(1);
  });
});
