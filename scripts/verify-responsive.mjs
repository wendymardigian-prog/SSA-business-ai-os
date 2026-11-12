#!/usr/bin/env node
// @plantilla-quitar(servicios)
/**
 * Chequeo responsive de la app del equipo de servicio (Servicios A2, F131).
 *
 * Recorre las pantallas de F131 en 390, 768, 1100 y 1440 px, en claro y oscuro, contra la app corriendo en local, y
 * FALLA si:
 *   - la pagina tiene scroll horizontal (`document.documentElement.scrollWidth > innerWidth`);
 *   - un control de la barra superior (`header[data-topbar]`) queda fuera de la pantalla;
 *   - la pantalla no dibuja la barra (no cargo, 404, error);
 *   - una ficha (modal) no se cierra con Esc o no le devuelve el foco a quien la abrio.
 * Avisa (sin fallar) los tocables de menos de 40 px en el telefono. Guarda una captura por pantalla, ancho y tema.
 *
 * Sin dependencias: maneja el Chrome instalado por el protocolo de Chrome (CDP), con el WebSocket que trae Node.
 * Decision del 11/11/2026: un script propio en vez de sumar @playwright/test.
 *
 * Datos: arma un negocio de prueba (zz-test-) con el modulo de Servicios prendido, un producto con portal, clientes,
 * servicios, un programa, un formulario con un campo Link y una automatizacion con un paso de Servicios; entra con un
 * usuario de prueba (la sesion sale de la API, sin escribir ninguna contraseña) y al final borra todo. Toma el candado
 * de los verify-* (/private/tmp/ssa-verify.lock): no corre a la vez que otro.
 *
 *   node scripts/verify-responsive.mjs --base http://localhost:3197
 *   opciones: --anchos 390,1440  --temas light  --solo clientes  --salida docs/capturas-a2  --sin-capturas
 */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";
import { dbTargetArgs } from "./lib/db-target.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const BASE = arg("base", null);
if (!BASE) {
  console.error("Falta --base (la app corriendo en local, por ejemplo http://localhost:3197).");
  process.exit(2);
}
const WIDTHS = arg("anchos", "390,768,1100,1440").split(",").map(Number);
const THEMES = arg("temas", "light,dark").split(",");
const ONLY = arg("solo", null);
const OUT = arg("salida", "docs/capturas-a2");
const SHOTS = !flag("sin-capturas");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LOCK = "/private/tmp/ssa-verify.lock";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const jlit = (v) => `${lit(JSON.stringify(v))}::jsonb`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sql(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: 90_000 });
      const json = JSON.parse(out.slice(out.indexOf("{")));
      return json.rows ?? [];
    } catch (e) {
      const text = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
      if (attempt < 5 && /failed to connect as temp role|28P01|ECONNRESET|timeout expired|unexpected status 50/i.test(text)) {
        execFileSync("sleep", [String(2 * attempt)]);
        continue;
      }
      throw new Error(`SQL: ${text.slice(0, 300)}`);
    }
  }
}

// ── Los datos de prueba ────────────────────────────────────────────────────
async function seed() {
  const email = `zz-test-responsive-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data: created, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { ssa_create_workspace: true }, user_metadata: { full_name: "zz-test Responsive" } });
  if (error) throw new Error(`no pude crear el usuario de prueba: ${error.message}`);
  const userId = created.user.id;
  await sleep(500);
  const { data: mem } = await svc.from("workspace_members").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!mem) throw new Error("el usuario de prueba no tiene negocio");
  const ws = mem.workspace_id;
  await svc.from("workspaces").update({ name: "zz-test-responsive", timezone: "America/Argentina/Buenos_Aires" }).eq("id", ws);
  sql(`SELECT app_servicio.set_module_enabled(${lit(ws)}, true)`);

  const { data: prod } = await svc.from("products").insert({ workspace_id: ws, name: "zz-test Programa de 12 semanas", product_type: "programa" }).select("id").single();
  const { data: variant } = await svc.from("product_variants").insert({ workspace_id: ws, product_id: prod.id, name: "zz-test 12 semanas", price: 2400, duration_type: "weeks", duration_value: 12 }).select("id").single();
  const journey = { v: 1, phases: [
    { key: "ph_resp01", name: "Onboarding", advance: "auto", duration_days: 14, yellow_day: 10, red_day: 14, items: [
      { key: "it_resp01", kind: "checkbox", name: "Llamada de bienvenida", assignee: "owner", due_rule: { from: "service_start", days: 3 } },
      { key: "it_resp02", kind: "student_task", name: "Subir el diagnóstico", portal_button: true, ref: { button: { label: "Abrir la guía", url: "https://ejemplo.com/guia" } } },
    ] },
    { key: "ph_resp02", name: "Implementación", advance: "manual", duration_days: 56, items: [{ key: "it_resp03", kind: "checkbox", name: "Revisión de mitad de programa", due_rule: { from: "service_start", days: 40 } }] },
  ] };
  sql(`UPDATE public.product_variants SET journey_template = ${jlit(journey)}, journey_template_rev = journey_template_rev + 1,
       portal_settings = ${jlit({ v: 1, enabled: true, sections: [{ section: "program", included: true, opens: { type: "service_start" }, until: { type: "service" } }] })}, portal_settings_rev = portal_settings_rev + 1
       WHERE id = ${lit(variant.id)}`);
  sql(`UPDATE public.product_variants SET service_settings = ${jlit({ v: 1, mode: "create", when: { rule: "any_payment", enabled_at: new Date(Date.now() - 60_000).toISOString() }, confirm: false, start: "payment_date",
       owner: { mode: "round_robin", members: [userId], fallback_user_id: userId }, renewal: "new_linked" })}, service_settings_rev = service_settings_rev + 1 WHERE id = ${lit(variant.id)}`);
  sql(`UPDATE public.products SET portal_enabled = true WHERE id = ${lit(prod.id)}`);
  sql(`WITH m AS (INSERT INTO app_servicio.program_items (workspace_id, product_id, kind, title, position, status)
         VALUES (${lit(ws)}, ${lit(prod.id)}, 'module', 'zz-test Fundamentos', 1, 'active') RETURNING id)
       INSERT INTO app_servicio.program_items (workspace_id, product_id, parent_id, kind, lesson_type, title, position, status)
       SELECT ${lit(ws)}, ${lit(prod.id)}, m.id, 'lesson', 'video', t.title, t.pos, 'active' FROM m,
         (VALUES ('zz-test Bienvenida', 1), ('zz-test Las cuatro palancas', 2)) t(title, pos)`);
  const contacts = [];
  for (const [i, n] of ["zz-test Ana Ejemplo", "zz-test Bruno Muestra", "zz-test Carla Prueba con un nombre bastante largo"].entries()) {
    // Por la regla unica de contactos (find_or_create_contact), como cualquier alta.
    const { data: c, error: cErr } = await svc.rpc("find_or_create_contact", {
      p_workspace_id: ws,
      p_identity: { email: `zz-test-resp-${i}-${Date.now()}@example.test`, phone: `+5491100000${i}0` },
      p_defaults: { display_name: n },
      p_mode: "create",
      p_allow_without_identity: false,
    });
    if (cErr || !c?.contact_id) throw new Error(`no pude crear el contacto de prueba: ${cErr?.message ?? "sin id"}`);
    contacts.push(c.contact_id);
  }
  const services = contacts.map((cid) => sql(`SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(cid)}, 'variant_id', ${lit(variant.id)}, 'origin', 'manual', 'origin_reason', 'zz-test', 'owner_user_id', ${lit(userId)})) id`)[0]?.id);

  const { data: form } = await svc.from("forms").insert({ workspace_id: ws, name: "zz-test Reporte diario", type: "custom", slug: `zz-test-resp-${Date.now()}`,
    draft_definition: { fields: [{ id: "f_resp_horas", key: "horas", label: "Horas trabajadas", type: "number", required: true }, { id: "f_resp_video", key: "video", label: "Link al video", type: "link", required: false }] } }).select("id").single();
  const { data: flow } = await svc.from("flows").insert({ workspace_id: ws, name: "zz-test Completar un paso", status: "draft",
    nodes: [
      { id: "t1", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "service_item_completed", label: "Disparador" } },
      { id: "a1", type: "action", position: { x: 0, y: 160 }, data: { actionType: "svc_complete_step", productId: prod.id, variantId: variant.id, itemKey: "it_resp03" } },
    ],
    edges: [{ id: "e1", source: "t1", target: "a1" }] }).select("id").single();
  return { email, password, userId, ws, productId: prod.id, variantId: variant.id, contacts, services, formId: form?.id, flowId: flow?.id };
}

/** Las cookies de sesion como las escribe @supabase/ssr (codificadas y en partes), sin escribir ninguna contraseña. */
async function sessionCookies(email, password) {
  const jar = [];
  const client = createServerClient(URL_, ANON, { cookies: { getAll: () => jar.map(({ name, value }) => ({ name, value })), setAll: (list) => list.forEach((c) => {
    const i = jar.findIndex((x) => x.name === c.name);
    if (i >= 0) jar[i] = c;
    else jar.push(c);
  }) } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`no pude abrir la sesion de prueba: ${error.message}`);
  return jar.filter((c) => c.value);
}

// ── El navegador (CDP) ─────────────────────────────────────────────────────
async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), "ssa-responsive-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let version = null;
  for (let i = 0; i < 50 && !version; i++) {
    await sleep(200);
    version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
  }
  if (!version) throw new Error(`no pude abrir Chrome (${CHROME})`);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const waitEvent = (name, timeout = 30_000) =>
    new Promise((res) => {
      const t = setTimeout(() => res(null), timeout);
      const l = (msg) => {
        if (msg.method === name && msg.sessionId === sessionId) {
          clearTimeout(t);
          listeners.splice(listeners.indexOf(l), 1);
          res(msg.params);
        }
      };
      listeners.push(l);
    });
  await page("Page.enable");
  await page("Runtime.enable");
  await page("Network.enable");
  const close = () => {
    try {
      ws.close();
    } catch {}
    proc.kill("SIGKILL");
    // Chrome puede seguir escribiendo en su carpeta un instante: borrarla nunca puede cortar la limpieza de los datos.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  };
  return { page, waitEvent, close };
}

async function evaluate(page, expression) {
  const r = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

/** Lo que se mide en cada pantalla, adentro del navegador. */
const MEASURE = `(() => {
  const vw = window.innerWidth;
  const visible = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
  const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\\s+/g, " ").slice(0, 40);
  const bar = document.querySelector("header[data-topbar]");
  // Un control afuera DENTRO de una franja que se desliza de costado (las pestañas, la barra del lienzo) se alcanza
  // deslizando: no es una falla, siempre que la franja misma entre en la pantalla.
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === "auto" || ox === "scroll") && p.scrollWidth > p.clientWidth) {
        const r = p.getBoundingClientRect();
        return r.left >= -1 && r.right <= vw + 1;
      }
    }
    return false;
  };
  const outside = [];
  if (bar) for (const el of bar.querySelectorAll("a, button, input, select")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) outside.push(name(el));
  }
  // Sin PageHeader (el lienzo de flujos), los controles de la franja de arriba.
  const outsideTop = [];
  if (!bar) for (const el of document.querySelectorAll("main a, main button, main input, main select")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.top < 120 && (r.right > vw + 1 || r.left < -1) && !inScroller(el)) outsideTop.push(name(el));
  }
  const small = [];
  const modalEl = document.querySelector("[data-record-modal]");
  const touchSel = modalEl ? "[data-record-modal] button, [data-record-modal] a" : "header[data-topbar] a, header[data-topbar] button, [data-topbar-strip] a, [data-topbar-strip] button";
  if (vw < 768) for (const el of document.querySelectorAll(touchSel)) {
    // Un link dentro de un texto (un email, un nombre) no es un boton: se mide lo que se toca solo.
    if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 36 || r.width < 24) small.push(name(el) + " (" + Math.round(r.width) + "x" + Math.round(r.height) + ")");
  }
  return { overflow: document.documentElement.scrollWidth - vw, outside, outsideTop, small: [...new Set(small)].slice(0, 12), hasBar: !!bar, modal: !!document.querySelector("[data-record-modal]"), title: document.title, href: location.pathname + location.search, h1: (document.querySelector("h1")?.textContent || "").trim().slice(0, 60), headers: [...document.querySelectorAll("header")].length };
})()`;

async function main() {
  try {
    mkdirSync(LOCK);
    writeFileSync(join(LOCK, "owner"), `verify-responsive pid ${process.pid} ${new Date().toISOString()}\n`);
  } catch {
    console.error(`El candado ${LOCK} está tomado: otro verify-* está corriendo. No se corre nada.`);
    process.exit(3);
  }
  let data = null;
  let browser = null;
  const failures = [];
  const warnings = [];
  const summary = [];
  try {
    console.log("Armando los datos de prueba…");
    data = await seed();
    const cookies = await sessionCookies(data.email, data.password);
    const host = new URL(BASE).hostname;
    const s = data.services;
    const PAGES = [
      { key: "clientes-servicios", path: "/dashboard/clientes" },
      { key: "clientes-servicios-tablero", path: "/dashboard/clientes?modo=tablero" },
      { key: "clientes-clientes", path: "/dashboard/clientes/lista" },
      { key: "clientes-clientes-tablero", path: "/dashboard/clientes/lista?modo=tablero&agrupar=portal" },
      { key: "ficha-cliente", path: `/dashboard/clientes/lista?cliente=${data.contacts[2]}`, modal: true },
      { key: "ficha-servicio", path: `/dashboard/clientes?servicio=${s[0]}`, modal: true },
      { key: "portal", path: "/dashboard/portal" },
      { key: "portal-por-revisar", path: "/dashboard/portal?tab=revisar" },
      { key: "programa-contenido", path: `/dashboard/portal/${data.productId}` },
      { key: "programa-calendario", path: `/dashboard/portal/${data.productId}?tab=calendario&vista=mes` },
      { key: "programa-comunidad", path: `/dashboard/portal/${data.productId}?tab=comunidad` },
      { key: "afiliados", path: "/dashboard/afiliados" },
      { key: "grabaciones", path: "/dashboard/llamadas" },
      { key: "comisiones", path: "/dashboard/finanzas/comisiones" },
      { key: "productos", path: "/dashboard/settings/productos" },
      { key: "producto", path: `/dashboard/settings/productos/${data.productId}` },
      { key: "variante-camino", path: `/dashboard/settings/productos/${data.productId}/variantes/${data.variantId}` },
      { key: "variante-paso", path: `/dashboard/settings/productos/${data.productId}/variantes/${data.variantId}`, clickText: "Subir el diagnóstico" },
      // El lienzo es un editor de pantalla completa con su barra propia (no PageHeader).
      { key: "flujo-servicios", path: `/dashboard/flows/${data.flowId}`, ownBar: true },
      { key: "formularios", path: "/dashboard/formularios" },
      { key: "formulario-editor", path: `/dashboard/formularios/${data.formId}` },
      { key: "formulario-respuestas", path: `/dashboard/formularios/${data.formId}/respuestas` },
      { key: "agenda", path: "/dashboard/agenda" },
    ].filter((p) => !ONLY || p.key.includes(ONLY));

    browser = await launchChrome();
    const { page, waitEvent } = browser;
    for (const c of cookies) await page("Network.setCookie", { name: c.name, value: c.value, domain: host, path: "/", httpOnly: false, secure: false, sameSite: "Lax" });
    await page("Network.setCookie", { name: "workspace_id", value: data.ws, domain: host, path: "/" });
    if (SHOTS) mkdirSync(OUT, { recursive: true });

    let themeScript = null;
    for (const theme of THEMES) {
      if (themeScript) await page("Page.removeScriptToEvaluateOnNewDocument", { identifier: themeScript });
      ({ identifier: themeScript } = await page("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("theme", ${JSON.stringify(theme)})}catch(e){}` }));
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
      for (const width of WIDTHS) {
        await page("Emulation.setDeviceMetricsOverride", { width, height: width < 768 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 768 });
        for (const p of PAGES) {
          const label = `${p.key} · ${width} px · ${theme === "dark" ? "oscuro" : "claro"}`;
          const loaded = waitEvent("Page.loadEventFired", 60_000);
          await page("Page.navigate", { url: `${BASE}${p.path}` });
          await loaded;
          await sleep(1500);
          if (p.clickText) {
            const clicked = await evaluate(page, `(() => { const el = [...document.querySelectorAll("button, [role=button], a")].find((e) => (e.textContent || "").includes(${JSON.stringify(p.clickText)})); if (!el) return false; el.click(); return true; })()`);
            if (!clicked) failures.push(`${label}: no encontré «${p.clickText}» para abrirlo`);
            await sleep(800);
          }
          const m = await evaluate(page, MEASURE).catch((e) => ({ error: e.message }));
          if (m.error) {
            failures.push(`${label}: no se pudo medir (${m.error})`);
            continue;
          }
          const problems = [];
          if (p.ownBar) {
            if (m.outsideTop.length) problems.push(`controles de la barra del editor fuera de la pantalla: ${m.outsideTop.join(", ")}`);
          } else if (!m.hasBar) problems.push(`no dibuja la barra superior (quedó en ${m.href}, «${m.h1 || m.title}», ${m.headers} header)`);
          if (m.overflow > 1) problems.push(`scroll horizontal de ${m.overflow} px`);
          if (m.outside.length) problems.push(`controles de la barra fuera de la pantalla: ${m.outside.join(", ")}`);
          if (p.modal && !m.modal) problems.push("la ficha no se abrió");
          if (problems.length) failures.push(`${label}: ${problems.join("; ")}`);
          if (m.small.length) warnings.push(`${label}: tocables chicos: ${m.small.join(", ")}`);
          summary.push({ page: p.key, width, theme, ok: problems.length === 0 });
          if (SHOTS) {
            const shot = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            writeFileSync(join(OUT, `${p.key}-${width}-${theme}.png`), Buffer.from(shot.data, "base64"));
          }
        }
      }
    }

    // Las fichas abren y cierran con el teclado, y devuelven el foco (a 1440 y 390).
    for (const width of [1440, 390].filter((w) => WIDTHS.includes(w))) {
      if (ONLY && !"teclado".includes(ONLY)) break;
      await page("Emulation.setDeviceMetricsOverride", { width, height: width < 768 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 768 });
      const loaded = waitEvent("Page.loadEventFired", 60_000);
      await page("Page.navigate", { url: `${BASE}/dashboard/clientes/lista` });
      await loaded;
      await sleep(1500);
      const opened = await evaluate(page, `(() => { const a = document.querySelector('a[href*="cliente="]'); if (!a) return false; a.setAttribute("data-opener", "1"); a.focus(); a.click(); return true; })()`);
      let ok = false;
      if (opened) {
        for (let i = 0; i < 40 && !(await evaluate(page, `!!document.querySelector("[data-record-modal]")`)); i++) await sleep(250);
        await sleep(500);
        await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        for (let i = 0; i < 40 && (await evaluate(page, `!!document.querySelector("[data-record-modal]")`)); i++) await sleep(250);
        await sleep(500);
        const st = await evaluate(page, `({ closed: !document.querySelector("[data-record-modal]"), focus: !!document.activeElement && (document.activeElement.getAttribute("data-opener") === "1" || !!document.activeElement.closest('a[href*="cliente="]')) })`);
        ok = st.closed && st.focus;
        if (!st.closed) failures.push(`teclado · ${width} px: Esc no cerró la ficha del cliente`);
        else if (!st.focus) failures.push(`teclado · ${width} px: al cerrar la ficha, el foco no volvió a quien la abrió`);
      } else failures.push(`teclado · ${width} px: no encontré un cliente para abrir`);
      summary.push({ page: "teclado", width, theme: THEMES[0], ok });
    }
  } catch (e) {
    failures.push(`el chequeo se cortó: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    try {
      browser?.close();
    } catch {}
    if (data && !flag("conservar")) {
      try {
        await svc.from("workspaces").delete().eq("id", data.ws);
        await svc.auth.admin.deleteUser(data.userId);
      } catch (e) {
        failures.push(`la limpieza falló: ${e instanceof Error ? e.message : String(e)}`);
      }
      const cleanupOk = await runCleanup(svc).catch(() => false);
      if (!cleanupOk) failures.push("la limpieza general (zz-test-) falló");
    }
    try {
      rmSync(LOCK, { recursive: true, force: true });
    } catch {}
  }

  const total = summary.length;
  const passed = summary.filter((x) => x.ok).length;
  const lines = [
    `# Chequeo responsive (Servicios A2, F131)`,
    "",
    `${new Date().toISOString()} · ${BASE} · anchos ${WIDTHS.join(", ")} · temas ${THEMES.join(", ")}`,
    "",
    `**${passed} de ${total} en verde.**`,
    "",
    ...(failures.length ? ["## Fallas", "", ...failures.map((f) => `- ${f}`), ""] : []),
    ...(warnings.length ? ["## Avisos (tocables de menos de 40 px en el teléfono)", "", ...warnings.map((w) => `- ${w}`), ""] : []),
  ];
  if (SHOTS) writeFileSync(join(OUT, "RESUMEN.md"), lines.join("\n"));
  console.log(lines.join("\n"));
  // exitCode y no process.exit: con la salida en un pipe, process.exit corta lo que falta escribir.
  process.exitCode = failures.length ? 1 : 0;
}

main();
