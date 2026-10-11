#!/usr/bin/env node
/**
 * Verificacion del modulo Ventas (Etapa 5, Fase 1).
 *
 * Corre contra la base real con usuarios de verdad (Owner y Member de sistema).
 * Prueba lo que vitest NO puede probar: que la BASE haga cumplir las reglas.
 *
 *   --block 1  catalogo (00159, 00160): RLS, versiones, publicar, el puente
 *   --block 2  asignacion (00161)
 *   --block 3  ventas y pagos (00162, 00163, 00164)
 *   --block 4  comprobantes, mora, historial, triggers (00165 a 00168)
 *
 * `--block N` corre las secciones hasta la N (sin el flag, todas).
 *
 * Crea y borra todo lo suyo (prefijo zz-test-). Una limpieza que falla es una
 * prueba que falla. No se corre a la vez que otro verify-*: comparten prefijo.
 *
 *   node scripts/verify-sales.mjs [--block N]
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const require = createRequire(import.meta.url);
const blockArg = process.argv.indexOf("--block");
const MAX_BLOCK = blockArg >= 0 ? Number(process.argv[blockArg + 1]) || 4 : 4;

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

/** Consultas que la API no expone (esquema `private`, `cron`, `pg_constraint`): con la CLI ya vinculada. */
export function sql(query) {
  const out = execFileSync("supabase", ["db", "query", "--linked", query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).rows ?? [];
}

/**
 * Corre un bloque DO que termina con `RAISE EXCEPTION 'RESULTADO: ...'`: la transaccion se
 * deshace sola (no queda nada) y el mensaje trae lo que se quiere leer.
 */
export function sqlProbe(query) {
  try {
    execFileSync("supabase", ["db", "query", "--linked", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return "SIN RESULTADO (el bloque no levanto la excepcion final)";
  } catch (e) {
    const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    const m = text.match(/RESULTADO: ([^"\\]*)/);
    return m ? m[1].trim() : text.slice(0, 300);
  }
}

const ctx = {}; // lo que comparten las secciones: ws, owner, member, otros

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces")
    .insert({ name: "zz-test-sales", slug: `zz-test-sales-${Date.now()}`, timezone: "America/Costa_Rica" })
    .select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);
  const { data: ws2 } = await svc.from("workspaces")
    .insert({ name: "zz-test-sales-otro", slug: `zz-test-sales-otro-${Date.now()}` }).select("id").single();

  const owner = await makeUser("sales-owner");
  const member = await makeUser("sales-member");
  const outsider = await makeUser("sales-outsider");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
    { workspace_id: ws2.id, user_id: outsider.id, role: "owner" },
  ]);
  Object.assign(ctx, { ws, ws2, owner, member, outsider });

  // ─────────────────────────────────────────────────────────────────────────
  // Bloque 1 · Catalogo
  // ─────────────────────────────────────────────────────────────────────────
  if (MAX_BLOCK >= 1) {
    console.log("\n— Catalogo: RLS —");
    const { data: prod, error: pErr } = await owner.client.from("products")
      .insert({ workspace_id: ws.id, name: "zz-test Programa", product_type: "programa" }).select("id").single();
    check(!pErr && !!prod, "el Owner crea un producto con su sesion", pErr?.message);

    const { error: memberIns } = await member.client.from("products")
      .insert({ workspace_id: ws.id, name: "zz-test lo intenta el member" });
    check(!!memberIns, "un Member NO puede insertar un producto (RLS)", memberIns ? undefined : "se inserto");

    const memberSees = await member.client.from("products").select("id").eq("workspace_id", ws.id);
    check((memberSees.data ?? []).some((r) => r.id === prod.id), "un Member SI ve los productos de su workspace (los necesita para cargar una venta)");

    const outsiderSees = await outsider.client.from("products").select("id").eq("workspace_id", ws.id);
    check((outsiderSees.data ?? []).length === 0, "otro workspace no ve el catalogo");

    const { data: variant, error: vErr } = await owner.client.from("product_variants")
      .insert({ workspace_id: ws.id, product_id: prod.id, name: "Estandar" }).select("id").single();
    check(!vErr && !!variant, "el Owner crea una variante", vErr?.message);
    const { data: v1, error: v1Err } = await owner.client.from("product_versions")
      .insert({ workspace_id: ws.id, product_variant_id: variant.id, price: 1497, version_number: 1 }).select("id, version_number").single();
    check(!v1Err && !!v1, "el Owner crea la version 1 (borrador)", v1Err?.message);

    const memberVariant = await member.client.from("product_variants").insert({ workspace_id: ws.id, product_id: prod.id, name: "zz-test" });
    check(!!memberVariant.error, "un Member NO crea variantes");
    const memberVersion = await member.client.from("product_versions").insert({ workspace_id: ws.id, product_variant_id: variant.id, price: 1 });
    check(!!memberVersion.error, "un Member NO crea versiones");

    // DELETE: nadie puede con su sesion (no hay policy).
    for (const [table, id] of [["products", prod.id], ["product_variants", variant.id]]) {
      await owner.client.from(table).delete().eq("id", id);
      const { data: still } = await svc.from(table).select("id").eq("id", id).maybeSingle();
      check(!!still, `el Owner no puede borrar de ${table} (sin policy de DELETE)`);
      await member.client.from(table).delete().eq("id", id);
      const { data: still2 } = await svc.from(table).select("id").eq("id", id).maybeSingle();
      check(!!still2, `el Member tampoco borra de ${table}`);
    }

    console.log("\n— Catalogo: reglas de la base —");
    const { error: dupName } = await svc.from("products").insert({ workspace_id: ws.id, name: "  ZZ-TEST programa " });
    check(!!dupName, "el nombre es unico entre los activos, sin importar mayusculas ni espacios", dupName ? undefined : "se inserto el duplicado");

    const { error: incoherent } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test incoherente", status: "inactive" });
    check(!!incoherent, "status 'inactive' con archived_at null falla por el CHECK de coherencia");
    const { error: incoherent2 } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test incoherente 2", status: "active", archived_at: new Date().toISOString() });
    check(!!incoherent2, "status 'active' con archived_at tambien falla");
    const { error: archivedOk } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test discontinuado", status: "discontinued", archived_at: new Date().toISOString() });
    check(!archivedOk, "un discontinuado archivado es valido", archivedOk?.message);

    const { error: badType } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test tipo", product_type: "inventado" });
    check(!!badType, "un tipo de producto inventado se rechaza");

    const bad = async (extra, msg) => {
      const { error } = await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prod.id, name: "zz-test", ...extra });
      check(!!error, msg);
    };
    await bad({ billing_type: "recurring" }, "recurring sin intervalo se rechaza");
    await bad({ billing_type: "one_time", billing_interval: "monthly" }, "one_time con intervalo se rechaza");
    await bad({ duration_type: "lifetime", duration_value: 3 }, "lifetime con valor se rechaza");
    await bad({ duration_type: "months", duration_value: null }, "months sin valor se rechaza");
    await bad({ guarantee_duration_type: "days" }, "garantia a medias se rechaza");
    const { error: recurringOk } = await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prod.id, name: "zz-test mensual", duration_type: "months", duration_value: 6, billing_type: "recurring", billing_interval: "monthly", guarantee_duration_type: "days", guarantee_duration_value: 30 });
    check(!recurringOk, "una variante mensual de 6 meses con garantia es valida", recurringOk?.message);

    console.log("\n— Versiones: publicar —");
    const { error: zeroPrice } = await svc.from("product_versions").insert({ workspace_id: ws.id, product_variant_id: variant.id, price: 0 });
    check(!!zeroPrice, "precio 0 sin notas del cambio se rechaza");
    const { error: zeroNotes } = await svc.from("product_versions").insert({ workspace_id: ws.id, product_variant_id: variant.id, price: 0, change_notes: "cortesia" });
    check(!zeroNotes, "precio 0 con notas es valido", zeroNotes?.message);
    await svc.from("product_versions").delete().eq("product_variant_id", variant.id).eq("price", 0);

    const { data: autoNum } = await svc.from("product_versions").insert({ workspace_id: ws.id, product_variant_id: variant.id, price: 1600 }).select("id, version_number").single();
    check(autoNum?.version_number === 2, "el numero de version es autoincremental por variante", `vino ${autoNum?.version_number}`);

    const memberPublish = await member.client.rpc("publish_product_version", { p_version_id: v1.id, p_actor_id: member.id });
    check(!!memberPublish.error, "un usuario autenticado NO puede llamar publish_product_version (solo service_role)");

    const pub1 = await svc.rpc("publish_product_version", { p_version_id: v1.id, p_actor_id: owner.id });
    check(!pub1.error, "se publica la version 1", pub1.error?.message);
    const pub2 = await svc.rpc("publish_product_version", { p_version_id: autoNum.id, p_actor_id: owner.id });
    check(!pub2.error && pub2.data?.deprecated_version_id === v1.id, "al publicar la 2, la 1 queda deprecated en la misma transaccion", pub2.error?.message);
    const { data: after } = await svc.from("product_versions").select("id, status").eq("product_variant_id", variant.id);
    check((after ?? []).filter((r) => r.status === "active").length === 1 && after.find((r) => r.id === v1.id)?.status === "deprecated",
      "queda exactamente una activa y la anterior deprecated");

    const again = await svc.rpc("publish_product_version", { p_version_id: v1.id, p_actor_id: owner.id });
    check(!!again.error, "publicar una version deprecated se rechaza");

    const { error: secondActive } = await svc.from("product_versions").insert({ workspace_id: ws.id, product_variant_id: variant.id, price: 5, status: "active" });
    check(!!secondActive, "una segunda version activa de la misma variante falla por el indice unico");

    const { error: editPublished } = await svc.from("product_versions").update({ price: 1 }).eq("id", autoNum.id);
    check(!!editPublished, "una version publicada no se edita (ni con el service role)");
    const { error: delPublished } = await svc.from("product_versions").delete().eq("id", autoNum.id);
    check(!!delPublished, "una version publicada no se borra");
    const { data: draft } = await svc.from("product_versions").insert({ workspace_id: ws.id, product_variant_id: variant.id, price: 2000 }).select("id").single();
    const { error: editDraft } = await svc.from("product_versions").update({ price: 2100 }).eq("id", draft.id);
    const { error: delDraft } = await svc.from("product_versions").delete().eq("id", draft.id);
    check(!editDraft && !delDraft, "un borrador se edita y se borra libremente", (editDraft || delDraft)?.message);

    console.log("\n— Metodos de pago habilitados —");
    const { data: wsRow } = await svc.from("workspaces").select("enabled_payment_methods").eq("id", ws.id).single();
    check((wsRow?.enabled_payment_methods ?? []).length === 5, "un workspace nuevo trae los 5 metodos habilitados");
    const { error: badMethod } = await svc.from("workspaces").update({ enabled_payment_methods: ["paypal"] }).eq("id", ws.id);
    check(!!badMethod, "un metodo que no existe se rechaza");
    const { error: goodMethod } = await svc.from("workspaces").update({ enabled_payment_methods: ["wise", "binance"] }).eq("id", ws.id);
    check(!goodMethod, "y un subconjunto valido se acepta", goodMethod?.message);
    console.log("\n— 00160: Productos absorbe content_offers —");
    {
      const [{ n: huerfanas }] = sql("select count(*)::int n from public.content_offers o left join public.products p on p.id = o.id where p.id is null");
      check(huerfanas === 0, "toda oferta de content_offers tiene su producto con el MISMO id");
      const [{ n: divergentes }] = sql("select count(*)::int n from public.content_offers o join public.products p on p.id = o.id where p.status <> o.status or p.archived_at is distinct from o.archived_at or p.name <> o.name");
      check(divergentes === 0, "y con el mismo nombre, estado y archivado");
      const fks = sql("select conname, pg_get_constraintdef(oid) d from pg_constraint where conname in ('content_ideas_offer_id_fkey','content_posts_offer_id_fkey')");
      check(fks.length === 2 && fks.every((f) => /REFERENCES products\(id\) ON DELETE SET NULL/.test(f.d)), "las FK de ideas y piezas apuntan a products (ON DELETE SET NULL)");

      // El puente: lo que el codigo viejo escribe en content_offers aparece en products.
      const { data: viejo, error: viejoErr } = await svc.from("content_offers")
        .insert({ workspace_id: ws.id, name: "zz-test puente", price_usd: 800 }).select("id").single();
      check(!viejoErr && !!viejo, "el codigo viejo todavia puede crear un producto en content_offers", viejoErr?.message);
      const { data: puente } = await svc.from("products").select("id, name, status").eq("id", viejo.id).maybeSingle();
      check(puente?.name === "zz-test puente" && puente?.status === "active", "el puente lo copia a products con el mismo id");
      const { data: vars } = await svc.from("product_variants").select("id, name").eq("product_id", viejo.id);
      check(vars?.length === 1 && vars[0].name === "Estándar", "y le crea su variante Estandar");
      const { data: vers } = await svc.from("product_versions").select("price, status, version_number").eq("product_variant_id", vars[0].id);
      check(vers?.length === 1 && Number(vers[0].price) === 800 && vers[0].status === "active", "y su version 1 activa con el precio");

      // Una pieza puede apuntar a ese producto (la FK ahora es a products).
      const { data: idea, error: ideaErr } = await svc.from("content_ideas")
        .insert({ workspace_id: ws.id, title: "zz-test idea con producto", offer_id: viejo.id }).select("id, offer_id").single();
      check(!ideaErr && idea?.offer_id === viejo.id, "una idea de Contenido se clasifica con ese producto sin error de FK", ideaErr?.message);
      const { error: fkBad } = await svc.from("content_ideas").update({ offer_id: randomUUID() }).eq("id", idea.id);
      check(!!fkBad, "y un producto que no existe se rechaza");

      // Cambiar el precio en la tabla vieja: version nueva, la anterior queda deprecated.
      await svc.from("content_offers").update({ price_usd: 900 }).eq("id", viejo.id);
      const { data: vers2 } = await svc.from("product_versions").select("price, status").eq("product_variant_id", vars[0].id);
      check(vers2?.length === 2 && vers2.filter((v) => v.status === "active").length === 1 && Number(vers2.find((v) => v.status === "active").price) === 900,
        "cambiar el precio en la tabla vieja publica una version nueva y deprecia la anterior");

      // Cambiar el estado: el puente lo copia junto con archived_at.
      await svc.from("content_offers").update({ status: "discontinued", archived_at: new Date().toISOString() }).eq("id", viejo.id);
      const { data: disc } = await svc.from("products").select("status, archived_at").eq("id", viejo.id).single();
      check(disc?.status === "discontinued" && !!disc?.archived_at, "y el cambio de estado");

      // Aplicarla dos veces no duplica: las 3 ofertas reales tienen exactamente 1 variante y 1 version.
      const [{ n: dup }] = sql("select count(*)::int n from (select v.product_id from public.product_variants v join public.content_offers o on o.id = v.product_id where o.workspace_id <> '" + ws.id + "' group by v.product_id having count(*) > 1) x");
      check(dup === 0, "las ofertas migradas no tienen variantes duplicadas");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bloque 2 · Asignacion (00161)
  // ─────────────────────────────────────────────────────────────────────────
  if (MAX_BLOCK >= 2) {
    console.log("\n— 00161: reglas de asignacion —");
    const rulesOf = async (client, wsId) => (await client.from("assignment_rules").select("id, kind, mode, entity_type").eq("workspace_id", wsId)).data ?? [];

    const reglas = await rulesOf(svc, ws.id);
    check(reglas.length === 3 && ["setter", "vendedor", "referral"].every((k) => reglas.some((r) => r.kind === k)), "un workspace nuevo trae 3 reglas (setter, vendedor, referral)");
    check(reglas.every((r) => r.mode === "manual" && r.entity_type === "contact"), "las 3 arrancan en modo manual, para contactos");
    const [{ n: sinReglas }] = sql("select count(*)::int n from public.workspaces w where (select count(*) from public.assignment_rules r where r.workspace_id = w.id) <> 3");
    check(sinReglas === 0, "todos los workspaces que ya existian tienen exactamente 3 reglas (backfill)");

    const { error: kindFuente } = await svc.from("assignment_rules").insert({ workspace_id: ws.id, kind: "source" });
    check(!!kindFuente, "un kind 'source' se rechaza (el catalogo de fuentes quedo para una fase futura)");
    const { error: dupKind } = await svc.from("assignment_rules").insert({ workspace_id: ws.id, kind: "setter" });
    check(!!dupKind, "no puede haber dos reglas del mismo kind en un workspace");
    const { error: refRr } = await svc.from("assignment_rules").update({ mode: "round_robin" }).eq("workspace_id", ws.id).eq("kind", "referral");
    check(!!refRr, "el referido no admite reparto por turnos (CHECK)");
    const { error: noArray } = await svc.from("assignment_rules").update({ condition_rules: { no: "array" } }).eq("workspace_id", ws.id).eq("kind", "setter");
    check(!!noArray, "condition_rules tiene que ser una lista");

    const memberSees = await rulesOf(member.client, ws.id);
    check(memberSees.length === 3, "un Member LEE las reglas de su workspace");
    check((await rulesOf(outsider.client, ws.id)).length === 0, "otro workspace no las ve");
    const { data: memberUpd } = await member.client.from("assignment_rules").update({ mode: "round_robin", enabled_member_ids: [member.id] }).eq("workspace_id", ws.id).eq("kind", "setter").select("id");
    check((memberUpd ?? []).length === 0, "un Member NO puede escribir una regla (RLS)");
    const { error: memberIns } = await member.client.from("assignment_rules").insert({ workspace_id: ws.id, kind: "setter" });
    check(!!memberIns, "ni insertar");
    const { data: ownerUpd, error: ownerErr } = await owner.client.from("assignment_rules").update({ mode: "round_robin", enabled_member_ids: [owner.id] }).eq("workspace_id", ws.id).eq("kind", "setter").select("id");
    check(!ownerErr && (ownerUpd ?? []).length === 1, "el Owner si puede", ownerErr?.message);
    await owner.client.from("assignment_rules").delete().eq("workspace_id", ws.id).eq("kind", "setter");
    check((await rulesOf(svc, ws.id)).length === 3, "nadie borra una regla (sin policy de DELETE)");

    console.log("\n— 00161: columnas nuevas —");
    const [{ n: cols }] = sql("select count(*)::int n from information_schema.columns where table_schema = 'public' and ((table_name = 'contacts' and column_name in ('referred_by_user_id','referred_by_contact_id','assignment_locked_at','payment_health')) or (table_name = 'workspaces' and column_name in ('max_discount_percent','overdue_grace_days','sales_auto_create_flows')))");
    check(cols === 7, "contacts suma 4 columnas y workspaces 3");
    const { error: gracia } = await svc.from("workspaces").update({ overdue_grace_days: 31 }).eq("id", ws.id);
    check(!!gracia, "la gracia de mora no pasa de 30 dias");
    const { error: tope } = await svc.from("workspaces").update({ max_discount_percent: 101 }).eq("id", ws.id);
    check(!!tope, "el tope de descuento no pasa de 100 %");
    const { error: topeOk } = await svc.from("workspaces").update({ max_discount_percent: 25.5, overdue_grace_days: 3 }).eq("id", ws.id);
    check(!topeOk, "y valores validos se aceptan", topeOk?.message);

    console.log("\n— 00161: el trigger de contacts encola la evaluacion —");
    const jobsOf = async (contactId) => (await svc.from("scheduled_jobs").select("id, status, dedupe_key, payload").eq("type", "sales_contact_eval").eq("payload->>contact_id", contactId)).data ?? [];

    // Con todo en manual: ningun job.
    await svc.from("assignment_rules").update({ mode: "manual", enabled_member_ids: [] }).eq("workspace_id", ws.id);
    const { data: c0 } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test eval manual" }).select("id").single();
    check((await jobsOf(c0.id)).length === 0, "con todas las reglas en manual, crear un contacto NO encola nada");

    // Con una regla que no es manual: un job por contacto y atribucion.
    await svc.from("assignment_rules").update({ mode: "round_robin", enabled_member_ids: [owner.id] }).eq("workspace_id", ws.id).eq("kind", "setter");
    const { data: c1 } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test eval auto" }).select("id").single();
    const j1 = await jobsOf(c1.id);
    check(j1.length === 1 && /^sales_eval:/.test(j1[0].dedupe_key), "con una regla no manual, crear un contacto encola UN job sales_contact_eval");
    check(j1[0]?.payload?.workspace_id === ws.id && j1[0]?.payload?.contact_id === c1.id, "con el contacto y el workspace en el payload");

    // Cambiar la atribucion: otro job (otra clave); el mismo valor dos veces mientras espera: uno solo.
    const attribution = { version: 2, last_touch: { source: "instagram", medium: "paid_social", campaign: "zz-test" } };
    await svc.from("contacts").update({ attribution }).eq("id", c1.id);
    const j2 = await jobsOf(c1.id);
    check(j2.length >= 2 && new Set(j2.map((j) => j.dedupe_key)).size === j2.length, "cambiar la atribucion encola otro job, con otra clave");
    const antes = (await jobsOf(c1.id)).length;
    await svc.from("contacts").update({ attribution }).eq("id", c1.id);
    const despues = (await jobsOf(c1.id)).length;
    check(despues === antes, "el mismo cambio dos veces no duplica el job (la clave incluye el md5 de la atribucion)");
    await svc.from("scheduled_jobs").delete().eq("type", "sales_contact_eval").in("payload->>contact_id", [c0.id, c1.id]);

    // El trigger nunca tumba el alta: se fuerza un fallo del INSERT en scheduled_jobs (adentro de una
    // transaccion que se deshace sola, asi no queda nada y el candado dura milisegundos).
    const forzado = sqlProbe(`
      DO $$
      DECLARE w uuid; c uuid; existe boolean;
      BEGIN
        INSERT INTO public.workspaces (name, slug) VALUES ('zz-test-trigger-falla', 'zz-test-trigger-falla-' || gen_random_uuid()) RETURNING id INTO w;
        UPDATE public.assignment_rules SET mode = 'round_robin', enabled_member_ids = ARRAY[gen_random_uuid()] WHERE workspace_id = w AND kind = 'setter';
        ALTER TABLE public.scheduled_jobs ADD CONSTRAINT zz_test_fuerza_fallo CHECK (type <> 'sales_contact_eval') NOT VALID;
        INSERT INTO public.contacts (workspace_id, display_name) VALUES (w, 'zz-test el alta sobrevive') RETURNING id INTO c;
        SELECT EXISTS (SELECT 1 FROM public.contacts WHERE id = c) INTO existe;
        RAISE EXCEPTION 'RESULTADO: %', CASE WHEN existe THEN 'contacto creado aunque el trigger fallo' ELSE 'el contacto NO se creo' END;
      END $$;`);
    check(forzado === "contacto creado aunque el trigger fallo", "si el INSERT del job falla, el contacto se crea igual (el trigger atrapa toda excepcion)", forzado);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bloque 3 · Ventas y pagos (00162)
  // ─────────────────────────────────────────────────────────────────────────
  if (MAX_BLOCK >= 3) {
    console.log("\n— 00162: la paridad del estado derivado (los mismos casos que Vitest) —");
    const cases = require("../lib/sales/sale-status.cases.json");
    for (const c of cases) {
      const { data, error } = await svc.rpc("derive_sale_status", { p_current_status: c.current_status ?? null, p_financing_type: c.financing_type, p_final_amount: c.final_amount, p_payments: c.payments });
      check(!error && data === c.expected, `derive_sale_status: ${c.name}`, error?.message ?? `dio ${data}, esperaba ${c.expected}`);
    }

    // Catalogo de prueba: un producto con una version activa.
    const { data: prod3 } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test Producto de ventas", product_type: "programa" }).select("id").single();
    const { data: variant3 } = await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prod3.id, name: "Estandar" }).select("id").single();
    const { data: ver3 } = await svc.from("product_versions").insert({ workspace_id: ws.id, product_variant_id: variant3.id, price: 1297 }).select("id").single();
    await svc.rpc("publish_product_version", { p_version_id: ver3.id, p_actor_id: owner.id });

    const setterMember = member; // el Member de sistema es el setter de la venta
    const contactName = (t) => `zz-test ${t}`;
    const newContact = async (t, extra = {}) => (await svc.from("contacts").insert({ workspace_id: ws.id, display_name: contactName(t), ...extra }).select("id").single()).data;
    const contactA = await newContact("lead A");
    const contactB = await newContact("lead B");

    const snapshot = (price) => ({ product_id: prod3.id, product_name: "zz-test Producto de ventas", product_type: "programa", variant_id: variant3.id, variant_name: "Estandar", version_id: ver3.id, version_number: 1, price, currency: "USD", duration_type: "lifetime", duration_value: null, billing_type: "one_time", billing_interval: null, guarantee_duration_type: null, guarantee_duration_value: null });
    const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const optionSnapshot = { method_key: "wise", method_name: "Wise", provider_fee_percent: 0, provider_fee_fixed: 0 };
    const paidReservation = { type: "reservation", amount: 297, status: "paid", due_date: ayer, paid_at: `${ayer}T15:00:00Z`, paid_on: ayer, payment_method: "wise", payment_option_snapshot: optionSnapshot, provider_fee_amount: 0 };
    const installments = [1, 2, 3, 4].map((n) => ({ type: "installment", amount: 250, status: "scheduled", due_date: `2031-0${n}-15` }));
    const payload = (over = {}) => ({
      workspace_id: ws.id, contact_id: contactA.id, product_version_id: ver3.id, product_snapshot: snapshot(1297),
      base_amount: 1297, discount_amount: 0, financing_type: "reservation_installments", sale_date: ayer,
      setter_id: setterMember.id, vendedor_id: null, attribution: { mode: "last_touch" }, payments: [paidReservation, ...installments], ...over,
    });
    const createSale = (over, contact) => svc.rpc("create_sale", { p_payload: payload({ ...(contact ? { contact_id: contact } : {}), ...over }), p_actor_id: owner.id });
    const eventsOf = async (contactId, type) => (await svc.from("automation_events").select("event_type, payload").eq("contact_id", contactId).eq("event_type", type)).data ?? [];

    console.log("\n— 00162: las restricciones de la base —");
    const base = { workspace_id: ws.id, contact_id: contactB.id, product_version_id: ver3.id, product_snapshot: snapshot(1297), base_amount: 100, final_amount: 100, status: "pending_payment", financing_type: "full", sale_date: ayer };
    check(!!(await svc.from("sales").insert({ ...base, currency: "EUR" })).error, "una venta en EUR se rechaza (solo USD)");
    check(!!(await svc.from("sales").insert({ ...base, attribution_type: "none", attribution: { source: "web" } })).error, "attribution_type 'none' con una atribucion cargada se rechaza");
    check(!!(await svc.from("sales").insert({ ...base, attribution_type: "manual" })).error, "y un tipo 'manual' sin atribucion tambien");
    check(!!(await svc.from("sales").insert({ ...base, final_amount: 90 })).error, "final_amount tiene que ser base - descuento");
    check(!!(await svc.from("sales").insert({ ...base, status: "pagada" })).error, "un estado que no es de los 9 se rechaza");
    check(!!(await svc.from("sales").insert({ ...base, financing_type: "subscription" })).error, "una suscripcion sin intervalo se rechaza");

    console.log("\n— 00162: crear una venta es una sola transaccion —");
    // Un toque de Instagram pago, con extras en raw.
    const { data: touch1 } = await svc.from("contact_touches").insert({
      workspace_id: ws.id, contact_id: contactA.id, occurred_at: "2026-10-07T15:00:00Z", source: "instagram", medium: "paid_social", campaign: "octubre",
      content_label: "Reel de la mentoria", ad_id: "123", fbclid: "fb-1", origin: "dm", dedupe_key: `zz-${randomUUID()}`, raw: { msclkid: "m1", fbc: "fb.1.x", foo: "ignorada" },
    }).select("id").single();
    await svc.from("contact_touches").insert({ workspace_id: ws.id, contact_id: contactA.id, occurred_at: "2026-10-01T15:00:00Z", source: "google", origin: "form", dedupe_key: `zz-${randomUUID()}` });

    const made = await createSale();
    const saleId = made.data?.sale_id;
    check(!made.error && !!saleId, "create_sale crea la venta", made.error?.message);
    check(made.data?.status === "reserved", "con la reserva cobrada y saldo, el estado calculado es 'reserved'");
    const { data: sale } = await svc.from("sales").select("*").eq("id", saleId).single();
    check(sale?.attribution_type === "last_touch" && sale?.attribution_touch_id === touch1.id, "last_touch toma el toque mas reciente y guarda su id");
    check(sale?.attribution?.source === "instagram" && sale?.attribution?.content === "Reel de la mentoria" && sale?.attribution?.ad_id === "123" && sale?.attribution?.fbclid === "fb-1", "la copia congelada trae source, content_label como content, ad_id y fbclid");
    check(JSON.stringify(sale?.attribution?.extras) === JSON.stringify({ fbc: "fb.1.x", msclkid: "m1" }) || JSON.stringify(Object.entries(sale?.attribution?.extras ?? {}).sort()) === JSON.stringify([["fbc", "fb.1.x"], ["msclkid", "m1"]]), "los extras de raw (sin la clave desconocida) quedan en la copia: paridad con attributionFromTouch");
    const { data: pagos } = await svc.from("payments").select("id, type, status, amount, original_due_date, delay_days").eq("sale_id", saleId);
    check((pagos ?? []).length === 5, "se crean los 5 pagos del plan");
    check((await svc.from("audit_log").select("action").eq("entity_id", saleId).eq("action", "sale.created")).data?.length === 1, "y la auditoria de sale.created con actor persona");

    const evCreated = await eventsOf(contactA.id, "sale_created");
    const evStatus = await eventsOf(contactA.id, "sale_status_changed");
    const evPay = await eventsOf(contactA.id, "payment_created");
    const evPaid = (await eventsOf(contactA.id, "payment_status_changed")).filter((e) => e.payload.sale_id === saleId);
    check(evCreated.length === 1 && evStatus.length === 1 && evPay.length === 5, "los eventos: un sale_created, un sale_status_changed y un payment_created por pago");
    check(evStatus[0].payload.to_status === "reserved" && !("from_status" in evStatus[0].payload), "el sale_status_changed nace 'desde nada' (sin from_status) y NO hay uno intermedio");
    check(evCreated[0].payload.change_id === evStatus[0].payload.change_id, "sale_created y su sale_status_changed llevan el MISMO change_id");
    check(evPaid.length === 1 && evPaid[0].payload.to_status === "paid" && !("from_status" in evPaid[0].payload), "el pago que nace cobrado emite payment_status_changed desde nada");
    check(evPay.every((e) => !("booking_id" in e.payload)) && !("booking_id" in evCreated[0].payload), "ningun payload lleva booking_id (el cron lo trataria como una reserva)");
    check(evCreated[0].payload.utm_source === "instagram" && evCreated[0].payload.utm_campaign === "octubre", "el payload de la venta trae los UTM de la copia");

    console.log("\n— 00162: la atribucion queda congelada —");
    await svc.from("contact_touches").insert({ workspace_id: ws.id, contact_id: contactA.id, occurred_at: "2026-10-09T15:00:00Z", source: "tiktok", origin: "dm", dedupe_key: `zz-${randomUUID()}` });
    const { data: despues } = await svc.from("sales").select("attribution, attribution_touch_id").eq("id", saleId).single();
    check(despues?.attribution?.source === "instagram" && despues?.attribution_touch_id === touch1.id, "un toque nuevo del contacto NO cambia la atribucion de la venta ya creada");
    const otraVenta = await createSale({ payments: [{ ...paidReservation, amount: 1297, type: "full" }], financing_type: "full" });
    const { data: sale2 } = await svc.from("sales").select("attribution").eq("id", otraVenta.data?.sale_id).single();
    check(sale2?.attribution?.source === "tiktok", "pero una venta NUEVA toma el toque mas reciente al guardar (ahora el de TikTok)");

    const elegida = await createSale({ attribution: { mode: "touch", touch_id: touch1.id }, payments: [{ ...paidReservation, amount: 1297, type: "full" }], financing_type: "full" });
    const { data: sale3 } = await svc.from("sales").select("attribution_type, attribution_touch_id").eq("id", elegida.data?.sale_id).single();
    check(sale3?.attribution_type === "manual" && sale3?.attribution_touch_id === touch1.id, "elegir otro toque del historial → tipo manual con su touch_id");
    const { data: touchB } = await svc.from("contact_touches").insert({ workspace_id: ws.id, contact_id: contactB.id, occurred_at: "2026-10-02T00:00:00Z", source: "web", origin: "form", dedupe_key: `zz-${randomUUID()}` }).select("id").single();
    const ajeno = await createSale({ attribution: { mode: "touch", touch_id: touchB.id } });
    check(!!ajeno.error && /invalid_touch/.test(ajeno.error.message), "un toque de OTRO contacto se rechaza (invalid_touch)");
    const sinToques = await createSale({ payments: [{ ...paidReservation, amount: 1297, type: "full" }], financing_type: "full" }, (await newContact("sin toques")).id);
    const { data: sale4 } = await svc.from("sales").select("attribution, attribution_type").eq("id", sinToques.data?.sale_id).single();
    check(sale4?.attribution_type === "none" && sale4?.attribution === null, "un contacto sin toques: venta con attribution 'none' y null (no bloquea)");
    const manual = await createSale({ attribution: { mode: "manual", manual: { source: "instagram", medium: "paid_social", campaign: "a mano" } }, payments: [{ ...paidReservation, amount: 1297, type: "full" }], financing_type: "full" });
    const { data: sale5 } = await svc.from("sales").select("attribution, attribution_type").eq("id", manual.data?.sale_id).single();
    check(sale5?.attribution_type === "manual" && sale5?.attribution?.campaign === "a mano", "cargada a mano: tipo manual con lo que se valido");

    console.log("\n— 00162: lo que create_sale rechaza (y no deja nada) —");
    const cuentas = async () => ({ sales: (await svc.from("sales").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)).count, payments: (await svc.from("payments").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)).count });
    const antes = await cuentas();
    const descuadrada = await createSale({ payments: [paidReservation, ...installments.slice(0, 3)] });
    check(!!descuadrada.error && /plan_unbalanced:25000/.test(descuadrada.error.message), "un plan que no cuadra se rechaza con la diferencia exacta (en centimos)", descuadrada.error?.message);
    const fallo2 = await createSale({ payments: [paidReservation, { ...installments[0], payment_method: "paypal" }, ...installments.slice(1)] });
    check(!!fallo2.error, "si falla la insercion de UN pago, la venta entera se deshace");
    const cambio = await createSale({ product_snapshot: snapshot(1000) });
    check(!!cambio.error && /version_changed/.test(cambio.error.message), "si el precio de la version ya no es el que se mostro: version_changed");
    const fecha = await createSale({ sale_date: "2999-01-01" });
    check(!!fecha.error && /invalid_sale_date/.test(fecha.error.message), "una fecha futura se rechaza");
    const contactoAjeno = await createSale({ contact_id: randomUUID() });
    check(!!contactoAjeno.error && /invalid_contact/.test(contactoAjeno.error.message), "un contacto que no es de este workspace se rechaza");
    const despues2 = await cuentas();
    check(despues2.sales === antes.sales && despues2.payments === antes.payments, "tras todos esos rechazos no quedo NADA creado (ni venta ni pagos)");

    console.log("\n— 00162: quien ve cada venta y que NO se puede escribir —");
    const ids = async (client, table) => new Set(((await client.from(table).select("id")).data ?? []).map((r) => r.id));
    check((await ids(setterMember.client, "sales")).has(saleId), "el setter (Member de sistema) ve su venta");
    check(!(await ids(outsider.client, "sales")).has(saleId), "otro workspace no la ve");
    const solo = await svc.from("sales").update({ setter_id: null }).eq("id", saleId);
    check(!solo.error, "(preparacion) sin setter");
    check(!(await ids(setterMember.client, "sales")).has(saleId), "un Member que no es ni setter ni vendedor NO ve la venta");
    check((await ids(setterMember.client, "payments")).size === 0 || ![...(await ids(setterMember.client, "payments"))].some((id) => (pagos ?? []).some((p) => p.id === id)), "ni sus pagos");
    check((await ids(owner.client, "sales")).has(saleId) && (await ids(owner.client, "payments")).size >= 5, "el Owner ve todas las ventas y sus pagos");
    await svc.from("sales").update({ vendedor_id: setterMember.id }).eq("id", saleId);
    check((await ids(setterMember.client, "sales")).has(saleId) && (await ids(setterMember.client, "payments")).has(pagos[0].id), "como vendedor la vuelve a ver, con sus pagos");

    // Un rol personalizado con sales.view y alcance all ve todo; con alcance own, no.
    const supervisor = await makeUser("sales-supervisor");
    const { data: rolAll } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name: "zz-test Supervisor de ventas", permissions: { keys: ["sales.view"], scopes: { leads: "own", conversations: "own", bookings: "own", calls: "own", sales: "all" } } }).select("id").single();
    await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: supervisor.id, role: "member", role_id: rolAll.id });
    check((await ids(supervisor.client, "sales")).has(saleId), "un rol personalizado con sales.view y alcance all ve las ventas del equipo");
    await svc.from("workspace_roles").update({ permissions: { keys: ["sales.view"], scopes: { leads: "own", conversations: "own", bookings: "own", calls: "own", sales: "own" } } }).eq("id", rolAll.id);
    check(!(await ids(supervisor.client, "sales")).has(saleId), "y con alcance own deja de verlas");

    for (const [table, id] of [["sales", saleId], ["payments", pagos[0].id]]) {
      const upd = await owner.client.from(table).update({ notes: "hackeada" }).eq("id", id).select("id");
      check((upd.data ?? []).length === 0, `ni el Owner puede UPDATE sobre ${table} con su sesion (solo el servidor)`);
      await owner.client.from(table).delete().eq("id", id);
      check(!!(await svc.from(table).select("id").eq("id", id).maybeSingle()).data, `ni DELETE sobre ${table}`);
      check(!!(await member.client.from(table).insert({ workspace_id: ws.id })).error, `ni INSERT de un Member sobre ${table}`);
    }
    check(!!(await owner.client.rpc("create_sale", { p_payload: payload(), p_actor_id: owner.id })).error, "un usuario autenticado NO puede llamar create_sale (solo service_role)");
    check(!!(await owner.client.rpc("cancel_sale", { p_sale_id: saleId, p_reason: "x", p_actor_id: owner.id })).error, "ni cancel_sale");
    check(!!(await svc.from("contacts").delete().eq("id", contactA.id)).error, "un contacto con ventas no se puede borrar de verdad (RESTRICT)");

    console.log("\n— 00162: los pagos y su estado —");
    const pagoProgramado = (pagos ?? []).find((p) => p.status === "scheduled");
    const { data: pagoCompleto } = await svc.from("payments").select("id, original_due_date, due_date").eq("id", pagoProgramado.id).single();
    check(!!(await svc.from("payments").insert({ workspace_id: ws.id, sale_id: saleId, type: "refund", amount: 10, status: "paid", paid_at: new Date().toISOString(), paid_on: ayer })).error, "un reembolso con monto positivo se rechaza");
    check(!!(await svc.from("payments").insert({ workspace_id: ws.id, sale_id: saleId, type: "installment", amount: -5, status: "scheduled", due_date: "2031-06-01" })).error, "y un pago normal con monto negativo tambien");
    check(!!(await svc.from("payments").update({ status: "paid" }).eq("id", pagoProgramado.id)).error, "un pago 'paid' sin paid_at ni paid_on se rechaza");
    check(!!(await svc.from("payments").update({ provider_fee_amount: 3 }).eq("id", pagoProgramado.id)).error, "una comision en un pago que no esta cobrado se rechaza");
    check(!!(await svc.from("payments").update({ status: "refunded" }).eq("id", pagoProgramado.id)).error, "el estado 'refunded' del pago esta apagado en la Fase 1 (un reembolso es otra fila)");
    check(!!(await svc.from("payments").insert({ workspace_id: ws.id, sale_id: saleId, type: "installment", amount: 5, status: "scheduled", due_date: "2031-06-01", payment_method: "paypal" })).error, "el metodo de pago es de las 5 claves");

    await svc.from("payments").update({ due_date: "2031-09-09" }).eq("id", pagoProgramado.id);
    const { data: movido } = await svc.from("payments").select("due_date, original_due_date").eq("id", pagoProgramado.id).single();
    check(movido?.due_date === "2031-09-09" && movido?.original_due_date === pagoCompleto.original_due_date, "reprogramar mueve due_date y original_due_date NO cambia");
    await svc.from("payments").update({ original_due_date: "2000-01-01" }).eq("id", pagoProgramado.id);
    check((await svc.from("payments").select("original_due_date").eq("id", pagoProgramado.id).single()).data?.original_due_date === pagoCompleto.original_due_date, "ni escribiendolo a mano");

    // delay_days = paid_on - original_due_date
    const probar = async (originalDue, paidOn) => {
      const { data: venta } = await createSale({ payments: [{ ...paidReservation, type: "full", amount: 1297, due_date: originalDue, paid_on: paidOn }], financing_type: "full" }).then((r) => ({ data: r.data }));
      return (await svc.from("payments").select("delay_days").eq("sale_id", venta.sale_id).single()).data?.delay_days;
    };
    check((await probar(ayer, ayer)) === 0, "delay_days = 0 si se cobro el dia del vencimiento");
    const diaDespues = new Date(Date.parse(`${ayer}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
    check((await probar(ayer, diaDespues)) === 2, "delay_days = +2 si se cobro dos dias despues");
    check((await probar(diaDespues, ayer)) === -2, "y -2 si se cobro dos dias antes");

    // Cobrar el pago programado: un payment_status_changed y la venta puede cambiar de estado (un evento).
    const eventosAntes = (await eventsOf(contactA.id, "sale_status_changed")).length;
    await svc.from("payments").update({ status: "paid", paid_at: new Date().toISOString(), paid_on: ayer, payment_method: "wise", provider_fee_amount: 0 }).eq("id", pagoProgramado.id);
    const pst = (await eventsOf(contactA.id, "payment_status_changed")).filter((e) => e.payload.payment_id === pagoProgramado.id);
    check(pst.length === 1 && pst[0].payload.from_status === "scheduled" && pst[0].payload.to_status === "paid", "cobrar un pago emite UN payment_status_changed con from y to");
    check((await eventsOf(contactA.id, "sale_status_changed")).length === eventosAntes, "cobrar una cuota de una venta ya 'reserved' no cambia el estado: NO hay sale_status_changed");
    await svc.from("payments").update({ notes: "solo una nota" }).eq("id", pagoProgramado.id);
    check((await eventsOf(contactA.id, "payment_status_changed")).filter((e) => e.payload.payment_id === pagoProgramado.id).length === 1, "un cambio que no toca el estado no emite nada");
    await svc.from("payments").update({ status: "scheduled", paid_at: null, paid_on: null, provider_fee_amount: null }).eq("id", pagoProgramado.id);
    const revertido = (await eventsOf(contactA.id, "payment_status_changed")).filter((e) => e.payload.payment_id === pagoProgramado.id).find((e) => e.payload.from_status === "paid");
    check(revertido?.payload.to_status === "scheduled", "revertir un cobro emite payment_status_changed paid → scheduled");

    // Moroso → la venta pasa a 'overdue' y emite UN sale_status_changed con from y to.
    await svc.from("payments").update({ status: "overdue" }).eq("id", pagoProgramado.id);
    const sOverdue = (await eventsOf(contactA.id, "sale_status_changed")).filter((e) => e.payload.sale_id === saleId && e.payload.to_status === "overdue");
    check(sOverdue.length === 1 && sOverdue[0].payload.from_status === "reserved", "un pago moroso lleva la venta a overdue con UN evento (reserved → overdue)");
    check((await svc.from("sales").select("status").eq("id", saleId).single()).data?.status === "overdue", "y el estado de la venta quedo overdue");

    console.log("\n— 00162: cancelar es definitivo —");
    const cancel = await svc.rpc("cancel_sale", { p_sale_id: saleId, p_reason: "El cliente se arrepintio", p_actor_id: owner.id });
    check(!cancel.error && cancel.data?.payments_cancelled === 4, "cancel_sale anula los 4 pagos programados y morosos", cancel.error?.message);
    const { data: trasCancelar } = await svc.from("payments").select("status").eq("sale_id", saleId);
    check((trasCancelar ?? []).filter((p) => p.status === "paid").length === 1 && (trasCancelar ?? []).filter((p) => p.status === "cancelled").length === 4, "el cobrado se conserva");
    const sCancel = (await eventsOf(contactA.id, "sale_status_changed")).filter((e) => e.payload.sale_id === saleId && e.payload.to_status === "cancelled");
    check(sCancel.length === 1 && sCancel[0].payload.reason === "El cliente se arrepintio", "y hay UN sale_status_changed hacia cancelled con el motivo");
    check((await svc.from("sales").select("status").eq("id", saleId).single()).data?.status === "cancelled", "la venta queda cancelled (no la devuelve el recalculo de cada pago)");
    check(!!(await svc.rpc("cancel_sale", { p_sale_id: saleId, p_reason: "otra vez", p_actor_id: owner.id })).error, "cancelar dos veces se rechaza");
    check(!!(await svc.rpc("cancel_sale", { p_sale_id: otraVenta.data.sale_id, p_reason: "  ", p_actor_id: owner.id })).error, "cancelar sin motivo se rechaza");

    console.log("\n— 00162: la purga de 30 dias no toca contactos con ventas —");
    await newContact("sin ventas, a purgar");
    const purga = sqlProbe(`
      DO $$
      DECLARE con_ventas boolean; sin_ventas boolean;
      BEGIN
        UPDATE public.contacts SET deleted_at = now() - interval '40 days' WHERE workspace_id = '${ws.id}';
        PERFORM public.purge_soft_deleted(30);
        SELECT EXISTS (SELECT 1 FROM public.contacts WHERE id = '${contactA.id}') INTO con_ventas;
        SELECT EXISTS (SELECT 1 FROM public.contacts WHERE workspace_id = '${ws.id}' AND display_name = 'zz-test sin ventas, a purgar') INTO sin_ventas;
        RAISE EXCEPTION 'RESULTADO: con_ventas=% sin_ventas=%', con_ventas, sin_ventas;
      END $$;`);
    check(purga === "con_ventas=t sin_ventas=f", "la purga NO borra al contacto con ventas (y sigue borrando al que no tiene) y no falla", purga);

    // La agenda de origen: del mismo contacto y ya pasada.
    console.log("\n— 00162: la agenda de origen —");
    const { data: cat } = await svc.from("booking_categories").select("id").eq("workspace_id", ws.id).not("parent_id", "is", null).limit(1).single();
    const { data: ev } = await svc.from("event_types").insert({ workspace_id: ws.id, owner_user_id: owner.id, category_id: cat.id, title: "zz-test-ventas", slug: "zz-test-ventas", duration_minutes: 30, status: "active", location_type: "manual", location_text: "Zoom" }).select("id").single();
    const mkBooking = async (contact, startAt) => (await svc.from("bookings").insert({ workspace_id: ws.id, uid: `zz-ventas-${randomUUID().slice(0, 8)}`, event_type_id: ev.id, host_user_id: owner.id, contact_id: contact, title: "zz-test", start_at: startAt, end_at: new Date(Date.parse(startAt) + 1_800_000).toISOString(), booker_name: "zz", booker_email: "zz-ventas@example.test" }).select("id").single()).data;
    const reunion = await mkBooking(contactB.id, "2026-09-01T15:00:00Z");
    const reunionAjena = await mkBooking(contactA.id, "2026-09-02T15:00:00Z");
    const futura = await mkBooking(contactB.id, "2031-09-03T15:00:00Z");
    const conAgenda = await createSale({ booking_id: reunion.id, payments: [{ ...paidReservation, type: "full", amount: 1297 }], financing_type: "full" }, contactB.id);
    check(!conAgenda.error, "una venta atada a la agenda pasada del mismo contacto se crea", conAgenda.error?.message);
    const deOtro = await createSale({ booking_id: reunionAjena.id }, contactB.id);
    check(!!deOtro.error && /invalid_booking/.test(deOtro.error.message), "una agenda de OTRO contacto se rechaza");
    const futuraErr = await createSale({ booking_id: futura.id }, contactB.id);
    check(!!futuraErr.error && /invalid_booking/.test(futuraErr.error.message), "una agenda futura se rechaza");
    await svc.from("bookings").delete().eq("id", reunion.id);
    check(!!(await svc.from("sales").select("id").eq("id", conAgenda.data.sale_id).maybeSingle()).data && (await svc.from("sales").select("booking_id").eq("id", conAgenda.data.sale_id).single()).data?.booking_id === null, "si se borra la agenda, la venta NO se borra (booking_id pasa a null)");

    console.log("\n— 00162: el asistente abierto con una version que ya no es la vigente —");
    const { data: ver3b } = await svc.from("product_versions").insert({ workspace_id: ws.id, product_variant_id: variant3.id, price: 1400 }).select("id").single();
    await svc.rpc("publish_product_version", { p_version_id: ver3b.id, p_actor_id: owner.id });
    const viejaVersion = await createSale();
    check(!!viejaVersion.error && /version_changed:1400/.test(viejaVersion.error.message), "con la version reemplazada: version_changed con el precio nuevo", viejaVersion.error?.message);

    console.log("\n— 00163: claves foráneas de sale_id —");
    const fks = sql(`select conrelid::regclass::text as tabla, confdeltype as accion from pg_constraint where conname in ('form_submissions_sale_id_fkey','contract_signatures_sale_id_fkey') order by 1`);
    check(fks.length === 2 && fks.find((f) => f.tabla === "form_submissions")?.accion === "n" && fks.find((f) => f.tabla === "contract_signatures")?.accion === "a", "form_submissions.sale_id es ON DELETE SET NULL y contract_signatures.sale_id no tiene accion (una venta firmada no se borra)");

    console.log("\n— 00164: submit_form_response valida el sale_id del link firmado —");
    const contractFields = [{ id: "f-email", key: "email", type: "email", label: "Email", required: true }];
    const { data: cForm, error: cFormErr } = await svc.from("forms").insert({
      workspace_id: ws.id, name: "zz-test contrato ventas", type: "contract", slug: `zz-test-cv-${Date.now()}`,
      draft_definition: { fields: contractFields, contractText: "# Acuerdo\n\nTexto del contrato de prueba." },
      contract_config: { title: "Acuerdo", signatureRequired: false, acceptLabel: "Acepto", ccEmails: [] }, notify_enabled: false,
    }).select("id").single();
    check(!cFormErr && !!cForm, "(preparacion) un contrato de prueba", cFormErr?.message);
    await svc.rpc("publish_form_version", { p_form_id: cForm.id, p_actor: owner.id });
    await svc.from("forms").update({ status: "published" }).eq("id", cForm.id);
    const { data: cCur } = await svc.from("forms").select("current_version_id").eq("id", cForm.id).single();
    const firmar = (hint) => svc.rpc("submit_form_response", {
      p_form_id: cForm.id, p_version_id: cCur.current_version_id, p_idempotency_key: randomUUID(),
      p_answers: { email: { type: "email", value: "ana-ventas@example.test" } }, p_attribution: {}, p_meta: {},
      p_contact_hint: hint, p_extra: { signer_name: "Ana", signer_email: "ana-ventas@example.test", legal: {} },
    });
    const submissionOf = async (id) => (await svc.from("form_submissions").select("sale_id, contact_id, meta").eq("id", id).single()).data;
    const signatureOf = async (id) => (await svc.from("contract_signatures").select("sale_id").eq("submission_id", id).single()).data;
    const eventOf = async (contactId, type, submissionId) => (await eventsOf(contactId, type)).find((e) => e.payload.submission_id === submissionId);

    const ventaPropia = otraVenta.data.sale_id;
    const ventaDeB = conAgenda.data.sale_id;
    const propia = await firmar({ signed_contact_id: contactA.id, signed_sale_id: ventaPropia });
    check(!propia.error && propia.data?.ok === true, "firmar con el link de una venta propia funciona", propia.error?.message);
    const sPropia = await submissionOf(propia.data.submission_id);
    check(sPropia.sale_id === ventaPropia && sPropia.meta?.sale_id_discarded === undefined, "la respuesta guarda el sale_id validado, sin marca de descartado");
    check((await signatureOf(propia.data.submission_id)).sale_id === ventaPropia, "y la firma (contract_signatures) lo copia");
    check((await eventOf(contactA.id, "contract_signed", propia.data.submission_id))?.payload.sale_id === ventaPropia, "contract_signed trae el sale_id en su payload");

    const ajena = await firmar({ signed_contact_id: contactA.id, signed_sale_id: ventaDeB });
    check(!ajena.error && ajena.data?.ok === true, "una venta de OTRO contacto: la firma se guarda igual", ajena.error?.message);
    const sAjena = await submissionOf(ajena.data.submission_id);
    check(sAjena.sale_id === null && sAjena.meta?.sale_id_discarded === true && sAjena.meta?.sale_id_discard_reason === "other_contact", "...sin sale_id y con meta.sale_id_discarded = true (other_contact)");
    check((await signatureOf(ajena.data.submission_id)).sale_id === null, "la firma queda sin venta");
    check((await eventOf(contactA.id, "contract_signed", ajena.data.submission_id))?.payload.sale_id === undefined, "y el evento no trae sale_id");

    const inexistente = await firmar({ signed_contact_id: contactA.id, signed_sale_id: randomUUID() });
    const sInex = await submissionOf(inexistente.data.submission_id);
    check(sInex.sale_id === null && sInex.meta?.sale_id_discard_reason === "not_found", "una venta que no existe se descarta (not_found)");

    // Un formulario comun con el link de la venta: form_submitted trae el sale_id.
    const { data: fCustom } = await svc.from("forms").insert({
      workspace_id: ws.id, name: "zz-test formulario ventas", type: "custom", slug: `zz-test-fv-${Date.now()}`,
      draft_definition: { fields: [{ id: "f-n", key: "nombre", type: "short_text", label: "Nombre", required: false }] },
      contact_config: { mode: "create_or_link", update: "fill_empty", map: [] }, notify_enabled: false,
    }).select("id").single();
    await svc.rpc("publish_form_version", { p_form_id: fCustom.id, p_actor: owner.id });
    await svc.from("forms").update({ status: "published" }).eq("id", fCustom.id);
    const { data: fCur } = await svc.from("forms").select("current_version_id").eq("id", fCustom.id).single();
    const enviar = (hint) => svc.rpc("submit_form_response", { p_form_id: fCustom.id, p_version_id: fCur.current_version_id, p_idempotency_key: randomUUID(), p_answers: { nombre: { type: "short_text", value: "Ana" } }, p_attribution: {}, p_meta: {}, p_contact_hint: hint, p_extra: {} });
    const custom = await enviar({ signed_contact_id: contactA.id, signed_sale_id: ventaPropia });
    check((await eventOf(contactA.id, "form_submitted", custom.data.submission_id))?.payload.sale_id === ventaPropia, "un formulario comun con el link de la venta: form_submitted trae el sale_id");
    const sinLink = await enviar({ display_name: "zz-test sin link", email: `zz-sin-link-${Date.now()}@example.test` });
    check((await eventsOf((await submissionOf(sinLink.data.submission_id)).contact_id, "form_submitted"))[0]?.payload.sale_id === undefined, "sin link de venta, el payload queda como antes (sin sale_id)");

    const fkBad = await svc.from("form_submissions").insert({ workspace_id: ws.id, form_id: fCustom.id, form_version_id: fCur.current_version_id, idempotency_key: randomUUID(), status: "no_contact", answers: {}, sale_id: randomUUID() });
    check(!!fkBad.error, "un sale_id que no existe en sales se rechaza por la clave foranea", fkBad.error?.message);
    const delVenta = await svc.from("sales").delete().eq("id", ventaPropia);
    check(!!delVenta.error, "una venta con una firma no se puede borrar", delVenta.error?.message);

  }
} catch (e) {
  fail("el script fallo", e.message);
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exit(failures ? 1 : 0);
