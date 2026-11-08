#!/usr/bin/env node
// @plantilla-quitar(ventas)
/**
 * Verificacion de afiliados y links (Servicios A1, bloque AF, migracion 00343).
 *
 * Corre contra la base real con usuarios de verdad. Prueba lo que vitest no puede: que las gemelas SQL den lo mismo que
 * TypeScript (links, reglas, asignacion y «pagar solo la mayor»), que las guardas rechacen escrituras directas (AF010),
 * que los codigos sean unicos y para siempre (AF001, AF004), que entrar por un link con ?ref= asigne el afiliado y que
 * un fallo del gancho no tumbe el toque.
 *
 *   node scripts/verify-affiliates.mjs
 *
 * Crea y borra todo lo suyo (prefijo zz-test-). No se corre a la vez que otro verify-*: candado
 * /private/tmp/ssa-verify.lock.
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

/** Llama una funcion de afiliados (esquema public) con la sesion de la persona, por la API (como la app). */
async function rpcAs(user, fn, args) {
  const { data, error } = await user.client.rpc(fn, args);
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


const hoy = new Date().toISOString().slice(0, 10);

try {
  console.log("\naf · Casos compartidos contra la base (gemelas)");
  const runCases = (file, label, toSql, expected) => {
    const { cases } = json(file);
    const bad = [];
    const got = sql(`SELECT jsonb_build_array(${cases.map((c) => `to_jsonb(${toSql(c)})`).join(", ")}) AS r`)[0]?.r ?? [];
    cases.forEach((c, i) => {
      if (!eq(got[i], expected(c))) bad.push(`${c.name}: dio ${JSON.stringify(got[i])}`);
    });
    check(bad.length === 0, `${label}: los ${cases.length} casos dan lo mismo que en TypeScript`, bad.slice(0, 3).join(" | "));
  };
  const uuidArr = (ids) => (ids && ids.length ? `ARRAY[${ids.map(lit).join(", ")}]::uuid[]` : "ARRAY[]::uuid[]");
  runCases("lib/affiliates/product-links.cases.json", "validate_product_links", (c) => `to_jsonb(public.validate_product_links(${jlit(c.links)}, ${uuidArr(c.variants)}))`, (c) => c.expected);
  runCases("lib/affiliates/affiliate-settings.cases.json", "validate_affiliate_settings", (c) => `to_jsonb(public.validate_affiliate_settings(${jlit(c.input)}))`, (c) => c.expected);
  runCases("lib/affiliates/affiliate-assign.cases.json", "affiliate_assign_plan", (c) => `public.affiliate_assign_plan(${jlit(c.input)})`, (c) => c.expected);
  runCases("lib/commissions/when-also-seller.cases.json", "commission_apply_max", (c) => `(SELECT jsonb_agg(COALESCE((e ->> 'applies')::boolean, false) ORDER BY o) FROM jsonb_array_elements(public.commission_apply_max(${jlit(c.evals)})) WITH ORDINALITY x(e, o))`, (c) => c.expected);

  // ── Negocio de prueba ───────────────────────────────────────────────────
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-afiliados", slug: `zz-test-afiliados-${Date.now()}` }).select("id, affiliate_settings").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);
  const owner = await makeUser("af-owner");
  const member = await makeUser("af-member");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
  ]);
  const { data: prod } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test Producto con links", product_type: "programa" }).select("id, links, links_rev").single();
  const { data: variant } = await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prod.id, name: "zz-test v", price: 1000 }).select("id").single();
  const newContact = async (t, extra = {}) => (await svc.from("contacts").insert({ workspace_id: ws.id, display_name: `zz-test ${t}`, ...extra }).select("id, created_at").single()).data;

  console.log("\naf · Los links del producto (F70)");
  check(eq(prod.links, { v: 1, items: [] }) && prod.links_rev === 0, "un producto nace con la lista de links vacia");
  const links = { v: 1, primary_learn: "lk_zztst1", items: [{ key: "lk_zztst1", name: "Landing", kind: "landing", url: "https://ejemplo.test/landing", active: true, valid_until: null, variant_id: variant.id }] };
  const save = await rpcAs(owner, "product_links_save", { p_product_id: prod.id, p_links: links, p_rev: 0 });
  check(!save.error && save.data?.status === "ok" && save.data?.rev === 1, "el Owner guarda los links con su sesion", save.error ?? JSON.stringify(save.data));
  const stale = await rpcAs(owner, "product_links_save", { p_product_id: prod.id, p_links: links, p_rev: 0 });
  check(!stale.error && stale.data?.status === "conflict", "con una version vieja responde conflict", stale.error ?? JSON.stringify(stale.data));
  const badLinks = await rpcAs(owner, "product_links_save", { p_product_id: prod.id, p_links: { v: 1, items: [{ key: "lk_zztst2", name: "x", kind: "landing", url: "http://inseguro.test", active: true }] }, p_rev: 1 });
  check(!badLinks.error && badLinks.data?.status === "invalid", "un link que no es https se rechaza con su problema", badLinks.error ?? JSON.stringify(badLinks.data));
  const byMember = await rpcAs(member, "product_links_save", { p_product_id: prod.id, p_links: links, p_rev: 1 });
  check(!!byMember.error && /AF010/.test(byMember.error), "un Member no guarda links (product_links.manage)", byMember.error);
  const direct = asUser(owner.id, `WITH u AS (UPDATE public.products SET links = '{"v":1,"items":[]}'::jsonb WHERE id = ${lit(prod.id)} RETURNING 1) SELECT count(*) n FROM u`);
  check(!direct.ok && /AF010|tarjeta Links/.test(direct.error), "los links no se escriben directo con la sesion (AF010)", direct.error);

  console.log("\naf · Los codigos (F71, AF001, AF004)");
  const mine = await rpcAs(member, "affiliate_ensure_code", { p_workspace_id: ws.id, p_kind: "member", p_id: member.id });
  check(!mine.error && /^[a-z0-9]{4,24}$/.test(mine.data ?? ""), "un Member crea su propio codigo (affiliates.use)", mine.error ?? JSON.stringify(mine.data));
  const again = await rpcAs(member, "affiliate_ensure_code", { p_workspace_id: ws.id, p_kind: "member", p_id: member.id });
  check(again.data === mine.data, "pedirlo de nuevo devuelve el mismo codigo");
  const other = await rpcAs(member, "affiliate_ensure_code", { p_workspace_id: ws.id, p_kind: "member", p_id: owner.id });
  check(!!other.error && /AF010/.test(other.error), "un Member no crea el codigo de otra persona", other.error);
  const ext = await newContact("afiliado externo");
  const extByMember = await rpcAs(member, "affiliate_ensure_code", { p_workspace_id: ws.id, p_kind: "contact", p_id: ext.id });
  check(!!extByMember.error && /AF010/.test(extByMember.error), "un Member no da de alta afiliados externos (affiliates.external)", extByMember.error);
  const extCode = await rpcAs(owner, "affiliate_ensure_code", { p_workspace_id: ws.id, p_kind: "contact", p_id: ext.id });
  check(!extCode.error && /^[a-z0-9]{4,24}$/.test(extCode.data ?? ""), "el Owner da de alta un afiliado externo", extCode.error);
  const plain = await newContact("sin codigo");
  const clash = sqlErr(`UPDATE public.contacts SET affiliate_code = ${lit(mine.data)} WHERE id = ${lit(plain.id)}`);
  check(/AF001/.test(clash ?? ""), "un contacto no puede usar el codigo de alguien del equipo (AF001)", clash);
  const change = sqlErr(`UPDATE public.contacts SET affiliate_code = 'zzotro99' WHERE id = ${lit(ext.id)}`);
  check(/AF004/.test(change ?? ""), "un codigo no cambia nunca (AF004)", change);

  console.log("\naf · Entrar por el link asigna el afiliado (F72)");
  const lead = await newContact("lead por link");
  const touch = (contactId, url, at = new Date().toISOString()) =>
    svc.from("contact_touches").insert({ workspace_id: ws.id, contact_id: contactId, occurred_at: at, source: "web", origin: "form", dedupe_key: `zz-test-${randomUUID()}`, entry_url: url }).select("id").single();
  const t1 = await touch(lead.id, `https://ejemplo.test/landing?ref=${mine.data}&utm_source=afiliado`);
  check(!t1.error, "el toque con ?ref= se guarda", t1.error?.message);
  const after1 = sql(`SELECT affiliate_user_id, affiliate_kind, affiliate_source, affiliate_expires_at IS NOT NULL e FROM public.contacts WHERE id = ${lit(lead.id)}`)[0];
  check(after1?.affiliate_user_id === member.id && after1?.affiliate_kind === "originated" && after1?.affiliate_source === "link" && after1?.e === true, "el contacto nuevo queda con el afiliado, «lo trajo» y vencimiento", JSON.stringify(after1));
  check(sql(`SELECT count(*)::int n FROM public.audit_log WHERE entity_id = ${lit(lead.id)} AND action = 'affiliate.assigned'`)[0]?.n === 1, "queda affiliate.assigned en el historial");
  await touch(lead.id, `https://ejemplo.test/landing?ref=${extCode.data}`);
  check(sql(`SELECT affiliate_user_id FROM public.contacts WHERE id = ${lit(lead.id)}`)[0]?.affiliate_user_id === member.id, "con la regla por defecto (keep) otro afiliado no lo pisa");
  const self = await touch(ext.id, `https://ejemplo.test/?ref=${extCode.data}`);
  check(!self.error && sql(`SELECT affiliate_contact_id FROM public.contacts WHERE id = ${lit(ext.id)}`)[0]?.affiliate_contact_id === null, "el codigo propio no se asigna a si mismo");
  const noRef = await newContact("sin ref");
  await touch(noRef.id, "https://ejemplo.test/landing?utm_source=ig");
  check(sql(`SELECT affiliate_user_id, affiliate_contact_id FROM public.contacts WHERE id = ${lit(noRef.id)}`)[0]?.affiliate_user_id === null, "un toque sin ref no asigna nada");
  const guardC = asUser(owner.id, `WITH u AS (UPDATE public.contacts SET affiliate_user_id = NULL WHERE id = ${lit(lead.id)} RETURNING 1) SELECT count(*) n FROM u`);
  check(!guardC.ok && /AF010|desde la ficha/.test(guardC.error), "el afiliado de un contacto no se cambia directo (AF010)", guardC.error);

  console.log("\naf · Un fallo del gancho no tumba el toque");
  const forced = sqlErr(`DO $$ DECLARE n int; a int; BEGIN
    ALTER FUNCTION public.affiliate_assign_plan(jsonb) RENAME TO zz_affiliate_assign_plan_off;
    INSERT INTO public.contact_touches (workspace_id, contact_id, occurred_at, source, origin, dedupe_key, entry_url)
      VALUES (${lit(ws.id)}, ${lit(noRef.id)}, now(), 'web', 'form', 'zz-test-forzado', ${lit(`https://ejemplo.test/?ref=${mine.data}`)});
    SELECT count(*) INTO n FROM public.contact_touches WHERE dedupe_key = 'zz-test-forzado';
    SELECT count(*) INTO a FROM public.audit_log WHERE entity_id = ${lit(noRef.id)} AND action = 'affiliate.hook_failed';
    RAISE EXCEPTION 'RESULTADO: % %', n, a;
  END $$`);
  check(/RESULTADO: 1 1/.test(forced ?? ""), "el toque se guarda igual y queda affiliate.hook_failed (y todo se deshace)", forced?.slice(0, 300));
  check(sql(`SELECT count(*)::int n FROM pg_proc WHERE proname = 'affiliate_assign_plan'`)[0]?.n === 1, "la funcion quedo como estaba");

  console.log("\naf · Asignar a mano y la venta (F74, F104)");
  const noReason = await rpcAs(owner, "affiliate_set_contact", { p_contact_id: noRef.id, p_affiliate: { type: "contact", id: ext.id }, p_kind: "influenced", p_expires_at: null, p_reason: " " });
  check(!!noReason.error && /AF011/.test(noReason.error), "asignar a mano pide motivo (AF011)", noReason.error);
  const manual = await rpcAs(owner, "affiliate_set_contact", { p_contact_id: noRef.id, p_affiliate: { type: "contact", id: ext.id }, p_kind: "influenced", p_expires_at: null, p_reason: "zz-test lo trajo en persona" });
  check(!manual.error && sql(`SELECT affiliate_contact_id, affiliate_source FROM public.contacts WHERE id = ${lit(noRef.id)}`)[0]?.affiliate_source === "manual", "el Owner asigna un afiliado externo con motivo", manual.error);
  const memberAssign = await rpcAs(member, "affiliate_set_contact", { p_contact_id: noRef.id, p_affiliate: null, p_kind: null, p_expires_at: null, p_reason: "x" });
  check(!!memberAssign.error && /AF010/.test(memberAssign.error), "un Member no asigna a mano (affiliates.assign)", memberAssign.error);
  const { data: saleRes, error: saleErr } = await svc.rpc("create_sale", {
    p_payload: { workspace_id: ws.id, contact_id: ext.id, product_variant_id: variant.id,
      product_snapshot: { product_id: prod.id, product_name: "zz-test Producto con links", product_type: "programa", variant_id: variant.id, variant_name: "v", price: 1000, currency: "USD", duration_type: null, duration_value: null, billing_type: "one_time", billing_interval: null, event_date: null },
      base_amount: 1000, discount_amount: 0, financing_type: "full", sale_date: hoy, setter_id: null, vendedor_id: null, attribution: { mode: "none" }, payments: [{ type: "full", amount: 1000, status: "scheduled", due_date: "2031-01-15" }] },
    p_actor_id: owner.id,
  });
  if (saleErr) throw new Error(`create_sale: ${saleErr.message}`);
  const selfSale = sqlErr(`SELECT public.affiliate_set_sale(${lit(saleRes.sale_id)}, ${jlit({ type: "contact", id: ext.id })}, 'influenced', NULL)`);
  check(/AF012/.test(selfSale ?? ""), "el afiliado no puede ser el que compra (AF012)", selfSale);
  const setSale = sqlErr(`SELECT public.affiliate_set_sale(${lit(saleRes.sale_id)}, ${jlit({ type: "user", id: member.id })}, 'influenced', NULL)`);
  check(setSale === null && sql(`SELECT affiliate_user_id FROM public.sales WHERE id = ${lit(saleRes.sale_id)}`)[0]?.affiliate_user_id === member.id, "el servidor pone el afiliado de una venta nueva sin motivo", setSale);
  const guardS = asUser(owner.id, `WITH u AS (UPDATE public.sales SET affiliate_user_id = NULL WHERE id = ${lit(saleRes.sale_id)} RETURNING 1) SELECT count(*) n FROM u`);
  // La sesion no escribe `sales` (no hay politica de UPDATE: 0 filas); si algun dia la hubiera, la guarda dice AF010.
  const stillSet = sql(`SELECT affiliate_user_id FROM public.sales WHERE id = ${lit(saleRes.sale_id)}`)[0]?.affiliate_user_id === member.id;
  check(((!guardS.ok && /AF010|permiso/.test(guardS.error)) || (guardS.ok && Number(guardS.row?.n) === 0)) && stillSet, "el afiliado de la venta no se cambia directo con la sesion", guardS.error ?? JSON.stringify(guardS.row));
  const guardS2 = sqlErr(`DO $$ BEGIN PERFORM set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: owner.id, role: "authenticated" }))}, true); SET LOCAL ROLE authenticated; PERFORM public.affiliate_internal(); RAISE EXCEPTION 'RESULTADO: %', public.affiliate_internal(); END $$`);
  check(/RESULTADO: f/.test(guardS2 ?? ""), "para una sesion, la marca interna esta apagada (la guarda aplica)", guardS2?.slice(0, 200));

  console.log("\naf · Las reglas (F72)");
  const rules = await rpcAs(owner, "affiliate_settings_save", { p_workspace_id: ws.id, p_settings: { v: 1, influenced: { days: 30 } }, p_rev: 0 });
  check(!rules.error && rules.data?.status === "ok", "el Owner guarda las reglas", rules.error ?? JSON.stringify(rules.data));
  const badRules = await rpcAs(owner, "affiliate_settings_save", { p_workspace_id: ws.id, p_settings: { influenced: { days: 0 } }, p_rev: 1 });
  check(!badRules.error && badRules.data?.status === "invalid", "unas reglas invalidas se rechazan con su problema", badRules.error ?? JSON.stringify(badRules.data));
  const memberRules = await rpcAs(member, "affiliate_settings_save", { p_workspace_id: ws.id, p_settings: {}, p_rev: 1 });
  check(!!memberRules.error && /AF010/.test(memberRules.error), "un Member no cambia las reglas (affiliates.settings)", memberRules.error);

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
