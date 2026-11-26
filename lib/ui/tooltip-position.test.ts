import { describe, expect, it } from "vitest";
import { placeTip, placeTooltip } from "./tooltip-position";

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

describe("placeTip", () => {
  const viewport = { width: 1000, height: 800 };
  const panel = { width: 120, height: 30 };
  const anchor = { left: 400, top: 300, right: 440, bottom: 320 };

  it("arriba y centrado por defecto", () => {
    expect(placeTip({ anchor, viewport, panel })).toEqual({ left: 360, top: 262, side: "top" });
  });

  it("abajo si se pide abajo", () => {
    expect(placeTip({ anchor, viewport, panel, side: "bottom" })).toEqual({ left: 360, top: 328, side: "bottom" });
  });

  it("arriba sin lugar: va abajo", () => {
    expect(placeTip({ anchor: { left: 400, top: 10, right: 440, bottom: 30 }, viewport, panel }).side).toBe("bottom");
  });

  it("abajo sin lugar: va arriba", () => {
    expect(placeTip({ anchor: { left: 400, top: 770, right: 440, bottom: 790 }, viewport, panel, side: "bottom" }).side).toBe("top");
  });

  it("nunca se sale por los costados", () => {
    expect(placeTip({ anchor: { left: 0, top: 300, right: 20, bottom: 320 }, viewport, panel }).left).toBe(8);
    expect(placeTip({ anchor: { left: 980, top: 300, right: 1000, bottom: 320 }, viewport, panel }).left).toBe(1000 - 8 - 120);
  });

  it("align start: alineado al borde izquierdo del disparador", () => {
    expect(placeTip({ anchor, viewport, panel, align: "start" }).left).toBe(400);
  });

  it("al costado, centrado en el alto (el menu lateral plegado)", () => {
    expect(placeTip({ anchor: { left: 0, top: 100, right: 48, bottom: 140 }, viewport, panel, side: "right" })).toEqual({ left: 56, top: 105, side: "right" });
  });

  it("al costado sin lugar a la derecha: a la izquierda", () => {
    expect(placeTip({ anchor: { left: 900, top: 100, right: 990, bottom: 140 }, viewport, panel, side: "right" })).toEqual({ left: 772, top: 105, side: "left" });
  });

  it("un panel mas ancho que la pantalla queda pegado al margen izquierdo", () => {
    expect(placeTip({ anchor, viewport: { width: 100, height: 800 }, panel: { width: 300, height: 30 } }).left).toBe(8);
  });
});
