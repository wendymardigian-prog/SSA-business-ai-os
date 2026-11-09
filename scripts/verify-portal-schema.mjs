#!/usr/bin/env node
// @plantilla-quitar(servicios)
/**
 * Verificacion del esquema del portal (Servicios A1, F34, F44): que `app_servicio_portal` este CERRADO.
 *  - anon y authenticated no tienen USAGE y no tienen ningun privilegio sobre sus tablas;
 *  - cada tabla tiene RLS habilitada;
 *  - no hay secretos en claro: toda columna de token, contrasena o codigo es una huella (`*_hash`);
 *  - un pedido REST con la anon key o con la sesion de una persona de SSA a una tabla del portal falla.
 *
 *   node scripts/verify-portal-schema.mjs
 *
 * No escribe nada salvo un usuario de prueba (zz-test-) que borra al final.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runCleanup } from "./test-cleanup.mjs";
import { dbTargetArgs } from "./lib/db-target.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const check = (cond, m, extra) => {
  if (cond) console.log("  ok  ", m);
  else {
    console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
    failures++;
  }
};
const sql = (q) => JSON.parse(execFileSync("supabase", ["db", "query", ...dbTargetArgs(), q], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024, timeout: 90_000 })).rows ?? [];

const SCHEMA = "app_servicio_portal";
// Columnas que nombran un secreto pero no lo guardan (vencimientos y contadores).
const NOT_SECRETS = new Set(["login_code_expires_at", "login_code_attempts", "invite_expires_at", "invite_sent_at", "invite_sent_count_day"]);

try {
  console.log("\nEl esquema esta cerrado");
  const priv = sql(`SELECT has_schema_privilege('anon', '${SCHEMA}', 'USAGE') a, has_schema_privilege('authenticated', '${SCHEMA}', 'USAGE') u, has_schema_privilege('service_role', '${SCHEMA}', 'USAGE') s`)[0];
  check(priv?.a === false && priv?.u === false, "anon y authenticated no tienen USAGE", JSON.stringify(priv));
  check(priv?.s === true, "service_role si");

  const tables = sql(`SELECT c.relname t, c.relrowsecurity r FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '${SCHEMA}' AND c.relkind = 'r' ORDER BY 1`);
  check(tables.length >= 3, `hay tablas en el esquema (${tables.length})`);
  check(tables.every((t) => t.r === true), "cada tabla tiene RLS habilitada", JSON.stringify(tables.filter((t) => !t.r)));
  const grants = sql(`SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema = '${SCHEMA}' AND grantee IN ('anon', 'authenticated', 'PUBLIC')`);
  check(grants.length === 0, "anon, authenticated y PUBLIC no tienen privilegios sobre ninguna tabla", JSON.stringify(grants.slice(0, 5)));

  console.log("\nSin secretos en claro (F44)");
  const cols = sql(`SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND column_name ~ '(token|password|secret|code)' ORDER BY 1, 2`);
  const plain = cols.filter((r) => !r.c.endsWith("_hash") && !NOT_SECRETS.has(r.c));
  check(plain.length === 0, "toda columna de token, contrasena o codigo es una huella (*_hash)", JSON.stringify(plain));

  console.log("\nLa API no lo expone (F34)");
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const a = await anon.schema(SCHEMA).from("portal_accounts").select("id").limit(1);
  check(!!a.error, "un pedido REST con la anon key falla", a.error ? undefined : "devolvio datos");
  const email = `zz-test-portal-schema-${Date.now()}@example.test`;
  const password = randomUUID();
  const { error: cu } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (cu) throw new Error(`no pude crear el usuario: ${cu.message}`);
  const user = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: si } = await user.auth.signInWithPassword({ email, password });
  if (si) throw new Error(`no pude iniciar sesion: ${si.message}`);
  for (const t of ["portal_accounts", "portal_sessions", "portal_access"]) {
    const r = await user.schema(SCHEMA).from(t).select("id").limit(1);
    check(!!r.error, `un pedido REST con una sesion de SSA a ${t} falla`, r.error ? undefined : "devolvio datos");
  }
} catch (e) {
  check(false, "el script fallo", e instanceof Error ? e.message : String(e));
} finally {
  const ok = await runCleanup(svc);
  if (!ok) failures++;
}

console.log(failures === 0 ? "\nTodo verde" : `\n${failures} FALLAS`);
process.exit(failures === 0 ? 0 : 1);
