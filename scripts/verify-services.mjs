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
import { randomUUID } from "node:crypto";
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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const jlit = (v) => `${lit(JSON.stringify(v))}::jsonb`;

function sql(query) {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out).rows ?? [];
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
  const { stdout } = await execFileAsync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout).rows ?? [];
}
/** Una consulta con la sesion de un usuario (rol authenticated + su JWT), en una transaccion que se deshace. */
function asUser(uid, query) {
  const claims = JSON.stringify({ sub: uid, role: "authenticated" });
  const body = `DO $do$ DECLARE r jsonb; BEGIN
    PERFORM set_config('request.jwt.claims', ${lit(claims)}, true);
    PERFORM set_config('request.jwt.claim.sub', ${lit(uid)}, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE ${lit(`SELECT to_jsonb(t) FROM (${query}) t`)} INTO r;
    RAISE EXCEPTION 'RESULTADO: %', COALESCE(r::text, 'null');
  END $do$;`;
  const text = sqlErr(body) ?? "";
  const m = text.match(/RESULTADO: (\{.*?\}|null)(?=\\n|"|\n|$)/s);
  if (m) return { ok: true, row: m[1] === "null" ? null : JSON.parse(m[1].replace(/\\"/g, '"')) };
  const code = text.match(/\(SQLSTATE ([A-Z0-9]{5})\)/)?.[1] ?? text.match(/ERROR: +([A-Z0-9]{5})/)?.[1] ?? null;
  return { ok: false, error: text.slice(0, 400), code };
}

async function makeUser(tag) {
  const email = `zz-test-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  return { id: data.user.id, email };
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
      for (const c of cases) {
        const got = sql(`SELECT ${toSql(c)} AS r`)[0]?.r;
        if (!eq(got, expected(c))) bad.push(`${c.name}: dio ${JSON.stringify(got)}`);
      }
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
    sql(`SELECT app_servicio.svc_pause(${lit(baseE)}, '{"reason":"zz-test viaje","cut_access":true}'::jsonb)`);
    sql(`UPDATE app_servicio.services SET paused_at = now() - interval '12 days' WHERE id = ${lit(baseE)}`);
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
