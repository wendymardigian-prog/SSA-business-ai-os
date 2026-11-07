// ssa-render: el servicio que convierte el HTML de un diseno (ya armado por SSA)
// en PNG o PDF con Chromium. Node puro, sin framework.
//
// Reglas que no se negocian (plano F5 y 9.2):
//  - SSA manda el HTML ya armado: este servicio NO tiene credenciales de Supabase
//    ni acceso a la base.
//  - Cada pedido va firmado (HMAC-SHA256 con marca de tiempo, ver `sign.mjs`) y la
//    firma se verifica ANTES de leer el JSON.
//  - Las paginas se abren SIN JavaScript (`javaScriptEnabled: false`) y con la red
//    restringida: solo salen pedidos a los hosts de `RENDER_ALLOWED_HOSTS`.
//  - Nunca se loguea el HTML ni el cuerpo (pueden tener datos personales).
//
// Lo que se comprobo con un Chromium real (Playwright 1.65.0) sobre el
// comportamiento con JavaScript apagado:
//  - `page.evaluate` SI funciona (corre por el protocolo de depuracion, no por la
//    pagina) y los `<script>` del documento NO corren.
//  - `waitUntil: "load"` de `setContent` ya espera las imagenes y las fuentes que
//    pide el CSS; despues se espera `document.fonts.ready` por las dudas.
//  - Los temporizadores y los escuchadores de eventos de la pagina NO corren: dentro
//    de `evaluate` no hay que usar `setTimeout` ni `addEventListener` (se cuelga).
import http from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { verifyRenderSignature } from "./sign.mjs";
import { TRANSPARENT_TEXT_CSS, buildMeasuredElements, collectElementsInPage, decodePng } from "./measure.mjs";

export const DEFAULT_ALLOWED_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
export const MAX_PAGES = 35;
export const MAX_QUEUE = 10;
const MAX_WIDTH = 4000;
const MAX_HEIGHT = 20000;
const ALLOWED_SCALES = [1, 2, 0.5];

// ---------- Red restringida ----------

// Lista de hosts a partir de un texto separado por comas.
export function parseAllowedHosts(text) {
  return String(text ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowed(host, allowedHosts) {
  for (const raw of allowedHosts) {
    const pattern = String(raw).trim().toLowerCase();
    if (!pattern) continue;
    if (pattern.startsWith("*.")) {
      // "*.dominio.com" deja pasar cualquier subdominio, no el dominio pelado.
      const suffix = pattern.slice(1);
      if (host.length > suffix.length && host.endsWith(suffix)) return true;
    } else if (host === pattern) {
      return true;
    }
  }
  return false;
}

// Decide si el navegador puede hacer un pedido. Deja pasar `data:` y `about:`, y
// pedidos https (puerto 443, sin usuario ni clave) a un host de la lista.
// Todo lo demas se aborta.
export function isAllowedRequest(url, allowedHosts) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "data:" || u.protocol === "about:") return true;
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  return hostAllowed(u.hostname.toLowerCase(), allowedHosts);
}

// ---------- Validacion del pedido ----------

function isInt(n, min, max) {
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
}

// Valida el cuerpo ya parseado. Devuelve `{ ok: true, value }` o `{ ok: false, detail }`.
export function parseRenderRequest(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, detail: "el cuerpo tiene que ser un objeto" };
  const hasHtml = raw.html !== undefined;
  const hasPages = raw.pages !== undefined;
  if (hasHtml === hasPages) return { ok: false, detail: "hay que mandar exactamente uno de `html` o `pages`" };

  let docs;
  if (hasHtml) {
    if (typeof raw.html !== "string" || raw.html === "") return { ok: false, detail: "`html` tiene que ser un texto no vacio" };
    docs = [raw.html];
  } else {
    if (!Array.isArray(raw.pages) || raw.pages.length === 0) return { ok: false, detail: "`pages` tiene que ser una lista no vacia" };
    if (raw.pages.length > MAX_PAGES) return { ok: false, detail: `\`pages\` admite hasta ${MAX_PAGES} paginas` };
    docs = [];
    for (const p of raw.pages) {
      if (p === null || typeof p !== "object" || typeof p.html !== "string" || p.html === "") {
        return { ok: false, detail: "cada pagina de `pages` necesita un `html` no vacio" };
      }
      docs.push(p.html);
    }
  }
  if (!isInt(raw.width, 1, MAX_WIDTH)) return { ok: false, detail: `\`width\` tiene que ser un entero entre 1 y ${MAX_WIDTH}` };
  if (!isInt(raw.height, 1, MAX_HEIGHT)) return { ok: false, detail: `\`height\` tiene que ser un entero entre 1 y ${MAX_HEIGHT}` };
  if (raw.format !== "png" && raw.format !== "pdf") return { ok: false, detail: "`format` tiene que ser \"png\" o \"pdf\"" };
  let scale = 1;
  if (raw.scale !== undefined) {
    if (!ALLOWED_SCALES.includes(raw.scale)) return { ok: false, detail: "`scale` tiene que ser 1, 2 o 0.5" };
    scale = raw.scale;
  }
  let measure = false;
  if (raw.measure !== undefined) {
    if (typeof raw.measure !== "boolean") return { ok: false, detail: "`measure` tiene que ser true o false" };
    measure = raw.measure;
  }
  if (measure && raw.format !== "png") return { ok: false, detail: "`measure` solo se puede pedir con format \"png\"" };
  return { ok: true, value: { docs, width: raw.width, height: raw.height, format: raw.format, scale, measure } };
}

// ---------- Concurrencia ----------

class BusyError extends Error {}
class TimeoutRenderError extends Error {}

// Como mucho `max` renders a la vez; los demas esperan en una cola de hasta
// `maxQueue`. Con la cola llena, `acquire` lanza BusyError.
function createLimiter(max, maxQueue) {
  let active = 0;
  const waiters = [];
  function makeRelease() {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = waiters.shift();
      if (next) next(); // el lugar pasa directo al que esperaba
      else active -= 1;
    };
  }
  return {
    async acquire() {
      if (active < max) {
        active += 1;
        return makeRelease();
      }
      if (waiters.length >= maxQueue) throw new BusyError();
      await new Promise((resolve) => waiters.push(resolve));
      return makeRelease();
    },
  };
}

// ---------- Navegador ----------

// Lanzador por defecto: Playwright se carga recien al primer pedido (asi los
// tests no necesitan tenerlo instalado). `--no-sandbox` porque en Railway el
// contenedor no admite el sandbox de Chromium (el aislamiento real son el
// JavaScript apagado y la red restringida); `--disable-dev-shm-usage` porque
// /dev/shm es chico en contenedores.
async function defaultLaunchBrowser() {
  const { chromium } = await import("playwright");
  return chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
}

async function defaultMergePdfs(buffers) {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const buffer of buffers) {
    const src = await PDFDocument.load(buffer);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return Buffer.from(await out.save());
}

// Espera a que las fuentes y las imagenes esten listas. Sin temporizadores ni
// escuchadores: con JavaScript apagado no corren (se comprobo que se cuelgan).
async function waitForAssets(page) {
  try {
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });
  } catch {
    // Respaldo: si `evaluate` no anduviera, se espera a que la red se aquiete.
    await page.waitForLoadState("networkidle");
  }
}

// Version del servicio (+ la de Playwright si se puede leer sin lanzar el navegador).
export function readServiceVersion() {
  let service = "0.0.0";
  try {
    service = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
  } catch {
    // sin package.json legible, queda el valor por defecto
  }
  try {
    const playwright = createRequire(import.meta.url)("playwright/package.json").version;
    if (playwright) return `${service}+playwright.${playwright}`;
  } catch {
    // Playwright no instalado (tests) o sin package.json exportado
  }
  return service;
}

// ---------- Servidor ----------

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;
    const done = (result) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };
    req.on("data", (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        done({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => done({ body: Buffer.concat(chunks) }));
    req.on("error", (err) => {
      if (finished) return;
      finished = true;
      reject(err);
    });
  });
}

export function createRenderServer({
  secret,
  allowedHosts = DEFAULT_ALLOWED_HOSTS,
  launchBrowser = defaultLaunchBrowser,
  // Devuelve la hora en milisegundos (como Date.now); se inyecta para los tests.
  now = () => Date.now(),
  maxConcurrency = 3,
  timeoutMs = 30000,
  maxBodyBytes = 15 * 1024 * 1024,
  version = readServiceVersion(),
  // Extras inyectables (los tests los reemplazan).
  mergePdfs = defaultMergePdfs,
  decodeImage = decodePng,
  log = (entry) => console.log(JSON.stringify(entry)),
} = {}) {
  if (typeof secret !== "string" || secret === "") {
    throw new Error("createRenderServer: falta `secret` (RENDER_SERVICE_SECRET)");
  }
  const limiter = createLimiter(maxConcurrency, MAX_QUEUE);

  // Un solo navegador para todos los pedidos: se lanza al primero y, si se cae,
  // se vuelve a lanzar.
  let browserPromise = null;
  function getBrowser() {
    if (!browserPromise) {
      const promise = (async () => {
        const browser = await launchBrowser();
        if (browser && typeof browser.on === "function") {
          browser.on("disconnected", () => {
            if (browserPromise === promise) browserPromise = null;
          });
        }
        return browser;
      })();
      promise.catch(() => {
        if (browserPromise === promise) browserPromise = null;
      });
      browserPromise = promise;
    }
    return browserPromise;
  }

  async function renderDocuments(spec, holder) {
    const { docs, width, height, format, scale, measure } = spec;
    const browser = await getBrowser();
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width, height },
      deviceScaleFactor: format === "pdf" ? 1 : scale,
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    holder.context = context;
    try {
      context.setDefaultTimeout(timeoutMs);
      await context.route("**/*", (route) => {
        if (isAllowedRequest(route.request().url(), allowedHosts)) return route.continue();
        return route.abort();
      });

      const clip = { x: 0, y: 0, width, height };
      const pngs = [];
      const pdfs = [];
      const measures = [];
      for (let index = 0; index < docs.length; index += 1) {
        const page = await context.newPage();
        try {
          // El navegador nunca navega a una URL: el HTML se carga como contenido.
          await page.setContent(docs[index], { waitUntil: "load" });
          await waitForAssets(page);
          if (format === "png") {
            pngs.push(await page.screenshot({ type: "png", clip }));
            if (measure) {
              const raw = await page.evaluate(collectElementsInPage);
              let lumImage = null;
              if (raw.some((el) => el.type === "text")) {
                try {
                  await page.evaluate((css) => {
                    const style = document.createElement("style");
                    style.textContent = css;
                    (document.head || document.documentElement).appendChild(style);
                  }, TRANSPARENT_TEXT_CSS);
                  const shot = await page.screenshot({ type: "png", clip, scale: "css" });
                  lumImage = await decodeImage(shot);
                } catch (err) {
                  // Sin la captura sin letras no se puede medir el fondo: queda en null.
                  log({ evt: "measure_bg_failed", error: err && err.name });
                }
              }
              measures.push({ page: index, elements: buildMeasuredElements(raw, lumImage, 1) });
            }
          } else {
            await page.emulateMedia({ media: "screen" });
            pdfs.push(
              await page.pdf({ width: `${width}px`, height: `${height}px`, printBackground: true, pageRanges: "1" }),
            );
          }
        } finally {
          await page.close().catch(() => {});
        }
      }

      const files = [];
      if (format === "png") {
        pngs.forEach((buffer, i) => files.push({ page: i, contentType: "image/png", base64: Buffer.from(buffer).toString("base64") }));
      } else {
        const merged = pdfs.length === 1 ? pdfs[0] : await mergePdfs(pdfs);
        files.push({ page: 0, contentType: "application/pdf", base64: Buffer.from(merged).toString("base64") });
      }
      const result = { files };
      if (measure) result.measure = measures;
      return result;
    } finally {
      await context.close().catch(() => {});
    }
  }

  // Corre el render con tiempo maximo. Al vencer, cierra el contexto (corta lo
  // que este en curso) y avisa.
  async function renderWithTimeout(spec) {
    const holder = { context: null };
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutRenderError()), timeoutMs);
    });
    const work = renderDocuments(spec, holder);
    work.catch(() => {}); // si pierde la carrera, que no quede sin atender
    try {
      return await Promise.race([work, timeout]);
    } catch (err) {
      if (err instanceof TimeoutRenderError && holder.context) {
        await holder.context.close().catch(() => {});
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleRender(req, res) {
    const started = Date.now();
    const meta = { evt: "render", format: null, pages: null, status: 0, code: "", ms: 0 };
    const reply = (status, payload, code, headers) => {
      meta.status = status;
      meta.code = code;
      meta.ms = Date.now() - started;
      log(meta);
      sendJson(res, status, payload, headers);
    };

    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      res.once("finish", () => req.destroy());
      return reply(413, { ok: false, error: "body_too_large" }, "body_too_large", { connection: "close" });
    }
    let read;
    try {
      read = await readBody(req, maxBodyBytes);
    } catch {
      return reply(400, { ok: false, error: "invalid_request", detail: "no se pudo leer el cuerpo" }, "read_error");
    }
    if (read.tooLarge) {
      res.once("finish", () => req.destroy());
      return reply(413, { ok: false, error: "body_too_large" }, "body_too_large", { connection: "close" });
    }

    // La firma se verifica sobre el cuerpo CRUDO, antes de parsear nada.
    const rawBody = read.body.toString("utf8");
    const header = req.headers["x-render-signature"];
    const nowSeconds = Math.floor(now() / 1000);
    if (!verifyRenderSignature(typeof header === "string" ? header : null, rawBody, secret, nowSeconds)) {
      return reply(401, { ok: false, error: "bad_signature" }, "bad_signature");
    }

    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return reply(400, { ok: false, error: "invalid_request", detail: "el cuerpo no es JSON valido" }, "invalid_json");
    }
    const checked = parseRenderRequest(parsed);
    if (!checked.ok) {
      return reply(400, { ok: false, error: "invalid_request", detail: checked.detail }, "invalid_request");
    }
    const spec = checked.value;
    meta.format = spec.format;
    meta.pages = spec.docs.length;

    let release;
    try {
      release = await limiter.acquire();
    } catch (err) {
      if (err instanceof BusyError) return reply(503, { ok: false, error: "busy" }, "busy");
      return reply(500, { ok: false, error: "render_failed" }, "acquire_failed");
    }
    try {
      if (res.destroyed) return; // el cliente se fue mientras esperaba en la cola
      const result = await renderWithTimeout(spec);
      return reply(200, { ok: true, version, ...result }, "ok");
    } catch (err) {
      if (err instanceof TimeoutRenderError || (err && err.name === "TimeoutError")) {
        return reply(504, { ok: false, error: "timeout" }, "timeout");
      }
      // Sin volcar el HTML ni el stack: solo el tipo de error.
      if (browserPromise) {
        browserPromise
          .then((browser) => {
            if (browser && typeof browser.isConnected === "function" && !browser.isConnected()) browserPromise = null;
          })
          .catch(() => {});
      }
      return reply(500, { ok: false, error: "render_failed" }, `render_failed:${(err && err.name) || "Error"}`);
    } finally {
      release();
    }
  }

  const server = http.createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    const run = async () => {
      if (path === "/health") {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
        return sendJson(res, 200, { ok: true, version });
      }
      if (path === "/render") {
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
        return handleRender(req, res);
      }
      return sendJson(res, 404, { ok: false, error: "not_found" });
    };
    run().catch(() => {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "render_failed" });
      else res.end();
    });
  });

  server.on("close", () => {
    if (!browserPromise) return;
    browserPromise
      .then((browser) => browser.close())
      .catch(() => {})
      .finally(() => {
        browserPromise = null;
      });
  });
  return server;
}

// ---------- Arranque ----------

function main() {
  const secret = process.env.RENDER_SERVICE_SECRET;
  if (!secret) {
    console.error("Falta RENDER_SERVICE_SECRET: el servicio de render no arranca sin su secreto (32+ bytes al azar).");
    process.exit(1);
  }
  const hosts = parseAllowedHosts(process.env.RENDER_ALLOWED_HOSTS);
  const server = createRenderServer({
    secret,
    allowedHosts: hosts.length > 0 ? hosts : DEFAULT_ALLOWED_HOSTS,
  });
  const port = Number(process.env.PORT) || 8080;
  server.listen(port, "0.0.0.0", () => {
    console.log(JSON.stringify({ evt: "listening", port, version: readServiceVersion() }));
  });
  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
