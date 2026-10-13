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
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/**
 * SQL directo con la CLI de Supabase (para lo que la API no expone: funciones de `private` y pruebas dentro
 * de una transaccion que se deshace). Devuelve las filas, o lanza si la CLI no esta o la consulta falla.
 */
function sql(query) {
  const dir = mkdtempSync(join(tmpdir(), "verify-ads-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, query);
  const out = execFileSync("supabase", ["db", "query", "--linked", "-f", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const start = out.indexOf("{");
  return JSON.parse(out.slice(start)).rows ?? [];
}

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

  // ════════════════════════════════════════════════════════════════════════════
  // AT3: el vinculo de cada toque con su campaña, conjunto y anuncio
  // ════════════════════════════════════════════════════════════════════════════
  const shared = JSON.parse(readFileSync("lib/attribution/meta-match.cases.json", "utf8"));
  const wsM = await makeWorkspace("ads-match");
  const A = "act_zzm";
  const key = (n) => svc.rpc("meta_name_key", { p_raw: n }).then((r) => r.data);

  console.log("\n— AT3: el catalogo de los casos compartidos —");
  {
    const campaigns = await Promise.all(shared.catalog.campaigns.map(async (c) => ({ workspace_id: wsM.id, ad_account_id: A, campaign_id: c.campaignId, name: c.name, name_key: await key(c.name) })));
    const adsets = await Promise.all(shared.catalog.adsets.map(async (c) => ({ workspace_id: wsM.id, ad_account_id: A, adset_id: c.adsetId, campaign_id: c.campaignId, name: c.name, name_key: await key(c.name) })));
    const ads = await Promise.all(shared.catalog.ads.map(async (c) => ({ workspace_id: wsM.id, ad_account_id: A, ad_id: c.adId, adset_id: c.adsetId, campaign_id: c.campaignId, name: c.name, name_key: await key(c.name) })));
    const e1 = (await svc.from("meta_campaigns").insert(campaigns)).error;
    const e2 = (await svc.from("meta_adsets").insert(adsets)).error;
    const e3 = (await svc.from("meta_ads").insert(ads)).error;
    check(!e1 && !e2 && !e3, "se carga el catalogo de prueba", (e1 ?? e2 ?? e3)?.message);
  }

  console.log("\n— AT3: paridad SQL ↔ TypeScript (los mismos casos que Vitest) —");
  for (const c of shared.cases) {
    const i = c.input;
    const { data, error } = await svc.rpc("resolve_meta_match", {
      p_workspace_id: wsM.id, p_ad_id: i.adId, p_adset_id: i.adsetId, p_campaign_id: i.campaignId,
      p_utm_campaign: i.utmCampaign, p_utm_content: i.utmContent, p_utm_term: i.utmTerm, p_fbclid: i.fbclid,
    });
    const got = data ? { status: data.status, adId: data.ad_id, adsetId: data.adset_id, campaignId: data.campaign_id, method: data.method, reason: data.reason } : null;
    check(!error && JSON.stringify(got) === JSON.stringify(c.expected), `SQL: ${c.name}`, error?.message ?? `dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(c.expected)}`);
  }
  {
    const cat = await admin.client.rpc("resolve_meta_match", { p_workspace_id: wsM.id, p_ad_id: "3003", p_adset_id: null, p_campaign_id: null, p_utm_campaign: null, p_utm_content: null, p_utm_term: null, p_fbclid: null });
    check(!!cat.error, "resolve_meta_match no se puede llamar desde la app (solo service_role)");
    const setRpc = await admin.client.rpc("set_touch_meta_match", { p_workspace_id: wsM.id, p_touch_id: randomUUID(), p_action: "ignore", p_user_id: admin.id });
    check(!!setRpc.error, "set_touch_meta_match no se puede llamar desde la app");
    const rm = await admin.client.rpc("rematch_meta_touches", { p_workspace_id: wsM.id, p_since: "2000-01-01" });
    check(!!rm.error, "rematch_meta_touches no se puede llamar desde la app");
  }

  console.log("\n— AT3: el trigger vincula cada toque nuevo —");
  const stamp = Date.now();
  const mkContact = async (tag) =>
    (await svc.from("contacts").insert({ workspace_id: wsM.id, display_name: `zz-test ${tag}`, email: `zz-test-${tag}-${stamp}@example.test` }).select("id").single()).data.id;
  const record = (contactId, t) => svc.rpc("record_contact_touch", { p_workspace_id: wsM.id, p_contact_id: contactId, p_touch: { source: "facebook", medium: "paid_social", origin: "booking", dedupe_key: `zz-${randomUUID()}`, ...t } });
  const touchRow = async (id) => (await svc.from("contact_touches").select("*").eq("id", id).single()).data;
  const attributionOf = async (id) => (await svc.from("contacts").select("attribution").eq("id", id).single()).data?.attribution;
  {
    const c1 = await mkContact("t1");
    const r = await record(c1, { ad_id: "3003", campaign: "x" });
    const row = await touchRow(r.data.touch_id);
    check(row.meta_match_status === "matched" && row.meta_ad_id === "3003" && row.meta_adset_id === "2001" && row.meta_campaign_id === "1001" && row.meta_match_method === "ad_id",
      "un toque con ad_id del catalogo queda matched con su conjunto y su campaña", JSON.stringify(row));
    const attr = await attributionOf(c1);
    check(attr?.last_touch?.meta_ad_id === "3003" && attr?.first_touch?.meta_campaign_id === "1001" && attr?.last_touch?.meta_match_status === "matched",
      "contacts.attribution.last_touch trae meta_ad_id", JSON.stringify(attr));

    const c2 = await mkContact("t2");
    const r2 = await record(c2, { ad_id: "999" });
    const row2 = await touchRow(r2.data.touch_id);
    check(row2.meta_match_status === "unmatched" && row2.meta_match_reason === "id_not_in_catalog", "un ad_id fuera del catalogo queda unmatched (id_not_in_catalog)");

    const c3 = await mkContact("t3");
    const r3 = await record(c3, { source: "instagram", medium: "dm", origin: "dm" });
    const row3 = await touchRow(r3.data.touch_id);
    check(row3.meta_match_status === "none" && row3.meta_ad_id === null, "un toque sin datos de anuncio queda none");
    const attr3 = await attributionOf(c3);
    check(attr3?.last_touch && !("meta_match_status" in attr3.last_touch), "y no ensucia la atribucion con un meta_match_status 'none'", JSON.stringify(attr3));

    // Un toque insertado a mano en la tabla (sin pasar por la funcion) tambien se vincula.
    const direct = await svc.from("contact_touches").insert({ workspace_id: wsM.id, contact_id: c3, occurred_at: new Date().toISOString(), source: "facebook", medium: "paid_social", content_label: "Oferta%20%C3%9Anica", origin: "form", dedupe_key: `zz-${randomUUID()}` }).select("*").single();
    check(!direct.error && direct.data.meta_match_status === "matched" && direct.data.meta_match_method === "utm_content_name", "un insert directo tambien pasa por el trigger (utm_content codificado)", direct.error?.message);
  }

  console.log("\n— AT3: solo cuentan los toques que pueden traer datos de anuncio (00194) —");
  {
    const c = await mkContact("regla");
    const comment = await record(c, { source: "instagram", medium: "comment", origin: "comment", content: "Oferta Única" });
    const rowC = await touchRow(comment.data.touch_id);
    check(rowC.meta_match_status === "none" && rowC.meta_match_reason === null, "un comentario organico cuyo titulo se parece a un anuncio queda none (no es un UTM)", JSON.stringify(rowC));
    const booking = await record(c, { source: "facebook", medium: "paid_social", origin: "booking", content: "Oferta Única" });
    check((await touchRow(booking.data.touch_id)).meta_match_status === "matched", "la misma etiqueta en una reserva SI se vincula por nombre");
    const dm = await record(c, { source: "facebook", medium: "paid_social", origin: "dm", ad_id: "999", content: "Oferta Única" });
    const rowD = await touchRow(dm.data.touch_id);
    check(rowD.meta_match_status === "matched" && rowD.meta_ad_id === "3003", "un DM que viene de un anuncio usa el titulo como nombre", JSON.stringify(rowD));
    const fb = await record(c, { source: "instagram", medium: "dm", origin: "dm", fbclid: "IwAR0zz" });
    check((await touchRow(fb.data.touch_id)).meta_match_reason === "fbclid_only", "un fbclid solo cuenta siempre (fbclid_only)");
  }

  console.log("\n— AT3: el trigger NUNCA hace fallar el insert (error forzado) —");
  {
    const c = await mkContact("boom");
    let outcome;
    try {
      outcome = sql(`
        BEGIN;
        CREATE OR REPLACE FUNCTION public.resolve_meta_match(p_workspace_id uuid, p_ad_id text, p_adset_id text, p_campaign_id text, p_utm_campaign text, p_utm_content text, p_utm_term text, p_fbclid text)
          RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'explota a proposito'; END $f$;
        INSERT INTO public.contact_touches (workspace_id, contact_id, occurred_at, source, ad_id, origin, dedupe_key)
          VALUES ('${wsM.id}', '${c}', now(), 'facebook', '3003', 'booking', 'zz-boom-${stamp}');
        SELECT meta_match_status AS status, meta_ad_id AS ad FROM public.contact_touches WHERE dedupe_key = 'zz-boom-${stamp}';
        ROLLBACK;
      `);
    } catch (err) {
      fail("no pude correr la prueba del error forzado (¿esta la CLI de Supabase?)", err instanceof Error ? err.message.slice(0, 300) : String(err));
    }
    if (outcome) {
      check(outcome.length === 1 && outcome[0].status === "none" && outcome[0].ad === null, "con la funcion explotando, el toque se guarda igual y queda none", JSON.stringify(outcome));
    }
    const { data: still } = await svc.rpc("resolve_meta_match", { p_workspace_id: wsM.id, p_ad_id: "3003", p_adset_id: null, p_campaign_id: null, p_utm_campaign: null, p_utm_content: null, p_utm_term: null, p_fbclid: null });
    check(still?.status === "matched", "y la funcion verdadera sigue en su lugar (la prueba se deshizo)");
  }

  console.log("\n— AT3: refresh_contact_attribution = lo mismo que record_contact_touch —");
  {
    const c = await mkContact("refresh");
    await record(c, { ad_id: "3001", occurred_at: "2026-10-01T10:00:00Z" });
    await record(c, { source: "instagram", medium: "dm", origin: "dm", occurred_at: "2026-10-02T10:00:00Z" });
    await record(c, { utm_campaign_x: "ignorado", campaign: "1002", occurred_at: "2026-10-03T10:00:00Z" });
    const before = await attributionOf(c);
    let after = null;
    try {
      sql(`select private.refresh_contact_attribution('${c}'::uuid);`);
      after = await attributionOf(c);
    } catch (err) {
      fail("no pude llamar a refresh_contact_attribution", err instanceof Error ? err.message.slice(0, 300) : String(err));
    }
    check(after !== null && JSON.stringify(before) === JSON.stringify(after), "para un contacto con varios toques, refresh deja el mismo attribution que record_contact_touch", `antes ${JSON.stringify(before)} / despues ${JSON.stringify(after)}`);
  }

  console.log("\n— AT3: la huella de record_contact_touch no cambio —");
  {
    const rows = sql(`select md5(pg_get_functiondef('public.record_contact_touch'::regproc)) as h;`);
    check(rows[0]?.h === "f364db1862cc0f90291ca14ef855a214", "record_contact_touch tiene la misma huella que en el punto de partida", rows[0]?.h);
  }

  console.log("\n— AT3: re-vincular despues de un sync (rematch_meta_touches) —");
  {
    const c = await mkContact("rematch");
    const rA = await record(c, { ad_id: "7001", occurred_at: new Date().toISOString() });
    const idA = rA.data.touch_id;
    check((await touchRow(idA)).meta_match_status === "unmatched", "arranca unmatched (el anuncio todavia no esta en el catalogo)");

    // Un manual, un ignorado y uno viejo: no tienen que cambiar.
    const cB = await mkContact("rematch-manual");
    const rB = await record(cB, { ad_id: "7001", occurred_at: new Date().toISOString() });
    const setB = await svc.rpc("set_touch_meta_match", { p_workspace_id: wsM.id, p_touch_id: rB.data.touch_id, p_action: "link", p_user_id: admin.id, p_campaign_id: "1002" });
    check(setB.data?.ok === true, "vincular a mano un toque", JSON.stringify(setB));
    const cC = await mkContact("rematch-ignored");
    const rC = await record(cC, { ad_id: "7001", occurred_at: new Date().toISOString() });
    await svc.rpc("set_touch_meta_match", { p_workspace_id: wsM.id, p_touch_id: rC.data.touch_id, p_action: "ignore", p_user_id: admin.id });
    const cD = await mkContact("rematch-old");
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const rD = await record(cD, { ad_id: "7001", occurred_at: old });

    // El sync trae el anuncio.
    await svc.from("meta_ads").insert({ workspace_id: wsM.id, ad_account_id: A, ad_id: "7001", adset_id: "2001", campaign_id: "1001", name: "Nuevo", name_key: "nuevo" });
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const n = await svc.rpc("rematch_meta_touches", { p_workspace_id: wsM.id, p_since: since });
    check(!n.error && n.data >= 1, "rematch_meta_touches devuelve cuantos cambio", n.error?.message ?? String(n.data));

    const a = await touchRow(idA);
    check(a.meta_match_status === "matched" && a.meta_ad_id === "7001" && a.meta_campaign_id === "1001", "el toque unmatched pasa a matched al aparecer el anuncio", JSON.stringify(a));
    check((await attributionOf(c))?.last_touch?.meta_ad_id === "7001", "y contacts.attribution se actualiza");
    const b = await touchRow(rB.data.touch_id);
    check(b.meta_match_status === "manual" && b.meta_campaign_id === "1002" && b.meta_ad_id === null, "un toque manual NO cambia", JSON.stringify(b));
    check((await touchRow(rC.data.touch_id)).meta_match_status === "ignored", "uno ignorado tampoco");
    check((await touchRow(rD.data.touch_id)).meta_match_status === "unmatched", "uno de hace 100 dias con p_since = hace 90 dias tampoco");

    // Con -infinity (el backfill de la 00193) el viejo SI se vincula.
    const all = await svc.rpc("rematch_meta_touches", { p_workspace_id: wsM.id, p_since: "-infinity" });
    check(!all.error && (await touchRow(rD.data.touch_id)).meta_match_status === "matched", "con p_since = -infinity (el backfill) tambien se vincula el viejo", all.error?.message);
    const again = await svc.rpc("rematch_meta_touches", { p_workspace_id: wsM.id, p_since: "-infinity" });
    check(again.data === 0, "correrlo otra vez no cambia nada (idempotente)", String(again.data));
  }

  console.log("\n— AT3: vincular, ignorar y quitar a mano —");
  {
    const c = await mkContact("manual");
    const r = await record(c, { ad_id: "999", occurred_at: new Date().toISOString() });
    const id = r.data.touch_id;

    const bad = await svc.rpc("set_touch_meta_match", { p_workspace_id: wsM.id, p_touch_id: id, p_action: "link", p_user_id: admin.id, p_ad_id: "no-existe" });
    check(bad.data?.ok === false && bad.data?.error === "not_in_catalog", "no se puede vincular algo que no esta en el catalogo");
    const none = await svc.rpc("set_touch_meta_match", { p_workspace_id: wsM.id, p_touch_id: id, p_action: "link", p_user_id: admin.id });
    check(none.data?.ok === false && none.data?.error === "nothing_to_link", "vincular sin elegir nada se rechaza");
    const other = await svc.rpc("set_touch_meta_match", { p_workspace_id: otherWs.id, p_touch_id: id, p_action: "ignore", p_user_id: admin.id });
    check(other.data?.ok === false && other.data?.error === "touch_not_found", "un toque de otro workspace no se encuentra");
    const notManual = await svc.rpc("set_touch_meta_match", { p_workspace_id: wsM.id, p_touch_id: id, p_action: "unlink", p_user_id: admin.id });
    check(notManual.data?.ok === false && notManual.data?.error === "not_manual", "quitar el vinculo de algo que no es manual se rechaza");

    const link = await svc.rpc("set_touch_meta_match", { p_workspace_id: wsM.id, p_touch_id: id, p_action: "link", p_user_id: admin.id, p_ad_id: "3002" });
    const row = await touchRow(id);
    check(link.data?.ok === true && row.meta_match_status === "manual" && row.meta_ad_id === "3002" && row.meta_adset_id === "2002" && row.meta_campaign_id === "1002" && row.meta_match_by === admin.id,
      "elegir un anuncio completa su conjunto y su campaña (manual, con quien lo hizo)", JSON.stringify(row));
    check(link.data?.before?.status === "unmatched" && link.data?.after?.status === "manual", "devuelve el antes y el despues (para el historial)");
    check((await attributionOf(c))?.last_touch?.meta_ad_id === "3002", "y actualiza contacts.attribution");

    const unlink = await svc.rpc("set_touch_meta_match", { p_workspace_id: wsM.id, p_touch_id: id, p_action: "unlink", p_user_id: admin.id });
    const row2 = await touchRow(id);
    check(unlink.data?.ok === true && row2.meta_match_status === "unmatched" && row2.meta_match_by === null && row2.meta_ad_id === null, "quitar el vinculo vuelve a resolver solo", JSON.stringify(row2));
    check((await attributionOf(c))?.last_touch?.meta_ad_id === undefined, "y contacts.attribution lo refleja");

    const ign = await svc.rpc("set_touch_meta_match", { p_workspace_id: wsM.id, p_touch_id: id, p_action: "ignore", p_user_id: admin.id });
    check(ign.data?.ok === true && (await touchRow(id)).meta_match_status === "ignored", "ignorar deja el toque ignored");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AT4: ads_crm_metrics (la tabla Meta vs CRM)
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n— AT4: ads_crm_metrics —");
  {
    const wsC = await makeWorkspace("ads-crm");
    const ACC = "act_zzc";
    const dayMs = 86_400_000;
    const ago = (d) => new Date(Date.now() - d * dayMs).toISOString();
    const dateOf = (d) => new Date(Date.now() - d * dayMs).toISOString().slice(0, 10);
    const adminC = await makeUser("crm-admin");
    const memberC = await makeUser("crm-member");
    const viewerC = await makeUser("crm-viewer");
    const { data: rolView } = await svc.from("workspace_roles").insert({ workspace_id: wsC.id, name: "zz-test Ver anuncios", permissions: { keys: ["dashboards.ads.view"], scopes: {} } }).select("id").single();
    await svc.from("workspace_members").insert([
      { workspace_id: wsC.id, user_id: adminC.id, role: "admin" },
      { workspace_id: wsC.id, user_id: memberC.id, role: "member" },
      { workspace_id: wsC.id, user_id: viewerC.id, role: "member", role_id: rolView.id },
    ]);

    // Catalogo: campaña c-1 (conjunto s-1, anuncios A y B) y campaña c-2 (conjunto s-2, anuncio X).
    await svc.from("meta_campaigns").insert([
      { workspace_id: wsC.id, ad_account_id: ACC, campaign_id: "c-1", name: "Camp 1", name_key: "camp 1" },
      { workspace_id: wsC.id, ad_account_id: ACC, campaign_id: "c-2", name: "Camp 2", name_key: "camp 2" },
      { workspace_id: wsC.id, ad_account_id: "act_otra", campaign_id: "c-9", name: "Camp 9", name_key: "camp 9" },
    ]);
    await svc.from("meta_adsets").insert([
      { workspace_id: wsC.id, ad_account_id: ACC, campaign_id: "c-1", adset_id: "s-1", name: "Conj 1", name_key: "conj 1" },
      { workspace_id: wsC.id, ad_account_id: ACC, campaign_id: "c-2", adset_id: "s-2", name: "Conj 2", name_key: "conj 2" },
    ]);
    await svc.from("meta_ads").insert([
      { workspace_id: wsC.id, ad_account_id: ACC, campaign_id: "c-1", adset_id: "s-1", ad_id: "a-A", name: "Anuncio A", name_key: "anuncio a" },
      { workspace_id: wsC.id, ad_account_id: ACC, campaign_id: "c-1", adset_id: "s-1", ad_id: "a-B", name: "Anuncio B", name_key: "anuncio b" },
      { workspace_id: wsC.id, ad_account_id: ACC, campaign_id: "c-2", adset_id: "s-2", ad_id: "a-X", name: "Anuncio X", name_key: "anuncio x" },
    ]);

    const mkC = async (tag, extra = {}) =>
      (await svc.from("contacts").insert({ workspace_id: wsC.id, display_name: `zz-test ${tag}`, email: `zz-test-${tag}-${stamp}@example.test`, ...extra }).select("id").single()).data.id;
    const touchC = (contactId, t) => svc.rpc("record_contact_touch", { p_workspace_id: wsC.id, p_contact_id: contactId, p_touch: { source: "facebook", medium: "paid_social", origin: "form", dedupe_key: `zz-${randomUUID()}`, ...t } });

    // K1 (de member): primer toque A (hace 4 dias) y segundo toque B (hace 2 dias). K2 (sin asignar): toque X.
    const k1 = await mkC("k1", { setter_id: memberC.id });
    const k2 = await mkC("k2");
    const tA = await touchC(k1, { ad_id: "a-A", occurred_at: ago(4) });
    const tB = await touchC(k1, { ad_id: "a-B", occurred_at: ago(2) });
    await touchC(k2, { ad_id: "a-X", occurred_at: ago(3) });
    check(tA.data?.inserted && tB.data?.inserted, "los toques de prueba se vinculan por ad_id (trigger)");

    // Agendas: hace falta una categoria, un tipo de evento y un anfitrion.
    const { data: cat } = await svc.from("booking_categories").insert({ workspace_id: wsC.id, name: "zz-test cat" }).select("id").single();
    const { data: ev } = await svc.from("event_types").insert({ workspace_id: wsC.id, category_id: cat.id, owner_user_id: adminC.id, title: "zz-test evento", slug: "zz-evento", duration_minutes: 30 }).select("id").single();
    const uid = () => randomUUID().replace(/-/g, "").slice(0, 22);
    const mkBooking = async (contactId, over) =>
      svc.from("bookings").insert({ workspace_id: wsC.id, uid: uid(), event_type_id: ev.id, host_user_id: adminC.id, contact_id: contactId, title: "zz-test reunion", start_at: new Date(Date.now() + 3 * dayMs).toISOString(), end_at: new Date(Date.now() + 3 * dayMs + 1_800_000).toISOString(), ...over }).select("id").single();

    // (1) una agenda publica: tiene su toque `booking:<id>` del anuncio A.
    const bPublic = await mkBooking(k1, { created_at: ago(1), status: "scheduled", start_at: new Date(Date.now() + 5 * dayMs).toISOString(), end_at: new Date(Date.now() + 5 * dayMs + 1_800_000).toISOString() });
    check(!bPublic.error, "se crea una agenda de prueba", bPublic.error?.message);
    await touchC(k1, { ad_id: "a-A", origin: "booking", dedupe_key: `booking:${bPublic.data.id}`, occurred_at: ago(1) });
    // (2) una agenda MANUAL (sin toque), hecha entre el toque A y el B: hereda A. Asistio (estado `sale`).
    const bManual = await mkBooking(k1, { created_at: ago(3), status: "sale", start_at: new Date(Date.now() + 6 * dayMs).toISOString(), end_at: new Date(Date.now() + 6 * dayMs + 1_800_000).toISOString() });
    // (3) una agenda liberada: no cuenta.
    await mkBooking(k1, { created_at: ago(1), status: "cancelled_other", slot_released_at: new Date().toISOString(), start_at: new Date(Date.now() + 7 * dayMs).toISOString(), end_at: new Date(Date.now() + 7 * dayMs + 1_800_000).toISOString() });
    // (4) una cancelada normal: SI cuenta (la agenda existio y costo); hereda el ultimo toque (B).
    await mkBooking(k1, { created_at: ago(1.5), status: "cancelled_no_response", start_at: new Date(Date.now() + 8 * dayMs).toISOString(), end_at: new Date(Date.now() + 8 * dayMs + 1_800_000).toISOString() });
    check(!bManual.error, "y una manual");

    // Ventas: producto y variante.
    const { data: prod } = await svc.from("products").insert({ workspace_id: wsC.id, name: "zz-test Programa" }).select("id").single();
    const { data: variant } = await svc.from("product_variants").insert({ workspace_id: wsC.id, product_id: prod.id, name: "zz-test variante" }).select("id").single();
    const mkSale = (touchId, status, amount, over = {}) =>
      svc.from("sales").insert({ workspace_id: wsC.id, contact_id: k1, product_variant_id: variant.id, product_snapshot: { product_id: prod.id, variant_id: variant.id }, base_amount: amount, final_amount: amount, status, financing_type: "full", sale_date: dateOf(0), attribution_touch_id: touchId, attribution_type: touchId ? "last_touch" : "none", attribution: touchId ? { source: "facebook", medium: "paid_social" } : null, ...over }).select("id").single();
    const sPaid = await mkSale(tB.data.touch_id, "paid", 100.5);
    check(!sPaid.error, "se crea una venta de prueba", sPaid.error?.message);
    await mkSale(tB.data.touch_id, "cancelled", 999);
    await mkSale(tB.data.touch_id, "refunded", 888);
    await mkSale(null, "paid", 777);
    // Un pago cobrado y un reembolso (fila negativa): cash neto.
    const payBase = { workspace_id: wsC.id, sale_id: sPaid.data?.id, status: "paid", paid_at: new Date().toISOString(), paid_on: dateOf(0) };
    const p1 = await svc.from("payments").insert({ ...payBase, type: "full", amount: 100.5 });
    const p2 = await svc.from("payments").insert({ ...payBase, type: "refund", amount: -30.25 });
    check(!p1.error && !p2.error, "se crean un pago y un reembolso", (p1.error ?? p2.error)?.message);

    const metrics = async (client, level, since = dateOf(5), until = dateOf(-1), account = null) => {
      const { data, error } = await client.rpc("ads_crm_metrics", { p_level: level, p_since: since, p_until: until, p_ad_account_id: account, p_workspace_id: wsC.id });
      if (error) throw new Error(`ads_crm_metrics(${level}): ${error.message}`);
      return Object.fromEntries((data ?? []).map((r) => [r.object_id, r]));
    };

    const ad = await metrics(adminC.client, "ad");
    check(ad["a-A"]?.leads_first === 1 && ad["a-B"]?.leads_first === undefined || ad["a-B"]?.leads_first === 0, "un contacto creado en el rango con primer toque del anuncio A: leads_first(A) = 1 y leads_first(B) = 0", JSON.stringify(ad));
    check(ad["a-A"]?.leads_total === 1 && ad["a-B"]?.leads_total === 1, "con un segundo toque del anuncio B: leads_total(A) = 1 y leads_total(B) = 1", JSON.stringify(ad));
    check(ad["a-A"]?.bookings === 2, "bookings(A) = 2: la publica (por su toque) y la manual (hereda el toque anterior)", `dio ${ad["a-A"]?.bookings}`);
    check(ad["a-A"]?.bookings_attended === 1 && ad["a-A"]?.leads_with_booking === 1, "bookings_attended(A) = 1 (estado sale) y leads_with_booking(A) = 1 (un contacto)", JSON.stringify(ad["a-A"]));
    check(ad["a-B"]?.bookings === 1, "la cancelada normal SI cuenta y hereda el ultimo toque (B); la liberada no cuenta", `dio ${ad["a-B"]?.bookings}`);
    check(ad["a-B"]?.sales === 1 && Number(ad["a-B"]?.revenue_cents) === 10050, "sales(B) = 1 y revenue en centavos exactos (100,50 -> 10050); no cuentan la cancelada, la reembolsada ni la sin toque", JSON.stringify(ad["a-B"]));
    check(Number(ad["a-B"]?.cash_cents) === 7025, "cash(B) = pago - reembolso = 100,50 - 30,25 = 7025", String(ad["a-B"]?.cash_cents));
    check(ad["a-X"]?.leads_first === 1 && !ad["a-X"]?.bookings, "el anuncio X de otro contacto aparece con su lead", JSON.stringify(ad["a-X"]));

    const camp = await metrics(adminC.client, "campaign");
    const adsOf = (c) => (c === "c-1" ? ["a-A", "a-B"] : ["a-X"]);
    for (const field of ["leads_first", "bookings", "bookings_attended", "sales", "revenue_cents", "cash_cents"]) {
      const sum = adsOf("c-1").reduce((acc, id) => acc + Number(ad[id]?.[field] ?? 0), 0);
      check(sum <= Number(camp["c-1"]?.[field] ?? 0) && sum === Number(camp["c-1"]?.[field] ?? 0), `campaña: la suma de sus anuncios = su valor (${field})`, `suma ${sum}, campaña ${camp["c-1"]?.[field]}`);
    }
    check(Number(camp["c-1"]?.leads_total) === 1, "y leads_total no es la suma (un contacto con dos anuncios cuenta una vez en la campaña)", String(camp["c-1"]?.leads_total));
    const adset = await metrics(adminC.client, "adset");
    check(adset["s-1"]?.bookings === 2 + 1 && Number(adset["s-1"]?.revenue_cents) === 10050, "a nivel conjunto tambien suma bien", JSON.stringify(adset["s-1"]));

    check(Object.keys(await metrics(adminC.client, "ad", dateOf(400), dateOf(300))).length === 0, "un rango sin datos no devuelve objetos");
    const byAccount = await metrics(adminC.client, "campaign", dateOf(5), dateOf(-1), "act_otra");
    check(Object.keys(byAccount).length === 0, "filtrar por otra cuenta publicitaria no devuelve objetos de esta");
    const sameAccount = await metrics(adminC.client, "campaign", dateOf(5), dateOf(-1), ACC);
    check(Object.keys(sameAccount).sort().join() === "c-1,c-2", "filtrar por la cuenta devuelve sus objetos", Object.keys(sameAccount).join());

    // RLS: INVOKER. Un Member con alcance propio solo cuenta sus contactos.
    const own = await metrics(memberC.client, "ad");
    check(own["a-A"]?.leads_first === 1 && own["a-X"] === undefined, "un Member con alcance `own` solo cuenta sus contactos (no ve el anuncio X de otro)", Object.keys(own).join());
    const viewer = await metrics(viewerC.client, "ad");
    check(Object.keys(viewer).length === 0 || viewer["a-A"] !== undefined, "un rol con dashboards.ads.view: lo que ve lo decide la RLS de contactos");
    const outsiderRows = (await outsider.client.rpc("ads_crm_metrics", { p_level: "ad", p_since: dateOf(5), p_until: dateOf(-1), p_workspace_id: wsC.id })).data ?? [];
    check(outsiderRows.length === 0, "quien es de otro workspace no recibe nada");
    const anon = await createClient(URL, ANON, { auth: { persistSession: false } }).rpc("ads_crm_metrics", { p_level: "ad", p_since: dateOf(5), p_until: dateOf(-1), p_workspace_id: wsC.id });
    check(!!anon.error, "sin sesion no se puede llamar");
    const bad = await adminC.client.rpc("ads_crm_metrics", { p_level: "otro", p_since: dateOf(5), p_until: dateOf(-1), p_workspace_id: wsC.id });
    check(!!bad.error, "un nivel invalido se rechaza");
    const noWs = await adminC.client.rpc("ads_crm_metrics", { p_level: "ad", p_since: dateOf(5), p_until: dateOf(-1) });
    check(!noWs.error && (noWs.data ?? []).length === 0, "sin workspace devuelve vacio (no adivina)");

    // La zona horaria del workspace: un toque a las 03:00 UTC del 2 de enero es la noche del 1 de enero en Costa Rica.
    await svc.from("workspaces").update({ timezone: "America/Costa_Rica" }).eq("id", wsC.id);
    const k3 = await mkC("k3");
    await touchC(k3, { ad_id: "a-X", occurred_at: "2026-01-02T03:00:00Z" });
    const jan1 = await metrics(adminC.client, "ad", "2026-01-01", "2026-01-01");
    const jan2 = await metrics(adminC.client, "ad", "2026-01-02", "2026-01-02");
    check(jan1["a-X"]?.leads_total === 1, "las fechas son del workspace: un toque de las 03:00 UTC del 2/1 cae el 1/1 en Costa Rica", JSON.stringify(jan1));
    check(jan2["a-X"] === undefined, "y NO cae el 2/1");
    await svc.from("workspaces").update({ timezone: "UTC" }).eq("id", wsC.id);
  }

  console.log("\n— AT4: el costo con 10.000 toques —");
  {
    const wsP = await makeWorkspace("ads-perf");
    const adminP = await makeUser("perf-admin");
    await svc.from("workspace_members").insert({ workspace_id: wsP.id, user_id: adminP.id, role: "admin" });
    const ads = Array.from({ length: 20 }, (_, i) => ({ workspace_id: wsP.id, ad_account_id: "act_perf", campaign_id: `pc-${i % 4}`, adset_id: `ps-${i % 8}`, ad_id: `pa-${i}`, name: `Perf ${i}`, name_key: `perf ${i}` }));
    await svc.from("meta_ads").insert(ads);
    const contacts = await svc.from("contacts").insert(Array.from({ length: 200 }, (_, i) => ({ workspace_id: wsP.id, display_name: `zz-test perf ${i}`, email: `zz-test-perf-${i}-${stamp}@example.test` }))).select("id");
    const ids = (contacts.data ?? []).map((c) => c.id);
    const rows = [];
    for (let i = 0; i < 10000; i++) {
      rows.push({ workspace_id: wsP.id, contact_id: ids[i % ids.length], occurred_at: new Date(Date.now() - (i % 85) * 86_400_000 - 60_000 * (i % 1000)).toISOString(), source: "facebook", medium: "paid_social", origin: "form", ad_id: `pa-${i % 20}`, dedupe_key: `zz-perf-${stamp}-${i}` });
    }
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await svc.from("contact_touches").insert(rows.slice(i, i + 500));
      if (error) { fail("no pude cargar los toques de prueba", error.message); break; }
      inserted += 500;
    }
    check(inserted === 10000, "se cargan 10.000 toques de prueba");
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const until = new Date().toISOString().slice(0, 10);
    const t0 = Date.now();
    const { data, error } = await adminP.client.rpc("ads_crm_metrics", { p_level: "ad", p_since: since, p_until: until, p_workspace_id: wsP.id });
    const ms = Date.now() - t0;
    check(!error && (data ?? []).length === 20, `90 dias con 10.000 toques: 20 anuncios en ${ms} ms (con RLS y la red)`, error?.message);
    // Bajo RLS cada fila de contact_touches evalua can_see_contact (unos 35 microsegundos): con 10.000 toques son ~0,9 s dentro de la
    // base. La funcion es SECURITY INVOKER a proposito (la RLS de quien mira decide que cuenta), asi que ese costo se acepta: ver PENDIENTE.
    check(ms < 4000, "y tarda menos de 4 s de punta a punta con RLS y la red (con los volumenes reales, unos cientos de toques, son milisegundos)", `${ms} ms`);
    try {
      const plan = sql(`EXPLAIN (ANALYZE, FORMAT TEXT) SELECT * FROM public.ads_crm_metrics('ad', '${since}', '${until}', NULL, '${wsP.id}');`);
      const line = plan.map((r) => r["QUERY PLAN"] ?? Object.values(r)[0]).find((l) => /Execution Time/.test(String(l)));
      const exec = Number(String(line).match(/([\d.]+) ms/)?.[1] ?? NaN);
      check(Number.isFinite(exec) && exec < 300, `EXPLAIN ANALYZE: ${exec} ms de ejecucion (el plano pide < 300 ms)`, String(line));
    } catch (err) {
      fail("no pude correr EXPLAIN ANALYZE", err instanceof Error ? err.message.slice(0, 200) : String(err));
    }
  }
} catch (err) {
  fail("el script exploto", err instanceof Error ? err.stack : String(err));
} finally {
  console.log("\n— Limpieza —");
  await runCleanup(svc);
}

console.log(failures === 0 ? "\nTodo verde" : `\n${failures} FALLAS`);
process.exit(failures === 0 ? 0 : 1);
