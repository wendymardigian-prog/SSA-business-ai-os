/**
 * El historial de ejecuciones contra la base real (00292).
 *
 * Lo que un test con Vitest no puede probar: que la BASE haga cumplir quien ve que, que `variables` no se pueda leer con
 * la sesion, el trigger de la hora de fin, la cascada, y que el motor y la consulta de la pantalla anden de punta a punta.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runCleanup } from "./test-cleanup.mjs";
import type { Database } from "../lib/types/database";
import "../lib/flow-engine/registry";
import { executeFlow } from "../lib/flow-engine/engine";
import { sweepFlowStepHistory, flowStepRetentionCutoff } from "../lib/flows/runs-cleanup";
import { deriveRunState, parseFlowRunFilters, RUN_STATES } from "../lib/flows/runs";
import { loadFlowRunDetail, loadFlowRuns } from "../lib/flows/runs-query";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient<Database>(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) as SupabaseClient<Database>;

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
  const email = `zz-test-runs-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient<Database>(URL, ANON, { auth: { persistSession: false } }) as SupabaseClient<Database>;
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

const db = svc as unknown as SupabaseClient;
const sessionIds = async (user: TestUser, flowId: string) => {
  const { data } = await user.client.from("flow_sessions").select("id").eq("flow_id", flowId);
  return new Set((data ?? []).map((r) => r.id));
};

try {
  console.log("\n— Preparacion —");
  const [owner, admin, member, rolConPermiso, rolSinPermiso, ajeno] = await Promise.all(
    ["owner", "admin", "member", "con", "sin", "ajeno"].map(makeUser),
  );

  const { data: ws, error: wsError } = await db
    .from("workspaces")
    .insert({ name: "zz-test-runs", slug: `zz-test-runs-${Date.now()}`, timezone: "UTC" })
    .select("id")
    .single();
  if (wsError) throw new Error(`no pude crear el workspace: ${wsError.message}`);
  const workspaceId = ws.id as string;

  const { data: roles, error: rolesError } = await db
    .from("workspace_roles")
    .insert([
      { workspace_id: workspaceId, name: "zz-test con flows.view", permissions: { keys: ["flows.view"], scopes: { leads: "all" } } },
      { workspace_id: workspaceId, name: "zz-test sin flows.view", permissions: { keys: ["contacts.view"], scopes: { leads: "all" } } },
    ])
    .select("id, name");
  if (rolesError) throw new Error(`no pude crear los roles: ${rolesError.message}`);
  const roleWith = roles?.find((r) => r.name.includes("con"))?.id;
  const roleWithout = roles?.find((r) => r.name.includes("sin"))?.id;

  const { error: membersError } = await db.from("workspace_members").upsert(
    [
      { workspace_id: workspaceId, user_id: owner.id, role: "owner" },
      { workspace_id: workspaceId, user_id: admin.id, role: "admin" },
      { workspace_id: workspaceId, user_id: member.id, role: "member" },
      { workspace_id: workspaceId, user_id: rolConPermiso.id, role: "member", role_id: roleWith },
      { workspace_id: workspaceId, user_id: rolSinPermiso.id, role: "member", role_id: roleWithout },
    ],
    { onConflict: "workspace_id,user_id" },
  );
  if (membersError) throw new Error(`no pude sumar al equipo: ${membersError.message}`);

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

  const trigger = { id: "n-t", type: "trigger", data: { triggerType: "keyword" }, position: { x: 0, y: 0 } };
  const { data: flow, error: flowError } = await db
    .from("flows")
    .insert({
      workspace_id: workspaceId,
      name: "zz-test-flujo",
      status: "published",
      version: 4,
      nodes: [trigger, { id: "n-d", type: "delay", data: { label: "Un rato", duration: 60, unit: "minutes" }, position: { x: 0, y: 0 } }],
      edges: [{ id: "e", source: "n-t", target: "n-d" }],
    })
    .select("id")
    .single();
  if (flowError) throw new Error(`no pude crear el flujo: ${flowError.message}`);
  const flowId = flow.id as string;

  console.log("\n— El motor de punta a punta —");
  await executeFlow(svc, { triggerId: "t", flowId, channelId: "", contactId: mine, conversationId: "", workspaceId, incomingMessage: { text: "" }, variables: {} } as never);
  const { data: running } = await svc.from("flow_sessions").select("*").eq("flow_id", flowId).eq("contact_id", mine).single();
  check(running?.flow_version === 4, "la ejecucion guarda la version del flujo");
  check(running?.status === "active" && running.waiting_until, "queda esperando");
  const { data: engineSteps } = await svc.from("flow_session_steps").select("*").eq("session_id", running!.id);
  check(engineSteps?.length === 1 && engineSteps[0].status === "waiting" && engineSteps[0].node_label === "Esperar · Un rato", "anota el paso con su nombre y su estado", JSON.stringify(engineSteps));
  check(Boolean(engineSteps?.[0].resumes_at), "anota cuando sigue");

  console.log("\n— La hora de fin —");
  check(running?.finished_at === null, "mientras corre no tiene hora de fin");
  await svc.from("flow_sessions").update({ status: "completed" }).eq("id", running!.id);
  const { data: closed } = await svc.from("flow_sessions").select("finished_at").eq("id", running!.id).single();
  check(closed?.finished_at, "al cerrarse, el trigger pone la hora de fin");

  const { data: other1 } = await db.from("flow_sessions").insert({ flow_id: flowId, contact_id: other, status: "active", variables: { secreto: "zz-test" } }).select("id").single();
  const { data: noContact } = await db
    .from("flow_sessions")
    .insert({ flow_id: flowId, contact_id: null, member_user_id: admin.id, status: "completed", has_failed_step: true, variables: {} })
    .select("id")
    .single();
  const { data: failedRun } = await db
    .from("flow_sessions")
    .insert({ flow_id: flowId, contact_id: other, status: "cancelled", error_message: "zz-test se rompio", end_reason: "step_failed", variables: {} })
    .select("id")
    .single();

  console.log("\n— Quien ve que —");
  const all = new Set([running!.id, other1!.id, noContact!.id, failedRun!.id]);
  for (const [name, user] of [["Owner", owner], ["Admin", admin], ["un rol con flows.view y alcance total", rolConPermiso]] as const) {
    const seen = await sessionIds(user, flowId);
    check(seen.size === all.size, `${name} ve las ${all.size} ejecuciones`, `vio ${seen.size}`);
  }
  const memberSeen = await sessionIds(member, flowId);
  check(memberSeen.has(running!.id), "un Member ve la de su contacto");
  check(!memberSeen.has(other1!.id), "un Member NO ve la de un contacto ajeno");
  check(memberSeen.has(noContact!.id), "un Member ve la que no tiene contacto");
  check((await sessionIds(rolSinPermiso, flowId)).size === 0, "un rol sin flows.view no ve ninguna");
  check((await sessionIds(ajeno, flowId)).size === 0, "alguien de otro negocio no ve ninguna");

  const stepsAs = async (user: TestUser) => (await user.client.from("flow_session_steps").select("id").eq("session_id", running!.id)).data?.length ?? 0;
  check((await stepsAs(owner)) === 1, "Owner ve los pasos");
  check((await stepsAs(member)) === 1, "un Member ve los pasos de su contacto");
  check((await stepsAs(rolSinPermiso)) === 0, "un rol sin flows.view no ve pasos");
  check((await stepsAs(ajeno)) === 0, "alguien de otro negocio no ve pasos");

  console.log("\n— Lo que no se puede con la sesion —");
  const { error: varsError } = await owner.client.from("flow_sessions").select("variables").eq("flow_id", flowId);
  check(varsError, "ni el Owner lee variables");
  const { error: starError } = await owner.client.from("flow_sessions").select("*").eq("flow_id", flowId);
  check(starError, "un select * falla");
  const { error: stepInsert } = await owner.client.from("flow_session_steps").insert({ session_id: running!.id, flow_id: flowId, node_id: "x", node_type: "x", node_label: "x", status: "ok", started_at: new Date().toISOString() });
  check(stepInsert, "nadie escribe pasos con la sesion");
  const { data: updated } = await owner.client.from("flow_sessions").update({ status: "cancelled" }).eq("id", other1!.id).select("id");
  check((updated ?? []).length === 0, "nadie cambia una ejecucion con la sesion");

  console.log("\n— La consulta de la pantalla —");
  const load = (params: Record<string, string>) => loadFlowRuns(owner.client, { flowId, filters: parseFlowRunFilters(params), dateRange: { from: null, to: null } });
  const everything = await load({});
  check(!everything.error && everything.total === all.size, "lista todo sin filtros", JSON.stringify(everything).slice(0, 200));
  check(everything.rows.find((r) => r.id === running!.id)?.contact?.display_name === "zz-test Asignado", "trae el nombre del contacto");
  for (const state of RUN_STATES) {
    const result = await load({ estado: state });
    const expected = everything.rows.filter((r) => deriveRunState(r) === state).map((r) => r.id).sort();
    check(!result.error && JSON.stringify(result.rows.map((r) => r.id).sort()) === JSON.stringify(expected), `el filtro «${state}» coincide con el estado que se muestra (${expected.length})`);
  }
  const found = await load({ q: "Asignado" });
  check(!found.error && found.total === 1 && found.rows[0].id === running!.id, "busca por contacto", JSON.stringify(found).slice(0, 200));
  const detail = await loadFlowRunDetail(owner.client, { flowId, runId: running!.id });
  check(detail?.steps.length === 1, "trae el detalle con sus pasos");
  check((await loadFlowRunDetail(member.client, { flowId, runId: other1!.id })) === null, "un Member no abre una ejecucion ajena por la URL");

  console.log("\n— La limpieza y la cascada —");
  const old = new Date(flowStepRetentionCutoff(new Date()).getTime() - 86_400_000).toISOString();
  await db.from("flow_session_steps").insert({ session_id: other1!.id, flow_id: flowId, node_id: "viejo", node_type: "x", node_label: "zz-test viejo", status: "ok", started_at: old });
  const deleted = await sweepFlowStepHistory(svc, new Date());
  check(deleted >= 1, "borra los pasos de mas de 12 meses");
  const { data: sessionKept } = await svc.from("flow_sessions").select("id").eq("id", other1!.id).maybeSingle();
  check(sessionKept, "la ejecucion queda: «una sola vez por contacto» la necesita");
  const { data: recent } = await svc.from("flow_session_steps").select("id").eq("session_id", running!.id);
  check(recent?.length === 1, "los pasos recientes quedan");

  await svc.from("flow_sessions").delete().eq("id", running!.id);
  const { data: orphan } = await svc.from("flow_session_steps").select("id").eq("session_id", running!.id);
  check((orphan ?? []).length === 0, "borrar la ejecucion se lleva sus pasos");
} catch (error) {
  fail("la verificacion se corto", error instanceof Error ? error.stack : String(error));
} finally {
  const clean = await runCleanup(svc);
  if (!clean) failures++;
}

console.log(failures === 0 ? "\nTodo en orden." : `\n${failures} falla(s)`);
process.exitCode = failures === 0 ? 0 : 1;
