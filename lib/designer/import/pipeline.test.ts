import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { renderPageHTML } from "../render/page-html";
import { collectAssetPaths, pathBelongsTo } from "../storage";
import { buildImportedDoc } from "./build-doc";
import { sanitizeDocHtml } from "./edit";
import { IMPORT_BASE_CSS } from "./css";
import { isImportedPage } from "./imported-page";
import { listEditableTexts } from "./mark-text";
import { buildImportRecord, createAssetResolver, extractStyles, joinCss, resolveZipPath } from "./pipeline";
import { parseImportRecord } from "./record";
import { readUpload, type UploadedSite } from "./zip";

const WS = "11111111-2222-3333-4444-555555555555";
const UP = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6, 7, 8]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4, 5, 6, 7, 8]);

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const siteOf = (html: string, files: Record<string, Uint8Array> = {}, mainPath = ""): UploadedSite => ({ kind: Object.keys(files).length ? "zip" : "html", mainPath, html, files: new Map(Object.entries(files)) });
const build = (site: UploadedSite) => {
  const r = buildImportRecord({ site, fileName: "archivo.zip", workspaceId: WS, uploadId: UP });
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("buildImportRecord: de un archivo a un registro limpio", () => {
  it("la landing de muestra: sin scripts ni formulario, con su CSS y Google Fonts", () => {
    const { record } = build(siteOf(fixture("landing-clase.html")));
    expect(record.html).not.toMatch(/<script|<form|<title|window\.dataLayer/i);
    expect(record.html).toContain("Aprendé a ordenar tu negocio");
    expect(record.removed).toMatchObject({ scripts: 1, forms: 1 });
    expect(record.removed.summary).toBe("Se quitaron 1 script y 1 formulario: se mantiene el diseño.");
    expect(record.css.startsWith('@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap");')).toBe(true);
    expect(record.css).toContain(IMPORT_BASE_CSS);
    expect(record.css.indexOf(IMPORT_BASE_CSS)).toBeLessThan(record.css.indexOf(".hero{"));
    expect(record.css).toContain(".dz-import{--brand:#5b21b6;}");
    expect(record.css).toContain(".dz-import{margin:0;font-family:Inter, sans-serif;color:#111;}");
    expect(record.detected).toMatchObject({ as: "web", format: "web" });
    expect(parseImportRecord(record)).toEqual(record);
  });

  it("marca los textos para poder editarlos", () => {
    const { record } = build(siteOf(fixture("landing-clase.html")));
    const texts = listEditableTexts(record.html).map((t) => t.text);
    expect(texts).toContain("Aprendé a ordenar tu negocio");
    expect(texts).toContain("Quiero mi lugar");
    expect(texts).not.toContain("Clase gratuita · Academia Ejemplo");
  });

  it("un zip: sube solo lo que se usa, con sus rutas en asset:<ws>/imports/<id>/…", () => {
    const html = `<html><head><link rel="stylesheet" href="css/estilos.css"></head><body><img src="img/logo.png"><img src="img/logo.png"><img src="img/otro.gif"><img src="img/falta.png"><p>Hola</p></body></html>`;
    const css = `@font-face{font-family:Marca;src:url(../fonts/marca.woff2) format("woff2")} body{background:url(../img/fondo.png)} .x{background:url(../img/nunca-usada.png)}`;
    const { record, plan } = build(
      siteOf(html, { "sitio/index.html": strToU8(html), "sitio/css/estilos.css": strToU8(css), "sitio/img/logo.png": PNG, "sitio/img/fondo.png": PNG, "sitio/img/sobrante.png": PNG, "sitio/img/otro.gif": GIF, "sitio/fonts/marca.woff2": WOFF2 }, "sitio/index.html"),
    );
    const base = `${WS}/imports/${UP}`;
    expect(plan.map((p) => p.path).sort()).toEqual([`${base}/sitio__fonts__marca.woff2`, `${base}/sitio__img__fondo.png`, `${base}/sitio__img__logo.png`].sort());
    expect(plan.find((p) => p.kind === "font")?.mime).toBe("font/woff2");
    expect(record.html.match(new RegExp(`asset:${base}/sitio__img__logo.png`, "g"))).toHaveLength(2);
    expect(record.html).not.toContain("otro.gif");
    expect(record.css).toContain(`url("asset:${base}/sitio__fonts__marca.woff2")`);
    expect(record.css).toContain(`.dz-import{background:url("asset:${base}/sitio__img__fondo.png");}`);
    expect(record.assets).toEqual({ images: 2, fonts: 1, skipped: 3 });
    expect(record.removed.summary).toContain("3 archivos (imágenes o fuentes) no se pudieron guardar");
    // todas las rutas son de este negocio
    for (const p of plan) expect(pathBelongsTo(p.path, WS)).toBe(true);
  });

  it("dos archivos con el mismo nombre en carpetas distintas no se pisan", () => {
    const html = `<img src="a/logo.png"><img src="b/logo.png">`;
    const { plan } = build(siteOf(html, { "index.html": strToU8(html), "a/logo.png": PNG, "b/logo.png": PNG }, "index.html"));
    expect(new Set(plan.map((p) => p.path)).size).toBe(2);
  });

  it("una imagen en línea grande pasa a ser un archivo y una chica se queda", () => {
    const big = new Uint8Array(30_000);
    big.set(PNG);
    const bigUri = `data:image/png;base64,${Buffer.from(big).toString("base64")}`;
    const smallUri = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
    const { record, plan } = build(siteOf(`<p>x</p><img src="${bigUri}"><img src="${smallUri}">`));
    expect(plan).toHaveLength(1);
    expect(record.html).toContain(`asset:${WS}/imports/${UP}/imagen-1.png`);
    expect(record.html).toContain(smallUri);
    expect(record.html).not.toContain(bigUri);
  });

  it("una presentación se detecta y se parte en diapositivas", () => {
    const { record } = build(siteOf(fixture("presentacion-16-9-fija.html")));
    expect(record.detected).toMatchObject({ as: "slides", format: "wide", pages: 5 });
  });

  it("un archivo sin nada para mostrar (una app que arma todo con scripts) se rechaza con un motivo claro", () => {
    const r = buildImportRecord({ site: siteOf(`<html><body><div id="root"></div><script src="app.js"></script></body></html>`), fileName: "app.html", workspaceId: WS, uploadId: UP });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("no tiene contenido para mostrar") });
  });

  it("un @media print, un <style> suelto y un CSS externo enlazado también se juntan (o se cuentan si no están)", () => {
    const html = `<link rel="stylesheet" href="https://cdn.ejemplo.test/x.css"><style media="print">.a{display:none}</style><style>.b{color:red}</style><p class="b">x</p>`;
    const { record } = build(siteOf(html));
    expect(record.css).toContain("@media print{.a{display:none;}}");
    expect(record.css).toContain(".b{color:red;}");
    expect(record.removed.other).toBe(1);
  });

  it("el HTML guardado no contiene nada que el render deba quitar", () => {
    const evil = `<html><body><p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">b</a><div style="background:url(https://evil.example/x)">c</div></body></html>`;
    const { record } = build(siteOf(evil));
    expect(record.html).not.toMatch(/onclick|<script|javascript:|evil\.example/);
    expect(record.removed.scripts).toBe(1);
  });
});

describe("piezas del pipeline", () => {
  it("resolveZipPath resuelve rutas relativas y no deja salir de la raíz", () => {
    expect(resolveZipPath("sitio", "img/a.png")).toBe("sitio/img/a.png");
    expect(resolveZipPath("sitio/css", "../img/a.png?v=2#x")).toBe("sitio/img/a.png");
    expect(resolveZipPath("sitio", "/img/a.png")).toBe("img/a.png");
    expect(resolveZipPath("sitio", "./img//a%20b.png")).toBe("sitio/img/a b.png");
    expect(resolveZipPath("", "../afuera.png")).toBeNull();
    expect(resolveZipPath("a", "../../afuera.png")).toBeNull();
    expect(resolveZipPath("a", "https://x.test/a.png")).toBeNull();
    expect(resolveZipPath("a", "")).toBeNull();
    expect(resolveZipPath("a", "..\\x.png")).toBeNull();
  });

  it("el resolutor no inventa archivos y reconoce las mayúsculas distintas", () => {
    const r = createAssetResolver({ workspaceId: WS, uploadId: UP, files: new Map([["Img/Logo.PNG", PNG]]) });
    expect(r.ref("img/logo.png", "")).toBe(`asset:${WS}/imports/${UP}/Img__Logo.PNG`);
    expect(r.ref("img/nada.png", "")).toBeNull();
    expect(r.skipped()).toBe(1);
  });

  it("el resolutor valida los bytes, no la extensión", () => {
    const r = createAssetResolver({ workspaceId: WS, uploadId: UP, files: new Map([["a.png", strToU8("no soy una imagen, aunque me llame png")]]) });
    expect(r.ref("a.png", "")).toBeNull();
    expect(r.plan()).toHaveLength(0);
  });

  it("extractStyles saca <style> y <link> del HTML", () => {
    const out = extractStyles(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><style>.a{color:red}</style><p>x</p>`, new Map(), "");
    expect(out.html).toBe("<p>x</p>");
    expect(out.blocks).toEqual([{ css: ".a{color:red}", baseDir: "" }]);
    expect(out.googleLinks).toEqual(["https://fonts.googleapis.com/css2?family=Inter"]);
  });

  it("joinCss pone los @import primero y no los repite", () => {
    const gf = "https://fonts.googleapis.com/css2?family=Inter";
    const out = joinCss([`.a{color:red;}`, `@import url("${gf}");\n.b{color:blue;}`], [gf]);
    expect(out).toBe(`@import url("${gf}");\n${IMPORT_BASE_CSS}\n.a{color:red;}\n.b{color:blue;}`);
  });
});

describe("buildImportedDoc: del registro al documento", () => {
  const web = build(siteOf(fixture("landing-servicios.html"))).record;
  const deck = build(siteOf(fixture("presentacion-16-9-fija.html"))).record;
  const deck720 = build(siteOf(fixture("presentacion-16-9-pagina.html"))).record;
  const carousel = build(siteOf(fixture("carrusel-4-5.html"))).record;

  it("página web: una sola página con un elemento html que ocupa toda la página", () => {
    const r = buildImportedDoc(web, "web", "design");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.format).toBe("web");
    expect(r.doc.pages).toHaveLength(1);
    const el = r.doc.pages[0].elements[0];
    expect(isImportedPage(el)).toBe(true);
    expect(el).toMatchObject({ type: "html", name: "Página cargada (HTML)", x: 50, y: 50, w: 100, h: 100 });
    expect(r.doc.pages[0].height).toBeGreaterThanOrEqual(2000);
    expect((el as { html: string }).html.startsWith('<div class="dz-import">')).toBe(true);
  });

  it("presentación: una página por diapositiva, en el formato detectado", () => {
    const r = buildImportedDoc(deck, "slides", "design");
    expect(r.ok && r.format).toBe("wide");
    if (!r.ok) return;
    expect(r.doc.pages).toHaveLength(5);
    expect(r.doc.pages.every((p) => p.elements.length === 1 && isImportedPage(p.elements[0]))).toBe(true);
    expect((r.doc.pages[0].elements[0] as { html: string }).html).toContain("Plan del trimestre");
    expect((r.doc.pages[1].elements[0] as { html: string }).html).toContain("El problema");
  });

  it("si el archivo declara 1280 × 720, la diapositiva se escala al formato de 1920", () => {
    const r = buildImportedDoc(deck720, "slides", "design");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.format).toBe("wide");
    expect((r.doc.pages[0].elements[0] as { html: string }).html).toContain("width:1280px;height:720px;transform:scale(1.5);transform-origin:0 0");
  });

  it("el carrusel de 4:5 va en v45 con 6 páginas, sin escalar", () => {
    const r = buildImportedDoc(carousel, "slides", "design");
    expect(r.ok && r.format).toBe("v45");
    if (!r.ok) return;
    expect(r.doc.pages).toHaveLength(6);
    expect((r.doc.pages[0].elements[0] as { html: string }).html).toContain('style="width:100%;height:100%"');
  });

  it("la persona puede corregir lo detectado: una web como presentación (cada sección es una diapositiva)", () => {
    const r = buildImportedDoc(web, "slides", "design");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.format).toBe("wide");
      expect(r.doc.pages.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("y una presentación como página web", () => {
    const r = buildImportedDoc(deck, "web", "design");
    expect(r.ok && r.format).toBe("web");
    if (r.ok) expect(r.doc.pages).toHaveLength(1);
  });

  it("una plantilla no puede ser una página web", () => {
    expect(buildImportedDoc(web, "web", "template")).toEqual({ ok: false, error: expect.stringContaining("plantilla no puede ser una página web") });
    expect(buildImportedDoc(deck, "slides", "template").ok).toBe(true);
  });

  it("más de 20 diapositivas se rechaza con un motivo claro", () => {
    const css = ".slide{width:1920px;height:1080px}";
    const html = Array.from({ length: 21 }, (_, i) => `<div class="slide"><h1>${i}</h1></div>`).join("");
    const { record } = build(siteOf(`<style>${css}</style>${html}`));
    expect(buildImportedDoc(record, "slides", "design")).toEqual({ ok: false, error: expect.stringContaining("21 diapositivas") });
  });

  it("el render de la página cargada nunca tiene un <script> y reemplaza asset: por el link firmado", () => {
    const html = `<p>Hola</p><img src="img/logo.png"><script>alert(1)</script>`;
    const { record } = build(siteOf(html, { "index.html": strToU8(html), "img/logo.png": PNG }, "index.html"));
    const built = buildImportedDoc(record, "web", "design");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const paths = collectAssetPaths(built.doc);
    expect(paths).toEqual([`${WS}/imports/${UP}/img__logo.png`]);
    const page = renderPageHTML(built.doc, 0, { mode: "public", assetUrl: (p) => `https://firmado.test/${p}?token=1` });
    expect(page).not.toMatch(/<script|asset:/i);
    expect(page).toContain(`https://firmado.test/${WS}/imports/${UP}/img__logo.png?token=1`);
  });

  it("zip real de punta a punta: readUpload → buildImportRecord → buildImportedDoc", () => {
    const html = fixture("landing-servicios.html");
    const bytes = zipSync({ "sitio/index.html": strToU8(html), "sitio/img/a.png": PNG });
    const read = readUpload(bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const { record } = build(read.site);
    expect(buildImportedDoc(record, record.detected.as, "design").ok).toBe(true);
  });

  it.each(["landing-clase.html", "landing-servicios.html", "presentacion-16-9-fija.html", "presentacion-16-9-pagina.html", "carrusel-4-5.html", "ambiguo.html"])(
    "lo que se arma de %s ya está limpio: volver a limpiarlo al guardar no cambia nada",
    (name) => {
      const { record } = build(siteOf(fixture(name)));
      for (const as of ["web", "slides"] as const) {
        const built = buildImportedDoc(record, as, "design");
        expect(built.ok).toBe(true);
        if (!built.ok) continue;
        const again = sanitizeDocHtml(built.doc, WS);
        expect(again.changed).toBe(false);
        expect(again.doc).toEqual(built.doc);
      }
    },
  );
});
