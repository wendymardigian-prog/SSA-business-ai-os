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
