#!/usr/bin/env node
/**
 * Verificacion del modulo Llamadas (F2, F3 y siguientes).
 *
 * Corre contra la base real con usuarios de verdad. Prueba lo que los tests de
 * vitest NO pueden probar: que la BASE haga cumplir las reglas.
 *
 *  - Quien ve cada llamada (`can_see_call`): quien la grabo, quien ve su
 *    contacto, un rol personalizado con alcance `all`, y que un Member no
 *    pueda escribir ni borrar.
 *  - El unico por id de Fathom, y que dos llamadas puedan colgar de la misma agenda.
 *  - Que `analysis_ai` solo cambie con una corrida nueva.
 *  - El candado de renovacion del refresh token: de diez pedidos a la vez,
 *    uno solo lo toma.
 *  - (00146) `private.enqueue_fathom_sync()`: un job por conexion, sin duplicar.
 *  - (00148) guardar la configuracion de una tarea no pisa las otras.
 *
 * Crea y borra todo lo suyo (prefijo zz-test-). Una limpieza que falla es una
 * prueba que falla.
 *
 *   node scripts/verify-calls.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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
  return { id: data.user.id, email, client };
}

/**
 * `private.enqueue_fathom_sync()` no se expone por la API (esta en el esquema
 * `private`): se llama con la CLI de Supabase, ya vinculada a este proyecto.
 * Devuelve las filas de la consulta.
 */
function sql(query) {
  const out = execFileSync("supabase", ["db", "query", "--linked", query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).rows ?? [];
}
/** Comparacion de jsonb: la base reordena las claves, asi que se ordenan antes de comparar. */
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const slotNow = () => Math.floor(Date.now() / 1000 / 600); // la misma cuenta que lib/fathom/queue.ts

const callRow = (wsId, extra = {}) => ({
  workspace_id: wsId, source: "manual", title: "zz-test llamada", recorded_at: new Date().toISOString(), ...extra,
});
const visibleIds = async (user, wsId) => {
  const { data } = await user.client.from("calls").select("id").eq("workspace_id", wsId);
  return new Set((data ?? []).map((r) => r.id));
};

try {
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-calls", slug: `zz-test-calls-${Date.now()}` }).select("id").single();

  const owner = await makeUser("calls-owner");
  const admin = await makeUser("calls-admin");
  const closer = await makeUser("calls-closer");     // grabo la llamada
  const setter = await makeUser("calls-setter");     // es setter del contacto
  const otro = await makeUser("calls-otro");         // sin relacion
  const supervisor = await makeUser("calls-super");   // rol personalizado con calls.view all
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: closer.id, role: "member" },
    { workspace_id: ws.id, user_id: setter.id, role: "member" },
    { workspace_id: ws.id, user_id: otro.id, role: "member" },
    { workspace_id: ws.id, user_id: supervisor.id, role: "member" },
  ]);

  const { data: rol, error: rolErr } = await svc.from("workspace_roles").insert({
    workspace_id: ws.id, name: "zz-test Supervisor de llamadas",
    permissions: { keys: ["calls.view"], scopes: { leads: "own", conversations: "own", bookings: "own", calls: "all" } },
  }).select("id").single();
  if (rolErr) throw new Error(`no pude crear el rol: ${rolErr.message}`);
  await svc.from("workspace_members").update({ role_id: rol.id }).eq("workspace_id", ws.id).eq("user_id", supervisor.id);

  const { data: cs } = await svc.from("contacts").insert([
    { workspace_id: ws.id, display_name: "zz-test lead del setter", setter_id: setter.id },
    { workspace_id: ws.id, display_name: "zz-test lead de nadie visible", setter_id: admin.id },
  ]).select("id, display_name");
  const contactoSetter = cs.find((c) => c.display_name.includes("setter")).id;
  const contactoAjeno = cs.find((c) => c.display_name.includes("nadie")).id;

  console.log("\n— La tabla y sus reglas —");
  const { data: c1, error: e1 } = await svc.from("calls")
    .insert(callRow(ws.id, { source: "fathom", external_id: "zz-rec-1", recorded_by_user_id: closer.id, contact_id: contactoAjeno }))
    .select("id").single();
  check(!e1 && !!c1, "se puede insertar una llamada de Fathom", e1?.message);
  const { error: dup } = await svc.from("calls").insert(callRow(ws.id, { source: "fathom", external_id: "zz-rec-1" }));
  check(!!dup, "la misma llamada de Fathom (mismo external_id) no entra dos veces", dup ? undefined : "se inserto la segunda");
  const { error: man1 } = await svc.from("calls").insert([callRow(ws.id), callRow(ws.id)]);
  check(!man1, "dos llamadas manuales sin external_id conviven", man1?.message);

  // Dos llamadas vinculadas a la misma agenda.
  const { data: cat } = await svc.from("booking_categories").select("id").eq("workspace_id", ws.id).not("parent_id", "is", null).limit(1).single();
  const { data: ev } = await svc.from("event_types").insert({
    workspace_id: ws.id, owner_user_id: admin.id, category_id: cat.id, title: "zz-test-calls", slug: "zz-test-calls",
    duration_minutes: 30, status: "active", location_type: "manual", location_text: "Zoom",
  }).select("id").single();
  const { data: bk, error: bkErr } = await svc.from("bookings").insert({
    workspace_id: ws.id, uid: `zz-calls-${randomUUID().slice(0, 8)}`, event_type_id: ev.id, host_user_id: admin.id,
    contact_id: contactoSetter, title: "zz-test", start_at: "2031-04-10T15:00:00Z", end_at: "2031-04-10T15:30:00Z",
    booker_name: "zz", booker_email: "zz-calls@example.test",
  }).select("id").single();
  if (bkErr) throw new Error(`no pude crear la agenda: ${bkErr.message}`);
  const { error: dosCalls } = await svc.from("calls").insert([
    callRow(ws.id, { booking_id: bk.id }), callRow(ws.id, { booking_id: bk.id }),
  ]);
  check(!dosCalls, "dos llamadas pueden colgar de la MISMA agenda", dosCalls?.message);

  console.log("\n— analysis_ai solo cambia con una corrida nueva —");
  {
    const runA = randomUUID(), runB = randomUUID();
    const { data: c } = await svc.from("calls")
      .insert(callRow(ws.id, { analysis_ai: { v: 1 }, analysis_run_id: runA, rubric_snapshot: { version: 1 } })).select("id").single();
    const { error: sin } = await svc.from("calls").update({ analysis_ai: { v: 2 } }).eq("id", c.id);
    check(!!sin, "cambiar analysis_ai sin cambiar analysis_run_id falla", sin ? undefined : "lo dejo pasar");
    const { error: snap } = await svc.from("calls").update({ rubric_snapshot: { version: 9 } }).eq("id", c.id);
    check(!!snap, "cambiar rubric_snapshot sin corrida nueva tambien falla");
    const { error: corr } = await svc.from("calls").update({ analysis: { editado: true }, analysis_edited: true }).eq("id", c.id);
    check(!corr, "corregir `analysis` (la copia editable) si se puede", corr?.message);
    const { error: nueva } = await svc.from("calls").update({ analysis_ai: { v: 2 }, analysis_run_id: runB, rubric_snapshot: { version: 2 } }).eq("id", c.id);
    check(!nueva, "una corrida nueva (otro analysis_run_id) si lo puede cambiar", nueva?.message);
  }

  console.log("\n— Quien ve cada llamada (can_see_call) —");
  {
    const { data: propia } = await svc.from("calls").insert(callRow(ws.id, { title: "zz propia del closer", recorded_by_user_id: closer.id })).select("id").single();
    const { data: delContacto } = await svc.from("calls").insert(callRow(ws.id, { title: "zz del contacto del setter", contact_id: contactoSetter, recorded_by_user_id: admin.id })).select("id").single();
    const { data: ajena } = await svc.from("calls").insert(callRow(ws.id, { title: "zz ajena", contact_id: contactoAjeno, recorded_by_user_id: admin.id })).select("id").single();

    const vCloser = await visibleIds(closer, ws.id);
    check(vCloser.has(propia.id), "el closer ve la que grabo");
    check(!vCloser.has(ajena.id), "el closer NO ve una ajena con un contacto que no ve");

    const vSetter = await visibleIds(setter, ws.id);
    check(vSetter.has(delContacto.id), "quien ve el contacto (es su setter) ve la llamada aunque no la grabo");
    check(!vSetter.has(propia.id) && !vSetter.has(ajena.id), "y no ve las de otros contactos");

    const vOtro = await visibleIds(otro, ws.id);
    check(vOtro.size === 0, "un Member sin relacion no ve ninguna", `ve ${vOtro.size}`);

    const vSuper = await visibleIds(supervisor, ws.id);
    check(vSuper.has(propia.id) && vSuper.has(delContacto.id) && vSuper.has(ajena.id), "un rol personalizado con calls.view y alcance `all` las ve todas");

    const vAdmin = await visibleIds(admin, ws.id), vOwner = await visibleIds(owner, ws.id);
    check(vAdmin.has(ajena.id) && vOwner.has(ajena.id) && vAdmin.size === vOwner.size, "Owner y Admin ven todas");

    console.log("\n— Un Member no escribe —");
    const { error: ins } = await closer.client.from("calls").insert(callRow(ws.id, { recorded_by_user_id: closer.id }));
    check(!!ins, "no puede insertar");
    await closer.client.from("calls").update({ title: "hackeada" }).eq("id", propia.id);
    const { data: despues } = await svc.from("calls").select("title").eq("id", propia.id).single();
    check(despues.title === "zz propia del closer", "no puede actualizar");
    await closer.client.from("calls").delete().eq("id", propia.id);
    const { data: sigue } = await svc.from("calls").select("id").eq("id", propia.id).maybeSingle();
    check(!!sigue, "no puede borrar");
    const { error: adminIns } = await admin.client.from("calls").insert(callRow(ws.id));
    check(!!adminIns, "ni siquiera un Admin escribe con su sesion (escribe el servidor)");
  }

  console.log("\n— El candado de renovacion del refresh token —");
  {
    const { data: conn, error: ce } = await svc.from("oauth_connections").insert({
      workspace_id: ws.id, provider: "fathom", user_id: closer.id, external_account_id: "zz-fathom-1",
      account_label: "zz", status: "active", vault_secret_prefix: `oauth_fathom_zz-${randomUUID().slice(0, 8)}`,
    }).select("id").single();
    check(!ce && !!conn, "el CHECK de provider acepta 'fathom'", ce?.message);
    const claims = await Promise.all(Array.from({ length: 10 }, () => svc.rpc("claim_oauth_refresh", { p_connection_id: conn.id, p_seconds: 60 })));
    const tomaron = claims.filter((r) => r.data === true).length;
    check(tomaron === 1, "de diez pedidos a la vez, exactamente uno toma el candado", `lo tomaron ${tomaron}`);
    await svc.rpc("release_oauth_refresh", { p_connection_id: conn.id });
    const otra = await svc.rpc("claim_oauth_refresh", { p_connection_id: conn.id, p_seconds: 60 });
    check(otra.data === true, "despues de liberarlo se puede volver a tomar");
    const anon = await closer.client.rpc("claim_oauth_refresh", { p_connection_id: conn.id, p_seconds: 60 });
    check(!!anon.error, "un usuario con sesion NO puede pedir el candado (solo el servidor)");

    const { error: otraConn } = await svc.from("oauth_connections").insert({
      workspace_id: ws.id, provider: "fathom", user_id: closer.id, external_account_id: "zz-fathom-1",
      status: "active", vault_secret_prefix: `oauth_fathom_zz-${randomUUID().slice(0, 8)}`,
    });
    check(!!otraConn, "la misma cuenta de Fathom de la misma persona no crea una segunda conexion");
  }

  console.log("\n— El cron de Fathom (private.enqueue_fathom_sync) —");
  {
    const mkConn = async (user, status, extra = {}) => {
      const { data, error } = await svc.from("oauth_connections").insert({
        workspace_id: ws.id, provider: "fathom", user_id: user.id, external_account_id: `zz-sync-${randomUUID().slice(0, 6)}`,
        account_label: "zz", status, vault_secret_prefix: `oauth_fathom_zz-${randomUUID().slice(0, 8)}`, ...extra,
      }).select("id").single();
      if (error) throw new Error(`no pude crear la conexion: ${error.message}`);
      return data.id;
    };
    const jobsOf = async (id) => (await svc.from("scheduled_jobs").select("id, status, dedupe_key, payload").eq("type", "fathom_sync").like("dedupe_key", `fathom_sync:${id}:%`)).data ?? [];

    const activa = await mkConn(setter, "active");
    const caida = await mkConn(otro, "error");
    const revocada = await mkConn(supervisor, "revoked");
    // Una persona que ya no esta en el workspace.
    const ex = await makeUser("calls-ex");
    const deLaIda = await mkConn(ex, "active"); // nunca fue miembro de este workspace

    const slotAntes = slotNow();
    const n1 = sql("select private.enqueue_fathom_sync() n")[0].n;
    const n2 = sql("select private.enqueue_fathom_sync() n")[0].n;
    const slotDespues = slotNow();

    const mias = await jobsOf(activa);
    check(mias.length === 1, "dos corridas seguidas dejan UN solo job pendiente por conexion activa", `hay ${mias.length}`);
    check(n1 >= 1 && n2 === 0, "la segunda corrida no encola nada nuevo", `n1=${n1} n2=${n2}`);
    check([slotAntes, slotDespues].some((slot) => mias[0]?.dedupe_key === `fathom_sync:${activa}:${slot}`), "la clave de dedupe es conexion + franja de 10 minutos (la misma que arma lib/fathom/queue.ts)", mias[0]?.dedupe_key);
    check(mias[0]?.payload?.connectionId === activa, "el payload lleva la conexion");

    check((await jobsOf(caida)).length === 0 && (await jobsOf(revocada)).length === 0, "una conexion en error o revocada no encola nada");
    check((await jobsOf(deLaIda)).length === 0, "una conexion cuya persona ya no esta en el workspace no encola nada");

    // Con uno `processing`, no encola otro.
    await svc.from("scheduled_jobs").update({ status: "processing" }).eq("id", mias[0].id);
    sql("select private.enqueue_fathom_sync()");
    const trasProcesar = await jobsOf(activa);
    check(trasProcesar.length === 1 && trasProcesar[0].status === "processing", "con uno `processing` no encola otro");

    // El barrido de analisis trabados.
    // El trigger de updated_at es BEFORE UPDATE: se inserta ya con la fecha vieja.
    const hace16 = new Date(Date.now() - 16 * 60_000).toISOString();
    const { data: trabada } = await svc.from("calls").insert(callRow(ws.id, { analysis_status: "analyzing", updated_at: hace16 })).select("id").single();
    const { data: reciente } = await svc.from("calls").insert(callRow(ws.id, { analysis_status: "analyzing" })).select("id").single();
    sql("select private.enqueue_fathom_sync()");
    const { data: tras } = await svc.from("calls").select("id, analysis_status, analysis_status_reason").in("id", [trabada.id, reciente.id]);
    const t = tras.find((x) => x.id === trabada.id), r = tras.find((x) => x.id === reciente.id);
    check(t.analysis_status === "pending" && t.analysis_status_reason === "stuck", "un analisis `analyzing` hace 16 minutos vuelve a `pending` (motivo stuck)");
    check(r.analysis_status === "analyzing", "uno de hace instantes no se toca");

    const noEjecutable = await closer.client.rpc("enqueue_fathom_sync");
    check(!!noEjecutable.error, "un usuario con sesion no puede ejecutar la funcion");

    // Limpieza de los jobs en CUALQUIER estado (la cola no cuelga del workspace).
    for (const id of [activa, caida, revocada, deLaIda]) await svc.from("scheduled_jobs").delete().like("dedupe_key", `fathom_sync:${id}:%`);
    const { data: restos } = await svc.from("scheduled_jobs").select("id").eq("type", "fathom_sync").like("dedupe_key", `fathom_sync:${activa}:%`);
    check((restos ?? []).length === 0, "los jobs de prueba quedaron limpios");
  }

  console.log("\n— La configuracion de una tarea (set_ai_background_task_settings, 00148) —");
  {
    const otras = {
      message_classification: { mode: "batch", frequency: "daily", hour: "03:00", model: null },
      conversation_summary: { mode: "now" },
      close_classification: { mode: "off" },
      knowledge_indexing: { mode: "now" },
      call_classification: { mode: "now", confidence_threshold: 0.7 },
    };
    await svc.from("workspaces").update({ ai_background_settings: otras }).eq("id", ws.id);
    const nuevo = { mode: "now", analyze_types: ["cierre"], rubric: { version: 2, closer: [], lead: [] } };
    const r1 = await svc.rpc("set_ai_background_task_settings", { p_workspace_id: ws.id, p_task: "call_analysis", p_value: nuevo });
    check(!r1.error && r1.data === null, "guardar call_analysis devuelve lo que habia antes (nada, la primera vez)", r1.error?.message);
    const { data: despues } = await svc.from("workspaces").select("ai_background_settings").eq("id", ws.id).single();
    const cfg = despues.ai_background_settings;
    check(canon(cfg.call_analysis) === canon(nuevo), "queda guardada la clave nueva");
    for (const k of ["message_classification", "conversation_summary", "close_classification", "knowledge_indexing", "call_classification"]) {
      check(canon(cfg[k]) === canon(otras[k]), `la clave ${k} NO cambio`);
    }
    const r2 = await svc.rpc("set_ai_background_task_settings", { p_workspace_id: ws.id, p_task: "call_analysis", p_value: { mode: "off" } });
    check(canon(r2.data) === canon(nuevo), "al guardar de nuevo devuelve el valor anterior (para la auditoria)");
    const r3 = await svc.rpc("set_ai_background_task_settings", { p_workspace_id: ws.id, p_task: "message_classification", p_value: { mode: "off" } });
    check(!!r3.error, "una tarea fuera de la lista (message_classification) lanza", r3.error ? undefined : "la dejo pasar");
    const r4 = await closer.client.rpc("set_ai_background_task_settings", { p_workspace_id: ws.id, p_task: "call_analysis", p_value: {} });
    check(!!r4.error, "un usuario con sesion NO puede ejecutarla");

    const run = await svc.from("agent_runs").insert({ workspace_id: ws.id, source: "call_analysis", trigger: "job", status: "completed" }).select("id").single();
    check(!run.error, "agent_runs acepta source 'call_analysis'", run.error?.message);
    for (const src of ["call_classification", "call_correction", "call_summary", "call_prompt_test"]) {
      const x = await svc.from("agent_runs").insert({ workspace_id: ws.id, source: src, trigger: "job", status: "completed" });
      check(!x.error, `agent_runs acepta source '${src}'`, x.error?.message);
    }
    const bad = await svc.from("agent_runs").insert({ workspace_id: ws.id, source: "inventada", trigger: "job", status: "completed" });
    check(!!bad.error, "y sigue rechazando un source inventado");
    for (const task of ["call_classification", "call_analysis", "call_summary"]) {
      const v = await svc.from("ai_task_prompt_versions").insert({ workspace_id: ws.id, task, version: 1, instructions: "texto de prueba" });
      check(!v.error, `ai_task_prompt_versions acepta task '${task}'`, v.error?.message);
    }
  }

  console.log("\n— Equipo: closer —");
  {
    const { error: e } = await svc.from("workspace_members").update({ is_closer: true, closer_emails: ["ana.personal@gmail.com"] })
      .eq("workspace_id", ws.id).eq("user_id", closer.id);
    check(!e, "is_closer y closer_emails existen y se guardan", e?.message);
  }
} catch (e) {
  fail("el script fallo", e.message);
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exit(failures ? 1 : 0);
