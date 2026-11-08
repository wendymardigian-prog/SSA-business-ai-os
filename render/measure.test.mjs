import test from "node:test";
import assert from "node:assert/strict";
import { averageLuminanceInBox, buildMeasuredElements, relativeLuminance, srgbChannelToLinear, TRANSPARENT_TEXT_CSS } from "./measure.mjs";

// Imagen de prueba: `width` x `height`, cada pixel lo da `paint(x, y) -> [r, g, b, a]`.
function image(width, height, paint) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

test("la luminancia del negro es 0 y la del blanco es 1", () => {
  assert.equal(relativeLuminance(0, 0, 0), 0);
  assert.ok(Math.abs(relativeLuminance(255, 255, 255) - 1) < 1e-12);
});

test("la luminancia sigue la formula WCAG (rojo, verde, azul y un gris)", () => {
  assert.ok(Math.abs(relativeLuminance(255, 0, 0) - 0.2126) < 1e-9);
  assert.ok(Math.abs(relativeLuminance(0, 255, 0) - 0.7152) < 1e-9);
  assert.ok(Math.abs(relativeLuminance(0, 0, 255) - 0.0722) < 1e-9);
  // gris 118 (#767676) = 0.1812 aprox., el clasico que da 4,5:1 sobre blanco
  assert.ok(Math.abs(relativeLuminance(118, 118, 118) - 0.1812) < 1e-3);
  assert.ok(Math.abs(srgbChannelToLinear(128) - 0.2159) < 1e-3);
});

test("el promedio en una caja de un fondo uniforme es la luminancia de ese color", () => {
  const negro = image(20, 20, () => [0, 0, 0]);
  const blanco = image(20, 20, () => [255, 255, 255]);
  assert.equal(averageLuminanceInBox(negro, { x: 2, y: 2, w: 10, h: 10 }), 0);
  assert.equal(averageLuminanceInBox(blanco, { x: 2, y: 2, w: 10, h: 10 }), 1);
});

test("el promedio en una caja mitad negra y mitad blanca da 0,5", () => {
  const mitad = image(10, 10, (x) => (x < 5 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(averageLuminanceInBox(mitad, { x: 0, y: 0, w: 10, h: 10 }), 0.5);
});

test("solo cuentan los pixeles de la caja, no los de afuera", () => {
  const img = image(20, 10, (x) => (x < 10 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(averageLuminanceInBox(img, { x: 0, y: 0, w: 10, h: 10 }), 0);
  assert.equal(averageLuminanceInBox(img, { x: 10, y: 0, w: 10, h: 10 }), 1);
});

test("una caja que se pasa de la imagen se recorta; una fuera o vacia da null", () => {
  const blanco = image(10, 10, () => [255, 255, 255]);
  assert.equal(averageLuminanceInBox(blanco, { x: 5, y: 5, w: 100, h: 100 }), 1);
  assert.equal(averageLuminanceInBox(blanco, { x: 50, y: 50, w: 10, h: 10 }), null);
  assert.equal(averageLuminanceInBox(blanco, { x: 2, y: 2, w: 0, h: 5 }), null);
});

test("con una captura mas grande que el diseno (2 px por px CSS) la caja se escala", () => {
  const img = image(40, 20, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(averageLuminanceInBox(img, { x: 0, y: 0, w: 10, h: 10 }, 2), 0);
  assert.equal(averageLuminanceInBox(img, { x: 10, y: 0, w: 10, h: 10 }, 2), 1);
});

test("un pixel transparente se compone sobre blanco", () => {
  const img = image(4, 4, () => [0, 0, 0, 0]);
  assert.equal(averageLuminanceInBox(img, { x: 0, y: 0, w: 4, h: 4 }), 1);
});

test("buildMeasuredElements mide el fondo solo de los textos y redondea las cajas", () => {
  const lum = image(100, 100, (x) => (x < 50 ? [0, 0, 0] : [255, 255, 255]));
  const raw = [
    { id: "titulo", type: "text", x: 0.04, y: 10.26, w: 40, h: 20, overflow: false },
    { id: "bajada", type: "text", x: 60, y: 10, w: 30, h: 20, overflow: true },
    { id: "foto", type: "image", x: 0, y: 0, w: 100, h: 100, overflow: false },
    { id: "sin-tipo", type: "", x: 0, y: 0, w: 10, h: 10, overflow: 0 },
  ];
  const out = buildMeasuredElements(raw, lum);
  assert.deepEqual(out[0], { id: "titulo", x: 0, y: 10.3, w: 40, h: 20, overflow: false, bgLuminance: 0 });
  assert.deepEqual(out[1], { id: "bajada", x: 60, y: 10, w: 30, h: 20, overflow: true, bgLuminance: 1 });
  assert.equal(out[2].bgLuminance, null);
  assert.equal(out[3].bgLuminance, null);
  assert.equal(out[3].overflow, false);
});

test("sin captura de fondo (por ejemplo sin textos) bgLuminance queda en null", () => {
  const out = buildMeasuredElements([{ id: "t", type: "text", x: 0, y: 0, w: 5, h: 5, overflow: false }], null);
  assert.equal(out[0].bgLuminance, null);
});

test("el estilo que deja el texto invisible apunta a los textos", () => {
  assert.match(TRANSPARENT_TEXT_CSS, /data-el-type="text"/);
  assert.match(TRANSPARENT_TEXT_CSS, /color:transparent!important/);
  assert.match(TRANSPARENT_TEXT_CSS, /text-shadow:none!important/);
});
