#!/usr/bin/env node
// @plantilla-quitar(servicios)
/**
 * Que la API de datos responde como antes y que `app_servicio` se lee con la RLS (Servicios A1).
 *
 * Con usuarios de prueba de verdad (prefijo zz-test-), por la API REST con la sesion de cada uno:
 *  - `public.contacts`: quien es del negocio ve su contacto de prueba; alguien de otro negocio, ninguno.
 *  - `app_servicio.services` (solo con --con-app-servicio): se lee sin error, quien no es del negocio no ve nada y
 *    nadie puede escribir (la tabla no tiene politicas ni permisos de escritura).
 *  - `app_servicio_portal` nunca se lee por la API.
 *
 *   node scripts/verify-api-schemas.mjs                       # antes de exponer: contacts igual, app_servicio no se ve
 *   node scripts/verify-api-schemas.mjs --con-app-servicio    # despues de exponer
 *
 * Como los demas verify-*: crea y limpia sus datos y no se corre en simultaneo con otro.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const EXPOSED = process.argv.includes("--con-app-servicio");

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

async function makeUser(tag) {
  const email = `zz-test-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear el usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude iniciar sesion con ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

async function makeWorkspace(tag, ownerId) {
  const { data: ws, error } = await svc
    .from("workspaces")
    .insert({ name: `zz-test-api-${tag}`, slug: `zz-test-api-${tag}-${Date.now()}` })
    .select("id")
    .single();
  if (error) throw new Error(`no pude crear el negocio ${tag}: ${error.message}`);
  const { error: m } = await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: ownerId, role: "owner" });
  if (m) throw new Error(`no pude sumar al dueño ${tag}: ${m.message}`);
  return ws.id;
}

try {
  console.log(`\nLa API de datos ${EXPOSED ? "con" : "sin"} app_servicio`);
  const a = await makeUser("api-a");
  const b = await makeUser("api-b");
  const wsA = await makeWorkspace("a", a.id);
  await makeWorkspace("b", b.id);

  const { data: contact, error: ce } = await svc
    .from("contacts")
    .insert({ workspace_id: wsA, display_name: "zz-test-api-contacto", email: `zz-test-api-${Date.now()}@example.test` })
    .select("id")
    .single();
  if (ce) throw new Error(`no pude crear el contacto de prueba: ${ce.message}`);

  // public.contacts: igual que siempre.
  const ra = await a.client.from("contacts").select("id").eq("workspace_id", wsA);
  check(!ra.error && ra.data?.length === 1 && ra.data[0].id === contact.id, "public.contacts: quien es del negocio ve su contacto", ra.error?.message);
  const rb = await b.client.from("contacts").select("id").eq("workspace_id", wsA);
  check(!rb.error && rb.data?.length === 0, "public.contacts: alguien de otro negocio no ve nada", rb.error?.message);
  const rw = await a.client.from("workspaces").select("id").eq("id", wsA);
  check(!rw.error && rw.data?.length === 1, "public.workspaces se sigue leyendo", rw.error?.message);

  // app_servicio.services
  const sa = await a.client.schema("app_servicio").from("services").select("id").eq("workspace_id", wsA);
  if (EXPOSED) {
    check(!sa.error && Array.isArray(sa.data), "app_servicio.services se lee por la API con la sesion", sa.error?.message);
    const sb = await b.client.schema("app_servicio").from("services").select("id").eq("workspace_id", wsA);
    check(!sb.error && sb.data?.length === 0, "app_servicio.services: alguien de otro negocio no ve nada", sb.error?.message);
    const ins = await a.client
      .schema("app_servicio")
      .from("services")
      .insert({ workspace_id: wsA, contact_id: contact.id, status: "active" })
      .select("id");
    check(!!ins.error, "app_servicio.services: nadie escribe por la API (ni el dueño)", ins.error ? undefined : "el insert paso");
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const sn = await anon.schema("app_servicio").from("services").select("id").limit(1);
    check(!!sn.error || (sn.data ?? []).length === 0, "app_servicio.services: sin sesion no se ve nada", sn.error ? undefined : `devolvio ${sn.data?.length}`);
  } else {
    check(!!sa.error, "app_servicio todavia no esta expuesto (la API lo rechaza)", sa.error ? undefined : "se pudo leer");
  }
  const sp = await a.client.schema("app_servicio_portal").from("portal_accounts").select("id").limit(1);
  check(!!sp.error, "app_servicio_portal no se lee por la API", sp.error ? undefined : "se pudo leer");
} catch (error) {
  fail("la verificacion no pudo terminar", error instanceof Error ? error.message : String(error));
} finally {
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures === 0 ? "\nTodo verde" : `\n${failures} falla(s)`);
process.exit(failures === 0 ? 0 : 1);
