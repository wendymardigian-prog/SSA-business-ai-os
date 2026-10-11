#!/usr/bin/env node
/**
 * Caracterizacion de lo que ve cada rol en `audit_log` (Llamadas, F1 y §1b).
 *
 * `audit_log_select` NO se reescribe nunca: cada modulo suma su propia politica
 * permisiva (`audit_log_select_<modulo>`). Este script prueba que sumar una no
 * achica ni agranda lo que cada rol ya veia: siembra una fila por cada
 * `entity_type` que existe, en cuatro variantes (la escribio un Member, un
 * Admin, el sistema, un agente), y registra quien la ve.
 *
 * Los nombres de los tipos salen de la base real (`select distinct entity_type`)
 * mas contact, conversation y booking, que tienen ramas propias en la policy.
 *
 *   node scripts/verify-audit-visibility.mjs --generar            # antes de la 00147: escribe el esperado
 *   node scripts/verify-audit-visibility.mjs                      # compara contra el esperado
 *   node scripts/verify-audit-visibility.mjs --despues-de-00147   # ademas prueba las filas de llamadas
 *   node scripts/verify-audit-visibility.mjs --despues-de-00168   # ademas prueba las filas de ventas, pagos y catalogo (Ventas, F35)
 *
 * Ventas (00168): `audit_log_select_sales` es una politica ADICIONAL. El script comprueba que las
 * definiciones de `audit_log_select` y `audit_log_select_calls` no cambiaron (md5 del `qual`, guardado en
 * scripts/fixtures/audit-log-policies.before-00168.json) y que el resultado para TODOS los tipos que ya
 * existian es el mismo antes y despues.
 *
 * Crea y borra todo lo suyo (prefijo zz-test-). Una limpieza que falla es una
 * prueba que falla.
 */

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FIXTURE = "scripts/fixtures/audit-visibility.expected.json";
const GENERAR = process.argv.includes("--generar");
const DESPUES_00147 = process.argv.includes("--despues-de-00147");
const DESPUES_00168 = process.argv.includes("--despues-de-00168");
const POLICIES_FIXTURE = "scripts/fixtures/audit-log-policies.before-00168.json";

/** Consultas que la API no expone (pg_policies): con la CLI ya vinculada. */
function sql(query) {
  const out = execFileSync("supabase", ["db", "query", "--linked", query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).rows ?? [];
}

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
  return { id: data.user.id, client };
}

// Los tipos que ya existen en esta base, mas los que tienen rama propia en la policy.
const FIXED_TYPES = ["contact", "conversation", "booking"];

try {
  const { data: distinct } = await svc.from("audit_log").select("entity_type");
  const types = [...new Set([...(distinct ?? []).map((r) => r.entity_type), ...FIXED_TYPES])]
    .filter((t) => t !== "call")
    .sort();

  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-audit-vis", slug: `zz-test-auditvis-${Date.now()}` }).select("id").single();

  const owner = await makeUser("av-owner");
  const admin = await makeUser("av-admin");
  const m1 = await makeUser("av-m1");   // setter/anfitrion de lo "suyo"
  const m2 = await makeUser("av-m2");   // un Member sin relacion con nada
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: m1.id, role: "member" },
    { workspace_id: ws.id, user_id: m2.id, role: "member" },
  ]);
  const readers = { owner, admin, m1, m2 };

  // Entidades reales para las tres ramas con EXISTS: una visible para m1, otra no.
  const { data: ch } = await svc.from("channels").insert({
    workspace_id: ws.id, platform: "instagram", late_account_id: `zz-test-${Date.now()}`,
    username: "zztestav", display_name: "zz av", is_active: true,
  }).select("id").single();
  const { data: agent } = await svc.from("agents").insert({
    workspace_id: ws.id, name: "zz-test agente av", type: "chat", is_enabled: false, close_after_inactive_hours: 12,
  }).select("id").single();
  const { data: cs } = await svc.from("contacts").insert([
    { workspace_id: ws.id, display_name: "zz-test av propio", setter_id: m1.id },
    { workspace_id: ws.id, display_name: "zz-test av ajeno", setter_id: admin.id },
  ]).select("id, display_name");
  const cPropio = cs.find((c) => c.display_name.endsWith("propio")).id;
  const cAjeno = cs.find((c) => c.display_name.endsWith("ajeno")).id;
  const { data: convs } = await svc.from("conversations").insert([
    { workspace_id: ws.id, channel_id: ch.id, contact_id: cPropio, platform: "instagram", status: "open", late_conversation_id: "zz-av-1" },
    { workspace_id: ws.id, channel_id: ch.id, contact_id: cAjeno, platform: "instagram", status: "open", late_conversation_id: "zz-av-2" },
  ]).select("id, late_conversation_id");
  const convPropia = convs.find((c) => c.late_conversation_id === "zz-av-1").id;
  const convAjena = convs.find((c) => c.late_conversation_id === "zz-av-2").id;

  const { data: cat } = await svc.from("booking_categories")
    .select("id").eq("workspace_id", ws.id).not("parent_id", "is", null).limit(1).single();
  const { data: ev } = await svc.from("event_types").insert({
    workspace_id: ws.id, owner_user_id: admin.id, category_id: cat.id, title: "zz-test-av", slug: "zz-test-av",
    duration_minutes: 30, status: "active", location_type: "manual", location_text: "Zoom",
  }).select("id").single();
  const mkBooking = (host, contact, day) => ({
    workspace_id: ws.id, uid: `zz-av-${randomUUID().slice(0, 8)}`, event_type_id: ev.id, host_user_id: host, contact_id: contact,
    title: "zz-test-av", start_at: `2031-03-${day}T15:00:00Z`, end_at: `2031-03-${day}T15:30:00Z`,
    booker_name: "zz", booker_email: "zz-av@example.test",
  });
  const { data: bks, error: bErr } = await svc.from("bookings").insert([
    mkBooking(m1.id, cPropio, "10"),
    mkBooking(admin.id, cAjeno, "11"),
  ]).select("id, contact_id");
  if (bErr) throw new Error(`no pude crear agendas: ${bErr.message}`);
  const bookPropia = bks.find((b) => b.contact_id === cPropio).id;
  const bookAjena = bks.find((b) => b.contact_id === cAjeno).id;

  const entitiesFor = (type) => {
    if (type === "contact") return [["propio", cPropio], ["ajeno", cAjeno]];
    if (type === "conversation") return [["propia", convPropia], ["ajena", convAjena]];
    if (type === "booking") return [["propia", bookPropia], ["ajena", bookAjena]];
    return [["x", randomUUID()]];
  };
  const VARIANTS = {
    por_member: { performed_by: m1.id },
    por_admin: { performed_by: admin.id },
    por_sistema: { performed_by: null },
    por_agente: { performed_by: null, performed_by_agent_id: agent.id },
  };

  const rows = [];
  for (const type of types) {
    for (const [label, entityId] of entitiesFor(type)) {
      for (const [variant, who] of Object.entries(VARIANTS)) {
        rows.push({
          workspace_id: ws.id, entity_type: type, entity_id: entityId, action: "update",
          metadata: { case: `${type}|${label}|${variant}` }, ...who,
        });
      }
    }
  }
  const { error: insErr } = await svc.from("audit_log").insert(rows);
  if (insErr) throw new Error(`no pude sembrar filas de auditoria: ${insErr.message}`);

  // Lo que cada lector ve de lo que se sembro.
  const seen = {};
  async function readAll(extraFilter) {
    const out = {};
    for (const [name, user] of Object.entries(readers)) {
      const { data } = await user.client.from("audit_log").select("metadata").eq("workspace_id", ws.id).limit(5000);
      for (const r of data ?? []) {
        const k = r.metadata?.case;
        if (!k || (extraFilter && !extraFilter(k))) continue;
        out[k] ??= { owner: false, admin: false, m1: false, m2: false };
        out[k][name] = true;
      }
    }
    return out;
  }
  Object.assign(seen, await readAll());
  for (const r of rows) seen[r.metadata.case] ??= { owner: false, admin: false, m1: false, m2: false };

  console.log(`\n— Lo que ve cada rol (${rows.length} filas, ${types.length} tipos) —`);
  if (GENERAR) {
    writeFileSync(FIXTURE, JSON.stringify({ types, cases: Object.fromEntries(Object.entries(seen).sort(([a], [b]) => a.localeCompare(b))) }, null, 2) + "\n");
    ok(`esperado generado en ${FIXTURE} (${Object.keys(seen).length} casos)`);
  } else if (!existsSync(FIXTURE)) {
    fail(`falta ${FIXTURE}: correr una vez con --generar ANTES de la 00147`);
  } else {
    const expected = JSON.parse(readFileSync(FIXTURE, "utf8")).cases;
    const diffs = [];
    for (const [k, exp] of Object.entries(expected)) {
      if (!seen[k]) { diffs.push(`${k}: no se sembro (tipo nuevo o desaparecido)`); continue; }
      for (const role of Object.keys(exp)) {
        if (exp[role] !== seen[k][role]) diffs.push(`${k}: ${role} esperaba ${exp[role]} y ve ${seen[k][role]}`);
      }
    }
    check(diffs.length === 0, `el mismo resultado para los ${Object.keys(expected).length} casos que ya existian`, diffs.slice(0, 8).join("\n        "));
  }

  // Reglas basicas, siempre (no dependen del archivo esperado).
  check(seen["contact|propio|por_sistema"]?.admin === true && seen["contact|propio|por_sistema"]?.m2 === false,
    "Admin ve lo del sistema; un Member ajeno no");
  check(seen["contact|propio|por_member"]?.m1 === true && seen["contact|propio|por_member"]?.m2 === false,
    "un Member ve lo que escribio el mismo, y no lo de otro");

  if (DESPUES_00147) {
    console.log("\n— Filas de llamadas (00147) —");
    const { data: c1, error: cErr } = await svc.from("calls").insert([
      { workspace_id: ws.id, source: "manual", title: "zz-test llamada de m1", recorded_at: new Date().toISOString(), recorded_by_user_id: m1.id },
      { workspace_id: ws.id, source: "manual", title: "zz-test llamada ajena", recorded_at: new Date().toISOString(), recorded_by_user_id: admin.id, contact_id: cAjeno },
    ]).select("id, title");
    if (cErr) throw new Error(`no pude crear llamadas: ${cErr.message}`);
    const propia = c1.find((c) => c.title.endsWith("m1")).id;
    const ajena = c1.find((c) => c.title.endsWith("ajena")).id;
    await svc.from("audit_log").insert([
      { workspace_id: ws.id, entity_type: "call", entity_id: propia, action: "call.analyzed", performed_by: null, actor_type: "system", actor_label: "Analisis automatico", metadata: { case: "call|propia|por_sistema" } },
      { workspace_id: ws.id, entity_type: "call", entity_id: ajena, action: "call.analyzed", performed_by: null, actor_type: "system", actor_label: "Analisis automatico", metadata: { case: "call|ajena|por_sistema" } },
    ]);
    const callSeen = await readAll((k) => k.startsWith("call|"));
    check(callSeen["call|propia|por_sistema"]?.m1 === true, "el closer ve lo que el sistema escribio sobre SU llamada");
    check(callSeen["call|ajena|por_sistema"]?.m1 !== true, "un Member NO ve lo del sistema sobre una llamada que no ve");
    check(callSeen["call|ajena|por_sistema"]?.m2 !== true, "ni un Member sin relacion");
    check(callSeen["call|propia|por_sistema"]?.m2 !== true, "ni uno ajeno ve la llamada de otro");
    check(callSeen["call|ajena|por_sistema"]?.admin === true && callSeen["call|propia|por_sistema"]?.owner === true, "Owner y Admin ven todas");
  }

  // Las definiciones que NO se reescriben (Ventas, 00168): `audit_log_select` y la de Llamadas.
  console.log("\n— Definiciones de las politicas de SELECT —");
  const policies = sql(`select policyname, md5(coalesce(qual,'')) as qual_md5 from pg_policies where schemaname='public' and tablename='audit_log' and cmd='SELECT'`);
  const policyHash = (name) => policies.find((p) => p.policyname === name)?.qual_md5;
  if (existsSync(POLICIES_FIXTURE)) {
    const before = JSON.parse(readFileSync(POLICIES_FIXTURE, "utf8"));
    check(policyHash("audit_log_select") === before.audit_log_select, "audit_log_select es IDENTICA a como estaba antes de la 00168 (no se reescribe)");
    check(policyHash("audit_log_select_calls") === before.audit_log_select_calls, "audit_log_select_calls tampoco cambio");
  } else {
    fail(`falta ${POLICIES_FIXTURE}`);
  }

  if (DESPUES_00168) {
    console.log("\n— Filas de ventas, pagos y catalogo (00168) —");
    check(!!policyHash("audit_log_select_sales"), "existe la politica adicional audit_log_select_sales");

    // Catalogo + dos ventas: una de m1 (es su vendedor) y otra ajena (setter: el admin).
    const { data: prod } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test av producto", product_type: "programa" }).select("id").single();
    const { data: variant } = await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prod.id, name: "Estandar" }).select("id").single();
    const { data: ver } = await svc.from("product_versions").insert({ workspace_id: ws.id, product_variant_id: variant.id, price: 500 }).select("id").single();
    await svc.rpc("publish_product_version", { p_version_id: ver.id, p_actor_id: owner.id });
    const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const snapshot = { product_id: prod.id, product_name: "zz-test av producto", product_type: "programa", variant_id: variant.id, variant_name: "Estandar", version_id: ver.id, version_number: 1, price: 500, currency: "USD", duration_type: "lifetime", duration_value: null, billing_type: "one_time", billing_interval: null, guarantee_duration_type: null, guarantee_duration_value: null };
    const mkSale = async (contact, setter, vendedor) => {
      const { data, error } = await svc.rpc("create_sale", { p_actor_id: owner.id, p_payload: {
        workspace_id: ws.id, contact_id: contact, product_version_id: ver.id, product_snapshot: snapshot, base_amount: 500, discount_amount: 0,
        financing_type: "full", sale_date: ayer, setter_id: setter, vendedor_id: vendedor, attribution: { mode: "last_touch" },
        payments: [{ type: "full", amount: 500, status: "scheduled", due_date: "2031-05-15" }],
      } });
      if (error) throw new Error(`no pude crear la venta: ${error.message}`);
      return data.sale_id;
    };
    const saleMine = await mkSale(cPropio, admin.id, m1.id);
    const saleOther = await mkSale(cAjeno, admin.id, admin.id);
    const payOf = async (sale) => (await svc.from("payments").select("id").eq("sale_id", sale).single()).data.id;
    const payMine = await payOf(saleMine);
    const payOther = await payOf(saleOther);

    const ventas = [];
    const add = (type, id, label) => {
      for (const [variantName, who] of Object.entries(VARIANTS)) {
        const actor = variantName === "por_sistema" ? { actor_type: "system", actor_label: "Job de mora" } : variantName === "por_agente" ? { actor_type: "agent", actor_label: null } : { actor_type: "user", actor_label: null };
        ventas.push({ workspace_id: ws.id, entity_type: type, entity_id: id, action: "update", metadata: { case: `ventas|${type}|${label}|${variantName}` }, performed_by: null, performed_by_agent_id: null, ...who, ...actor });
      }
    };
    add("sale", saleMine, "propia"); add("sale", saleOther, "ajena");
    add("payment", payMine, "propio"); add("payment", payOther, "ajeno");
    add("product", prod.id, "x"); add("product_variant", variant.id, "x"); add("product_version", ver.id, "x");
    const { error: vErr } = await svc.from("audit_log").insert(ventas);
    if (vErr) throw new Error(`no pude sembrar filas de ventas: ${vErr.message}`);
    const vSeen = await readAll((k) => k.startsWith("ventas|"));

    check(vSeen["ventas|sale|propia|por_sistema"]?.m1 === true, "el vendedor de una venta ve su historial completo, incluidas las filas del sistema");
    check(vSeen["ventas|sale|propia|por_member"]?.m1 === true && vSeen["ventas|sale|propia|por_agente"]?.m1 === true, "...y las de una persona y las de un agente");
    check(vSeen["ventas|payment|propio|por_sistema"]?.m1 === true, "y el historial de los pagos de esa venta");
    // `por_member` queda afuera: lo escribio el propio m1 y la regla de siempre (un Member ve lo que escribio) se lo muestra.
    check(["por_sistema", "por_admin", "por_agente"].every((v) => vSeen[`ventas|sale|ajena|${v}`]?.m1 !== true && vSeen[`ventas|payment|ajeno|${v}`]?.m1 !== true), "quien no es setter ni vendedor NO ve ninguna fila de esa venta ni de sus pagos (salvo lo que escribio el mismo)");
    check(["por_sistema", "por_member", "por_admin"].every((v) => vSeen[`ventas|sale|propia|${v}`]?.m2 !== true && vSeen[`ventas|payment|propio|${v}`]?.m2 !== true), "un Member sin relacion no ve ni la venta de otro ni sus pagos");
    check(Object.entries(vSeen).filter(([k]) => /\|(sale|payment)\|/.test(k)).every(([, v]) => v.owner && v.admin), "Owner y Admin ven todas las filas de ventas y pagos");
    check(["product", "product_variant", "product_version"].every((t) => ["por_sistema", "por_member", "por_admin", "por_agente"].every((v) => vSeen[`ventas|${t}|x|${v}`]?.m1 === true && vSeen[`ventas|${t}|x|${v}`]?.m2 === true)), "el historial del catalogo lo ve cualquier miembro (el catalogo ya es legible por todos)");

    // Lo previo no se movio: las filas `contact` que un Member no escribio siguen sin verse.
    const again = await readAll((k) => k.startsWith("contact|"));
    check(again["contact|ajeno|por_sistema"]?.m1 !== true && again["contact|propio|por_member"]?.m2 !== true, "las filas contact que un Member no escribio siguen sin verse");
  }
} catch (e) {
  fail("el script fallo", e.message);
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exit(failures ? 1 : 0);
