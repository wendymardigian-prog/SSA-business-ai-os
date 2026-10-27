#!/usr/bin/env node
/**
 * Verificacion de "esperando respuesta", "no necesita respuesta", el tiempo de
 * respuesta humano y los borradores vencidos (00259, 00260, 00261).
 *
 * Corre contra la base real. Prueba lo que Vitest NO puede probar: que la BASE
 * haga lo que dice
 *   - las gemelas SQL dan lo mismo que TypeScript sobre los casos compartidos
 *     (chat_is_closure_message <-> closure.cases.json, chat_reply_is_human <->
 *     reply-time.cases.json);
 *   - el trigger de messages mantiene awaiting_*, reply_window_until y la marca
 *     de la regla: un "gracias" se marca, una respuesta limpia, un envio fallido
 *     no cuenta, un mensaje nuevo borra la marca;
 *   - set_conversation_no_reply respeta "el lead no volvio a escribir" y no la
 *     puede llamar un usuario con sesion;
 *   - chat_waiting_now_v2 cuenta las tres partes (se puede responder / ventana
 *     vencida / no necesita respuesta);
 *   - chat_dashboard_response_time cuenta solo las respuestas humanas, desde el
 *     primer mensaje sin responder;
 *   - el barrido de borradores pasa a 'expired' un borrador con la ventana cerrada.
 *
 * Crea y borra todo lo suyo (prefijo zz-test-). No se corre a la vez que otro
 * verify-*: comparten prefijo. Tomar el candado /private/tmp/ssa-verify.lock.
 *
 *   node scripts/verify-chat-awaiting.mjs
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
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();

function sql(query) {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).rows ?? [];
}

const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
// Una sola hora de referencia: si cada fecha tomara su propio "ahora", las
// diferencias saldrian corridas por los milisegundos entre una y otra.
const BASE = Date.now();
const minutesAgo = (m) => new Date(BASE - m * 60_000).toISOString();

// ---------------------------------------------------------------------------
console.log("\n1. Las gemelas SQL dan lo mismo que TypeScript");
{
  const closure = JSON.parse(readFileSync("lib/messages/closure.cases.json", "utf8")).cases;
  const values = closure.map((c) => {
    const att = c.attachments?.length ? `${lit(JSON.stringify({ v: 2, items: c.attachments.map((kind) => ({ kind })) }))}::jsonb` : "NULL::jsonb";
    return `(${lit(c.name)}, ${lit(c.text)}, ${att}, ${lit(c.lastReply)}, ${c.expected})`;
  });
  const rows = sql(`SELECT name FROM (VALUES ${values.join(",")}) AS t(name, txt, att, lr, exp) WHERE public.chat_is_closure_message(txt, att, lr) IS DISTINCT FROM exp`);
  check(rows.length === 0, `chat_is_closure_message: los ${closure.length} casos dan igual`, rows.map((r) => r.name).join(", "));

  const human = JSON.parse(readFileSync("lib/messages/reply-time.cases.json", "utf8")).cases;
  const hv = human.map((c) => `(${lit(c.name)}, ${lit(c.origin)}, ${c.sentByUserId ? `${lit(c.sentByUserId)}::uuid` : "NULL::uuid"}, ${c.seconds}, ${c.expected})`);
  const hrows = sql(`SELECT name FROM (VALUES ${hv.join(",")}) AS t(name, o, u, s, exp) WHERE public.chat_reply_is_human(o, u, s) IS DISTINCT FROM exp`);
  check(hrows.length === 0, `chat_reply_is_human: los ${human.length} casos dan igual`, hrows.map((r) => r.name).join(", "));
}

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-awaiting", slug: `zz-test-awaiting-${stamp}` }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);

  const channel = async (platform, suf) => {
    const { data, error } = await svc.from("channels").insert({
      workspace_id: ws.id, platform, late_account_id: `zz-${suf}-${stamp}`, username: `zz${suf}`, display_name: `zz ${suf}`, is_active: true,
    }).select("id").single();
    if (error) throw new Error(`no pude crear el canal: ${error.message}`);
    return data.id;
  };
  const ig = await channel("instagram", "aw-ig");
  const wa = await channel("whatsapp", "aw-wa");

  const conversation = async (channelId, platform) => {
    const { data: contact, error: cErr } = await svc.from("contacts")
      .insert({ workspace_id: ws.id, display_name: `zz-test ${randomUUID().slice(0, 6)}`, email: `zz-test-${randomUUID().slice(0, 8)}@example.test` })
      .select("id").single();
    if (cErr) throw new Error(`no pude crear el contacto: ${cErr.message}`);
    const { data, error } = await svc.from("conversations")
      .insert({ workspace_id: ws.id, channel_id: channelId, contact_id: contact.id, platform, status: "open" })
      .select("id, contact_id").single();
    if (error) throw new Error(`no pude crear la conversacion: ${error.message}`);
    return data;
  };
  const message = async (conversationId, direction, text, createdAt, extra = {}) => {
    const { data, error } = await svc.from("messages").insert({
      conversation_id: conversationId, direction, text, created_at: createdAt, status: direction === "outbound" ? "sent" : "delivered",
      ...(direction === "outbound" ? { origin: "user" } : {}), ...extra,
    }).select("id").single();
    if (error) throw new Error(`no pude guardar el mensaje: ${error.message}`);
    return data.id;
  };
  const state = async (id) => (await svc.from("conversations")
    .select("awaiting_reply_since, awaiting_last_inbound_at, reply_window_until, no_reply_needed_at, no_reply_needed_reason")
    .eq("id", id).single()).data;
  const same = (a, b) => a && b && new Date(a).getTime() === new Date(b).getTime();

  // -------------------------------------------------------------------------
  console.log("\n2. El trigger de messages mantiene el estado");
  const a = await conversation(ig, "instagram");
  const t180 = minutesAgo(180);
  await message(a.id, "inbound", "hola, cuánto sale?", t180);
  let s = await state(a.id);
  check(same(s.awaiting_reply_since, t180) && same(s.awaiting_last_inbound_at, t180), "un mensaje del lead: espera desde ese mensaje");
  check(same(s.reply_window_until, new Date(new Date(t180).getTime() + 24 * 3_600_000).toISOString()), "Instagram: la ventana es el ultimo mensaje + 24 h");
  check(!s.no_reply_needed_at, "una pregunta no se marca como cerrada");

  await message(a.id, "outbound", "esto no salio", minutesAgo(125), { status: "failed" });
  s = await state(a.id);
  check(same(s.awaiting_reply_since, t180), "un envio fallido no cuenta como respuesta");

  await message(a.id, "outbound", "Sale 100 dolares", minutesAgo(120));
  s = await state(a.id);
  check(s.awaiting_reply_since === null && s.awaiting_last_inbound_at === null && s.reply_window_until === null, "una respuesta limpia la espera");

  const t90 = minutesAgo(90);
  await message(a.id, "inbound", "Genial, muchas gracias 🙌", t90);
  s = await state(a.id);
  check(same(s.awaiting_last_inbound_at, t90) && s.no_reply_needed_reason === "rule", "un gracias queda marcado por la regla", JSON.stringify(s));

  const waiting1 = sql(`SELECT * FROM public.chat_waiting_now_v2(${lit(ws.id)}, NULL)`)[0];
  check(Number(waiting1.no_reply_needed) === 1 && Number(waiting1.can_reply) === 0, "el contador lo pone en 'no necesita respuesta'", JSON.stringify(waiting1));

  // -------------------------------------------------------------------------
  console.log("\n3. Marcar y desmarcar");
  const undo = await svc.rpc("set_conversation_no_reply", { p_conversation_id: a.id, p_needed: true, p_reason: "manual" });
  s = await state(a.id);
  check(!undo.error && undo.data === true && s.no_reply_needed_at === null, "'Si necesita respuesta' saca la marca de la regla");
  const waiting2 = sql(`SELECT * FROM public.chat_waiting_now_v2(${lit(ws.id)}, NULL)`)[0];
  check(Number(waiting2.can_reply) === 1 && Number(waiting2.no_reply_needed) === 0, "y vuelve a contar como esperando", JSON.stringify(waiting2));

  const stale = await svc.rpc("set_conversation_no_reply", {
    p_conversation_id: a.id, p_needed: false, p_reason: "agent", p_expected_last_inbound_at: minutesAgo(500),
  });
  check(!stale.error && stale.data === false, "con un 'ultimo mensaje' que ya no es el ultimo, no marca");
  const fresh = await svc.rpc("set_conversation_no_reply", {
    p_conversation_id: a.id, p_needed: false, p_reason: "agent", p_expected_last_inbound_at: s.awaiting_last_inbound_at,
  });
  s = await state(a.id);
  check(!fresh.error && fresh.data === true && s.no_reply_needed_reason === "agent", "con el ultimo mensaje correcto, marca (agente)");

  const bad = await svc.rpc("set_conversation_no_reply", { p_conversation_id: a.id, p_needed: false, p_reason: "rule" });
  check(Boolean(bad.error), "el motivo 'rule' no se puede poner a mano");

  const t80 = minutesAgo(80);
  await message(a.id, "inbound", "y tienen cuotas?", t80);
  s = await state(a.id);
  check(s.no_reply_needed_at === null && same(s.awaiting_reply_since, t90) && same(s.awaiting_last_inbound_at, t80),
    "un mensaje nuevo borra la marca; la espera sigue contando desde el primero sin responder", JSON.stringify(s));

  // -------------------------------------------------------------------------
  console.log("\n4. Ventana vencida y canal sin ventana");
  const b = await conversation(ig, "instagram");
  await message(b.id, "inbound", "hola, me pasas info", minutesAgo(30 * 60));
  const c = await conversation(wa, "whatsapp");
  await message(c.id, "inbound", "hola, me pasas info", minutesAgo(50 * 60));
  s = await state(c.id);
  check(s.awaiting_last_inbound_at !== null && s.reply_window_until === null, "WhatsApp (Evolution) no tiene ventana");
  const waiting3 = sql(`SELECT * FROM public.chat_waiting_now_v2(${lit(ws.id)}, NULL)`)[0];
  check(Number(waiting3.can_reply) === 2 && Number(waiting3.window_closed) === 1, "2 se pueden responder (Instagram reciente y WhatsApp) y 1 tiene la ventana vencida", JSON.stringify(waiting3));
  const onlyIg = sql(`SELECT * FROM public.chat_waiting_now_v2(${lit(ws.id)}, 'instagram')`)[0];
  check(Number(onlyIg.can_reply) === 1 && Number(onlyIg.window_closed) === 1, "el filtro de canal se respeta", JSON.stringify(onlyIg));

  // -------------------------------------------------------------------------
  console.log("\n5. Tiempo de respuesta: solo personas, desde el primer mensaje sin responder");
  const d = await conversation(ig, "instagram");
  await message(d.id, "inbound", "Si enviamelo!", minutesAgo(60));
  await message(d.id, "outbound", null, new Date(BASE - 60 * 60_000 + 2000).toISOString(), { origin: "external" });
  const resp = sql(`SELECT * FROM public.chat_dashboard_response_time(${lit(ws.id)}, ${lit(minutesAgo(24 * 60))}, ${lit(new Date().toISOString())}, NULL, NULL)`)[0];
  // Conversacion a: 180 min -> 120 min (persona, 3600 s). La respuesta automatica de d (2 s) no cuenta.
  check(Number(resp.turns) === 1 && Math.round(Number(resp.avg_seconds)) === 3600, "una sola espera humana, de 1 hora; el bot de 2 s no cuenta", JSON.stringify(resp));
  const auto = sql(`SELECT count(*) n FROM public.chat_response_turns(${lit(ws.id)}, NULL) WHERE conversation_id = ${lit(d.id)} AND is_human = false`)[0];
  check(Number(auto.n) === 1, "la respuesta de otra herramienta en 2 s queda como automatica");

  // -------------------------------------------------------------------------
  console.log("\n6. Borradores vencidos");
  const { data: draft, error: dErr } = await svc.from("agent_drafts").insert({
    workspace_id: ws.id, conversation_id: b.id, contact_id: b.contact_id, channel_id: ig, status: "pending",
    body: "zz-test respuesta", burst_last_inbound_at: minutesAgo(30 * 60), sendable_until: minutesAgo(6 * 60),
  }).select("id").single();
  if (dErr) throw new Error(`no pude crear el borrador: ${dErr.message}`);
  sql("SELECT private.sweep_agent_drafts()");
  const { data: swept } = await svc.from("agent_drafts").select("status, window_missed_at, decided_at").eq("id", draft.id).single();
  check(swept.status === "expired" && swept.window_missed_at && swept.decided_at, "el barrido pasa a 'expired' un borrador con la ventana cerrada", JSON.stringify(swept));

  // -------------------------------------------------------------------------
  console.log("\n7. Permisos");
  const email = `zz-test-awaiting-${stamp}@example.test`;
  const password = randomUUID();
  const { data: u, error: uErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (uErr) throw new Error(`no pude crear usuario: ${uErr.message}`);
  await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: u.user.id, role: "owner" });
  const user = createClient(URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await user.auth.signInWithPassword({ email, password });
  const denied = await user.rpc("set_conversation_no_reply", { p_conversation_id: a.id, p_needed: false, p_reason: "manual" });
  check(Boolean(denied.error), "un usuario con sesion no puede llamar a set_conversation_no_reply (solo el servidor)");
  const visible = await user.rpc("chat_waiting_now_v2", { p_workspace_id: ws.id, p_channel: null });
  check(!visible.error && Number(visible.data?.[0]?.can_reply) === 2, "el Owner lee el contador con su sesion", visible.error?.message);
} catch (err) {
  fail("la verificacion se corto", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\nLimpieza");
  await runCleanup(svc);
}

console.log(failures === 0 ? "\nTodo en verde." : `\n${failures} comprobacion(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
