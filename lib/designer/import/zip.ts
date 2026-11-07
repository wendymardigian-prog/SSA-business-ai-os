/**
 * Leer lo que sube la persona (F39): un `.html` suelto (hasta 5 MB) o un `.zip` (hasta 50 MB) con un
 * `.html` y sus imágenes, fuentes y CSS.
 *
 * El zip se lee primero SIN descomprimir (su directorio central) y se rechaza entero si:
 *   - alguna ruta tiene `..`, es absoluta, tiene `\`, un carácter de control o un disco (`C:`);
 *   - alguna entrada es un enlace simbólico (atributos externos del zip);
 *   - tiene más de 300 archivos o pesa más de 50 MB descomprimido;
 *   - está cifrado, usa zip64 o un método de compresión raro;
 *   - repite una ruta.
 * Recién ahí se descomprime con `fflate`, y se comprueba que cada archivo pese lo que dijo su cabecera.
 *
 * Los archivos se validan por sus BYTES (`PK\\x03\\x04` para el zip, texto para el HTML), nunca por
 * la extensión. Módulo puro (sin red, sin base).
 */

import { unzipSync } from "fflate";

export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_FILES = 300;
export const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
/** Un zip con más entradas que esto (contando carpetas) se rechaza sin listarlo entero. */
const MAX_ZIP_ENTRIES = 1000;

export interface ZipEntry {
  name: string;
  size: number;
  isDir: boolean;
}

export type ZipListResult = { ok: true; entries: ZipEntry[] } | { ok: false; error: string };

/** Los primeros bytes de un zip con archivos (`PK\x03\x04`). */
export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Por qué una ruta de un zip no se admite (o `null` si está bien). */
export function badEntryName(name: string): string | null {
  if (name === "" || name.length > 300) return "tiene una ruta vacía o demasiado larga";
  if (name.includes("\\")) return "tiene rutas con «\\»";
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return "tiene rutas absolutas";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "tiene rutas con caracteres raros";
  if (name.split("/").some((part) => part === "..")) return "tiene rutas con «..»";
  return null;
}

/** Lee el directorio central del zip sin descomprimir nada. */
export function listZipEntries(bytes: Uint8Array): ZipListResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return fail("El zip está dañado o no es un zip.");
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return fail("Ese tipo de zip (zip64) no se puede leer. Comprimilo de nuevo.");
  if (total > MAX_ZIP_ENTRIES) return fail(`El zip tiene más de ${MAX_ZIP_FILES} archivos.`);
  if (cdOffset + cdSize > bytes.length) return fail("El zip está dañado.");

  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder("utf-8");
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) return fail("El zip está dañado.");
    const madeBy = view.getUint16(p + 4, true);
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const external = view.getUint32(p + 38, true);
    const localOffset = view.getUint32(p + 42, true);
    if (p + 46 + nameLen > bytes.length) return fail("El zip está dañado.");
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    const bad = badEntryName(name);
    if (bad) return fail(`El zip ${bad}: no se puede cargar.`);
    if (flags & 0x1) return fail("El zip tiene contraseña: sacásela y probá de nuevo.");
    if (method !== 0 && method !== 8) return fail("El zip usa una compresión que no se puede leer. Comprimilo de nuevo.");
    const host = madeBy >> 8;
    const mode = external >>> 16;
    if ((host === 3 || host === 19) && (mode & 0o170000) === 0o120000) return fail("El zip tiene enlaces simbólicos: no se puede cargar.");
    // La cabecera local tiene que decir lo mismo que el directorio central (si no usa descriptor de datos).
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) return fail("El zip está dañado.");
    const localFlags = view.getUint16(localOffset + 6, true);
    if (!(localFlags & 0x8) && view.getUint32(localOffset + 22, true) !== size) return fail("El zip está dañado: un archivo no pesa lo que dice.");
    entries.push({ name, size, isDir: name.endsWith("/") });
  }

  const files = entries.filter((e) => !e.isDir);
  if (files.length > MAX_ZIP_FILES) return fail(`El zip tiene más de ${MAX_ZIP_FILES} archivos.`);
  if (new Set(entries.map((e) => e.name)).size !== entries.length) return fail("El zip tiene rutas repetidas.");
  const unzipped = files.reduce((sum, e) => sum + e.size, 0);
  if (unzipped > MAX_UNZIPPED_BYTES) return fail("El zip pesa más de 50 MB descomprimido.");
  return { ok: true, entries };
}

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\._[^/]*$)/;

/** El `.html` principal de un zip: `index.html` primero, el más cercano a la raíz y, después, el más grande. */
export function pickMainHtml(files: readonly { path: string; size: number }[]): string | null {
  const html = files.filter((f) => /\.html?$/i.test(f.path) && !JUNK.test(f.path));
  if (html.length === 0) return null;
  const rank = (f: { path: string; size: number }) => [/(^|\/)index\.html?$/i.test(f.path) ? 0 : 1, f.path.split("/").length, -f.size, f.path] as const;
  html.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] < rb[i]) return -1;
      if (ra[i] > rb[i]) return 1;
    }
    return 0;
  });
  return html[0].path;
}

export interface UploadedSite {
  kind: "html" | "zip";
  /** La ruta del `.html` principal dentro del zip (`""` si se subió un `.html` suelto). */
  mainPath: string;
  html: string;
  /** Los demás archivos del zip, por ruta (vacío con un `.html` suelto). */
  files: Map<string, Uint8Array>;
}

export type ReadUploadResult = { ok: true; site: UploadedSite } | { ok: false; error: string };

/** Pasa los bytes de un HTML a texto: UTF-8, o el de su `<meta charset>` si es latino. */
export function decodeHtmlBytes(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const charset = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  const label = charset && /^(iso-8859-1|latin1|windows-1252|cp1252)$/.test(charset) ? "windows-1252" : "utf-8";
  try {
    return new TextDecoder(label).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  }
}

const HTML_HINT = /<\s*(?:!doctype|html|head|body|div|section|main|header|article|p|h[1-6]|style|svg|img|span|a|ul|table)\b/i;

/** Si un texto parece HTML. */
export function looksLikeHtml(text: string): boolean {
  return HTML_HINT.test(text);
}

/**
 * Lee lo que se subió: un zip (por sus bytes) o un HTML. Rechaza lo que no entra en los topes o no es lo que dice.
 * `size` del archivo ya se validó antes de leerlo en memoria; acá se vuelve a comprobar con los bytes reales.
 */
export function readUpload(bytes: Uint8Array): ReadUploadResult {
  if (bytes.length === 0) return fail("El archivo está vacío.");
  if (isZipBytes(bytes)) {
    if (bytes.length > MAX_ZIP_BYTES) return fail("El zip pesa más de 50 MB.");
    const listed = listZipEntries(bytes);
    if (!listed.ok) return listed;
    const files = listed.entries.filter((e) => !e.isDir);
    const main = pickMainHtml(files.map((e) => ({ path: e.name, size: e.size })));
    if (!main) return fail("El zip no tiene ningún archivo .html.");
    const wanted = new Set(files.filter((e) => !JUNK.test(e.name)).map((e) => e.name));
    const sizes = new Map(files.map((e) => [e.name, e.size]));
    let unzipped: Record<string, Uint8Array>;
    try {
      unzipped = unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
    } catch {
      return fail("El zip está dañado: no se pudo descomprimir.");
    }
    const map = new Map<string, Uint8Array>();
    for (const [name, data] of Object.entries(unzipped)) {
      if (data.length !== sizes.get(name)) return fail("El zip está dañado: un archivo no pesa lo que dice.");
      map.set(name, data);
    }
    const mainBytes = map.get(main);
    if (!mainBytes) return fail("El zip está dañado: no se pudo leer el .html.");
    if (mainBytes.length > MAX_HTML_BYTES) return fail("El .html del zip pesa más de 5 MB.");
    const html = decodeHtmlBytes(mainBytes);
    if (!looksLikeHtml(html)) return fail("El .html del zip no parece una página web.");
    map.delete(main);
    return { ok: true, site: { kind: "zip", mainPath: main, html, files: map } };
  }
  if (bytes.length > MAX_HTML_BYTES) return fail("El .html pesa más de 5 MB. Si tiene imágenes, subilo en un .zip.");
  if (bytes.subarray(0, 4096).includes(0)) return fail("El archivo no es un HTML ni un zip.");
  const html = decodeHtmlBytes(bytes);
  if (!looksLikeHtml(html)) return fail("El archivo no parece una página web (.html).");
  return { ok: true, site: { kind: "html", mainPath: "", html, files: new Map() } };
}
