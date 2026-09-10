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
 * Volver a correrlo despues de cada migracion que toque policies O GRANTS DE
 * FUNCIONES: la pasada de hardening (00045-00047) toca grants, no policies.
 *
 *   node scripts/verify-rls.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";

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
const setFlags = (wsId, flags) => svc.from("workspaces").update(flags).eq("id", wsId);

try {
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-roles", slug: `zz-test-roles-${Date.now()}` }).select("id").single();

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

  console.log("\n— El scope viene prendido de fabrica —");
  { const { data } = await svc.from("workspaces")
      .select("lead_scope_enabled, unassigned_leads_visible_to_members").eq("id", ws.id).single();
    check(data.lead_scope_enabled === true,
      "un workspace nuevo arranca con el scope de leads prendido");
    check(data.unassigned_leads_visible_to_members === false,
      "y con los leads sin asignar solo para Owner/Admin"); }

  console.log("\n— Scope APAGADO a mano: vuelve a verse todo —");
  await setFlags(ws.id, { lead_scope_enabled: false });
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

  // Bloque 4 (migracion 00028): ver la conversacion y ver al lead pasaron a ser
  // lo mismo. Lo primero que hay que fijar es que la unificacion no ESCONDA
  // nada: quien es el agente asignado tiene que seguir viendo su conversacion
  // aunque no figure como setter ni como vendedor del contacto.
  console.log("\n— El agente asignado ve su conversacion aunque no sea setter ni vendedor —");
  {
    await svc.from("contacts")
      .update({ setter_id: null, vendedor_id: null }).eq("id", contact.id);
    await svc.from("conversations").update({ assigned_to: member.id }).eq("id", conv.id);

    for (const visibles of [false, true]) {
      await setFlags(ws.id, { unassigned_leads_visible_to_members: visibles });
      const etiqueta = visibles ? "con los sin asignar visibles" : "con los sin asignar ocultos";

      const c = await seesConv(member);
      check(c.seen, `${etiqueta}, el agente asignado ve su conversacion`, c.error);
      const l = await seesContact(member);
      check(l.seen, `${etiqueta}, y ve al contacto detras de esa conversacion`, l.error);
    }
    await setFlags(ws.id, { unassigned_leads_visible_to_members: false });
  }

  // El caso que motivo la 00028: antes, esta segunda conversacion se veia sin
  // que se viera el contacto, y en la bandeja aparecia sin nombre.
  console.log("\n— Dos conversaciones del mismo lead, una asignada a otro —");
  {
    await svc.from("contacts")
      .update({ setter_id: null, vendedor_id: null }).eq("id", contact.id);
    await svc.from("conversations").update({ assigned_to: admin.id }).eq("id", conv.id);

    const { data: ch2 } = await svc.from("channels").insert({
      workspace_id: ws.id, platform: "whatsapp", late_account_id: `zz-test-wa-${Date.now()}`,
      display_name: "zz test wa", is_active: true,
    }).select("id").single();
    const { data: conv2 } = await svc.from("conversations").insert({
      workspace_id: ws.id, channel_id: ch2.id, contact_id: contact.id, platform: "whatsapp",
    }).select("id").single();

    const veConv2 = async () => {
      const r = await member.client.from("conversations").select("id").eq("id", conv2.id);
      return { seen: (r.data ?? []).length > 0, error: r.error?.message };
    };

    await setFlags(ws.id, { unassigned_leads_visible_to_members: true });
    check(!(await veConv2()).seen,
      "el Member no ve la conversacion sin asignar de un lead que no puede ver");
    check(!(await seesContact(member)).seen, "ni al contacto, que es lo coherente");

    // Y al reves: si el lead pasa a ser suyo, ve las dos conversaciones,
    // incluida la que tiene otro agente. Ese es el cambio de la 00028.
    await svc.from("contacts").update({ vendedor_id: member.id }).eq("id", contact.id);
    { const r = await veConv2();
      check(r.seen, "como vendedor del lead, ve su conversacion sin asignar", r.error); }
    { const r = await seesConv(member);
      check(r.seen, "y tambien la que tiene otro agente asignado", r.error); }

    await svc.from("conversations").delete().eq("id", conv2.id);
    await svc.from("channels").delete().eq("id", ch2.id);
    await svc.from("contacts").update({ vendedor_id: null }).eq("id", contact.id);
    await setFlags(ws.id, { unassigned_leads_visible_to_members: false });
  }

  console.log("\n— Sin ninguna relacion con el lead no se ve nada —");
  {
    await svc.from("contacts")
      .update({ setter_id: admin.id, vendedor_id: admin.id }).eq("id", contact.id);
    await svc.from("conversations").update({ assigned_to: admin.id }).eq("id", conv.id);
    check(!(await seesConv(member)).seen, "el Member no ve la conversacion de un lead ajeno");
    check(!(await seesContact(member)).seen, "ni al lead");
    { const r = await seesConv(admin); check(r.seen, "el Admin sigue viendo todo", r.error); }
  }

  console.log("\n— Scope PRENDIDO, lead asignado a otro —");
  await svc.from("conversations").update({ assigned_to: admin.id }).eq("id", conv.id);
  check(!(await seesContact(member)).seen, "el Member NO ve el lead de otro");

  // Bloque 3: setter_id y vendedor_id son la otra mitad del scope. Con la
  // conversacion asignada al Admin, lo unico que puede devolverle el lead al
  // Member es figurar como setter o como vendedor.
  console.log("\n— Scope PRENDIDO, el Member es setter —");
  await svc.from("contacts").update({ setter_id: member.id }).eq("id", contact.id);
  { const r = await seesContact(member); check(r.seen, "el Member ve el lead donde es setter", r.error); }
  { const r = await seesConv(member);
    check(r.seen, "y ve su conversacion aunque el agente asignado sea otro", r.error); }

  console.log("\n— Scope PRENDIDO, el Member es vendedor —");
  await svc.from("contacts").update({ setter_id: null, vendedor_id: member.id }).eq("id", contact.id);
  { const r = await seesContact(member); check(r.seen, "el Member ve el lead donde es vendedor", r.error); }
  { const r = await seesConv(member); check(r.seen, "y ve su conversacion", r.error); }

  console.log("\n— Scope PRENDIDO, setter y vendedor de otro —");
  await svc.from("contacts").update({ setter_id: admin.id, vendedor_id: admin.id }).eq("id", contact.id);
  check(!(await seesContact(member)).seen, "el Member NO ve el lead con setter y vendedor de otro");
  check(!(await seesConv(member)).seen, "ni su conversacion");

  // Un lead con setter o vendedor NO es un lead "sin asignar", aunque ninguna
  // conversacion tenga agente: si no, prender el flag de los sin asignar
  // abriria leads que ya tienen dueño.
  console.log("\n— Un lead con setter no cuenta como sin asignar —");
  await setFlags(ws.id, { unassigned_leads_visible_to_members: true });
  await svc.from("conversations").update({ assigned_to: null }).eq("id", conv.id);
  check(!(await seesContact(member)).seen,
    "con los sin asignar visibles, el Member sigue sin ver un lead que tiene setter");
  await setFlags(ws.id, { unassigned_leads_visible_to_members: false });

  console.log("\n— Escritura: el scope tambien corta el UPDATE —");
  await member.client.from("contacts").update({ display_name: "editado por quien no debe" })
    .eq("id", contact.id);
  { const { data } = await svc.from("contacts").select("display_name").eq("id", contact.id).single();
    check(data.display_name === "Lead de prueba",
      "el Member no puede editar un lead que no le corresponde"); }

  console.log("\n— Notas del contacto —");
  await svc.from("contacts").update({ setter_id: member.id, vendedor_id: null }).eq("id", contact.id);
  { const { data: nota, error } = await member.client.from("contact_notes").insert({
      contact_id: contact.id, workspace_id: ws.id, content: "nota del member", created_by: member.id,
    }).select("id").single();
    check(!error && !!nota, "el Member puede anotar en su lead", error?.message);

    const { data: ajena } = await svc.from("contact_notes").insert({
      contact_id: contact.id, workspace_id: ws.id, content: "nota del admin", created_by: admin.id,
    }).select("id").single();

    await member.client.from("contact_notes").update({ content: "pisada" }).eq("id", ajena.id);
    { const { data } = await svc.from("contact_notes").select("content").eq("id", ajena.id).single();
      check(data.content === "nota del admin", "un Member no puede editar la nota de otro"); }

    { const { error: e } = await admin.client.from("contact_notes")
        .update({ content: "corregida por admin" }).eq("id", nota.id);
      const { data } = await svc.from("contact_notes").select("content").eq("id", nota.id).single();
      check(data.content === "corregida por admin", "un Admin si puede editar la nota de otro", e?.message); }

    await svc.from("contact_notes").update({ deleted_at: new Date().toISOString() }).eq("id", nota.id);
    { const { data } = await member.client.from("contact_notes").select("id").eq("id", nota.id);
      check((data ?? []).length === 0, "una nota borrada no aparece"); }

    // Con el lead fuera del scope, sus notas tampoco se ven: la policy consulta
    // contacts, asi que hereda el scope sola.
    await svc.from("contacts").update({ setter_id: admin.id }).eq("id", contact.id);
    { const { data } = await member.client.from("contact_notes").select("id").eq("contact_id", contact.id);
      check((data ?? []).length === 0, "las notas de un lead ajeno tampoco se ven"); }
    await svc.from("contacts").update({ setter_id: member.id }).eq("id", contact.id); }

  console.log("\n— Audit log por rol —");
  { await svc.from("audit_log").insert([
      { workspace_id: ws.id, entity_type: "contact", entity_id: contact.id, action: "update", performed_by: member.id },
      { workspace_id: ws.id, entity_type: "contact", entity_id: contact.id, action: "update", performed_by: admin.id },
    ]);
    const { data: verMember } = await member.client.from("audit_log").select("performed_by").eq("workspace_id", ws.id);
    check((verMember ?? []).every((r) => r.performed_by === member.id),
      "un Member solo ve sus propias acciones en el audit log");
    const { data: verAdmin } = await admin.client.from("audit_log").select("id").eq("workspace_id", ws.id);
    check((verAdmin ?? []).length >= 2, "un Admin ve las acciones de todos");
    const { error: e } = await member.client.from("audit_log").insert({
      workspace_id: ws.id, entity_type: "contact", entity_id: contact.id, action: "delete", performed_by: admin.id });
    check(!!e, "nadie puede escribir una entrada de audit log a nombre de otro"); }

  console.log("\n— Borrado logico —");
  { await svc.from("contacts").update({ deleted_at: new Date().toISOString() }).eq("id", contact.id);
    check(!(await seesContact(admin)).seen, "un contacto borrado no lo ve ni el Admin");
    await svc.from("conversations").update({ deleted_at: new Date().toISOString() }).eq("id", conv.id);
    check(!(await seesConv(admin)).seen, "una conversacion borrada tampoco");
    await svc.from("contacts").update({ deleted_at: null }).eq("id", contact.id);
    await svc.from("conversations").update({ deleted_at: null }).eq("id", conv.id);
    { const r = await seesContact(admin); check(r.seen, "y al restaurarlo vuelve a aparecer", r.error); } }

  await svc.from("contacts").update({ setter_id: null, vendedor_id: null }).eq("id", contact.id);
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


  console.log("\n— RPC heredadas: la anon key no puede escribir —");
  { // increment_unread es SECURITY DEFINER y no valida nada. Estuvo abierta a
    // anon (la key publica del frontend) hasta la migracion 00045: cualquiera
    // podia reabrir conversaciones ajenas y escribir en el preview que se ve en
    // la bandeja.
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });

    const { data: antes } = await svc.from("conversations")
      .select("last_message_preview, status").eq("id", conv.id).single();

    const { error } = await anon.rpc("increment_unread",
      { conv_id: conv.id, preview: "zz-defaceado" });
    check(!!error, "anon no puede llamar increment_unread", "no dio error");

    // Chequear solo el error no alcanza: podria venir de otro lado con la
    // escritura ya hecha.
    const { data: despues } = await svc.from("conversations")
      .select("last_message_preview, status").eq("id", conv.id).single();
    check(despues.last_message_preview === antes.last_message_preview,
      "y el preview de la conversacion quedo intacto",
      `quedo: ${despues.last_message_preview}`);

    const { error: e2 } = await anon.rpc("increment_broadcast_sent",
      { b_id: "00000000-0000-0000-0000-000000000000" });
    check(!!e2, "anon tampoco puede tocar los contadores de broadcast");

    const { error: e3 } = await member.client.rpc("increment_unread",
      { conv_id: conv.id, preview: "zz" });
    check(!!e3, "un usuario logueado tampoco: es una primitiva del sistema");

    const { error: e4 } = await anon.rpc("is_workspace_member", { ws_id: ws.id });
    check(!!e4, "anon no puede llamar is_workspace_member"); }

  console.log("\n— Canario: la app sigue leyendo —");
  { // is_workspace_member la llaman ~37 policies, y una expresion de policy se
    // evalua con el rol de la sesion. Si alguien le revoca EXECUTE a
    // `authenticated` para callar al linter, TODA lectura de la app se cae con
    // "permission denied for function". Este caso es lo que lo detecta.
    const { error } = await admin.client.from("contacts").select("id").limit(1);
    check(!error, "un usuario logueado sigue pudiendo leer contactos",
      error?.message);
    const { error: e2 } = await admin.client.from("conversations").select("id").limit(1);
    check(!e2, "y conversaciones", e2?.message); }

  console.log("\n— scheduled_jobs es solo del service role —");
  { const { data: job } = await svc.from("scheduled_jobs").insert({
      type: "zz_test_job",
      payload: { zz: "dato sensible de prueba" },
      run_at: new Date(Date.now() + 3600_000).toISOString(),
    }).select("id").single();

    // El payload de los jobs reales lleva el texto del mensaje del lead.
    const { data: vistosMember } = await member.client.from("scheduled_jobs").select("id");
    check((vistosMember ?? []).length === 0,
      "un Member no ve ningun job", `vio ${(vistosMember ?? []).length}`);

    // Que un Admin tampoco lea es intencional: es una cola interna. Si alguien
    // "arregla" esto agregando una policy, este caso lo frena.
    const { data: vistosAdmin } = await admin.client.from("scheduled_jobs").select("id");
    check((vistosAdmin ?? []).length === 0,
      "un Admin tampoco: la cola no es una pantalla", `vio ${(vistosAdmin ?? []).length}`);

    const { data: insertado } = await member.client.from("scheduled_jobs")
      .insert({ type: "zz_intruso", payload: {}, run_at: new Date().toISOString() })
      .select("id");
    check((insertado ?? []).length === 0, "un Member no puede encolar trabajo");

    // El UPDATE abierto permitia colgar todos los flows con una espera.
    await member.client.from("scheduled_jobs").update({ status: "completed" }).eq("id", job.id);
    const { data: sigue } = await svc.from("scheduled_jobs")
      .select("status").eq("id", job.id).single();
    check(sigue.status === "pending",
      "ni marcar como completados los jobs pendientes", `quedo en ${sigue.status}`);

    await svc.from("scheduled_jobs").delete().eq("id", job.id); }


  console.log("\n— find_or_link_contact es solo del service role —");
  { const args = {
      p_channel_id: ch.id,
      p_sender_id: `zz-intruso-${Date.now()}`,
      p_display_name: "zz intruso",
      p_username: null, p_avatar_url: null, p_phone: null, p_email: null,
      p_interaction_at: new Date().toISOString(),
      p_stamp_existing: false,
    };

    const { error: eMember } = await member.client.rpc("find_or_link_contact", args);
    check(!!eMember, "un Member no puede crear contactos por RPC directo");

    // Que un Admin tampoco pueda es a proposito: el acceso admin se ejerce por
    // las rutas, que validan el rol y despues usan service client.
    const { error: eAdmin } = await admin.client.rpc("find_or_link_contact", args);
    check(!!eAdmin, "un Admin tampoco: pasa por las rutas, no por la RPC");

    // Y que el service SI pueda, para que un revoke de mas no deje el backfill
    // del Inbox fallando en silencio.
    const { data: creado, error: eSvc } = await svc.rpc("find_or_link_contact", args);
    check(!eSvc && !!creado?.contact_id,
      "el service role si puede: el backfill del Inbox sigue andando", eSvc?.message);
    if (creado?.contact_id) await svc.from("contacts").delete().eq("id", creado.contact_id); }

  console.log("\n— Base de conocimiento (00049) —");
  { const { data: doc } = await svc.from("knowledge_base").insert({
      workspace_id: ws.id, title: "zz-test documento", status: "ready",
      content_md: "El plan avanzado cuesta 1200 dolares.", chunk_count: 1,
    }).select("id").single();

    // Un embedding cualquiera de la dimension correcta.
    const embedding = `[${Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    const { error: eChunk } = await svc.from("knowledge_chunks").insert({
      workspace_id: ws.id, document_id: doc.id, chunk_index: 0,
      content: "El plan avanzado cuesta 1200 dolares.", embedding,
    });
    check(!eChunk, "el service role puede indexar fragmentos", eChunk?.message);

    // La KB es conocimiento del negocio, no de un lead: todo el equipo la lee.
    check((await sees(member, "knowledge_base", doc.id)).seen,
      "un Member LEE la base de conocimiento");
    check((await sees(admin, "knowledge_base", doc.id)).seen,
      "un Admin LEE la base de conocimiento");

    // Pero solo Owner/Admin la gestionan.
    const { error: eIns } = await member.client.from("knowledge_base")
      .insert({ workspace_id: ws.id, title: "zz-test intruso", status: "ready" });
    check(!!eIns, "un Member NO puede crear documentos");

    const { data: upd } = await member.client.from("knowledge_base")
      .update({ title: "pisado por un member" }).eq("id", doc.id).select("id");
    check(!upd || upd.length === 0, "un Member NO puede editar documentos");

    const { data: del } = await member.client.from("knowledge_base")
      .delete().eq("id", doc.id).select("id");
    check(!del || del.length === 0, "un Member NO puede borrar documentos");

    // Los fragmentos no los escribe nadie a mano, ni un Admin.
    const { error: eChunkAdmin } = await admin.client.from("knowledge_chunks").insert({
      workspace_id: ws.id, document_id: doc.id, chunk_index: 99,
      content: "inyectado", embedding,
    });
    check(!!eChunkAdmin, "ni un Admin puede escribir un fragmento a mano");

    // La busqueda semantica exige pertenecer al workspace.
    const { error: eBusca } = await member.client.rpc("match_knowledge_chunks", {
      p_workspace_id: ws.id, p_query_embedding: embedding, p_match_count: 5, p_min_similarity: 0,
    });
    check(!eBusca, "un miembro del workspace puede buscar en la KB", eBusca?.message);

    const { error: eAjeno } = await member.client.rpc("match_knowledge_chunks", {
      p_workspace_id: randomUUID(), p_query_embedding: embedding, p_match_count: 5, p_min_similarity: 0,
    });
    check(!!eAjeno, "buscar en la KB de OTRO workspace se rechaza");

    // Cascade: borrar el documento se lleva los fragmentos.
    await svc.from("knowledge_base").delete().eq("id", doc.id);
    const { data: huerfanos } = await svc.from("knowledge_chunks")
      .select("id").eq("document_id", doc.id);
    check((huerfanos ?? []).length === 0, "borrar el documento se lleva sus fragmentos"); }

  console.log("\n— Notificaciones y scope (00051) —");
  { // Una del workspace, sin destinatario: es para los admins.
    const { data: nAdmin } = await svc.from("notifications").insert({
      workspace_id: ws.id, type: "channel_disconnected",
      title: "zz-test canal caido", entity_type: "channel", entity_id: ch.id,
    }).select("id").single();

    check((await sees(admin, "notifications", nAdmin.id)).seen,
      "un Admin VE las notificaciones del workspace");
    check(!(await sees(member, "notifications", nAdmin.id)).seen,
      "un Member NO ve un aviso de administracion (canal caido)");

    // Una dirigida al Member: la ve aunque no sea de un lead suyo.
    const { data: nSuya } = await svc.from("notifications").insert({
      workspace_id: ws.id, type: "human_takeover", title: "zz-test para el member",
      recipient_id: member.id,
    }).select("id").single();
    check((await sees(member, "notifications", nSuya.id)).seen,
      "un Member VE las dirigidas a el");

    // Y el scope de leads: una que apunta a una conversacion que NO le toca.
    await setFlags(ws.id, { lead_scope_enabled: true, unassigned_leads_visible_to_members: false });
    await svc.from("conversations").update({ assigned_to: admin.id }).eq("id", conv.id);

    const { data: nAjena } = await svc.from("notifications").insert({
      workspace_id: ws.id, type: "human_takeover", title: "zz-test lead ajeno",
      entity_type: "conversation", entity_id: conv.id,
    }).select("id").single();
    check(!(await sees(member, "notifications", nAjena.id)).seen,
      "un Member NO ve el aviso de un lead que no le corresponde");

    // La misma notificacion, con la conversacion asignada a el: ahora si.
    await svc.from("conversations").update({ assigned_to: member.id }).eq("id", conv.id);
    check((await sees(member, "notifications", nAjena.id)).seen,
      "y SI la ve cuando la conversacion pasa a ser suya");

    // Marcar leido es lo unico que se puede hacer.
    const { data: leida } = await admin.client.from("notifications")
      .update({ read_at: new Date().toISOString() }).eq("id", nAdmin.id).select("id");
    check((leida ?? []).length === 1, "un Admin puede marcar leido");

    // Nadie inserta a mano: si pudiera, le fabricaria un aviso a otro.
    const { error: eFalso } = await admin.client.from("notifications").insert({
      workspace_id: ws.id, type: "human_takeover", title: "zz-test fabricado",
    });
    check(!!eFalso, "ni un Admin puede crear notificaciones a mano");

    await setFlags(ws.id, { lead_scope_enabled: false });
    await svc.from("notifications").delete().eq("workspace_id", ws.id); }

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
  if (!(await runCleanup(svc))) failures++;
}
console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
