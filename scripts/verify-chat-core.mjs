#!/usr/bin/env node
/**
 * El dashboard de Chat rapido (00305) da lo mismo que el de antes, para cada rol.
 *
 * Las funciones nuevas son SECURITY DEFINER: leen sin la RLS de cada mensaje y aplican
 * la regla a mano. Un error ahi muestra datos de mas o de menos sin que nada falle.
 * Por eso se comparan contra las funciones viejas, que siguen pasando por la RLS, con
 * usuarios de verdad: Owner, dos Member, un rol que ve una sola cuenta y alguien de otro
 * negocio.
 *
 * Con `--carga` mide ademas a un Member con muchas conversaciones (N = 2000 por defecto:
 * `--carga=500`), el peor caso: el permiso corre por cada conversacion.
 *
 * Crea y limpia sus datos (prefijo `zz-test-`). Corre contra la base de `.env`, de a un
 * verify por vez y con el candado `/private/tmp/ssa-verify.lock`.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const cargaArg = process.argv.find((a) => a.startsWith("--carga"));
const CARGA = cargaArg ? Number(cargaArg.split("=")[1] ?? 2000) : 0;

let failures = 0;
let checks = 0;
const ok = (m) => { checks++; console.log("  ok  ", m); };
const fail = (m, extra) => { checks++; console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

/** Lo mismo sin importar el orden de las claves ni si un numero viene como texto. */
function normal(value) {
  if (Array.isArray(value)) return value.map(normal);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, normal(value[k])]));
  }
  if (typeof value === "string" && value !== "" && !Number.isNaN(Number(value)) && !/^[0-9a-f-]{36}$/.test(value) && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return Number(value);
  }
  return value;
}
const same = (a, b) => JSON.stringify(normal(a)) === JSON.stringify(normal(b));
const compare = (got, want, name) => check(same(got, want), name, `viejo ${JSON.stringify(want)}\n        nuevo ${JSON.stringify(got)}`);

async function makeUser(tag) {
  const email = `zz-test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

const D = (day, h, m, s = 0) => `2026-09-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.000Z`;
const TZ = "America/Costa_Rica";

async function rows(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

/** Saca lo que la app no lee y ordena las filas. */
const sortBy = (list, key) => [...(list ?? [])].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
const withoutMedian = (r) => { const { first_response_median_seconds: _m, ...rest } = r; return rest; };

/** Todas las comparaciones de una persona con un juego de filtros. */
async function compareAll(label, client, ws, f) {
  const base = { p_workspace_id: ws, p_from: f.from, p_to: f.to, p_channel: f.channel };
  const prev = { p_workspace_id: ws, p_from: f.prevFrom, p_to: f.prevTo, p_channel: f.channel };
  const core = await rows(client, "chat_dashboard_core", {
    ...base, p_prev_from: f.prevFrom, p_prev_to: f.prevTo, p_author: f.author, p_tz: TZ, p_include_agent: true,
  });

  const [num] = await rows(client, "chat_dashboard_numbers", { ...base, p_author: f.author });
  compare(core.numbers, withoutMedian(num), `${label}: cifras`);
  const [resp] = await rows(client, "chat_dashboard_response_time", { ...base, p_author: f.author });
  compare(core.response, resp, `${label}: tiempo de respuesta`);

  if (f.prevFrom) {
    const [numPrev] = await rows(client, "chat_dashboard_numbers", { ...prev, p_author: f.author });
    compare(core.numbers_prev, withoutMedian(numPrev), `${label}: cifras del periodo anterior`);
    const [respPrev] = await rows(client, "chat_dashboard_response_time", { ...prev, p_author: f.author });
    compare(core.response_prev, respPrev, `${label}: tiempo de respuesta del periodo anterior`);
    const [agentPrev] = await rows(client, "chat_dashboard_agent", prev);
    compare(core.agent_prev, agentPrev, `${label}: agente del periodo anterior`);
  } else {
    check(core.numbers_prev === null && core.response_prev === null && core.agent_prev === null, `${label}: sin periodo anterior, no se compara`);
  }

  compare(core.trends, (await rows(client, "chat_dashboard_trends", { ...base, p_author: f.author, p_tz: TZ })).map(withoutMedian), `${label}: tendencias`);
  compare(core.response_daily, await rows(client, "chat_dashboard_response_time_daily", { ...base, p_author: f.author, p_tz: TZ }), `${label}: tiempo de respuesta por dia`);
  const [agent] = await rows(client, "chat_dashboard_agent", base);
  compare(core.agent, agent, `${label}: agente`);
  compare(core.agent_weekly, await rows(client, "chat_dashboard_agent_weekly", { p_workspace_id: ws, p_channel: f.channel, p_tz: TZ, p_weeks: 8 }), `${label}: agente por semana`);
  compare(sortBy(core.first_responder, "responder"), sortBy(await rows(client, "chat_dashboard_first_responder", base), "responder"), `${label}: quien respondio primero`);

  compare(sortBy(await rows(client, "chat_dashboard_team_v2", base), "author"), sortBy(await rows(client, "chat_dashboard_team", base), "author"), `${label}: quien responde`);

  for (const direction of ["outbound", "inbound"]) {
    const args = { p_workspace_id: ws, p_direction: direction, p_from: f.from, p_to: f.to, p_channel: f.channel, p_author: direction === "outbound" ? f.author : null };
    compare(sortBy(await rows(client, "chat_dashboard_patterns_v2", args), "category_id"), sortBy(await rows(client, "chat_dashboard_patterns", args), "category_id"), `${label}: patrones ${direction}`);
  }
}

try {
  console.log("\n— Armando el negocio de prueba —");
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-core", slug: `zz-test-core-${Date.now()}` }).select("id").single();
  const { data: other } = await svc.from("workspaces")
    .insert({ name: "zz-test-core-otro", slug: `zz-test-core-otro-${Date.now()}` }).select("id").single();

  const owner = await makeUser("core-owner");
  const admin = await makeUser("core-admin");
  const memberA = await makeUser("core-mema");
  const memberB = await makeUser("core-memb");
  const oneChannel = await makeUser("core-unacuenta");
  const stranger = await makeUser("core-afuera");
  await svc.from("workspace_members").insert({ workspace_id: other.id, user_id: stranger.id, role: "owner" });

  const { data: chIg } = await svc.from("channels").insert({
    workspace_id: ws.id, platform: "instagram", late_account_id: `zz-test-ig-${Date.now()}`, username: "zzcoreig", display_name: "zz ig", is_active: true,
  }).select("id").single();
  const { data: chWa } = await svc.from("channels").insert({
    workspace_id: ws.id, platform: "whatsapp", late_account_id: `zz-test-wa-${Date.now()}`, username: "zzcorewa", display_name: "zz wa", is_active: true,
  }).select("id").single();

  const { data: role, error: roleError } = await svc.from("workspace_roles").insert({
    workspace_id: ws.id, name: "zz-test una cuenta",
    permissions: { keys: ["dashboards.chat.view"], scopes: { leads: "own" }, channels: { mode: "custom", byChannel: { [chWa.id]: { scope: "all", reply: true } } } },
  }).select("id").single();
  if (roleError) throw new Error(roleError.message);

  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: memberA.id, role: "member" },
    { workspace_id: ws.id, user_id: memberB.id, role: "member" },
    { workspace_id: ws.id, user_id: oneChannel.id, role: "member", role_id: role.id },
  ]);

  const { data: agent } = await svc.from("agents").insert({
    workspace_id: ws.id, name: "zz-test agente", type: "chat", is_enabled: false, close_after_inactive_hours: 12,
  }).select("id").single();

  const contactRows = Array.from({ length: 8 }, (_, i) => ({
    workspace_id: ws.id, display_name: `zz-test c${i + 1}`,
    setter_id: i === 0 || i === 2 ? memberA.id : null,
    vendedor_id: i === 3 ? memberB.id : null,
  }));
  const { data: contacts } = await svc.from("contacts").insert(contactRows).select("id");

  const convRows = contacts.map((c, i) => {
    const isWa = i >= 5;
    return {
      workspace_id: ws.id, channel_id: isWa ? chWa.id : chIg.id, contact_id: c.id, platform: isWa ? "whatsapp" : "instagram",
      status: "open", late_conversation_id: `zz-core-${i}`, created_at: D(1, 10, i),
    };
  });
  const { data: convs } = await svc.from("conversations").insert(convRows).select("id");
  const cv = (n) => convs[n - 1].id;

  const msg = (conv, dir, origin, day, h, m, s = 0, extra = {}) => ({
    conversation_id: conv, direction: dir, text: extra.text ?? (dir === "inbound" ? "hola" : "gracias por escribir"),
    origin: dir === "inbound" ? null : origin, status: extra.status ?? (dir === "inbound" ? "delivered" : "sent"), created_at: D(day, h, m, s),
    ...(extra.sent_by_user_id ? { sent_by_user_id: extra.sent_by_user_id } : {}),
    ...(extra.sent_by_agent_id ? { sent_by_agent_id: extra.sent_by_agent_id } : {}),
  });
  const { error: msgError } = await svc.from("messages").insert([
    // Dos episodios en la misma conversacion: pasan mas de 12 h entre uno y otro.
    msg(cv(1), "inbound", null, 5, 15, 0),
    msg(cv(1), "outbound", "agent", 5, 15, 0, 30, { sent_by_agent_id: agent.id }),
    msg(cv(1), "inbound", null, 8, 15, 0, 5),
    msg(cv(1), "outbound", "user", 8, 15, 5, 0, { sent_by_user_id: memberA.id }),
    // Un envio que fallo: cuenta para los episodios, no cierra la espera.
    msg(cv(2), "inbound", null, 6, 15, 0),
    msg(cv(2), "outbound", "user", 6, 15, 1, 0, { sent_by_user_id: memberB.id, status: "failed" }),
    msg(cv(2), "outbound", "user", 6, 15, 3, 0, { sent_by_user_id: memberB.id }),
    // Un saliente antes del primer entrante: no pertenece a ningun episodio.
    msg(cv(3), "outbound", "external", 7, 14, 0, 7),
    msg(cv(3), "inbound", null, 7, 15, 0),
    msg(cv(3), "outbound", "external", 7, 15, 0, 2),
    // Sin respuesta.
    msg(cv(4), "inbound", null, 8, 16, 0),
    // Automatizaciones, en la frontera del periodo anterior.
    msg(cv(5), "inbound", null, 9, 15, 0),
    msg(cv(5), "outbound", "flow", 9, 15, 0, 10),
    msg(cv(5), "outbound", "sequence", 9, 15, 0, 20),
    msg(cv(5), "outbound", "broadcast", 9, 15, 0, 30),
    // WhatsApp.
    msg(cv(6), "inbound", null, 12, 15, 0, 0, { text: "cuanto sale" }),
    msg(cv(6), "outbound", "user", 12, 15, 2, 0, { sent_by_user_id: memberA.id, text: "te paso el precio" }),
    msg(cv(6), "inbound", null, 12, 16, 0, 0, { text: "gracias" }),
    msg(cv(7), "inbound", null, 20, 15, 0, 0, { text: "cuanto sale" }),
    msg(cv(7), "outbound", "agent", 20, 15, 1, 0, { sent_by_agent_id: agent.id, text: "te paso el precio" }),
    msg(cv(8), "inbound", null, 21, 15, 0, 0, { text: "CUANTO SALE" }),
  ]);
  if (msgError) throw new Error(msgError.message);

  // Lo que mira la seccion del agente y la tabla del equipo.
  await svc.from("agent_runs").insert({ workspace_id: ws.id, source: "agent", trigger: "inbound_message", agent_id: agent.id, conversation_id: cv(1), status: "escalated", created_at: D(5, 17, 0) });
  await svc.from("agent_drafts").insert({ workspace_id: ws.id, agent_id: agent.id, conversation_id: cv(4), contact_id: contacts[3].id, channel_id: chIg.id, status: "sent", body: "x", body_parts: ["x"], sent_body: "x", burst_last_inbound_at: D(8, 16, 0), created_at: D(8, 16, 5), decided_at: D(8, 16, 6), decided_by: owner.id });
  await svc.from("audit_log").insert([
    { workspace_id: ws.id, entity_type: "conversation", entity_id: cv(2), action: "tag_added", performed_by_agent_id: agent.id, performed_at: D(6, 15, 30), actor_type: "agent" },
    { workspace_id: ws.id, entity_type: "conversation", entity_id: cv(1), action: "human_takeover", performed_by_agent_id: agent.id, performed_at: D(5, 17, 0), metadata: { assigned_to: memberA.id }, actor_type: "agent" },
    { workspace_id: ws.id, entity_type: "conversation", entity_id: cv(6), action: "assign", changes: { assigned_to: { new: memberA.id } }, performed_by: owner.id, performed_at: D(12, 15, 1), actor_type: "user" },
  ]);

  // Una categoria por direccion, para Patrones.
  const { data: cats, error: catError } = await svc.from("message_categories").insert([
    { workspace_id: ws.id, direction: "inbound", name: "zz-test Pide precio", created_by: "user" },
    { workspace_id: ws.id, direction: "outbound", name: "zz-test Pasa el precio", created_by: "user" },
  ]).select("id, direction");
  if (catError) throw new Error(catError.message);
  const cat = (d) => cats.find((c) => c.direction === d).id;
  // Upsert: un trigger de `messages` puede haber creado ya estas filas.
  const { error: textError } = await svc.from("message_texts").upsert([
    { workspace_id: ws.id, direction: "inbound", normalized_text: "cuanto sale", sample_text: "cuanto sale", category_id: cat("inbound"), source: "model" },
    { workspace_id: ws.id, direction: "outbound", normalized_text: "te paso el precio", sample_text: "te paso el precio", category_id: cat("outbound"), source: "model" },
  ], { onConflict: "workspace_id,direction,normalized_text" });
  if (textError) throw new Error(textError.message);

  const periodos = [
    { name: "periodo con anterior", from: D(5, 0, 0), to: D(15, 0, 0), prevFrom: D(1, 0, 0), prevTo: D(4, 23, 59) },
    { name: "abierto arriba", from: D(8, 0, 0), to: null, prevFrom: D(1, 0, 0), prevTo: D(7, 23, 59) },
    { name: "historico", from: null, to: null, prevFrom: null, prevTo: null },
  ];
  const personas = [
    ["Owner", owner], ["Admin", admin], ["Member A", memberA], ["Member B", memberB], ["Rol de una cuenta", oneChannel],
  ];

  console.log("\n— Lo nuevo da lo mismo que lo viejo, para cada rol —");
  for (const [who, user] of personas) {
    for (const p of periodos) {
      await compareAll(`${who}, ${p.name}`, user.client, ws.id, { ...p, channel: null, author: null });
    }
  }

  console.log("\n— Con los filtros de canal y de autor —");
  const filtros = [
    { channel: chIg.id, author: null, name: "canal por id" },
    { channel: "whatsapp", author: null, name: "canal por plataforma" },
    { channel: null, author: "agent", name: "autor agente" },
    { channel: null, author: "automations", name: "autor automatizaciones" },
    { channel: null, author: "external", name: "autor externo" },
    { channel: null, author: memberA.id, name: "autor una persona" },
    { channel: chWa.id, author: memberA.id, name: "canal y persona" },
  ];
  for (const f of filtros) {
    for (const [who, user] of [["Owner", owner], ["Member A", memberA]]) {
      await compareAll(`${who}, ${f.name}`, user.client, ws.id, { ...periodos[0], channel: f.channel, author: f.author });
    }
  }

  console.log("\n— Alguien de otro negocio no recibe nada, aunque mande el id —");
  {
    const args = { p_workspace_id: ws.id, p_from: null, p_to: null, p_prev_from: null, p_prev_to: null, p_channel: null, p_author: null, p_tz: TZ, p_include_agent: true };
    const core = await rows(stranger.client, "chat_dashboard_core", args);
    check(Number(core.numbers.messages_in) === 0 && Number(core.numbers.messages_out) === 0 && Number(core.numbers.new_conversations) === 0, "core: cifras en cero");
    check(Number(core.response.turns) === 0, "core: sin esperas");
    check(core.trends.length === 0, "core: sin dias en Historico");
    check(core.first_responder.length === 5 && core.first_responder.every((r) => Number(r.episodes) === 0), "core: las cinco filas, en cero");
    check(core.agent_weekly.length === 8 && core.agent_weekly.every((w) => Number(w.new_conversations) === 0), "core: las ocho semanas, en cero");
    const visible = await rows(stranger.client, "chat_visible_messages", { p_workspace_id: ws.id, p_channel: null });
    check(visible.length === 0, "chat_visible_messages: vacio");
    const team = await rows(stranger.client, "chat_dashboard_team_v2", { p_workspace_id: ws.id, p_from: null, p_to: null, p_channel: null });
    check(team.length === 0, "team_v2: vacio");
    for (const direction of ["outbound", "inbound"]) {
      const patterns = await rows(stranger.client, "chat_dashboard_patterns_v2", { p_workspace_id: ws.id, p_direction: direction, p_from: null, p_to: null, p_channel: null, p_author: null });
      check(patterns.length === 0, `patterns_v2 ${direction}: ni los nombres de las categorias`);
    }
  }

  console.log("\n— Sin sesion no se puede llamar —");
  {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    for (const [fn, args] of [
      ["chat_dashboard_core", { p_workspace_id: ws.id, p_from: null, p_to: null, p_prev_from: null, p_prev_to: null }],
      ["chat_visible_messages", { p_workspace_id: ws.id }],
      ["chat_dashboard_team_v2", { p_workspace_id: ws.id, p_from: null, p_to: null }],
      ["chat_dashboard_patterns_v2", { p_workspace_id: ws.id, p_direction: "inbound", p_from: null, p_to: null }],
    ]) {
      const { error } = await anon.rpc(fn, args);
      check(Boolean(error), `${fn}: anon rechazado`);
    }
  }

  console.log("\n— Un Member ve menos que un Owner: la comparacion no pasa por dar todo vacio —");
  {
    const args = { p_workspace_id: ws.id, p_from: null, p_to: null, p_prev_from: null, p_prev_to: null, p_channel: null, p_author: null, p_tz: TZ, p_include_agent: false };
    const asOwner = await rows(owner.client, "chat_dashboard_core", args);
    const asMember = await rows(memberA.client, "chat_dashboard_core", args);
    const asOneChannel = await rows(oneChannel.client, "chat_dashboard_core", args);
    check(Number(asOwner.numbers.messages_in) > Number(asMember.numbers.messages_in) && Number(asMember.numbers.messages_in) > 0, "Member A ve parte, Owner ve todo");
    check(Number(asOneChannel.numbers.messages_in) === 4, "el rol de una cuenta ve solo los entrantes de WhatsApp", JSON.stringify(asOneChannel.numbers));
    check(asOwner.agent === null && asOwner.agent_weekly === null, "sin pedir el agente, no se calcula");
  }

  if (CARGA > 0) {
    console.log(`\n— Carga: un Member con ${CARGA} conversaciones —`);
    const { data: chLoad } = await svc.from("channels").insert({
      workspace_id: ws.id, platform: "instagram", late_account_id: `zz-test-load-${Date.now()}`, username: "zzcoreload", display_name: "zz carga", is_active: true,
    }).select("id").single();
    for (let i = 0; i < CARGA; i += 500) {
      const size = Math.min(500, CARGA - i);
      const { data: cs, error: cErr } = await svc.from("contacts").insert(
        Array.from({ length: size }, (_, j) => ({ workspace_id: ws.id, display_name: `zz-test carga ${i + j}`, setter_id: (i + j) % 10 === 0 ? memberA.id : null })),
      ).select("id");
      if (cErr) throw new Error(cErr.message);
      const { data: load, error: vErr } = await svc.from("conversations").insert(
        cs.map((c, j) => ({ workspace_id: ws.id, channel_id: chLoad.id, contact_id: c.id, platform: "instagram", status: "open", late_conversation_id: `zz-load-${i + j}` })),
      ).select("id");
      if (vErr) throw new Error(vErr.message);
      const { error: mErr } = await svc.from("messages").insert(
        load.flatMap((c, j) => {
          const day = (j % 25) + 1;
          return [msg(c.id, "inbound", null, day, 10, 0), msg(c.id, "outbound", "agent", day, 10, 5), msg(c.id, "inbound", null, day, 11, 0)];
        }),
      );
      if (mErr) throw new Error(mErr.message);
    }
    const timed = async (fn) => {
      const start = performance.now();
      await fn();
      return Math.round(performance.now() - start);
    };
    const coreArgs = { p_workspace_id: ws.id, p_from: D(1, 0, 0), p_to: null, p_prev_from: null, p_prev_to: null, p_channel: null, p_author: null, p_tz: TZ, p_include_agent: true };
    for (const [who, user] of [["Owner", owner], ["Member A", memberA]]) {
      await timed(() => rows(user.client, "chat_dashboard_core", coreArgs)); // en caliente
      const nuevo = await timed(() => rows(user.client, "chat_dashboard_core", coreArgs));
      const team = await timed(() => rows(user.client, "chat_dashboard_team_v2", { p_workspace_id: ws.id, p_from: D(1, 0, 0), p_to: null, p_channel: null }));
      const patterns = await timed(() => rows(user.client, "chat_dashboard_patterns_v2", { p_workspace_id: ws.id, p_direction: "outbound", p_from: D(1, 0, 0), p_to: null, p_channel: null, p_author: null }));
      const viejo = await timed(() => client_safe(user.client, "chat_dashboard_numbers", { p_workspace_id: ws.id, p_from: D(1, 0, 0), p_to: null, p_channel: null, p_author: null }));
      console.log(`  ${who}: core ${nuevo} ms, team ${team} ms, patterns ${patterns} ms (antes, solo cifras: ${viejo} ms)`);
      check(nuevo < 8000, `${who}: core no llega al corte de 8 s`);
    }
  }
} catch (err) {
  fail("excepción no esperada", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}

/** La vieja puede cortarse por tiempo con mucha carga: eso tambien es un resultado. */
async function client_safe(client, fn, args) {
  const { error } = await client.rpc(fn, args);
  if (error) console.log(`    ${fn}: ${error.message}`);
}

console.log(`\n${checks - failures}/${checks} ok`);
process.exit(failures ? 1 : 0);
