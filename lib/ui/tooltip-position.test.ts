import { describe, expect, it } from "vitest";
import { placeTooltip } from "./tooltip-position";

const viewport = { width: 1000, height: 800 };

describe("placeTooltip", () => {
  it("con lugar, se alinea con el icono y va abajo", () => {
    expect(placeTooltip({ anchor: { left: 100, top: 50, bottom: 70 }, viewport, width: 288, height: 120 })).toEqual({
      left: 100,
      top: 76,
      width: 288,
      above: false,
    });
  });

  it("cerca del borde derecho se corre a la izquierda lo justo (el caso de la ultima tarjeta)", () => {
    const placed = placeTooltip({ anchor: { left: 950, top: 50, bottom: 70 }, viewport, width: 288, height: 120 });
    expect(placed.left).toBe(1000 - 8 - 288);
    expect(placed.left + placed.width).toBeLessThanOrEqual(1000 - 8);
  });

  it("nunca se va por el borde izquierdo", () => {
    expect(placeTooltip({ anchor: { left: 2, top: 50, bottom: 70 }, viewport, width: 288, height: 120 }).left).toBe(8);
  });

  it("en un telefono mas angosto que el panel, el panel se achica", () => {
    const placed = placeTooltip({ anchor: { left: 300, top: 50, bottom: 70 }, viewport: { width: 280, height: 600 }, width: 288, height: 120 });
    expect(placed).toMatchObject({ left: 8, width: 264 });
  });

  it("si abajo no entra y arriba si, va arriba", () => {
    const placed = placeTooltip({ anchor: { left: 100, top: 700, bottom: 720 }, viewport, width: 288, height: 150 });
    expect(placed).toMatchObject({ above: true, top: 694 });
  });

  it("si no entra en ningun lado, queda abajo", () => {
    expect(placeTooltip({ anchor: { left: 100, top: 100, bottom: 120 }, viewport: { width: 1000, height: 200 }, width: 288, height: 300 }).above).toBe(false);
  });
});
