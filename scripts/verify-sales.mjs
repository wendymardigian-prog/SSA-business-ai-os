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
} catch (e) {
  fail("el script fallo", e.message);
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exit(failures ? 1 : 0);
