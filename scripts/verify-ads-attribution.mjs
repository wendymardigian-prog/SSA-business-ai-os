#!/usr/bin/env node
/**
 * Verificacion del catalogo de Meta y del vinculo de anuncios (Extra L, AT2 a AT4) contra la base real.
 *
 * Prueba lo que vitest NO puede: la funcion `meta_name_key`, las policies y los privilegios de
 * `meta_campaigns`, `meta_adsets` y `meta_ads`, la lectura ADICIONAL de `meta_ads_insights_daily`
 * y el bucket privado `ad-creatives`. Cada bloque (AT3, AT4) suma sus casos a este mismo archivo.
 *
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. Una limpieza que falla es una
 * prueba que falla. No correrlo en paralelo con otro verify-*.
 *
 *   node scripts/verify-ads-attribution.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";

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
  return { id: data.user.id, client };
}

async function makeWorkspace(tag) {
  const { data, error } = await svc.from("workspaces")
    .insert({ name: `zz-test-${tag}`, slug: `zz-test-${tag}-${Date.now()}` }).select("id").single();
  if (error) throw new Error(`no pude crear el workspace ${tag}: ${error.message}`);
  return data;
}

try {
  const ws = await makeWorkspace("ads");
  const otherWs = await makeWorkspace("ads-otro");

  const admin = await makeUser("ads-admin");
  const member = await makeUser("ads-member");
  const viewer = await makeUser("ads-viewer");
  const outsider = await makeUser("ads-outsider");

  const { data: rolViewer } = await svc.from("workspace_roles").insert({
    workspace_id: ws.id, name: "zz-test Ver anuncios",
    permissions: { keys: ["dashboards.ads.view"], scopes: {} },
  }).select("id").single();

  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
    { workspace_id: ws.id, user_id: viewer.id, role: "member", role_id: rolViewer.id },
    { workspace_id: otherWs.id, user_id: outsider.id, role: "admin" },
  ]);

  console.log("\n— meta_name_key —");
  for (const [raw, expected] of [
    ["  Video  Testimonio Ána ", "video testimonio ana"],
    ["REEL — Cómo cobrar en dólares", "reel — como cobrar en dolares"],
    ["Niño   pequeño", "nino pequeno"],
    ["a\tb\nc", "a b c"],
    ["", ""],
  ]) {
    const { data, error } = await svc.rpc("meta_name_key", { p_raw: raw });
    check(!error && data === expected, `meta_name_key(${JSON.stringify(raw)}) = ${JSON.stringify(expected)}`, error?.message ?? `dio ${JSON.stringify(data)}`);
  }
  {
    const { data } = await svc.rpc("meta_name_key", { p_raw: null });
    check(data === "", "meta_name_key(null) = ''");
  }

  console.log("\n— El catalogo: unicos y restricciones —");
  const camp = { workspace_id: ws.id, ad_account_id: "act_zz", campaign_id: "c1", name: "Campaña", name_key: "campana", effective_status: "PAUSED" };
  check(!(await svc.from("meta_campaigns").insert(camp)).error, "se guarda una campaña");
  const dupCamp = await svc.from("meta_campaigns").insert(camp);
  check(dupCamp.error?.code === "23505", "la misma campaña de la misma cuenta no se repite", dupCamp.error?.message);
  check(!(await svc.from("meta_campaigns").insert({ ...camp, workspace_id: otherWs.id })).error, "el mismo id de campaña en otro workspace si se puede");
  check(!(await svc.from("meta_adsets").insert({ workspace_id: ws.id, ad_account_id: "act_zz", campaign_id: "c1", adset_id: "s1", name: "Conj" })).error, "se guarda un conjunto");
  check(!(await svc.from("meta_ads").insert({ workspace_id: ws.id, ad_account_id: "act_zz", campaign_id: "c1", adset_id: "s1", ad_id: "a1", name: "Anuncio", effective_status: "ARCHIVED" })).error, "se guarda un anuncio archivado");
  const dupAd = await svc.from("meta_ads").insert({ workspace_id: ws.id, ad_account_id: "act_zz", ad_id: "a1" });
  check(dupAd.error?.code === "23505", "el mismo anuncio de la misma cuenta no se repite", dupAd.error?.message);
  check(!!(await svc.from("meta_ads").insert({ workspace_id: ws.id, ad_account_id: "act_zz", ad_id: "a2", thumbnail_attempts: -1 })).error, "thumbnail_attempts no puede ser negativo");

  await svc.from("meta_campaigns").insert({ ...camp, workspace_id: otherWs.id, campaign_id: "c-otro" });

  console.log("\n— RLS: quien lee el catalogo —");
  for (const table of ["meta_campaigns", "meta_adsets", "meta_ads"]) {
    // Siempre se pregunta por las filas de `ws`: quien es de otro workspace ve las SUYAS, y eso esta bien.
    const read = async (u) => (await u.client.from(table).select("id").eq("workspace_id", ws.id)).data ?? [];
    check((await read(admin)).length >= 1, `${table}: el Admin lo ve`);
    check((await read(viewer)).length >= 1, `${table}: un rol con dashboards.ads.view lo ve`);
    check((await read(member)).length === 0, `${table}: un Member sin el permiso no ve filas`);
    check((await read(outsider)).length === 0, `${table}: quien es de otro workspace no ve filas`);
  }
  {
    const { data } = await admin.client.from("meta_campaigns").select("workspace_id").eq("ad_account_id", "act_zz");
    check((data ?? []).every((r) => r.workspace_id === ws.id), "el Admin no ve el catalogo de otro workspace");
  }

  console.log("\n— RLS: nadie escribe desde la app —");
  for (const table of ["meta_campaigns", "meta_adsets", "meta_ads"]) {
    const extra = table === "meta_campaigns" ? { campaign_id: "x" } : table === "meta_adsets" ? { adset_id: "x" } : { ad_id: "x" };
    check(!!(await admin.client.from(table).insert({ workspace_id: ws.id, ad_account_id: "act_zz", ...extra })).error, `${table}: el Admin no puede insertar`);
    const upd = await admin.client.from(table).update({ name: "hack" }).eq("workspace_id", ws.id).select("id");
    check((upd.data ?? []).length === 0, `${table}: el Admin no puede modificar`);
    const del = await admin.client.from(table).delete().eq("workspace_id", ws.id).select("id");
    check((del.data ?? []).length === 0, `${table}: el Admin no puede borrar`);
  }

  console.log("\n— meta_ads_insights_daily: lectura adicional por permiso —");
  await svc.from("meta_ads_insights_daily").insert({
    workspace_id: ws.id, ad_account_id: "act_zz", level: "ad", object_id: "a1", date: "2026-10-12", spend: 10,
  });
  {
    const read = async (u) => (await u.client.from("meta_ads_insights_daily").select("id").eq("workspace_id", ws.id)).data ?? [];
    check((await read(admin)).length === 1, "el Admin sigue viendo las metricas (la politica vieja no se toco)");
    check((await read(viewer)).length === 1, "un rol con dashboards.ads.view ahora tambien las ve");
    check((await read(member)).length === 0, "un Member sin el permiso sigue sin verlas");
    check((await read(outsider)).length === 0, "y quien es de otro workspace tampoco");
    const { data: pols } = await svc.rpc("pg_policies_of", { p_table: "meta_ads_insights_daily" }).then((r) => r, () => ({ data: null }));
    if (pols) check(pols.includes("meta_ads_insights_daily_select_admin"), "la politica de Owner/Admin sigue existiendo");
  }

  console.log("\n— El bucket ad-creatives —");
  {
    const { data: bucket } = await svc.storage.getBucket("ad-creatives");
    check(bucket && bucket.public === false, "el bucket es privado");
    check(bucket?.file_size_limit === 2097152, "tope de 2 MB", `dio ${bucket?.file_size_limit}`);
    check(JSON.stringify([...(bucket?.allowed_mime_types ?? [])].sort()) === JSON.stringify(["image/jpeg", "image/png", "image/webp"]), "solo jpeg, png y webp");

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const path = `${ws.id}/zz-test-a1.png`;
    const up = await svc.storage.from("ad-creatives").upload(path, png, { contentType: "image/png", upsert: true });
    check(!up.error, "el servidor puede subir", up.error?.message);
    check(!!(await svc.storage.from("ad-creatives").upload(`${ws.id}/zz-test-a.gif`, png, { contentType: "image/gif" })).error, "un gif se rechaza por tipo");

    const sign = async (u, p) => (await u.client.storage.from("ad-creatives").createSignedUrl(p, 60));
    check(!(await sign(admin, path)).error, "el Admin firma la miniatura de su workspace");
    check(!(await sign(viewer, path)).error, "un rol con dashboards.ads.view tambien");
    check(!!(await sign(member, path)).error, "un Member sin el permiso no puede firmarla");
    check(!!(await sign(outsider, path)).error, "quien es de otro workspace no puede firmarla");
    check(!!(await admin.client.storage.from("ad-creatives").upload(`${ws.id}/zz-test-hack.png`, png, { contentType: "image/png" })).error, "el Admin no puede subir desde la app");

    await svc.storage.from("ad-creatives").remove([path]);
  }
} catch (err) {
  fail("el script exploto", err instanceof Error ? err.stack : String(err));
} finally {
  console.log("\n— Limpieza —");
  await runCleanup(svc);
}

console.log(failures === 0 ? "\nTodo verde" : `\n${failures} FALLAS`);
process.exit(failures === 0 ? 0 : 1);
