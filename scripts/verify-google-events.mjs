#!/usr/bin/env node
/**
 * Verificación de la copia de Google Calendar en la Agenda (migración 00510).
 *
 * Prueba contra la base real, con usuarios de verdad, lo que vitest no puede:
 *   1. La copia (`google_calendar_events`) la ve SOLO su dueña: ni un Admin, ni un Member, ni otro negocio.
 *   2. Nadie escribe la copia con su sesión (solo el servidor).
 *   3. `google_busy_blocks`: un Admin ve el «Ocupado» de otra persona (sin título); un Member sin permiso, nada; otro
 *      negocio, nada. No devuelve lo «Disponible», lo rechazado ni lo que es de una reunión.
 *   4. Los reclamos: 10 lecturas a la vez del mismo calendario toman el candado UNA vez; 10 «Pasar al sistema» a la
 *      vez reclaman el evento UNA vez.
 *   5. Las columnas nuevas de `calendars` y su default.
 *
 * Crea y limpia sus datos (prefijo `zz-test-`). No correr en simultáneo con los otros verify-*: tomar el candado
 * /private/tmp/ssa-verify.lock (mkdir para tomarlo, rmdir para soltarlo).
 *
 *   node scripts/verify-google-events.mjs
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
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();
const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

async function makeUser(tag) {
  const email = `zz-test-gcal-${tag}-${stamp}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

try {
  const mkWs = async (tag) => {
    const { data, error } = await svc.from("workspaces").insert({ name: `zz-test-gcal-${tag}`, slug: `zz-test-gcal-${tag}-${stamp}` }).select("id").single();
    if (error) throw new Error(`no pude crear el workspace ${tag}: ${error.message}`);
    return data.id;
  };
  const ws = await mkWs("a");
  const ws2 = await mkWs("b");
  const ana = await makeUser("ana"); // owner, dueña del calendario
  const bruno = await makeUser("bruno"); // admin
  const carla = await makeUser("carla"); // member
  const dani = await makeUser("dani"); // otro negocio
  await svc.from("workspace_members").insert([
    { workspace_id: ws, user_id: ana.id, role: "owner" },
    { workspace_id: ws, user_id: bruno.id, role: "admin" },
    { workspace_id: ws, user_id: carla.id, role: "member" },
    { workspace_id: ws2, user_id: dani.id, role: "owner" },
  ]);

  const { data: conn, error: connErr } = await svc
    .from("oauth_connections")
    .insert({ workspace_id: ws, provider: "google_calendar", user_id: ana.id, external_account_id: `zz-${stamp}`, account_label: "zz-test@example.test", granted_scopes: [EVENTS_SCOPE], status: "active", vault_secret_prefix: `zz_test_gcal_${stamp}` })
    .select("id")
    .single();
  if (connErr) throw new Error(`no pude crear la conexión: ${connErr.message}`);
  const { data: cal, error: calErr } = await svc
    .from("calendars")
    .insert({ workspace_id: ws, connection_id: conn.id, user_id: ana.id, external_calendar_id: "zz-test@example.test", name: "zz-test", access_role: "owner", is_primary: true })
    .select("id, show_in_agenda, events_synced_at, events_sync_lock_until")
    .single();
  if (calErr) throw new Error(`no pude crear el calendario: ${calErr.message}`);

  // -------------------------------------------------------------------------
  console.log("\n5. Columnas nuevas de calendars");
  check(cal.show_in_agenda === false && cal.events_synced_at === null && cal.events_sync_lock_until === null, "un calendario nuevo nace sin «Mostrar en Agenda» (lo prende el código al conectar)", JSON.stringify(cal));
  await svc.from("calendars").update({ show_in_agenda: true }).eq("id", cal.id);

  // Todas las filas con las mismas columnas: en un insert de varias filas, PostgREST pone null (no el default) en la
  // columna que una fila no trae.
  const base = { workspace_id: ws, user_id: ana.id, connection_id: conn.id, calendar_id: cal.id, transparency: "opaque", self_response_status: "accepted", attendees: [] };
  const day = new Date(Date.now() + 2 * 86_400_000);
  const at = (h) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h)).toISOString();
  const rows = [
    { ...base, external_event_id: "zz-busy", summary: "Dentista privado", start_at: at(14), end_at: at(15) },
    { ...base, external_event_id: "zz-free", summary: "Libre", start_at: at(16), end_at: at(17), transparency: "transparent" },
    { ...base, external_event_id: "zz-declined", summary: "Rechazado", start_at: at(18), end_at: at(19), self_response_status: "declined" },
  ];
  const { data: inserted, error: insErr } = await svc.from("google_calendar_events").insert(rows).select("id, external_event_id");
  check(!insErr && inserted?.length === 3, "el servidor guarda la copia", insErr?.message);
  const busyId = inserted?.find((r) => r.external_event_id === "zz-busy")?.id;

  // -------------------------------------------------------------------------
  console.log("\n1. La copia la ve solo su dueña");
  const seen = async (u) => ((await u.client.from("google_calendar_events").select("id, summary").eq("workspace_id", ws)).data ?? []);
  check((await seen(ana)).length === 3, "Ana ve sus 3 eventos");
  check((await seen(bruno)).length === 0, "Bruno (Admin) NO ve los eventos de Ana");
  check((await seen(carla)).length === 0, "Carla (Member) NO los ve");
  check((await seen(dani)).length === 0, "Dani (otro negocio) NO los ve");

  // -------------------------------------------------------------------------
  console.log("\n2. Nadie escribe la copia con su sesión");
  const ins = await ana.client.from("google_calendar_events").insert({ ...base, external_event_id: "zz-hack", start_at: at(10), end_at: at(11) });
  check(Boolean(ins.error), "Ana no puede insertar", ins.error?.message);
  const upd = await ana.client.from("google_calendar_events").update({ summary: "cambiado" }).eq("id", busyId).select("id");
  check(Boolean(upd.error) || (upd.data ?? []).length === 0, "Ana no puede editar", upd.error?.message);
  const del = await ana.client.from("google_calendar_events").delete().eq("id", busyId).select("id");
  check(Boolean(del.error) || (del.data ?? []).length === 0, "Ana no puede borrar", del.error?.message);

  // -------------------------------------------------------------------------
  console.log("\n3. El «Ocupado» para el equipo");
  const busyFor = (u, workspace = ws) => u.client.rpc("google_busy_blocks", { p_workspace_id: workspace, p_user_ids: [ana.id], p_from: at(0), p_to: at(23) });
  const adminBusy = await busyFor(bruno);
  check(!adminBusy.error && adminBusy.data?.length === 1, "Bruno (Admin) ve UN bloque ocupado de Ana (ni el libre ni el rechazado)", adminBusy.error?.message ?? JSON.stringify(adminBusy.data));
  check(adminBusy.data?.[0] && !("summary" in adminBusy.data[0]), "y sin título");
  const memberBusy = await busyFor(carla);
  check(!memberBusy.error && (memberBusy.data ?? []).length === 0, "Carla (Member sin permiso) no ve nada", memberBusy.error?.message);
  const otherBusy = await busyFor(dani);
  check((otherBusy.data ?? []).length === 0, "Dani (otro negocio) no ve nada", otherBusy.error?.message);
  const ownBusy = await busyFor(ana);
  check((ownBusy.data ?? []).length === 0, "a Ana no le devuelve lo propio (lo ve con detalle por la tabla)");

  // -------------------------------------------------------------------------
  console.log("\n4. Reclamos a la vez");
  const nowIso = new Date().toISOString();
  const lockers = await Promise.all(
    Array.from({ length: 10 }, () =>
      svc
        .from("calendars")
        .update({ events_sync_lock_until: new Date(Date.now() + 120_000).toISOString() })
        .eq("id", cal.id)
        .or(`events_sync_lock_until.is.null,events_sync_lock_until.lt.${nowIso}`)
        .select("id")
        .maybeSingle(),
    ),
  );
  check(lockers.every((r) => !r.error), "10 lecturas a la vez no fallan", lockers.find((r) => r.error)?.error?.message);
  check(lockers.filter((r) => r.data).length === 1, "y el candado lo toma UNA", `tomaron ${lockers.filter((r) => r.data).length}`);

  const claims = await Promise.all(
    Array.from({ length: 10 }, () =>
      svc
        .from("google_calendar_events")
        .update({ importing_until: new Date(Date.now() + 60_000).toISOString() })
        .eq("id", busyId)
        .is("booking_id", null)
        .or(`importing_until.is.null,importing_until.lt.${nowIso}`)
        .select("id")
        .maybeSingle(),
    ),
  );
  check(claims.filter((r) => r.data).length === 1, "10 «Pasar al sistema» a la vez reclaman el evento UNA vez", `reclamaron ${claims.filter((r) => r.data).length}`);

  // Borrar el calendario se lleva su copia.
  await svc.from("calendars").delete().eq("id", cal.id);
  const left = await svc.from("google_calendar_events").select("id").eq("calendar_id", cal.id);
  check((left.data ?? []).length === 0, "borrar el calendario borra su copia (CASCADE)");
} catch (err) {
  fail("la verificacion se corto", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\nLimpieza");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures === 0 ? "\nTodo en verde." : `\n${failures} comprobacion(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
