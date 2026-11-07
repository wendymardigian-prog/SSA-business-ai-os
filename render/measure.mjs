// Medicion de un diseno ya renderizado (para la revision automatica, F36).
//
// Todo lo que calcula es PURO (sin navegador, sin red) y se prueba en
// `measure.test.mjs`. Este archivo no importa nada de terceros de forma
// estatica: el decodificador de PNG (`pngjs`) se carga recien cuando hace falta,
// asi los tests corren sin dependencias instaladas.

// Estilo que se inyecta para sacar una captura "sin letras": con el texto
// transparente, lo que queda detras de cada caja de texto es el fondo real
// (color, degradado, foto, capa de color). Sobre esa captura se mide la luminancia.
export const TRANSPARENT_TEXT_CSS =
  '[data-el-type="text"],[data-el-type="text"] *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important}';

// Convierte un canal sRGB 0-255 a lineal 0-1 (formula WCAG).
export function srgbChannelToLinear(c8) {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const LINEAR_LUT = (() => {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i += 1) lut[i] = srgbChannelToLinear(i);
  return lut;
})();

// Luminancia relativa WCAG de un pixel (0 = negro, 1 = blanco).
export function relativeLuminance(r, g, b) {
  return 0.2126 * LINEAR_LUT[clampByte(r)] + 0.7152 * LINEAR_LUT[clampByte(g)] + 0.0722 * LINEAR_LUT[clampByte(b)];
}

function clampByte(v) {
  if (!(v > 0)) return 0;
  if (v > 255) return 255;
  return Math.round(v);
}

// Promedio de la luminancia de los pixeles dentro de `box` ({x, y, w, h} en
// pixeles CSS). `img` es `{ width, height, data }` con `data` RGBA de 8 bits
// (lo que devuelve pngjs). `pxPerCss` es cuantos pixeles de la imagen hay por
// pixel CSS (1 si la captura se saco con `scale: "css"`). Un pixel con
// transparencia se compone sobre blanco. Devuelve null si la caja queda
// vacia o fuera de la imagen. Redondea a 4 decimales.
export function averageLuminanceInBox(img, box, pxPerCss = 1) {
  const { width, height, data } = img;
  const x0 = Math.max(0, Math.floor(box.x * pxPerCss));
  const y0 = Math.max(0, Math.floor(box.y * pxPerCss));
  const x1 = Math.min(width, Math.ceil((box.x + box.w) * pxPerCss));
  const y1 = Math.min(height, Math.ceil((box.y + box.h) * pxPerCss));
  if (!(x1 > x0) || !(y1 > y0)) return null;
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    let i = (y * width + x0) * 4;
    for (let x = x0; x < x1; x += 1) {
      const a = data[i + 3] / 255;
      const r = data[i] * a + 255 * (1 - a);
      const g = data[i + 1] * a + 255 * (1 - a);
      const b = data[i + 2] * a + 255 * (1 - a);
      sum += relativeLuminance(r, g, b);
      count += 1;
      i += 4;
    }
  }
  return Math.round((sum / count) * 10000) / 10000;
}

// Decodifica un PNG a `{ width, height, data }` (RGBA). Carga `pngjs` al usarse.
export async function decodePng(buffer) {
  const { PNG } = await import("pngjs");
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

// Se ejecuta DENTRO de la pagina (`page.evaluate`). Tiene que ser autocontenida:
// Playwright la manda como texto. No usa temporizadores ni escuchadores (con
// JavaScript apagado no corren), solo lee el DOM.
export function collectElementsInPage() {
  const out = [];
  const nodes = document.querySelectorAll("[data-el]");
  for (const el of nodes) {
    const id = el.getAttribute("data-el");
    if (!id) continue;
    const r = el.getBoundingClientRect();
    out.push({
      id,
      type: el.getAttribute("data-el-type") || "",
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      w: r.width,
      h: r.height,
      overflow: el.scrollHeight > el.clientHeight + 1,
    });
  }
  return out;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Arma la lista final de elementos: caja redondeada, `overflow` y `bgLuminance`
// (solo para los de tipo "text"; null en los demas o si no se pudo medir).
// `lumImage` es la captura sin letras ya decodificada (o null si no hizo falta).
export function buildMeasuredElements(rawElements, lumImage, pxPerCss = 1) {
  return rawElements.map((el) => {
    let bgLuminance = null;
    if (el.type === "text" && lumImage) {
      bgLuminance = averageLuminanceInBox(lumImage, el, pxPerCss);
    }
    return {
      id: el.id,
      x: round1(el.x),
      y: round1(el.y),
      w: round1(el.w),
      h: round1(el.h),
      overflow: Boolean(el.overflow),
      bgLuminance,
    };
  });
}
