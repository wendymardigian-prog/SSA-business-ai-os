/**
 * Tareas contra la base real (Extra A).
 *
 * Lo que un test con Vitest no puede probar: que la BASE haga cumplir las reglas (RLS, privilegios
 * por columna, ciclos, atomicidad, borrado logico, limpieza de personas, el cron).
 *
 * Los bloques corren segun lo que ya este aplicado (`--hasta 196|197|198|199|206|207`).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCleanup } from "./test-cleanup.mjs";
import { completeTaskCore, createTaskCore, deleteTaskCore, planCompletionCore, setTaskBlockersCore, updateTaskCore, type TaskCtx } from "../lib/tasks/core";
import { todayInputValue } from "../lib/dates";
import { runTasksDueSweep } from "../lib/jobs/handlers/tasks-due-sweep";
import { createNotification } from "../lib/notifications/create";
import { addDays } from "../lib/tasks/dates";
import { createFollowupTaskCore } from "../lib/tasks/followup-core";
import { ensureTaskPaymentFlows, getPaymentTasksState } from "../lib/tasks/automation-templates";
import "../lib/flow-engine/registry";
import { processEvent, type AutomationEvent } from "../lib/flow-engine/automation-events";
import { buildDesiredTriggers } from "../lib/flow-triggers";
import { dbTargetArgs } from "./lib/db-target.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Sin tipos de la tabla `tasks` a proposito: lo que se prueba es lo que acepta la base.

type Db = SupabaseClient<any>;
const svc: Db = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const argv = process.argv;
const upTo = Number(argv[argv.indexOf("--hasta") + 1]) || 207;

let failures = 0;
const ok = (m: string) => console.log("  ok  ", m);
const fail = (m: string, extra?: string) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond: unknown, m: string, extra?: string) => (cond ? ok(m) : fail(m, extra));

interface TestUser {
  id: string;
  client: Db;
}

async function makeUser(tag: string): Promise<TestUser> {
  const email = `zz-test-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client: Db = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

const D = (d: string) => d; // fechas AAAA-MM-DD, tal cual

try {
  // ── Preparacion ────────────────────────────────────────────────────────────
  const stamp = Date.now();
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-tareas", slug: `zz-test-tareas-${stamp}`, timezone: "America/Costa_Rica" }).select("id").single();
  if (wsErr || !ws) throw new Error(`no pude crear el workspace: ${wsErr?.message}`);
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-tareas-otro", slug: `zz-test-tareas-otro-${stamp}` }).select("id").single();

  const owner = await makeUser("t-owner");
  const admin = await makeUser("t-admin");
  const creator = await makeUser("t-creator"); // Member de sistema: crea tareas
  const assignee = await makeUser("t-assignee"); // Member de sistema: responsable
  const follower = await makeUser("t-follower"); // Member de sistema: seguidor
  const stranger = await makeUser("t-stranger"); // Member de sistema: no figura
  const viewer = await makeUser("t-viewer"); // rol personalizado: solo tasks.view
  const allView = await makeUser("t-allview"); // rol personalizado: tasks.view + edit, alcance all
  const noView = await makeUser("t-noview"); // rol personalizado sin tasks.view
  const deleter = await makeUser("t-deleter"); // rol personalizado con tasks.delete
  const outsider = await makeUser("t-outsider"); // otro workspace
  const leaving = await makeUser("t-leaving"); // sale del workspace (F6)
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    ...[creator, assignee, follower, stranger, viewer, allView, noView, deleter, leaving].map((u) => ({ workspace_id: ws.id, user_id: u.id, role: "member" })),
    { workspace_id: ws2!.id, user_id: outsider.id, role: "owner" },
  ]);
  const scopes = (tasks: "own" | "all") => ({ leads: "own", conversations: "own", bookings: "own", calls: "own", sales: "own", tasks });
  const mkRole = async (name: string, keys: string[], tasks: "own" | "all", member: TestUser) => {
    const { data: r } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name: `zz-test ${name}`, permissions: { keys, scopes: scopes(tasks) } }).select("id").single();
    await svc.from("workspace_members").update({ role_id: r!.id }).eq("workspace_id", ws.id).eq("user_id", member.id);
  };
  await mkRole("solo ver", ["tasks.view"], "own", viewer);
  await mkRole("ver todo", ["tasks.view", "tasks.edit"], "all", allView);
  await mkRole("sin ver", ["contacts.view"], "own", noView);
  await mkRole("borra", ["tasks.view", "tasks.edit", "tasks.delete"], "own", deleter);

  const mk = async (row: Record<string, unknown>) => {
    const { data, error } = await svc.from("tasks").insert({ workspace_id: ws.id, title: "zz-test tarea", ...row }).select("*").single();
    if (error || !data) throw new Error(`no pude crear la tarea: ${error?.message}`);
    return data as Record<string, any>;
  };
  const ids = async (u: TestUser) => ((await u.client.from("tasks").select("id")).data ?? []).map((r: { id: string }) => r.id).sort();
  const row = async (id: string) => (await svc.from("tasks").select("*").eq("id", id).single()).data as Record<string, any>;

  // ═══ 00196 ═════════════════════════════════════════════════════════════════
  console.log("\n— 00196: la tabla, quien ve y quien edita —");
  const t1 = await mk({ title: "zz-test creada por creator", created_by: creator.id });
  const t2 = await mk({ title: "zz-test de assignee", created_by: owner.id, owner_id: assignee.id });
  const t3 = await mk({ title: "zz-test sigue follower", created_by: owner.id, follower_ids: [follower.id] });
  const t4 = await mk({ title: "zz-test ajena", created_by: owner.id });
  const all = [t1.id, t2.id, t3.id, t4.id].sort();

  check(JSON.stringify(await ids(owner)) === JSON.stringify(all), "Owner ve todas las tareas del workspace");
  check(JSON.stringify(await ids(admin)) === JSON.stringify(all), "Admin ve todas las tareas del workspace");
  check((await ids(stranger)).length === 0, "un Member que no figura en ninguna recibe 0 filas");
  check(JSON.stringify(await ids(creator)) === JSON.stringify([t1.id]), "el creador ve la suya (y solo esa)");
  check(JSON.stringify(await ids(assignee)) === JSON.stringify([t2.id]), "el responsable ve la suya (y solo esa)");
  check(JSON.stringify(await ids(follower)) === JSON.stringify([t3.id]), "el seguidor ve la suya (y solo esa)");
  const byId = await stranger.client.from("tasks").select("id").eq("id", t1.id);
  check((byId.data ?? []).length === 0, "una tarea ajena no se ve ni pidiendola por id");
  check((await ids(outsider)).length === 0, "un usuario de OTRO workspace recibe 0 filas");
  check(JSON.stringify(await ids(allView)) === JSON.stringify(all), "un rol personalizado con alcance `all` ve todas");
  check((await ids(noView)).length === 0, "un rol sin `tasks.view` no ve ni las que le tocan");
  await svc.from("tasks").update({ owner_id: noView.id }).eq("id", t4.id);
  check((await ids(noView)).length === 0, "...aunque sea el responsable de una");
  await svc.from("tasks").update({ owner_id: null }).eq("id", t4.id);

  // Escritura
  const viewerOwn = await mk({ title: "zz-test del viewer", created_by: owner.id, owner_id: viewer.id });
  const ins = await viewer.client.from("tasks").insert({ workspace_id: ws.id, title: "zz-test x", created_by: viewer.id });
  check(!!ins.error, "un rol con `tasks.view` pero sin `tasks.edit` NO puede insertar (RLS)", ins.error?.message);
  const upd = await viewer.client.from("tasks").update({ title: "zz-test cambio" }).eq("id", viewerOwn.id).select("id");
  check(!upd.error && (upd.data ?? []).length === 0, "...ni actualizar (0 filas afectadas)", upd.error?.message);
  check((await row(viewerOwn.id)).title === "zz-test del viewer", "...y la tarea no cambio");

  const created = await creator.client.from("tasks").insert({ workspace_id: ws.id, title: "zz-test de creator", created_by: creator.id }).select("*").single();
  check(!created.error && created.data?.owner_id === null, "el Member de sistema crea una tarea (queda como creador)", created.error?.message);
  const forged = await creator.client.from("tasks").insert({ workspace_id: ws.id, title: "zz-test falsa", created_by: owner.id });
  check(!!forged.error, "no se puede crear una tarea a nombre de otra persona");
  const otherWs = await creator.client.from("tasks").insert({ workspace_id: ws2!.id, title: "zz-test cruzada", created_by: creator.id });
  check(!!otherWs.error, "no se puede crear una tarea en otro workspace");
  const ownEdit = await creator.client.from("tasks").update({ title: "zz-test editada", status: "in_progress", priority: "high" }).eq("id", created.data!.id).select("id");
  check(!ownEdit.error && (ownEdit.data ?? []).length === 1, "el Member edita una tarea que ve");
  const foreignEdit = await stranger.client.from("tasks").update({ title: "zz-test intrusa" }).eq("id", created.data!.id).select("id");
  check((foreignEdit.data ?? []).length === 0 && (await row(created.data!.id)).title === "zz-test editada", "...y no edita una que no ve");
  const reassign = await creator.client.from("tasks").update({ owner_id: assignee.id }).eq("id", created.data!.id);
  check(!reassign.error, "pasar la tarea a otra persona (y perder la vista de responsable) no es un error", reassign.error?.message);

  for (const [col, val] of [["workspace_id", ws2!.id], ["source", "agent"], ["source_ref", "x"], ["blocked_by", []], ["deleted_at", new Date().toISOString()], ["created_by", owner.id]] as const) {
    const r = await creator.client.from("tasks").update({ [col]: val }).eq("id", created.data!.id);
    check(!!r.error, `el cliente no puede escribir la columna ${col}`, r.error?.message);
  }

  const del = await owner.client.from("tasks").delete().eq("id", t4.id).select("id");
  check(!!del.error || (del.data ?? []).length === 0, "el DELETE directo se rechaza, tambien para el Owner", del.error?.message);
  check(!!(await row(t4.id)), "...y la tarea sigue existiendo");

  // Triggers de validacion
  const badOwner = await svc.from("tasks").insert({ workspace_id: ws.id, title: "zz-test", owner_id: outsider.id });
  check(!!badOwner.error && /task_invalid_owner/.test(badOwner.error.message), "el responsable debe ser miembro del workspace", badOwner.error?.message);
  const badFollower = await svc.from("tasks").insert({ workspace_id: ws.id, title: "zz-test", follower_ids: [outsider.id] });
  check(!!badFollower.error && /task_invalid_follower/.test(badFollower.error.message), "los seguidores deben ser miembros", badFollower.error?.message);
  const tooMany = await svc.from("tasks").insert({ workspace_id: ws.id, title: "zz-test", follower_ids: Array.from({ length: 21 }, () => randomUUID()) });
  check(!!tooMany.error, "mas de 20 seguidores se rechaza");
  const norm = await mk({ title: "zz-test normaliza", owner_id: assignee.id, follower_ids: [assignee.id, follower.id, follower.id] });
  check(JSON.stringify(norm.follower_ids) === JSON.stringify([follower.id]), "el responsable se saca de los seguidores y se quitan duplicados");
  const longTitle = await svc.from("tasks").insert({ workspace_id: ws.id, title: "x".repeat(201) });
  check(!!longTitle.error, "titulo de mas de 200 se rechaza (CHECK)");
  const badDates = await svc.from("tasks").insert({ workspace_id: ws.id, title: "zz-test", start_date: D("2026-10-20"), due_date: D("2026-10-10") });
  check(!!badDates.error, "inicio posterior al vencimiento se rechaza (CHECK)");
  const { data: otherContact } = await svc.from("contacts").insert({ workspace_id: ws2!.id, display_name: "zz-test ajeno" }).select("id").single();
  const badContact = await svc.from("tasks").insert({ workspace_id: ws.id, title: "zz-test", contact_id: otherContact!.id });
  check(!!badContact.error && /task_invalid_contact/.test(badContact.error.message), "el contacto debe ser del mismo workspace", badContact.error?.message);

  // completed_at sigue al estado
  const comp = await mk({ title: "zz-test completa" });
  const done = (await svc.from("tasks").update({ status: "completed" }).eq("id", comp.id).select("*").single()).data!;
  check(!!done.completed_at, "al completar se pone completed_at");
  const reopened = (await svc.from("tasks").update({ status: "pending" }).eq("id", comp.id).select("*").single()).data!;
  check(reopened.completed_at === null, "al reabrir se borra completed_at");
  check(new Date(reopened.updated_at) > new Date(comp.updated_at), "updated_at avanza en cada update");

  // Unico parcial de idempotencia
  await mk({ source: "flow", source_ref: "f1:r1:n1" });
  const dup = await svc.from("tasks").insert({ workspace_id: ws.id, title: "zz-test dup", source: "flow", source_ref: "f1:r1:n1" });
  check(!!dup.error, "el mismo (origen, referencia) no crea dos tareas abiertas");

  // F6: una persona que sale del workspace
  const lv = await mk({ title: "zz-test sale", owner_id: leaving.id, follower_ids: [follower.id] });
  await svc.from("tasks").update({ follower_ids: [follower.id, leaving.id] }).eq("id", lv.id);
  const lv2 = await mk({ title: "zz-test sale seguidor", follower_ids: [leaving.id, follower.id] });
  await svc.from("workspace_members").delete().eq("workspace_id", ws.id).eq("user_id", leaving.id);
  const lvAfter = await row(lv.id);
  const lv2After = await row(lv2.id);
  check(lvAfter.owner_id === null && !lvAfter.follower_ids.includes(leaving.id), "al salir una persona, owner_id queda null y se saca de los seguidores");
  check(JSON.stringify(lv2After.follower_ids) === JSON.stringify([follower.id]), "...y los demas seguidores quedan");
  check(lvAfter.status !== "completed", "...sin tocar el estado de la tarea");

  // ═══ 00197 ═════════════════════════════════════════════════════════════════
  if (upTo >= 197) {
    console.log("\n— 00197: completar con corrimientos —");
    const expectedOf = async (...taskIds: string[]) => {
      const { data } = await svc.from("tasks").select("id, updated_at").in("id", taskIds);
      return (data ?? []).map((r: { id: string; updated_at: string }) => ({ task_id: r.id, updated_at: r.updated_at }));
    };
    const rpc = (u: TestUser, fn: string, args: Record<string, unknown>) => u.client.rpc(fn, args);

    const A = await mk({ title: "zz-test A", due_date: D("2026-10-10"), owner_id: creator.id, created_by: creator.id });
    const B = await mk({ title: "zz-test B", due_date: D("2026-10-11"), start_date: D("2026-10-09"), owner_id: creator.id, created_by: creator.id, blocked_by: [] });
    const C = await mk({ title: "zz-test C", due_date: D("2026-10-12"), owner_id: creator.id, created_by: creator.id });
    // Dependencias escritas por el servidor (el cliente no puede escribir blocked_by).
    await svc.from("tasks").update({ blocked_by: [{ task_id: A.id, gap_days: 1 }] }).eq("id", B.id);
    await svc.from("tasks").update({ blocked_by: [{ task_id: B.id, gap_days: 1 }] }).eq("id", C.id);

    // Atomicidad: un corrimiento valido + uno que ADELANTA => no se completa nada.
    let exp = await expectedOf(A.id, B.id, C.id);
    const bad = await rpc(creator, "complete_task_with_shifts", {
      p_task_id: A.id,
      p_shifts: [{ task_id: B.id, due_date: "2026-10-14", start_date: "2026-10-12" }, { task_id: C.id, due_date: "2026-10-01" }],
      p_expected: exp,
    });
    check(bad.data?.ok === false && bad.data?.error === "invalid_shift", "un corrimiento que ADELANTA aborta todo (invalid_shift)", JSON.stringify(bad.data ?? bad.error));
    check((await row(A.id)).status === "pending" && (await row(B.id)).due_date === "2026-10-11", "...y la tarea sigue pendiente y B no se movio (atomicidad)");

    // Una tarea de otro workspace / inexistente en el plan.
    const { data: ws2Task } = await svc.from("tasks").insert({ workspace_id: ws2!.id, title: "zz-test de otro ws", due_date: "2026-10-05" }).select("*").single();
    const crossWs = await rpc(creator, "complete_task_with_shifts", { p_task_id: A.id, p_shifts: [{ task_id: ws2Task!.id, due_date: "2026-10-30" }], p_expected: [...exp, { task_id: ws2Task!.id, updated_at: ws2Task!.updated_at }] });
    check(crossWs.data?.ok === false && crossWs.data?.error === "invalid_shift", "un corrimiento a una tarea de OTRO workspace se rechaza");
    const ghost = await rpc(creator, "complete_task_with_shifts", { p_task_id: A.id, p_shifts: [{ task_id: randomUUID(), due_date: "2026-10-30" }], p_expected: exp });
    check(ghost.data?.ok === false && ghost.data?.error === "invalid_shift", "...y a una inexistente");
    const garbage = await rpc(creator, "complete_task_with_shifts", { p_task_id: A.id, p_shifts: [{ task_id: "no-soy-uuid", due_date: "2026-10-30" }], p_expected: exp });
    check(garbage.data?.ok === false && garbage.data?.error === "invalid_shift", "...y a un id que no es uuid (error tipificado, no una excepcion)", JSON.stringify(garbage.data ?? garbage.error));

    // Un corrimiento a una tarea que NO depende de esta se rechaza (todo o nada), tenga o no permiso la persona. (Desde la
    // 00207 la regla de fechas es del sistema: una DEPENDIENTE ajena si se mueve; ver el bloque de R10 mas abajo.)
    const hidden = await mk({ title: "zz-test oculta para creator", due_date: D("2026-10-11"), owner_id: assignee.id, created_by: owner.id });
    exp = await expectedOf(A.id, B.id, C.id, hidden.id);
    const noPerm = await rpc(creator, "complete_task_with_shifts", { p_task_id: A.id, p_shifts: [{ task_id: hidden.id, due_date: "2026-10-14" }], p_expected: exp });
    check(noPerm.data?.ok === false && noPerm.data?.error === "invalid_shift", "una tarea del plan que no depende de esta (y que la persona no puede editar) rechaza TODO (invalid_shift)");
    check((await row(A.id)).status === "pending", "...y A sigue pendiente");

    // stale: alguien edito B despues de armar el plan.
    exp = await expectedOf(A.id, B.id, C.id);
    await svc.from("tasks").update({ priority: "high" }).eq("id", B.id);
    const stale = await rpc(creator, "complete_task_with_shifts", { p_task_id: A.id, p_shifts: [{ task_id: B.id, due_date: "2026-10-14" }], p_expected: exp });
    check(stale.data?.ok === false && stale.data?.error === "stale" && stale.data?.task_id === B.id, "si alguien edito una tarea del plan: stale", JSON.stringify(stale.data));
    check((await row(A.id)).status === "pending", "...y no se completo nada");

    // Camino feliz con plan.
    exp = await expectedOf(A.id, B.id, C.id);
    const good = await rpc(creator, "complete_task_with_shifts", {
      p_task_id: A.id,
      p_shifts: [{ task_id: B.id, due_date: "2026-10-14", start_date: "2026-10-12" }, { task_id: C.id, due_date: "2026-10-15" }],
      p_expected: exp,
    });
    check(good.data?.ok === true, "con un plan valido: ok", JSON.stringify(good.data ?? good.error));
    const aAfter = await row(A.id);
    const bAfter = await row(B.id);
    const cAfter = await row(C.id);
    check(aAfter.status === "completed" && !!aAfter.completed_at, "A queda completada con completed_at");
    check(bAfter.due_date === "2026-10-14" && bAfter.start_date === "2026-10-12" && cAfter.due_date === "2026-10-15", "B y C se corren (B conserva su duracion)");
    const { data: audit } = await svc.from("audit_log").select("action").eq("entity_type", "task").in("entity_id", [A.id, B.id, C.id]);
    const actions = (audit ?? []).map((r: { action: string }) => r.action).sort();
    check(actions.includes("task.completed") && actions.filter((a: string) => a === "task.date_shifted").length === 2, "queda auditado: 1 completada y 2 corrimientos", actions.join(","));
    const again = await rpc(creator, "complete_task_with_shifts", { p_task_id: A.id, p_shifts: [], p_expected: await expectedOf(A.id) });
    check(again.data?.ok === false && again.data?.error === "already_completed", "completar dos veces: already_completed");

    // Sin plan: solo completa.
    const solo = await mk({ title: "zz-test solo", owner_id: creator.id, created_by: creator.id });
    const soloRes = await rpc(creator, "complete_task_with_shifts", { p_task_id: solo.id, p_shifts: [], p_expected: await expectedOf(solo.id) });
    check(soloRes.data?.ok === true && (await row(solo.id)).status === "completed", "con p_shifts = [] solo completa");

    // ── set_task_blockers ──────────────────────────────────────────────────
    console.log("\n— 00197: dependencias —");
    const X = await mk({ title: "zz-test X", due_date: D("2026-11-01"), owner_id: creator.id, created_by: creator.id });
    const Y = await mk({ title: "zz-test Y", due_date: D("2026-11-05"), owner_id: creator.id, created_by: creator.id });
    const Z = await mk({ title: "zz-test Z", due_date: null, owner_id: creator.id, created_by: creator.id });
    const ok1 = await rpc(creator, "set_task_blockers", { p_task_id: Y.id, p_blockers: [X.id] });
    check(ok1.data?.ok === true && ok1.data?.blocked_by?.[0]?.gap_days === 4, "guarda la dependencia con gap_days = diferencia de vencimientos (4)", JSON.stringify(ok1.data ?? ok1.error));
    const ok2 = await rpc(creator, "set_task_blockers", { p_task_id: Y.id, p_blockers: [{ task_id: X.id }, { task_id: Z.id }] });
    check(ok2.data?.ok === true && ok2.data?.blocked_by?.[1]?.gap_days === 0, "acepta objetos {task_id}; sin fecha en alguna, gap 0", JSON.stringify(ok2.data));
    const self = await rpc(creator, "set_task_blockers", { p_task_id: Y.id, p_blockers: [Y.id] });
    check(self.data?.error === "self", "una tarea no se bloquea a si misma");
    const direct = await rpc(creator, "set_task_blockers", { p_task_id: X.id, p_blockers: [Y.id] });
    check(direct.data?.error === "cycle", "ciclo directo (X -> Y -> X): cycle", JSON.stringify(direct.data));
    const W = await mk({ title: "zz-test W", due_date: D("2026-11-20"), owner_id: creator.id, created_by: creator.id });
    await rpc(creator, "set_task_blockers", { p_task_id: W.id, p_blockers: [Y.id] });
    const indirect = await rpc(creator, "set_task_blockers", { p_task_id: X.id, p_blockers: [W.id] });
    check(indirect.data?.error === "cycle", "ciclo indirecto (X -> Y -> W -> X): cycle", JSON.stringify(indirect.data));
    const diamond = await mk({ title: "zz-test diamante", due_date: D("2026-12-01"), owner_id: creator.id, created_by: creator.id });
    const dm = await rpc(creator, "set_task_blockers", { p_task_id: diamond.id, p_blockers: [Y.id, W.id] });
    check(dm.data?.ok === true, "un diamante es valido", JSON.stringify(dm.data));
    const early = await mk({ title: "zz-test temprana", due_date: D("2026-10-01"), owner_id: creator.id, created_by: creator.id });
    const before = await rpc(creator, "set_task_blockers", { p_task_id: early.id, p_blockers: [X.id] });
    check(before.data?.error === "date_before_blocker", "vencer antes que el bloqueante: date_before_blocker");
    const sameDay = await mk({ title: "zz-test mismo dia", due_date: D("2026-11-01"), owner_id: creator.id, created_by: creator.id });
    const sd = await rpc(creator, "set_task_blockers", { p_task_id: sameDay.id, p_blockers: [X.id] });
    check(sd.data?.ok === true && sd.data?.blocked_by?.[0]?.gap_days === 0, "el mismo dia se acepta (gap 0)");
    const dupe = await rpc(creator, "set_task_blockers", { p_task_id: sameDay.id, p_blockers: [X.id, X.id] });
    check(dupe.data?.error === "duplicate", "duplicados se rechazan");
    const eleven: string[] = [];
    for (let i = 0; i < 11; i++) eleven.push((await mk({ title: `zz-test b${i}`, owner_id: creator.id, created_by: creator.id })).id);
    const many = await rpc(creator, "set_task_blockers", { p_task_id: sameDay.id, p_blockers: eleven });
    check(many.data?.error === "too_many", "mas de 10 bloqueantes se rechaza");
    const ten = await rpc(creator, "set_task_blockers", { p_task_id: sameDay.id, p_blockers: eleven.slice(0, 10) });
    check(ten.data?.ok === true, "10 bloqueantes se acepta");
    const missing = await rpc(creator, "set_task_blockers", { p_task_id: sameDay.id, p_blockers: [ws2Task!.id] });
    check(missing.data?.error === "missing_task", "un bloqueante de OTRO workspace se rechaza (missing_task)");
    const invisible = await rpc(creator, "set_task_blockers", { p_task_id: sameDay.id, p_blockers: [hidden.id] });
    check(invisible.data?.error === "missing_task", "un bloqueante que la persona no ve se rechaza");
    const foreignTask = await rpc(stranger, "set_task_blockers", { p_task_id: sameDay.id, p_blockers: [] });
    check(foreignTask.data?.ok === false, "quien no ve la tarea no puede cambiarle las dependencias");
    const noEdit = await rpc(viewer, "set_task_blockers", { p_task_id: viewerOwn.id, p_blockers: [] });
    check(noEdit.data?.error === "forbidden", "sin `tasks.edit`: forbidden");
    const garbageBlockers = await rpc(creator, "set_task_blockers", { p_task_id: sameDay.id, p_blockers: ["no-soy-uuid"] });
    check(garbageBlockers.data?.error === "invalid", "un id que no es uuid: invalid (no una excepcion)");

    // ── delete_task ────────────────────────────────────────────────────────
    console.log("\n— 00197: borrar —");
    const noDel = await rpc(creator, "delete_task", { p_task_id: X.id });
    check(noDel.data?.error === "forbidden" && !(await row(X.id)).deleted_at, "el Member de sistema NO puede borrar (sin tasks.delete)");
    const yBefore = await row(Y.id);
    const dd = await rpc(admin, "delete_task", { p_task_id: X.id });
    check(dd.data?.ok === true && !!(await row(X.id)).deleted_at, "el Admin borra (borrado logico)", JSON.stringify(dd.data ?? dd.error));
    const yAfter = await row(Y.id);
    check(!JSON.stringify(yAfter.blocked_by).includes(X.id), "...y la saca de los blocked_by de las demas");
    check(yAfter.due_date === yBefore.due_date, "...sin mover fechas");
    check(!(await ids(creator)).includes(X.id) && !(await ids(admin)).includes(X.id), "una tarea borrada no aparece en las consultas");
    const delAgain = await rpc(admin, "delete_task", { p_task_id: X.id });
    check(delAgain.data?.error === "not_found", "borrar dos veces: not_found");
    const delCustom = await rpc(deleter, "delete_task", { p_task_id: await (async () => (await mk({ title: "zz-test del", owner_id: deleter.id, created_by: owner.id })).id)() });
    check(delCustom.data?.ok === true, "un rol personalizado con `tasks.delete` borra lo que ve", JSON.stringify(delCustom.data));
    check(!(await ids(deleter)).includes(t4.id), "el rol que borra (alcance own) no ve una tarea ajena");
    const delStranger = await rpc(deleter, "delete_task", { p_task_id: t4.id });
    check(delStranger.data?.error === "forbidden" || delStranger.data?.error === "not_found", "...pero no lo que no ve", JSON.stringify(delStranger.data ?? delStranger.error));
    const delOutsider = await rpc(outsider, "delete_task", { p_task_id: t4.id });
    check(delOutsider.data?.ok === false && !(await row(t4.id)).deleted_at, "otro workspace no puede borrar", JSON.stringify(delOutsider.data ?? delOutsider.error));

    // ── historial ──────────────────────────────────────────────────────────
    console.log("\n— 00197: el historial de una tarea (audit_log_select_tasks) —");
    const hist = async (u: TestUser, taskId: string) => ((await u.client.from("audit_log").select("id").eq("entity_type", "task").eq("entity_id", taskId)).data ?? []).length;
    check((await hist(creator, B.id)) >= 1, "quien ve la tarea ve su historial");
    check((await hist(stranger, B.id)) === 0, "quien no la ve, no");
    check((await hist(outsider, B.id)) === 0, "otro workspace, no");
    check((await hist(admin, B.id)) >= 1, "Owner/Admin, si");
  }

  // ═══ El nucleo de las acciones, con la base real ═══════════════════════════
  if (upTo >= 197) {
    console.log("\n— El nucleo de las acciones (lib/tasks/core.ts) contra la base real —");
    const TZ = "America/Costa_Rica";
    const cctx: TaskCtx = { supabase: creator.client as never, service: svc as never, workspaceId: ws.id, userId: creator.id, timeZone: TZ };
    const today = todayInputValue(new Date(), TZ);

    const made = await createTaskCore(cctx, { title: "zz-test nucleo A", due_date: "2020-01-01", project: " Proyecto  Zeta " });
    check(made.ok && made.data.owner_id === creator.id && made.data.project_key === "proyecto zeta", "createTask: responsable = quien la crea y proyecto normalizado", JSON.stringify(made));
    if (!made.ok) throw new Error("no se pudo crear A");
    const bMade = await createTaskCore(cctx, { title: "zz-test nucleo B", due_date: "2020-01-02" });
    if (!bMade.ok) throw new Error("no se pudo crear B");
    const cMade = await createTaskCore(cctx, { title: "zz-test nucleo C", due_date: "2020-01-03", owner_id: assignee.id });
    if (!cMade.ok) throw new Error("no se pudo crear C");

    const blk = await setTaskBlockersCore(cctx, bMade.data.id, [made.data.id]);
    check(blk.ok && blk.data[0].gap_days === 1, "setTaskBlockers: B bloqueada por A (gap 1)", JSON.stringify(blk));
    const blk2 = await setTaskBlockersCore(cctx, cMade.data.id, [bMade.data.id]);
    check(blk2.ok, "...y C por B");
    const cyc = await setTaskBlockersCore(cctx, made.data.id, [cMade.data.id]);
    check(!cyc.ok && cyc.code === "cycle", "un ciclo A -> B -> C -> A se rechaza con el codigo `cycle`");

    const early = await updateTaskCore(cctx, bMade.data.id, { due_date: "2019-12-31" });
    check(!early.ok && early.code === "date_before_blocker", "mover B antes que A se rechaza");
    const later = await updateTaskCore(cctx, bMade.data.id, { due_date: "2020-01-05" });
    const bNow = await row(bMade.data.id);
    check(later.ok && bNow.blocked_by[0].gap_days === 4, "mover B despues de A recalcula gap_days (4)", JSON.stringify(bNow.blocked_by));
    const back = await updateTaskCore(cctx, bMade.data.id, { due_date: "2020-01-02" });
    check(back.ok, "(vuelve a 2020-01-02)");
    const toDone = await updateTaskCore(cctx, made.data.id, { status: "completed" });
    check(!toDone.ok && toDone.code === "use_complete", "updateTask no completa: eso va por completeTask");
    const hiddenUpdate = await updateTaskCore({ ...cctx, supabase: stranger.client as never, userId: stranger.id }, made.data.id, { title: "intruso" });
    const missingUpdate = await updateTaskCore({ ...cctx, supabase: stranger.client as never, userId: stranger.id }, "99999999-9999-4999-8999-999999999999", { title: "intruso" });
    check(!hiddenUpdate.ok && JSON.stringify(hiddenUpdate) === JSON.stringify(missingUpdate), "una tarea ajena y una inexistente dan el MISMO error");

    // C pertenece a assignee: creator la ve? (no) -> el plan solo incluye lo que la persona ve
    const plan = await planCompletionCore(cctx, made.data.id);
    check(plan.ok && plan.data.shifts.length === 2 && plan.data.shifts[0].taskId === bMade.data.id && plan.data.shifts[0].toDue === addDays(today, 1) && plan.data.shifts[1].taskId === cMade.data.id && plan.data.shifts[1].toDue === addDays(today, 2), "planCompletion: B pasa a hoy + 1 y C (que depende de B) a hoy + 2, en orden", JSON.stringify(plan.ok ? plan.data.shifts : plan));
    if (!plan.ok) throw new Error("sin plan");
    // Alguien edita B despues de la vista previa => stale
    await svc.from("tasks").update({ priority: "urgent" }).eq("id", bMade.data.id);
    const staleRes = await completeTaskCore(cctx, made.data.id, true, plan.data.expected);
    check(!staleRes.ok && staleRes.code === "stale", "completeTask con una vista previa vieja: stale", JSON.stringify(staleRes));
    check((await row(made.data.id)).status === "pending", "...y A sigue pendiente");
    const doneRes = await completeTaskCore(cctx, made.data.id, true);
    check(doneRes.ok && doneRes.data.shifted.length === 2, "completeTask(aplicando fechas): ok (B y C)", JSON.stringify(doneRes));
    check((await row(bMade.data.id)).due_date === addDays(today, 1) && (await row(cMade.data.id)).due_date === addDays(today, 2), "B y C se movieron en cadena");
    check(doneRes.ok && doneRes.data.unblocked.some((u) => u.task_id === bMade.data.id), "B queda sin bloqueantes pendientes (para avisar)");

    // Sin mover fechas
    const D1 = await createTaskCore(cctx, { title: "zz-test nucleo D1", due_date: "2020-02-01" });
    const D2 = await createTaskCore(cctx, { title: "zz-test nucleo D2", due_date: "2020-02-02" });
    if (D1.ok && D2.ok) {
      await setTaskBlockersCore(cctx, D2.data.id, [D1.data.id]);
      const noMove = await completeTaskCore(cctx, D1.data.id, false);
      check(noMove.ok && (await row(D2.data.id)).due_date === "2020-02-02" && (await row(D1.data.id)).status === "completed", "«completar sin mover fechas» solo completa");
      const reopen = await updateTaskCore(cctx, D1.data.id, { status: "pending" });
      check(reopen.ok && (await row(D1.data.id)).completed_at === null && (await row(D2.data.id)).due_date === "2020-02-02", "reabrir no deshace corrimientos y limpia completed_at");
      const { data: acts } = await svc.from("audit_log").select("action").eq("entity_type", "task").eq("entity_id", D1.data.id);
      const names = (acts ?? []).map((a: { action: string }) => a.action);
      check(names.includes("task.created") && names.includes("task.completed") && names.includes("task.reopened"), "el historial tiene creada, completada y reabierta", names.join(","));
    }

    const delByMember = await deleteTaskCore(cctx, made.data.id);
    check(!delByMember.ok && delByMember.code === "forbidden", "deleteTask: el Member no borra");
    const delByAdmin = await deleteTaskCore({ ...cctx, supabase: admin.client as never, userId: admin.id }, made.data.id);
    check(delByAdmin.ok, "...el Admin si", JSON.stringify(delByAdmin));
  }

  // ═══ 00198: el cron de vencimientos ════════════════════════════════════════
  if (upTo >= 198) {
    console.log("\n— 00198: el cron de vencimientos (private.enqueue_tasks_due_sweep) —");

    // Corre SQL con la CLI (la funcion es de `private`: ninguna sesion la puede llamar).
    const runSql = (query: string): Array<Record<string, unknown>> => {
      const dir = mkdtempSync(join(tmpdir(), "verify-tasks-"));
      const file = join(dir, "q.sql");
      writeFileSync(file, query);
      const r = spawnSync("supabase", ["db", "query", ...dbTargetArgs(), "-f", file], { encoding: "utf8" });
      rmSync(dir, { recursive: true, force: true });
      const out = r.stdout ?? "";
      const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
      try {
        return (JSON.parse(json).rows ?? []) as Array<Record<string, unknown>>;
      } catch {
        throw new Error(`no pude leer la salida de la CLI: ${out.slice(0, 200)} ${r.stderr?.slice(0, 200)}`);
      }
    };

    // Una zona donde ahora son las 08:00 o mas, y otra donde todavia no.
    const hourIn = (tz: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const zones = ["Pacific/Kiritimati", "Pacific/Auckland", "Asia/Tokyo", "Asia/Kolkata", "Europe/Madrid", "UTC", "Atlantic/Azores", "America/Sao_Paulo", "America/Costa_Rica", "America/Los_Angeles", "Pacific/Honolulu", "Pacific/Pago_Pago"];
    const late = zones.find((z) => hourIn(z) >= 8 && hourIn(z) <= 22) as string;
    const early = zones.find((z) => hourIn(z) < 8) as string;
    const localDay = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

    const mkWs = async (tag: string, tz: string) => {
      const { data } = await svc.from("workspaces").insert({ name: `zz-test-cron-${tag}`, slug: `zz-test-cron-${tag}-${stamp}`, timezone: tz }).select("id").single();
      await svc.from("workspace_members").insert({ workspace_id: data!.id, user_id: owner.id, role: "owner" }).then(() => undefined, () => undefined);
      return data!.id as string;
    };
    const wsLate = await mkWs("tarde", late);
    const wsEarly = await mkWs("temprano", early);
    const wsEmpty = await mkWs("vacio", late);
    const wsDone = await mkWs("completadas", late);

    const addTask = async (workspaceId: string, tz: string, extra: Record<string, unknown> = {}) => {
      const { data, error } = await svc.from("tasks").insert({ workspace_id: workspaceId, title: "zz-test cron", due_date: localDay(tz), owner_id: owner.id, ...extra }).select("*").single();
      if (error) throw new Error(`no pude crear la tarea del cron: ${error.message}`);
      return data as Record<string, any>;
    };
    const lateTask = await addTask(wsLate, late);
    await addTask(wsEarly, early);
    await addTask(wsDone, late, { status: "completed" });
    await addTask(wsDone, late, { due_date: "2020-01-01", owner_id: null, follower_ids: [] }); // sin responsable ni seguidores
    void wsEmpty;

    const ids = [wsLate, wsEarly, wsEmpty, wsDone].map((i) => `'${i}'`).join(",");
    const jobsOf = () => runSql(`select dedupe_key, status from public.scheduled_jobs where type = 'tasks_due_sweep' and payload->>'workspace_id' in (${ids}) order by dedupe_key`);

    const first = runSql(`select private.enqueue_tasks_due_sweep() as n`);
    check(typeof first[0]?.n === "number", "la funcion corre sin error y devuelve cuantos jobs encolo", JSON.stringify(first));
    let jobs = jobsOf();
    check(jobs.length === 1 && String(jobs[0].dedupe_key) === `tasks-due:${wsLate}:${localDay(late)}`, `solo el workspace con candidatas y con hora >= 08:00 (${late}) encola, con su clave por dia`, JSON.stringify(jobs));
    check(!jobs.some((j) => String(j.dedupe_key).includes(wsEarly)), `antes de las 08:00 locales (${early}, son las ${hourIn(early)}) no encola`);
    check(!jobs.some((j) => String(j.dedupe_key).includes(wsEmpty) || String(j.dedupe_key).includes(wsDone)), "sin candidatas (sin tareas, completadas, sin responsable ni seguidores) no encola");

    runSql(`select private.enqueue_tasks_due_sweep()`);
    check(jobsOf().length === 1, "correrla de nuevo no duplica el job del dia (dedupe_key)");

    // El job se completo y el handler ya aviso: ya no hay candidatas, aunque corra otra vez ese dia.
    runSql(`update public.scheduled_jobs set status = 'completed' where type = 'tasks_due_sweep' and payload->>'workspace_id' = '${wsLate}'`);
    await svc.from("notifications").insert({ workspace_id: wsLate, type: "task_due_today", title: "zz-test", entity_type: "task", entity_id: lateTask.id, recipient_id: owner.id, metadata: { due_date: localDay(late) } });
    runSql(`select private.enqueue_tasks_due_sweep()`);
    check(jobsOf().length === 1, "con el aviso ya hecho para ese vencimiento, no vuelve a encolar");

    const grant = runSql(`select has_function_privilege('authenticated', 'private.enqueue_tasks_due_sweep()', 'EXECUTE') as a, has_function_privilege('anon', 'private.enqueue_tasks_due_sweep()', 'EXECUTE') as b`);
    check(grant[0]?.a === false && grant[0]?.b === false, "ninguna sesion (authenticated, anon) puede ejecutar la funcion");
    const cron = runSql(`select schedule from cron.job where jobname = 'tasks-due-enqueue'`);
    check(cron.length === 1 && cron[0].schedule === "17 * * * *", "el cron horario esta programado (minuto 17)");
    // El handler real contra la base: avisa una sola vez y cada persona ve SOLO su aviso (F17, F18).
    await svc.from("workspace_members").insert([
      { workspace_id: wsLate, user_id: creator.id, role: "member" },
      { workspace_id: wsLate, user_id: assignee.id, role: "member" },
    ]);
    const mine = await addTask(wsLate, late, { owner_id: creator.id, title: "zz-test vence hoy de creator" });
    const overdue = await addTask(wsLate, late, { owner_id: creator.id, due_date: "2020-01-01", title: "zz-test vencida de creator" });
    await svc.from("notifications").delete().eq("workspace_id", wsLate);
    const dayLate = localDay(late);
    const r1 = await runTasksDueSweep(svc as never, wsLate, dayLate);
    const r2 = await runTasksDueSweep(svc as never, wsLate, dayLate);
    check(r1.dueToday >= 2 && r1.overdue === 1, "el handler avisa lo que vence hoy y lo vencido", JSON.stringify(r1));
    check(r2.dueToday === 0 && r2.overdue === 0, "correrlo otra vez no duplica nada (una vez por tarea y fecha)", JSON.stringify(r2));
    const seen = async (u: TestUser) => ((await u.client.from("notifications").select("type, entity_id, recipient_id").eq("workspace_id", wsLate)).data ?? []) as Array<{ type: string; entity_id: string; recipient_id: string }>;
    const creatorSees = await seen(creator);
    check(creatorSees.length === 2 && creatorSees.every((n) => n.recipient_id === creator.id) && creatorSees.some((n) => n.entity_id === mine.id && n.type === "task_due_today") && creatorSees.some((n) => n.entity_id === overdue.id && n.type === "task_overdue"), "un Member ve SUS avisos (vence hoy y vencida)", JSON.stringify(creatorSees));
    const assigneeSees = await seen(assignee);
    check(assigneeSees.length === 0, "otro Member del mismo workspace no ve los avisos ajenos", JSON.stringify(assigneeSees));
    // Un aviso de tarea dirigido a una persona lo ve esa persona aunque no vea la tarea (can_see_notification: recipient_id = yo).
    await createNotification({ supabase: svc as never, workspaceId: wsLate, type: "task_assigned", title: "zz-test te asignaron", entityType: "task", entityId: mine.id, recipientId: assignee.id });
    const assigneeAfter = await seen(assignee);
    check(assigneeAfter.length === 1, "un aviso dirigido a una persona lo ve esa persona, aunque no pueda ver la tarea", JSON.stringify(assigneeAfter));
    // Limpieza de lo que encolo la funcion (por si algun workspace real tuviera candidatas, no se toca: solo los de prueba).
    runSql(`delete from public.scheduled_jobs where type = 'tasks_due_sweep' and payload->>'workspace_id' in (${ids})`);
  }

  // ═══ 00199: los disparadores task_completed / task_overdue, tambien sin contacto ═══
  if (upTo >= 199) {
    console.log("\n— 00199: disparadores de tareas (con y sin contacto) —");
    const mkTrigger = (type: string) => svc.from("triggers").insert({ workspace_id: ws.id, flow_id: flow199!.id, type, config: {}, is_active: false });
    const { data: flow199 } = await svc.from("flows").insert({ workspace_id: ws.id, name: "zz-test flujo tareas 199", status: "draft", nodes: [], edges: [] }).select("id").single();
    check(!!flow199, "se crea un flujo de prueba");
    for (const type of ["task_completed", "task_overdue", "sale_created", "eod_submitted"]) {
      const { error } = await mkTrigger(type);
      check(!error, `triggers_type_check acepta «${type}»`, error?.message);
    }
    const { error: badType } = await mkTrigger("task_inventado");
    check(!!badType, "un tipo inventado se sigue rechazando");

    const ev = (extra: Record<string, unknown>) => svc.from("automation_events").insert({ workspace_id: ws.id, payload: {}, ...extra });
    check(!(await ev({ event_type: "task_completed", contact_id: null, member_user_id: owner.id })).error, "un evento task_completed sin contacto y con persona se acepta");
    check(!(await ev({ event_type: "task_overdue", contact_id: null, member_user_id: owner.id })).error, "un evento task_overdue sin contacto y con persona se acepta");
    check(!!(await ev({ event_type: "task_completed", contact_id: null, member_user_id: null })).error, "sin contacto Y sin persona se rechaza");
    check(!!(await ev({ event_type: "tag_added", contact_id: null, member_user_id: owner.id })).error, "un evento de contacto sin contacto se sigue rechazando");
    await svc.from("automation_events").delete().eq("workspace_id", ws.id);

    // De punta a punta con el motor real: completar una tarea SIN contacto corre un flujo publicado, sin contacto,
    // y su paso «Crear tarea» deja una tarea nueva de origen `flow`.
    const trigNode = { id: "t1", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "task_completed", config: {} } };
    const taskNode = { id: "n1", type: "create_task", position: { x: 0, y: 120 }, data: { title: "zz-test seguimiento de {{task.title}}", owner: "member", dueMode: "days", dueDays: 2, priority: "normal" } };
    const nodes = [trigNode, taskNode];
    const edges = [{ id: "e1", source: "t1", target: "n1" }];
    await svc.from("triggers").delete().eq("flow_id", flow199!.id);
    await svc.from("flows").update({ status: "published", nodes: nodes as never, edges: edges as never }).eq("id", flow199!.id);
    const desired = buildDesiredTriggers(nodes as unknown as Array<Record<string, unknown>>, flow199!.id);
    await svc.from("triggers").insert(desired.map((t) => ({ ...t, workspace_id: ws.id, is_active: true })));

    const ctx199: TaskCtx = { supabase: owner.client as never, service: svc as never, workspaceId: ws.id, userId: owner.id, timeZone: "America/Costa_Rica" };
    const made = await createTaskCore(ctx199, { title: "zz-test sin contacto", owner_id: owner.id });
    check(made.ok, "se crea una tarea sin contacto", JSON.stringify(made));
    if (made.ok) {
      const done = await completeTaskCore(ctx199, made.data.id, false);
      check(done.ok, "se completa", JSON.stringify(done));
      const { data: events } = await svc.from("automation_events").select("id, workspace_id, event_type, contact_id, member_user_id, payload").eq("workspace_id", ws.id).eq("event_type", "task_completed");
      check(events?.length === 1 && events[0].contact_id === null && events[0].member_user_id === owner.id, "completar emite UN task_completed sobre la persona a cargo, sin contacto", JSON.stringify(events));
      const payload = (events?.[0]?.payload ?? {}) as Record<string, unknown>;
      check(!("booking_id" in payload) && Object.values(payload).every((v) => v === null || ["string", "number", "boolean"].includes(typeof v)), "el payload lleva solo escalares y nunca booking_id", JSON.stringify(payload));
      let fired = 0;
      for (const e of events ?? []) fired += await processEvent(svc as never, e as unknown as AutomationEvent);
      check(fired === 1, "el motor real dispara el flujo publicado", String(fired));
      const { data: sessions } = await svc.from("flow_sessions").select("contact_id, member_user_id").eq("flow_id", flow199!.id);
      check(sessions?.length === 1 && sessions[0].contact_id === null && sessions[0].member_user_id === owner.id, "la sesion es sin contacto, sobre la persona", JSON.stringify(sessions));
      const { data: created } = await svc.from("tasks").select("title, source, owner_id, due_date").eq("workspace_id", ws.id).eq("source", "flow").like("title", "zz-test seguimiento%");
      check(created?.length === 1 && created[0].title === "zz-test seguimiento de zz-test sin contacto" && created[0].owner_id === owner.id && !!created[0].due_date, "el paso «Crear tarea» deja una tarea de origen flow, a cargo de la persona", JSON.stringify(created));
      let again = 0;
      for (const e of events ?? []) again += await processEvent(svc as never, e as unknown as AutomationEvent);
      check(again === 0, "el mismo evento no dispara dos veces (trigger_fires)", String(again));
    }
  }

  // ═══ 00206: hora, duracion y el seguimiento unico (Tareas × CRM, M1) ═══
  if (upTo >= 206) {
    console.log("\n— 00206: hora, duracion y seguimiento unico —");

    // La sesion de una persona puede escribir las dos columnas nuevas (privilegios por columna).
    const ins = await creator.client.from("tasks").insert({ workspace_id: ws.id, title: "zz-test con hora", created_by: creator.id, owner_id: creator.id, due_date: D("2026-10-20"), due_time: "14:30", duration_minutes: 45 }).select("id, due_time, duration_minutes").single();
    check(!ins.error && ins.data?.due_time === "14:30:00" && ins.data?.duration_minutes === 45, "un Member crea una tarea con hora y duracion por su sesion", ins.error?.message);
    const timedId = ins.data!.id as string;
    const upd = await creator.client.from("tasks").update({ due_time: "09:15", duration_minutes: 90 }).eq("id", timedId).select("due_time, duration_minutes").single();
    check(!upd.error && upd.data?.due_time === "09:15:00" && upd.data?.duration_minutes === 90, "...y las edita", upd.error?.message);

    // Las restricciones de la base.
    const noDate = await creator.client.from("tasks").insert({ workspace_id: ws.id, title: "zz-test hora sin fecha", created_by: creator.id, due_time: "10:00" });
    check(noDate.error?.code === "23514", "una hora sin fecha la rechaza la base (CHECK)", noDate.error?.message);
    const clearDate = await creator.client.from("tasks").update({ due_date: null }).eq("id", timedId);
    check(clearDate.error?.code === "23514", "borrar la fecha dejando la hora tambien (la accion borra las dos juntas)", clearDate.error?.message);
    const clearBoth = await creator.client.from("tasks").update({ due_date: null, due_time: null, duration_minutes: null }).eq("id", timedId);
    check(!clearBoth.error, "borrar fecha, hora y duracion juntas si pasa", clearBoth.error?.message);
    for (const bad of [4, 1441, 0, -5]) {
      const r = await creator.client.from("tasks").update({ duration_minutes: bad }).eq("id", timedId);
      check(r.error?.code === "23514", `la duracion ${bad} se rechaza (5 a 1440)`, r.error?.message);
    }
    check(!(await creator.client.from("tasks").update({ duration_minutes: 5 }).eq("id", timedId)).error && !(await creator.client.from("tasks").update({ duration_minutes: 1440 }).eq("id", timedId)).error, "5 y 1440 minutos valen");

    // La hora se conserva cuando el dia se mueve por la regla de fechas.
    const blocker = await mk({ title: "zz-test bloqueante con hora", due_date: D("2026-10-10"), due_time: "08:00", owner_id: creator.id, created_by: creator.id });
    const dependent = await mk({ title: "zz-test dependiente con hora", due_date: D("2026-10-11"), due_time: "16:45", duration_minutes: 60, owner_id: creator.id, created_by: creator.id });
    await svc.from("tasks").update({ blocked_by: [{ task_id: blocker.id, gap_days: 1 }] }).eq("id", dependent.id);
    const cctx206: TaskCtx = { supabase: creator.client as never, service: svc as never, workspaceId: ws.id, userId: creator.id, timeZone: "America/Costa_Rica" };
    const plan206 = await planCompletionCore(cctx206, blocker.id);
    check(plan206.ok && plan206.data.shifts.length === 1, "completar el bloqueante atrasa al dependiente", JSON.stringify(plan206));
    if (plan206.ok) {
      const done206 = await completeTaskCore(cctx206, blocker.id, true, plan206.data.expected);
      check(done206.ok, "se completa moviendo las fechas", JSON.stringify(done206));
      const moved = await row(dependent.id);
      check(moved.due_date !== "2026-10-11" && moved.due_time === "16:45:00" && moved.duration_minutes === 60, "el dia se movio y la hora y la duracion se conservaron", JSON.stringify(moved));
    }

    // El seguimiento unico (uq_tasks_followup).
    const { data: contact } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test contacto seguimiento", email: `zz-test-seg-${stamp}@example.test` }).select("id").single();
    const { data: contact2 } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test otro contacto", email: `zz-test-seg2-${stamp}@example.test` }).select("id").single();
    const fu = (contactId: string, ref: string, extra: Record<string, unknown> = {}) =>
      svc.from("tasks").insert({ workspace_id: ws.id, title: "zz-test seguimiento", contact_id: contactId, source: "manual", source_ref: ref, ...extra }).select("id").single();
    const first = await fu(contact!.id, "followup:2026-10-20");
    check(!first.error, "se crea un seguimiento", first.error?.message);
    const dup = await fu(contact!.id, "followup:2026-10-20");
    check(dup.error?.code === "23505", "otro del mismo contacto y fecha lo rechaza el indice unico", dup.error?.message);
    check(!(await fu(contact!.id, "followup:2026-10-21")).error, "otra fecha del mismo contacto vale");
    check(!(await fu(contact2!.id, "followup:2026-10-20")).error, "la misma fecha de OTRO contacto vale");
    await svc.from("tasks").update({ status: "completed" }).eq("id", first.data!.id);
    check((await fu(contact!.id, "followup:2026-10-20")).error?.code === "23505", "una seguimiento COMPLETADO sigue ocupando la fecha");
    await svc.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", first.data!.id);
    check(!(await fu(contact!.id, "followup:2026-10-20")).error, "una seguimiento BORRADO libera la fecha");

    // La accion: idempotente y concurrente.
    const octx: TaskCtx = { supabase: owner.client as never, service: svc as never, workspaceId: ws.id, userId: owner.id, timeZone: "America/Costa_Rica" };
    const { data: contact3 } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Ana Seguimiento", email: `zz-test-seg3-${stamp}@example.test` }).select("id").single();
    const results = await Promise.all(Array.from({ length: 10 }, () => createFollowupTaskCore(octx, contact3!.id, "2026-11-03")));
    const okIds = new Set(results.filter((r) => r.ok).map((r) => (r as { data: { task: { id: string } } }).data.task.id));
    const { data: rows } = await svc.from("tasks").select("id, title, due_date, owner_id, source, source_ref").eq("contact_id", contact3!.id).like("source_ref", "followup:%");
    check(results.every((r) => r.ok) && okIds.size === 1 && rows?.length === 1, "10 creaciones simultaneas dejan UNA sola tarea y todas devuelven esa misma", JSON.stringify({ okIds: [...okIds], rows: rows?.length, errs: results.filter((r) => !r.ok) }));
    check(rows?.[0]?.title === "Seguimiento a zz-test Ana Seguimiento" && rows?.[0]?.due_date === "2026-11-03" && rows?.[0]?.owner_id === owner.id && rows?.[0]?.source === "manual", "titulo, fecha, responsable y origen son los esperados", JSON.stringify(rows?.[0]));
    check(results.filter((r) => r.ok && !(r as { data: { existing: boolean } }).data.existing).length === 1, "exactamente una la creo; las demas devolvieron la existente");

    // Una persona que no ve el contacto no puede crear el seguimiento.
    const sctx: TaskCtx = { supabase: stranger.client as never, service: svc as never, workspaceId: ws.id, userId: stranger.id, timeZone: "America/Costa_Rica" };
    const blocked = await createFollowupTaskCore(sctx, contact3!.id, "2026-11-04");
    check(!blocked.ok, "un Member que no ve al contacto no puede crearle un seguimiento", JSON.stringify(blocked));
    check(((await svc.from("tasks").select("id").eq("contact_id", contact3!.id).eq("source_ref", "followup:2026-11-04")).data ?? []).length === 0, "...y no se escribio nada");
  }

  // ═══ R5: la cobranza con tareas, de punta a punta (flujos publicados de verdad + motor real) ═══
  if (upTo >= 206) {
    console.log("\n— R5: crear una tarea cuando un pago vence, de punta a punta —");
    const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const { data: prodP } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test Producto cobranza", product_type: "programa" }).select("id").single();
    const { data: variantP } = await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prodP!.id, name: "Estandar", price: 1000 }).select("id").single();
    const { data: contactP } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Ana Cobranza", email: `zz-test-cob-${stamp}@example.test` }).select("id").single();
    const snapshot = { product_id: prodP!.id, product_name: "zz-test Producto cobranza", product_type: "programa", variant_id: variantP!.id, variant_name: "Estandar", price: 1000, currency: "USD", duration_type: "lifetime", duration_value: null, billing_type: "one_time", billing_interval: null, event_date: null };
    const optionSnapshot = { method_key: "wise", method_name: "Wise", provider_fee_percent: 0, provider_fee_fixed: 0 };
    const reservation = { type: "reservation", amount: 100, status: "paid", due_date: ayer, paid_at: `${ayer}T15:00:00Z`, paid_on: ayer, payment_method: "wise", payment_option_snapshot: optionSnapshot, provider_fee_amount: 0 };
    const installments = [1, 2].map((n) => ({ type: "installment", amount: 450, status: "scheduled", due_date: `2031-0${n}-15` }));
    const sale = await svc.rpc("create_sale", {
      p_payload: { workspace_id: ws.id, contact_id: contactP!.id, product_variant_id: variantP!.id, product_snapshot: snapshot, base_amount: 1000, discount_amount: 0, financing_type: "reservation_installments", sale_date: ayer, setter_id: null, vendedor_id: assignee.id, attribution: { mode: "last_touch" }, payments: [reservation, ...installments] },
      p_actor_id: owner.id,
    });
    check(!sale.error && !!sale.data?.sale_id, "se crea una venta de prueba con vendedor y dos cuotas", sale.error?.message);
    const saleId = sale.data!.sale_id as string;
    const { data: cuotas } = await svc.from("payments").select("id, status").eq("sale_id", saleId).eq("status", "scheduled").order("due_date");
    const [cuota1, cuota2] = cuotas ?? [];

    // Prender: se crean y se publican los dos flujos de verdad.
    const on = await ensureTaskPaymentFlows(svc as never, ws.id, { enabled: true, userId: owner.id });
    check(on.ok && on.state.enabled && on.state.flows.length === 2 && on.state.flows.every((f) => f.status === "published"), "prender crea y publica los dos flujos", JSON.stringify(on));
    const versionsOf = async () => ((await svc.from("flows").select("id, status, version, template_key").eq("workspace_id", ws.id).in("template_key", ["task_payment_overdue", "task_payment_paid_close"]).order("template_key")).data ?? []) as Array<{ id: string; status: string; version: number; template_key: string }>;
    const versionsFirst = await versionsOf();
    const on2 = await ensureTaskPaymentFlows(svc as never, ws.id, { enabled: true, userId: owner.id });
    const flowsAfter = await versionsOf();
    check(on2.ok && flowsAfter.length === 2 && JSON.stringify(flowsAfter) === JSON.stringify(versionsFirst), "prender otra vez es idempotente: dos flujos, sin nueva version", JSON.stringify({ versionsFirst, flowsAfter }));
    const flowIds = (flowsAfter ?? []).map((f: { id: string }) => f.id);
    const { data: trig } = await svc.from("triggers").select("type, config, is_active").in("flow_id", flowIds);
    check(trig?.length === 2 && trig.every((t: { type: string; is_active: boolean }) => t.type === "payment_status_changed" && t.is_active), "con sus dos disparadores activos", JSON.stringify(trig));
    check(JSON.stringify((await getPaymentTasksState(svc as never, ws.id)).enabled) === "true", "el estado se lee del flujo publicado");

    const eventsOfPayment = async (paymentId: string, to: string) =>
      ((await svc.from("automation_events").select("id, workspace_id, event_type, contact_id, member_user_id, payload").eq("contact_id", contactP!.id).eq("event_type", "payment_status_changed")).data ?? [])
        .filter((e: { payload: Record<string, unknown> }) => e.payload.payment_id === paymentId && e.payload.to_status === to);
    const fire = async (events: unknown[]) => {
      let n = 0;
      for (const e of events) n += await processEvent(svc as never, e as AutomationEvent);
      return n;
    };
    const taskOf = async (paymentId: string) => ((await svc.from("tasks").select("*").eq("workspace_id", ws.id).eq("source_ref", `payment:${paymentId}`)).data ?? []) as Array<Record<string, any>>;

    // El pago vence: una tarea para el vendedor.
    await svc.from("payments").update({ status: "overdue" }).eq("id", cuota1.id);
    const overdueEvents = await eventsOfPayment(cuota1.id, "overdue");
    check(overdueEvents.length === 1, "el pago vencido emite UN payment_status_changed", String(overdueEvents.length));
    check((await fire(overdueEvents)) >= 1, "el motor dispara el flujo");
    let tasks = await taskOf(cuota1.id);
    check(tasks.length === 1, "se crea UNA tarea con la clave payment:<id>", JSON.stringify(tasks));
    const t = tasks[0] ?? {};
    check(t.title === "Cobrar cuota de zz-test · zz-test Producto cobranza" && t.owner_id === assignee.id && t.priority === "high" && t.project === "Cobranza" && t.source === "flow" && t.contact_id === contactP!.id, "con titulo, vendedor, prioridad, proyecto y contacto esperados", JSON.stringify(t));
    check(t.due_date === todayInputValue(new Date(), "America/Costa_Rica"), "vence hoy (en la zona del workspace)", String(t.due_date));
    check(String(t.description ?? "").includes("$450,00") || String(t.description ?? "").includes("450"), "la descripcion lleva el monto", String(t.description));

    // Idempotencia: el mismo evento no dispara dos veces; y si el pago vuelve a pasar a vencido con la tarea abierta, no se duplica.
    check((await fire(overdueEvents)) === 0, "el mismo evento no dispara dos veces");
    await svc.from("payments").update({ status: "scheduled" }).eq("id", cuota1.id);
    await svc.from("payments").update({ status: "overdue" }).eq("id", cuota1.id);
    const again = await eventsOfPayment(cuota1.id, "overdue");
    check(again.length === 2, "volver a vencer emite otro evento", String(again.length));
    await fire(again);
    check((await taskOf(cuota1.id)).length === 1, "...y la tarea abierta NO se duplica");

    // Se cobra: la tarea queda completada sola.
    await svc.from("payments").update({ status: "paid", paid_at: new Date().toISOString(), paid_on: ayer, payment_method: "wise", provider_fee_amount: 0 }).eq("id", cuota1.id);
    const paidEvents = await eventsOfPayment(cuota1.id, "paid");
    check(paidEvents.length === 1, "cobrar emite UN payment_status_changed a paid");
    await fire(paidEvents);
    tasks = await taskOf(cuota1.id);
    check(tasks.length === 1 && tasks[0].status === "completed" && !!tasks[0].completed_at, "la tarea queda completada sola", JSON.stringify(tasks));
    const { data: audit } = await svc.from("audit_log").select("actor_type, action").eq("entity_id", tasks[0].id).eq("action", "task.completed");
    check(audit?.length === 1 && audit[0].actor_type === "system", "con el sistema como actor en el historial", JSON.stringify(audit));

    // Si una persona ya la habia completado, no pasa nada.
    await svc.from("payments").update({ status: "overdue" }).eq("id", cuota2.id);
    await fire(await eventsOfPayment(cuota2.id, "overdue"));
    const manual = (await taskOf(cuota2.id))[0];
    check(!!manual, "el segundo pago vencido deja su propia tarea");
    await svc.from("tasks").update({ status: "completed" }).eq("id", manual.id);
    const completedAt = (await row(manual.id)).completed_at;
    await svc.from("payments").update({ status: "paid", paid_at: new Date().toISOString(), paid_on: ayer, payment_method: "wise", provider_fee_amount: 0 }).eq("id", cuota2.id);
    await fire(await eventsOfPayment(cuota2.id, "paid"));
    const after = await row(manual.id);
    check(after.status === "completed" && after.completed_at === completedAt, "si una persona ya la completo, cobrar no cambia nada");
    check(((await svc.from("audit_log").select("id").eq("entity_id", manual.id).eq("action", "task.completed")).data ?? []).length === 0, "...ni deja otra entrada en el historial");

    // Apagar: los flujos vuelven a borrador, sin disparadores, y las tareas quedan.
    const off = await ensureTaskPaymentFlows(svc as never, ws.id, { enabled: false });
    const { data: flowsOff } = await svc.from("flows").select("status").in("id", flowIds);
    check(off.ok && !off.state.enabled && flowsOff?.length === 2 && flowsOff.every((f: { status: string }) => f.status === "draft"), "apagar pasa los dos a borrador (no los borra)", JSON.stringify(off));
    check(((await svc.from("triggers").select("id").in("flow_id", flowIds)).data ?? []).length === 0, "y les saca los disparadores");
    check((await taskOf(cuota1.id)).length === 1 && (await taskOf(cuota2.id)).length === 1, "las tareas ya creadas quedan");
    // Con el interruptor apagado, un pago que vence no crea nada.
    const cuotas3 = [3, 4].map((n) => ({ type: "installment", amount: 10, status: "scheduled", sale_id: saleId, workspace_id: ws.id, due_date: `2031-0${n}-20` }));
    const { data: extraPay } = await svc.from("payments").insert(cuotas3).select("id");
    await svc.from("payments").update({ status: "overdue" }).eq("id", extraPay![0].id);
    await fire(await eventsOfPayment(extraPay![0].id, "overdue"));
    check((await taskOf(extraPay![0].id)).length === 0, "apagado, un pago que vence no crea ninguna tarea");
  }

  // ═══ 00207: la regla de fechas es del sistema (R10) ═══
  if (upTo >= 207) {
    console.log("\n— 00207: la regla de fechas mueve tambien las dependientes que no se ven —");
    const TZ = "America/Costa_Rica";
    const ctxOf = (u: TestUser): TaskCtx => ({ supabase: u.client as never, service: svc as never, workspaceId: ws.id, userId: u.id, timeZone: TZ });
    const mkChain = async (tag: string) => {
      // A es del Member `creator`; B y C dependen de A pero son de OTRA persona (assignee) y el Member no las ve.
      const a = await mk({ title: `zz-test ${tag} A`, due_date: D("2026-10-10"), owner_id: creator.id, created_by: creator.id });
      const b = await mk({ title: `zz-test ${tag} B secreta`, due_date: D("2026-10-11"), due_time: "09:15", duration_minutes: 30, owner_id: assignee.id, created_by: owner.id });
      const c = await mk({ title: `zz-test ${tag} C secreta`, due_date: D("2026-10-12"), owner_id: assignee.id, follower_ids: [follower.id], created_by: owner.id });
      await svc.from("tasks").update({ blocked_by: [{ task_id: a.id, gap_days: 1 }] }).eq("id", b.id);
      await svc.from("tasks").update({ blocked_by: [{ task_id: b.id, gap_days: 1 }] }).eq("id", c.id);
      return { a, b, c };
    };

    const one = await mkChain("r10");
    check(((await creator.client.from("tasks").select("id").in("id", [one.b.id, one.c.id])).data ?? []).length === 0, "el Member NO ve las dependientes ajenas (consulta directa)");

    // task_shift_context: devuelve las dependientes, sin titulo, y nada fuera del arbol.
    const unrelated = await mk({ title: "zz-test r10 ajena fuera del arbol", due_date: D("2026-10-11"), owner_id: assignee.id, created_by: owner.id });
    const ctxRes = await creator.client.rpc("task_shift_context", { p_task_id: one.a.id });
    const list = (ctxRes.data?.tasks ?? []) as Array<Record<string, any>>;
    check(ctxRes.data?.ok === true && list.map((t) => t.id).sort().join() === [one.b.id, one.c.id].sort().join(), "task_shift_context devuelve las dos dependientes (transitivas) y nada fuera del arbol", JSON.stringify(ctxRes.data ?? ctxRes.error));
    check(list.every((t) => t.visible === false && t.title === null), "...sin titulo, porque el Member no las ve");
    check(!JSON.stringify(ctxRes.data).includes("secreta") && !JSON.stringify(ctxRes.data).includes("description"), "...ni descripciones ni nada que las delate");
    check(list.every((t) => "owner_id" in t && "follower_ids" in t && "updated_at" in t && "due_time" in t), "...pero si lo que la regla necesita (responsable, seguidores, hora, updated_at)");
    check(!list.some((t) => t.id === unrelated.id), "una tarea ajena que no depende de esta no aparece");

    // Completar: el Member mueve las fechas de las ajenas sin poder verlas ni editarlas.
    const cc = ctxOf(creator);
    const plan = await planCompletionCore(cc, one.a.id);
    check(plan.ok && plan.data.shifts.length === 2 && plan.data.hiddenShifts === 2 && plan.data.shifts.every((x) => x.title === "" && !x.visible), "el plan del Member incluye a las dos ajenas, sin titulo, como «de otras personas»", JSON.stringify(plan));
    const done = await completeTaskCore(cc, one.a.id, true, plan.ok ? plan.data.expected : undefined);
    check(done.ok, "el Member completa su tarea moviendo las fechas", JSON.stringify(done));
    if (done.ok) {
      check(done.data.shifted.length === 0 && done.data.hiddenShifted === 2 && done.data.movedRows.length === 0 && !JSON.stringify(done.data).includes("secreta"), "...y la respuesta solo las cuenta (sin ids, titulos ni fechas de las ajenas)", JSON.stringify(done.data));
    }
    const bAfter = await row(one.b.id);
    const cAfter = await row(one.c.id);
    // La regla de fechas corre desde HOY (en la zona del negocio): B queda a un dia de hoy y C a un dia de B. Antes estaba
    // escrito a fuego («B al 14, C al 15»), que solo era cierto el dia en que se escribio el script (13/10/2026).
    const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const wantB = plusDays(todayLocal, 1);
    const wantC = plusDays(todayLocal, 2);
    check(bAfter.due_date === wantB && cAfter.due_date === wantC, `las fechas de las dependientes ajenas se corrigieron (B a hoy + 1 = ${wantB}, C a hoy + 2 = ${wantC})`, `${bAfter.due_date} ${cAfter.due_date}`);
    check(bAfter.due_time === "09:15:00" && bAfter.duration_minutes === 30, "y B conservo su hora y su duracion");
    check(((await creator.client.from("tasks").select("id").in("id", [one.b.id, one.c.id])).data ?? []).length === 0, "el Member SIGUE sin poder leerlas");
    const edit = await creator.client.from("tasks").update({ title: "zz-test hackeada" }).eq("id", one.b.id).select("id");
    check((edit.data ?? []).length === 0 && (await row(one.b.id)).title === `zz-test r10 B secreta`, "...ni editarlas");

    const noticesOf = async (recipient: string) => ((await svc.from("notifications").select("type, entity_id, title").eq("recipient_id", recipient).eq("workspace_id", ws.id)).data ?? []) as Array<{ type: string; entity_id: string; title: string }>;
    const assigneeNotices = (await noticesOf(assignee.id)).filter((n) => n.type === "task_date_moved" && [one.b.id, one.c.id].includes(n.entity_id));
    check(assigneeNotices.map((n) => n.entity_id).sort().join() === [one.b.id, one.c.id].sort().join(), "el dueno de las dos recibe task_date_moved por cada una", JSON.stringify(assigneeNotices));
    check((await noticesOf(follower.id)).some((n) => n.type === "task_date_moved" && n.entity_id === one.c.id), "el seguidor de C tambien")
    check((await noticesOf(creator.id)).filter((n) => n.type === "task_date_moved").length === 0, "y quien completo NO recibe el aviso de su propio cambio");
    const { data: shiftAudit } = await svc.from("audit_log").select("action, performed_by, metadata").eq("entity_id", one.b.id).eq("action", "task.date_shifted");
    check(shiftAudit?.length === 1 && shiftAudit[0].performed_by === creator.id && shiftAudit[0].metadata?.caused_by_task_id === one.a.id && shiftAudit[0].metadata?.reason === "dependencia completada", "el historial de B dice que la movio quien completo, y por que", JSON.stringify(shiftAudit));

    // Un corrimiento fuera del arbol hace fallar TODO (atomicidad), incluso si la tarea es visible y editable.
    const a2 = await mk({ title: "zz-test r10 A2", due_date: D("2026-10-10"), owner_id: creator.id, created_by: creator.id });
    const mine = await mk({ title: "zz-test r10 mia fuera del arbol", due_date: D("2026-10-11"), owner_id: creator.id, created_by: creator.id });
    const expOf = async (...ids: string[]) => ((await svc.from("tasks").select("id, updated_at").in("id", ids)).data ?? []).map((r: { id: string; updated_at: string }) => ({ task_id: r.id, updated_at: r.updated_at }));
    for (const [label, target] of [["ajena", unrelated.id], ["propia (visible y editable)", mine.id]] as const) {
      const out = await creator.client.rpc("complete_task_with_shifts", { p_task_id: a2.id, p_shifts: [{ task_id: target, due_date: "2030-01-01" }], p_expected: await expOf(a2.id, target) });
      check(out.data?.ok === false && out.data?.error === "invalid_shift", `un corrimiento a una tarea ${label} que no depende de esta se rechaza`, JSON.stringify(out.data ?? out.error));
    }
    check((await row(a2.id)).status === "pending" && (await row(unrelated.id)).due_date === "2026-10-11" && (await row(mine.id)).due_date === "2026-10-11", "...y no se completo ni se movio nada (atomicidad)");

    // Solo se puede completar un bloqueante que se ve Y se puede editar.
    const secret = await mk({ title: "zz-test r10 bloqueante ajeno", due_date: D("2026-10-10"), owner_id: assignee.id, created_by: owner.id });
    const forbiddenCtx = await creator.client.rpc("task_shift_context", { p_task_id: secret.id });
    check(forbiddenCtx.data?.ok === false && forbiddenCtx.data?.error === "forbidden", "task_shift_context de un bloqueante que el Member no ve: rechazado");
    const forbiddenDone = await creator.client.rpc("complete_task_with_shifts", { p_task_id: secret.id, p_shifts: [], p_expected: await expOf(secret.id) });
    check(forbiddenDone.data?.ok === false && forbiddenDone.data?.error === "forbidden", "completar un bloqueante que no ve: rechazado");
    const viewerOwn = await mk({ title: "zz-test r10 del viewer", due_date: D("2026-10-10"), owner_id: viewer.id, created_by: owner.id });
    const viewerDone = await viewer.client.rpc("complete_task_with_shifts", { p_task_id: viewerOwn.id, p_shifts: [], p_expected: await expOf(viewerOwn.id) });
    check(viewerDone.data?.ok === false && viewerDone.data?.error === "forbidden", "completar una que ve pero NO puede editar (solo tasks.view): rechazado");
    check((await viewer.client.rpc("task_shift_context", { p_task_id: viewerOwn.id })).data?.error === "forbidden", "...y su contexto tambien");
    check((await outsider.client.rpc("task_shift_context", { p_task_id: one.a.id })).data?.ok === false, "alguien de otro workspace no obtiene nada");
    check((await svc.rpc("task_shift_context", { p_task_id: one.a.id })).data?.error === "forbidden", "sin sesion de persona (service role) tampoco: forbidden");

    // El plan es el mismo lo calcule un Member o un Administrador.
    const two = await mkChain("r10b");
    const planMember = await planCompletionCore(ctxOf(creator), two.a.id);
    const planAdmin = await planCompletionCore(ctxOf(admin), two.a.id);
    const dates = (p: typeof planMember) => (p.ok ? p.data.shifts.map((x) => [x.taskId, x.fromDue, x.toDue, x.days, x.blockerId]) : null);
    check(!!dates(planMember) && JSON.stringify(dates(planMember)) === JSON.stringify(dates(planAdmin)), "el plan de fechas es el mismo para un Member y para un Administrador", JSON.stringify({ m: dates(planMember), a: dates(planAdmin) }));
    check(planAdmin.ok && planAdmin.data.hiddenShifts === 0 && planAdmin.data.shifts.every((x) => x.visible && x.title !== ""), "...salvo que el Administrador ve los titulos de todas");
  }
} catch (error) {
  fail("la verificación se cortó", error instanceof Error ? error.stack : String(error));
} finally {
  // El cron horario (00198) puede encolar un barrido para un workspace de prueba mientras corre el script: se barre
  // por los workspaces de prueba ANTES de borrarlos, para no dejar jobs huerfanos.
  try {
    const { data: testWs } = await svc.from("workspaces").select("id").or("name.like.zz-test-%,slug.like.zz-test-%");
    const ids = (testWs ?? []).map((w: { id: string }) => w.id);
    if (ids.length > 0) await svc.from("scheduled_jobs").delete().eq("type", "tasks_due_sweep").in("payload->>workspace_id", ids);
  } catch (error) {
    console.error("  no pude limpiar los jobs de barrido:", error instanceof Error ? error.message : String(error));
  }
  const clean = await runCleanup(svc);
  if (!clean) failures++;
}

console.log(failures === 0 ? "\nTodo en orden." : `\n${failures} falla(s)`);
process.exitCode = failures === 0 ? 0 : 1;
