import { describe, expect, it } from "vitest";
import { normalizeUrl, shouldTrackPush, trickle, TRICKLE_CEILING } from "./nav-progress";

const here = "https://os.example.com/dashboard/tareas?vista=tareas";

describe("barra de carga: router.push", () => {
  it("arranca al cambiar de pantalla o de búsqueda", () => {
    expect(shouldTrackPush("/dashboard/clientes", here)).toBe(true);
    expect(shouldTrackPush("/dashboard/tareas?vista=tickets", here)).toBe(true);
    expect(shouldTrackPush("?vista=tickets", here)).toBe(true);
    expect(shouldTrackPush("https://os.example.com/dashboard/agenda", here)).toBe(true);
  });

  it("no arranca si la dirección no cambia, solo cambia el # o es otro sitio", () => {
    expect(shouldTrackPush("/dashboard/tareas?vista=tareas", here)).toBe(false);
    expect(shouldTrackPush("/dashboard/tareas?vista=tareas#fila-3", here)).toBe(false);
    expect(shouldTrackPush("#arriba", here)).toBe(false);
    expect(shouldTrackPush("https://otro.com/dashboard", here)).toBe(false);
    expect(shouldTrackPush("mailto:hola@example.com", here)).toBe(false);
    expect(shouldTrackPush("", here)).toBe(false);
  });

  it("el orden de los parámetros y la barra final no cuentan como cambio", () => {
    const cur = "https://os.example.com/dashboard/ventas?a=1&b=2";
    expect(shouldTrackPush("/dashboard/ventas/?b=2&a=1", cur)).toBe(false);
    expect(normalizeUrl(new URL("https://x.com/a/?b=2&a=1#h"))).toBe("/a?a=1&b=2");
  });
});

describe("barra de carga: avance", () => {
  it("avanza cada vez menos y nunca pasa del tope", () => {
    let p = 0;
    let lastStep = Infinity;
    for (let i = 0; i < 200; i++) {
      const next = trickle(p);
      expect(next).toBeGreaterThanOrEqual(p);
      expect(next).toBeLessThanOrEqual(TRICKLE_CEILING);
      expect(next - p).toBeLessThanOrEqual(lastStep + 1e-12);
      lastStep = next - p;
      p = next;
    }
    expect(p).toBeGreaterThan(0.85);
    expect(trickle(5)).toBe(TRICKLE_CEILING);
  });
});
