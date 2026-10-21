#!/usr/bin/env node
/**
 * Verificacion del pipeline de contactos contra la base real (00244, 00245, 00246).
 *
 *  - 00244: los valores de campos personalizados como numero y como fecha.
 *  - 00245: las listas de estados, `set_contact_status` (cambia, no cambia,
 *    estado invalido o archivado, proteger lo que puso una persona, el ultimo
 *    estado), la guardia contra cambios directos, el evento `status_changed`,
 *    quien puede ejecutar la funcion y la RLS del historial (el setter ve el
 *    cambio del vendedor; un Member sin el contacto no ve nada).
 *  - 00246: el producto de interes (variante de otro producto, de otro
 *    workspace, variante sin producto).
 *
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. No correrlo en
 * paralelo con otro verify-* (candado /private/tmp/ssa-verify.lock).
 *
 *   node scripts/verify-contact-pipeline.mjs
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

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();

async function makeUser(tag) {
  const email = `zz-test-${tag}-${stamp}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

const setStatus = (args) => svc.rpc("set_contact_status", { p_actor_user: null, p_actor_agent: null, p_reason: null, p_respect_human: false, ...args });

try {
  const { data: ws } = await svc.from("workspaces").insert({ name: "zz-test-pipeline", slug: `zz-test-pipeline-${stamp}` }).select("id, contact_status_settings").single();
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-pipeline-otro", slug: `zz-test-pipeline-otro-${stamp}` }).select("id").single();

  const owner = await makeUser("pl-owner");
  const setter = await makeUser("pl-setter");
  const closer = await makeUser("pl-closer");
  const outsider = await makeUser("pl-otro-member");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: setter.id, role: "member" },
    { workspace_id: ws.id, user_id: closer.id, role: "member" },
    { workspace_id: ws.id, user_id: outsider.id, role: "member" },
  ]);

  // ═══ 00244 ═══════════════════════════════════════════════════════════════
  console.log("\n— 00244: valores como numero y como fecha —");
  { const { data: c } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Valores", email: `zz-test-val-${stamp}@example.test` }).select("id").single();
    const { data: defs } = await svc.from("custom_field_definitions").insert([
      { workspace_id: ws.id, name: "zz-test Viajeros", slug: `zz_test_viajeros_${stamp}`, type: "number" },
      { workspace_id: ws.id, name: "zz-test Salida", slug: `zz_test_salida_${stamp}`, type: "date" },
      { workspace_id: ws.id, name: "zz-test Destino", slug: `zz_test_destino_${stamp}`, type: "text" },
    ]).select("id, type");
    const byType = Object.fromEntries(defs.map((d) => [d.type, d.id]));
    await svc.from("contact_custom_fields").insert([
      { contact_id: c.id, field_id: byType.number, value: "3,5" },
      { contact_id: c.id, field_id: byType.date, value: "21/10/2026" },
      { contact_id: c.id, field_id: byType.text, value: "12" },
    ]);
    const { data: vals } = await svc.from("contact_custom_fields").select("field_id, value_number, value_date").eq("contact_id", c.id);
    const v = Object.fromEntries(vals.map((r) => [r.field_id, r]));
    check(Number(v[byType.number].value_number) === 3.5, "un numero con coma queda como 3.5");
    check(v[byType.date].value_date === "2026-10-21", "una fecha DD/MM/AAAA queda como 2026-10-21");
    check(v[byType.text].value_number === null, "un campo de texto no se convierte aunque parezca un numero");
    const { error } = await svc.from("contact_custom_fields").update({ value: "muchos" }).eq("contact_id", c.id).eq("field_id", byType.number);
    check(!error, "un valor viejo que no es numero no rompe el guardado", error?.message);
    const { data: after } = await svc.from("contact_custom_fields").select("value_number").eq("contact_id", c.id).eq("field_id", byType.number).single();
    check(after.value_number === null, "y queda sin numero (NULL), no en 0");
    const { data: gt } = await svc.from("contact_custom_fields").select("contact_id").eq("field_id", byType.number).gt("value_number", 3);
    check((gt ?? []).length === 0, "la comparacion por numero ya no lo cuenta"); }

  // ═══ 00245 ═══════════════════════════════════════════════════════════════
  console.log("\n— 00245: las listas por defecto —");
  { const s = ws.contact_status_settings;
    check(Array.isArray(s?.setter) && s.setter.some((x) => x.key === "calificado"), "un workspace nuevo arranca con los estados de setter");
    check(Array.isArray(s?.closer) && s.closer.some((x) => x.key === "ganado"), "y con los de vendedor"); }

  const { data: lead } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Lead", email: `zz-test-lead-${stamp}@example.test`, setter_id: setter.id, vendedor_id: closer.id }).select("id").single();
  const { data: ajeno } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Ajeno", email: `zz-test-ajeno-${stamp}@example.test` }).select("id").single();

  console.log("\n— 00245: set_contact_status —");
  { const r1 = await setStatus({ p_workspace_id: ws.id, p_contact_id: lead.id, p_role: "setter", p_status: "contactado", p_actor_user: setter.id });
    check(r1.data?.result === "changed" && r1.data?.last_status === "contactado" && r1.data?.last_status_role === "setter", "pone el estado de setter y es el ultimo", JSON.stringify(r1.data ?? r1.error));
    const r2 = await setStatus({ p_workspace_id: ws.id, p_contact_id: lead.id, p_role: "setter", p_status: "contactado" });
    check(r2.data?.result === "unchanged", "el mismo estado: no hace nada");
    await new Promise((r) => setTimeout(r, 20));
    const r3 = await setStatus({ p_workspace_id: ws.id, p_contact_id: lead.id, p_role: "closer", p_status: "propuesta_enviada", p_actor_user: closer.id });
    check(r3.data?.last_status_role === "closer" && r3.data?.last_status === "propuesta_enviada", "el de vendedor, posterior, pasa a ser el ultimo");
    const r4 = await setStatus({ p_workspace_id: ws.id, p_contact_id: lead.id, p_role: "closer", p_status: null, p_actor_user: closer.id });
    check(r4.data?.result === "changed" && r4.data?.last_status_role === "setter" && r4.data?.last_status === "contactado", "quitar el de vendedor deja como ultimo el de setter", JSON.stringify(r4.data));
    const r5 = await setStatus({ p_workspace_id: ws.id, p_contact_id: lead.id, p_role: "setter", p_status: "inventado" });
    check(r5.data?.result === "invalid_status", "un estado que no esta en la lista se rechaza");
    const r6 = await setStatus({ p_workspace_id: ws2.id, p_contact_id: lead.id, p_role: "setter", p_status: "calificado" });
    check(r6.data?.result === "not_found", "un contacto de otro workspace no se encuentra");
    const r7 = await setStatus({ p_workspace_id: ws.id, p_contact_id: lead.id, p_role: "setter", p_status: "calificado", p_actor_agent: null, p_respect_human: true });
    check(r7.data?.result === "protected", "con «respetar a la persona», no pisa un estado que puso alguien del equipo");
    const { data: c } = await svc.from("contacts").select("setter_status, setter_status_at, last_status, last_status_at").eq("id", lead.id).single();
    check(c.setter_status === "contactado" && c.setter_status_at && c.last_status_at, "las columnas quedan coherentes");

    // Archivar un estado: el que lo tiene lo conserva, pero ya no se puede poner.
    const settings = ws.contact_status_settings;
    settings.setter = settings.setter.map((x) => (x.key === "agendado" ? { ...x, archived_at: new Date().toISOString() } : x));
    await svc.from("workspaces").update({ contact_status_settings: settings }).eq("id", ws.id);
    const r8 = await setStatus({ p_workspace_id: ws.id, p_contact_id: lead.id, p_role: "setter", p_status: "agendado" });
    check(r8.data?.result === "invalid_status", "un estado archivado ya no se puede poner"); }

  console.log("\n— 00245: el evento de automatizacion —");
  { const { data: evs } = await svc.from("automation_events").select("payload").eq("contact_id", lead.id).eq("event_type", "status_changed");
    check((evs ?? []).length >= 3, "cada cambio emite status_changed", `${(evs ?? []).length}`);
    check((evs ?? []).some((e) => e.payload?.role === "closer" && e.payload?.status === "propuesta_enviada"), "con el rol y el estado nuevo"); }

  console.log("\n— 00245: la guardia —");
  { const { error } = await svc.from("contacts").update({ setter_status: "calificado" }).eq("id", lead.id);
    check(error?.code === "CS001", "ni el service role puede escribir el estado sin la funcion", error?.message);
    const { error: e2 } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Con estado", setter_status: "nuevo", setter_status_at: new Date().toISOString() });
    check(e2?.code === "CS001", "ni crear un contacto con estado");
    const { error: e3 } = await setter.client.from("contacts").update({ closer_status: "ganado" }).eq("id", lead.id);
    check(!!e3, "un Member tampoco, aunque vea el contacto");
    const { error: e4 } = await svc.from("contacts").update({ notes: "zz-test otra cosa" }).eq("id", lead.id);
    check(!e4, "editar otro dato del contacto sigue funcionando", e4?.message); }

  console.log("\n— 00245: quien ejecuta la funcion —");
  { const r = await setter.client.rpc("set_contact_status", { p_workspace_id: ws.id, p_contact_id: lead.id, p_role: "setter", p_status: "calificado" });
    check(!!r.error, "un usuario no la puede llamar directo (solo service_role)");
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    check(!!(await anon.rpc("set_contact_status", { p_workspace_id: ws.id, p_contact_id: lead.id, p_role: "setter", p_status: "calificado" })).error, "sin sesion tampoco"); }

  console.log("\n— 00245: la RLS del historial —");
  { const own = await setter.client.from("contact_status_changes").select("role, new_status").eq("contact_id", lead.id);
    check((own.data ?? []).some((r) => r.role === "closer"), "el setter del lead ve tambien los cambios del vendedor", own.error?.message);
    const other = await outsider.client.from("contact_status_changes").select("id").eq("contact_id", lead.id);
    check((other.data ?? []).length === 0, "un Member que no tiene el lead no ve nada");
    await setStatus({ p_workspace_id: ws.id, p_contact_id: ajeno.id, p_role: "setter", p_status: "nuevo" });
    const mine = await setter.client.from("contact_status_changes").select("id").eq("contact_id", ajeno.id);
    check((mine.data ?? []).length === 0, "ni el setter ve el historial de un contacto que no es suyo");
    const ownerView = await owner.client.from("contact_status_changes").select("id").eq("workspace_id", ws.id);
    check((ownerView.data ?? []).length >= 4, "el Owner ve todo");
    const { error: insErr } = await owner.client.from("contact_status_changes").insert({ workspace_id: ws.id, contact_id: lead.id, role: "setter", new_status: "x" });
    check(!!insErr, "nadie escribe el historial a mano (ni el Owner)"); }

  // ═══ 00246 ═══════════════════════════════════════════════════════════════
  console.log("\n— 00246: el producto de interes —");
  { const { data: p1 } = await svc.from("products").insert({ workspace_id: ws.id, name: `zz-test Prod A ${stamp}`, product_type: "programa" }).select("id").single();
    const { data: p2 } = await svc.from("products").insert({ workspace_id: ws.id, name: `zz-test Prod B ${stamp}`, product_type: "programa" }).select("id").single();
    const { data: pOther } = await svc.from("products").insert({ workspace_id: ws2.id, name: `zz-test Prod X ${stamp}`, product_type: "programa" }).select("id").single();
    const { data: v1 } = await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: p1.id, name: "Mensual" }).select("id").single();
    const { data: v2 } = await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: p2.id, name: "Anual" }).select("id").single();

    const set = (patch) => svc.from("contacts").update(patch).eq("id", lead.id);
    check(!(await set({ interest_product_id: p1.id, interest_variant_id: v1.id })).error, "producto con su variante");
    check((await set({ interest_product_id: p1.id, interest_variant_id: v2.id })).error?.code === "CI003", "una variante de otro producto se rechaza");
    check((await set({ interest_product_id: null, interest_variant_id: v1.id })).error?.code === "CI001", "una variante sin producto se rechaza");
    check((await set({ interest_product_id: pOther.id, interest_variant_id: null })).error?.code === "CI002", "un producto de otro workspace se rechaza");
    check(!(await set({ interest_product_id: p2.id, interest_variant_id: null })).error, "solo el producto, sin variante");
    const { error: delErr } = await svc.from("products").delete().eq("id", p2.id);
    check(!!delErr, "un producto que un contacto tiene de interes no se puede borrar de verdad");
    const { error: memberErr } = await setter.client.from("contacts").update({ interest_product_id: p1.id, interest_variant_id: null }).eq("id", lead.id).select("id");
    check(!memberErr, "el setter del lead lo puede cambiar (RLS de contactos)", memberErr?.message); }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
