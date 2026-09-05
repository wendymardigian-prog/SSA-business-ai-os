#!/usr/bin/env node
/**
 * Verificacion de RLS: roles, scope de leads y Vault.
 *
 * Corre contra la base real. Crea un workspace, dos usuarios (Admin y Member) y
 * un lead de prueba, prueba que cada rol ve y hace exactamente lo que le
 * corresponde, y borra todo lo que creo al terminar.
 *
 * Complementa a los tests de vitest: eso prueba logica de la app, esto prueba
 * las policies de la base, que es donde vive la restriccion de verdad.
 *
 * Volver a correrlo despues de cada migracion que toque policies. En el Bloque 3,
 * cuando can_see_contact sume setter_id y vendedor_id, sumar los casos aca.
 *
 *   node scripts/verify-rls.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

const created = { users: [], workspaces: [] };

async function makeUser(tag) {
  const email = `zz-test-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  created.users.push(data.user.id);
  const { data: own } = await svc.from("workspace_members").select("workspace_id").eq("user_id", data.user.id);
  for (const m of own ?? []) created.workspaces.push(m.workspace_id);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}
const setFlags = (wsId, flags) => svc.from("workspaces").update(flags).eq("id", wsId);

try {
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-roles", slug: `zz-test-roles-${Date.now()}` }).select("id").single();
  created.workspaces.push(ws.id);

  const admin = await makeUser("admin");
  const member = await makeUser("member");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
  ]);
  const { data: ch } = await svc.from("channels").insert({
    workspace_id: ws.id, platform: "instagram", late_account_id: `zz-test-${Date.now()}`,
    username: "zztest", display_name: "zz test", is_active: true,
  }).select("id").single();
  const { data: contact } = await svc.from("contacts")
    .insert({ workspace_id: ws.id, display_name: "Lead de prueba" }).select("id").single();
  const { data: conv } = await svc.from("conversations").insert({
    workspace_id: ws.id, channel_id: ch.id, contact_id: contact.id, platform: "instagram",
  }).select("id").single();

  // devuelve {seen, error} para no confundir "no lo ve" con "exploto"
  const sees = async (c, table, id) => {
    const r = await c.client.from(table).select("id").eq("id", id);
    return { seen: (r.data ?? []).length > 0, error: r.error?.message };
  };
  const seesContact = (c) => sees(c, "contacts", contact.id);
  const seesConv = (c) => sees(c, "conversations", conv.id);

  console.log("\n— Constraint de roles —");
  check(!!(await svc.from("workspace_members").update({ role: "superadmin" })
    .eq("workspace_id", ws.id).eq("user_id", member.id)).error,
    "la base rechaza un rol que no sea owner/admin/member");
  check(!!(await svc.from("workspace_invites").insert({
    workspace_id: ws.id, email: "x@example.test", role: "owner", invited_by: admin.id })).error,
    "no se puede invitar a alguien como owner");

  console.log("\n— Scope de leads APAGADO (default: nada cambia) —");
  for (const [who, c] of [["Admin", admin], ["Member", member]]) {
    const r = await seesContact(c);
    check(r.seen, `el ${who} ve el contacto`, r.error);
  }
  { const r = await seesConv(member); check(r.seen, "el Member ve la conversacion", r.error); }

  console.log("\n— Scope PRENDIDO, lead sin asignar —");
  await setFlags(ws.id, { lead_scope_enabled: true, unassigned_leads_visible_to_members: false });
  { const r = await seesContact(admin); check(r.seen, "el Admin sigue viendo todo", r.error); }
  check(!(await seesContact(member)).seen, "el Member NO ve un contacto que no tiene asignado");
  check(!(await seesConv(member)).seen, "el Member NO ve la conversacion");
  { const { data: m } = await member.client.from("messages").select("id").eq("conversation_id", conv.id);
    check((m ?? []).length === 0, "los mensajes de esa conversacion tampoco le llegan"); }

  console.log("\n— Scope PRENDIDO, leads sin asignar visibles —");
  await setFlags(ws.id, { unassigned_leads_visible_to_members: true });
  { const r = await seesContact(member); check(r.seen, "con el flag prendido, el Member ve los leads sin asignar", r.error); }

  console.log("\n— Scope PRENDIDO, lead asignado al Member —");
  await setFlags(ws.id, { unassigned_leads_visible_to_members: false });
  await svc.from("conversations").update({ assigned_to: member.id }).eq("id", conv.id);
  { const r = await seesContact(member); check(r.seen, "el Member ve el contacto donde esta asignado", r.error); }
  { const r = await seesConv(member); check(r.seen, "y ve su conversacion", r.error); }

  console.log("\n— Scope PRENDIDO, lead asignado a otro —");
  await svc.from("conversations").update({ assigned_to: admin.id }).eq("id", conv.id);
  check(!(await seesContact(member)).seen, "el Member NO ve el lead de otro");
  await setFlags(ws.id, { lead_scope_enabled: false });

  console.log("\n— Configuracion fuera del alcance del Member —");
  await member.client.from("workspaces").update({ name: "hackeado" }).eq("id", ws.id);
  { const { data } = await svc.from("workspaces").select("name").eq("id", ws.id).single();
    check(data.name === "zz-test-roles", "el Member no puede editar el workspace (ni apagar el scope)"); }
  check(!!(await member.client.from("channels").insert({
    workspace_id: ws.id, platform: "whatsapp", late_account_id: "zz-hack" })).error,
    "el Member no puede conectar canales");
  check(!!(await member.client.from("workspace_invites").insert({
    workspace_id: ws.id, email: "z@example.test", role: "member", invited_by: member.id })).error,
    "el Member no puede invitar");

  console.log("\n— Lo que si puede el Admin —");
  { const { data, error } = await admin.client.from("workspace_invites").insert({
      workspace_id: ws.id, email: `zz-inv-${Date.now()}@example.test`, role: "member", invited_by: admin.id,
    }).select("id, expires_at, created_at").single();
    check(!error && !!data, "el Admin puede invitar", error?.message);
    if (data) {
      const dias = Math.round((new Date(data.expires_at) - new Date(data.created_at)) / 86400000);
      check(dias === 7, `la invitacion expira a los 7 dias (dio ${dias})`);
    } }
  { const { error } = await admin.client.from("workspace_members").update({ role: "admin" })
      .eq("workspace_id", ws.id).eq("user_id", member.id);
    const { data } = await svc.from("workspace_members").select("role")
      .eq("workspace_id", ws.id).eq("user_id", member.id).single();
    check(data.role === "admin", "el Admin puede cambiar el rol de un miembro", error?.message);
    await svc.from("workspace_members").update({ role: "member" })
      .eq("workspace_id", ws.id).eq("user_id", member.id); }
  { await admin.client.from("workspace_members").update({ role: "owner" })
      .eq("workspace_id", ws.id).eq("user_id", member.id);
    const { data } = await svc.from("workspace_members").select("role")
      .eq("workspace_id", ws.id).eq("user_id", member.id).single();
    check(data.role !== "owner", "un Admin no puede promover a nadie a Owner"); }
  { const { data } = await admin.client.from("workspace_members").select("user_id").eq("workspace_id", ws.id);
    check((data ?? []).length === 2, "el Admin puede listar los miembros del workspace"); }

  console.log("\n— Vault por rol —");
  { const { error } = await admin.client.rpc("store_secret",
      { secret_name: "zz_test", secret_value: "abc123", workspace_id: ws.id });
    check(!error, "el Admin puede guardar un secret", error?.message);
    const { data } = await admin.client.rpc("read_secret", { secret_name: "zz_test", workspace_id: ws.id });
    check(data === "abc123", "y leerlo");
    const { error: e1 } = await member.client.rpc("read_secret", { secret_name: "zz_test", workspace_id: ws.id });
    check(!!e1 && /forbidden/.test(e1.message), "el Member no puede leer secrets");
    const { error: e2 } = await member.client.rpc("store_secret",
      { secret_name: "zz_test2", secret_value: "x", workspace_id: ws.id });
    check(!!e2 && /forbidden/.test(e2.message), "ni guardarlos");
    await svc.rpc("delete_secret", { secret_name: "zz_test", workspace_id: ws.id }); }

  console.log("\n— Aislamiento entre workspaces —");
  { // el usuario de prueba tambien tiene el workspace propio que le crea el
    // trigger on_auth_user_created, asi que lo correcto es que vea exactamente
    // aquellos donde es miembro: ni uno mas.
    const { data: suyos } = await svc.from("workspace_members")
      .select("workspace_id").eq("user_id", member.id);
    const esperados = new Set((suyos ?? []).map((m) => m.workspace_id));
    const { data: visibles } = await member.client.from("workspaces").select("id");
    const vistos = new Set((visibles ?? []).map((w) => w.id));
    const demas = [...vistos].filter((id) => !esperados.has(id));
    check(demas.length === 0 && vistos.size === esperados.size,
      `el Member ve solo sus workspaces (${esperados.size})`,
      demas.length ? `vio ademas: ${demas.join(", ")}` : undefined); }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  for (const id of created.users) await svc.auth.admin.deleteUser(id);
  for (const id of [...new Set(created.workspaces)]) await svc.from("workspaces").delete().eq("id", id);
  console.log(`  ${created.users.length} usuarios y ${new Set(created.workspaces).size} workspaces de prueba borrados`);
}
console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
