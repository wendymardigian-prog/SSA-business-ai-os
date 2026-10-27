#!/usr/bin/env node
/**
 * Verificacion de Comisiones (Extra I, bloques CM1 a CM3; migraciones 00231, 00232, y 00235 con el flag).
 *
 * Corre contra la base real. Prueba lo que Vitest NO puede probar:
 *   - la PARIDAD del motor: los mismos casos de `lib/commissions/rules.cases.json` (113) y `content-owner.cases.json` (10)
 *     que corren contra TypeScript, corren contra las funciones SQL (`commission_rule_matches`, `commission_payee`,
 *     `commission_amount_cents`, `commission_base_cents`, `commission_content_owner`);
 *   - los roles (CM001/CM002) y que un precargado no se archiva ni cambia de `payee`;
 *   - la RLS: un Member ve solo las suyas, otro no, un rol con `commissions.view` de alcance `all` ve todas, nadie
 *     escribe con la sesion y `can_see_commission` nunca devuelve NULL;
 *   - generar (idempotente y con dos llamadas a la vez), revertir y el estado de la venta;
 *   - liquidar: gastos por persona, totales no positivos, concurrencia real, liberar al anular el gasto;
 *   - `commissions_guard`, `expenses_release_commissions`, la politica nueva de `audit_log` y la funcion del trigger de pagos;
 *   - las huellas de las ocho funciones protegidas.
 *
 *   --despues-de-00235   suma el recorrido real: cobrar → el trigger encola → se generan (se aplica despues del merge).
 *
 * Crea y limpia todo lo suyo (prefijo zz-test-). No se corre a la vez que otro verify-*: comparten prefijo.
 * Tomar el candado /private/tmp/ssa-verify.lock.
 *
 *   node scripts/verify-commissions.mjs [--despues-de-00235]
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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
const AFTER_00235 = process.argv.includes("--despues-de-00235");

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();

function sql(query) {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out).rows ?? [];
}
function sqlFile(text) {
  const dir = mkdtempSync(join(tmpdir(), "zz-commissions-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, text);
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), "-f", file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out).rows ?? [];
}
/** Un bloque DO que termina con `RAISE EXCEPTION 'RESULTADO: ...'`: la transaccion se deshace sola. */
function sqlProbe(query) {
  try {
    execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return "SIN RESULTADO";
  } catch (e) {
    const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    const m = text.match(/RESULTADO: ([^"\\]*)/);
    return m ? m[1].trim() : text.slice(0, 500);
  }
}
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

async function makeUser(tag) {
  const email = `zz-test-${tag}-${stamp}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, email, client };
}

try {
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Paridad del motor: los mismos casos que Vitest, contra las funciones SQL —");
  {
    const cases = JSON.parse(readFileSync("lib/commissions/rules.cases.json", "utf8")).cases;
    check(cases.length >= 40, `hay al menos 40 casos compartidos (${cases.length})`);
    const evalSql = `
      CREATE FUNCTION pg_temp.cm_eval(p_case jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$
      DECLARE
        v_facts jsonb := p_case -> 'facts'; v_role jsonb; v_rule_j jsonb; v_rule public.commission_rules; v_picked public.commission_rules;
        v_found boolean; v_out jsonb := '[]'::jsonb; v_payee jsonb; v_empty jsonb;
      BEGIN
        FOR v_role IN SELECT * FROM jsonb_array_elements(p_case -> 'roles') LOOP
          CONTINUE WHEN NOT COALESCE((v_role ->> 'active')::boolean, false);
          v_found := false; v_picked := NULL;
          FOR v_rule_j IN
            SELECT x FROM jsonb_array_elements(p_case -> 'rules') WITH ORDINALITY t(x, o)
             WHERE x ->> 'role' = v_role ->> 'key' AND COALESCE((x ->> 'is_active')::boolean, true) AND COALESCE(x ->> 'archived_at', '') = ''
             ORDER BY (x ->> 'position')::int, o
          LOOP
            v_rule := jsonb_populate_record(NULL::public.commission_rules, v_rule_j);
            IF public.commission_rule_matches(v_rule, v_facts, v_role ->> 'payee') THEN v_picked := v_rule; v_found := true; EXIT; END IF;
          END LOOP;
          IF NOT v_found THEN
            v_out := v_out || jsonb_build_object('role', v_role ->> 'key', 'ruleId', NULL, 'applies', false, 'userId', NULL, 'baseCents', 0, 'amountCents', 0);
            CONTINUE;
          END IF;
          v_payee := public.commission_payee(v_role, v_picked, v_facts);
          IF NOT (v_payee ->> 'applies')::boolean THEN
            v_out := v_out || jsonb_build_object('role', v_role ->> 'key', 'ruleId', v_picked.id, 'applies', false, 'userId', NULL, 'baseCents', 0, 'amountCents', 0);
            CONTINUE;
          END IF;
          v_out := v_out || jsonb_build_object('role', v_role ->> 'key', 'ruleId', v_picked.id, 'applies', true, 'userId', v_payee -> 'user_id',
                      'baseCents', public.commission_base_cents(v_picked, v_facts), 'amountCents', public.commission_amount_cents(v_picked, v_facts));
        END LOOP;
        RETURN v_out;
      END $f$;
      SELECT o AS ord, pg_temp.cm_eval(c) AS result FROM jsonb_array_elements(${lit(JSON.stringify(cases))}::jsonb) WITH ORDINALITY t(c, o) ORDER BY o;`;
    const rows = sqlFile(evalSql);
    check(rows.length === cases.length, "la base evaluo todos los casos", `${rows.length} de ${cases.length}`);
    let diffs = 0;
    for (const row of rows) {
      const c = cases[row.ord - 1];
      const got = JSON.stringify(row.result);
      const want = JSON.stringify(c.expected.map((e) => ({ role: e.role, ruleId: e.ruleId, applies: e.applies, userId: e.userId, baseCents: e.baseCents, amountCents: e.amountCents })));
      const norm = (s) => JSON.stringify(JSON.parse(s).map((e) => Object.fromEntries(Object.entries(e).sort())));
      if (norm(got) !== norm(want)) { diffs += 1; fail(`paridad: ${c.name}`, `SQL ${got}\n        TS  ${want}`); }
    }
    check(diffs === 0, `la paridad de los ${cases.length} casos da 0 diferencias`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-comm", slug: `zz-test-comm-${stamp}`, timezone: "America/Costa_Rica" }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-comm-otro", slug: `zz-test-comm-otro-${stamp}` }).select("id").single();

  const owner = await makeUser("comm-owner");
  const ana = await makeUser("comm-ana");       // Member de sistema: vendedora
  const juan = await makeUser("comm-juan");     // Member de sistema: setter
  const carla = await makeUser("comm-carla");   // Member de sistema: responsable de piezas
  const viewer = await makeUser("comm-viewer"); // rol con commissions.view de alcance all
  const nokey = await makeUser("comm-nokey");   // rol sin commissions.view
  const finance = await makeUser("comm-fin");   // rol con expenses.view + expenses.manage
  const outsider = await makeUser("comm-out");
  const { data: viewRole } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name: "zz-test ve todas", permissions: { keys: ["commissions.view"], scopes: { commissions: "all" } } }).select("id").single();
  const { data: noRole } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name: "zz-test sin comisiones", permissions: { keys: ["contacts.view"], scopes: {} } }).select("id").single();
  const { data: finRole } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name: "zz-test contable", permissions: { keys: ["expenses.view", "expenses.manage"], scopes: {} } }).select("id").single();
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: ana.id, role: "member" },
    { workspace_id: ws.id, user_id: juan.id, role: "member" },
    { workspace_id: ws.id, user_id: carla.id, role: "member" },
    { workspace_id: ws.id, user_id: viewer.id, role: "member", role_id: viewRole.id },
    { workspace_id: ws.id, user_id: nokey.id, role: "member", role_id: noRole.id },
    { workspace_id: ws.id, user_id: finance.id, role: "member", role_id: finRole.id },
    { workspace_id: ws2.id, user_id: outsider.id, role: "owner" },
  ]);

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— content_owner: paridad con los casos de TypeScript —");
  {
    const cases = JSON.parse(readFileSync("lib/commissions/content-owner.cases.json", "utf8")).cases;
    // Los ids de los casos (a000…03, a000…05) no son usuarios: se mapean a dos miembros de verdad.
    const map = { "a0000000-0000-4000-8000-000000000003": carla.id, "a0000000-0000-4000-8000-000000000005": juan.id };
    const real = (id) => (id ? (map[id] ?? id) : null);
    for (const c of cases) {
      const seed = c.seed;
      let pieceId = null;
      let pubId = null;
      if (seed.contentPost) {
        const { data } = await svc.from("content_posts").insert({ workspace_id: ws.id, title: `zz-test ${c.name.slice(0, 40)}`, created_by: owner.id, assigned_to: real(seed.contentPost.assignedTo) }).select("id").single();
        pieceId = data.id;
        await svc.from("content_posts").update({ assigned_to: real(seed.contentPost.assignedTo) }).eq("id", pieceId);
      }
      if (seed.socialPost) {
        const { data } = await svc.from("social_posts").insert({ workspace_id: ws.id, platform: "instagram", origin: "external", external_post_id: `zz-test-co-${randomUUID()}`, content_post_id: seed.socialPost.linkedToContentPost ? pieceId : null, assigned_to: real(seed.socialPost.assignedTo) }).select("id").single();
        pubId = data.id;
      }
      const linked = !!seed.socialPost?.linkedToContentPost;
      const { data: got, error } = await svc.rpc("commission_content_owner", { p_social_post_id: pubId, p_content_post_id: linked ? null : pieceId, p_workspace: ws.id });
      check(!error && (got ?? null) === real(c.expected), `content_owner: ${c.name}`, error?.message ?? `dio ${got}, esperaba ${real(c.expected)}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Roles y reglas: CM001 y CM002 —");
  const codeOf = (r) => r.error?.code;
  {
    const settings = (await svc.from("workspaces").select("commission_settings").eq("id", ws.id).single()).data.commission_settings;
    check(settings.roles.map((r) => r.key).join(",") === "vendedor,setter,contenido,pauta" && settings.roles.every((r) => r.system && r.active), "un workspace trae los 4 roles precargados");
    const del = await svc.from("workspaces").update({ commission_settings: { roles: settings.roles.slice(1) } }).eq("id", ws.id);
    check(codeOf(del) === "CM002", "borrar un rol se rechaza (CM002)", del.error?.message);
    const payee = await svc.from("workspaces").update({ commission_settings: { roles: settings.roles.map((r) => (r.key === "vendedor" ? { ...r, payee: "fixed" } : r)) } }).eq("id", ws.id);
    check(codeOf(payee) === "CM002", "un precargado no cambia de `payee` (CM002)");
    const sys = await svc.from("workspaces").update({ commission_settings: { roles: settings.roles.map((r) => (r.key === "vendedor" ? { ...r, system: false } : r)) } }).eq("id", ws.id);
    check(codeOf(sys) === "CM002", "un precargado sigue siendo precargado (CM002)");
    const dup = await svc.from("workspaces").update({ commission_settings: { roles: [...settings.roles, { key: "setter", name: "Otro", payee: "fixed", active: true, system: false, created_at: new Date().toISOString() }] } }).eq("id", ws.id);
    check(codeOf(dup) === "CM002", "dos roles con la misma clave se rechazan");
    const badKey = await svc.from("workspaces").update({ commission_settings: { roles: [...settings.roles, { key: "Mal Nombre", name: "x", payee: "fixed", active: true, system: false, created_at: new Date().toISOString() }] } }).eq("id", ws.id);
    check(codeOf(badKey) === "CM002", "una clave que no es ^[a-z0-9_]{2,40}$ se rechaza");
    const rename = await svc.from("workspaces").update({ commission_settings: { roles: settings.roles.map((r) => (r.key === "pauta" ? { ...r, name: "Paid media", active: false } : r)) } }).eq("id", ws.id);
    check(!rename.error, "renombrar y desactivar un precargado se puede", rename.error?.message);
    const custom = [
      ...settings.roles.map((r) => (r.key === "pauta" ? { ...r, name: "Paid media", active: true } : r)),
      { key: "marketing", name: "Marketing", payee: "fixed", active: true, system: false, created_at: new Date().toISOString() },
      { key: "organico", name: "Marketing organico", payee: "fixed", active: true, system: false, created_at: new Date().toISOString() },
      { key: "inactivo", name: "Inactivo", payee: "sale_vendedor", active: false, system: false, created_at: new Date().toISOString() },
    ];
    const add = await svc.from("workspaces").update({ commission_settings: { roles: custom } }).eq("id", ws.id);
    check(!add.error, "el negocio crea roles propios", add.error?.message);

    const rule = (over = {}) => ({ workspace_id: ws.id, name: "zz-test regla", role: "vendedor", position: 1, calc_type: "percent", rate: 8, base: "net_of_fees", ...over });
    const unknown = await svc.from("commission_rules").insert(rule({ role: "no_existe" }));
    check(codeOf(unknown) === "CM001", "una regla con un rol que no existe se rechaza (CM001)", unknown.error?.message);
    const inactive = await svc.from("commission_rules").insert(rule({ role: "inactivo", position: 1 }));
    check(codeOf(inactive) === "CM001", "una regla con un rol desactivado se rechaza (CM001)");
    const noPerson = await svc.from("commission_rules").insert(rule({ role: "marketing" }));
    check(codeOf(noPerson) === "CM001", "una regla de un rol de persona fija sin persona se rechaza (CM001)");
    const stranger = await svc.from("commission_rules").insert(rule({ role: "marketing", beneficiary_user_id: outsider.id }));
    check(codeOf(stranger) === "CM001", "la persona de la regla tiene que ser del equipo");
    const percent = await svc.from("commission_rules").insert(rule({ rate: 101 }));
    check(!!percent.error, "un porcentaje mayor que 100 se rechaza (CHECK)");
    const fixed = await svc.from("commission_rules").insert(rule({ calc_type: "fixed", rate: null, fixed_amount: 0 }));
    check(!!fixed.error, "un monto fijo en cero se rechaza (CHECK)");
    const first = await svc.from("commission_rules").insert(rule({ position: 1 }));
    check(!first.error, "una regla valida se crea", first.error?.message);
    const dupPos = await svc.from("commission_rules").insert(rule({ position: 1, name: "zz-test misma posicion" }));
    check(!!dupPos.error, "dos reglas vivas del mismo rol no comparten posicion");
    await svc.from("commission_rules").delete().eq("workspace_id", ws.id); // limpieza de este bloque (servicio)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Datos de venta: producto, contacto, piezas y toques.
  const { data: prod } = await svc.from("products").insert({ workspace_id: ws.id, name: `zz-test Mentoria ${stamp}` }).select("id").single();
  const { data: variant } = await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prod.id, name: "Estandar", price: 1000 }).select("id").single();
  const newContact = async (tag) => (await svc.from("contacts").insert({ workspace_id: ws.id, display_name: `zz-test ${tag}`, email: `zz-test-${tag}-${randomUUID().slice(0, 6)}@example.test` }).select("id").single()).data.id;
  const piece = (await svc.from("content_posts").insert({ workspace_id: ws.id, title: "zz-test Reel de dolares", created_by: owner.id, assigned_to: carla.id }).select("id").single()).data;
  await svc.from("content_posts").update({ assigned_to: carla.id }).eq("id", piece.id);
  const pieceNoOwner = (await svc.from("content_posts").insert({ workspace_id: ws.id, title: "zz-test Reel sin responsable", created_by: owner.id }).select("id").single()).data;
  await svc.from("content_posts").update({ assigned_to: null }).eq("id", pieceNoOwner.id);

  const touchFor = async (contactId, over) => (await svc.from("contact_touches").insert({ workspace_id: ws.id, contact_id: contactId, occurred_at: new Date().toISOString(), source: "instagram", medium: "organic_social", origin: "manual", dedupe_key: `zz-${randomUUID()}`, ...over }).select("id, channel").single()).data;
  const sale = async ({ tag, vendedor = ana.id, setter = juan.id, touch = null, financing = "installments", amount = 1500 }) => {
    const contactId = await newContact(tag);
    const { data, error } = await svc.from("sales").insert({
      workspace_id: ws.id, contact_id: contactId, product_snapshot: { product_id: prod.id, name: "Mentoria" }, base_amount: amount, final_amount: amount,
      status: "pending_payment", financing_type: financing, sale_date: new Date().toISOString().slice(0, 10), product_variant_id: variant.id,
      vendedor_id: vendedor, setter_id: setter, attribution_touch_id: touch, attribution_type: "manual", attribution: {},
    }).select("id").single();
    if (error) throw new Error(`no pude crear la venta: ${error.message}`);
    return { id: data.id, contactId };
  };
  let dueDay = 1;
  const pay = async (saleId, { amount = 500, fee = 14.8, method = "whop", type = "installment" } = {}) => {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await svc.from("payments").insert({
      workspace_id: ws.id, sale_id: saleId, type, amount, status: "paid", due_date: `2026-12-${String(dueDay++).padStart(2, "0")}`,
      paid_at: new Date().toISOString(), paid_on: today, payment_method: method, provider_fee_amount: fee,
    }).select("id").single();
    if (error) throw new Error(`no pude crear el pago: ${error.message}`);
    return data.id;
  };

  // Las reglas del flujo 7.1.
  const rules = {};
  const addRule = async (over) => {
    const { data, error } = await svc.from("commission_rules").insert({ workspace_id: ws.id, calc_type: "percent", base: "gross", ...over }).select("id").single();
    if (error) throw new Error(`no pude crear la regla ${over.name}: ${error.message}`);
    return data.id;
  };
  rules.vendedor = await addRule({ name: "Vendedor 8 % del neto", role: "vendedor", position: 1, rate: 8, base: "net_of_fees", conditions: { financing_types: ["installments"] } });
  rules.setter = await addRule({ name: "Setter 5 %", role: "setter", position: 1, rate: 5 });
  rules.contenido = await addRule({ name: "Contenido USD 15", role: "contenido", position: 1, calc_type: "fixed", rate: null, fixed_amount: 15, conditions: { channels: ["organic"] } });
  const centsOf = (rows) => Object.fromEntries(rows.map((r) => [r.role, Math.round(Number(r.amount) * 100)]));
  const commissionsOf = async (paymentId) => (await svc.from("commissions").select("*").eq("payment_id", paymentId).is("voided_at", null)).data ?? [];

  console.log("\n— Generar: el flujo 7.1 (38,82 / 25,00 / 15,00), idempotencia y concurrencia —");
  const orgTouch = async (contactId) => touchFor(contactId, { content_post_id: piece.id, content_label: "c9test" });
  let s1, p1;
  {
    s1 = await sale({ tag: "flujo71" });
    const t = await orgTouch(s1.contactId);
    await svc.from("sales").update({ attribution_touch_id: t.id }).eq("id", s1.id);
    p1 = await pay(s1.id);
    const facts = (await svc.rpc("commission_facts", { p_payment_id: p1 })).data;
    check(facts?.payment?.number === 1 && facts?.sale?.product_id === prod.id && facts?.content_assignee_id === carla.id && facts?.touch?.channel === "organic",
      "commission_facts: numero de pago, producto y dueno de la pieza", JSON.stringify(facts));

    const r1 = await svc.rpc("generate_commissions_for_payment", { p_payment_id: p1 });
    check(!r1.error && r1.data?.created === 3, "cobrar una cuota de USD 500 (fee 14,80) crea 3 comisiones", r1.error?.message ?? JSON.stringify(r1.data));
    const cents = centsOf(await commissionsOf(p1));
    check(cents.vendedor === 3882 && cents.setter === 2500 && cents.contenido === 1500, "...de 38,82 / 25,00 / 15,00", JSON.stringify(cents));
    const rows = await commissionsOf(p1);
    check(rows.find((r) => r.role === "vendedor")?.user_id === ana.id && rows.find((r) => r.role === "setter")?.user_id === juan.id && rows.find((r) => r.role === "contenido")?.user_id === carla.id, "...a Ana, Juan y Carla");
    check(rows.every((r) => r.rule_snapshot?.name && r.attribution_touch_id && r.attribution_snapshot?.content_title === "zz-test Reel de dolares" && r.paid_on), "...con la foto de la regla y de la atribucion");

    const again = await svc.rpc("generate_commissions_for_payment", { p_payment_id: p1 });
    check(again.data?.created === 0 && (await commissionsOf(p1)).length === 3, "correr la generacion otra vez no duplica (siguen 3)");
    const burst = await Promise.all(Array.from({ length: 6 }, () => svc.rpc("generate_commissions_for_payment", { p_payment_id: p1 })));
    check(burst.every((b) => !b.error) && (await commissionsOf(p1)).length === 3, "6 llamadas a la vez siguen dando 3 comisiones");

    const p2 = await pay(s1.id);
    const nonPaid = await svc.rpc("generate_commissions_for_payment", { p_payment_id: randomUUID() });
    check(nonPaid.data?.skipped === "not_found", "un pago que no existe no genera nada");
    const facts2 = (await svc.rpc("commission_facts", { p_payment_id: p2 })).data;
    check(facts2?.payment?.number === 2, "el segundo pago es el numero 2");
  }

  console.log("\n— Generar: roles que no aplican, sin persona y reglas de UTM / canal —");
  {
    // Sin setter: no hay comision de setter. Sin pieza: no hay de contenido.
    const s = await sale({ tag: "sinsetter", setter: null });
    const p = await pay(s.id);
    await svc.rpc("generate_commissions_for_payment", { p_payment_id: p });
    const cents = centsOf(await commissionsOf(p));
    check(cents.vendedor === 3882 && cents.setter === undefined && cents.contenido === undefined, "sin setter y sin pieza: solo la comision del vendedor", JSON.stringify(cents));

    // Pieza sin responsable: se crea igual con user_id null ("Sin persona").
    const s2 = await sale({ tag: "sinresp" });
    const t2 = await touchFor(s2.contactId, { content_post_id: pieceNoOwner.id });
    await svc.from("sales").update({ attribution_touch_id: t2.id }).eq("id", s2.id);
    const p2 = await pay(s2.id);
    await svc.rpc("generate_commissions_for_payment", { p_payment_id: p2 });
    const sinPersona = (await commissionsOf(p2)).find((r) => r.role === "contenido");
    check(sinPersona && sinPersona.user_id === null, "una pieza sin responsable crea la comision de Contenido con user_id = null");

    // Marketing (persona fija): utm.campaign contiene «webinar».
    const mk = await addRule({ name: "Marketing webinar 2 %", role: "marketing", position: 1, rate: 2, beneficiary_user_id: carla.id, conditions: { utm: { campaign: { op: "contains", values: ["webinar"] } } } });
    const s3 = await sale({ tag: "utmweb" });
    const t3 = await touchFor(s3.contactId, { campaign: "Webinar-Oct" });
    await svc.from("sales").update({ attribution_touch_id: t3.id }).eq("id", s3.id);
    const p3 = await pay(s3.id);
    await svc.rpc("generate_commissions_for_payment", { p_payment_id: p3 });
    const marketing = (await commissionsOf(p3)).find((r) => r.role === "marketing");
    check(marketing && marketing.user_id === carla.id && Math.round(Number(marketing.amount) * 100) === 1000, "utm_campaign «Webinar-Oct» (sin importar mayusculas) genera la comision de Marketing para Carla");
    const s4 = await sale({ tag: "utmbio" });
    const t4 = await touchFor(s4.contactId, { campaign: "bio" });
    await svc.from("sales").update({ attribution_touch_id: t4.id }).eq("id", s4.id);
    const p4 = await pay(s4.id);
    await svc.rpc("generate_commissions_for_payment", { p_payment_id: p4 });
    check(!(await commissionsOf(p4)).some((r) => r.role === "marketing"), "con utm_campaign «bio» no");

    // Dos roles de persona fija con reglas por canal: un pago organico genera solo el primero.
    const org = await addRule({ name: "Organico 3 %", role: "organico", position: 1, rate: 3, beneficiary_user_id: ana.id, conditions: { channels: ["organic"] } });
    const paid = await addRule({ name: "Pauta 4 %", role: "pauta", position: 1, rate: 4, beneficiary_user_id: juan.id, conditions: { channels: ["paid"] } });
    const s5 = await sale({ tag: "canal" });
    const t5 = await touchFor(s5.contactId, { content_post_id: piece.id });
    await svc.from("sales").update({ attribution_touch_id: t5.id }).eq("id", s5.id);
    const p5 = await pay(s5.id);
    await svc.rpc("generate_commissions_for_payment", { p_payment_id: p5 });
    const r5 = await commissionsOf(p5);
    check(r5.some((r) => r.role === "organico") && !r5.some((r) => r.role === "pauta"), "un pago organico genera solo la del rol «Marketing organico», no la de «Pauta»");
    void mk; void org; void paid;
  }

  console.log("\n— Reversion de un cobro, venta cancelada y estados —");
  {
    const s = await sale({ tag: "revert" });
    const t = await orgTouch(s.contactId);
    await svc.from("sales").update({ attribution_touch_id: t.id }).eq("id", s.id);
    const p = await pay(s.id);
    await svc.rpc("generate_commissions_for_payment", { p_payment_id: p });
    check((await commissionsOf(p)).length >= 3, "el pago tiene sus comisiones");
    const stillPaid = await svc.rpc("revert_commissions_for_payment", { p_payment_id: p });
    check(stillPaid.data?.skipped === "still_paid", "revertir un pago que sigue cobrado no hace nada (carrera)");

    // Se liquida una comision (queda en un gasto) y se revierte el cobro: la liquidada va a revision, el resto se anula.
    const inExpense = (await commissionsOf(p)).find((r) => r.role === "setter");
    const payout = await svc.rpc("create_commission_payout", { p_workspace: ws.id, p_commission_ids: [inExpense.id], p_mode: "per_person", p_scheduled_date: new Date().toISOString().slice(0, 10), p_concepts: {}, p_notes: null, p_actor: owner.id, p_today: new Date().toISOString().slice(0, 10) });
    check(payout.data?.expenses?.length === 1, "una comision se liquida en un gasto", JSON.stringify(payout.error ?? payout.data));
    await svc.from("payments").update({ status: "scheduled", paid_at: null, paid_on: null, provider_fee_amount: null, provider_fee_percent: null, provider_fee_fixed: null }).eq("id", p);
    const rev = await svc.rpc("revert_commissions_for_payment", { p_payment_id: p });
    check(rev.data?.voided?.length >= 2 && rev.data?.needs_review?.length === 1 && rev.data.needs_review[0] === inExpense.id, "revertir el cobro anula las libres y deja la liquidada en `needs_review`", JSON.stringify(rev.data));
    const voided = (await svc.from("commissions").select("void_reason, voided_by").eq("payment_id", p).not("voided_at", "is", null)).data ?? [];
    check(voided.every((v) => v.void_reason === "Se revirtió el cobro" && v.voided_by === null), "...con el motivo «Se revirtió el cobro» y sin autor");
    // Cobrar de nuevo genera comisiones nuevas (el unico es parcial).
    await svc.from("payments").update({ status: "paid", paid_at: new Date().toISOString(), paid_on: new Date().toISOString().slice(0, 10), provider_fee_amount: 14.8 }).eq("id", p);
    const regen = await svc.rpc("generate_commissions_for_payment", { p_payment_id: p });
    check(regen.data?.created >= 2, "cobrar de nuevo genera comisiones nuevas", JSON.stringify(regen.data));

    // Venta cancelada: lo ya generado no cambia.
    const s2 = await sale({ tag: "cancel" });
    const p2 = await pay(s2.id);
    await svc.rpc("generate_commissions_for_payment", { p_payment_id: p2 });
    const before = JSON.stringify((await commissionsOf(p2)).map((c) => [c.id, c.amount, c.voided_at]).sort());
    await svc.from("sales").update({ status: "cancelled" }).eq("id", s2.id);
    check(JSON.stringify((await commissionsOf(p2)).map((c) => [c.id, c.amount, c.voided_at]).sort()) === before, "cancelar la venta no cambia las comisiones ya generadas");
  }

  console.log("\n— RLS: quien ve que —");
  {
    const s = await sale({ tag: "rls" });
    const t = await orgTouch(s.contactId);
    await svc.from("sales").update({ attribution_touch_id: t.id }).eq("id", s.id);
    const p = await pay(s.id);
    await svc.rpc("generate_commissions_for_payment", { p_payment_id: p });
    const all = (await commissionsOf(p));
    const see = async (user) => ((await user.client.from("commissions").select("id, user_id, role").eq("payment_id", p)).data ?? []);
    const anaSees = await see(ana);
    check(anaSees.length >= 1 && anaSees.every((r) => r.user_id === ana.id), "un Member ve solo las suyas");
    check((await see(juan)).every((r) => r.user_id === juan.id) && (await see(juan)).length >= 1, "otro Member ve solo las suyas");
    check((await see(outsider)).length === 0, "alguien de otro workspace no ve ninguna");
    check((await see(nokey)).length === 0, "un rol sin `commissions.view` no ve ninguna");
    check((await see(viewer)).length === all.length, "un rol con `commissions.view` de alcance `all` ve todas", `${(await see(viewer)).length} de ${all.length}`);
    check((await see(owner)).length === all.length, "el Owner ve todas");

    const write = await ana.client.from("commissions").insert({ workspace_id: ws.id, kind: "adjustment", user_id: ana.id, amount: 5, available_on: "2026-10-15", notes: "x" });
    check(!!write.error, "nadie inserta con su sesion");
    const upd = await ana.client.from("commissions").update({ notes: "hackeo" }).eq("id", anaSees[0].id).select("id");
    check((upd.data ?? []).length === 0, "nadie actualiza con su sesion (ni la suya)");
    const del = await owner.client.from("commissions").delete().eq("id", anaSees[0].id).select("id");
    check((del.data ?? []).length === 0, "ni el Owner borra con su sesion");

    const rulesAna = (await ana.client.from("commission_rules").select("id")).data ?? [];
    const rulesViewer = (await viewer.client.from("commission_rules").select("id")).data ?? [];
    const rulesOwner = (await owner.client.from("commission_rules").select("id")).data ?? [];
    check(rulesAna.length === 0 && rulesViewer.length > 0 && rulesOwner.length === rulesViewer.length, "las reglas las ven Owner/Admin y quien ve todas; un Member no");
    check((await ana.client.from("commission_rules").insert({ workspace_id: ws.id, name: "x", role: "vendedor", position: 9, calc_type: "percent", rate: 1 })).error !== null, "nadie crea reglas con su sesion");

    const nullCheck = sql(`select public.can_see_commission(c) as v from public.commissions c where c.id = ${lit(all[0].id)}`);
    check(nullCheck[0]?.v === false, "can_see_commission devuelve false (no NULL) sin sesion");

    // M9 en la base: el Member puede ver comisiones pero no administrarlas.
    check((await ana.client.rpc("has_permission", { p_workspace_id: ws.id, p_key: "commissions.view" })).data === true, "el Member de sistema tiene `commissions.view` en la base (M9)");
    check((await ana.client.rpc("has_permission", { p_workspace_id: ws.id, p_key: "commissions.manage" })).data === false, "...y NO `commissions.manage`");

    // El historial: una persona ve la historia de SU comision, no la de otra.
    const mine = anaSees[0].id;
    const others = all.find((c) => c.user_id !== ana.id);
    const hist = async (user, id) => ((await user.client.from("audit_log").select("id").eq("entity_type", "commission").eq("entity_id", id)).data ?? []).length;
    check((await hist(ana, mine)) >= 1 && (await hist(ana, others.id)) === 0, "el historial: una persona ve el de SU comision y no el de otra (audit_log_select_commissions)");
    check((await hist(owner, others.id)) >= 1 && (await hist(viewer, others.id)) >= 1, "...el Owner y quien ve todas, el de cualquiera");
    check((await hist(outsider, mine)) === 0, "...otro workspace, ninguno");
  }

  console.log("\n— Liquidar: gastos por persona, totales, concurrencia y liberar —");
  {
    const today = new Date().toISOString().slice(0, 10);
    const mk = async (user, amount, extra = {}) => (await svc.from("commissions").insert({ workspace_id: ws.id, kind: "adjustment", user_id: user, amount, available_on: today, paid_on: today, notes: "zz-test ajuste", ...extra }).select("id").single()).data.id;
    const a1 = await mk(ana.id, 50), a2 = await mk(ana.id, 30), a3 = await mk(ana.id, -10);
    const j1 = await mk(juan.id, 25), j2 = await mk(juan.id, 25);
    const run = (ids, over = {}) => svc.rpc("create_commission_payout", { p_workspace: ws.id, p_commission_ids: ids, p_mode: "per_person", p_scheduled_date: today, p_concepts: {}, p_notes: "zz-test", p_actor: owner.id, p_today: today, ...over });
    const res = await run([a1, a2, a3, j1, j2]);
    const byUser = Object.fromEntries((res.data?.expenses ?? []).map((e) => [e.user_id, Number(e.amount)]));
    check(!res.error && byUser[ana.id] === 70 && byUser[juan.id] === 50 && res.data.expenses.length === 2, "tres de Ana (+50, +30, −10) y dos de Juan (+25, +25): dos gastos de 70,00 y 50,00", JSON.stringify(res.error ?? res.data));
    const linked = (await svc.from("commissions").select("expense_id").in("id", [a1, a2, a3, j1, j2])).data ?? [];
    check(linked.every((c) => c.expense_id), "las 5 comisiones quedaron con su gasto");
    const exp = (await svc.from("expenses").select("*").eq("id", res.data.expenses.find((e) => e.user_id === ana.id).id).single()).data;
    check(exp.origin === "commission_payout" && exp.category_key === "commissions" && exp.status === "programado" && exp.vendor_id && exp.source_ref?.count === 3, "el gasto: origen liquidacion, categoria Comisiones, programado, con proveedor de la persona");
    const vendor = (await svc.from("vendors").select("user_id").eq("id", exp.vendor_id).single()).data;
    check(vendor.user_id === ana.id, "...cuyo proveedor es Ana (vendors.user_id)");

    const fin = await finance.client.from("expenses").update({ amount: 1 }).eq("id", exp.id).select("id");
    check((fin.data ?? []).length === 0 || !!fin.error, "con la sesion no se edita el monto de un gasto de liquidacion", fin.error?.message);
    const finVoid = await finance.client.from("expenses").update({ status: "anulado", void_reason: "zz-test", void_kind: "manual", voided_at: new Date().toISOString() }).eq("id", exp.id).select("id");
    check(!finVoid.error && (finVoid.data ?? []).length === 1, "con `expenses.manage` se puede anular el gasto", finVoid.error?.message);
    const released = (await svc.from("commissions").select("expense_id").in("id", [a1, a2, a3])).data ?? [];
    check(released.every((c) => c.expense_id === null), "al anular el gasto de Ana sus 3 comisiones vuelven a Pendiente (expense_id = null)");
    const relAudit = (await svc.from("audit_log").select("id").eq("entity_type", "commission").eq("action", "commission.payout_released").eq("entity_id", a1)).data ?? [];
    check(relAudit.length === 1, "...y queda en el historial (commission.payout_released)");

    // Total no positivo.
    const b1 = await mk(carla.id, 10), b2 = await mk(carla.id, -30);
    const neg = await run([b1, b2]);
    check(neg.data?.expenses?.length === 0 && (neg.data?.excluded ?? []).filter((e) => e.reason === "non_positive_total").length === 2, "Ana-like con (+10, −30): el grupo se excluye entero (non_positive_total)", JSON.stringify(neg.data));
    check(((await svc.from("commissions").select("expense_id").in("id", [b1, b2])).data ?? []).every((c) => c.expense_id === null), "...y sus comisiones quedan sin gasto");

    // Exclusiones.
    const voidedId = await mk(ana.id, 5, { voided_at: new Date().toISOString(), void_reason: "zz-test" });
    const heldId = await mk(ana.id, 5, { available_on: "2099-01-01" });
    const noPersonId = await mk(null, 5);
    const ex = await run([voidedId, heldId, noPersonId, randomUUID()]);
    const reasons = Object.fromEntries((ex.data?.excluded ?? []).map((e) => [e.id, e.reason]));
    check(reasons[voidedId] === "voided" && reasons[heldId] === "held" && reasons[noPersonId] === "no_person" && ex.data.excluded.some((e) => e.reason === "not_found"), "se excluyen con motivo las anuladas, las retenidas, las sin persona y las que no existen", JSON.stringify(reasons));

    // Concurrencia real.
    const c1 = await mk(ana.id, 40), c2 = await mk(juan.id, 40);
    const pair = await Promise.all([run([c1, c2]), run([c1, c2])]);
    const made = pair.flatMap((r) => r.data?.expenses ?? []);
    const dupes = pair.flatMap((r) => r.data?.excluded ?? []).filter((e) => e.reason === "already_in_expense");
    check(made.length === 2 && dupes.length === 2, "dos llamadas simultaneas con las mismas comisiones: UN gasto por persona y la otra las devuelve como already_in_expense", JSON.stringify(pair.map((r) => r.error?.message ?? { e: r.data?.expenses?.length, x: r.data?.excluded?.length })));
    const single = await svc.rpc("create_commission_payout", { p_workspace: ws.id, p_commission_ids: [await mk(ana.id, 10), await mk(juan.id, 12)], p_mode: "single", p_scheduled_date: today, p_concepts: { single: "Comisiones del equipo" }, p_notes: null, p_actor: owner.id, p_today: today });
    check(single.data?.expenses?.length === 1 && Number(single.data.expenses[0].amount) === 22, "en modo «un solo gasto» se junta todo en uno", JSON.stringify(single.error ?? single.data));
    const bad = await svc.rpc("create_commission_payout", { p_workspace: ws.id, p_commission_ids: [await mk(ana.id, 5)], p_mode: "per_person", p_scheduled_date: "2020-01-01", p_concepts: {}, p_notes: null, p_actor: owner.id, p_today: today });
    check(!!bad.error, "una fecha de hace mas de 60 dias se rechaza");
    const noExecute = await ana.client.rpc("create_commission_payout", { p_workspace: ws.id, p_commission_ids: [], p_mode: "per_person", p_scheduled_date: today, p_concepts: {}, p_notes: null, p_actor: ana.id, p_today: today });
    check(!!noExecute.error, "una persona con sesion NO puede llamar a create_commission_payout");
  }

  console.log("\n— commissions_guard —");
  {
    const today = new Date().toISOString().slice(0, 10);
    const id = (await svc.from("commissions").insert({ workspace_id: ws.id, kind: "adjustment", user_id: ana.id, amount: 20, available_on: today, notes: "zz-test guard" }).select("id").single()).data.id;
    check(codeOf(await svc.from("commissions").update({ amount: 99 }).eq("id", id)) === "CM003", "el servicio no cambia el monto de una comision (CM003)");
    check(!!(await svc.from("commissions").update({ kind: "earned" }).eq("id", id)).error, "ni el tipo");
    check(!(await svc.from("commissions").update({ notes: "otra", user_id: juan.id }).eq("id", id)).error, "pero si la persona y las notas (asignar persona / anotar)");
    // Soltar de un gasto pagado.
    const exp = (await svc.from("expenses").insert({ workspace_id: ws.id, concept: "zz-test pagado", category_key: "commissions", amount: 20, status: "pagado", scheduled_date: today, paid_date: today, origin: "commission_payout", source_ref: { mode: "single" } }).select("id").single()).data.id;
    await svc.from("commissions").update({ expense_id: exp }).eq("id", id);
    check(codeOf(await svc.from("commissions").update({ expense_id: null }).eq("id", id)) === "CM003", "una comision de un gasto PAGADO no se suelta (CM003)");
  }

  console.log("\n— La funcion del trigger de pagos (la 00235 la conecta) —");
  {
    const s = await sale({ tag: "trig" });
    const probe = (body) => sqlProbe(`
      DO $$
      DECLARE n int; pid uuid;
      BEGIN
        DROP TRIGGER IF EXISTS zz_probe_comm ON public.payments;
        CREATE TRIGGER zz_probe_comm AFTER INSERT OR UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION private.enqueue_commissions_for_payment();
        ${body}
        SELECT count(*) INTO n FROM public.scheduled_jobs WHERE type = 'commissions_payment' AND payload ->> 'payment_id' = pid::text;
        RAISE EXCEPTION 'RESULTADO: %', n;
      END $$;`);
    const insert = `INSERT INTO public.payments (workspace_id, sale_id, type, amount, status, due_date, paid_at, paid_on, payment_method)
                    VALUES (${lit(ws.id)}, ${lit(s.id)}, 'installment', 100, 'paid', '2027-01-01', now(), current_date, 'whop') RETURNING id INTO pid;`;
    check(probe(insert) === "1", "un pago que entra a `paid` encola UNA generacion");
    check(probe(`${insert} UPDATE public.payments SET notes = 'x' WHERE id = pid;`) === "1", "cambiar otra cosa del pago no encola otra");
    check(probe(`${insert} UPDATE public.payments SET status='scheduled', paid_at=NULL, paid_on=NULL, provider_fee_amount=NULL, provider_fee_percent=NULL, provider_fee_fixed=NULL WHERE id = pid;`) === "2", "salir de `paid` encola una reversion");
    check(probe(`INSERT INTO public.payments (workspace_id, sale_id, type, amount, status, due_date) VALUES (${lit(ws.id)}, ${lit(s.id)}, 'installment', 100, 'scheduled', '2027-02-01') RETURNING id INTO pid;`) === "0", "un pago programado no encola nada");
    const failing = probe(`ALTER TABLE public.scheduled_jobs ADD CONSTRAINT zz_fail CHECK (false) NOT VALID; ${insert}`);
    check(failing === "0", "si no puede encolar, NO lanza: el cobro se guarda igual", failing);
    const hook = sql("select tgname from pg_trigger where tgrelid = 'public.payments'::regclass and tgname = 'payments_enqueue_commissions'");
    if (AFTER_00235) check(hook.length === 1, "el trigger payments_enqueue_commissions existe (00235)");
    else check(hook.length === 0, "el trigger payments_enqueue_commissions todavia NO existe (la 00235 se aplica despues del merge)");
  }

  if (AFTER_00235) {
    console.log("\n— Despues de la 00235: cobrar → se encola →  se generan —");
    const s = await sale({ tag: "real" });
    const p = await pay(s.id);
    const jobs = sql(`select count(*)::int as n from public.scheduled_jobs where type = 'commissions_payment' and payload ->> 'payment_id' = ${lit(p)}`);
    check(jobs[0].n === 1, "cobrar un pago encola el trabajo de comisiones");
  }

  console.log("\n— Lo que NO se toco —");
  {
    checkProtectedFunctions(sql, check);
    const aud = sql("select md5(pg_get_expr(polqual, polrelid)) as h from pg_policy where polname = 'audit_log_select'");
    check(aud[0]?.h === "5b4ffabd6da14a30309c552801302836", "la definicion de audit_log_select es IDENTICA a la de antes");
    const anon = await createClient(URL, ANON, { auth: { persistSession: false } }).rpc("commission_facts", { p_payment_id: randomUUID() });
    check(!!anon.error, "anon no puede llamar a commission_facts");
    const fns = sql("select proname, prosecdef from pg_proc where proname in ('generate_commissions_for_payment','revert_commissions_for_payment','create_commission_payout','commission_facts','commission_pick_rule','commission_content_owner','can_see_commission')");
    check(fns.length === 7 && fns.every((f) => f.prosecdef), "las siete funciones SECURITY DEFINER existen");
    const grants = sql("select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as a from pg_proc p where p.proname in ('generate_commissions_for_payment','revert_commissions_for_payment','create_commission_payout','commission_facts','commission_pick_rule','commission_content_owner')");
    check(grants.every((g) => g.a === false), "ninguna de las funciones de escritura o de lectura interna la ejecuta `authenticated`");
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

console.log(failures ? `\n${failures} falla(s)` : "\nTodo verde");
process.exit(failures ? 1 : 0);
