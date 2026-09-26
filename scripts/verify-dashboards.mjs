#!/usr/bin/env node
/**
 * Verificación de las funciones de métricas del dashboard de Chat (Bloque 3, F15).
 *
 * Corre contra la base real. Crea un workspace con Owner, Member A y Member B,
 * un agente, un canal y 6 conversaciones con mensajes en fechas fijas, llama a
 * las funciones SQL reales y compara contra los valores calculados a mano. El
 * Member A tiene scope sobre las conversaciones 1 y 3. Limpia todo al terminar;
 * una limpieza fallida es una falla.
 *
 *   node scripts/verify-dashboards.mjs
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
const eq = (got, want, m) => check(String(got) === String(want), m, `esperaba ${want}, obtuve ${got}`);

async function makeUser(tag) {
  const email = `zz-test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

const D = (day, h, m, s) => `2026-09-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.000Z`;

try {
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-dash", slug: `zz-test-dash-${Date.now()}`, lead_scope_enabled: true, unassigned_leads_visible_to_members: false })
    .select("id").single();

  const owner = await makeUser("dash-owner");
  const memberA = await makeUser("dash-mema");
  const memberB = await makeUser("dash-memb");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: memberA.id, role: "member" },
    { workspace_id: ws.id, user_id: memberB.id, role: "member" },
  ]);

  const { data: ch } = await svc.from("channels").insert({
    workspace_id: ws.id, platform: "instagram", late_account_id: `zz-test-${Date.now()}`,
    username: "zztestdash", display_name: "zz dash", is_active: true,
  }).select("id").single();

  const { data: agent } = await svc.from("agents").insert({
    workspace_id: ws.id, name: "zz-test agente", type: "chat", is_enabled: false,
    close_after_inactive_hours: 12,
  }).select("id").single();

  // 6 contactos; Member A es setter de los de las conversaciones 1 y 3.
  const contactRows = [];
  for (let i = 1; i <= 6; i++) {
    contactRows.push({
      workspace_id: ws.id, display_name: `zz-test c${i}`,
      setter_id: i === 1 || i === 3 ? memberA.id : null,
    });
  }
  const { data: contacts } = await svc.from("contacts").insert(contactRows).select("id");

  // 6 conversaciones.
  const convRows = contacts.map((c, idx) => ({
    workspace_id: ws.id, channel_id: ch.id, contact_id: c.id, platform: "instagram",
    status: "open", late_conversation_id: `zz-lc-${idx}`,
    created_at: D(idx + 5, 14, 0, 0),
  }));
  const { data: convs } = await svc.from("conversations").insert(convRows).select("id");
  const cv = (n) => convs[n - 1].id;

  // Mensajes. origin explícito; el trigger completa workspace_id.
  const msg = (conv, dir, origin, day, h, m, s, extra = {}) => ({
    conversation_id: conv, direction: dir, text: "x", origin: dir === "inbound" ? null : origin,
    status: dir === "inbound" ? "delivered" : "sent", created_at: D(day, h, m, s), ...extra,
  });
  await svc.from("messages").insert([
    // Conv1: agente toma (30 s), luego escala a Member A.
    msg(cv(1), "inbound", null, 5, 15, 0, 0),
    msg(cv(1), "outbound", "agent", 5, 15, 0, 30, { sent_by_agent_id: agent.id }),
    // Conv2: ManyChat (external) a los 2 s.
    msg(cv(2), "inbound", null, 6, 15, 0, 0),
    msg(cv(2), "outbound", "external", 6, 15, 0, 2),
    // Conv3: Member B responde a los 300 s.
    msg(cv(3), "inbound", null, 7, 15, 0, 0),
    msg(cv(3), "outbound", "user", 7, 15, 5, 0, { sent_by_user_id: memberB.id }),
    // Conv4: sin respuesta (solo entrante).
    msg(cv(4), "inbound", null, 8, 15, 0, 0),
    // Conv5: borrador aprobado → saliente agente a los 60 s.
    msg(cv(5), "inbound", null, 9, 15, 0, 0),
    msg(cv(5), "outbound", "agent", 9, 15, 1, 0, { sent_by_agent_id: agent.id }),
    // Conv6: respuesta a mano (Member A) a los 120 s.
    msg(cv(6), "inbound", null, 10, 15, 0, 0),
    msg(cv(6), "outbound", "user", 10, 15, 2, 0, { sent_by_user_id: memberA.id }),
  ]);

  // Run escalado en conv1; borradores en conv5 (sent) y conv6 (descartado auto).
  await svc.from("agent_runs").insert({ workspace_id: ws.id, source: "agent", trigger: "inbound_message", agent_id: agent.id, conversation_id: cv(1), status: "escalated", created_at: D(5, 17, 0, 0) });
  await svc.from("agent_drafts").insert([
    { workspace_id: ws.id, agent_id: agent.id, conversation_id: cv(5), contact_id: contacts[4].id, channel_id: ch.id, status: "sent", body: "x", body_parts: ["x"], sent_body: "x", burst_last_inbound_at: D(9, 15, 0, 0) },
    { workspace_id: ws.id, agent_id: agent.id, conversation_id: cv(6), contact_id: contacts[5].id, channel_id: ch.id, status: "discarded", discard_reason: "auto:manual_reply", body: "x", body_parts: ["x"], burst_last_inbound_at: D(10, 15, 0, 0) },
  ]);

  const rpc = (client, fn, args) => client.rpc(fn, args);

  console.log("\n— Números principales (workspace completo) —");
  {
    const { data, error } = await rpc(svc, "chat_dashboard_numbers", { p_workspace_id: ws.id, p_from: null, p_to: null, p_channel: null, p_author: null });
    if (error) fail("chat_dashboard_numbers", error.message);
    else {
      const r = data[0];
      eq(r.new_conversations, 6, "conversaciones nuevas = 6");
      eq(r.messages_in, 6, "mensajes recibidos = 6");
      eq(r.messages_out, 5, "mensajes enviados = 5");
      eq(Math.round(r.first_response_median_seconds), 60, "primera respuesta mediana = 60 s");
    }
  }

  console.log("\n— Filtro 'respondido por' agente —");
  {
    const { data } = await rpc(svc, "chat_dashboard_numbers", { p_workspace_id: ws.id, p_from: null, p_to: null, p_channel: null, p_author: "agent" });
    eq(data[0].messages_out, 2, "salientes del agente = 2 (conv1, conv5)");
  }

  console.log("\n— Esperando respuesta ahora —");
  {
    const { data, error } = await rpc(svc, "chat_waiting_now", { p_workspace_id: ws.id, p_channel: null });
    if (error) fail("chat_waiting_now", error.message);
    else eq(data, 1, "esperando ahora = 1 (conv4)");
  }

  console.log("\n— Sección del agente —");
  {
    const { data, error } = await rpc(svc, "chat_dashboard_agent", { p_workspace_id: ws.id, p_from: null, p_to: null, p_channel: null });
    if (error) fail("chat_dashboard_agent", error.message);
    else {
      const r = data[0];
      eq(r.new_conversations, 6, "conversaciones nuevas = 6");
      eq(r.agent_took_first, 2, "tomó desde el primer mensaje = 2 (conv1, conv5)");
      eq(r.agent_acted, 3, "actuó = 3 (conv1, conv5, conv6)");
      eq(r.agent_escalated, 1, "derivó = 1 (conv1)");
    }
  }

  console.log("\n— Tabla 'Quién responde' —");
  {
    const { data, error } = await rpc(svc, "chat_dashboard_team", { p_workspace_id: ws.id, p_from: null, p_to: null, p_channel: null });
    if (error) fail("chat_dashboard_team", error.message);
    else {
      const byAuthor = Object.fromEntries(data.map((r) => [r.author, r]));
      eq(byAuthor["agent"]?.messages_out, 2, "agente: 2 salientes");
      eq(Math.round(byAuthor["agent"]?.reply_median_seconds), 45, "agente: mediana de respuesta 45 s");
      eq(byAuthor["external"]?.messages_out, 1, "external: 1 saliente");
      eq(byAuthor[memberB.id]?.messages_out, 1, "Member B: 1 saliente");
      eq(byAuthor[memberA.id]?.messages_out, 1, "Member A: 1 saliente");
    }
  }

  console.log("\n— Scope de leads: Member A ve solo conv 1 y 3 —");
  {
    const { data, error } = await rpc(memberA.client, "chat_dashboard_numbers", { p_workspace_id: ws.id, p_from: null, p_to: null, p_channel: null, p_author: null });
    if (error) fail("Member A chat_dashboard_numbers", error.message);
    else {
      const r = data[0];
      eq(r.new_conversations, 2, "Member A: 2 conversaciones nuevas");
      eq(r.messages_in, 2, "Member A: 2 recibidos");
      eq(r.messages_out, 2, "Member A: 2 enviados (conv1 agente, conv3 Member B)");
      eq(Math.round(r.first_response_median_seconds), 165, "Member A: primera respuesta mediana 165 s (30 y 300)");
    }
  }

  console.log("\n— Patrones: trigger, variantes y emoji (F19) —");
  {
    // Tres variantes del mismo texto → una sola fila en message_texts.
    await svc.from("messages").insert([
      msg(cv(1), "inbound", null, 11, 16, 0, 0, { text: "Sí!!" }),
      msg(cv(1), "inbound", null, 11, 16, 0, 1, { text: "siii" }),
      msg(cv(1), "inbound", null, 11, 16, 0, 2, { text: "SI" }),
      msg(cv(1), "inbound", null, 11, 16, 0, 3, { text: "❤" }),
    ]);
    const { data: si } = await svc.from("message_texts").select("id").eq("workspace_id", ws.id).eq("direction", "inbound").eq("normalized_text", "si");
    eq(si?.length, 1, "las tres variantes (Sí!!/siii/SI) son una sola fila 'si'");
    const { data: emoji } = await svc.from("message_texts")
      .select("category_id, source").eq("workspace_id", ws.id).eq("normalized_text", "").maybeSingle();
    check(emoji?.source === "rule", "el emoji quedó con source rule");
    const { data: emojiCat } = await svc.from("message_categories").select("name").eq("id", emoji?.category_id).maybeSingle();
    check(emojiCat?.name === "Solo emoji o adjunto", "el emoji fue a 'Solo emoji o adjunto'");
    // (Los 12 textos de botón se siembran en la migración sobre el workspace real;
    // verificado por SQL aparte. Un workspace de prueba nuevo no los recibe.)
  }

  console.log("\n— normalize_for_grouping (paridad con la app) —");
  {
    const cases = [["Sí!!", "si"], ["siii", "si"], ["Siii quiero a clase", "si quiero a clase"], ["❤", ""]];
    for (const [input, want] of cases) {
      const { data } = await rpc(svc, "normalize_for_grouping", { p_raw: input });
      eq(data, want, `normalize(${JSON.stringify(input)}) = ${JSON.stringify(want)}`);
    }
  }
} catch (err) {
  fail("excepción no esperada", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}

process.exitCode = failures ? 1 : 0;
console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
