import { strToU8, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";
import { badEntryName, decodeHtmlBytes, isZipBytes, listZipEntries, looksLikeHtml, MAX_HTML_BYTES, MAX_ZIP_FILES, pickMainHtml, readUpload } from "./zip";

const HTML = "<!doctype html><html><body><h1>Hola</h1></body></html>";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

const zip = (files: Zippable) => zipSync(files, { level: 1 });

/** Cambia un campo de la cabecera del directorio central de la primera entrada (para armar zips raros). */
function patchCentral(bytes: Uint8Array, patch: (view: DataView, at: number) => void): Uint8Array {
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer);
  for (let i = 0; i < copy.length - 4; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      patch(view, i);
      return copy;
    }
  }
  throw new Error("no encontré el directorio central");
}

describe("F39: zip.ts, lo que se rechaza", () => {
  it("un zip con ../evil.html se rechaza", () => {
    const r = readUpload(zip({ "index.html": strToU8(HTML), "../evil.html": strToU8(HTML) }));
    expect(r).toEqual({ ok: false, error: expect.stringContaining("«..»") });
  });

  it("un zip con 301 archivos se rechaza (y con 300 entra)", () => {
    const many = (n: number) => {
      const files: Zippable = { "index.html": strToU8(HTML) };
      for (let i = 1; i < n; i++) files[`img/f${i}.png`] = PNG;
      return zip(files);
    };
    expect(readUpload(many(MAX_ZIP_FILES + 1))).toEqual({ ok: false, error: expect.stringContaining("300 archivos") });
    expect(readUpload(many(MAX_ZIP_FILES)).ok).toBe(true);
  });

  it.each([
    ["una ruta absoluta", "/etc/index.html"],
    ["una ruta con barra invertida", "carpeta\\index.html"],
    ["una ruta con disco", "C:/index.html"],
    ["un «..» en el medio", "a/../../index.html"],
    ["un carácter de control", "a\u0001b.html"],
  ])("%s se rechaza", (_name, name) => {
    const r = readUpload(zip({ [name]: strToU8(HTML) }));
    expect(r.ok).toBe(false);
  });

  it("un enlace simbólico se rechaza", () => {
    const link = [strToU8("/etc/passwd"), { os: 3, attrs: (0o120777 << 16) >>> 0 }] as unknown as Zippable[string];
    const r = readUpload(zip({ "index.html": strToU8(HTML), enlace: link }));
    expect(r).toEqual({ ok: false, error: expect.stringContaining("enlaces simbólicos") });
  });

  it("un archivo normal con permisos de Unix no es un enlace", () => {
    const file = [strToU8("x"), { os: 3, attrs: (0o100644 << 16) >>> 0 }] as unknown as Zippable[string];
    expect(readUpload(zip({ "index.html": strToU8(HTML), "a.txt": file })).ok).toBe(true);
  });

  it("un zip que pesa más de 50 MB descomprimido se rechaza", () => {
    const big = new Uint8Array(51 * 1024 * 1024);
    const r = readUpload(zip({ "index.html": strToU8(HTML), "relleno.bin": big }));
    expect(r).toEqual({ ok: false, error: expect.stringContaining("50 MB") });
  });

  it("un zip cifrado se rechaza", () => {
    const base = zip({ "index.html": strToU8(HTML) });
    const encrypted = patchCentral(base, (view, at) => view.setUint16(at + 8, view.getUint16(at + 8, true) | 1, true));
    expect(readUpload(encrypted)).toEqual({ ok: false, error: expect.stringContaining("contraseña") });
  });

  it("un zip con una compresión rara se rechaza", () => {
    const odd = patchCentral(zip({ "index.html": strToU8(HTML) }), (view, at) => view.setUint16(at + 10, 14, true));
    expect(readUpload(odd).ok).toBe(false);
  });

  it("un archivo que pesa más de lo que dice su cabecera se rechaza", () => {
    const base = zip({ "index.html": strToU8(HTML), "grande.txt": strToU8("a".repeat(5000)) });
    const lying = new Uint8Array(base);
    const view = new DataView(lying.buffer);
    let patched = false;
    for (let i = 0; i < lying.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        const nameLen = view.getUint16(i + 28, true);
        const name = new TextDecoder().decode(lying.subarray(i + 46, i + 46 + nameLen));
        if (name === "grande.txt") {
          view.setUint32(i + 24, 100, true); // dice que pesa 100 bytes
          patched = true;
        }
      }
    }
    expect(patched).toBe(true);
    expect(readUpload(lying).ok).toBe(false);
  });

  it("un zip sin ningún .html se rechaza", () => {
    expect(readUpload(zip({ "imagen.png": PNG }))).toEqual({ ok: false, error: "El zip no tiene ningún archivo .html." });
  });

  it("algo que empieza como un zip pero está roto se rechaza", () => {
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(readUpload(broken)).toEqual({ ok: false, error: expect.stringContaining("dañado") });
  });

  it("un zip con un directorio central que apunta afuera se rechaza sin colgarse", () => {
    const base = zip({ "index.html": strToU8(HTML) });
    const bad = new Uint8Array(base);
    const view = new DataView(bad.buffer);
    for (let i = bad.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        view.setUint32(i + 16, 0x7fffff00, true);
        break;
      }
    }
    expect(readUpload(bad).ok).toBe(false);
  });
});

describe("F39: zip.ts, lo que entra", () => {
  it("lee un zip con su .html, imágenes y CSS", () => {
    const r = readUpload(zip({ "sitio/index.html": strToU8(HTML), "sitio/img/logo.png": PNG, "sitio/css/estilos.css": strToU8("a{color:red}") }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.site.kind).toBe("zip");
    expect(r.site.mainPath).toBe("sitio/index.html");
    expect(r.site.html).toBe(HTML);
    expect([...r.site.files.keys()].sort()).toEqual(["sitio/css/estilos.css", "sitio/img/logo.png"]);
    expect(r.site.files.get("sitio/img/logo.png")).toEqual(PNG);
  });

  it("ignora la basura de macOS", () => {
    const r = readUpload(zip({ "index.html": strToU8(HTML), "__MACOSX/._index.html": strToU8("x"), ".DS_Store": strToU8("x") }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.site.files.size).toBe(0);
  });

  it("un .html suelto se lee por sus bytes", () => {
    const r = readUpload(strToU8(HTML));
    expect(r).toEqual({ ok: true, site: { kind: "html", mainPath: "", html: HTML, files: new Map() } });
  });

  it("un .html de más de 5 MB se rechaza y uno justo en el tope entra", () => {
    const pad = (n: number) => strToU8(`<html><body>${"a".repeat(n)}</body></html>`);
    expect(readUpload(pad(MAX_HTML_BYTES)).ok).toBe(false);
    expect(readUpload(pad(MAX_HTML_BYTES - 100)).ok).toBe(true);
  });

  it("un archivo binario o que no es HTML se rechaza, aunque se llame .html", () => {
    expect(readUpload(PNG).ok).toBe(false);
    expect(readUpload(strToU8("esto es solo texto sin etiquetas")).ok).toBe(false);
    expect(readUpload(new Uint8Array(0))).toEqual({ ok: false, error: "El archivo está vacío." });
  });

  it("el .html principal del zip también tiene tope", () => {
    const huge = strToU8(`<html><body>${"a".repeat(MAX_HTML_BYTES)}</body></html>`);
    expect(readUpload(zip({ "index.html": huge })).ok).toBe(false);
  });
});

describe("piezas", () => {
  it("isZipBytes mira los bytes, no el nombre", () => {
    expect(isZipBytes(zip({ "a.html": strToU8(HTML) }))).toBe(true);
    expect(isZipBytes(strToU8(HTML))).toBe(false);
  });

  it("badEntryName", () => {
    expect(badEntryName("img/a.png")).toBeNull();
    expect(badEntryName("img/")).toBeNull();
    expect(badEntryName("a/./b")).toBeNull();
    expect(badEntryName("../x")).not.toBeNull();
    expect(badEntryName("/x")).not.toBeNull();
    expect(badEntryName("")).not.toBeNull();
  });

  it("listZipEntries cuenta archivos y carpetas", () => {
    const r = listZipEntries(zip({ "a/": new Uint8Array(0), "a/b.html": strToU8(HTML) }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries.map((e) => [e.name, e.isDir])).toEqual([["a/", true], ["a/b.html", false]]);
  });

  it("pickMainHtml: index.html primero, después el más cercano a la raíz y el más grande", () => {
    expect(pickMainHtml([{ path: "a/b/index.html", size: 1 }, { path: "otro.html", size: 99 }])).toBe("a/b/index.html");
    expect(pickMainHtml([{ path: "a/x.html", size: 1 }, { path: "y.html", size: 1 }])).toBe("y.html");
    expect(pickMainHtml([{ path: "x.html", size: 1 }, { path: "y.html", size: 5 }])).toBe("y.html");
    expect(pickMainHtml([{ path: "img/a.png", size: 1 }])).toBeNull();
  });

  it("decodeHtmlBytes lee latin-1 si el archivo lo dice", () => {
    const latin = new Uint8Array([...strToU8('<meta charset="iso-8859-1"><p>'), 0xe1, 0xe9]);
    expect(decodeHtmlBytes(latin)).toContain("áé");
    expect(decodeHtmlBytes(strToU8("<p>áé</p>"))).toBe("<p>áé</p>");
  });

  it("looksLikeHtml", () => {
    expect(looksLikeHtml("<div>x</div>")).toBe(true);
    expect(looksLikeHtml("hola")).toBe(false);
  });
});
