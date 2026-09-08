#!/usr/bin/env node
/**
 * Verificacion del motor de CRM contra la base real.
 *
 * Prueba lo que no se puede probar con vitest porque vive en Postgres: la
 * deduplicacion cross-canal (find_or_link_contact) y la purga de los borrados
 * logicos (purge_soft_deleted), ambas de la migracion 00025.
 *
 * Crea un workspace, dos canales (Instagram y WhatsApp) y los contactos que
 * hagan falta, y borra todo al terminar.
 *
 *   node scripts/verify-crm.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

const stamp = Date.now();

/** Llama a la funcion tal como la llaman el webhook y el backfill. */
async function resolve(channelId, args) {
  const { data, error } = await svc.rpc("find_or_link_contact", {
    p_channel_id: channelId,
    p_interaction_at: new Date().toISOString(),
    ...args,
  });
  if (error) throw new Error(`find_or_link_contact: ${error.message}`);
  return data;
}

try {
  const { data: workspace } = await svc.from("workspaces")
    .insert({ name: "zz-test-crm", slug: `zz-test-crm-${stamp}` }).select("id").single();
  const ws = workspace.id;

  const mkChannel = async (platform, suffix) => {
    const { data } = await svc.from("channels").insert({
      workspace_id: ws, platform, late_account_id: `zz-${suffix}-${stamp}`,
      username: `zz${suffix}`, display_name: `zz ${suffix}`, is_active: true,
    }).select("id").single();
    return data.id;
  };

  const ig = await mkChannel("instagram", "ig");
  const wa = await mkChannel("whatsapp", "wa");

  console.log("\n— El mismo remitente dos veces —");
  { const a = await resolve(ig, { p_sender_id: "ig-1", p_display_name: "Juan" });
    const b = await resolve(ig, { p_sender_id: "ig-1", p_display_name: "Juan" });
    check(a.contact_id === b.contact_id, "el segundo mensaje reusa el mismo contacto");
    check(b.existed === true && b.linked_by === "channel", "y se resuelve por el canal, sin buscar de nuevo");
    check(a.existed === false, "el primero si creo el contacto"); }

  console.log("\n— Mismo telefono por dos canales —");
  { const primero = await resolve(wa, {
      p_sender_id: "+5491100000001", p_display_name: "Ana", p_phone: "+5491100000001" });
    // El operador le carga el telefono al contacto de Instagram... no: el caso
    // real es al reves. Ana ya existe por WhatsApp y ahora escribe por Instagram
    // desde una cuenta cuyo perfil trae el mismo telefono.
    const segundo = await resolve(ig, {
      p_sender_id: "ig-ana", p_display_name: "Ana", p_username: "ana.ok", p_phone: "+5491100000001" });

    check(primero.contact_id === segundo.contact_id, "el telefono unifica los dos canales en un contacto");
    check(segundo.linked_by === "phone", "y queda registrado que se vinculo por telefono");

    const { data: canales } = await svc.from("contact_channels").select("channel_id").eq("contact_id", primero.contact_id);
    check((canales ?? []).length === 2, "el contacto queda con los dos canales vinculados");

    const { data: c } = await svc.from("contacts").select("instagram_username, phone").eq("id", primero.contact_id).single();
    check(c.instagram_username === "ana.ok", "y se completa el usuario de Instagram que faltaba");
    check(c.phone === "+5491100000001", "sin pisar el telefono que ya tenia"); }

  console.log("\n— Mismo email por dos canales —");
  { const primero = await resolve(ig, {
      p_sender_id: "ig-lu", p_display_name: "Lu", p_email: "LU@example.test" });
    const segundo = await resolve(wa, {
      p_sender_id: "+5491100000002", p_display_name: "Lu", p_phone: "+5491100000002",
      p_email: "lu@example.test" });
    check(primero.contact_id === segundo.contact_id, "el email unifica aunque venga con otras mayusculas");
    check(segundo.linked_by === "email", "y se registra que fue por email"); }

  console.log("\n— Username de la misma plataforma —");
  { const { data: manual } = await svc.from("contacts").insert({
      workspace_id: ws, display_name: "Importado por CSV", instagram_username: "pedro.ig",
    }).select("id").single();

    const entrante = await resolve(ig, {
      p_sender_id: "ig-pedro", p_display_name: "Pedro", p_username: "@Pedro.IG" });

    check(entrante.contact_id === manual.id, "un DM de Instagram se pega al contacto que ya tenia ese usuario");
    check(entrante.linked_by === "username", "y queda claro que fue por el usuario");
    check(entrante.suggested_contact_id === null, "sin dejar sugerencia: el match es confiable"); }

  console.log("\n— Username de OTRA plataforma: sugiere, no vincula —");
  { const { data: otro } = await svc.from("contacts").insert({
      workspace_id: ws, display_name: "Mica en TikTok", tiktok_username: "mica",
    }).select("id").single();

    const entrante = await resolve(ig, { p_sender_id: "ig-mica", p_display_name: "Mica", p_username: "mica" });

    check(entrante.contact_id !== otro.id, "no se vincula: un usuario de otra red no confirma nada");
    check(entrante.suggested_contact_id === otro.id, "pero queda la sugerencia para que decida una persona");

    const { data: nuevo } = await svc.from("contacts").select("metadata").eq("id", entrante.contact_id).single();
    const sugerencias = nuevo.metadata?.link_suggestions ?? [];
    check(sugerencias.length === 1 && sugerencias[0].contact_id === otro.id,
      "la sugerencia queda guardada en el contacto nuevo"); }

  console.log("\n— Nunca por nombre solo —");
  { const { data: homonimo } = await svc.from("contacts").insert({
      workspace_id: ws, display_name: "Carlos Gomez",
    }).select("id").single();

    const entrante = await resolve(wa, {
      p_sender_id: "+5491100000003", p_display_name: "Carlos Gomez", p_phone: "+5491100000003" });

    check(entrante.contact_id !== homonimo.id, "dos personas con el mismo nombre NO se unifican"); }

  console.log("\n— Un contacto borrado no se reusa —");
  { const { data: borrado } = await svc.from("contacts").insert({
      workspace_id: ws, display_name: "Viejo", phone: "+5491100000009",
      deleted_at: new Date().toISOString(),
    }).select("id").single();

    const entrante = await resolve(wa, {
      p_sender_id: "+5491100000009", p_display_name: "Nuevo", p_phone: "+5491100000009" });

    check(entrante.contact_id !== borrado.id, "no se vincula a un contacto eliminado, se crea uno nuevo"); }

  console.log("\n— La conversacion sigue siendo una por canal —");
  { const a = await resolve(ig, { p_sender_id: "ig-conv", p_display_name: "Sol", p_email: "sol@example.test" });
    const b = await resolve(wa, {
      p_sender_id: "+5491100000004", p_display_name: "Sol", p_phone: "+5491100000004",
      p_email: "sol@example.test" });
    check(a.contact_id === b.contact_id, "un solo contacto para los dos canales");

    await svc.from("conversations").insert([
      { workspace_id: ws, channel_id: ig, contact_id: a.contact_id, platform: "instagram" },
      { workspace_id: ws, channel_id: wa, contact_id: a.contact_id, platform: "whatsapp" },
    ]);
    const { data: convs } = await svc.from("conversations").select("platform").eq("contact_id", a.contact_id);
    check((convs ?? []).length === 2, "pero dos conversaciones separadas, una por canal"); }

  console.log("\n— Purga de los borrados logicos —");
  { const ayer = new Date(Date.now() - 86_400_000).toISOString();
    const { data: viejo } = await svc.from("contacts").insert({
      workspace_id: ws, display_name: "Para purgar", deleted_at: ayer,
    }).select("id").single();
    const { data: nota } = await svc.from("contact_notes").insert({
      contact_id: viejo.id, workspace_id: ws, content: "nota que se va con el contacto",
    }).select("id").single();
    const { data: res, error } = await svc.rpc("purge_soft_deleted", { p_retention_days: 0 });
    check(!error, "la purga corre", error?.message);
    check((res?.contacts ?? 0) >= 1, `borro contactos (${res?.contacts})`);

    { const { data } = await svc.from("contacts").select("id").eq("id", viejo.id);
      check((data ?? []).length === 0, "el contacto vencido ya no existe"); }
    { const { data } = await svc.from("contact_notes").select("id").eq("id", nota.id);
      check((data ?? []).length === 0, "y su nota se fue por cascade"); }

    // El recien borrado se crea DESPUES de la purga con retencion 0: si se
    // creara antes, esa misma corrida se lo llevaria y el chequeo de la
    // retencion no probaria nada.
    const { data: vivo } = await svc.from("contacts").insert({
      workspace_id: ws, display_name: "Recien borrado", deleted_at: new Date().toISOString(),
    }).select("id").single();

    await svc.rpc("purge_soft_deleted", { p_retention_days: 30 });
    { const { data } = await svc.from("contacts").select("id").eq("id", vivo.id);
      check((data ?? []).length === 1, "lo borrado hoy sobrevive a la retencion de 30 dias"); } }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
