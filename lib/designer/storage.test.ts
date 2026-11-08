import { describe, expect, it, vi } from "vitest";
import { emptyDoc } from "./doc/schema";
import { checkImageUpload, collectAssetPaths, exportFolder, importAssetPath, pageFileName, pathBelongsTo, signAssetUrls } from "./storage";

const WS = "11111111-2222-3333-4444-555555555555";
const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(32).fill(0)]);

describe("archivos del Diseñador IA", () => {
  it("una imagen se valida por sus bytes, no por la extensión", () => {
    expect(checkImageUpload(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toMatchObject({ ok: true, mime: "image/png" });
    expect(checkImageUpload(bytes(0xff, 0xd8, 0xff))).toMatchObject({ ok: true, mime: "image/jpeg" });
  });

  it("un «.png» que no es PNG se rechaza", () => {
    expect(checkImageUpload(new TextEncoder().encode("esto no es una imagen, aunque se llame foto.png"))).toMatchObject({ ok: false });
  });

  it("un SVG se rechaza con «Usá PNG o JPG»", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(checkImageUpload(svg)).toEqual({ ok: false, error: expect.stringMatching(/^Usá PNG o JPG/) });
  });

  it("una imagen de más de 20 MB se rechaza", () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(checkImageUpload(big).ok).toBe(false);
  });

  it("una ruta es del workspace solo si su primer segmento lo es y no se sale", () => {
    expect(pathBelongsTo(`${WS}/images/a.png`, WS)).toBe(true);
    expect(pathBelongsTo(`99999999-2222-3333-4444-555555555555/images/a.png`, WS)).toBe(false);
    expect(pathBelongsTo(`${WS}/../otro/a.png`, WS)).toBe(false);
    expect(pathBelongsTo(`/${WS}/a.png`, WS)).toBe(false);
  });

  it("los nombres de archivo de un HTML cargado quedan limpios", () => {
    expect(importAssetPath(WS, "imp1", "../../mi foto (1).jpg")).toBe(`${WS}/imports/imp1/mi_foto_1_.jpg`);
  });

  it("rutas de los renders", () => {
    expect(pageFileName(0)).toBe("page-01.png");
    expect(exportFolder(WS, "d1", "20261107")).toBe(`${WS}/d1/exports/20261107`);
  });

  it("junta las rutas de imágenes, fondos, recursos del HTML y fuentes subidas", () => {
    const doc = emptyDoc("v45");
    doc.pages[0].background = { type: "image", image: { asset: `${WS}/images/fondo.jpg`, fit: "cover", focal: { x: 50, y: 50 }, locked: true } };
    doc.pages[0].elements.push(
      { id: "el_aaaa01", type: "image", x: 50, y: 50, w: 20, h: 20, asset: `${WS}/images/a.png`, fit: "cover" },
      { id: "el_aaaa02", type: "html", x: 50, y: 50, w: 100, h: 100, html: `<img src="asset:${WS}/imports/i/x.png">`, css: `.a{background:url(asset:${WS}/imports/i/y.jpg)}` },
    );
    expect(collectAssetPaths(doc, [{ family: "F", weight: 400, style: "normal", path: `${WS}/fonts/f.woff2`, format: "woff2" }]).sort()).toEqual(
      [`${WS}/fonts/f.woff2`, `${WS}/images/a.png`, `${WS}/images/fondo.jpg`, `${WS}/imports/i/x.png`, `${WS}/imports/i/y.jpg`].sort(),
    );
  });

  it("solo firma las rutas del workspace", async () => {
    const createSignedUrls = vi.fn(async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://s/${p}` })), error: null }));
    const db = { storage: { from: () => ({ createSignedUrls }) } };
    const map = await signAssetUrls(db as never, WS, [`${WS}/images/a.png`, "otro/images/b.png"]);
    expect(createSignedUrls).toHaveBeenCalledWith([`${WS}/images/a.png`], 600);
    expect([...map.keys()]).toEqual([`${WS}/images/a.png`]);
  });
});
