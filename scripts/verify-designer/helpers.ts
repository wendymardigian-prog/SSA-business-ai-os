/**
 * Lo común de `verify-designer`: clientes, usuarios de prueba, un negocio con Owner, Member y roles a medida,
 * SQL por la CLI vinculada y los contadores. Lo usan todos los bloques.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dbTargetArgs } from "../lib/db-target.mjs";
import type { Database } from "../../lib/types/database";

export type Db = SupabaseClient<Database>;

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL as string;
export const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
export const svc = createClient<Database>(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } }) as Db;
/** Sin tipos: para las tablas o columnas que el tipo de la app no expone. */
export const raw = svc as unknown as SupabaseClient;
export const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }) as Db;

export const counters = { failures: 0, oks: 0 };
export const ok = (m: string) => {
  counters.oks++;
  console.log("  ok  ", m);
};
export const fail = (m: string, extra?: string) => {
  counters.failures++;
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
};
export const check = (cond: unknown, m: string, extra?: string) => (cond ? ok(m) : fail(m, extra));

/** Consultas que la API no expone (funciones de `private`, `storage`, catálogo): con la CLI vinculada. */
export function sql(query: string): Array<Record<string, unknown>> {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return (JSON.parse(out).rows ?? []) as Array<Record<string, unknown>>;
}

export interface TestUser {
  id: string;
  email: string;
  client: Db;
}

export async function makeUser(tag: string): Promise<TestUser> {
  const email = `zz-test-designer-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }) as Db;
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, email, client };
}

export interface TestWorkspace {
  id: string;
  owner: TestUser;
  member: TestUser;
  /** Rol personalizado con SOLO `designer.view`. */
  viewer: TestUser;
  /** Rol personalizado SIN ninguna clave del Diseñador IA. */
  outsider: TestUser;
}

/** Un negocio de prueba con Owner, Member de sistema, un rol con solo `designer.view` y uno sin nada del Diseñador. */
export async function makeWorkspace(tag: string): Promise<TestWorkspace> {
  const [owner, member, viewer, outsider] = await Promise.all([`${tag}-owner`, `${tag}-member`, `${tag}-viewer`, `${tag}-outsider`].map(makeUser));
  const { data: ws, error } = await raw.from("workspaces").insert({ name: `zz-test-designer-${tag}`, slug: `zz-test-designer-${tag}-${Date.now()}`, timezone: "UTC" }).select("id").single();
  if (error) throw new Error(`no pude crear el workspace: ${error.message}`);
  const workspaceId = ws.id as string;
  const mkRole = async (name: string, keys: string[]) => {
    const { data, error: e } = await raw.from("workspace_roles").insert({ workspace_id: workspaceId, name: `zz-test ${name}`, permissions: { keys, scopes: {} } }).select("id").single();
    if (e) throw new Error(`no pude crear el rol ${name}: ${e.message}`);
    return data.id as string;
  };
  const viewerRole = await mkRole("solo diseñador ver", ["designer.view"]);
  const outsiderRole = await mkRole("sin diseñador", ["contacts.view"]);
  const { error: me } = await raw.from("workspace_members").upsert(
    [
      { workspace_id: workspaceId, user_id: owner.id, role: "owner" },
      { workspace_id: workspaceId, user_id: member.id, role: "member" },
      { workspace_id: workspaceId, user_id: viewer.id, role: "member", role_id: viewerRole },
      { workspace_id: workspaceId, user_id: outsider.id, role: "member", role_id: outsiderRole },
    ],
    { onConflict: "workspace_id,user_id" },
  );
  if (me) throw new Error(`no pude sumar al equipo: ${me.message}`);
  return { id: workspaceId, owner, member, viewer, outsider };
}

/** Un documento mínimo válido. */
export function minimalDoc(format = "v45") {
  return { v: 1, format, pages: [{ id: "pg_test0001", background: { type: "color", color: "#ffffff" }, elements: [] }] };
}

export interface BlockContext {
  /** Cosas creadas por el bloque que la limpieza general no alcanza (archivos del Storage). */
  storagePaths: { bucket: string; path: string }[];
}

export type Block = (ctx: BlockContext) => Promise<void>;
