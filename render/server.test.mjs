// Tests del servidor de render. Corren con `node --test` SIN Playwright instalado:
// el navegador es uno falso que inyecta `launchBrowser`, y la hora la fija `now`.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRenderServer, isAllowedRequest, parseAllowedHosts, parseRenderRequest, readServiceVersion } from "./server.mjs";
import { collectElementsInPage } from "./measure.mjs";
import { renderSignatureHeader } from "./sign.mjs";

const SECRET = "secreto-de-prueba-con-mas-de-32-bytes-0123456789";
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- ayudas ----------

// Navegador falso: registra todo lo que el servidor le pide.
function fakeBrowser({ elements = [], onSetContent, onLaunch } = {}) {
  const state = { launches: 0, contexts: [], disconnected: null, browser: null };
  const launchBrowser = async () => {
    state.launches += 1;
    if (onLaunch) await onLaunch();
    const browser = {
      isConnected: () => true,
      on(event, handler) {
        if (event === "disconnected") state.disconnected = handler;
      },
      close: async () => {},
      newContext: async (options) => {
        const ctx = {
          options,
          timeout: null,
          routeHandler: null,
          closed: false,
          htmls: [],
          screenshots: [],
          pdfOptions: [],
          evaluated: 0,
          pagesClosed: 0,
          setDefaultTimeout(ms) {
            ctx.timeout = ms;
          },
          async route(pattern, handler) {
            ctx.pattern = pattern;
            ctx.routeHandler = handler;
          },
          async close() {
            ctx.closed = true;
          },
          async newPage() {
            return {
              async setContent(html, opts) {
                ctx.htmls.push(html);
                ctx.setContentOptions = opts;
                if (onSetContent) await onSetContent(html, ctx);
              },
              async evaluate(fn) {
                ctx.evaluated += 1;
                return fn === collectElementsInPage ? elements : undefined;
              },
              async waitForLoadState() {},
              async emulateMedia() {},
              async screenshot(opts) {
                ctx.screenshots.push(opts);
                return Buffer.from(`PNG${ctx.screenshots.length}`);
              },
              async pdf(opts) {
                ctx.pdfOptions.push(opts);
                return Buffer.from(`PDF${ctx.pdfOptions.length}`);
              },
              async close() {
                ctx.pagesClosed += 1;
              },
            };
          },
        };
        state.contexts.push(ctx);
        return ctx;
      },
    };
    state.browser = browser;
    return browser;
  };
  return { launchBrowser, state };
}

async function start(overrides = {}) {
  const logs = [];
  const server = createRenderServer({
    secret: SECRET,
    now: () => NOW_MS,
    log: (entry) => logs.push(entry),
    version: "test-1",
    ...overrides,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    logs,
    server,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sign(body, { t = NOW_S, secret = SECRET } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { text, headers: { "content-type": "application/json", "x-render-signature": renderSignatureHeader(text, secret, t) } };
}

async function post(base, body, signOptions) {
  const { text, headers } = sign(body, signOptions);
  const res = await fetch(`${base.url}/render`, { method: "POST", headers, body: text });
  return { status: res.status, json: await res.json() };
}

const validPng = { html: "<p>hola</p>", width: 1080, height: 1350, format: "png", scale: 2 };

// ---------- salud y rutas ----------

test("GET /health responde 200 con ok y la version", async () => {
  const app = await start();
  try {
    const res = await fetch(`${app.url}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, version: "test-1" });
  } finally {
    await app.close();
  }
});

test("una ruta que no existe es 404 y un metodo equivocado en una ruta conocida es 405", async () => {
  const app = await start();
  try {
    assert.equal((await fetch(`${app.url}/otra`)).status, 404);
    assert.equal((await fetch(`${app.url}/render`)).status, 405);
    assert.equal((await fetch(`${app.url}/health`, { method: "POST" })).status, 405);
  } finally {
    await app.close();
  }
});

test("sin secreto el servidor no se puede crear", () => {
  assert.throws(() => createRenderServer({ secret: "" }), /secret/);
  assert.throws(() => createRenderServer({}), /secret/);
});

test("el proceso sin RENDER_SERVICE_SECRET termina con un mensaje claro", async () => {
  const file = fileURLToPath(new URL("./server.mjs", import.meta.url));
  const env = { ...process.env };
  delete env.RENDER_SERVICE_SECRET;
  const child = spawn(process.execPath, [file], { env });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 1);
  assert.match(stderr, /RENDER_SERVICE_SECRET/);
});

test("readServiceVersion devuelve la version del package.json", () => {
  assert.match(readServiceVersion(), /^1\.0\.0/);
});

// ---------- firma ----------

test("firma invalida: 401 y no se lanza el navegador", async () => {
  const { launchBrowser, state } = fakeBrowser();
  const app = await start({ launchBrowser });
  try {
    const res = await post(app, validPng, { secret: "otro-secreto" });
    assert.equal(res.status, 401);
    assert.deepEqual(res.json, { ok: false, error: "bad_signature" });
    assert.equal(state.launches, 0);
  } finally {
    await app.close();
  }
});

test("firma vieja (mas de 60 s): 401", async () => {
  const { launchBrowser, state } = fakeBrowser();
  const app = await start({ launchBrowser });
  try {
    const res = await post(app, validPng, { t: NOW_S - 61 });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, "bad_signature");
    assert.equal(state.launches, 0);
  } finally {
    await app.close();
  }
});

test("sin cabecera de firma: 401", async () => {
  const app = await start({ launchBrowser: fakeBrowser().launchBrowser });
  try {
    const res = await fetch(`${app.url}/render`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(validPng) });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "bad_signature");
  } finally {
    await app.close();
  }
});

test("un cuerpo distinto del firmado: 401", async () => {
  const app = await start({ launchBrowser: fakeBrowser().launchBrowser });
  try {
    const { headers } = sign(validPng);
    const res = await fetch(`${app.url}/render`, { method: "POST", headers, body: JSON.stringify({ ...validPng, html: "<p>otro</p>" }) });
    assert.equal(res.status, 401);
  } finally {
    await app.close();
  }
});

test("la firma se verifica ANTES de parsear: un JSON roto con firma mala es 401, no 400", async () => {
  const app = await start({ launchBrowser: fakeBrowser().launchBrowser });
  try {
    const res = await fetch(`${app.url}/render`, {
      method: "POST",
      headers: { "x-render-signature": "t=1,v1=" + "0".repeat(64) },
      body: "{esto no es json",
    });
    assert.equal(res.status, 401);
  } finally {
    await app.close();
  }
});

// ---------- tamano del cuerpo ----------

test("un cuerpo mas grande que el maximo (por Content-Length): 413 sin parsear ni lanzar el navegador", async () => {
  const { launchBrowser, state } = fakeBrowser();
  const app = await start({ launchBrowser, maxBodyBytes: 200 });
  try {
    const big = { ...validPng, html: "x".repeat(2000) };
    const res = await post(app, big);
    assert.equal(res.status, 413);
    assert.deepEqual(res.json, { ok: false, error: "body_too_large" });
    assert.equal(state.launches, 0);
  } finally {
    await app.close();
  }
});

test("un cuerpo grande sin Content-Length (chunked) tambien es 413, aunque la firma sea mala", async () => {
  const app = await start({ launchBrowser: fakeBrowser().launchBrowser, maxBodyBytes: 200 });
  try {
    const result = await new Promise((resolve, reject) => {
      const req = http.request(`${app.url}/render`, { method: "POST", headers: { "transfer-encoding": "chunked", "x-render-signature": "basura" } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, data }));
      });
      req.on("error", reject);
      req.write("a".repeat(150));
      req.write("b".repeat(150));
      req.end("c".repeat(150));
    });
    assert.equal(result.status, 413);
    assert.match(result.data, /body_too_large/);
  } finally {
    await app.close();
  }
});

// ---------- validacion ----------

test("JSON invalido con firma valida: 400", async () => {
  const app = await start({ launchBrowser: fakeBrowser().launchBrowser });
  try {
    const res = await post(app, "{esto no es json");
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "invalid_request");
  } finally {
    await app.close();
  }
});

test("`html` y `pages` a la vez, o ninguno: 400", async () => {
  const app = await start({ launchBrowser: fakeBrowser().launchBrowser });
  try {
    const both = await post(app, { ...validPng, pages: [{ html: "<p>1</p>" }] });
    assert.equal(both.status, 400);
    assert.equal(both.json.error, "invalid_request");
    const { html: _html, ...none } = validPng;
    const neither = await post(app, none);
    assert.equal(neither.status, 400);
  } finally {
    await app.close();
  }
});

test("parseRenderRequest rechaza lo invalido y acepta lo valido", () => {
  const ok = (body) => parseRenderRequest(body).ok;
  assert.equal(ok(validPng), true);
  assert.equal(ok({ pages: [{ html: "<p>1</p>" }], width: 10, height: 20000, format: "pdf" }), true);
  assert.equal(ok(null), false);
  assert.equal(ok([]), false);
  assert.equal(ok({ ...validPng, html: "" }), false);
  assert.equal(ok({ ...validPng, html: 5 }), false);
  assert.equal(ok({ html: "<p>1</p>", pages: [], width: 10, height: 10, format: "png" }), false);
  assert.equal(ok({ pages: [], width: 10, height: 10, format: "png" }), false);
  assert.equal(ok({ pages: [{ html: "" }], width: 10, height: 10, format: "png" }), false);
  assert.equal(ok({ pages: Array.from({ length: 36 }, () => ({ html: "<p>x</p>" })), width: 10, height: 10, format: "png" }), false);
  assert.equal(ok({ pages: Array.from({ length: 35 }, () => ({ html: "<p>x</p>" })), width: 10, height: 10, format: "png" }), true);
  assert.equal(ok({ ...validPng, width: 0 }), false);
  assert.equal(ok({ ...validPng, width: 4001 }), false);
  assert.equal(ok({ ...validPng, width: 10.5 }), false);
  assert.equal(ok({ ...validPng, height: 20001 }), false);
  assert.equal(ok({ ...validPng, height: "10" }), false);
  assert.equal(ok({ ...validPng, format: "gif" }), false);
  assert.equal(ok({ ...validPng, scale: 3 }), false);
  assert.equal(ok({ ...validPng, scale: 0.5 }), true);
  assert.equal(ok({ ...validPng, measure: "si" }), false);
  assert.equal(ok({ ...validPng, measure: true }), true);
  assert.equal(ok({ ...validPng, format: "pdf", measure: true }), false);
});

test("un pedido invalido devuelve 400 con el detalle y no lanza el navegador", async () => {
  const { launchBrowser, state } = fakeBrowser();
  const app = await start({ launchBrowser });
  try {
    const res = await post(app, { ...validPng, width: 99999 });
    assert.equal(res.status, 400);
    assert.match(res.json.detail, /width/);
    assert.equal(state.launches, 0);
  } finally {
    await app.close();
  }
});

// ---------- render ----------

test("pedido valido en png: 200 con `files` y el contexto sin JavaScript", async () => {
  const { launchBrowser, state } = fakeBrowser();
  const app = await start({ launchBrowser });
  try {
    const res = await post(app, validPng);
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.version, "test-1");
    assert.deepEqual(res.json.files, [{ page: 0, contentType: "image/png", base64: Buffer.from("PNG1").toString("base64") }]);
    assert.equal(res.json.measure, undefined);

    const [ctx] = state.contexts;
    assert.equal(ctx.options.javaScriptEnabled, false);
    assert.deepEqual(ctx.options.viewport, { width: 1080, height: 1350 });
    assert.equal(ctx.options.deviceScaleFactor, 2);
    assert.equal(ctx.pattern, "**/*");
    assert.equal(ctx.timeout, 30000);
    assert.deepEqual(ctx.htmls, ["<p>hola</p>"]);
    assert.equal(ctx.setContentOptions.waitUntil, "load");
    assert.deepEqual(ctx.screenshots[0], { type: "png", clip: { x: 0, y: 0, width: 1080, height: 1350 } });
    assert.equal(ctx.closed, true);
    assert.equal(ctx.pagesClosed, 1);
  } finally {
    await app.close();
  }
});

test("`scale` por defecto es 1 y en pdf el factor siempre es 1", async () => {
  const { launchBrowser, state } = fakeBrowser();
  const app = await start({ launchBrowser });
  try {
    await post(app, { html: "<p>1</p>", width: 100, height: 100, format: "png" });
    await post(app, { html: "<p>1</p>", width: 100, height: 100, format: "pdf", scale: 2 });
    assert.equal(state.contexts[0].options.deviceScaleFactor, 1);
    assert.equal(state.contexts[1].options.deviceScaleFactor, 1);
  } finally {
    await app.close();
  }
});

test("con `pages`: un PNG por pagina, en orden, en un solo contexto", async () => {
  const { launchBrowser, state } = fakeBrowser();
  const app = await start({ launchBrowser });
  try {
    const res = await post(app, { pages: [{ html: "<p>a</p>" }, { html: "<p>b</p>" }, { html: "<p>c</p>" }], width: 800, height: 600, format: "png" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.files.map((f) => f.page), [0, 1, 2]);
    assert.equal(state.contexts.length, 1);
    assert.deepEqual(state.contexts[0].htmls, ["<p>a</p>", "<p>b</p>", "<p>c</p>"]);
    assert.equal(state.contexts[0].pagesClosed, 3);
  } finally {
    await app.close();
  }
});

test("pdf con varias paginas: una hoja por pagina, unidas en UN solo archivo", async () => {
  const { launchBrowser, state } = fakeBrowser();
  const merged = [];
  const app = await start({
    launchBrowser,
    mergePdfs: async (buffers) => {
      merged.push(buffers.map((b) => b.toString()));
      return Buffer.from("PDF-UNIDO");
    },
  });
  try {
    const res = await post(app, { pages: [{ html: "<p>a</p>" }, { html: "<p>b</p>" }], width: 800, height: 600, format: "pdf" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.files, [{ page: 0, contentType: "application/pdf", base64: Buffer.from("PDF-UNIDO").toString("base64") }]);
    assert.deepEqual(merged, [["PDF1", "PDF2"]]);
    for (const opts of state.contexts[0].pdfOptions) {
      assert.deepEqual(opts, { width: "800px", height: "600px", printBackground: true, pageRanges: "1" });
    }
  } finally {
    await app.close();
  }
});

test("pdf de una sola pagina: no se unen archivos", async () => {
  const { launchBrowser } = fakeBrowser();
  let calls = 0;
  const app = await start({
    launchBrowser,
    mergePdfs: async () => {
      calls += 1;
      return Buffer.from("no deberia");
    },
  });
  try {
    const res = await post(app, { html: "<p>a</p>", width: 800, height: 600, format: "pdf" });
    assert.equal(res.status, 200);
    assert.equal(calls, 0);
    assert.equal(res.json.files[0].base64, Buffer.from("PDF1").toString("base64"));
  } finally {
    await app.close();
  }
});

// ---------- red restringida ----------

test("isAllowedRequest deja pasar data:, about: y los hosts de la lista; aborta lo demas", () => {
  const hosts = ["fonts.googleapis.com", "fonts.gstatic.com"];
  assert.equal(isAllowedRequest("data:image/png;base64,AAAA", hosts), true);
  assert.equal(isAllowedRequest("about:blank", hosts), true);
  assert.equal(isAllowedRequest("https://fonts.googleapis.com/css2?family=Inter", hosts), true);
  assert.equal(isAllowedRequest("https://fonts.gstatic.com/s/inter/v1/x.woff2", hosts), true);
  assert.equal(isAllowedRequest("https://evil.example.com/x.png", hosts), false);
  assert.equal(isAllowedRequest("http://fonts.gstatic.com/x.woff2", hosts), false, "http no pasa");
  assert.equal(isAllowedRequest("https://fonts.gstatic.com.evil.com/x", hosts), false, "el host tiene que ser exacto");
  assert.equal(isAllowedRequest("https://evilfonts.gstatic.com/x", hosts), false);
  assert.equal(isAllowedRequest("https://fonts.gstatic.com:8443/x", hosts), false, "otro puerto no pasa");
  assert.equal(isAllowedRequest("https://fonts.gstatic.com:443/x", hosts), true);
  assert.equal(isAllowedRequest("https://usuario:clave@fonts.gstatic.com/x", hosts), false);
  assert.equal(isAllowedRequest("https://fonts.gstatic.com./x", hosts), false);
  assert.equal(isAllowedRequest("file:///etc/passwd", hosts), false);
  assert.equal(isAllowedRequest("ftp://fonts.gstatic.com/x", hosts), false);
  assert.equal(isAllowedRequest("blob:https://fonts.gstatic.com/uuid", hosts), false);
  assert.equal(isAllowedRequest("http://localhost:3000/", hosts), false);
  assert.equal(isAllowedRequest("http://169.254.169.254/latest/meta-data", hosts), false);
  assert.equal(isAllowedRequest("esto no es una url", hosts), false);
  assert.equal(isAllowedRequest("https://fonts.gstatic.com/x", []), false);
});

test("isAllowedRequest admite comodines *.dominio solo si estan en la lista", () => {
  const sin = ["fonts.gstatic.com"];
  const con = ["fonts.gstatic.com", "*.supabase.co"];
  assert.equal(isAllowedRequest("https://abc123.supabase.co/storage/v1/object/sign/x?token=1", sin), false);
  assert.equal(isAllowedRequest("https://abc123.supabase.co/storage/v1/object/sign/x?token=1", con), true);
  assert.equal(isAllowedRequest("https://a.b.supabase.co/x", con), true);
  assert.equal(isAllowedRequest("https://supabase.co/x", con), false, "el dominio pelado no entra por el comodin");
  assert.equal(isAllowedRequest("https://supabase.co.evil.com/x", con), false);
  assert.equal(isAllowedRequest("https://evilsupabase.co/x", con), false);
  assert.equal(isAllowedRequest("https://ABC123.SUPABASE.CO/x", con), true);
});

test("parseAllowedHosts separa por comas, recorta y pasa a minusculas", () => {
  assert.deepEqual(parseAllowedHosts(" Fonts.Googleapis.com , ,*.supabase.co"), ["fonts.googleapis.com", "*.supabase.co"]);
  assert.deepEqual(parseAllowedHosts(undefined), []);
});

test("la ruta registrada en el contexto aborta un host no permitido y deja pasar uno permitido y data:", async () => {
  const { launchBrowser, state } = fakeBrowser();
  const app = await start({ launchBrowser, allowedHosts: ["fonts.gstatic.com"] });
  try {
    await post(app, validPng);
    const { routeHandler } = state.contexts[0];
    const fakeRoute = (url) => {
      const route = { decision: null, request: () => ({ url: () => url }), continue: async () => (route.decision = "continue"), abort: async () => (route.decision = "abort") };
      return route;
    };
    const casos = [
      ["https://fonts.gstatic.com/x.woff2", "continue"],
      ["data:image/png;base64,AAAA", "continue"],
      ["about:blank", "continue"],
      ["https://tracker.example.com/pixel.gif", "abort"],
      ["http://127.0.0.1:8080/admin", "abort"],
    ];
    for (const [url, esperado] of casos) {
      const route = fakeRoute(url);
      await routeHandler(route);
      assert.equal(route.decision, esperado, url);
    }
  } finally {
    await app.close();
  }
});

// ---------- medicion ----------

test("measure: devuelve por pagina las cajas, el desborde y la luminancia del fondo de cada texto", async () => {
  const elements = [
    { id: "titulo", type: "text", x: 10, y: 20, w: 200, h: 50, overflow: true },
    { id: "foto", type: "image", x: 0, y: 0, w: 1080, h: 1350, overflow: false },
  ];
  const { launchBrowser, state } = fakeBrowser({ elements });
  const lum = { width: 1080, height: 1350, data: new Uint8Array(1080 * 1350 * 4).fill(255) };
  const app = await start({ launchBrowser, decodeImage: async () => lum });
  try {
    const res = await post(app, { pages: [{ html: "<p>a</p>" }, { html: "<p>b</p>" }], width: 1080, height: 1350, format: "png", measure: true });
    assert.equal(res.status, 200);
    assert.equal(res.json.files.length, 2);
    assert.equal(res.json.measure.length, 2);
    assert.equal(res.json.measure[1].page, 1);
    assert.deepEqual(res.json.measure[0].elements, [
      { id: "titulo", x: 10, y: 20, w: 200, h: 50, overflow: true, bgLuminance: 1 },
      { id: "foto", x: 0, y: 0, w: 1080, h: 1350, overflow: false, bgLuminance: null },
    ]);
    // la segunda captura es la "sin letras", a escala CSS
    const ctx = state.contexts[0];
    assert.equal(ctx.screenshots.length, 4);
    assert.equal(ctx.screenshots[1].scale, "css");
  } finally {
    await app.close();
  }
});

test("measure sin textos no saca la captura sin letras", async () => {
  const { launchBrowser, state } = fakeBrowser({ elements: [{ id: "foto", type: "image", x: 0, y: 0, w: 10, h: 10, overflow: false }] });
  const app = await start({ launchBrowser });
  try {
    const res = await post(app, { ...validPng, measure: true });
    assert.equal(res.status, 200);
    assert.equal(state.contexts[0].screenshots.length, 1);
    assert.equal(res.json.measure[0].elements[0].bgLuminance, null);
  } finally {
    await app.close();
  }
});

test("measure: si la captura sin letras no se puede decodificar, el render sigue y bgLuminance queda en null", async () => {
  const { launchBrowser } = fakeBrowser({ elements: [{ id: "t", type: "text", x: 0, y: 0, w: 10, h: 10, overflow: false }] });
  const app = await start({
    launchBrowser,
    decodeImage: async () => {
      throw new Error("png roto");
    },
  });
  try {
    const res = await post(app, { ...validPng, measure: true });
    assert.equal(res.status, 200);
    assert.equal(res.json.measure[0].elements[0].bgLuminance, null);
  } finally {
    await app.close();
  }
});

// ---------- concurrencia, tiempo y fallas ----------

test("con 3 renders en curso y la cola llena (10): el siguiente recibe 503", async () => {
  let started = 0;
  let open;
  const gate = new Promise((resolve) => {
    open = resolve;
  });
  const { launchBrowser } = fakeBrowser({
    onSetContent: async () => {
      started += 1;
      await gate;
    },
  });
  const app = await start({ launchBrowser, maxConcurrency: 3 });
  try {
    const running = Array.from({ length: 3 }, () => post(app, validPng));
    while (started < 3) await sleep(5);
    const queued = Array.from({ length: 10 }, () => post(app, validPng));
    await sleep(150);
    assert.equal(started, 3, "los demas esperan en la cola");

    const rejected = await post(app, validPng);
    assert.equal(rejected.status, 503);
    assert.deepEqual(rejected.json, { ok: false, error: "busy" });

    open();
    const all = await Promise.all([...running, ...queued]);
    assert.ok(all.every((r) => r.status === 200), "los 13 terminan bien");
    assert.equal(started, 13);
  } finally {
    open();
    await app.close();
  }
});

test("nunca hay mas de `maxConcurrency` renders a la vez", async () => {
  let active = 0;
  let peak = 0;
  const { launchBrowser } = fakeBrowser({
    onSetContent: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(20);
      active -= 1;
    },
  });
  const app = await start({ launchBrowser, maxConcurrency: 2 });
  try {
    const all = await Promise.all(Array.from({ length: 6 }, () => post(app, validPng)));
    assert.ok(all.every((r) => r.status === 200));
    assert.equal(peak, 2);
  } finally {
    await app.close();
  }
});

test("si el render se pasa del tiempo maximo: 504 y se cierra el contexto", async () => {
  const { launchBrowser, state } = fakeBrowser({ onSetContent: () => new Promise(() => {}) });
  const app = await start({ launchBrowser, timeoutMs: 60 });
  try {
    const res = await post(app, validPng);
    assert.equal(res.status, 504);
    assert.deepEqual(res.json, { ok: false, error: "timeout" });
    assert.equal(state.contexts[0].closed, true);
    assert.equal(app.logs.at(-1).code, "timeout");
  } finally {
    await app.close();
  }
});

test("el timeout libera el lugar: el pedido siguiente se atiende", async () => {
  let n = 0;
  const { launchBrowser } = fakeBrowser({
    onSetContent: () => {
      n += 1;
      return n === 1 ? new Promise(() => {}) : Promise.resolve();
    },
  });
  const app = await start({ launchBrowser, timeoutMs: 60, maxConcurrency: 1 });
  try {
    assert.equal((await post(app, validPng)).status, 504);
    assert.equal((await post(app, validPng)).status, 200);
  } finally {
    await app.close();
  }
});

test("una falla del render: 500 render_failed, sin volcar el HTML ni el error, y el contexto se cierra", async () => {
  const { launchBrowser, state } = fakeBrowser({
    onSetContent: () => {
      throw new Error("explotó con <p>dato-personal-secreto</p>");
    },
  });
  const app = await start({ launchBrowser });
  try {
    const res = await post(app, { ...validPng, html: "<p>dato-personal-secreto</p>" });
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { ok: false, error: "render_failed" });
    assert.equal(state.contexts[0].closed, true);
    assert.equal(state.contexts[0].pagesClosed, 1);
    assert.doesNotMatch(JSON.stringify(app.logs), /dato-personal-secreto/);
  } finally {
    await app.close();
  }
});

test("los logs llevan duracion, paginas, formato y codigo, y nada del contenido", async () => {
  const { launchBrowser } = fakeBrowser();
  const app = await start({ launchBrowser });
  try {
    await post(app, { ...validPng, html: "<p>nombre-de-una-persona</p>" });
    const entry = app.logs.at(-1);
    assert.equal(entry.evt, "render");
    assert.equal(entry.format, "png");
    assert.equal(entry.pages, 1);
    assert.equal(entry.status, 200);
    assert.equal(typeof entry.ms, "number");
    assert.doesNotMatch(JSON.stringify(app.logs), /nombre-de-una-persona/);
  } finally {
    await app.close();
  }
});

// ---------- el navegador se reusa ----------

test("un solo navegador para todos los pedidos; si se cae, se vuelve a lanzar", async () => {
  const { launchBrowser, state } = fakeBrowser();
  const app = await start({ launchBrowser });
  try {
    assert.equal((await post(app, validPng)).status, 200);
    assert.equal((await post(app, validPng)).status, 200);
    assert.equal(state.launches, 1);
    state.disconnected();
    assert.equal((await post(app, validPng)).status, 200);
    assert.equal(state.launches, 2);
  } finally {
    await app.close();
  }
});

test("pedidos simultaneos antes del primer lanzamiento comparten el mismo navegador", async () => {
  const { launchBrowser, state } = fakeBrowser({ onLaunch: () => sleep(30) });
  const app = await start({ launchBrowser });
  try {
    const all = await Promise.all(Array.from({ length: 3 }, () => post(app, validPng)));
    assert.ok(all.every((r) => r.status === 200));
    assert.equal(state.launches, 1);
  } finally {
    await app.close();
  }
});

test("si el lanzamiento falla: 500, y el pedido siguiente lo intenta de nuevo", async () => {
  let attempts = 0;
  const base = fakeBrowser();
  const app = await start({
    launchBrowser: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("no hay chromium");
      return base.launchBrowser();
    },
  });
  try {
    assert.equal((await post(app, validPng)).status, 500);
    assert.equal((await post(app, validPng)).status, 200);
    assert.equal(attempts, 2);
  } finally {
    await app.close();
  }
});
