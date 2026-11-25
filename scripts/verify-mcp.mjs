#!/usr/bin/env node
/**
 * Verificación del conector MCP (docs/mcp.md), de punta a punta contra la app CORRIENDO y su base.
 *
 * Usa tokens de sesión de usuarios de prueba (mismo JWT de Supabase que emite el servidor OAuth; sin `client_id`, la
 * conexión es «session»). Prueba:
 *   1. Sin token: 401 con el lugar de los metadatos OAuth. Los metadatos responden.
 *   2. Un rol sin «Usar el MCP»: 403.
 *   3. El Owner: lista de herramientas, negocio_actual, mis_permisos.
 *   4. Un rol con «Usar el MCP» pero sin `contacts.edit`: no puede editar un contacto (lo dice la acción, igual que la
 *      pantalla). El Owner sí, y queda en el historial con `metadata.via = "mcp"`.
 *   5. subir_documento_conocimiento (el documento entra para indexar) y lo delicado: sin token no cambia nada; con el
 *      token, una vez; el mismo token dos veces, no; confirmar no saltea el permiso.
 *   6. consultar respeta la RLS (alcance «lo suyo») y el negocio activo; agrupar y contar.
 *   7. sql_owner: solo el Owner, solo lectura, sin `;` en el medio, sin claves (vault).
 *   9. Quitar «Usar el MCP» corta en el pedido siguiente; una conexión desconectada da 401.
 *  10. Si el Auth tiene el servidor OAuth prendido: el flujo de Claude de punta a punta (registro dinámico, autorizar,
 *      aprobar, cambiar el código por el token) y el token OAuth (con `client_id`) entra al conector.
 *
 * Crea y limpia sus datos (prefijo `zz-test-`). Toma el candado /private/tmp/ssa-verify.lock.
 *
 *   MCP_APP_URL=http://localhost:3000 node scripts/verify-mcp.mjs --remota   (la base del .env; la app en local)
 *   DB_TARGET=local node scripts/verify-mcp.mjs                              (contra un Supabase local)
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmdirSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP = (process.env.MCP_APP_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

if (!/127\.0\.0\.1|localhost/.test(URL) && process.env.DB_TARGET !== "local" && !process.argv.includes("--remota")) {
  console.error("verify-mcp crea usuarios y datos zz-test- (y los limpia): corré contra una base local (DB_TARGET=local) o pasá --remota a propósito.");
  process.exit(2);
}

const LOCK = "/private/tmp/ssa-verify.lock";
try {
  mkdirSync(LOCK);
} catch {
  const age = Date.now() - statSync(LOCK).mtimeMs;
  if (age < 15 * 60_000) {
    console.error("Otro verify-* tiene el candado. Esperá o borralo si quedó colgado.");
    process.exit(2);
  }
}

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => {
  console.error("  FALLA", m, extra ? `\n        ${String(extra).slice(0, 600)}` : "");
  failures++;
};
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();
const cleanup = [];

async function makeUser(tag) {
  const email = `zz-test-mcp-${tag}-${stamp}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear el usuario ${tag}: ${error.message}`);
  cleanup.push(() => svc.auth.admin.deleteUser(data.user.id));
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: s, error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude entrar con ${tag}: ${e.message}`);
  return { id: data.user.id, jwt: s.session.access_token, client };
}

let rpcId = 0;
async function mcp(jwt, method, params = {}) {
  const res = await fetch(`${APP}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

async function tool(jwt, name, args = {}) {
  const r = await mcp(jwt, "tools/call", { name, arguments: args });
  const result = r.body?.result;
  const text = (result?.content ?? []).map((c) => c.text ?? "").join("\n");
  let data = null;
  try {
    data = JSON.parse(text.replace(/^[^[{]*\n\n/, ""));
  } catch {
    data = null;
  }
  return { status: r.status, isError: Boolean(result?.isError), text, data, structured: result?.structuredContent ?? null, raw: r.body };
}

try {
  // ── Datos ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-mcp", slug: `zz-test-mcp-${stamp}` }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el negocio: ${wsErr.message}`);
  cleanup.push(() => svc.from("workspaces").delete().eq("id", ws.id));

  const owner = await makeUser("owner");
  const admin = await makeUser("admin");
  const sinMcp = await makeUser("sinmcp");
  const lector = await makeUser("lector");

  const scopes = { leads: "own" };
  const channels = { mode: "all", all: { scope: "own", reply: true } };
  const { data: roleLector, error: roleErr } = await svc
    .from("workspace_roles")
    .insert({ workspace_id: ws.id, name: `zz-test-mcp-lector-${stamp}`, permissions: { keys: ["mcp.usar", "contacts.view"], scopes, channels } })
    .select("id")
    .single();
  if (roleErr) throw new Error(`no pude crear el rol: ${roleErr.message}`);

  const { error: memErr } = await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: sinMcp.id, role: "member" },
    { workspace_id: ws.id, user_id: lector.id, role: "member", role_id: roleLector.id },
  ]);
  if (memErr) throw new Error(`no pude sumar al equipo: ${memErr.message}`);
  // Cada uno conectado a ESTE negocio (lo que hace el consentimiento).
  await svc.from("mcp_connections").insert([owner, admin, sinMcp, lector].map((u) => ({ user_id: u.id, client_id: "session", workspace_id: ws.id })));

  const { data: c1 } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Ana Uno", email: `zz-ana-${stamp}@example.test`, setter_id: lector.id }).select("id").single();
  const { data: c2 } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Beto Dos", email: `zz-beto-${stamp}@example.test` }).select("id").single();

  // ── 1 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n1. Sin token y metadatos OAuth");
  {
    const r = await mcp(null, "tools/list");
    check(r.status === 401, "sin token: 401", r.status);
    check(/resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/api\/mcp"/.test(r.headers.get("www-authenticate") ?? ""), "el 401 dice dónde están los metadatos", r.headers.get("www-authenticate"));
    const meta = await fetch(`${APP}/.well-known/oauth-protected-resource/api/mcp`).then((x) => x.json());
    check(meta.resource === `${APP}/api/mcp` || meta.resource?.endsWith("/api/mcp"), "metadatos: el recurso", JSON.stringify(meta));
    check(Array.isArray(meta.authorization_servers) && meta.authorization_servers[0]?.endsWith("/auth/v1"), "metadatos: el servidor de autorización es el Auth de Supabase", JSON.stringify(meta));
    const bad = await mcp("aaa.bbb.ccc", "tools/list");
    check(bad.status === 401, "token inventado: 401", bad.status);
  }

  // ── 2 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n2. Un rol sin «Usar el MCP»");
  {
    const r = await mcp(sinMcp.jwt, "tools/list");
    check(r.status === 403 && r.body?.error === "insufficient_scope", "Member de sistema: 403", JSON.stringify(r.body));
  }

  // ── 3 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n3. El Owner");
  {
    const init = await mcp(owner.jwt, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-mcp", version: "1" } });
    check(init.status === 200 && init.body?.result?.serverInfo?.name, "initialize", JSON.stringify(init.body).slice(0, 300));
    const list = await mcp(owner.jwt, "tools/list");
    const names = (list.body?.result?.tools ?? []).map((t) => t.name);
    for (const n of ["negocio_actual", "consultar", "sql_owner", "listar_acciones", "ejecutar_accion", "subir_documento_conocimiento", "enviar_whatsapp", "errores_del_sistema"]) check(names.includes(n), `herramienta ${n}`);
    const who = await tool(owner.jwt, "negocio_actual");
    check(who.data?.negocio?.id === ws.id && who.data?.rol === "owner", "negocio_actual: este negocio, como Owner", who.text);
    const perms = await tool(lector.jwt, "mis_permisos");
    const keys = (perms.data?.permisos ?? []).map((p) => p.clave);
    check(keys.includes("mcp.usar") && keys.includes("contacts.view") && !keys.includes("contacts.edit"), "mis_permisos del rol lector", perms.text.slice(0, 300));
  }

  // ── 4 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n4. Ejecutar una acción con los mismos permisos que la pantalla");
  {
    const denied = await tool(lector.jwt, "ejecutar_accion", { accion: "contacts#updateContact", argumentos: [c1.id, { display_name: "zz-test cambiado por lector" }] });
    const { data: after1 } = await svc.from("contacts").select("display_name").eq("id", c1.id).single();
    check(denied.isError && after1.display_name === "zz-test Ana Uno", "sin contacts.edit no se edita", denied.text.slice(0, 300));
    const done = await tool(owner.jwt, "ejecutar_accion", { accion: "contacts#updateContact", argumentos: [c1.id, { display_name: "zz-test Ana Editada" }] });
    const { data: after2 } = await svc.from("contacts").select("display_name").eq("id", c1.id).single();
    check(!done.isError && after2.display_name === "zz-test Ana Editada", "el Owner edita", done.text.slice(0, 300));
    const { data: audit } = await svc.from("audit_log").select("metadata, actor_label, performed_by").eq("workspace_id", ws.id).eq("entity_id", c1.id).order("performed_at", { ascending: false }).limit(5);
    const marked = (audit ?? []).find((a) => a.metadata?.via === "mcp");
    check(Boolean(marked) && marked.performed_by === owner.id && /^MCP/.test(marked.actor_label ?? ""), "el historial lo marca como MCP y a nombre del Owner", JSON.stringify(audit));
    const unknown = await tool(owner.jwt, "ejecutar_accion", { accion: "contacts#noExiste" });
    check(unknown.isError, "una acción que no existe da error claro");
  }

  // ── 5 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n5. Subir un documento a Conocimiento, y lo delicado (borrarlo) pide confirmación una sola vez");
  {
    const content = Buffer.from(`# zz-test MCP ${stamp}\n\nUn documento de prueba subido por el conector.`).toString("base64");
    const up = await tool(owner.jwt, "subir_documento_conocimiento", { archivo: { nombre: `zz-test-${stamp}.md`, tipo: "text/markdown", base64: content }, titulo: `zz-test MCP ${stamp}` });
    const { data: doc } = await svc.from("knowledge_base").select("id, status, source_file_path").eq("workspace_id", ws.id).eq("title", `zz-test MCP ${stamp}`).maybeSingle();
    check(!up.isError && doc && ["pending", "processing", "ready"].includes(doc.status), "el documento entra y queda para indexar", up.text.slice(0, 300));
    if (doc?.source_file_path) cleanup.push(() => svc.storage.from("knowledge").remove([doc.source_file_path]));

    const args = { accion: "knowledge#deleteDocument", argumentos: [doc?.id] };
    const first = await tool(owner.jwt, "ejecutar_accion", args);
    const token = first.structured?.token_confirmacion;
    const { data: still } = await svc.from("knowledge_base").select("deleted_at").eq("id", doc?.id).single();
    check(Boolean(token) && still.deleted_at === null, "sin token: no borra y devuelve un token", first.text.slice(0, 200));
    const other = await tool(owner.jwt, "ejecutar_accion", { accion: "knowledge#deleteDocument", argumentos: [randomUUID()], confirmacion: token });
    check(other.isError, "el token no sirve para otro documento");
    const second = await tool(owner.jwt, "ejecutar_accion", { ...args, confirmacion: token });
    const { data: gone } = await svc.from("knowledge_base").select("deleted_at").eq("id", doc?.id).single();
    check(!second.isError && gone.deleted_at !== null, "con el token: se borra", second.text.slice(0, 300));
    const third = await tool(owner.jwt, "ejecutar_accion", { ...args, confirmacion: token });
    check(third.isError && /ya se usó/.test(third.text), "el mismo token otra vez: rechazado", third.text.slice(0, 200));
    const lectorDelete = await tool(lector.jwt, "ejecutar_accion", { accion: "contacts#softDeleteContact", argumentos: [c1.id] });
    const lectorConfirm = await tool(lector.jwt, "ejecutar_accion", { accion: "contacts#softDeleteContact", argumentos: [c1.id], confirmacion: lectorDelete.structured?.token_confirmacion });
    const { data: c1still } = await svc.from("contacts").select("deleted_at").eq("id", c1.id).single();
    check(lectorConfirm.isError && c1still.deleted_at === null, "confirmar no saltea el permiso: el lector no borra un contacto", lectorConfirm.text.slice(0, 200));
  }

  // ── 6 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n6. consultar: RLS y negocio activo");
  {
    const mine = await tool(lector.jwt, "consultar", { tabla: "contacts", columnas: ["id", "display_name"], filtros: [{ columna: "display_name", op: "ilike", valor: "zz-test%" }] });
    const ids = (mine.data?.filas ?? []).map((r) => r.id);
    check(!mine.isError && ids.includes(c1.id) && ids.length === 1, "el lector (alcance «lo suyo») ve solo su contacto", mine.text.slice(0, 300));
    const all = await tool(owner.jwt, "consultar", { tabla: "contacts", agrupar_por: ["setter_id"], metricas: [{ op: "count" }], todos_los_negocios: false });
    check(!all.isError && Array.isArray(all.data?.filas), "agrupar y contar", all.text.slice(0, 300));
    const badCol = await tool(owner.jwt, "consultar", { tabla: "contacts", columnas: ["id", "nope_col"] });
    check(badCol.isError && /nope_col/.test(badCol.text), "una columna que no existe se rechaza antes de consultar");
    const tables = await tool(owner.jwt, "listar_tablas", { buscar: "services" });
    check(!tables.isError && (tables.data ?? []).some((t) => t.tabla === "app_servicio.services"), "listar_tablas incluye los esquemas propios", tables.text.slice(0, 200));
  }

  // ── 7 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n7. sql_owner");
  {
    const q = await tool(owner.jwt, "sql_owner", { consulta: `select count(*)::int as n from public.contacts where workspace_id = '${ws.id}'` });
    check(!q.isError && typeof q.data?.filas?.[0]?.n === "number", "el Owner consulta", q.text.slice(0, 200));
    const ins = await tool(owner.jwt, "sql_owner", { consulta: `with d as (delete from public.contacts where workspace_id = '${ws.id}' returning 1) select * from d` });
    const { count } = await svc.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id);
    check(ins.isError && count === 2, "no puede borrar (solo lectura)", ins.text.slice(0, 200));
    const two = await tool(owner.jwt, "sql_owner", { consulta: "select 1; select 2" });
    check(two.isError, "dos consultas: rechazado");
    const vault = await tool(owner.jwt, "sql_owner", { consulta: "select * from vault.decrypted_secrets limit 1" });
    check(vault.isError, "no lee claves (vault)", vault.text.slice(0, 200));
    const nonOwner = await tool(admin.jwt, "sql_owner", { consulta: "select 1" });
    check(nonOwner.isError && /Owner/.test(nonOwner.text), "un Admin no usa SQL");
  }

  // ── 9 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n9. Quitar el permiso o desconectar corta al instante");
  {
    await svc.from("workspace_roles").update({ permissions: { keys: ["contacts.view"], scopes, channels } }).eq("id", roleLector.id);
    const r = await mcp(lector.jwt, "tools/list");
    check(r.status === 403, "sin «Usar el MCP»: 403 en el pedido siguiente", r.status);
    await svc.from("mcp_connections").update({ revoked_at: new Date().toISOString() }).eq("user_id", admin.id);
    const r2 = await mcp(admin.jwt, "tools/list");
    check(r2.status === 401, "conexión desconectada: 401", r2.status);
  }

  // ── 10 ──────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n10. El flujo OAuth de un cliente MCP (si el Auth lo tiene prendido)");
  {
    const meta = await fetch(`${URL}/auth/v1/.well-known/oauth-authorization-server`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!meta?.registration_endpoint) {
      console.log("  (el servidor OAuth de este Supabase está apagado: se saltea)");
    } else {
      const redirectUri = "http://localhost:9/callback";
      const reg = await fetch(meta.registration_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_name: `zz-test Claude ${stamp}`, redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
      }).then((r) => r.json());
      check(Boolean(reg.client_id), "registro dinámico del cliente", JSON.stringify(reg).slice(0, 200));
      if (reg.client_id) cleanup.push(() => svc.auth.admin.oauth.deleteClient(reg.client_id));
      const verifier = randomBytes(48).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const authorize = new globalThis.URL(meta.authorization_endpoint);
      for (const [k, v] of Object.entries({ response_type: "code", client_id: reg.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state: "zz", resource: `${APP}/api/mcp` })) authorize.searchParams.set(k, v);
      const step = await fetch(authorize, { redirect: "manual" });
      const location = step.headers.get("location") ?? "";
      const authId = new globalThis.URL(location, APP).searchParams.get("authorization_id");
      check(/\/oauth\/consent\?/.test(location) && Boolean(authId), "Supabase manda al consentimiento del sistema", location);
      // Lo mismo que hace la pantalla de consentimiento: leer el pedido (lo ata a la persona) y aprobarlo.
      const details = await owner.client.auth.oauth.getAuthorizationDetails(authId);
      check(details.data?.client?.id === reg.client_id, "el consentimiento ve qué app pide conectarse", JSON.stringify(details.error ?? details.data).slice(0, 200));
      const approved = await owner.client.auth.oauth.approveAuthorization(authId, { skipBrowserRedirect: true });
      const code = approved.data?.redirect_url ? new globalThis.URL(approved.data.redirect_url).searchParams.get("code") : null;
      check(Boolean(code), "aprobar devuelve el código", JSON.stringify(approved.error ?? approved.data).slice(0, 200));
      const tokenRes = await fetch(meta.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: reg.client_id, code_verifier: verifier }),
      }).then((r) => r.json());
      check(Boolean(tokenRes.access_token), "el código se cambia por el token", JSON.stringify(tokenRes).slice(0, 200));
      const payload = JSON.parse(Buffer.from(String(tokenRes.access_token).split(".")[1] ?? "", "base64url").toString() || "{}");
      check(payload.client_id === reg.client_id, "el token trae el client_id de la app", JSON.stringify(payload).slice(0, 200));
      const who = await tool(tokenRes.access_token, "negocio_actual");
      check(!who.isError && who.data?.negocio?.id === ws.id, "con el token OAuth, el conector responde en el negocio de la persona", who.text.slice(0, 200));
      const { data: conn } = await svc.from("mcp_connections").select("client_id, workspace_id").eq("user_id", owner.id).eq("client_id", reg.client_id).maybeSingle();
      check(conn?.workspace_id === ws.id, "la conexión de esa app queda guardada", JSON.stringify(conn));
    }
  }
} catch (err) {
  fail("el verify se cortó", err instanceof Error ? err.stack : String(err));
} finally {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch (e) {
      fail("la limpieza falló", e instanceof Error ? e.message : String(e));
    }
  }
  try {
    rmdirSync(LOCK);
  } catch {
    /* ya no estaba */
  }
}

console.log(failures === 0 ? "\nverify-mcp: todo en verde" : `\nverify-mcp: ${failures} falla(s)`);
process.exit(failures === 0 ? 0 : 1);
