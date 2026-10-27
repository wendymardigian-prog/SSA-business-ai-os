#!/usr/bin/env node
/**
 * Verificacion de Gastos y Finanzas (Extra I, bloques G1 y G2; migraciones 00225 a 00229, y 00233 con el flag).
 *
 * Corre contra la base real con usuarios de verdad. Prueba lo que Vitest NO puede probar: que la BASE haga cumplir
 * las reglas (RLS de las tres tablas, CHECKs, los indices unicos de idempotencia con concurrencia real, los
 * triggers de proteccion, el bucket, la politica nueva del historial, el vencimiento en la zona del workspace, la
 * paridad de la decision de los gastos automaticos y su candado).
 *
 *   --despues-de-00233   suma la comprobacion de la tarea de pg_cron `finance-daily`.
 *   --solo-g1            corre solo lo de 00225 a 00227 (el cierre del bloque G1, antes de aplicar 00228 y 00229).
 *
 * Crea y borra todo lo suyo (prefijo zz-test-). Una limpieza que falla es una prueba que falla. No se corre a la vez
 * que otro verify-*: comparten prefijo. Tomar el candado /private/tmp/ssa-verify.lock.
 *
 *   node scripts/verify-expenses.mjs [--despues-de-00233]
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { runCleanup } from "./test-cleanup.mjs";
import { checkProtectedFunctions } from "./protected-functions.mjs";
import { dbTargetArgs } from "./lib/db-target.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const require = createRequire(import.meta.url);
const AFTER_00233 = process.argv.includes("--despues-de-00233");
// `--solo-g1`: corre solo lo que depende de 00225 a 00227 (el cierre del bloque G1, antes de aplicar 00228 y 00229).
const ONLY_G1 = process.argv.includes("--solo-g1");

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

async function makeUser(tag) {
  const email = `zz-test-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, email, client };
}

function sql(query) {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).rows ?? [];
}

/** Corre un bloque DO que termina con `RAISE EXCEPTION 'RESULTADO: ...'`: la transaccion se deshace sola. */
function sqlProbe(query) {
  try {
    execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return "SIN RESULTADO (el bloque no levanto la excepcion final)";
  } catch (e) {
    const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    const m = text.match(/RESULTADO: ([^"\\]*)/);
    return m ? m[1].trim() : text.slice(0, 400);
  }
}

// La definicion de `audit_log_select` ANTES de la 00227 (leida el 15/10/2026 con md5 de pg_get_expr).
const AUDIT_LOG_SELECT_QUAL_MD5 = "5b4ffabd6da14a30309c552801302836";

const today = new Date().toISOString().slice(0, 10);
const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const mañana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces")
    .insert({ name: "zz-test-exp", slug: `zz-test-exp-${Date.now()}`, timezone: "America/Costa_Rica" }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-exp-otro", slug: `zz-test-exp-otro-${Date.now()}` }).select("id").single();

  const owner = await makeUser("exp-owner");
  const admin = await makeUser("exp-admin");
  const member = await makeUser("exp-member");
  const viewer = await makeUser("exp-viewer");   // rol personalizado: solo expenses.view
  const manager = await makeUser("exp-manager"); // rol personalizado: expenses.view + expenses.manage
  const outsider = await makeUser("exp-outsider");
  const { data: viewRole } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name: "zz-test Contable lectura", permissions: { keys: ["expenses.view"], scopes: {} } }).select("id").single();
  const { data: manageRole } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name: "zz-test Contable", permissions: { keys: ["expenses.view", "expenses.manage"], scopes: {} } }).select("id").single();
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
    { workspace_id: ws.id, user_id: viewer.id, role: "member", role_id: viewRole.id },
    { workspace_id: ws.id, user_id: manager.id, role: "member", role_id: manageRole.id },
    { workspace_id: ws2.id, user_id: outsider.id, role: "owner" },
  ]);

  const exp = (over = {}) => ({ workspace_id: ws.id, concept: "zz-test gasto", category_key: "marketing", amount: 100, status: "programado", scheduled_date: mañana, origin: "manual", ...over });
  const insertSvc = (over) => svc.from("expenses").insert(exp(over)).select("id").single();

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— La configuracion de Finanzas (workspaces.finance_settings) —");
  {
    const { data } = await svc.from("workspaces").select("finance_settings").eq("id", ws.id).single();
    const cats = data?.finance_settings?.expense_categories ?? [];
    check(cats.length === 12, "un workspace nuevo trae las 12 categorias precargadas");
    check(cats.every((c) => c.system === true && c.archived_at === null), "todas de sistema y sin archivar");
    check(cats.some((c) => c.key === "commissions" && c.group === "adquisicion"), "incluida «Comisiones del equipo», del grupo Adquisicion");
    check(data?.finance_settings?.auto_close_days === 3 && Object.keys(data.finance_settings.processor_fees).length === 0, "automaticos apagados y cierre a los 3 dias");
    const bad = await svc.from("workspaces").update({ finance_settings: { no: "tiene categorias" } }).eq("id", ws.id);
    check(!!bad.error, "una configuracion sin lista de categorias se rechaza (CHECK)");
    const memberRead = await member.client.from("workspaces").select("finance_settings").eq("id", ws.id).single();
    check(Array.isArray(memberRead.data?.finance_settings?.expense_categories), "cualquier miembro la lee (no son datos sensibles)");
    await manager.client.from("workspaces").update({ finance_settings: { expense_categories: [] } }).eq("id", ws.id);
    const after = await svc.from("workspaces").select("finance_settings").eq("id", ws.id).single();
    check(after.data?.finance_settings?.expense_categories?.length === 12, "un rol de contabilidad NO escribe `workspaces` con su sesion (solo la Server Action, con el servicio)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— RLS de las tres tablas —");
  {
    const policies = sql("select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('expenses','recurring_expenses','vendors') order by 1,2");
    const names = policies.map((p) => `${p.tablename}.${p.policyname}:${p.cmd}`).sort();
    const expected = ["expenses", "recurring_expenses", "vendors"].flatMap((t) => [`${t}.${t}_insert:INSERT`, `${t}.${t}_select:SELECT`, `${t}.${t}_update:UPDATE`]).sort();
    check(JSON.stringify(names) === JSON.stringify(expected), "las politicas son EXACTAMENTE las esperadas: select, insert y update (ninguna de mas, ninguna de DELETE)", names.join(", "));

    const base = await insertSvc();
    check(!base.error, "el servicio inserta un gasto de prueba", base.error?.message);
    const vendor = (await svc.from("vendors").insert({ workspace_id: ws.id, name: "zz-test proveedor" }).select("id").single()).data;
    const tpl = (await svc.from("recurring_expenses").insert({
      workspace_id: ws.id, concept: "zz-test plantilla", category_key: "software", amount_type: "fixed", amount: 36, charge_mode: "automatic",
      frequency: "monthly", monthly_day: 5, start_date: today, generation_anchor: today,
    }).select("id").single()).data;
    check(!!vendor && !!tpl, "y un proveedor y una plantilla");

    for (const [table, id] of [["expenses", base.data.id], ["vendors", vendor.id], ["recurring_expenses", tpl.id]]) {
      const seen = async (who) => ((await who.client.from(table).select("id").eq("id", id)).data ?? []).length;
      check((await seen(owner)) === 1 && (await seen(admin)) === 1, `${table}: Owner y Admin la leen`);
      check((await seen(viewer)) === 1 && (await seen(manager)) === 1, `${table}: un rol con expenses.view la lee`);
      check((await seen(member)) === 0, `${table}: un Member de sistema NO ve filas`);
      check((await seen(outsider)) === 0, `${table}: otro workspace NO la ve`);
      for (const who of [owner, admin, manager]) {
        await who.client.from(table).delete().eq("id", id);
      }
      const { data: still } = await svc.from(table).select("id").eq("id", id).maybeSingle();
      check(!!still, `${table}: nadie borra con su sesion (sin politica de DELETE)`);
    }

    const viewerIns = await viewer.client.from("expenses").insert(exp());
    check(!!viewerIns.error, "un rol solo con expenses.view NO inserta un gasto (RLS)");
    const managerIns = await manager.client.from("expenses").insert(exp()).select("id").single();
    check(!managerIns.error, "con expenses.manage SI", managerIns.error?.message);
    const otherWs = await manager.client.from("expenses").insert({ ...exp(), workspace_id: ws2.id });
    check(!!otherWs.error, "...pero NO en otro workspace");
    const memberIns = await member.client.from("expenses").insert(exp());
    check(!!memberIns.error, "un Member de sistema NO inserta");
    await viewer.client.from("expenses").update({ concept: "zz-test hackeado" }).eq("id", base.data.id);
    const { data: untouched } = await svc.from("expenses").select("concept").eq("id", base.data.id).single();
    check(untouched?.concept === "zz-test gasto", "y un rol de solo lectura NO edita");
    const adminUpd = await admin.client.from("expenses").update({ concept: "zz-test editado" }).eq("id", base.data.id).select("id");
    check((adminUpd.data ?? []).length === 1, "un Admin SI edita");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— CHECKs de la tabla de gastos —");
  {
    check(!!(await insertSvc({ status: "pagado" })).error, "pagado sin fecha de pago se rechaza");
    check(!!(await insertSvc({ status: "programado", paid_date: ayer })).error, "programado con fecha de pago se rechaza");
    check(!!(await insertSvc({ currency: "EUR" })).error, "una moneda que no es USD se rechaza");
    check(!!(await insertSvc({ amount: 0 })).error, "programado con monto 0 se rechaza");
    check(!(await insertSvc({ amount: 0, status: "por_revisar" })).error, "...pero «por revisar» admite monto 0");
    check(!!(await insertSvc({ amount: -5 })).error, "un gasto manual negativo se rechaza");
    check(!!(await insertSvc({ status: "anulado" })).error, "anulado sin motivo ni fecha se rechaza");
    check(!!(await insertSvc({ origin: "processor_fee" })).error, "origen processor_fee sin auto_key se rechaza");
    check(!!(await insertSvc({ origin: "recurring" })).error, "origen recurring sin plantilla se rechaza");
    check(!!(await insertSvc({ origin: "commission_payout" })).error, "una liquidacion de comisiones sin proveedor ni modo «single» se rechaza");
    check(!!(await insertSvc({ category_key: "no_existe" })).error, "una categoria que no existe se rechaza (EX001)");
    const original = (await insertSvc()).data;
    const adj = await svc.from("expenses").insert(exp({ origin: "adjustment", amount: -4.2, adjusts_expense_id: original.id, concept: "zz-test ajuste" }));
    check(!adj.error, "un ajuste admite monto NEGATIVO", adj.error?.message);
    check(!!(await svc.from("expenses").insert(exp({ origin: "adjustment", amount: 0, adjusts_expense_id: original.id }))).error, "...pero no cero");
    check(!!(await insertSvc({ adjusts_expense_id: original.id })).error, "adjusts_expense_id solo en un ajuste");

    // Una categoria ARCHIVADA: una persona no la elige; el trabajo diario (servicio) si puede generar con ella.
    const { data: s } = await svc.from("workspaces").select("finance_settings").eq("id", ws.id).single();
    const archived = { ...s.finance_settings, expense_categories: s.finance_settings.expense_categories.map((c) => (c.key === "taxes" ? { ...c, archived_at: new Date().toISOString() } : c)) };
    await svc.from("workspaces").update({ finance_settings: archived }).eq("id", ws.id);
    const byUser = await manager.client.from("expenses").insert(exp({ category_key: "taxes" }));
    check(!!byUser.error, "una PERSONA no puede elegir una categoria archivada (EX001)");
    check(!(await insertSvc({ category_key: "taxes" })).error, "pero el sistema si puede generar con una archivada (el trabajo diario no se frena)");
    await svc.from("workspaces").update({ finance_settings: s.finance_settings }).eq("id", ws.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Indices unicos de idempotencia (con concurrencia real) —");
  {
    const tpl = (await svc.from("recurring_expenses").insert({
      workspace_id: ws.id, concept: "zz-test recurrente", category_key: "software", amount_type: "fixed", amount: 36, charge_mode: "manual",
      frequency: "monthly", monthly_day: 5, start_date: today, generation_anchor: today,
    }).select("id").single()).data;
    const rec = (date, over = {}) => svc.from("expenses").insert(exp({ origin: "recurring", recurring_expense_id: tpl.id, scheduled_date: date, ...over })).select("id").single();
    const first = await rec("2031-05-05");
    check(!first.error, "el primer gasto de la plantilla para una fecha entra");
    check(!!(await rec("2031-05-05")).error, "el segundo para la MISMA fecha falla");
    await svc.from("expenses").update({ status: "anulado", void_reason: "zz-test", void_kind: "manual", voided_at: new Date().toISOString() }).eq("id", first.data.id);
    check(!!(await rec("2031-05-05")).error, "...aunque el primero este ANULADO (un anulado sigue ocupando su fecha)");

    const burst = await Promise.all(Array.from({ length: 6 }, () => rec("2031-06-05")));
    check(burst.filter((r) => !r.error).length === 1, "6 inserciones simultaneas para la misma fecha: gana UNA", String(burst.filter((r) => !r.error).length));

    const auto = (key) => svc.from("expenses").insert(exp({ origin: "processor_fee", auto_key: key, concept: "zz-test auto", category_key: "processor_fees" })).select("id").single();
    check(!(await auto("processor_fee:whop:2031-05")).error, "un automatico por clave entra");
    check(!!(await auto("processor_fee:whop:2031-05")).error, "y la misma clave en el mismo workspace falla");
    const burst2 = await Promise.all(Array.from({ length: 6 }, () => auto("processor_fee:wise:2031-05")));
    check(burst2.filter((r) => !r.error).length === 1, "6 automaticos simultaneos con la misma clave: gana UNO");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— expenses_guard: lo que nadie puede hacer —");
  {
    const paid = (await insertSvc({ status: "pagado", paid_date: ayer, amount: 50 })).data;
    check(!!(await svc.from("expenses").update({ amount: 60 }).eq("id", paid.id)).error, "un pagado no cambia su monto (ni el servicio)");
    check(!!(await svc.from("expenses").update({ paid_date: today }).eq("id", paid.id)).error, "ni su fecha de pago");
    check(!!(await svc.from("expenses").update({ scheduled_date: today }).eq("id", paid.id)).error, "ni su fecha programada");
    check(!(await svc.from("expenses").update({ notes: "zz-test nota" }).eq("id", paid.id)).error, "pero SI sus notas");
    check(!(await svc.from("expenses").update({ status: "programado", paid_date: null }).eq("id", paid.id)).error, "y se puede revertir el pago");

    const voided = (await insertSvc()).data;
    await svc.from("expenses").update({ status: "anulado", void_reason: "zz-test", void_kind: "manual", voided_at: new Date().toISOString() }).eq("id", voided.id);
    check(!!(await svc.from("expenses").update({ concept: "zz-test reabierto" }).eq("id", voided.id)).error, "un anulado por una persona no se edita ni por el servicio");
    await manager.client.from("expenses").update({ concept: "zz-test reabierto" }).eq("id", voided.id);
    check((await svc.from("expenses").select("concept").eq("id", voided.id).single()).data?.concept === "zz-test gasto", "...ni con una sesion");

    const manual = (await insertSvc()).data;
    check(!!(await svc.from("expenses").update({ origin: "recurring" }).eq("id", manual.id)).error, "el origen no se cambia nunca");

    const mine = (await manager.client.from("expenses").insert(exp()).select("id").single()).data;
    check(!!(await manager.client.from("expenses").insert(exp({ origin: "processor_fee", auto_key: "processor_fee:zz:2031-01", category_key: "processor_fees" }))).error, "una persona NO da de alta un gasto automatico (EX002)");
    check(!!(await manager.client.from("expenses").insert(exp({ origin: "commission_payout", vendor_id: null, source_ref: { mode: "single" } }))).error, "ni una liquidacion de comisiones");
    void mine;

    const autoRow = (await svc.from("expenses").insert(exp({ origin: "processor_fee", auto_key: "processor_fee:zz:2031-02", category_key: "processor_fees", concept: "zz-test auto2" })).select("id").single()).data;
    await manager.client.from("expenses").update({ amount: 999 }).eq("id", autoRow.id);
    const { data: still } = await svc.from("expenses").select("amount").eq("id", autoRow.id).single();
    check(Number(still?.amount) === 100, "una persona NO cambia el monto de un automatico no pagado");
    check(!(await svc.from("expenses").update({ amount: 77 }).eq("id", autoRow.id)).error, "el sistema (servicio) SI lo recalcula");

    const vend = (await svc.from("vendors").insert({ workspace_id: ws.id, name: "zz-test persona del equipo", user_id: manager.id }).select("id").single()).data;
    const payout = (await svc.from("expenses").insert(exp({ origin: "commission_payout", vendor_id: vend.id, category_key: "commissions", concept: "zz-test liquidacion", source_ref: { mode: "per_person" } })).select("id").single()).data;
    await manager.client.from("expenses").update({ amount: 1 }).eq("id", payout.id);
    const { data: p2 } = await svc.from("expenses").select("amount").eq("id", payout.id).single();
    check(Number(p2?.amount) === 100, "una persona NO cambia el monto de una liquidacion de comisiones");
    check(!!(await svc.from("vendors").insert({ workspace_id: ws.id, name: "zz-test otra persona", user_id: manager.id })).error, "un usuario es el proveedor de UNA sola persona (indice unico)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Proveedores —");
  {
    check(!(await svc.from("vendors").insert({ workspace_id: ws.id, name: "zz-test Agencia" })).error, "un proveedor entra");
    check(!!(await svc.from("vendors").insert({ workspace_id: ws.id, name: "  ZZ-TEST agencia " })).error, "otro activo con el mismo nombre (sin importar mayusculas) se rechaza");
    await svc.from("vendors").update({ archived_at: new Date().toISOString() }).eq("name", "zz-test Agencia");
    check(!(await svc.from("vendors").insert({ workspace_id: ws.id, name: "zz-test Agencia" })).error, "...pero si el anterior esta archivado, el nombre se puede reusar");
    check(!!(await svc.from("vendors").insert({ workspace_id: ws.id, name: "zz-test pais malo", country: "Costa Rica" })).error, "el pais va en dos letras");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Comprobantes (bucket privado) —");
  {
    const { data: bucket } = await svc.storage.getBucket("expense-receipts");
    check(bucket?.public === false, "el bucket existe y es PRIVADO");
    check(Number(bucket?.file_size_limit) === 10485760, "con tope de 10 MB");
    check((bucket?.allowed_mime_types ?? []).includes("application/pdf") && !(bucket?.allowed_mime_types ?? []).includes("text/html"), "solo imagenes y PDF");
    const e = (await insertSvc()).data;
    const path = `${ws.id}/${e.id}/${randomUUID()}.pdf`;
    const up = await svc.storage.from("expense-receipts").upload(path, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3]), { contentType: "application/pdf" });
    check(!up.error, "el servidor sube un comprobante", up.error?.message);
    const viewerGet = await viewer.client.storage.from("expense-receipts").download(path);
    check(!viewerGet.error, "un rol con expenses.view lo lee (politica de SELECT por carpeta)");
    const memberGet = await member.client.storage.from("expense-receipts").download(path);
    check(!!memberGet.error, "un Member de sistema NO lo lee directo de Storage");
    const outsiderGet = await outsider.client.storage.from("expense-receipts").download(path);
    check(!!outsiderGet.error, "ni alguien de otro workspace");
    const memberUp = await manager.client.storage.from("expense-receipts").upload(`${ws.id}/${e.id}/x.pdf`, new Uint8Array([1, 2, 3]), { contentType: "application/pdf" });
    check(!!memberUp.error, "una persona NO sube directo (solo el servidor)");
    const signed = await svc.storage.from("expense-receipts").createSignedUrl(path, 60);
    check(!signed.error && !!signed.data?.signedUrl, "el servidor firma un link de 60 segundos");
    await svc.storage.from("expense-receipts").remove([path]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— El historial de Finanzas (politica nueva de audit_log) —");
  {
    const quals = sql("select polname, md5(coalesce(pg_get_expr(polqual, polrelid),'')) as q from pg_policy where polrelid = 'public.audit_log'::regclass");
    check(quals.find((p) => p.polname === "audit_log_select")?.q === AUDIT_LOG_SELECT_QUAL_MD5, "la definicion de audit_log_select es IDENTICA a la de antes");
    check(quals.some((p) => p.polname === "audit_log_select_finance"), "y existe la politica adicional audit_log_select_finance");

    const seed = async (entity_type, entity_id = randomUUID()) =>
      svc.from("audit_log").insert({ workspace_id: ws.id, entity_type, entity_id, action: "create", performed_by: owner.id, actor_type: "user" }).select("id").single();
    const finance = [];
    for (const t of ["expense", "recurring_expense", "vendor"]) finance.push((await seed(t)).data.id);
    const others = [];
    for (const t of ["contact", "sale", "payment", "booking", "call", "task", "form", "workspace"]) others.push((await seed(t)).data.id);
    const visible = async (who, ids) => ((await who.client.from("audit_log").select("id").in("id", ids)).data ?? []).length;
    check((await visible(viewer, finance)) === 3, "un rol con expenses.view ve el historial de gastos, plantillas y proveedores de OTRA persona");
    check((await visible(viewer, others)) === 0, "...y NO gana ninguna fila de los demas tipos (contactos, ventas, tareas…)");
    check((await visible(member, finance)) === 0, "un Member de sistema NO ve el historial de Finanzas");
    check((await visible(outsider, finance)) === 0, "otro workspace tampoco");
    check((await visible(owner, finance)) === 3, "el Owner lo ve todo (como siempre)");
  }

  if (!ONLY_G1) {
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— mark_expenses_overdue —");
  {
    const prog = (await insertSvc({ scheduled_date: "2026-10-10" })).data;
    const rev = (await insertSvc({ scheduled_date: "2026-10-01", status: "por_revisar", amount: 0 })).data;
    const pag = (await insertSvc({ scheduled_date: "2026-10-01", status: "pagado", paid_date: "2026-10-01" })).data;
    const anu = (await insertSvc({ scheduled_date: "2026-10-01" })).data;
    await svc.from("expenses").update({ status: "anulado", void_reason: "zz-test", void_kind: "manual", voided_at: new Date().toISOString() }).eq("id", anu.id);
    const st = async (id) => (await svc.from("expenses").select("status").eq("id", id).single()).data?.status;
    const run = (d) => svc.rpc("mark_expenses_overdue", { p_workspace_id: ws.id, p_today: d });

    const same = await run("2026-10-10");
    check(!same.error && !(same.data ?? []).includes(prog.id) && (await st(prog.id)) === "programado", "con hoy = la fecha programada, NO vence (vence hoy)");
    const next = await run("2026-10-11");
    check((next.data ?? []).includes(prog.id) && (await st(prog.id)) === "vencido", "con hoy = el dia siguiente, SI vence");
    check((await st(rev.id)) === "por_revisar" && (await st(pag.id)) === "pagado" && (await st(anu.id)) === "anulado", "un por revisar, un pagado y un anulado con fecha pasada NO cambian");
    const again = await run("2026-10-11");
    check((again.data ?? []).length === 0, "correrlo dos veces no vence nada nuevo");
    const anonCall = await outsider.client.rpc("mark_expenses_overdue", { p_workspace_id: ws.id, p_today: "2026-10-11" });
    check(!!anonCall.error, "una persona con sesion NO puede llamarla (solo service_role)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— enqueue_finance_daily (en una transaccion que se deshace: no deja trabajos en la cola) —");
  {
    const probe = (nowIso) => sqlProbe(`
      DO $$
      DECLARE n int; k text := 'finance_daily:${ws.id}:%';
      BEGIN
        PERFORM private.enqueue_finance_daily('${nowIso}'::timestamptz);
        SELECT count(*) INTO n FROM public.scheduled_jobs WHERE dedupe_key LIKE k;
        RAISE EXCEPTION 'RESULTADO: %', n || '|' || COALESCE((SELECT string_agg(payload ->> 'local_date', ',' ORDER BY dedupe_key) FROM public.scheduled_jobs WHERE dedupe_key LIKE k), '');
      END $$;`);
    // 05:00 UTC del 11 = 23:00 del 10 en Costa Rica: encola el del 10, nunca el del 11.
    check(probe("2026-10-11T05:00:00Z") === "1|2026-10-10", "a las 05:00 UTC (23:00 locales) encola la fecha local 2026-10-10", probe("2026-10-11T05:00:00Z"));
    check(probe("2026-10-11T08:59:00Z") === "0|", "a las 08:59 UTC (02:59 locales) todavia NO encola nada (espera a las 03:00 locales)", probe("2026-10-11T08:59:00Z"));
    check(probe("2026-10-11T09:00:00Z") === "1|2026-10-10,2026-10-11" || probe("2026-10-11T09:00:00Z") === "1|2026-10-11", "a las 09:00 UTC (03:00 locales) SI encola el del 11", probe("2026-10-11T09:00:00Z"));
    const twice = sqlProbe(`
      DO $$
      DECLARE n int; k text := 'finance_daily:${ws.id}:%';
      BEGIN
        PERFORM private.enqueue_finance_daily('2026-10-12T15:00:00Z'::timestamptz);
        UPDATE public.scheduled_jobs SET status = 'completed' WHERE dedupe_key LIKE k;
        PERFORM private.enqueue_finance_daily('2026-10-12T16:00:00Z'::timestamptz);
        PERFORM private.enqueue_finance_daily('2026-10-12T17:00:00Z'::timestamptz);
        SELECT count(*) INTO n FROM public.scheduled_jobs WHERE dedupe_key LIKE k;
        RAISE EXCEPTION 'RESULTADO: %', n;
      END $$;`);
    check(twice === "1", "24 llamadas en un dia dejan UN trabajo por workspace, aunque el primero ya este «completed»", twice);
    const badZone = sqlProbe(`
      DO $$
      DECLARE n int; k text := 'finance_daily:${ws.id}:%';
      BEGIN
        UPDATE public.workspaces SET timezone = 'Mars/Phobos' WHERE id = '${ws.id}';
        PERFORM private.enqueue_finance_daily('2026-10-12T15:00:00Z'::timestamptz);
        SELECT count(*) INTO n FROM public.scheduled_jobs WHERE dedupe_key LIKE k;
        RAISE EXCEPTION 'RESULTADO: %', n;
      END $$;`);
    check(badZone === "1" || /timezone/.test(badZone), "un workspace con zona invalida corre en UTC (o la zona ni se puede guardar) y no frena a los demas", badZone);
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— decide_auto_expense_action: paridad con decideAutoExpenseAction (los mismos casos que Vitest) —");
  {
    const cases = require("../lib/finance/auto-expenses.cases.json");
    for (const c of [...cases.cases, ...cases.extra]) {
      const { data, error } = await svc.rpc("decide_auto_expense_action", { p_existing: c.existing, p_total_cents: c.total, p_ctx: c.ctx });
      check(!error && JSON.stringify(sortKeys(data)) === JSON.stringify(sortKeys(c.expected)), `decide_auto_expense_action: ${c.name}`, error?.message ?? `dio ${JSON.stringify(data)}, esperaba ${JSON.stringify(c.expected)}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— upsert_auto_expense —");
  {
    const call = (over = {}) => svc.rpc("upsert_auto_expense", {
      p_workspace: ws.id, p_auto_key: "processor_fee:whop:2026-09", p_origin: "processor_fee", p_total_cents: 1548, p_concept: "Comisión Whop · septiembre 2026",
      p_month: "2026-09", p_vendor_id: null, p_category_key: "processor_fees", p_charge_mode: "automatic", p_source_ref: { kind: "processor_fee", method: "whop", month: "2026-09", payment_count: 3 }, p_today: "2026-09-20", ...over,
    });
    const row = async () => (await svc.from("expenses").select("*").eq("workspace_id", ws.id).eq("auto_key", "processor_fee:whop:2026-09").maybeSingle()).data;

    const created = await call();
    check(created.data?.action === "create", "no existe y hay total: lo crea", created.error?.message);
    let r = await row();
    check(r && Number(r.amount) === 15.48 && r.status === "programado" && r.scheduled_date === "2026-09-30" && r.origin === "processor_fee", "...programado, por 15,48 y con fecha el ultimo dia del mes");
    check((await call()).data?.action === "none", "repetir con el mismo total no hace nada (idempotente)");
    const up = await call({ p_total_cents: 2000 });
    r = await row();
    check(up.data?.action === "update_amount" && Number(r.amount) === 20, "si el total sube (un pago nuevo en la segunda mitad del mes), lo RECALCULA entero y no crea otro");
    check((await call({ p_total_cents: 0 })).data?.action === "void_zero" && (await row()).status === "anulado" && (await row()).void_kind === "auto_zero", "si queda en cero lo anula (auto_zero)");
    check((await call({ p_total_cents: 900 })).data?.action === "reactivate" && (await row()).status === "programado" && Number((await row()).amount) === 9, "y si vuelve a haber total lo reactiva");

    await svc.from("expenses").update({ status: "pagado", paid_date: "2026-10-03" }).eq("id", (await row()).id);
    const drift = await call({ p_total_cents: 580 });
    r = await row();
    check(drift.data?.action === "mark_drift" && Number(r.auto_drift_amount) === -3.2 && Number(r.amount) === 9, "pagado y el total cambia: NO toca el monto y marca la diferencia (-3,20)");
    check((await call({ p_total_cents: 580 })).data?.action === "none", "la misma diferencia no se vuelve a marcar (ni a notificar)");
    check((await call({ p_total_cents: 900 })).data?.action === "clear_drift" && (await row()).auto_drift_amount === null, "y si el total vuelve a coincidir, limpia la diferencia");

    check((await svc.rpc("upsert_auto_expense", { p_workspace: ws.id, p_auto_key: "x", p_origin: "manual", p_total_cents: 1, p_concept: "x", p_month: "2026-09", p_vendor_id: null, p_category_key: "other", p_charge_mode: "manual", p_source_ref: null, p_today: "2026-09-20" })).error !== null, "solo acepta los origenes automaticos");
    check(!!(await outsider.client.rpc("upsert_auto_expense", { p_workspace: ws.id, p_auto_key: "y", p_origin: "meta_ads", p_total_cents: 100, p_concept: "y", p_month: "2026-09", p_vendor_id: null, p_category_key: "ads_meta", p_charge_mode: "manual", p_source_ref: null, p_today: "2026-09-20" })).error, "una persona con sesion NO puede llamarla");

    // Concurrencia real: 8 llamadas simultaneas para una clave nueva = un solo gasto.
    const burst = await Promise.all(Array.from({ length: 8 }, () => call({ p_auto_key: "processor_fee:binance:2026-09", p_concept: "zz-test concurrente" })));
    const made = (await svc.from("expenses").select("id").eq("workspace_id", ws.id).eq("auto_key", "processor_fee:binance:2026-09")).data ?? [];
    check(made.length === 1 && burst.every((b) => !b.error), "8 recalculos simultaneos de la misma clave dejan UN gasto y ningun error", `${made.length} gastos; errores: ${burst.filter((b) => b.error).map((b) => b.error.message).join(" | ")}`);
    // Un automatico anulado POR UNA PERSONA no se reactiva.
    const manualVoid = (await svc.from("expenses").select("id").eq("workspace_id", ws.id).eq("auto_key", "processor_fee:binance:2026-09").single()).data;
    await svc.from("expenses").update({ status: "anulado", void_reason: "zz-test", void_kind: "manual", voided_at: new Date().toISOString() }).eq("id", manualVoid.id);
    check((await call({ p_auto_key: "processor_fee:binance:2026-09", p_total_cents: 5000 })).data?.action === "none", "uno anulado por una persona se respeta: no se reactiva");
  }

  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Funciones y lo que NO se toco —");
  {
    const names = ONLY_G1 ? "'expenses_guard','expenses_validate_category'" : "'mark_expenses_overdue','enqueue_finance_daily','upsert_auto_expense','decide_auto_expense_action','expenses_guard','expenses_validate_category'";
    const fns = sql(`select proname, prosecdef, array_to_string(proconfig, ',') cfg from pg_proc where proname in (${names})`);
    check(fns.length === (ONLY_G1 ? 2 : 6) && fns.filter((f) => f.proname !== "decide_auto_expense_action").every((f) => f.prosecdef && /search_path=/.test(f.cfg ?? "")), "las funciones nuevas son SECURITY DEFINER con search_path fijo");
    checkProtectedFunctions(sql, check);
    const trg = sql("select tgname from pg_trigger where tgrelid = 'public.expenses'::regclass and not tgisinternal order by 1").map((t) => t.tgname);
    check(["expenses_guard", "expenses_updated_at", "expenses_validate_category"].every((t) => trg.includes(t)), "los triggers de la tabla de gastos existen", trg.join(","));
    const cron = sql("select jobname, schedule from cron.job where jobname = 'finance-daily'");
    if (ONLY_G1) void cron;
    else if (AFTER_00233) check(cron.length === 1 && cron[0].schedule === "7 * * * *", "la tarea finance-daily corre cada hora, minuto 7 (00233)", JSON.stringify(cron));
    else check(cron.length === 0, "la tarea finance-daily todavia NO esta programada (la 00233 se aplica despues del merge)", JSON.stringify(cron));
  }
} catch (e) {
  fail("el script fallo", e instanceof Error ? e.stack : String(e));
} finally {
  try {
    await runCleanup(svc);
    console.log("\n  limpieza de los datos zz-test- hecha");
  } catch (e) {
    fail("la limpieza fallo", e instanceof Error ? e.message : String(e));
  }
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

console.log(failures ? `\n${failures} falla(s)` : "\nTodo verde");
process.exit(failures ? 1 : 0);
