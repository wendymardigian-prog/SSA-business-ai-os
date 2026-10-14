#!/usr/bin/env node
/**
 * Matriz de permisos contra la base real (Equipo y roles, F25).
 *
 * Para cada tabla cuya politica pide un permiso (00212, 00213, 00214), prueba con personas de verdad quien puede y
 * quien no: el Owner, un Admin, un Member de sistema, una persona con un rol que tiene SOLO la clave que la politica
 * pide, una con un rol que tiene OTRA clave sin relacion, y (cuando importa) una con una clave parecida que NO alcanza.
 *
 * Lo que mas importa es la prueba positiva: un rol con exactamente `flows.edit` tiene que poder editar flujos. Si no, la
 * pantalla promete algo que la base no cumple. Y la negativa: un rol sin la clave no escribe, aunque sea miembro.
 *
 * Esto NO prueba que la pantalla oculte los botones (eso lo hacen los tests de vitest) ni la logica de "no podes dar lo
 * que no tenes" (esa la prueba `verify-roles.mjs --despues-de-00212`). Prueba que la BASE aplique el permiso aunque
 * alguien se saltee la pantalla.
 *
 * Crea y borra todo lo suyo (prefijo `zz-test-`). Una limpieza que falla es una prueba que falla. No se corre en
 * simultaneo con otro verify-*: comparten el prefijo y se pisan la limpieza.
 *
 *   node scripts/verify-permissions-matrix.mjs
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
let checks = 0;
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => { checks++; if (!cond) fail(m, extra); };
const uid = () => randomUUID().slice(0, 8);

async function makeUser(tag) {
  const email = `zz-test-${tag}-${Date.now()}-${uid()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

const ALL_SCOPES = { leads: "all", conversations: "all", bookings: "all", calls: "all", sales: "all", tasks: "all" };

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces")
    .insert({ name: "zz-test-matriz", slug: `zz-test-matriz-${Date.now()}` }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);

  // --- Las personas fijas -------------------------------------------------------------------------------------
  const owner = await makeUser("matriz-owner");
  const admin = await makeUser("matriz-admin");
  const member = await makeUser("matriz-member");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
  ]);
  const { data: emptyRole } = await svc.from("workspace_roles").insert({
    workspace_id: ws.id, name: "zz-test Rol vacio", permissions: { keys: [], scopes: {} },
  }).select("id").single();
  const { data: agent } = await svc.from("agents").insert({ workspace_id: ws.id, name: "zz-test agente", type: `zz_test_${uid()}` }).select("id").single();
  const { data: flow } = await svc.from("flows").insert({ workspace_id: ws.id, name: "zz-test flujo" }).select("id").single();
  // Una persona "objetivo" para las pruebas de miembros (se vuelve a crear si una prueba la borra).
  const objetivo = await makeUser("matriz-objetivo");
  const ensureObjetivo = () => svc.from("workspace_members").upsert(
    { workspace_id: ws.id, user_id: objetivo.id, role: "member", role_id: null }, { onConflict: "workspace_id,user_id" });
  await ensureObjetivo();

  // Una persona por clave: un rol personalizado con SOLO esa clave (mas las `base` del caso, cuando hacen falta para
  // poder ver la fila). El alcance, `all`, para que el alcance de leads no tape lo que se prueba.
  const custom = new Map();
  async function customActor(keys) {
    const k = [...keys].sort().join("|");
    if (!custom.has(k)) {
      const { data: role, error } = await svc.from("workspace_roles").insert({
        workspace_id: ws.id, name: `zz-test Solo ${k}`.slice(0, 120), permissions: { keys: [...keys], scopes: ALL_SCOPES },
      }).select("id").single();
      if (error) throw new Error(`no pude crear el rol ${k}: ${error.message}`);
      const u = await makeUser("matriz-custom");
      await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: u.id, role: "member", role_id: role.id });
      custom.set(k, u);
    }
    return custom.get(k);
  }

  const ctx = { ws, owner, admin, member, emptyRole, agent, flow, objetivo, ensureObjetivo };

  // --- Las tablas -----------------------------------------------------------------------------------------------
  // any: las claves que abren la operacion (cada una, SOLA, alcanza). deny: claves parecidas que NO alcanzan.
  // member: lo que puede un Member de sistema. ownerOnly: ni el Admin (solo el Owner). base: claves extra para poder ver
  // la fila. openToAll: cualquier miembro puede (una etiqueta simple).
  const T = (c) => c;
  const cases = [
    // ---- Equipo (00212)
    T({ name: "workspace_invites INSERT", table: "workspace_invites", op: "insert", any: ["team.invite"], deny: ["team.manage"], member: false,
      payload: (a) => ({ workspace_id: ws.id, email: `zz-test-${uid()}@example.test`, role: "member", role_id: emptyRole.id, invited_by: a.id, delivery: "link" }) }),
    T({ name: "workspace_invites UPDATE", table: "workspace_invites", op: "update", any: ["team.invite"], deny: ["team.manage"], member: false,
      seed: () => svc.from("workspace_invites").insert({ workspace_id: ws.id, email: `zz-test-${uid()}@example.test`, role: "member", role_id: emptyRole.id, invited_by: admin.id, delivery: "link" }).select("id").single(),
      patch: () => ({ send_count: 1 }) }),
    T({ name: "workspace_invites DELETE", table: "workspace_invites", op: "delete", any: ["team.invite"], deny: ["team.manage"], member: false,
      seed: () => svc.from("workspace_invites").insert({ workspace_id: ws.id, email: `zz-test-${uid()}@example.test`, role: "member", role_id: emptyRole.id, invited_by: admin.id, delivery: "link" }).select("id").single() }),
    T({ name: "workspace_members UPDATE (cambiar el rol)", table: "workspace_members", op: "update", any: ["team.manage"], deny: ["team.invite"], member: false, key: "user_id",
      seed: async () => { await ensureObjetivo(); return { data: { id: objetivo.id } }; }, patch: () => ({ role_id: emptyRole.id }) }),
    T({ name: "workspace_members DELETE (quitar a alguien: solo el Owner)", table: "workspace_members", op: "delete", any: [], deny: ["team.manage", "team.invite"], member: false, ownerOnly: true, key: "user_id",
      seed: async () => { await ensureObjetivo(); return { data: { id: objetivo.id } }; } }),
    T({ name: "workspace_roles INSERT", table: "workspace_roles", op: "insert", any: ["roles.manage"], deny: ["roles.view"], member: false,
      payload: () => ({ workspace_id: ws.id, name: `zz-test rol ${uid()}`, permissions: { keys: [], scopes: {} } }) }),
    T({ name: "workspace_roles UPDATE", table: "workspace_roles", op: "update", any: ["roles.manage"], deny: ["roles.view"], member: false,
      seed: () => svc.from("workspace_roles").insert({ workspace_id: ws.id, name: `zz-test rol ${uid()}`, permissions: { keys: [], scopes: {} } }).select("id").single(),
      patch: () => ({ description: "probado" }) }),
    T({ name: "workspace_roles DELETE", table: "workspace_roles", op: "delete", any: ["roles.manage"], deny: ["roles.view"], member: false,
      seed: () => svc.from("workspace_roles").insert({ workspace_id: ws.id, name: `zz-test rol ${uid()}`, permissions: { keys: [], scopes: {} } }).select("id").single() }),

    // ---- Ajustes (00213)
    T({ name: "custom_field_definitions INSERT", table: "custom_field_definitions", op: "insert", any: ["custom_fields.manage"], deny: ["contacts.edit"], member: false,
      payload: () => ({ workspace_id: ws.id, name: `zz-test campo ${uid()}`, slug: `zz_test_${uid()}`, type: "text" }) }),
    T({ name: "custom_field_definitions UPDATE", table: "custom_field_definitions", op: "update", any: ["custom_fields.manage"], deny: ["contacts.edit"], member: false,
      seed: () => svc.from("custom_field_definitions").insert({ workspace_id: ws.id, name: `zz-test campo ${uid()}`, slug: `zz_test_${uid()}`, type: "text" }).select("id").single(),
      patch: () => ({ name: `zz-test campo ${uid()}` }) }),
    T({ name: "integration_configs SELECT (una integracion del negocio)", table: "integration_configs", op: "select", any: ["integrations.view", "integrations.manage"], deny: ["channels.manage"], member: false,
      seed: () => svc.from("integration_configs").insert({ workspace_id: ws.id, type: "ai_provider", provider: `zz-test-${uid()}`, display_name: "zz-test", vault_secret_name: "zz-test", is_active: true }).select("id").single() }),
    T({ name: "integration_configs SELECT (un canal)", table: "integration_configs", op: "select", any: ["integrations.view", "integrations.manage", "channels.manage"], deny: ["social.view"], member: false,
      seed: () => svc.from("integration_configs").insert({ workspace_id: ws.id, type: "channel", provider: `zz-test-${uid()}`, display_name: "zz-test canal", vault_secret_name: "zz-test", is_active: true }).select("id").single() }),
    T({ name: "integration_configs INSERT (negocio)", table: "integration_configs", op: "insert", any: ["integrations.manage"], deny: ["integrations.view", "channels.manage"], member: false,
      payload: () => ({ workspace_id: ws.id, type: "ai_provider", provider: `zz-test-${uid()}`, display_name: "zz-test", vault_secret_name: "zz-test", is_active: true }) }),
    T({ name: "integration_configs INSERT (canal)", table: "integration_configs", op: "insert", any: ["integrations.manage", "channels.manage"], deny: ["integrations.view"], member: false,
      payload: () => ({ workspace_id: ws.id, type: "channel", provider: `zz-test-${uid()}`, display_name: "zz-test canal", vault_secret_name: "zz-test", is_active: true }) }),
    T({ name: "integration_configs UPDATE (negocio)", table: "integration_configs", op: "update", any: ["integrations.manage"], deny: ["integrations.view", "channels.manage"], member: false,
      seed: () => svc.from("integration_configs").insert({ workspace_id: ws.id, type: "ai_provider", provider: `zz-test-${uid()}`, display_name: "zz-test", vault_secret_name: "zz-test", is_active: true }).select("id").single(),
      patch: () => ({ is_active: false }), base: ["integrations.view"] }),
    T({ name: "integration_configs DELETE (negocio)", table: "integration_configs", op: "delete", any: ["integrations.manage"], deny: ["integrations.view", "channels.manage"], member: false,
      seed: () => svc.from("integration_configs").insert({ workspace_id: ws.id, type: "ai_provider", provider: `zz-test-${uid()}`, display_name: "zz-test", vault_secret_name: "zz-test", is_active: true }).select("id").single(), base: ["integrations.view"] }),
    T({ name: "social_accounts INSERT", table: "social_accounts", op: "insert", any: ["integrations.manage"], deny: ["integrations.view", "channels.manage", "social.view"], member: false,
      payload: () => ({ workspace_id: ws.id, platform: "youtube", username: `zz-test-${uid()}`, display_name: "zz-test" }) }),
    T({ name: "social_accounts UPDATE", table: "social_accounts", op: "update", any: ["integrations.manage"], deny: ["integrations.view", "social.view"], member: false,
      seed: () => svc.from("social_accounts").insert({ workspace_id: ws.id, platform: "youtube", username: `zz-test-${uid()}`, display_name: "zz-test" }).select("id").single(),
      patch: () => ({ display_name: "zz-test 2" }) }),
    T({ name: "social_accounts DELETE", table: "social_accounts", op: "delete", any: ["integrations.manage"], deny: ["integrations.view", "social.view"], member: false,
      seed: () => svc.from("social_accounts").insert({ workspace_id: ws.id, platform: "youtube", username: `zz-test-${uid()}`, display_name: "zz-test" }).select("id").single() }),
    T({ name: "channels INSERT", table: "channels", op: "insert", any: ["channels.manage"], deny: ["integrations.manage", "integrations.view"], member: false,
      payload: () => ({ workspace_id: ws.id, platform: "instagram", late_account_id: `zz-test-${uid()}`, username: "zz-test", display_name: "zz-test", is_active: true }) }),
    T({ name: "channels UPDATE", table: "channels", op: "update", any: ["channels.manage"], deny: ["integrations.manage", "integrations.view"], member: false,
      seed: () => svc.from("channels").insert({ workspace_id: ws.id, platform: "instagram", late_account_id: `zz-test-${uid()}`, username: "zz-test", display_name: "zz-test", is_active: true }).select("id").single(),
      patch: () => ({ display_name: "zz-test 2" }) }),
    T({ name: "channels DELETE", table: "channels", op: "delete", any: ["channels.manage"], deny: ["integrations.manage", "integrations.view"], member: false,
      seed: () => svc.from("channels").insert({ workspace_id: ws.id, platform: "instagram", late_account_id: `zz-test-${uid()}`, username: "zz-test", display_name: "zz-test", is_active: true }).select("id").single() }),
    T({ name: "csv_imports SELECT (importaciones de otras personas)", table: "csv_imports", op: "select", any: ["contacts.import"], deny: ["contacts.edit", "contacts.view"], member: false,
      seed: () => svc.from("csv_imports").insert({ workspace_id: ws.id, file_name: "zz-test.csv", total_rows: 1, imported_by: admin.id }).select("id").single() }),
    T({ name: "csv_imports SELECT (la importacion propia la ve quien la hizo)", table: "csv_imports", op: "select", any: [], deny: [], member: true, openToAll: true,
      seed: (a) => svc.from("csv_imports").insert({ workspace_id: ws.id, file_name: "zz-test.csv", total_rows: 1, imported_by: a.id }).select("id").single() }),
    T({ name: "audit_log SELECT (acciones de otras personas)", table: "audit_log", op: "select", any: ["audit.view"], deny: ["settings.general", "roles.view"], member: false,
      seed: () => svc.from("audit_log").insert({ workspace_id: ws.id, entity_type: "contact", entity_id: randomUUID(), action: "update", performed_by: admin.id }).select("id").single() }),

    // ---- Modulos (00214)
    T({ name: "flows SELECT", table: "flows", op: "select", any: ["flows.view"], deny: ["flows.edit"], member: true,
      seed: () => svc.from("flows").insert({ workspace_id: ws.id, name: `zz-test flujo ${uid()}` }).select("id").single() }),
    T({ name: "flows INSERT", table: "flows", op: "insert", any: ["flows.edit"], deny: ["flows.view", "flows.publish"], member: true,
      payload: () => ({ workspace_id: ws.id, name: `zz-test flujo ${uid()}` }) }),
    T({ name: "flows UPDATE", table: "flows", op: "update", any: ["flows.edit"], deny: ["flows.publish"], member: true, base: ["flows.view"],
      seed: () => svc.from("flows").insert({ workspace_id: ws.id, name: `zz-test flujo ${uid()}` }).select("id").single(),
      patch: () => ({ description: "probado" }) }),
    T({ name: "flows DELETE", table: "flows", op: "delete", any: ["flows.edit"], deny: ["flows.publish"], member: true, base: ["flows.view"],
      seed: () => svc.from("flows").insert({ workspace_id: ws.id, name: `zz-test flujo ${uid()}` }).select("id").single() }),
    T({ name: "triggers INSERT (M7: un Member publica y se dispara)", table: "triggers", op: "insert", any: ["flows.edit"], deny: ["flows.publish", "flows.view"], member: true,
      payload: () => ({ workspace_id: ws.id, flow_id: flow.id, type: "keyword", config: {}, is_active: false }) }),
    T({ name: "triggers UPDATE", table: "triggers", op: "update", any: ["flows.edit"], deny: ["flows.publish"], member: true,
      seed: () => svc.from("triggers").insert({ workspace_id: ws.id, flow_id: flow.id, type: "keyword", config: {}, is_active: false }).select("id").single(),
      patch: () => ({ is_active: true }) }),
    T({ name: "triggers DELETE", table: "triggers", op: "delete", any: ["flows.edit"], deny: ["flows.publish"], member: true,
      seed: () => svc.from("triggers").insert({ workspace_id: ws.id, flow_id: flow.id, type: "keyword", config: {}, is_active: false }).select("id").single() }),
    T({ name: "sequences INSERT", table: "sequences", op: "insert", any: ["sequences.edit"], deny: ["sequences.view", "flows.edit"], member: false,
      payload: () => ({ workspace_id: ws.id, name: `zz-test secuencia ${uid()}` }) }),
    T({ name: "sequences UPDATE", table: "sequences", op: "update", any: ["sequences.edit"], deny: ["sequences.view", "flows.edit"], member: false,
      seed: () => svc.from("sequences").insert({ workspace_id: ws.id, name: `zz-test secuencia ${uid()}` }).select("id").single(),
      patch: () => ({ description: "probado" }) }),
    T({ name: "sequences DELETE", table: "sequences", op: "delete", any: ["sequences.edit"], deny: ["sequences.view", "flows.edit"], member: false,
      seed: () => svc.from("sequences").insert({ workspace_id: ws.id, name: `zz-test secuencia ${uid()}` }).select("id").single() }),
    T({ name: "tags INSERT (una etiqueta que apaga al agente: rama de gestion)", table: "tags", op: "insert", any: ["tags.manage"], deny: ["contacts.edit", "agents.edit"], member: false,
      payload: () => ({ workspace_id: ws.id, name: `zz-test etiqueta ${uid()}`, disables_agent: true }) }),
    T({ name: "tags INSERT (una etiqueta simple la crea cualquier miembro)", table: "tags", op: "insert", any: [], deny: [], member: true, openToAll: true,
      payload: () => ({ workspace_id: ws.id, name: `zz-test etiqueta ${uid()}`, disables_agent: false }) }),
    T({ name: "tags UPDATE (una etiqueta con efectos)", table: "tags", op: "update", any: ["tags.manage"], deny: ["contacts.edit", "agents.edit"], member: false,
      seed: () => svc.from("tags").insert({ workspace_id: ws.id, name: `zz-test etiqueta ${uid()}`, disables_agent: true }).select("id").single(),
      patch: () => ({ name: `zz-test etiqueta ${uid()}` }) }),
    T({ name: "tags DELETE (una etiqueta con efectos)", table: "tags", op: "delete", any: ["tags.manage"], deny: ["contacts.edit", "agents.edit"], member: false,
      seed: () => svc.from("tags").insert({ workspace_id: ws.id, name: `zz-test etiqueta ${uid()}`, disables_agent: true }).select("id").single() }),
    T({ name: "agents INSERT", table: "agents", op: "insert", any: ["agents.edit"], deny: ["agents.view", "ai_tasks.manage"], member: false,
      payload: () => ({ workspace_id: ws.id, name: `zz-test agente ${uid()}`, type: `zz_test_${uid()}` }) }),
    T({ name: "agents UPDATE", table: "agents", op: "update", any: ["agents.edit"], deny: ["agents.view", "ai_tasks.manage"], member: false,
      seed: () => svc.from("agents").insert({ workspace_id: ws.id, name: `zz-test agente ${uid()}`, type: `zz_test_${uid()}` }).select("id").single(),
      patch: () => ({ name: `zz-test agente ${uid()}` }) }),
    T({ name: "agent_prompt_versions INSERT", table: "agent_prompt_versions", op: "insert", any: ["agents.edit"], deny: ["agents.view", "ai_tasks.manage"], member: false,
      payload: (a) => ({ workspace_id: ws.id, agent_id: agent.id, version: 1000 + Math.floor(Math.random() * 1e6), system_prompt: "zz-test", created_by: a.id }) }),
    T({ name: "agent_prompt_versions SELECT", table: "agent_prompt_versions", op: "select", any: ["agents.edit"], deny: ["agents.view", "ai_tasks.manage"], member: false,
      seed: () => svc.from("agent_prompt_versions").insert({ workspace_id: ws.id, agent_id: agent.id, version: 1000 + Math.floor(Math.random() * 1e6), system_prompt: "zz-test" }).select("id").single() }),
    T({ name: "ai_task_prompt_versions INSERT", table: "ai_task_prompt_versions", op: "insert", any: ["ai_tasks.manage", "calls.configure"], deny: ["agents.edit", "agents.view"], member: false,
      payload: (a) => ({ workspace_id: ws.id, task: "close_classification", version: 1000 + Math.floor(Math.random() * 1e6), instructions: "zz-test", created_by: a.id }) }),
    T({ name: "ai_task_prompt_versions SELECT", table: "ai_task_prompt_versions", op: "select", any: ["ai_tasks.manage", "calls.configure"], deny: ["agents.edit", "agents.view"], member: false,
      seed: () => svc.from("ai_task_prompt_versions").insert({ workspace_id: ws.id, task: "close_classification", version: 1000 + Math.floor(Math.random() * 1e6), instructions: "zz-test" }).select("id").single() }),
    T({ name: "knowledge_base INSERT", table: "knowledge_base", op: "insert", any: ["knowledge.edit"], deny: ["knowledge.view", "agents.edit"], member: false,
      payload: () => ({ workspace_id: ws.id, title: `zz-test doc ${uid()}` }) }),
    T({ name: "knowledge_base UPDATE", table: "knowledge_base", op: "update", any: ["knowledge.edit"], deny: ["knowledge.view", "agents.edit"], member: false,
      seed: () => svc.from("knowledge_base").insert({ workspace_id: ws.id, title: `zz-test doc ${uid()}` }).select("id").single(),
      patch: () => ({ title: `zz-test doc ${uid()}` }) }),
    T({ name: "knowledge_base DELETE", table: "knowledge_base", op: "delete", any: ["knowledge.edit"], deny: ["knowledge.view", "agents.edit"], member: false,
      seed: () => svc.from("knowledge_base").insert({ workspace_id: ws.id, title: `zz-test doc ${uid()}` }).select("id").single() }),
    T({ name: "contacts DELETE", table: "contacts", op: "delete", any: ["contacts.delete"], deny: ["contacts.edit", "contacts.merge"], member: false, base: ["contacts.view"],
      seed: () => svc.from("contacts").insert({ workspace_id: ws.id, display_name: `zz-test contacto ${uid()}` }).select("id").single() }),
  ];

  // --- Ejecutar -----------------------------------------------------------------------------------------------
  async function attempt(actor, c) {
    const table = ctx_table(c);
    // Una cuenta social por red y workspace (unico): antes de cada intento se vacia la tabla de ese workspace.
    if (c.table === "social_accounts") await svc.from("social_accounts").delete().eq("workspace_id", ws.id);
    if (c.op === "insert") {
      const { error } = await actor.client.from(table).insert(c.payload(actor));
      return { allowed: !error, error };
    }
    const seeded = await c.seed(actor);
    if (seeded.error || !seeded.data) throw new Error(`no pude sembrar ${c.name}: ${seeded.error?.message}`);
    const id = seeded.data.id;
    const col = c.key ?? "id";
    const scope = (q) => (c.table === "workspace_members" ? q.eq("workspace_id", ws.id).eq(col, id) : q.eq(col, id));
    if (c.op === "select") {
      const { data, error } = await scope(actor.client.from(table).select(col));
      return { allowed: !error && (data ?? []).length > 0, error };
    }
    if (c.op === "update") {
      const { count, error } = await scope(actor.client.from(table).update(c.patch(), { count: "exact" }));
      return { allowed: !error && (count ?? 0) > 0, error };
    }
    const { count, error } = await scope(actor.client.from(table).delete({ count: "exact" }));
    return { allowed: !error && (count ?? 0) > 0, error };
  }
  const ctx_table = (c) => c.table;

  for (const c of cases) {
    console.log(`\n— ${c.name} —`);
    const base = c.base ?? [];
    const rows = [];
    rows.push(["el Owner", owner, true]);
    rows.push(["un Admin", admin, !c.ownerOnly]);
    rows.push(["un Member de sistema", member, c.member === true]);
    for (const k of c.any) rows.push([`un rol con solo ${k}`, await customActor([k, ...base]), true]);
    for (const k of c.deny) rows.push([`un rol con solo ${k}`, await customActor([k, ...base]), c.openToAll === true]);
    rows.push(["un rol con una clave sin relacion", await customActor(["dashboards.chat.view", ...base]), c.openToAll === true]);
    for (const [who, actor, expected] of rows) {
      if (c.op !== "insert" && c.table === "workspace_members" && c.op === "delete") await ensureObjetivo();
      const r = await attempt(actor, c);
      check(r.allowed === expected, `${who} ${expected ? "PUEDE" : "NO puede"}`, r.allowed === expected ? undefined : `esperaba ${expected}, paso ${r.allowed}${r.error ? " (" + r.error.message + ")" : ""}`);
    }
    // Un caso "positivo" que no se probo nunca es una prueba vacia: tiene que haber al menos una persona que pueda.
    check(rows.some(([, , e]) => e === true), `${c.name}: hay al menos una persona que PUEDE (prueba positiva)`);
  }

  console.log(`\n${checks} comprobaciones sobre ${cases.length} casos.`);
} catch (err) {
  fail("error inesperado", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures === 0 ? "\nTodo verde" : `\n${failures} FALLAS`);
process.exit(failures === 0 ? 0 : 1);
