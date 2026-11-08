#!/usr/bin/env node
// @plantilla-quitar(servicios)
/**
 * Verificacion del modulo de Servicios (Corrida A1): bloques sv1, sv2, prd y ac.
 *
 * Corre contra la base real con usuarios de verdad. Prueba lo que vitest no puede: que la BASE haga
 * cumplir las reglas (gemelas SQL = TS con los mismos casos, RLS por rol, la guardia SV003, el modulo
 * apagado, la creacion automatica al cobrar, que un producto sin configurar venda igual, que un trigger
 * que falla no tumbe el pago).
 *
 *   node scripts/verify-services.mjs                 todos los bloques que ya tienen su migracion
 *   node scripts/verify-services.mjs --bloque sv1    uno
 *
 * El modulo se prende SOLO en el negocio de prueba (zz-test-). Crea y borra todo lo suyo (prefijo
 * zz-test-). Una limpieza que falla es una prueba que falla. No se corre a la vez que otro verify-*:
 * candado /private/tmp/ssa-verify.lock.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { runCleanup } from "./test-cleanup.mjs";
import { dbTargetArgs } from "./lib/db-target.mjs";
import { checkProtectedFunctions } from "./protected-functions.mjs";

const execFileAsync = promisify(execFile);
const repoFile = (p) => new URL(`../${p}`, import.meta.url);
const json = (p) => JSON.parse(readFileSync(repoFile(p), "utf8"));

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const bloqueArg = process.argv.indexOf("--bloque");
const ONLY = bloqueArg >= 0 ? process.argv[bloqueArg + 1] : null;
const run = (b) => !ONLY || ONLY === b;

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
// Igualdad de valores JSON sin importar el orden de las claves (la base devuelve un jsonb con sus claves
// ordenadas a su manera; TypeScript, en el orden en que se escribieron).
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const jlit = (v) => `${lit(JSON.stringify(v))}::jsonb`;

// La CLI abre un rol temporal por consulta y, con muchas seguidas, a veces no se puede conectar con el
// (SASL 28P01, "failed to connect as temp role"). Eso no es un resultado de la prueba: se reintenta.
const TRANSIENT = /failed to connect as temp role|SQLSTATE 28P01|failed SASL auth|connection reset|ECONNRESET|timeout expired|unexpected status 50[234]|upstream connect error|ETIMEDOUT|SIGTERM/i;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function sql(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: 90_000 });
      return JSON.parse(out).rows ?? [];
    } catch (e) {
      const text = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
      if (attempt >= 5 || !TRANSIENT.test(text)) throw e;
      sleepSync(2000 * attempt);
    }
  }
}
/** Como sql(), pero si falla anota la falla con el error completo y devuelve null (no corta la verificacion). */
function sqlErrOrRows(query, label) {
  try {
    return sql(query);
  } catch (e) {
    fail(`${label}: la consulta fallo`, `${e.stderr ?? ""}${e.stdout ?? ""}`.replace(/\s+/g, " ").slice(0, 600));
    return null;
  }
}
function sqlErr(query) {
  try {
    sql(query);
    return null;
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
  }
}
async function sqlAsync(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { stdout } = await execFileAsync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 90_000 });
      return JSON.parse(stdout).rows ?? [];
    } catch (e) {
      const text = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
      if (attempt >= 5 || !TRANSIENT.test(text)) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
/**
 * La consulta como una fila jsonb. Una que escribe (WITH x AS (UPDATE/INSERT ... RETURNING) SELECT ...) no puede ir
 * adentro de una subconsulta: el SELECT final se envuelve y el WITH queda arriba.
 */
function wrapForJson(query) {
  const q = query.trim();
  if (/^WITH\b/i.test(q)) {
    const at = q.lastIndexOf(") SELECT ");
    if (at > 0) return `${q.slice(0, at + 1)} SELECT to_jsonb(t) FROM (${q.slice(at + 2)}) t`;
  }
  return `SELECT to_jsonb(t) FROM (${q}) t`;
}
/** Una consulta con la sesion de un usuario (rol authenticated + su JWT), en una transaccion que se deshace. */
function asUser(uid, query) {
  const claims = JSON.stringify({ sub: uid, role: "authenticated" });
  const body = `DO $do$ DECLARE r jsonb; BEGIN
    PERFORM set_config('request.jwt.claims', ${lit(claims)}, true);
    PERFORM set_config('request.jwt.claim.sub', ${lit(uid)}, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE ${lit(wrapForJson(query))} INTO r;
    RAISE EXCEPTION 'RESULTADO: %', COALESCE(r::text, 'null');
  END $do$;`;
  const text = sqlErr(body) ?? "";
  const m = text.match(/RESULTADO: (\{.*?\}|null)(?=\\n|"|\n|$)/s);
  if (m) return { ok: true, row: m[1] === "null" ? null : JSON.parse(m[1].replace(/\\"/g, '"')) };
  const code = text.match(/\(SQLSTATE ([A-Z0-9]{5})\)/)?.[1] ?? text.match(/ERROR: +([A-Z0-9]{5})/)?.[1] ?? null;
  return { ok: false, error: text.slice(0, 400), code };
}

/** Llama una funcion del modulo con la sesion de la persona, por la API (como la app). Devuelve { data, error }. */
async function rpcAs(user, fn, args) {
  const { data, error } = await user.client.schema("app_servicio").rpc(fn, args);
  return { data, error: error ? `${error.code ?? ""} ${error.message}` : null };
}

async function makeUser(tag) {
  const email = `zz-test-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  // Una sesion de verdad para lo que tiene que QUEDAR guardado (asUser deshace todo al final).
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude iniciar sesion con ${tag}: ${e.message}`);
  return { id: data.user.id, email, client };
}

const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const hoy = new Date().toISOString().slice(0, 10);

try {
  // ── Casos compartidos (gemelas SQL = TS) ────────────────────────────────
  if (run("sv1")) {
    console.log("\nsv1 · Casos compartidos contra la base (gemelas)");
    const runCases = (file, label, toSql, expected) => {
      const { cases } = json(file);
      const bad = [];
      // Todos los casos de un archivo en UNA consulta (cada llamada a la CLI tarda segundos).
      const got = sql(`SELECT jsonb_build_array(${cases.map((c) => `to_jsonb(${toSql(c)})`).join(", ")}) AS r`)[0]?.r ?? [];
      cases.forEach((c, i) => {
        if (!eq(got[i], expected(c))) bad.push(`${c.name}: dio ${JSON.stringify(got[i])}`);
      });
      check(bad.length === 0, `${label}: los ${cases.length} casos dan lo mismo que en TypeScript`, bad.slice(0, 3).join(" | "));
    };
    runCases("lib/services/service-settings.cases.json", "validate_service_settings", (c) => `to_jsonb(app_servicio.validate_service_settings(${jlit(c.settings)}, NULL))`, (c) => c.expected);
    runCases("lib/services/auto-creation.cases.json", "svc_rule_met", (c) => `app_servicio.svc_rule_met(${jlit(c.input)})`, (c) => c.expected);
    runCases("lib/services/renewal.cases.json", "svc_renewal_plan", (c) => `app_servicio.svc_renewal_plan(${jlit(c.input)})`, (c) => c.expected);
    runCases("lib/services/extend.cases.json", "svc_extend_plan", (c) => `app_servicio.svc_extend_plan(${jlit(c.input)})`, (c) => c.expected);
    runCases("lib/services/pause.cases.json", "svc_resume_plan", (c) => `app_servicio.svc_resume_plan(${lit(c.pausedAt)}::timestamptz, ${lit(c.now)}::timestamptz, ${c.shiftDays ?? "NULL"})`, (c) => c.expected);
    runCases("lib/services/owner-pick.cases.json", "svc_owner_pick_plan", (c) => `app_servicio.svc_owner_pick_plan(${jlit(c.input)})`, (c) => c.expected);
    runCases("lib/services/conditions.cases.json", "svc_conditions_match", (c) => `app_servicio.svc_conditions_match(${jlit(c.tree)}, ${jlit(c.context)})`, (c) => c.expected);
    runCases("lib/services/light.cases.json", "svc_light", (c) => `app_servicio.svc_light(${jlit(c.input)})`, (c) => c.expected);
    runCases("lib/services/due.cases.json", "svc_due_date", (c) => `to_char(app_servicio.svc_due_date(${jlit(c.rule)}, ${jlit(c.anchors)}), 'YYYY-MM-DD')`, (c) => c.expected);
    runCases("lib/services/advance.cases.json", "svc_phase_should_advance", (c) => `app_servicio.svc_phase_should_advance(${lit(c.input[0])}, ${c.input[1]}, ${c.input[2]}, ${c.input[3]}, ${c.input[4]})`, (c) => c.expected);
    runCases("lib/services/recurrence.cases.json", "svc_occurrence_dates",
      (c) => `app_servicio.svc_occurrence_dates(${jlit(c.recurrence)}, ${lit(c.start)}::date, ${lit(c.phaseEnd)}::date, ${lit(c.serviceEnd)}::date, ${lit(c.upTo)}::date)`, (c) => c.expected);
  }

  // ── Negocio de prueba ───────────────────────────────────────────────────
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-servicios", slug: `zz-test-servicios-${Date.now()}`, timezone: "America/Costa_Rica" }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-servicios-otro", slug: `zz-test-servicios-otro-${Date.now()}` }).select("id").single();
  const owner = await makeUser("svc-owner");
  const admin = await makeUser("svc-admin");
  const member = await makeUser("svc-member");
  const member2 = await makeUser("svc-member2");
  const roleOwn = await makeUser("svc-role-own");
  const roleNone = await makeUser("svc-role-none");
  const outsider = await makeUser("svc-outsider");
  const { data: rOwn } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name: "zz-test Solo ver los suyos", permissions: { keys: ["services.view"], scopes: { services: "own" } } }).select("id").single();
  const { data: rNone } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name: "zz-test Sin servicios", permissions: { keys: ["contacts.view"], scopes: {} } }).select("id").single();
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
    { workspace_id: ws.id, user_id: member2.id, role: "member" },
    { workspace_id: ws.id, user_id: roleOwn.id, role: "member", role_id: rOwn.id },
    { workspace_id: ws.id, user_id: roleNone.id, role: "member", role_id: rNone.id },
    { workspace_id: ws2.id, user_id: outsider.id, role: "owner" },
  ]);

  // Producto, variantes y venta.
  const { data: prod } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test Programa", product_type: "programa" }).select("id").single();
  const mkVariant = async (name, extra = {}) =>
    (await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prod.id, name, price: 1000, duration_type: "months", duration_value: 3, ...extra }).select("id").single()).data;
  const vPlain = await mkVariant("zz-test sin configurar");
  const vMain = await mkVariant("zz-test 12 semanas");
  const newContact = async (t, extra = {}) => (await svc.from("contacts").insert({ workspace_id: ws.id, display_name: `zz-test ${t}`, ...extra }).select("id").single()).data;
  const snapshot = (variantId, price = 1000) => ({ product_id: prod.id, product_name: "zz-test Programa", product_type: "programa", variant_id: variantId, variant_name: "v", price, currency: "USD", duration_type: "months", duration_value: 3, billing_type: "one_time", billing_interval: null, event_date: null });
  const createSale = async (contactId, variantId, payments, over = {}) => {
    const { data, error } = await svc.rpc("create_sale", {
      p_payload: { workspace_id: ws.id, contact_id: contactId, product_variant_id: variantId, product_snapshot: snapshot(variantId), base_amount: 1000, discount_amount: 0,
        financing_type: "reservation_installments", sale_date: ayer, setter_id: null, vendedor_id: null, attribution: { mode: "none" }, payments, ...over },
      p_actor_id: owner.id,
    });
    if (error) throw new Error(`create_sale: ${error.message}`);
    return data.sale_id;
  };
  const sched = (type, amount, due = "2031-01-15") => ({ type, amount, status: "scheduled", due_date: due });
  const markPaid = (paymentId, at = new Date().toISOString(), on = hoy) => svc.from("payments").update({ status: "paid", paid_at: at, paid_on: on, payment_method: "wise" }).eq("id", paymentId);
  const paymentsOf = async (saleId) => (await svc.from("payments").select("id, type, status, amount").eq("sale_id", saleId).order("created_at")).data ?? [];
  const servicesOfSale = (saleId) => sql(`SELECT id, status, owner_user_id, starts_on::text, ends_on::text, origin, flags, previous_service_id FROM app_servicio.services WHERE sale_id = ${lit(saleId)}`);
  const setSettings = (variantId, s) => sql(`UPDATE public.product_variants SET service_settings = ${jlit(s)}, service_settings_rev = service_settings_rev + 1 WHERE id = ${lit(variantId)} RETURNING id`);
  const createRule = (rule, extra = {}) => ({ v: 1, mode: "create", when: { rule, enabled_at: new Date(Date.now() - 60_000).toISOString(), ...extra }, confirm: false, start: "payment_date",
    owner: { mode: "round_robin", members: [member.id, member2.id], fallback_user_id: owner.id }, renewal: "new_linked" });

  if (run("sv1")) {
    console.log("\nsv1 · El interruptor y la guardia (F97, SV003)");
    check(sql(`SELECT services_enabled FROM public.workspaces WHERE id = ${lit(ws.id)}`)[0]?.services_enabled === false, "un negocio nuevo nace con el modulo apagado");
    const g1 = asUser(owner.id, `SELECT 1 FROM (SELECT 1) x WHERE false UNION ALL SELECT 1 FROM public.workspaces WHERE false`);
    void g1;
    const upd = asUser(owner.id, `WITH u AS (UPDATE public.workspaces SET services_enabled = true WHERE id = ${lit(ws.id)} RETURNING 1) SELECT count(*) n FROM u`);
    check(!upd.ok && /SV003|desde sus pantallas/.test(upd.error), "un UPDATE de services_enabled con una sesion authenticated se rechaza (SV003)", upd.error);
    setSettings(vMain.id, createRule("any_payment"));
    const updVar = asUser(owner.id, `WITH u AS (UPDATE public.product_variants SET service_settings = '{}'::jsonb WHERE id = ${lit(vMain.id)} RETURNING 1) SELECT count(*) n FROM u`);
    check(!updVar.ok && /SV003|desde sus pantallas/.test(updVar.error), "un UPDATE directo de service_settings con una sesion se rechaza (SV003)", updVar.error);
    const insVar = asUser(owner.id, `WITH i AS (INSERT INTO public.product_variants (workspace_id, product_id, name, service_settings) VALUES (${lit(ws.id)}, ${lit(prod.id)}, 'zz-test alta de sesion', '{"mode":"create"}'::jsonb) RETURNING service_settings) SELECT service_settings FROM i`);
    check(insVar.ok && eq(insVar.row?.service_settings, {}), "un INSERT de una sesion deja la configuracion en su default (sin fallar)", insVar.error);

    console.log("\nsv1 · Con el modulo apagado, cobrar no crea servicios (F97)");
    const cOff = await newContact("modulo apagado");
    const saleOff = await createSale(cOff.id, vMain.id, [sched("full", 1000)], { financing_type: "full" });
    const [pOff] = await paymentsOf(saleOff);
    await markPaid(pOff.id);
    check(servicesOfSale(saleOff).length === 0, "una variante configurada con el modulo apagado no crea el servicio");

    const on = sql(`SELECT app_servicio.set_module_enabled(${lit(ws.id)}, true) r`)[0]?.r;
    check(on?.enabled === true && on?.changed === true, "set_module_enabled lo prende (solo service_role) y lo deja en el historial");
    check(sql(`SELECT count(*)::int n FROM public.audit_log WHERE entity_id = ${lit(ws.id)} AND action = 'svc.module_toggled'`)[0]?.n === 1, "queda svc.module_toggled en audit_log");
    const asAuth = asUser(owner.id, `SELECT app_servicio.set_module_enabled(${lit(ws.id)}, false) r`);
    check(!asAuth.ok, "una sesion no puede llamar a set_module_enabled", asAuth.error);

    console.log("\nsv1 · Un producto sin configurar vende exactamente igual");
    const cPlain = await newContact("sin configurar");
    const salePlain = await createSale(cPlain.id, vPlain.id, [sched("reservation", 300, ayer), sched("installment", 700)]);
    const pp = await paymentsOf(salePlain);
    await markPaid(pp[0].id);
    const { data: sp } = await svc.from("sales").select("status").eq("id", salePlain).single();
    check(sp?.status === "reserved", "la venta queda reservada como siempre", sp?.status);
    check(servicesOfSale(salePlain).length === 0, "no crea ningun servicio");
    await markPaid(pp[1].id);
    const { data: sp2 } = await svc.from("sales").select("status").eq("id", salePlain).single();
    check(sp2?.status === "paid", "y al cobrar el saldo queda pagada, igual que antes", sp2?.status);
    check(sql(`SELECT count(*)::int n FROM public.audit_log WHERE action = 'svc.hook_failed' AND workspace_id = ${lit(ws.id)}`)[0]?.n === 0, "ningun enganche fallo");

    console.log("\nsv1 · Creacion automatica al cobrar (F6)");
    setSettings(vMain.id, createRule("non_reservation"));
    const cA = await newContact("reserva y saldo");
    const saleA = await createSale(cA.id, vMain.id, [sched("reservation", 300, ayer), sched("installment", 700)]);
    const pa = await paymentsOf(saleA);
    await markPaid(pa[0].id);
    check(servicesOfSale(saleA).length === 0, "non_reservation: cobrar la reserva no crea el servicio");
    await markPaid(pa[1].id, new Date().toISOString(), hoy);
    const sA = servicesOfSale(saleA);
    check(sA.length === 1 && sA[0].status === "active" && sA[0].starts_on === hoy, "cobrar el saldo lo crea activo con inicio = fecha del pago", JSON.stringify(sA));
    check(sA[0] && [member.id, member2.id].includes(sA[0].owner_user_id), "el responsable sale del reparto de la variante");

    setSettings(vMain.id, createRule("percent", { value: 50 }));
    const cP = await newContact("porcentaje");
    const saleP = await createSale(cP.id, vMain.id, [sched("installment", 400), sched("installment", 100), sched("installment", 500)], { financing_type: "installments" });
    const ppp = await paymentsOf(saleP);
    await markPaid(ppp[0].id);
    check(servicesOfSale(saleP).length === 0, "percent 50: con 400 de 1000 no lo crea");
    await markPaid(ppp[1].id);
    check(servicesOfSale(saleP).length === 1, "con 100 mas (500 de 1000) lo crea");

    console.log("\nsv1 · Dos pagos a la vez: un solo servicio");
    setSettings(vMain.id, createRule("any_payment"));
    const cC = await newContact("concurrencia");
    const saleC = await createSale(cC.id, vMain.id, [sched("installment", 500), sched("installment", 500)], { financing_type: "installments" });
    const pc = await paymentsOf(saleC);
    await Promise.all(pc.map((p) => sqlAsync(`UPDATE public.payments SET status = 'paid', paid_at = now(), paid_on = current_date, payment_method = 'wise' WHERE id = ${lit(p.id)}`)));
    check(servicesOfSale(saleC).length === 1, "dos pagos cobrados en paralelo crean un solo servicio");

    console.log("\nsv1 · Un pago viejo que se vuelve a escribir no crea servicio (F6, regla 2)");
    const cOld = await newContact("pago viejo");
    const saleOld = await createSale(cOld.id, vMain.id, [sched("full", 1000)], { financing_type: "full" });
    const [pOld] = await paymentsOf(saleOld);
    await markPaid(pOld.id, "2026-03-10T15:00:00Z", "2026-03-10");
    check(servicesOfSale(saleOld).length === 0, "un pago cobrado antes de prender la regla no crea el servicio");

    console.log("\nsv1 · ¿Venta repetida? (§14f)");
    const saleDup = await createSale(cA.id, vMain.id, [sched("full", 1000)], { financing_type: "full" });
    const [pDup] = await paymentsOf(saleDup);
    await markPaid(pDup.id);
    const sDup = servicesOfSale(saleDup);
    check(sDup.length === 1 && sDup[0].status === "pending_confirmation" && sDup[0].flags?.possible_duplicate === true, "la segunda nace por confirmar con la marca de venta repetida", JSON.stringify(sDup));

    console.log("\nsv1 · Cancelacion, reembolso y pagos revertidos (F10)");
    const { error: cancelErr } = await svc.from("sales").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: "zz-test arrepentido" }).eq("id", saleP);
    check(!cancelErr, "la venta se cancela igual", cancelErr?.message);
    check(servicesOfSale(saleP)[0]?.status === "cancelled", "y su servicio queda cancelado con el motivo");
    const sAid = sA[0].id;
    await svc.from("payments").update({ status: "scheduled", paid_at: null, paid_on: null, revert_reason: "zz-test" }).eq("id", pa[1].id);
    check(servicesOfSale(saleA)[0]?.status === "active", "un pago revertido deja el servicio como estaba");
    check(sql(`SELECT count(*)::int n FROM public.notifications WHERE entity_id = ${lit(sAid)} AND type = 'svc_payment_reverted'`)[0]?.n >= 1, "y avisa (svc_payment_reverted)");

    console.log("\nsv1 · Crear a mano (F8)");
    const cM = await newContact("cortesia");
    const noReason = asUser(owner.id, `SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(cM.id)}, 'variant_id', ${lit(vMain.id)}, 'origin', 'courtesy')) id`);
    check(!noReason.ok && /SV012|motivo/.test(noReason.error), "cortesia sin venta y sin motivo se rechaza (SV012)", noReason.error);
    const dupSale = asUser(owner.id, `SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(cA.id)}, 'variant_id', ${lit(vMain.id)}, 'sale_id', ${lit(saleA)}, 'origin', 'sale')) id`);
    check(!dupSale.ok && /SV013|ya tiene su servicio/.test(dupSale.error) && dupSale.error.includes(sAid), "una venta que ya tiene servicio se rechaza (SV013) con el id del existente", dupSale.error);
    const byMember = asUser(member.id, `SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(cM.id)}, 'variant_id', ${lit(vMain.id)}, 'origin', 'courtesy', 'origin_reason', 'x')) id`);
    check(!byMember.ok && /SV004|permiso/.test(byMember.error), "un Member no crea servicios (services.create)", byMember.error);
    const created = sql(`SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(cM.id)}, 'variant_id', ${lit(vMain.id)}, 'origin', 'courtesy', 'origin_reason', 'zz-test regalo', 'owner_user_id', ${lit(member.id)})) id`)[0]?.id;
    const snap = sql(`SELECT product_snapshot ->> 'product_name' n, price_cents FROM app_servicio.services WHERE id = ${lit(created)}`)[0];
    await svc.from("products").update({ name: "zz-test Programa renombrado" }).eq("id", prod.id);
    check(snap?.n === "zz-test Programa" && Number(snap?.price_cents) === 100000, "guarda la foto del producto y el precio del momento");
    check(sql(`SELECT product_snapshot ->> 'product_name' n FROM app_servicio.services WHERE id = ${lit(created)}`)[0]?.n === "zz-test Programa", "renombrar el producto despues no cambia el servicio");

    console.log("\nsv1 · Visibilidad (F4): Owner, Admin, Member, rol con services.view own y rol sin la clave");
    const visible = (uid) => asUser(uid, `SELECT count(*)::int n FROM app_servicio.services WHERE workspace_id = ${lit(ws.id)}`).row?.n ?? -1;
    const total = sql(`SELECT count(*)::int n FROM app_servicio.services WHERE workspace_id = ${lit(ws.id)}`)[0]?.n;
    check(visible(owner.id) === total && visible(admin.id) === total, `Owner y Admin ven los ${total}`);
    const memberOwn = sql(`SELECT count(*)::int n FROM app_servicio.services s LEFT JOIN public.contacts c ON c.id = s.contact_id WHERE s.workspace_id = ${lit(ws.id)} AND (s.owner_user_id = ${lit(member.id)} OR c.setter_id = ${lit(member.id)} OR c.vendedor_id = ${lit(member.id)})`)[0]?.n;
    check(visible(member.id) === memberOwn, `un Member ve solo los suyos (${memberOwn})`);
    check(visible(roleOwn.id) === 0, "un rol con services.view own ve solo donde esta (ninguno)");
    await svc.from("contacts").update({ setter_id: roleOwn.id }).eq("id", cM.id);
    check(visible(roleOwn.id) === 1, "y al ser setter del contacto ve ese servicio");
    check(visible(roleNone.id) === 0, "un rol sin la clave no ve ninguno");
    check(visible(outsider.id) === 0, "alguien de otro negocio no ve ninguno");
    const ins = asUser(owner.id, `WITH i AS (INSERT INTO app_servicio.services (workspace_id, contact_id, product_id, origin, status, product_snapshot) VALUES (${lit(ws.id)}, ${lit(cM.id)}, ${lit(prod.id)}, 'manual', 'pending_confirmation', '{}'::jsonb) RETURNING 1) SELECT count(*) n FROM i`);
    check(!ins.ok, "nadie inserta directo en services (ni el Owner)");
    const updS = asUser(owner.id, `WITH u AS (UPDATE app_servicio.services SET status = 'cancelled' WHERE id = ${lit(created)} RETURNING 1) SELECT count(*)::int n FROM u`);
    check(!updS.ok || updS.row?.n === 0, "ni actualiza", updS.error);
    check(sql(`SELECT app_servicio.can_see_service(gen_random_uuid()) v`)[0]?.v === false, "can_see_service con un id que no existe da false (nunca NULL)");

    console.log("\nsv1 · Confirmar y descartar (F7)");
    const pendingId = sDup[0]?.id;
    const conf2 = asUser(owner.id, `SELECT app_servicio.svc_confirm_service(${lit(created)}, NULL, NULL) r`);
    check(!conf2.ok && /SV010/.test(conf2.error), "confirmar uno que no esta por confirmar se rechaza (SV010)", conf2.error);
    const disc = asUser(owner.id, `SELECT app_servicio.svc_discard_service(${lit(pendingId)}, '') r`);
    check(!disc.ok && /SV011/.test(disc.error), "descartar sin motivo se rechaza (SV011)", disc.error);
    sql(`SELECT app_servicio.svc_confirm_service(${lit(pendingId)}, NULL, ${lit(member.id)})`);
    check(sql(`SELECT status FROM app_servicio.services WHERE id = ${lit(pendingId)}`)[0]?.status === "active", "confirmar lo deja activo");

    console.log("\nsv1 · Renovacion (F9) y extension por variante (F115)");
    const cR = await newContact("renovacion");
    const prevId = sql(`SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(cR.id)}, 'variant_id', ${lit(vMain.id)}, 'origin', 'manual', 'origin_reason', 'zz', 'owner_user_id', ${lit(member.id)}, 'starts_on', '2026-10-01', 'ends_on', '2026-12-31')) id`)[0]?.id;
    const saleR = await createSale(cR.id, vMain.id, [sched("full", 1000)], { financing_type: "full" });
    const [pR] = await paymentsOf(saleR);
    await markPaid(pR.id, new Date().toISOString(), "2026-12-15");
    const sR = servicesOfSale(saleR);
    check(sR.length === 1 && sR[0].starts_on === "2027-01-01" && sR[0].previous_service_id === prevId, "new_linked: el nuevo empieza el 1/1 enlazado al anterior", JSON.stringify(sR));
    const vRenew = await mkVariant("zz-test Renovacion 3 meses");
    setSettings(vRenew.id, { v: 1, mode: "extend", when: { rule: "any_payment", enabled_at: new Date(Date.now() - 60_000).toISOString() },
      extend: { target_variant_ids: null, n: 3, unit: "months", extend_accesses: false, if_no_service: "confirm", fallback_variant_id: vMain.id } });
    const cE = await newContact("extiende");
    const baseE = sql(`SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(cE.id)}, 'variant_id', ${lit(vMain.id)}, 'origin', 'manual', 'origin_reason', 'zz', 'owner_user_id', ${lit(member.id)}, 'starts_on', '2026-10-01', 'ends_on', '2026-12-31')) id`)[0]?.id;
    const saleE = await createSale(cE.id, vRenew.id, [sched("full", 1000)], { financing_type: "full" });
    const [pE] = await paymentsOf(saleE);
    await markPaid(pE.id);
    const after = sql(`SELECT ends_on::text e, extension_sale_ids FROM app_servicio.services WHERE id = ${lit(baseE)}`)[0];
    check(after?.e === "2027-03-31" && servicesOfSale(saleE).length === 0, "una variante extend corre el fin 3 meses (31/3) y no crea otro servicio", JSON.stringify(after));
    const cNo = await newContact("renovacion sin servicio");
    const saleNo = await createSale(cNo.id, vRenew.id, [sched("full", 1000)], { financing_type: "full" });
    const [pNo] = await paymentsOf(saleNo);
    await markPaid(pNo.id);
    const sNo = servicesOfSale(saleNo);
    check(sNo.length === 1 && sNo[0].status === "pending_confirmation" && sNo[0].flags?.renewal_without_previous === true, "sin servicio para extender nace por confirmar con la variante de respaldo", JSON.stringify(sNo));

    console.log("\nsv1 · Extender, pausar y reanudar (F93, F94)");
    sql(`UPDATE app_servicio.services SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'zz' WHERE id = ${lit(created)}`);
    const extCancel = asUser(owner.id, `SELECT app_servicio.svc_extend(${lit(created)}, '{"mode":"period","n":3,"unit":"days","kind":"bonus","reason":"zz"}'::jsonb) r`);
    check(!extCancel.ok && /SV030/.test(extCancel.error), "extender un cancelado se rechaza (SV030)", extCancel.error);
    // 12 dias menos 5 minutos: con el redondeo hacia arriba del plano (F94) son 12, aunque la reanudacion tarde unos segundos.
    sql(`SELECT app_servicio.svc_pause(${lit(baseE)}, '{"reason":"zz-test viaje","cut_access":true}'::jsonb)`);
    sql(`UPDATE app_servicio.services SET paused_at = now() - interval '12 days' + interval '5 minutes' WHERE id = ${lit(baseE)}`);
    const res = sql(`SELECT app_servicio.svc_resume(${lit(baseE)}, '{}'::jsonb) r`)[0]?.r;
    check(res?.shift_days === 12 && res?.ends_on === "2027-04-12", "una pausa de 12 dias corre el fin 12 dias", JSON.stringify(res));
    check(sql(`SELECT paused_days FROM app_servicio.services WHERE id = ${lit(baseE)}`)[0]?.paused_days === 12, "y suma paused_days");

    console.log("\nsv1 · Un enganche que falla no tumba el pago");
    const cF = await newContact("falla");
    setSettings(vMain.id, { ...createRule("any_payment"), owner: { mode: "fixed", user_id: member2.id, fallback_user_id: member2.id } });
    await svc.from("workspace_members").delete().eq("workspace_id", ws.id).eq("user_id", member2.id);
    const saleF = await createSale(cF.id, vMain.id, [sched("full", 1000)], { financing_type: "full" });
    const [pF] = await paymentsOf(saleF);
    const { error: payErr } = await markPaid(pF.id);
    const { data: pFr } = await svc.from("payments").select("status").eq("id", pF.id).single();
    check(!payErr && pFr?.status === "paid", "sin nadie para responsable, el pago queda cobrado igual", payErr?.message);
    check(sql(`SELECT count(*)::int n FROM public.audit_log WHERE workspace_id = ${lit(ws.id)} AND action = 'svc.hook_failed'`)[0]?.n >= 1, "y queda svc.hook_failed con el aviso");

    console.log("\nsv1 · Apagar el modulo dice cuantos activos quedan");
    const off = sql(`SELECT app_servicio.set_module_enabled(${lit(ws.id)}, false) r`)[0]?.r;
    check(off?.changed === true && off?.active_services > 0 && /quedan como están/.test(off?.message ?? ""), "devuelve cuantos servicios activos quedan y el aviso", JSON.stringify(off));
  }

  if (run("sv2")) {
    console.log("\nsv2 · El camino del cliente (F13-F24)");
    sql(`SELECT app_servicio.set_module_enabled(${lit(ws.id)}, true)`);
    // Lo que el camino usa: un formulario con su version y un tipo de reunion.
    const { data: form } = await svc.from("forms").insert({ workspace_id: ws.id, name: "zz-test Diagnostico", type: "custom", slug: `zz-test-diag-${Date.now()}` }).select("id").single();
    const { data: fver } = await svc.from("form_versions").insert({ workspace_id: ws.id, form_id: form.id, version_number: 1, definition: { fields: [] } }).select("id").single();
    const { data: cat } = await svc.from("booking_categories").insert({ workspace_id: ws.id, name: "zz-test Servicio" }).select("id").single();
    const { data: evt } = await svc.from("event_types").insert({ workspace_id: ws.id, category_id: cat.id, owner_user_id: owner.id, title: "zz-test Sesion", slug: `zz-test-sesion-${Date.now()}` }).select("id").single();
    const vJ = await mkVariant("zz-test Con camino");
    const template = {
      v: 1,
      phases: [
        { key: "ph_aaaaa1", name: "Onboarding", advance: "auto", items: [
          { key: "it_aaaaa1", kind: "form", name: "Diagnostico", ref: { form_id: form.id } },
          { key: "it_aaaaa2", kind: "checkbox", name: "Llamada de bienvenida", assignee: "owner" },
        ] },
        { key: "ph_aaaaa2", name: "Trabajo", advance: "manual", items: [
          { key: "it_aaaaa3", kind: "booking", name: "Sesion 1", ref: { event_type_id: evt.id, complete_on: "booked" } },
          { key: "it_aaaaa4", kind: "team_task", name: "Revisar el plan", assignee: "owner" },
        ] },
      ],
    };
    const badTpl = sqlErr(`UPDATE public.product_variants SET journey_template = ${jlit({ v: 1, phases: [{ key: "ph_x", name: "", items: [] }] })} WHERE id = ${lit(vJ.id)}`) ?? "";
    check(/SV001/.test(badTpl), "un camino invalido se rechaza en la base (SV001)", badTpl.slice(0, 200));
    sql(`UPDATE public.product_variants SET journey_template = ${jlit(template)}, journey_template_rev = journey_template_rev + 1 WHERE id = ${lit(vJ.id)}`);

    const cJ = await newContact("camino");
    const sJ = sql(`SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(cJ.id)}, 'variant_id', ${lit(vJ.id)}, 'origin', 'manual', 'origin_reason', 'zz-test', 'owner_user_id', ${lit(member.id)})) id`)[0]?.id;
    const phases = () => sql(`SELECT template_key k, status FROM app_servicio.service_phases WHERE service_id = ${lit(sJ)} ORDER BY position`);
    const items = () => Object.fromEntries(sql(`SELECT template_key k, status, task_id FROM app_servicio.service_items WHERE service_id = ${lit(sJ)}`).map((r) => [r.k, r]));
    const progress = () => sql(`SELECT progress_pct p FROM app_servicio.services WHERE id = ${lit(sJ)}`)[0]?.p;
    check(eq(phases(), [{ k: "ph_aaaaa1", status: "in_progress" }, { k: "ph_aaaaa2", status: "pending" }]), "crear el servicio copia el camino: la primera fase en curso", JSON.stringify(phases()));
    check(Object.keys(items()).length === 4 && Number(progress()) === 0, "con sus cuatro pasos pendientes y el avance en 0", JSON.stringify(items()));

    const itemId = (k) => sql(`SELECT id FROM app_servicio.service_items WHERE service_id = ${lit(sJ)} AND template_key = ${lit(k)}`)[0]?.id;
    // asUser corre en una transaccion que se deshace: aca se prueba que la base LE PERMITE tildarlo (devuelve true);
    // despues se tilda de verdad para probar el avance.
    const doneByMember = asUser(member.id, `SELECT app_servicio.svc_complete_item(${lit(itemId("it_aaaaa2"))}) r`);
    check(doneByMember.ok && doneByMember.row?.r === true, "el responsable (Member) puede tildar un paso a su cargo", doneByMember.error ?? JSON.stringify(doneByMember.row));
    sql(`SELECT app_servicio.svc_complete_item(${lit(itemId("it_aaaaa2"))})`);
    check(items().it_aaaaa2.status === "completed", "el paso queda completado");
    check(Number(progress()) > 0, "el avance lo calcula la base (progress_pct)", String(progress()));
    const notMine = asUser(member2.id, `SELECT app_servicio.svc_complete_item(${lit(itemId("it_aaaaa1"))}) r`);
    check(!notMine.ok, "un Member que no ve el servicio no puede tildar sus pasos", notMine.error);
    sql(`SELECT app_servicio.svc_uncomplete_item(${lit(itemId("it_aaaaa2"))})`);
    check(items().it_aaaaa2.status === "pending", "destildar lo vuelve a pendiente");
    sql(`SELECT app_servicio.svc_complete_item(${lit(itemId("it_aaaaa2"))})`);

    const hasTrigger = (t) => sql(`SELECT count(*)::int n FROM pg_trigger WHERE tgname = ${lit(t)}`)[0]?.n === 1;
    if (hasTrigger("trg_app_servicio_submission")) {
      console.log("\nsv2 · Completado automatico (F17-F20)");
      const insertSubmission = (contactId, meta = {}) => sql(`INSERT INTO public.form_submissions (workspace_id, form_id, form_version_id, idempotency_key, status, answers, contact_id, meta)
        VALUES (${lit(ws.id)}, ${lit(form.id)}, ${lit(fver.id)}, gen_random_uuid(), 'received', '{}'::jsonb, ${lit(contactId)}, ${jlit(meta)}) RETURNING id, service_item_id`)[0];
      const otherContact = await newContact("otro contacto");
      const foreign = insertSubmission(otherContact.id, { service_item_id: itemId("it_aaaaa1") });
      check(foreign?.service_item_id === null && items().it_aaaaa1.status === "pending", "un paso firmado de OTRO contacto se descarta y no completa nada");
      const sub = insertSubmission(cJ.id);
      check(items().it_aaaaa1.status === "completed", "la respuesta del formulario completa el paso");
      check(eq(phases(), [{ k: "ph_aaaaa1", status: "completed" }, { k: "ph_aaaaa2", status: "in_progress" }]), "con la fase completa, avanza sola a la siguiente (advance: auto)", JSON.stringify(phases()));
      const tampered = sqlErr(`UPDATE public.form_submissions SET service_item_id = gen_random_uuid() WHERE id = ${lit(sub.id)}`);
      check(sql(`SELECT service_item_id FROM public.form_submissions WHERE id = ${lit(sub.id)}`)[0]?.service_item_id === null && !tampered, "service_item_id no se puede cambiar despues (sin clave foranea, lo cuida el trigger)", tampered ?? "");
      const ev = sql(`SELECT event_type, payload FROM public.automation_events WHERE workspace_id = ${lit(ws.id)} AND (payload ->> 'service_id') = ${lit(sJ)}`);
      const types = new Set(ev.map((e) => e.event_type));
      check(["service_item_completed", "service_phase_completed", "service_phase_started"].every((t) => types.has(t)), "emite los eventos del camino", [...types].join(","));
      check(ev.every((e) => !("booking_id" in (e.payload ?? {}))), "los eventos nunca llevan booking_id");

      // La tarea del equipo (team_task) nace con la fase y completarla tilda el paso.
      const taskId = items().it_aaaaa4.task_id;
      check(!!taskId, "el paso de equipo crea su tarea al abrir la fase", JSON.stringify(items().it_aaaaa4));
      if (taskId) {
        await svc.from("tasks").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", taskId);
        check(items().it_aaaaa4.status === "completed", "completar la tarea completa el paso");
        await svc.from("tasks").update({ status: "pending", completed_at: null }).eq("id", taskId);
        check(items().it_aaaaa4.status === "pending", "reabrir la tarea lo vuelve a pendiente");
      }

      // La reunion agendada completa su paso (complete_on: booked).
      const start = new Date(Date.now() + 7 * 86_400_000);
      const { error: bErr } = await svc.from("bookings").insert({ workspace_id: ws.id, uid: `zz-test-${randomUUID()}`, event_type_id: evt.id, host_user_id: owner.id, contact_id: cJ.id, title: "zz-test Sesion",
        start_at: start.toISOString(), end_at: new Date(start.getTime() + 3_600_000).toISOString(), origin: "manual", status: "scheduled" });
      check(!bErr && items().it_aaaaa3.status === "completed", "agendar la reunion completa su paso", bErr?.message);

      console.log("\nsv2 · Un enganche que falla no tumba lo que lo origina");
      // Se rompe el modulo adentro de una transaccion que se deshace: el insert/update tiene que pasar igual.
      const forced = (label, statement, entity) => {
        const r = sqlErrOrRows(`BEGIN;
          ALTER TABLE app_servicio.service_items RENAME TO service_items_zz_forzado;
          ${statement};
          SELECT (SELECT count(*)::int FROM public.audit_log WHERE workspace_id = ${lit(ws.id)} AND action = 'svc.hook_failed' AND changes ->> 'hook' = ${lit(entity)}) AS n;
          ROLLBACK;`, label);
        return r;
      };
      const rows = (r) => r?.[0]?.n ?? -1;
      check(rows(forced("formulario", `INSERT INTO public.form_submissions (workspace_id, form_id, form_version_id, idempotency_key, status, answers, contact_id, meta)
        VALUES (${lit(ws.id)}, ${lit(form.id)}, ${lit(fver.id)}, gen_random_uuid(), 'received', '{}'::jsonb, ${lit(cJ.id)}, '{}'::jsonb)`, "form_submission")) >= 1,
        "una respuesta se guarda aunque el modulo falle, y queda svc.hook_failed");
      const start2 = new Date(Date.now() + 9 * 86_400_000);
      check(rows(forced("reunion", `INSERT INTO public.bookings (workspace_id, uid, event_type_id, host_user_id, contact_id, title, start_at, end_at, origin, status)
        VALUES (${lit(ws.id)}, 'zz-test-forzado', ${lit(evt.id)}, ${lit(owner.id)}, ${lit(cJ.id)}, 'zz-test', ${lit(start2.toISOString())}::timestamptz, ${lit(new Date(start2.getTime() + 3_600_000).toISOString())}::timestamptz, 'manual', 'scheduled')`, "booking")) >= 1,
        "una reunion se agenda aunque el modulo falle");
      {
        // La venta: su enganche lee services. Con la tabla rota, cancelar la venta tiene que pasar igual.
        const cSale = await newContact("venta con modulo roto");
        const saleX = await createSale(cSale.id, vPlain.id, [sched("full", 1000)], { financing_type: "full" });
        const r = sqlErrOrRows(`BEGIN;
          ALTER TABLE app_servicio.services RENAME TO services_zz_forzado;
          UPDATE public.sales SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'zz-test' WHERE id = ${lit(saleX)};
          SELECT (SELECT status FROM public.sales WHERE id = ${lit(saleX)}) AS st;
          ROLLBACK;`, "venta");
        check(r?.[0]?.st === "cancelled", "una venta se cancela aunque el modulo falle", JSON.stringify(r));
      }
      if (taskId) {
        check(rows(forced("tarea", `UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = ${lit(taskId)}`, "task")) >= 1, "una tarea se completa aunque el modulo falle");
      }

      console.log("\nsv2 · Con el modulo apagado no se completa nada");
      sql(`SELECT app_servicio.set_module_enabled(${lit(ws.id)}, false)`);
      const cOff2 = await newContact("camino apagado");
      sql(`SELECT app_servicio.set_module_enabled(${lit(ws.id)}, true)`);
      const sOff = sql(`SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(cOff2.id)}, 'variant_id', ${lit(vJ.id)}, 'origin', 'manual', 'origin_reason', 'zz-test', 'owner_user_id', ${lit(member.id)})) id`)[0]?.id;
      sql(`SELECT app_servicio.set_module_enabled(${lit(ws.id)}, false)`);
      const subOff = insertSubmission(cOff2.id);
      check(!!subOff && sql(`SELECT status FROM app_servicio.service_items WHERE service_id = ${lit(sOff)} AND template_key = 'it_aaaaa1'`)[0]?.status === "pending", "la respuesta se guarda y el paso queda como estaba");
      sql(`SELECT app_servicio.set_module_enabled(${lit(ws.id)}, true)`);
    } else {
      console.log("  (sin la 00335 todavia: el completado automatico se prueba despues de aplicarla)");
    }

    if (sql(`SELECT count(*)::int n FROM pg_policies WHERE policyname = 'audit_log_select_services'`)[0]?.n === 1) {
      console.log("\nsv2 · El historial del servicio (00336)");
      const seen = (uid) => asUser(uid, `SELECT count(*)::int n FROM public.audit_log WHERE workspace_id = ${lit(ws.id)} AND entity_type IN ('service','service_item') AND (entity_id = ${lit(sJ)} OR (changes ->> 'service_id') = ${lit(sJ)})`).row?.n ?? -1;
      check(seen(member.id) > 0, "el responsable (Member) ve el historial de su servicio");
      check(seen(member2.id) === 0, "otro Member que no ve el servicio no ve su historial");
      check(seen(outsider.id) === 0, "alguien de otro negocio tampoco");
      const ck = sql(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'triggers_type_check'`)[0]?.d ?? "";
      check(["keyword", "form_submitted", "task_completed", "service_created", "portal_access_expired"].every((t) => ck.includes(`'${t}'`)), "el CHECK de triggers.type acepta los viejos y los del modulo");
    }
  }

  if (run("prd")) {
    console.log("\nprd · Configuracion por variante (F114-F117, F31, F32)");
    const { data: prd } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test Mentoria", product_type: "mentoria" }).select("id").single();
    const mk = async (name) => (await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prd.id, name, price: 500, duration_type: "months", duration_value: 1 }).select("id, service_settings_rev, journey_template_rev, portal_settings_rev").single()).data;
    const vA = await mk("zz-test A");
    const vB = await mk("zz-test B");
    const rev = (id, col) => sql(`SELECT ${col} r FROM public.product_variants WHERE id = ${lit(id)}`)[0]?.r;

    const settingsA = { v: 1, mode: "create", when: { rule: "any_payment" }, confirm: false, start: "payment_date", owner: { mode: "fixed", user_id: member.id, fallback_user_id: owner.id }, renewal: "new_linked" };
    const save1 = await rpcAs(owner, "svc_save_service_settings", { p_variant_id: vA.id, p_settings: settingsA, p_rev: rev(vA.id, "service_settings_rev") });
    check(!save1.error && save1.data?.status === "ok", "el Owner guarda la configuracion de la variante (por la API, con su sesion)", save1.error ?? JSON.stringify(save1.data));
    check(sql(`SELECT service_settings ->> 'mode' m FROM public.product_variants WHERE id = ${lit(vA.id)}`)[0]?.m === "create", "y queda guardada");
    const stale = await rpcAs(owner, "svc_save_service_settings", { p_variant_id: vA.id, p_settings: settingsA, p_rev: 0 });
    check(!stale.error && stale.data?.status === "conflict", "con una version vieja responde conflict (no pisa)", stale.error ?? JSON.stringify(stale.data));
    const bad = await rpcAs(owner, "svc_save_service_settings", { p_variant_id: vA.id, p_settings: { v: 1, mode: "extend", when: { rule: "any_payment" }, extend: { n: 3, unit: "months" } }, p_rev: rev(vA.id, "service_settings_rev") });
    check(!bad.error && bad.data?.status === "invalid" && (bad.data?.problems ?? []).length > 0, "extend sin variante de respaldo se rechaza con sus problemas", bad.error ?? JSON.stringify(bad.data));
    const byMember = asUser(member.id, `SELECT app_servicio.svc_save_service_settings(${lit(vB.id)}, ${jlit(settingsA)}, ${rev(vB.id, "service_settings_rev")}) r`);
    check(!byMember.ok && /SV004|permiso/.test(byMember.error), "un Member no configura variantes (services.configure)", byMember.error);

    const tplA = { v: 1, phases: [{ key: "ph_bbbbb1", name: "Inicio", duration_days: 30, advance: "auto", items: [{ key: "it_bbbbb1", kind: "checkbox", name: "Arranque" }] }] };
    const saveTpl = await rpcAs(admin, "svc_save_journey_template", { p_variant_id: vA.id, p_template: tplA, p_rev: rev(vA.id, "journey_template_rev") });
    check(!saveTpl.error && saveTpl.data?.status === "ok", "el Admin guarda el camino con su version", saveTpl.error ?? JSON.stringify(saveTpl.data));

    console.log("\nprd · El portal de la variante y products.portal_enabled (F116)");
    const portalOf = () => sql(`SELECT portal_enabled e FROM public.products WHERE id = ${lit(prd.id)}`)[0]?.e;
    check(portalOf() === false, "un producto nace sin portal");
    const savePortal = (v, settings) => rpcAs(owner, "portal_admin_save_variant_portal", { p_variant_id: v.id, p_settings: settings, p_rev: rev(v.id, "portal_settings_rev") });
    const on = await savePortal(vA, { v: 1, enabled: true, sections: [{ section: "program", included: true }] });
    check(!on.error && on.data?.status === "ok" && portalOf() === true, "prender el acceso de una variante prende el portal del producto", on.error ?? JSON.stringify(on.data));
    await savePortal(vB, { v: 1, enabled: true, sections: [] });
    await savePortal(vA, { v: 1, enabled: false, sections: [] });
    check(portalOf() === true, "apagar una variante con otra prendida deja el portal prendido");
    await savePortal(vB, { v: 1, enabled: false, sections: [] });
    check(portalOf() === false, "apagar la ultima lo apaga");
    const notYet = await savePortal(vA, { v: 1, enabled: true, sections: [{ section: "fame", included: true }] });
    check(!notYet.error && notYet.data?.status === "invalid" && JSON.stringify(notYet.data?.problems).includes("Todavía no está disponible"), "una seccion fuera de las disponibles se rechaza", notYet.error ?? JSON.stringify(notYet.data));

    console.log("\nprd · Copiar de otra variante");
    const copied = await rpcAs(owner, "svc_copy_variant_setup", { p_from_variant_id: vA.id, p_to_variant_id: vB.id, p_parts: ["journey", "service"] });
    check(!copied.error && copied.data?.status === "ok", "copia el camino y la configuracion", copied.error ?? JSON.stringify(copied.data));
    const b = sql(`SELECT journey_template -> 'phases' -> 0 ->> 'key' k, journey_template -> 'phases' -> 0 ->> 'name' n, jsonb_array_length(journey_template -> 'phases' -> 0 -> 'items') i, service_settings ->> 'mode' m FROM public.product_variants WHERE id = ${lit(vB.id)}`)[0];
    // La copia arma claves NUEVAS (cada variante con las suyas) y reacomoda las dependencias entre pasos.
    check(b?.n === "Inicio" && b?.i === 1 && /^ph_[a-z0-9]{6}$/.test(b?.k ?? "") && b?.k !== "ph_bbbbb1" && b?.m === "create", "la otra variante queda con el mismo camino (claves nuevas) y el mismo modo", JSON.stringify(b));
    const guard = asUser(owner.id, `WITH u AS (UPDATE public.product_variants SET journey_template = '{"v":1,"phases":[]}'::jsonb WHERE id = ${lit(vB.id)} RETURNING 1) SELECT count(*) n FROM u`);
    check(!guard.ok && /SV003|desde sus pantallas/.test(guard.error), "el camino no se escribe directo con la sesion (SV003)", guard.error);
  }

  if (run("ac")) {
    console.log("\nac · Casos compartidos (gemelas de accesos)");
    const rules = json("lib/portal-admin/access-rule.cases.json");
    const picks = json("lib/portal-admin/access.cases.json");
    const runList = (list, label, toSql, expected) => {
      const got = sql(`SELECT jsonb_build_array(${list.map((c) => `to_jsonb(${toSql(c)})`).join(", ")}) AS r`)[0]?.r ?? [];
      const bad = list.filter((c, i) => !eq(got[i], expected(c))).map((c) => c.name);
      check(bad.length === 0, `${label}: los ${list.length} casos dan lo mismo que en TypeScript`, bad.slice(0, 3).join(" | "));
    };
    runList(rules.window, "portal_access_window", (c) => `app_servicio.portal_access_window(${jlit(c.input)})`, (c) => c.expected);
    runList(rules.until, "portal_access_until_reached", (c) => `app_servicio.portal_access_until_reached(${jlit({ until: c.until, event: c.event })})`, (c) => c.expected);
    runList(picks.cases, "portal_access_pick", (c) => `app_servicio.portal_access_pick(${jlit({ rows: c.rows, now: c.now })})`, (c) => c.expected);

    console.log("\nac · El motor de accesos (F37, F109)");
    sql(`SELECT app_servicio.set_module_enabled(${lit(ws.id)}, true)`);
    const vP = await mkVariant("zz-test Con portal");
    sql(`UPDATE public.product_variants SET journey_template = ${jlit({ v: 1, phases: [
      { key: "ph_por001", name: "Onboarding", advance: "auto", items: [{ key: "it_por001", kind: "checkbox", name: "Bienvenida" }] },
      { key: "ph_por002", name: "Implementacion", advance: "manual", items: [{ key: "it_por002", kind: "checkbox", name: "Plan listo" }] },
    ] })}, journey_template_rev = journey_template_rev + 1 WHERE id = ${lit(vP.id)}`);
    const portalSettings = { v: 1, enabled: true, sections: [
      { section: "program", included: true, opens: { type: "service_start" }, until: { type: "service" } },
      { section: "community", included: true, opens: { type: "service_start" }, until: { type: "months", n: 12 } },
      { section: "assistant", included: true, opens: { type: "phase_completed", ref: "ph_por001" }, until: { type: "service" } },
      { section: "challenge", included: true, opens: { type: "service_start" }, until: { type: "item_completed", ref: "it_por002" } },
    ] };
    const setPortal = sqlErr(`UPDATE public.product_variants SET portal_settings = ${jlit(portalSettings)}, portal_settings_rev = portal_settings_rev + 1 WHERE id = ${lit(vP.id)}`);
    check(setPortal === null, "la variante queda con su portal", setPortal?.slice(0, 300));
    const cP = await newContact("con portal", { email: `zz-test-portal-${Date.now()}@example.test` });
    const sP = sql(`SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(cP.id)}, 'variant_id', ${lit(vP.id)}, 'origin', 'manual', 'origin_reason', 'zz-test', 'owner_user_id', ${lit(member.id)})) id`)[0]?.id;
    const acc = () => Object.fromEntries(sql(`SELECT section, until_type, ends_at, revoked_at, revoke_reason, suspended_pause_at, source FROM app_servicio_portal.portal_access WHERE service_id = ${lit(sP)}`).map((r) => [r.section, r]));
    let a = acc();
    check(!!a.program && !!a.community && !!a.challenge && !a.assistant, "al empezar: Programa, Comunidad y Reto; el Asistente todavía no (no hay fila)", JSON.stringify(Object.keys(a)));
    const months12 = sql(`SELECT ((a.ends_at AT TIME ZONE app_servicio.ws_tz(${lit(ws.id)}))::date = (app_servicio.today_in(${lit(ws.id)}) + interval '12 months')::date) ok FROM app_servicio_portal.portal_access a WHERE a.service_id = ${lit(sP)} AND a.section = 'community'`)[0]?.ok;
    check(months12 === true, "Comunidad «12 meses desde que se abre»: vence en 12 meses, a las 23:59 del negocio");
    check(sql(`SELECT count(*)::int n FROM app_servicio_portal.portal_accounts WHERE contact_id = ${lit(cP.id)}`)[0]?.n === 1, "el primer acceso crea la cuenta del portal (el contacto tiene email)");
    const effective = sql(`SELECT app_servicio.portal_access_effective(${lit(cP.id)}, ${lit(prod.id)}, 'program') id`)[0]?.id;
    check(!!effective, "portal_access_effective devuelve el acceso vigente");

    const itemOf = (k) => sql(`SELECT id FROM app_servicio.service_items WHERE service_id = ${lit(sP)} AND template_key = ${lit(k)}`)[0]?.id;
    sql(`SELECT app_servicio.svc_complete_item(${lit(itemOf("it_por001"))})`);
    a = acc();
    check(!!a.assistant && a.assistant.until_type === "service", "al completar la fase Onboarding se abre el Asistente, hasta lo que dure el servicio", JSON.stringify(a.assistant ?? null));
    sql(`SELECT app_servicio.svc_complete_item(${lit(itemOf("it_por002"))})`);
    a = acc();
    check(!!a.challenge?.revoked_at && a.challenge.revoke_reason === "until_reached", "al completar el paso del «hasta», el Reto queda revocado con until_reached", JSON.stringify(a.challenge));

    console.log("\nac · Pausa, a mano y corte (F38, F40)");
    sql(`SELECT app_servicio.svc_pause(${lit(sP)}, '{"reason":"zz-test","cut_access":true}'::jsonb)`);
    check(!!acc().program.suspended_pause_at, "pausar con corte suspende los accesos (suspendido no es revocado)");
    check(sql(`SELECT app_servicio.portal_access_effective(${lit(cP.id)}, ${lit(prod.id)}, 'program') id`)[0]?.id === null, "y mientras tanto no hay acceso vigente");
    sql(`SELECT app_servicio.svc_resume(${lit(sP)})`);
    check(acc().program.suspended_pause_at === null, "al reanudar vuelven");

    const noReason = asUser(owner.id, `SELECT app_servicio.svc_access_grant_extra(${lit(sP)}, 'calendar', NULL, NULL, ' ') r`);
    check(!noReason.ok && /AC001|motivo/.test(noReason.error), "un acceso extra sin motivo se rechaza (AC001)", noReason.error);
    const extra = await rpcAs(owner, "svc_access_grant_extra", { p_service_id: sP, p_section: "calendar", p_product_id: null, p_ends_on: null, p_reason: "zz-test cortesía" });
    check(!extra.error && acc().calendar?.source === "manual_extra", "con motivo, el Owner da un acceso extra", extra.error);
    const communityId = sql(`SELECT id FROM app_servicio_portal.portal_access WHERE service_id = ${lit(sP)} AND section = 'community'`)[0]?.id;
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const earlier = asUser(owner.id, `SELECT app_servicio.svc_access_extend(${lit(communityId)}, ${lit(tomorrow)}::date, 'zz-test') r`);
    check(!earlier.ok && /AC002/.test(earlier.error), "extender a una fecha anterior se rechaza (AC002)", earlier.error);
    const byMember = asUser(member.id, `SELECT app_servicio.svc_access_grant_extra(${lit(sP)}, 'calendar', NULL, NULL, 'x') r`);
    check(!byMember.ok && /SV004|permiso/.test(byMember.error), "un Member no da accesos (services.access)", byMember.error);

    console.log("\nac · Invitación y vista previa (F41, F42)");
    const sha = (t) => createHash("sha256").update(t).digest("hex");
    const inv1 = await rpcAs(owner, "portal_admin_invite", { p_workspace_id: ws.id, p_contact_id: cP.id });
    check(!inv1.error && inv1.data?.status === "ok" && /^[0-9a-f]{64}$/.test(inv1.data?.token ?? ""), "invitar devuelve el token una sola vez", inv1.error ?? JSON.stringify({ status: inv1.data?.status }));
    const stored = sql(`SELECT invite_token_hash h FROM app_servicio_portal.portal_accounts WHERE contact_id = ${lit(cP.id)}`)[0]?.h;
    check(stored === sha(inv1.data?.token ?? "") && stored !== inv1.data?.token, "la base guarda solo la huella");
    check(sql(`SELECT app_servicio.portal_invite_token_valid(${lit(stored)}) v`)[0]?.v === true, "y la huella vale");
    const inv2 = await rpcAs(owner, "portal_admin_invite", { p_workspace_id: ws.id, p_contact_id: cP.id });
    check(inv2.data?.status === "rate_limited", "reenviar enseguida espera un minuto");
    sql(`UPDATE app_servicio_portal.portal_accounts SET invite_sent_at = now() - interval '2 minutes' WHERE contact_id = ${lit(cP.id)}`);
    const inv3 = await rpcAs(owner, "portal_admin_invite", { p_workspace_id: ws.id, p_contact_id: cP.id });
    check(inv3.data?.status === "ok" && inv3.data?.token !== inv1.data?.token, "reenviar después genera un token nuevo");
    check(sql(`SELECT app_servicio.portal_invite_token_valid(${lit(stored)}) v`)[0]?.v === false && sql(`SELECT app_servicio.portal_invite_token_valid(${lit(sha(inv3.data?.token ?? ""))}) v`)[0]?.v === true, "el anterior deja de valer");
    const memberInv = asUser(member.id, `SELECT app_servicio.portal_admin_invite(${lit(ws.id)}, ${lit(cP.id)}) r`);
    check(!memberInv.ok, "un Member no invita (portal.accounts)", memberInv.error);

    const notSeen = asUser(member2.id, `SELECT app_servicio.portal_admin_create_preview_pass(${lit(ws.id)}, ${lit(cP.id)}) r`);
    check(!notSeen.ok, "un Member que no ve al cliente no puede «Ver como estudiante»", notSeen.error);
    const pass = await rpcAs(owner, "portal_admin_create_preview_pass", { p_workspace_id: ws.id, p_contact_id: cP.id });
    const passRow = pass.data?.token ? sql(`SELECT kind, token_hash, extract(epoch FROM expires_at - now()) secs, preview_user_id FROM app_servicio_portal.portal_sessions WHERE token_hash = ${lit(sha(pass.data.token))}`)[0] : null;
    check(!pass.error && passRow?.kind === "preview_pass" && Number(passRow.secs) <= 61 && Number(passRow.secs) > 30 && passRow.preview_user_id === owner.id, "el pase de vista previa vale 60 segundos y queda a nombre de quien lo pidió", pass.error ?? JSON.stringify(passRow));
    check(sql(`SELECT count(*)::int n FROM public.audit_log WHERE entity_id = ${lit(cP.id)} AND action = 'portal.view_as'`)[0]?.n >= 1, "queda portal.view_as en el historial");
    const accountId = sql(`SELECT id FROM app_servicio_portal.portal_accounts WHERE contact_id = ${lit(cP.id)}`)[0]?.id;
    const susp = await rpcAs(owner, "portal_admin_suspend_account", { p_account_id: accountId, p_reason: "zz-test" });
    check(!susp.error && sql(`SELECT count(*)::int n FROM app_servicio_portal.portal_sessions WHERE account_id = ${lit(accountId)} AND revoked_at IS NULL`)[0]?.n === 0, "suspender la cuenta revoca sus sesiones", susp.error);
    const newEmail = `zz-test-portal-nuevo-${Date.now()}@example.test`;
    sql(`UPDATE public.contacts SET email = ${lit(newEmail)} WHERE id = ${lit(cP.id)}`);
    check(sql(`SELECT email FROM app_servicio_portal.portal_accounts WHERE id = ${lit(accountId)}`)[0]?.email === newEmail, "si cambia el email del contacto, la cuenta lo sigue");

    console.log("\nac · Mora (F39)");
    const vM = await mkVariant("zz-test Con mora");
    sql(`UPDATE public.product_variants SET portal_settings = ${jlit({ v: 1, enabled: true, sections: [{ section: "program", included: true }] })}, portal_settings_rev = portal_settings_rev + 1 WHERE id = ${lit(vM.id)}`);
    setSettings(vM.id, { ...createRule("any_payment"), overdue_cut: { enabled: true, days: 30, restore: true } });
    const cM = await newContact("con mora");
    const late = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const saleM = await createSale(cM.id, vM.id, [sched("reservation", 300, ayer), sched("installment", 700, late)]);
    const pM = await paymentsOf(saleM);
    await markPaid(pM[0].id);
    const sM = servicesOfSale(saleM)[0]?.id;
    check(!!sM && sql(`SELECT count(*)::int n FROM app_servicio_portal.portal_access WHERE service_id = ${lit(sM)}`)[0]?.n === 1, "cobrar crea el servicio con su acceso", String(sM));
    await svc.from("payments").update({ status: "overdue" }).eq("id", pM[1].id);
    const sweep1 = sql(`SELECT app_servicio.svc_overdue_sweep(${lit(ws.id)}) r`)[0]?.r;
    check(sql(`SELECT suspended_overdue_at IS NOT NULL s FROM app_servicio_portal.portal_access WHERE service_id = ${lit(sM)}`)[0]?.s === true, "un pago vencido hace más de 30 días suspende el acceso", JSON.stringify(sweep1));
    await markPaid(pM[1].id);
    sql(`SELECT app_servicio.svc_overdue_sweep(${lit(ws.id)})`);
    check(sql(`SELECT suspended_overdue_at IS NULL s FROM app_servicio_portal.portal_access WHERE service_id = ${lit(sM)}`)[0]?.s === true, "al ponerse al día, vuelve solo (restore)");

    console.log("\nac · Cancelar corta todo, también los extras (F38)");
    sql(`SELECT app_servicio.svc_cancel(${lit(sP)}, 'zz-test')`);
    const live = sql(`SELECT count(*)::int n FROM app_servicio_portal.portal_access WHERE service_id = ${lit(sP)} AND revoked_at IS NULL`)[0]?.n;
    check(live === 0, "al cancelar no queda ningún acceso vigente", String(live));

    console.log("\nac · Un fallo del motor no tumba el camino");
    const cF = await newContact("falla");
    const sF = sql(`SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(cF.id)}, 'variant_id', ${lit(vP.id)}, 'origin', 'manual', 'origin_reason', 'zz-test', 'owner_user_id', ${lit(member.id)})) id`)[0]?.id;
    const forced = sqlErr(`DO $$ DECLARE n int; a int; BEGIN
      ALTER FUNCTION app_servicio.svc_apply_access_event(uuid, text, text) RENAME TO zz_svc_apply_access_event_off;
      UPDATE app_servicio.service_phases SET status = 'completed', completed_at = now() WHERE service_id = ${lit(sF)} AND status = 'in_progress';
      GET DIAGNOSTICS n = ROW_COUNT;
      SELECT count(*) INTO a FROM public.audit_log WHERE entity_id = ${lit(sF)} AND action = 'svc.hook_failed';
      RAISE EXCEPTION 'RESULTADO: % %', n, a;
    END $$`);
    check(/RESULTADO: 1 [1-9]/.test(forced ?? ""), "la fase se completa igual y queda svc.hook_failed (y todo se deshace)", forced?.slice(0, 300));

    console.log("\nac · Con el módulo apagado no abre nada");
    sql(`SELECT app_servicio.set_module_enabled(${lit(ws.id)}, false)`);
    check(sql(`SELECT app_servicio.svc_apply_access_event(${lit(sF)}, 'tick', NULL) n`)[0]?.n === 0, "svc_apply_access_event no hace nada");
    sql(`SELECT app_servicio.set_module_enabled(${lit(ws.id)}, true)`);
  }

  console.log("\nHuellas de las funciones protegidas");
  checkProtectedFunctions(sql, check);
} catch (e) {
  fail("el script fallo", e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" | ") : String(e));
} finally {
  const cleanupOk = await runCleanup(svc);
  if (!cleanupOk) failures++;
}

console.log(failures === 0 ? "\nTodo verde" : `\n${failures} FALLAS`);
process.exit(failures === 0 ? 0 : 1);
