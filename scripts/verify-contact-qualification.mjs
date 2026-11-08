#!/usr/bin/env node
/**
 * Verificación del nivel de calificación del lead contra la base real (00329).
 *
 *  - La regla de recorte: `private.qualification_next_level` da lo mismo que
 *    `nextQualificationLevel` en TypeScript (los casos de qualification.cases.json).
 *  - `set_contact_qualification`: fija, suma, resta, quita, «sin cambios», no
 *    encontrado, inválido, proteger lo que puso una persona y «solo subir».
 *  - El evento `qualification_changed` y la fila del historial.
 *  - La guardia (QL001): ni el service role escribe las columnas por fuera.
 *  - Quién puede ejecutar la función (solo service_role) y la RLS del historial.
 *  - Diez cambios a la vez sobre el mismo contacto: terminan en el nivel esperado.
 *  - La fusión: el principal se queda con el nivel más alto y con el historial.
 *  - El default de `workspaces.qualification_settings`.
 *
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. No correrlo en
 * paralelo con otro verify-* (candado /private/tmp/ssa-verify.lock).
 *
 *   node scripts/verify-contact-qualification.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const cases = JSON.parse(readFileSync(new globalThis.URL("../lib/contacts/qualification.cases.json", import.meta.url), "utf8"));

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();

async function makeUser(tag) {
  const email = `zz-test-${tag}-${stamp}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

const qualify = (args) =>
  svc.rpc("set_contact_qualification", {
    p_value: null, p_actor_user: null, p_actor_agent: null, p_source: "person", p_flow_id: null, p_reason: null,
    p_respect_human: false, p_only_raise: false, ...args,
  });
const levelOf = async (id) => (await svc.from("contacts").select("qualification_level").eq("id", id).single()).data?.qualification_level ?? null;

try {
  const { data: ws } = await svc.from("workspaces").insert({ name: "zz-test-calif", slug: `zz-test-calif-${stamp}` }).select("id, qualification_settings").single();
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-calif-otro", slug: `zz-test-calif-otro-${stamp}` }).select("id").single();

  const owner = await makeUser("ql-owner");
  const setter = await makeUser("ql-setter");
  const outsider = await makeUser("ql-otro");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: setter.id, role: "member" },
    { workspace_id: ws.id, user_id: outsider.id, role: "member" },
  ]);

  console.log("\n— Los nombres por defecto —");
  { const levels = ws.qualification_settings?.levels;
    check(Array.isArray(levels) && levels.length === 5 && levels[4].name === "Ideal", "un workspace nuevo arranca con los 5 niveles", JSON.stringify(ws.qualification_settings)); }

  console.log("\n— La regla de recorte (SQL = TS) —");
  { const { data: lead } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Recorte", email: `zz-test-rec-${stamp}@example.test` }).select("id").single();
    for (const c of cases) {
      // Se arranca desde el nivel del caso y se aplica el pedido.
      await qualify({ p_workspace_id: ws.id, p_contact_id: lead.id, p_mode: "clear" });
      if (c.old !== null) await qualify({ p_workspace_id: ws.id, p_contact_id: lead.id, p_mode: "set", p_value: c.old });
      const r = await qualify({ p_workspace_id: ws.id, p_contact_id: lead.id, p_mode: c.mode, p_value: c.value });
      const after = await levelOf(lead.id);
      if (c.expected === "invalid") check(r.data?.result === "invalid" && after === c.old, `${c.name}`, JSON.stringify(r.data ?? r.error));
      else check(after === c.expected, `${c.name}`, `nivel ${after}, esperaba ${c.expected} (${JSON.stringify(r.data ?? r.error)})`);
    } }

  const { data: lead } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Lead", email: `zz-test-lead-${stamp}@example.test`, setter_id: setter.id }).select("id").single();
  const { data: ajeno } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Ajeno", email: `zz-test-ajeno-${stamp}@example.test` }).select("id").single();

  console.log("\n— set_contact_qualification —");
  { const r1 = await qualify({ p_workspace_id: ws.id, p_contact_id: lead.id, p_mode: "set", p_value: 3, p_actor_user: setter.id, p_reason: "zz-test" });
    check(r1.data?.result === "changed" && r1.data?.new_level === 3, "fija el nivel", JSON.stringify(r1.data ?? r1.error));
    check((await qualify({ p_workspace_id: ws.id, p_contact_id: lead.id, p_mode: "set", p_value: 3 })).data?.result === "unchanged", "el mismo nivel: sin cambios");
    check((await qualify({ p_workspace_id: ws2.id, p_contact_id: lead.id, p_mode: "set", p_value: 4 })).data?.result === "not_found", "un contacto de otro workspace no se encuentra");
    check((await qualify({ p_workspace_id: ws.id, p_contact_id: lead.id, p_mode: "multiplicar", p_value: 2 })).data?.result === "invalid", "un modo inventado es inválido");
    check((await qualify({ p_workspace_id: ws.id, p_contact_id: lead.id, p_mode: "set", p_value: 4, p_source: "merge" })).data?.result === "invalid", "el origen «merge» no se acepta desde afuera");
    const prot = await qualify({ p_workspace_id: ws.id, p_contact_id: lead.id, p_mode: "set", p_value: 5, p_source: "agent", p_respect_human: true });
    check(prot.data?.result === "protected", "con «respetar a la persona», no pisa un nivel que puso alguien del equipo");
    const low = await qualify({ p_workspace_id: ws.id, p_contact_id: lead.id, p_mode: "set", p_value: 2, p_source: "agent", p_only_raise: true });
    check(low.data?.result === "not_raised" && (await levelOf(lead.id)) === 3, "con «solo subir», no baja");
    const { data: c } = await svc.from("contacts").select("qualification_level, qualification_at, qualification_by_agent").eq("id", lead.id).single();
    check(c.qualification_level === 3 && c.qualification_at && c.qualification_by_agent === false, "las columnas quedan coherentes", JSON.stringify(c)); }

  console.log("\n— El evento y el historial —");
  { const { data: evs } = await svc.from("automation_events").select("payload").eq("contact_id", lead.id).eq("event_type", "qualification_changed");
    check((evs ?? []).some((e) => e.payload?.level === 3 && e.payload?.direction === "up"), "emite qualification_changed con el nivel y la dirección", JSON.stringify(evs));
    const { data: hist } = await svc.from("contact_qualification_changes").select("old_level, new_level, source, changed_by, reason").eq("contact_id", lead.id).order("created_at");
    check((hist ?? []).some((h) => h.new_level === 3 && h.source === "person" && h.changed_by === setter.id && h.reason === "zz-test"), "deja la fila del historial con quién y por qué", JSON.stringify(hist)); }

  console.log("\n— La guardia —");
  { const { error } = await svc.from("contacts").update({ qualification_level: 5 }).eq("id", lead.id);
    check(error?.code === "QL001", "ni el service role escribe el nivel sin la función", error?.message);
    const { error: e2 } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Directo", email: `zz-test-dir-${stamp}@example.test`, qualification_level: 2, qualification_at: new Date().toISOString() });
    check(e2?.code === "QL001", "ni crear un contacto con nivel");
    const { error: e3 } = await svc.from("contacts").update({ display_name: "zz-test Lead editado" }).eq("id", lead.id);
    check(!e3, "editar otra cosa del contacto sigue andando", e3?.message); }

  console.log("\n— Quién ejecuta la función —");
  { const r = await setter.client.rpc("set_contact_qualification", { p_workspace_id: ws.id, p_contact_id: lead.id, p_mode: "set", p_value: 5 });
    check(!!r.error, "una persona logueada no la puede llamar directo");
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    check(!!(await anon.rpc("set_contact_qualification", { p_workspace_id: ws.id, p_contact_id: lead.id, p_mode: "set", p_value: 5 })).error, "sin sesión tampoco"); }

  console.log("\n— La RLS del historial —");
  { await qualify({ p_workspace_id: ws.id, p_contact_id: ajeno.id, p_mode: "set", p_value: 2 });
    const own = await setter.client.from("contact_qualification_changes").select("id").eq("contact_id", lead.id);
    check((own.data ?? []).length > 0, "el setter del lead ve su historial", own.error?.message);
    const mine = await setter.client.from("contact_qualification_changes").select("id").eq("contact_id", ajeno.id);
    check((mine.data ?? []).length === 0, "pero no el de un contacto que no es suyo");
    const other = await outsider.client.from("contact_qualification_changes").select("id").eq("contact_id", lead.id);
    check((other.data ?? []).length === 0, "un Member que no tiene el lead no ve nada");
    const ownerView = await owner.client.from("contact_qualification_changes").select("id").eq("workspace_id", ws.id);
    check((ownerView.data ?? []).length >= 2, "el Owner ve todo");
    const { error: insErr } = await owner.client.from("contact_qualification_changes").insert({ workspace_id: ws.id, contact_id: lead.id, new_level: 5, source: "person" });
    check(!!insErr, "nadie escribe el historial a mano (ni el Owner)"); }

  console.log("\n— Diez cambios a la vez —");
  { const { data: c } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Concurrencia", email: `zz-test-conc-${stamp}@example.test` }).select("id").single();
    await Promise.all(Array.from({ length: 10 }, () => qualify({ p_workspace_id: ws.id, p_contact_id: c.id, p_mode: "add", p_value: 1 })));
    check((await levelOf(c.id)) === 5, "diez «+1» desde sin calificar terminan en 5 (ninguno se pisa)");
    const { count } = await svc.from("contact_qualification_changes").select("id", { count: "exact", head: true }).eq("contact_id", c.id);
    check(count === 5, "y quedan cinco cambios en el historial (los otros cinco no movieron nada)", `hay ${count}`); }

  console.log("\n— La fusión —");
  { const { data: main } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Principal", email: `zz-test-main-${stamp}@example.test` }).select("id").single();
    const { data: dup } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Duplicado", email: `zz-test-dup-${stamp}@example.test` }).select("id").single();
    await qualify({ p_workspace_id: ws.id, p_contact_id: main.id, p_mode: "set", p_value: 2 });
    await qualify({ p_workspace_id: ws.id, p_contact_id: dup.id, p_mode: "set", p_value: 4 });
    const m = await svc.rpc("merge_contacts", { p_workspace_id: ws.id, p_main: main.id, p_duplicate: dup.id, p_actor: owner.id });
    check(!m.error, "la fusión anda con la calificación", m.error?.message);
    check((await levelOf(main.id)) === 4, "el principal se queda con el nivel más alto");
    const { data: hist } = await svc.from("contact_qualification_changes").select("source, contact_id").eq("contact_id", main.id);
    check((hist ?? []).some((h) => h.source === "merge") && (hist ?? []).length >= 3, "y con el historial del duplicado, más la fila de la fusión", JSON.stringify(hist)); }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
