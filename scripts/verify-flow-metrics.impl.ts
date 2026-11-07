/**
 * Las metricas por paso del lienzo contra la base real (00316).
 *
 * Lo que un test con Vitest no puede probar: que `flow_node_stats` (SECURITY INVOKER) cuente solo lo que la RLS deja ver,
 * que un paso que quedo para despues y despues salio cuente una vez, la regla de las 24 horas de «respondieron», que
 * nadie escriba clics con la sesion y las restricciones de las columnas nuevas.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runCleanup } from "./test-cleanup.mjs";
import type { Database } from "../lib/types/database";
import { buildNodeMetrics, type NodeStatRow } from "../lib/flows/node-metrics";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient<Database>(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) as SupabaseClient<Database>;
const db = svc as unknown as SupabaseClient;

let failures = 0;
const ok = (m: string) => console.log("  ok  ", m);
const fail = (m: string, extra?: string) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond: unknown, m: string, extra?: string) => (cond ? ok(m) : fail(m, extra));

interface TestUser {
  id: string;
  client: SupabaseClient<Database>;
}

async function makeUser(tag: string): Promise<TestUser> {
  const email = `zz-test-metrics-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient<Database>(URL, ANON, { auth: { persistSession: false } }) as SupabaseClient<Database>;
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const FROM = new Date(Date.now() - 86_400_000).toISOString();
const TO = new Date(Date.now() + 60_000).toISOString();

async function statsAs(user: TestUser, flowId: string) {
  const { data, error } = await user.client.rpc("flow_node_stats", { p_flow_id: flowId, p_from: FROM, p_to: TO });
  if (error) throw new Error(`flow_node_stats fallo: ${error.message}`);
  return buildNodeMetrics((data ?? []) as unknown as NodeStatRow[]);
}

try {
  console.log("\n— Preparacion —");
  const [owner, member, ajeno] = await Promise.all(["owner", "member", "ajeno"].map(makeUser));

  const { data: ws, error: wsError } = await db
    .from("workspaces")
    .insert({ name: "zz-test-metrics", slug: `zz-test-metrics-${Date.now()}`, timezone: "UTC" })
    .select("id")
    .single();
  if (wsError) throw new Error(`no pude crear el workspace: ${wsError.message}`);
  const workspaceId = ws.id as string;

  const { error: membersError } = await db.from("workspace_members").upsert(
    [
      { workspace_id: workspaceId, user_id: owner.id, role: "owner" },
      { workspace_id: workspaceId, user_id: member.id, role: "member" },
    ],
    { onConflict: "workspace_id,user_id" },
  );
  if (membersError) throw new Error(`no pude sumar al equipo: ${membersError.message}`);

  const { data: channel, error: channelError } = await db
    .from("channels")
    .insert({ workspace_id: workspaceId, platform: "instagram", late_account_id: `zz-test-${Date.now()}`, username: "zz-test", is_active: true })
    .select("id")
    .single();
  if (channelError) throw new Error(`no pude crear el canal: ${channelError.message}`);

  const { data: contacts, error: contactsError } = await db
    .from("contacts")
    .insert([
      { workspace_id: workspaceId, display_name: "zz-test Asignado", setter_id: member.id },
      { workspace_id: workspaceId, display_name: "zz-test Ajeno" },
    ])
    .select("id, display_name");
  if (contactsError) throw new Error(`no pude crear contactos: ${contactsError.message}`);
  const mine = contacts?.find((c) => c.display_name.includes("Asignado"))?.id as string;
  const other = contacts?.find((c) => c.display_name.includes("Ajeno"))?.id as string;

  const { data: convs, error: convError } = await db
    .from("conversations")
    .insert([
      { workspace_id: workspaceId, channel_id: channel.id, contact_id: mine, platform: "instagram", status: "open", assigned_to: member.id },
      { workspace_id: workspaceId, channel_id: channel.id, contact_id: other, platform: "instagram", status: "open" },
    ])
    .select("id, contact_id");
  if (convError) throw new Error(`no pude crear conversaciones: ${convError.message}`);
  const convMine = convs?.find((c) => c.contact_id === mine)?.id as string;
  const convOther = convs?.find((c) => c.contact_id === other)?.id as string;

  const { data: flow, error: flowError } = await db
    .from("flows")
    .insert({ workspace_id: workspaceId, name: "zz-test-metricas", status: "published", nodes: [], edges: [] })
    .select("id")
    .single();
  if (flowError) throw new Error(`no pude crear el flujo: ${flowError.message}`);
  const flowId = flow.id as string;

  const { data: sessions, error: sessionsError } = await db
    .from("flow_sessions")
    .insert([
      { flow_id: flowId, contact_id: mine, channel_id: channel.id, status: "completed", has_failed_step: true, variables: {} },
      { flow_id: flowId, contact_id: other, channel_id: channel.id, status: "completed", variables: {} },
    ])
    .select("id, contact_id");
  if (sessionsError) throw new Error(`no pude crear ejecuciones: ${sessionsError.message}`);
  const sMine = sessions?.find((s) => s.contact_id === mine)?.id as string;
  const sOther = sessions?.find((s) => s.contact_id === other)?.id as string;

  const step = (session: string, status: string, startedAt: string, extra: Record<string, unknown> = {}) => ({
    session_id: session,
    flow_id: flowId,
    node_id: "step-1",
    node_type: "privateReply",
    node_label: "Responder por privado",
    status,
    started_at: startedAt,
    ...extra,
  });
  const { error: stepsError } = await db.from("flow_session_steps").insert([
    step(sMine, "failed", minutesAgo(30), { reason: "zz-test otra app contesto", error_kind: "already_replied" }),
    // Quedo para despues y despues salio bien: cuenta UNA vez y como bien.
    step(sOther, "deferred", minutesAgo(40)),
    step(sOther, "ok", minutesAgo(39)),
    { session_id: sOther, flow_id: flowId, node_id: "cond", node_type: "branch", node_label: "Condiciones", status: "ok", exit_handle: "else", started_at: minutesAgo(38) },
  ]);
  if (stepsError) throw new Error(`no pude anotar pasos: ${stepsError.message}`);

  const { error: msgError } = await db.from("messages").insert([
    { conversation_id: convOther, direction: "outbound", text: "zz-test hola", status: "sent", sent_by_flow_id: flowId, sent_by_node_id: "step-1", created_at: minutesAgo(39) },
    { conversation_id: convOther, direction: "inbound", text: "zz-test gracias", status: "delivered", created_at: minutesAgo(20) },
    { conversation_id: convMine, direction: "outbound", text: "zz-test no salio", status: "failed", sent_by_flow_id: flowId, sent_by_node_id: "step-1", created_at: minutesAgo(30) },
  ]);
  if (msgError) throw new Error(`no pude guardar mensajes: ${msgError.message}`);

  const { error: clicksError } = await db.from("flow_link_clicks").insert([
    { workspace_id: workspaceId, flow_id: flowId, node_id: "step-1", button_key: "b0", session_id: sOther },
    { workspace_id: workspaceId, flow_id: flowId, node_id: "step-1", button_key: "b0", session_id: sOther },
    { workspace_id: workspaceId, flow_id: flowId, node_id: "step-1", button_key: "b0", session_id: sMine },
  ]);
  if (clicksError) throw new Error(`no pude guardar clics: ${clicksError.message}`);

  console.log("\n— Lo que cuenta el Owner —");
  const all = await statsAs(owner, flowId);
  const m = all["step-1"];
  check(m?.passed === 2, "pasaron 2 personas", JSON.stringify(m));
  check(m?.ok === 1 && m?.failed === 1 && m?.deferred === 0, "el que quedo para despues y salio cuenta una vez, como bien", JSON.stringify(m));
  check(m?.failedKinds[0]?.kind === "already_replied", "agrupa los fallos por motivo");
  check(m?.sent === 1 && m?.replied === 1, "1 enviado y 1 que respondio dentro de las 24 h (un fallido no cuenta como enviado)", JSON.stringify(m));
  check(m?.clicks[0]?.total === 3 && m?.clicks[0]?.people === 2 && m?.clickersAny === 2, "3 clics de 2 personas en el boton", JSON.stringify(m?.clicks));
  check(all.cond?.exits.else === 1, "cuenta por que salida siguio", JSON.stringify(all.cond));

  console.log("\n— Quien ve que —");
  const mineOnly = await statsAs(member, flowId);
  check(mineOnly["step-1"]?.passed === 1 && mineOnly["step-1"]?.failed === 1, "un Member cuenta solo la ejecucion de su contacto", JSON.stringify(mineOnly["step-1"]));
  check(mineOnly["step-1"]?.clickersAny === 1, "y solo los clics de esa ejecucion", JSON.stringify(mineOnly["step-1"]?.clicks));
  check(Object.keys(await statsAs(ajeno, flowId)).length === 0, "alguien de otro negocio no cuenta nada");

  const { data: memberClicks } = await member.client.from("flow_link_clicks").select("id").eq("flow_id", flowId);
  check((memberClicks ?? []).length === 1, "un Member lee solo los clics de su contacto", `leyo ${memberClicks?.length}`);
  const { data: foreignClicks } = await ajeno.client.from("flow_link_clicks").select("id").eq("flow_id", flowId);
  check((foreignClicks ?? []).length === 0, "alguien de otro negocio no lee clics");

  console.log("\n— Lo que no se puede —");
  const { error: clickInsert } = await owner.client.from("flow_link_clicks").insert({ workspace_id: workspaceId, flow_id: flowId, node_id: "x" });
  check(clickInsert, "nadie escribe clics con la sesion");
  const { error: badKind } = await db.from("flow_session_steps").insert(step(sOther, "failed", minutesAgo(1), { error_kind: "Motivo Libre con espacios" }));
  check(badKind, "la clave del motivo no acepta texto libre");
  const { error: longHandle } = await db.from("flow_session_steps").insert(step(sOther, "ok", minutesAgo(1), { exit_handle: "x".repeat(65) }));
  check(longHandle, "el handle de salida tiene tope");

  console.log("\n— La cascada —");
  await svc.from("flow_sessions").delete().eq("id", sOther);
  const { data: orphanClicks } = await svc.from("flow_link_clicks").select("session_id").eq("flow_id", flowId).eq("button_key", "b0");
  check((orphanClicks ?? []).filter((c) => c.session_id === null).length === 2, "borrar la ejecucion deja los clics sin ejecucion (no los borra)");
} catch (error) {
  fail("la verificacion se corto", error instanceof Error ? error.stack : String(error));
} finally {
  const clean = await runCleanup(svc);
  if (!clean) failures++;
}

console.log(failures === 0 ? "\nTodo en orden." : `\n${failures} falla(s)`);
process.exitCode = failures === 0 ? 0 : 1;
