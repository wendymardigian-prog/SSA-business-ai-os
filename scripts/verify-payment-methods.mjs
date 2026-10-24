#!/usr/bin/env node
/**
 * Verificacion de los metodos de pago configurables (Extra I, bloque MP, migracion 00224).
 *
 * Corre contra la base real con usuarios de verdad. Prueba lo que Vitest NO puede probar: que la BASE haga
 * cumplir las reglas (el trigger que valida el metodo, el congelado del porcentaje y el fijo, la RLS).
 *
 * Crea y borra todo lo suyo (prefijo zz-test-). Una limpieza que falla es una prueba que falla.
 * No se corre a la vez que otro verify-*: comparten prefijo. Tomar el candado /private/tmp/ssa-verify.lock.
 *
 *   node scripts/verify-payment-methods.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runCleanup } from "./test-cleanup.mjs";
import { checkProtectedFunctions } from "./protected-functions.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

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
  const out = execFileSync("supabase", ["db", "query", "--linked", query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).rows ?? [];
}

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces")
    .insert({ name: "zz-test-pm", slug: `zz-test-pm-${Date.now()}`, timezone: "America/Costa_Rica" }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-pm-otro", slug: `zz-test-pm-otro-${Date.now()}` }).select("id").single();

  const owner = await makeUser("pm-owner");
  const member = await makeUser("pm-member");
  const outsider = await makeUser("pm-outsider");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
    { workspace_id: ws2.id, user_id: outsider.id, role: "owner" },
  ]);

  const methodsOf = async () => (await svc.from("workspaces").select("payment_methods").eq("id", ws.id).single()).data?.payment_methods ?? [];
  const setMethods = (list) => svc.from("workspaces").update({ payment_methods: list }).eq("id", ws.id);

  // ───────────────────────────────────────────────────────────────────────
  console.log("\n— La columna `payment_methods` —");
  {
    const list = await methodsOf();
    check(Array.isArray(list) && list.length === 5, "un workspace nuevo trae los 5 metodos de siempre");
    check(list.every((m) => m.fee_percent === 0 && m.fee_fixed === 0 && m.active === true), "todos activos y con comision 0");
    check(list.map((m) => m.key).join() === "whop,transferencia_cr,transferencia_usa,wise,binance", "en el orden de siempre");
    const bad = await svc.from("workspaces").update({ payment_methods: { no: "es una lista" } }).eq("id", ws.id);
    check(!!bad.error, "algo que no es una lista se rechaza (CHECK)");
    const legacy = (await svc.from("workspaces").select("enabled_payment_methods").eq("id", ws.id).single()).data;
    check(Array.isArray(legacy?.enabled_payment_methods) && legacy.enabled_payment_methods.length === 5, "`enabled_payment_methods` sigue existiendo (queda sin leerse, no se borra)");

    const memberRead = await member.client.from("workspaces").select("payment_methods").eq("id", ws.id).single();
    check(Array.isArray(memberRead.data?.payment_methods), "un Member lee la lista (la necesita para cargar un cobro)");
    const outsiderRead = await outsider.client.from("workspaces").select("payment_methods").eq("id", ws.id);
    check((outsiderRead.data ?? []).length === 0, "otro workspace no la ve");
    await member.client.from("workspaces").update({ payment_methods: [] }).eq("id", ws.id);
    check((await methodsOf()).length === 5, "un Member NO escribe la lista (la RLS de workspaces es de Admin)");
  }

  // Catalogo y venta de prueba
  const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const { data: prod } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test Programa", product_type: "programa" }).select("id").single();
  const { data: variant } = await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prod.id, name: "Estandar", price: 1000 }).select("id").single();
  const { data: contact } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test lead pm" }).select("id").single();
  const snapshot = { product_id: prod.id, product_name: "zz-test Programa", product_type: "programa", variant_id: variant.id, variant_name: "Estandar", price: 1000, currency: "USD", duration_type: "lifetime", duration_value: null, billing_type: "one_time", billing_interval: null, event_date: null };
  const stripeSnap = { method_key: "stripe", method_name: "Stripe", provider_fee_percent: 2.9, provider_fee_fixed: 0.3 };
  const payload = (payments, over = {}) => ({
    workspace_id: ws.id, contact_id: contact.id, product_variant_id: variant.id, product_snapshot: snapshot,
    base_amount: 1000, discount_amount: 0, financing_type: "installments", sale_date: ayer, setter_id: null, vendedor_id: null,
    attribution: { mode: "last_touch" }, payments, ...over,
  });
  const createSale = (payments, over) => svc.rpc("create_sale", { p_payload: payload(payments, over), p_actor_id: owner.id });
  const paid = (over = {}) => ({ type: "reservation", amount: 500, status: "paid", due_date: ayer, paid_at: `${ayer}T15:00:00Z`, paid_on: ayer, ...over });
  const scheduled = (over = {}) => ({ type: "installment", amount: 500, status: "scheduled", due_date: "2031-03-15", ...over });
  const count = async () => (await svc.from("sales").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)).count;

  // ───────────────────────────────────────────────────────────────────────
  console.log("\n— El metodo tiene que existir en la lista del negocio (PM001) —");
  {
    const before = await count();
    const unknown = await createSale([paid({ payment_method: "stripe", payment_option_snapshot: stripeSnap, provider_fee_amount: 14.8 }), scheduled()]);
    check(!!unknown.error && /PM001|no existe en este negocio/.test(unknown.error.message), "cobrar con un metodo que el negocio no tiene falla con PM001", unknown.error?.message);
    check((await count()) === before, "...y create_sale no deja nada a medias (una sola transaccion)");

    await setMethods([...(await methodsOf()), { key: "stripe", name: "Stripe", fee_percent: 2.9, fee_fixed: 0.3, active: true, created_at: new Date().toISOString() }]);
    const made = await createSale([paid({ payment_method: "stripe", payment_option_snapshot: stripeSnap, provider_fee_amount: 14.8 }), scheduled()]);
    check(!made.error && !!made.data?.sale_id, "con «Stripe» en la lista, el mismo cobro entra", made.error?.message);
    const saleId = made.data?.sale_id;

    const { data: pays } = await svc.from("payments").select("id, type, status, provider_fee_amount, provider_fee_percent, provider_fee_fixed, payment_method").eq("sale_id", saleId).order("created_at");
    const cobro = (pays ?? []).find((p) => p.status === "paid");
    const prog = (pays ?? []).find((p) => p.status === "scheduled");
    check(Number(cobro?.provider_fee_amount) === 14.8, "el total de la comision queda congelado (14,80)");
    check(Number(cobro?.provider_fee_percent) === 2.9 && Number(cobro?.provider_fee_fixed) === 0.3, "el porcentaje y el fijo se copian del snapshot (create_sale no los conoce: lo hace el trigger)", JSON.stringify(cobro));
    check(prog?.provider_fee_percent === null && prog?.provider_fee_fixed === null, "un pago programado no tiene porcentaje ni fijo");

    // Cambiar la comision del metodo DESPUES no toca lo ya cobrado.
    await setMethods((await methodsOf()).map((m) => (m.key === "stripe" ? { ...m, fee_percent: 5 } : m)));
    const { data: again } = await svc.from("payments").select("provider_fee_amount, provider_fee_percent").eq("id", cobro.id).single();
    check(Number(again?.provider_fee_percent) === 2.9 && Number(again?.provider_fee_amount) === 14.8, "cambiar el % del metodo despues NO cambia el pago ya cobrado");

    // Desactivar un metodo no impide editar un pago viejo que lo usa; borrarlo de la lista si cambia la regla del trigger.
    await setMethods((await methodsOf()).map((m) => (m.key === "stripe" ? { ...m, active: false } : m)));
    const edit = await svc.from("payments").update({ notes: "zz-test nota" }).eq("id", cobro.id);
    check(!edit.error, "con el metodo DESACTIVADO, un pago viejo se sigue pudiendo editar");
    const other = await svc.from("payments").update({ payment_method: "stripe" }).eq("id", prog.id);
    check(!other.error, "y un metodo desactivado sigue siendo valido para la base (que se ofrezca o no lo decide la app)");

    // Revertir (como lo hace el codigo viejo: no conoce las columnas nuevas) no choca con el CHECK.
    const rev = await svc.from("payments").update({ status: "scheduled", paid_at: null, paid_on: null, provider_fee_amount: null, payment_option_snapshot: null, payment_method: null }).eq("id", cobro.id);
    check(!rev.error, "revertir un cobro con el codigo viejo (sin tocar las columnas nuevas) no falla", rev.error?.message);
    const { data: reverted } = await svc.from("payments").select("provider_fee_percent, provider_fee_fixed, status").eq("id", cobro.id).single();
    check(reverted?.provider_fee_percent === null && reverted?.provider_fee_fixed === null, "...y el porcentaje y el fijo quedan en null (el trigger los limpia)");
  }

  // ───────────────────────────────────────────────────────────────────────
  console.log("\n— Reembolsos y el trigger que copia el snapshot —");
  {
    await setMethods((await methodsOf()).map((m) => (m.key === "stripe" ? { ...m, active: true, fee_percent: 2.9 } : m)));
    const made = await createSale([paid({ payment_method: "stripe", payment_option_snapshot: stripeSnap, provider_fee_amount: 14.8 }), scheduled()], { contact_id: contact.id });
    const saleId = made.data?.sale_id;
    const refund = await svc.from("payments").insert({ workspace_id: ws.id, sale_id: saleId, type: "refund", amount: -100, status: "paid", paid_at: new Date().toISOString(), paid_on: ayer, payment_method: "stripe", payment_option_snapshot: stripeSnap })
      .select("provider_fee_percent, provider_fee_fixed").single();
    check(!refund.error && refund.data?.provider_fee_percent === null && refund.data?.provider_fee_fixed === null, "un reembolso nunca lleva porcentaje ni fijo, aunque traiga snapshot", refund.error?.message);

    // Un snapshot ilegible (forzado): el trigger lo atrapa, el cobro entra y el desglose queda en null.
    const weird = await svc.from("payments").insert({ workspace_id: ws.id, sale_id: saleId, type: "installment", amount: 50, status: "paid", paid_at: new Date().toISOString(), paid_on: ayer, due_date: ayer, payment_method: "wise", payment_option_snapshot: { provider_fee_percent: "abc", provider_fee_fixed: "x" }, provider_fee_amount: 0 })
      .select("id, provider_fee_percent").single();
    check(!weird.error && weird.data?.provider_fee_percent === null, "si el trigger de copia falla (snapshot con basura), el cobro entra igual y sin desglose", weird.error?.message);
  }

  // ───────────────────────────────────────────────────────────────────────
  console.log("\n— workspace_payment_method —");
  {
    const fromService = await svc.rpc("workspace_payment_method", { p_workspace: ws.id, p_key: "stripe" });
    check(fromService.data?.key === "stripe" && Number(fromService.data?.fee_percent) === 2.9, "el servicio lee un metodo por su clave", fromService.error?.message);
    const fromMember = await member.client.rpc("workspace_payment_method", { p_workspace: ws.id, p_key: "stripe" });
    check(fromMember.data?.key === "stripe", "un miembro del workspace tambien");
    const fromOutsider = await outsider.client.rpc("workspace_payment_method", { p_workspace: ws.id, p_key: "stripe" });
    check(!fromOutsider.data, "alguien de otro workspace NO", JSON.stringify(fromOutsider.data));
    const missing = await svc.rpc("workspace_payment_method", { p_workspace: ws.id, p_key: "no-existe" });
    check(!missing.data, "una clave que no existe devuelve null");
    const anon = await createClient(URL, ANON, { auth: { persistSession: false } }).rpc("workspace_payment_method", { p_workspace: ws.id, p_key: "stripe" });
    check(!!anon.error || !anon.data, "sin sesion no devuelve nada");
  }

  // ───────────────────────────────────────────────────────────────────────
  console.log("\n— Lo que NO se tocó —");
  checkProtectedFunctions(sql, check);
  const trg = sql("select tgname from pg_trigger where tgrelid = 'public.payments'::regclass and not tgisinternal and tgname in ('payments_validate_method','payments_fee_spec_from_snapshot') order by 1");
  check(trg.length === 2, "los dos triggers nuevos de payments existen");
  const oldCheck = sql("select count(*)::int n from pg_constraint where conrelid = 'public.payments'::regclass and conname = 'payments_method_check'");
  check(oldCheck[0].n === 0, "el CHECK fijo payments_method_check ya no existe (lo reemplaza el trigger)");
  const fn = sql("select prosecdef, array_to_string(proconfig, ',') cfg from pg_proc where proname in ('payments_validate_method','payments_fee_spec_from_snapshot','workspace_payment_method')");
  check(fn.length === 3 && fn.every((f) => f.prosecdef && /search_path=/.test(f.cfg ?? "")), "las tres funciones son SECURITY DEFINER con search_path fijo");
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

console.log(failures ? `\n${failures} falla(s)` : "\nTodo verde");
process.exit(failures ? 1 : 0);
