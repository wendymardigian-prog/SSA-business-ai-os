#!/usr/bin/env node
/**
 * Verificacion de los contactos sin identificar (00296, 00298).
 *
 * Corre contra la base real. Prueba lo que Vitest NO puede probar: que la BASE
 * haga lo que dice
 *   - un id como nombre, sin ningun dato, es anonimo si nunca escribio; con un dato
 *     o al escribir deja de serlo;
 *   - el eco de ManyChat no dispara "contacto creado"; cuando la persona se
 *     identifica se dispara una sola vez, en el MISMO contacto y con sus toques;
 *   - `contact_wrote_at` lo llena un mensaje entrante, no uno saliente, y tambien
 *     al mover un mensaje de conversacion (la fusion de contactos);
 *   - `conversation_is_silent_outreach` oculta solo a quien no se sabe quien es y
 *     nunca escribio, y un usuario con sesion lo puede filtrar.
 *
 * Crea y borra todo lo suyo (prefijo zz-test-). No se corre a la vez que otro
 * verify-*: comparten prefijo. Tomar el candado /private/tmp/ssa-verify.lock.
 *
 *   node scripts/verify-unidentified-contacts.mjs
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
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-unidentified", slug: `zz-test-unidentified-${stamp}` }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);
  const { data: ch, error: chErr } = await svc.from("channels").insert({
    workspace_id: ws.id, platform: "instagram", late_account_id: `zz-un-${stamp}`, username: "zzun", display_name: "zz un", is_active: true,
  }).select("id").single();
  if (chErr) throw new Error(`no pude crear el canal: ${chErr.message}`);

  const link = async (sender, name = null, username = null, stampExisting = true) => {
    const { data, error } = await svc.rpc("find_or_link_contact", {
      p_channel_id: ch.id, p_sender_id: sender, p_display_name: name, p_username: username, p_stamp_existing: stampExisting,
    });
    if (error) throw new Error(`find_or_link_contact: ${error.message}`);
    return data.contact_id;
  };
  const contact = async (id) => (await svc.from("contacts").select("display_name, instagram_username, is_anonymous").eq("id", id).single()).data;
  const createdEvents = async (id) => (await svc.from("automation_events").select("id").eq("contact_id", id).eq("event_type", "contact_created")).data?.length ?? 0;
  const conversation = async (contactId) => {
    const { data, error } = await svc.from("conversations").insert({ workspace_id: ws.id, channel_id: ch.id, contact_id: contactId, platform: "instagram", status: "open" }).select("id").single();
    if (error) throw new Error(`no pude crear la conversacion: ${error.message}`);
    return data.id;
  };
  const message = async (conversationId, direction) => {
    const { data, error } = await svc.from("messages").insert({
      conversation_id: conversationId, direction, text: direction === "inbound" ? "hola" : null, status: direction === "inbound" ? "delivered" : "sent",
      ...(direction === "outbound" ? { origin: "external" } : {}),
    }).select("id, created_at").single();
    if (error) throw new Error(`no pude crear el mensaje: ${error.message}`);
    return data;
  };
  const silent = async (conversationId) => (await svc.from("conversations").select("id").eq("id", conversationId).filter("conversation_is_silent_outreach", "eq", true)).data?.length === 1;
  const wroteAt = async (conversationId) => (await svc.from("conversations").select("contact_wrote_at").eq("id", conversationId).single()).data?.contact_wrote_at;

  // -------------------------------------------------------------------------
  console.log("\n1. El eco de ManyChat: oculto y sin eventos");
  const sender = `9${String(stamp).slice(-13)}`;
  const ghost = await link(sender, sender, null, false);
  check((await contact(ghost)).is_anonymous === true, "un id como nombre, sin ningun dato, es anonimo");
  check((await createdEvents(ghost)) === 0, "no dispara «contacto creado»");
  const conv = await conversation(ghost);
  await message(conv, "outbound");
  check(await silent(conv), "con un saliente, la conversacion queda oculta");
  check((await wroteAt(conv)) === null, "un mensaje saliente no cuenta como que escribio");

  // -------------------------------------------------------------------------
  console.log("\n2. La persona escribe y se identifica");
  const toque = await svc.rpc("record_contact_touch", {
    p_workspace_id: ws.id, p_contact_id: ghost,
    p_touch: { origin: "dm", medium: "dm_external", source: "instagram", occurred_at: new Date().toISOString(), dedupe_key: `zz-test-${stamp}` },
  });
  if (toque.error) throw new Error(`record_contact_touch: ${toque.error.message}`);
  const inbound = await message(conv, "inbound");
  check(new Date(await wroteAt(conv)).getTime() === new Date(inbound.created_at).getTime(), "el mensaje entrante anota cuando escribio");
  check(!(await silent(conv)), "la conversacion deja de estar oculta, aunque todavia no se sepa quien es");
  const wrote = await contact(ghost);
  check(wrote.is_anonymous === false, "al escribir deja de estar oculto en Contactos, aunque todavia no tenga datos", JSON.stringify(wrote));
  check((await createdEvents(ghost)) === 1, "y ahi se dispara «contacto creado»");
  const same = await link(sender, "Ana Prueba", `zz.test.${stamp}`);
  check(same === ghost, "sigue siendo el mismo contacto");
  const identified = await contact(ghost);
  check(identified.is_anonymous === false && identified.display_name === "Ana Prueba", "con sus datos se completa el mismo contacto", JSON.stringify(identified));
  check((await createdEvents(ghost)) === 1, "cuando llegan sus datos no se vuelve a disparar");
  const touches = (await svc.from("contact_touches").select("medium").eq("contact_id", ghost)).data ?? [];
  check(touches.some((t) => t.medium === "dm_external"), "el toque de antes de identificarse se conserva");

  // -------------------------------------------------------------------------
  console.log("\n3. Lo que no se oculta");
  const named = await link(`8${String(stamp).slice(-13)}`, "Con Nombre", null, false);
  const namedConv = await conversation(named);
  await message(namedConv, "outbound");
  check(!(await silent(namedConv)), "quien tiene un nombre de verdad no se oculta, aunque nunca haya escrito");
  const { data: withPhone } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "5491100000000", phone: `+54911${String(stamp).slice(-8)}` }).select("is_anonymous").single();
  check(withPhone?.is_anonymous === false, "un numero como nombre con telefono no es anonimo");
  const { data: shortName } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "1234567", email: null }).select("is_anonymous").single();
  check(shortName?.is_anonymous === false, "un numero corto no cuenta como id");

  const { data: platformName } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "Instagram User", first_inbound_at: new Date().toISOString() }).select("is_anonymous").single();
  check(platformName?.is_anonymous === true, "«Instagram User» sigue oculto aunque haya escrito: no dice quien es");

  // -------------------------------------------------------------------------
  console.log("\n4. Mover un mensaje de conversacion (la fusion)");
  const a = await link(`7${String(stamp).slice(-13)}`, `7${String(stamp).slice(-13)}`, null, false);
  const convA = await conversation(a);
  const b = await link(`6${String(stamp).slice(-13)}`, `6${String(stamp).slice(-13)}`, null, false);
  const convB = await conversation(b);
  const moved = await message(convB, "inbound");
  check((await wroteAt(convA)) === null, "antes de mover, la otra conversacion no tiene el dato");
  await svc.from("messages").update({ conversation_id: convA }).eq("id", moved.id);
  check((await wroteAt(convA)) !== null, "al mover un mensaje entrante, la conversacion que lo recibe se entera");
  check((await contact(a)).is_anonymous === false, "y su contacto deja de estar oculto");
  const c3 = await link(`4${String(stamp).slice(-13)}`, `4${String(stamp).slice(-13)}`, null, false);
  const c4 = await link(`3${String(stamp).slice(-13)}`, `3${String(stamp).slice(-13)}`, null, false);
  const convC4 = await conversation(c4);
  await message(convC4, "inbound");
  await svc.from("conversations").update({ contact_id: c3 }).eq("id", convC4);
  check((await contact(c3)).is_anonymous === false, "una conversacion que cambia de contacto le lleva que la persona escribio");

  // -------------------------------------------------------------------------
  console.log("\n5. Con sesion, como la bandeja");
  const email = `zz-test-unidentified-${stamp}@example.test`;
  const password = randomUUID();
  const { data: u, error: uErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (uErr) throw new Error(`no pude crear usuario: ${uErr.message}`);
  await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: u.user.id, role: "owner" });
  const user = createClient(URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await user.auth.signInWithPassword({ email, password });
  const hiddenGhost = await link(`5${String(stamp).slice(-13)}`, `5${String(stamp).slice(-13)}`, null, false);
  const hiddenConv = await conversation(hiddenGhost);
  const list = await user.from("conversations").select("id, contacts!inner(id)").eq("workspace_id", ws.id).filter("conversation_is_silent_outreach", "eq", false);
  check(!list.error, "el Owner filtra por el campo calculado con su sesion", list.error?.message);
  check(!(list.data ?? []).some((c) => c.id === hiddenConv), "la lista por defecto no la trae");
  const only = await user.from("conversations").select("id").eq("workspace_id", ws.id).is("contact_wrote_at", null).filter("conversation_is_silent_outreach", "eq", true);
  check((only.data ?? []).some((c) => c.id === hiddenConv), "el filtro «Sin identificar» si la trae");
  const anon = createClient(URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const denied = await anon.from("conversations").select("id").filter("conversation_is_silent_outreach", "eq", true).limit(1);
  check(Boolean(denied.error) || (denied.data ?? []).length === 0, "sin sesion no se ve nada");
} catch (err) {
  fail("la verificacion se corto", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\nLimpieza");
  await runCleanup(svc);
}

console.log(failures === 0 ? "\nTodo en verde." : `\n${failures} comprobacion(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
