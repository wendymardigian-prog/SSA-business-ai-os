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
/** Espera (hasta `ms`) a que `read()` devuelva algo que cumpla `done`: el servidor de desarrollo compila la primera vez. */
async function waitFor(read, done, ms = 30000) {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - start > ms) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
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

  console.log("\n— Sesiones sin contacto y el disparador (M2) —");
  {
    const { data: flow } = await svc.from("flows").insert({ workspace_id: ws.id, name: "zz-test flujo sesiones", status: "draft", nodes: [], edges: [] }).select("id").single();
    const { data: inb } = await svc.from("inbound_webhooks").insert({ ...base, status: "processed" }).select("id").single();
    const noOwner = await svc.from("flow_sessions").insert({ flow_id: flow.id, status: "active", variables: {} });
    check(!!noOwner.error, "una sesion sin contacto, sin persona y sin envio la rechaza el CHECK", noOwner.error?.message);
    const withInbound = await svc.from("flow_sessions").insert({ flow_id: flow.id, status: "active", variables: {}, inbound_webhook_id: inb.id }).select("id").single();
    check(!withInbound.error, "una sesion sostenida por un envio de webhook (sin contacto) se acepta", withInbound.error?.message);
    const { data: contact } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test sesion" }).select("id").single();
    const withContact = await svc.from("flow_sessions").insert({ flow_id: flow.id, status: "active", variables: {}, contact_id: contact.id });
    check(!withContact.error, "una sesion con contacto sigue aceptandose", withContact.error?.message);
    const goodTrigger = await svc.from("triggers").insert({ workspace_id: ws.id, flow_id: flow.id, type: "webhook_received", config: { endpointId: ep.id }, is_active: true });
    check(!goodTrigger.error, "el CHECK de triggers.type acepta webhook_received", goodTrigger.error?.message);
    const eodTrigger = await svc.from("triggers").insert({ workspace_id: ws.id, flow_id: flow.id, type: "eod_submitted", config: {}, is_active: false });
    check(!eodTrigger.error, "y sigue aceptando los 31 de antes (eod_submitted)", eodTrigger.error?.message);
    const badTrigger = await svc.from("triggers").insert({ workspace_id: ws.id, flow_id: flow.id, type: "inventado", config: {}, is_active: false });
    check(!!badTrigger.error, "un tipo inventado sigue rechazado");
    // Borrar el envio deja la sesion SIN contacto fuera del CHECK: por eso la retencion la borra antes.
    const del = await svc.from("inbound_webhooks").delete().eq("id", inb.id);
    check(!!del.error, "borrar un envio que sostiene una sesion sin contacto lo frena el CHECK (la retencion la borra antes)", del.error?.message);
    await svc.from("flow_sessions").delete().eq("inbound_webhook_id", inb.id);
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
    const processed = await waitFor(
      async () => (await svc.from("inbound_webhooks").select("status, result").eq("endpoint_id", ep2.id).eq("external_event_id", "e-1").single()).data,
      (r) => r?.status === "processed" || r?.status === "error",
    );
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


    // ── WH2: un flujo real, con el motor, el paso de contacto y la atribucion ───────────────────
    {
      const t4 = newToken();
      const { data: ep4 } = await svc.from("webhook_endpoints").insert({ workspace_id: ws.id, name: "zz-test flujo", token: t4, event_id_path: "event_id" }).select("id").single();
      const upsertNode = { id: "n-u", type: "upsert_contact", position: { x: 0, y: 0 }, data: {
        mode: "create_or_update", update: "fill_empty", touchMedium: "external_form",
        map: [{ target: "contact.email", source: { path: "email" }, transform: "lowercase" }, { target: "contact.phone", source: { path: "phone" }, transform: "clean_phone" }, { target: "contact.display_name", source: { path: "name" } }],
        tags: { fixed: [] }, attribution: { map: [], autoDetect: true } } };
      const trig = { id: "n-t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "webhook_received", endpointId: ep4.id } };
      const mkFlow = async (name, conditions) => {
        const { data: f, error } = await svc.from("flows").insert({ workspace_id: ws.id, name, status: "published", version: 1, nodes: [{ ...trig, data: { ...trig.data, ...(conditions ? { conditions } : {}) } }, upsertNode], edges: [{ id: "e1", source: "n-t", target: "n-u" }] }).select("id").single();
        if (error) throw new Error(`no pude crear el flujo: ${error.message}`);
        await svc.from("triggers").insert({ workspace_id: ws.id, flow_id: f.id, type: "webhook_received", config: { endpointId: ep4.id, ...(conditions ? { conditions } : {}) }, is_active: true });
        return f.id;
      };
      const flowOk = await mkFlow("zz-test flujo que corre");
      const flowSkip = await mkFlow("zz-test flujo con condicion", { logic: "and", conditions: [{ field: "webhook.payload.plan", operator: "is", value: "basic", valueType: "text" }] });

      const payload = { event_id: "ev-1", email: " Ana.Perez@Example.com ", name: "Ana Pérez", phone: "+506 8888-1234", plan: "pro", hidden: { utm_source: "facebook", utm_content: "120215" } };
      const post1 = await hook(t4, { body: JSON.stringify(payload), headers: { "content-type": "application/json" } });
      check(post1.status === 200, "un envio a un endpoint con flujos: 200");
      const inb1 = (await waitFor(
        async () => (await svc.from("inbound_webhooks").select("status, result, contact_id").eq("endpoint_id", ep4.id).eq("external_event_id", "ev-1").single()).data,
        (r) => r?.status === "processed" || r?.status === "error",
      ));
      check(inb1?.status === "processed", "el envio queda processed", JSON.stringify(inb1));
      check(inb1?.result?.flows?.[flowOk]?.status === "completed" && inb1?.result?.flows?.[flowOk]?.contact_result === "created", "el flujo corrio y el paso creo el contacto", JSON.stringify(inb1?.result));
      check(inb1?.result?.flows?.[flowSkip]?.status === "skipped_condition", "el flujo con una condicion que no se cumple NO corrio y lo dice");
      const { data: contacts } = await svc.from("contacts").select("id, email, phone, display_name, attribution").eq("workspace_id", ws.id).ilike("email", "ana.perez@example.com");
      check((contacts ?? []).length === 1, "se creo UN contacto");
      const c = contacts?.[0];
      check(c?.email === "ana.perez@example.com" && c?.phone === "+50688881234" && c?.display_name === "Ana Pérez", "con email, telefono y nombre normalizados", JSON.stringify(c));
      check(inb1?.contact_id === c?.id, "el envio apunta al contacto");
      check(c?.attribution?.first_touch?.origin === "webhook" && c?.attribution?.last_touch?.origin === "webhook"
        && c?.attribution?.last_touch?.source === "facebook" && c?.attribution?.last_touch?.content === "120215",
        "el primer y el ultimo toque son del webhook, con las UTMs detectadas", JSON.stringify(c?.attribution));
      const { data: sessions } = await svc.from("flow_sessions").select("contact_id, inbound_webhook_id, status").eq("flow_id", flowOk);
      check(sessions?.length === 1 && sessions[0].contact_id === c?.id && sessions[0].status === "completed", "la sesion termino con el contacto que consiguio el paso", JSON.stringify(sessions));
      const { data: audit } = await svc.from("audit_log").select("action, actor_type, actor_label").eq("entity_type", "contact").eq("entity_id", c?.id);
      check((audit ?? []).some((a) => a.action === "contact.created" && a.actor_type === "webhook" && a.actor_label === "Webhook «zz-test flujo»"), "el historial del contacto dice que lo creo el webhook", JSON.stringify(audit));

      // El mismo envio otra vez: no corre nada.
      const dup = await (await hook(t4, { body: JSON.stringify(payload), headers: { "content-type": "application/json" } })).json();
      check(dup.duplicate === true, "el mismo event_id: duplicate");
      // Otro envio de la misma persona (otro id, otro email en mayusculas): se vincula, no se duplica.
      const post2 = await hook(t4, { body: JSON.stringify({ ...payload, event_id: "ev-2", email: "ANA.PEREZ@EXAMPLE.COM", name: "Otro Nombre", hidden: { utm_source: "instagram" } }), headers: { "content-type": "application/json" } });
      check(post2.status === 200, "un segundo envio de la misma persona: 200");
      await waitFor(async () => (await svc.from("inbound_webhooks").select("status").eq("endpoint_id", ep4.id).eq("external_event_id", "ev-2").maybeSingle()).data, (r) => r?.status === "processed" || r?.status === "error");
      const { data: contacts2 } = await svc.from("contacts").select("id, display_name, attribution").eq("workspace_id", ws.id).ilike("email", "ana.perez@example.com");
      check((contacts2 ?? []).length === 1, "NO se creo un segundo contacto");
      check(contacts2?.[0]?.display_name === "Ana Pérez", "con completar-solo-lo-vacio el nombre NO cambio");
      check(contacts2?.[0]?.attribution?.first_touch?.source === "facebook" && contacts2?.[0]?.attribution?.last_touch?.source === "instagram",
        "el primer toque no cambia y el ultimo pasa a ser el del nuevo envio", JSON.stringify(contacts2?.[0]?.attribution));
      const { data: touches } = await svc.from("contact_touches").select("origin, dedupe_key").eq("contact_id", c?.id);
      check((touches ?? []).filter((t) => t.origin === "webhook").length === 2, "hay un toque por envio (dos), no por flujo ni por reproceso");

      // Sin telefono, email ni red: sale por «No se pudo» y no crea nada.
      const before = (await svc.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)).count;
      await hook(t4, { body: JSON.stringify({ event_id: "ev-3", name: "Sin datos" }), headers: { "content-type": "application/json" } });
      await waitFor(async () => (await svc.from("inbound_webhooks").select("status").eq("endpoint_id", ep4.id).eq("external_event_id", "ev-3").maybeSingle()).data, (r) => r?.status === "processed" || r?.status === "error");
      const after = (await svc.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)).count;
      const { data: inb3 } = await svc.from("inbound_webhooks").select("status, result").eq("endpoint_id", ep4.id).eq("external_event_id", "ev-3").single();
      check(after === before, "sin identificador no se crea ningun contacto");
      check(inb3?.status === "processed" && inb3?.result?.flows?.[flowOk]?.contact_fail_reason === "no_identifier", "queda processed con el motivo no_identifier (no es un error)", JSON.stringify(inb3));
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
