#!/usr/bin/env node
/**
 * Verificacion de los webhooks entrantes (Extra L, WH1/WH2) contra la base real.
 *
 * Prueba lo que vitest NO puede: las policies y los privilegios por columna de
 * `webhook_endpoints` e `inbound_webhooks`, los unicos (token, nombre, id de envio) y,
 * si la app esta corriendo en local, el receptor `POST /api/hooks/[token]` de punta a punta.
 *
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. Una limpieza que falla es una
 * prueba que falla. No correrlo en paralelo con otro verify-*.
 *
 *   node scripts/verify-inbound-webhooks.mjs
 *   APP_URL=http://localhost:3000 node scripts/verify-inbound-webhooks.mjs   # el receptor real
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const newToken = () => randomBytes(16).toString("base64url");

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
  const ws = await makeWorkspace("hooks");
  const otherWs = await makeWorkspace("hooks-otro");

  const admin = await makeUser("hooks-admin");
  const member = await makeUser("hooks-member");
  const editor = await makeUser("hooks-editor");
  const integrador = await makeUser("hooks-integrador");
  const outsider = await makeUser("hooks-outsider");

  const { data: rolEditor } = await svc.from("workspace_roles").insert({
    workspace_id: ws.id, name: "zz-test Editor de flujos",
    permissions: { keys: ["flows.view", "flows.edit"], scopes: {} },
  }).select("id").single();
  const { data: rolIntegrador } = await svc.from("workspace_roles").insert({
    workspace_id: ws.id, name: "zz-test Integraciones",
    permissions: { keys: ["integrations.manage"], scopes: {} },
  }).select("id").single();

  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
    { workspace_id: ws.id, user_id: editor.id, role: "member", role_id: rolEditor.id },
    { workspace_id: ws.id, user_id: integrador.id, role: "member", role_id: rolIntegrador.id },
    { workspace_id: otherWs.id, user_id: outsider.id, role: "admin" },
  ]);

  console.log("\n— Las tablas y sus restricciones —");
  const token = newToken();
  const { data: ep, error: epErr } = await svc.from("webhook_endpoints")
    .insert({ workspace_id: ws.id, name: "zz-test Typeform", token, created_by: admin.id }).select("id").single();
  check(!epErr && !!ep, "se puede crear un endpoint", epErr?.message);

  check(!!(await svc.from("webhook_endpoints").insert({ workspace_id: ws.id, name: "zz-test malo", token: "corto" })).error,
    "la base rechaza un token que no tiene 22 caracteres URL-safe");
  check(!!(await svc.from("webhook_endpoints").insert({ workspace_id: otherWs.id, name: "zz-test otro", token })).error,
    "dos endpoints no pueden compartir token (ni entre workspaces)");
  check(!!(await svc.from("webhook_endpoints").insert({ workspace_id: ws.id, name: "  ZZ-TEST typeform ", token: newToken() })).error,
    "el nombre es unico por workspace, sin importar mayusculas ni espacios");
  check(!(await svc.from("webhook_endpoints").insert({ workspace_id: otherWs.id, name: "zz-test Typeform", token: newToken() })).error,
    "el mismo nombre en otro workspace si se puede");
  {
    await svc.from("webhook_endpoints").update({ deleted_at: new Date().toISOString() }).eq("id", ep.id);
    const { data: again, error } = await svc.from("webhook_endpoints")
      .insert({ workspace_id: ws.id, name: "zz-test Typeform", token: newToken() }).select("id").single();
    check(!error, "un endpoint borrado (suave) libera su nombre", error?.message);
    if (again) await svc.from("webhook_endpoints").delete().eq("id", again.id);
    await svc.from("webhook_endpoints").update({ deleted_at: null }).eq("id", ep.id);
  }
  check(!!(await svc.from("webhook_endpoints").insert({ workspace_id: ws.id, name: "zz-test auth", token: newToken(), auth_mode: "hmac" })).error,
    "auth_mode solo admite 'token' por ahora");

  const base = { workspace_id: ws.id, endpoint_id: ep.id, status: "received", payload: { a: 1 }, query: {} };
  check(!(await svc.from("inbound_webhooks").insert({ ...base, external_event_id: "evt-1" })).error, "se guarda un envio con id");
  const dup = await svc.from("inbound_webhooks").insert({ ...base, external_event_id: "evt-1" });
  check(!!dup.error && dup.error.code === "23505", "el mismo id de envio en el mismo endpoint falla por el indice unico", dup.error?.message);
  check(!(await svc.from("inbound_webhooks").insert({ ...base, external_event_id: null })).error
    && !(await svc.from("inbound_webhooks").insert({ ...base, external_event_id: null })).error,
    "sin id de envio se pueden guardar varios");
  check(!!(await svc.from("inbound_webhooks").insert({ ...base, status: "inventado" })).error, "el estado tiene que ser uno de los siete");

  console.log("\n— Quien lee —");
  const sel = (u, table, cols = "id") => u.client.from(table).select(cols).eq("workspace_id", ws.id);
  for (const [who, u] of [["Admin", admin], ["editor de flujos (rol personalizado)", editor]]) {
    const e = await sel(u, "webhook_endpoints", "id, name");
    check((e.data ?? []).length >= 1, `${who} ve los endpoints`, e.error?.message);
    const i = await sel(u, "inbound_webhooks");
    check((i.data ?? []).length >= 3, `${who} ve los envios`, i.error?.message);
  }
  {
    const e = await sel(integrador, "webhook_endpoints", "id, name");
    check((e.data ?? []).length >= 1, "con integrations.manage (sin flows.edit) se ve la lista de endpoints", e.error?.message);
    const i = await sel(integrador, "inbound_webhooks");
    check((i.data ?? []).length === 0, "pero NO se ven los envios (tienen datos personales)");
  }
  {
    const e = await sel(member, "webhook_endpoints", "id");
    const i = await sel(member, "inbound_webhooks");
    check((e.data ?? []).length === 0 && (i.data ?? []).length === 0,
      "un Member de sistema no ve filas por la RLS (la pantalla lee con el servidor despues de chequear flows.edit)");
  }
  {
    const e = await sel(outsider, "webhook_endpoints", "id");
    const i = await sel(outsider, "inbound_webhooks");
    check((e.data ?? []).length === 0 && (i.data ?? []).length === 0, "otro workspace no ve nada");
    const cross = await outsider.client.from("webhook_endpoints").select("id").eq("id", ep.id);
    check((cross.data ?? []).length === 0, "ni pidiendo el id de otro workspace");
  }

  console.log("\n— El token no sale de la base hacia el navegador —");
  for (const [who, u] of [["Admin", admin], ["editor de flujos", editor], ["integrador", integrador]]) {
    const r = await u.client.from("webhook_endpoints").select("token").eq("id", ep.id);
    check(!!r.error || (r.data ?? []).every((row) => !row.token), `${who} no puede leer la columna token`, r.error ? undefined : JSON.stringify(r.data));
    const star = await u.client.from("webhook_endpoints").select("*").eq("id", ep.id);
    check(!!star.error, `${who}: select('*') falla (hay que pedir las columnas)`);
    const v = await u.client.from("webhook_endpoints").select("secret_vault_name").eq("id", ep.id);
    check(!!v.error, `${who} tampoco lee secret_vault_name`);
  }
  {
    const r = await svc.from("webhook_endpoints").select("token").eq("id", ep.id).single();
    check(r.data?.token === token, "el servidor (service role) si lee el token");
  }

  console.log("\n— Nadie escribe con su sesion —");
  for (const [who, u] of [["Admin", admin], ["editor de flujos", editor]]) {
    const ins = await u.client.from("webhook_endpoints").insert({ workspace_id: ws.id, name: "zz-test intruso", token: newToken() });
    check(!!ins.error, `${who} no puede crear un endpoint con su sesion`);
    const upd = await u.client.from("webhook_endpoints").update({ name: "zz-test cambiado" }).eq("id", ep.id).select("id");
    check(!!upd.error || (upd.data ?? []).length === 0, `${who} no puede editar un endpoint con su sesion`);
    const del = await u.client.from("webhook_endpoints").delete().eq("id", ep.id).select("id");
    check(!!del.error || (del.data ?? []).length === 0, `${who} no puede borrar un endpoint`);
    const insI = await u.client.from("inbound_webhooks").insert({ ...base, status: "received" });
    check(!!insI.error, `${who} no puede inyectar un envio`);
    const updI = await u.client.from("inbound_webhooks").update({ status: "error" }).eq("endpoint_id", ep.id).select("id");
    check(!!updI.error || (updI.data ?? []).length === 0, `${who} no puede cambiar un envio`);
    const delI = await u.client.from("inbound_webhooks").delete().eq("endpoint_id", ep.id).select("id");
    check(!!delI.error || (delI.data ?? []).length === 0, `${who} no puede borrar un envio (lo vacia el cron)`);
  }
  {
    const { data } = await svc.from("webhook_endpoints").select("name").eq("id", ep.id).single();
    check(data?.name === "zz-test Typeform", "el endpoint quedo intacto");
  }

  console.log("\n— Borrar el endpoint se lleva sus envios —");
  {
    const { data: tmp } = await svc.from("webhook_endpoints").insert({ workspace_id: ws.id, name: "zz-test efimero", token: newToken() }).select("id").single();
    await svc.from("inbound_webhooks").insert({ ...base, endpoint_id: tmp.id });
    await svc.from("webhook_endpoints").delete().eq("id", tmp.id);
    const { data } = await svc.from("inbound_webhooks").select("id").eq("endpoint_id", tmp.id);
    check((data ?? []).length === 0, "ON DELETE CASCADE");
  }

  console.log("\n— El receptor de punta a punta (si la app esta corriendo) —");
  let up = false;
  try {
    const r = await fetch(`${APP_URL}/api/hooks/${"x".repeat(5)}`, { method: "POST", body: "{}", signal: AbortSignal.timeout(4000) });
    up = r.status === 404;
  } catch { up = false; }
  if (!up) {
    console.log(`  --   la app no responde en ${APP_URL}: se omite (APP_URL=… para apuntar a otra). Anotado en PENDIENTE-atribucion.md`);
  } else {
    const hook = (t, init) => fetch(`${APP_URL}/api/hooks/${t}`, { method: "POST", signal: AbortSignal.timeout(8000), ...init });
    check((await hook("corto", { body: "{}" })).status === 404, "token con otra forma: 404");
    check((await hook(newToken(), { body: "{}" })).status === 404, "token que no existe: 404");

    const t2 = newToken();
    const { data: ep2 } = await svc.from("webhook_endpoints").insert({ workspace_id: ws.id, name: "zz-test receptor", token: t2, event_id_path: "event_id" }).select("id").single();
    const r1 = await hook(t2, { body: JSON.stringify({ event_id: "e-1", email: "a@b.com" }), headers: { "content-type": "application/json" } });
    const j1 = await r1.json();
    check(r1.status === 200 && j1.ok === true && !!j1.id, "un envio valido responde 200 con el id", JSON.stringify(j1));
    const r2 = await hook(t2, { body: JSON.stringify({ event_id: "e-1", email: "a@b.com" }), headers: { "content-type": "application/json" } });
    const j2 = await r2.json();
    check(r2.status === 200 && j2.duplicate === true, "el mismo id de envio: 200 con duplicate", JSON.stringify(j2));
    const { data: rows } = await svc.from("inbound_webhooks").select("status, ip_prefix, payload").eq("endpoint_id", ep2.id);
    check((rows ?? []).length === 1, "y se guardo una sola vez");
    check(!(rows ?? [])[0]?.ip_prefix || /\/(24|48)$/.test(rows[0].ip_prefix), "la IP se guardo truncada");

    const r3 = await hook(t2 + "?utm_source=fb", { body: "email=c%40d.com&name=Ana", headers: { "content-type": "application/x-www-form-urlencoded" } });
    check(r3.status === 200, "form-urlencoded: 200");
    const { data: last } = await svc.from("inbound_webhooks").select("payload, query").eq("endpoint_id", ep2.id).order("received_at", { ascending: false }).limit(1).single();
    check(last?.payload?.email === "c@d.com" && last?.query?.utm_source === "fb", "se guardo el cuerpo plano y la query", JSON.stringify(last));

    const big = JSON.stringify({ blob: "x".repeat(300 * 1024) });
    check((await hook(t2, { body: big, headers: { "content-type": "application/json" } })).status === 413, "mas de 256 KB: 413");
    const r4 = await hook(t2, { body: "{no es json", headers: { "content-type": "application/json" } });
    check(r4.status === 200, "un JSON roto no devuelve 400");
    const { data: broken } = await svc.from("inbound_webhooks").select("status, error_message").eq("endpoint_id", ep2.id).order("received_at", { ascending: false }).limit(1).single();
    check(broken?.status === "error" && broken?.error_message === "cuerpo no es JSON", "queda con error y motivo", JSON.stringify(broken));

    // El after() del receptor procesa el envio guardado: queda `processed` sin flujos que lo escuchen.
    await new Promise((r) => setTimeout(r, 2500));
    const { data: processed } = await svc.from("inbound_webhooks").select("status, result").eq("endpoint_id", ep2.id).eq("external_event_id", "e-1").single();
    check(processed?.status === "processed" && processed?.result?.summary === "Ningún flujo publicado escucha este webhook",
      "despues de responder, el envio se procesa (sin flujos: processed)", JSON.stringify(processed));

    // Escuchar el proximo envio: se guarda como ejemplo, no se procesa y la escucha se apaga.
    await svc.from("webhook_endpoints").update({ listen_until: new Date(Date.now() + 60_000).toISOString() }).eq("id", ep2.id);
    const rl = await hook(t2, { body: JSON.stringify({ event_id: "e-listen", email: "z@z.com" }), headers: { "content-type": "application/json" } });
    check(rl.status === 200, "escuchando: responde 200");
    const { data: cap } = await svc.from("inbound_webhooks").select("status").eq("endpoint_id", ep2.id).eq("external_event_id", "e-listen").single();
    const { data: epAfter } = await svc.from("webhook_endpoints").select("listen_until, sample_payload").eq("id", ep2.id).single();
    check(cap?.status === "captured" && epAfter?.listen_until === null && epAfter?.sample_payload?.payload?.email === "z@z.com",
      "queda captured, guarda el ejemplo y apaga la escucha", JSON.stringify({ cap, epAfter }));

    // Secreto opcional en el header.
    {
      const t3 = newToken();
      const { data: ep3 } = await svc.from("webhook_endpoints").insert({ workspace_id: ws.id, name: "zz-test secreto", token: t3 }).select("id").single();
      const secretName = `webhook_secret_${ep3.id}`;
      const stored = await svc.rpc("store_secret", { secret_name: secretName, secret_value: "s3creto-de-prueba", workspace_id: ws.id });
      await svc.from("webhook_endpoints").update({ secret_vault_name: secretName }).eq("id", ep3.id);
      check(!stored.error, "se guarda el secreto en Vault", stored.error?.message);
      check((await hook(t3, { body: "{}", headers: { "content-type": "application/json" } })).status === 401, "sin el header del secreto: 401");
      check((await hook(t3, { body: "{}", headers: { "content-type": "application/json", "x-webhook-secret": "otro" } })).status === 401, "con otro secreto: 401");
      const { data: none } = await svc.from("inbound_webhooks").select("id").eq("endpoint_id", ep3.id);
      check((none ?? []).length === 0, "un 401 no guarda nada");
      check((await hook(t3, { body: "{}", headers: { "content-type": "application/json", "x-webhook-secret": "s3creto-de-prueba" } })).status === 200, "con el secreto correcto: 200");
      await svc.rpc("delete_secret", { secret_name: secretName, workspace_id: ws.id });
    }

    await svc.from("webhook_endpoints").update({ status: "paused" }).eq("id", ep2.id);
    const r5 = await hook(t2, { body: JSON.stringify({ event_id: "e-9" }), headers: { "content-type": "application/json" } });
    check(r5.status === 200, "un endpoint pausado responde 200");
    const { data: paused } = await svc.from("inbound_webhooks").select("status").eq("endpoint_id", ep2.id).eq("external_event_id", "e-9").single();
    check(paused?.status === "paused", "y lo guarda como pausado");
  }
} catch (err) {
  fail("el script exploto", err instanceof Error ? err.stack : String(err));
} finally {
  console.log("\n— Limpieza —");
  await runCleanup(svc);
}

console.log(failures === 0 ? "\nTodo verde" : `\n${failures} FALLAS`);
process.exit(failures === 0 ? 0 : 1);
