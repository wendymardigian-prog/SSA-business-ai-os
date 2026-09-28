#!/usr/bin/env node
/**
 * Verificacion del modulo de agendamiento contra la base real (Etapa 4).
 *
 * Prueba lo que vitest no alcanza: las policies de RLS de las tablas de
 * agenda, los unicos, la funcion scheduling_can_manage y la forma real del
 * guardado de conexiones OAuth (los indices parciales de la 00095).
 *
 * Crea un workspace con Owner, Member y Member "otro", y un usuario en OTRO
 * workspace. Borra todo (prefijo zz-test-). Una limpieza que falla es una
 * prueba que falla.
 *
 *   node scripts/verify-scheduling.mjs
 *
 * No correrlo en simultaneo con otro verify-*: comparten el prefijo.
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
  return { id: data.user.id, client, email };
}

const EVENTS = "https://www.googleapis.com/auth/calendar.events";

try {
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-sched", slug: `zz-test-sched-${Date.now()}` }).select("id").single();
  const { data: ws2 } = await svc.from("workspaces")
    .insert({ name: "zz-test-sched-2", slug: `zz-test-sched2-${Date.now()}` }).select("id").single();

  const owner = await makeUser("sched-owner");
  const member = await makeUser("sched-member");
  const otro = await makeUser("sched-otro");
  const ajeno = await makeUser("sched-ajeno");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
    { workspace_id: ws.id, user_id: otro.id, role: "member" },
    { workspace_id: ws2.id, user_id: ajeno.id, role: "owner" },
  ]);

  console.log("\n— Perfiles de agenda (F1, F3) —");
  {
    const { error: e1 } = await member.client.from("scheduling_profiles")
      .insert({ workspace_id: ws.id, user_id: member.id, username: "member-uno", display_name: "Member Uno", timezone: "America/Costa_Rica" });
    check(!e1, "un Member crea su propio perfil", e1?.message);

    const { error: e2 } = await member.client.from("scheduling_profiles")
      .insert({ workspace_id: ws.id, user_id: otro.id, username: "otro-perfil", display_name: "Otro", timezone: "America/Costa_Rica" });
    check(!!e2, "un Member NO crea el perfil de otra persona (sin manage_others)");

    const { error: e3 } = await owner.client.from("scheduling_profiles")
      .insert({ workspace_id: ws.id, user_id: otro.id, username: "otro-perfil", display_name: "Otro", timezone: "America/Costa_Rica" });
    check(!e3, "el Owner si crea el perfil de otra persona", e3?.message);

    const { error: e4 } = await svc.from("scheduling_profiles")
      .insert({ workspace_id: ws.id, user_id: owner.id, username: "member-uno", display_name: "Owner", timezone: "America/Costa_Rica" });
    check(e4?.code === "23505", "el usuario es unico en el workspace (el CHECK ya obliga a minusculas: la app lo baja antes de guardar)", e4?.message);
    const { error: e4b } = await svc.from("scheduling_profiles")
      .insert({ workspace_id: ws.id, user_id: owner.id, username: "Member-Uno", display_name: "Owner", timezone: "America/Costa_Rica" });
    check(!!e4b && e4b.code !== "23505", "un usuario con mayusculas lo rechaza el CHECK antes que el unico", e4b?.message);

    const { error: e5 } = await svc.from("scheduling_profiles")
      .insert({ workspace_id: ws.id, user_id: owner.id, username: "ab", display_name: "Owner", timezone: "America/Costa_Rica" });
    check(!!e5, "un usuario de 2 caracteres lo rechaza el CHECK");

    const { data: vis } = await member.client.from("scheduling_profiles").select("user_id").eq("workspace_id", ws.id);
    check((vis ?? []).length === 2, "un Member ve los perfiles de todo el workspace (para elegir anfitriones)");

    const { data: cruzado } = await ajeno.client.from("scheduling_profiles").select("id").eq("workspace_id", ws.id);
    check((cruzado ?? []).length === 0, "una persona de otro workspace no ve ningun perfil");

    const { error: e6 } = await otro.client.from("scheduling_profiles")
      .update({ display_name: "Hackeado" }).eq("user_id", member.id);
    const { data: intacto } = await svc.from("scheduling_profiles").select("display_name").eq("user_id", member.id).single();
    check(!e6 && intacto.display_name === "Member Uno", "un Member no edita el perfil de otro (la RLS lo deja en 0 filas)");
  }

  console.log("\n— Conexiones OAuth: indices parciales de la 00095 (F1, F4) —");
  {
    const base = { workspace_id: ws.id, provider: "google", granted_scopes: [], vault_secret_prefix: "oauth_google" };
    const { error: w1 } = await svc.from("oauth_connections").insert({ ...base, external_account_id: "canal-a", account_label: "A" });
    const { error: w2 } = await svc.from("oauth_connections").insert({ ...base, external_account_id: "canal-b", account_label: "B" });
    check(!w1 && w2?.code === "23505", "una sola conexion de WORKSPACE por proveedor, aunque cambie la cuenta externa", w1?.message ?? w2?.message);

    const per = (sub) => ({ workspace_id: ws.id, provider: "google_calendar", user_id: member.id, external_account_id: sub, granted_scopes: [EVENTS], vault_secret_prefix: `oauth_google_calendar_${randomUUID()}`, account_label: sub });
    const { data: c1, error: p1 } = await svc.from("oauth_connections").insert(per("sub-1")).select("id").single();
    const { error: p2 } = await svc.from("oauth_connections").insert(per("sub-1"));
    const { data: c2, error: p3 } = await svc.from("oauth_connections").insert(per("sub-2")).select("id").single();
    check(!p1 && p2?.code === "23505" && !p3, "por persona: la misma cuenta dos veces choca; una segunda cuenta distinta entra", p1?.message ?? p3?.message);

    const { data: propias } = await member.client.from("oauth_connections").select("id").eq("workspace_id", ws.id);
    check((propias ?? []).length === 2, "un Member ve SUS conexiones de Google Calendar (2), no la del workspace");
    const { data: ajenas } = await otro.client.from("oauth_connections").select("id").eq("workspace_id", ws.id);
    check((ajenas ?? []).length === 0, "otro Member no ve las conexiones de esa persona");
    const { data: todas } = await owner.client.from("oauth_connections").select("id").eq("workspace_id", ws.id);
    check((todas ?? []).length === 3, "el Owner sigue viendo todas (policy de la 00082)");

    console.log("\n— Calendarios (F1, F5) —");
    const cal = (connection_id, ext, extra = {}) => ({ workspace_id: ws.id, connection_id, user_id: member.id, external_calendar_id: ext, name: ext, access_role: "owner", ...extra });
    const { data: k1, error: k1e } = await svc.from("calendars").insert(cal(c1.id, "primary", { is_primary: true, check_conflicts: true })).select("id").single();
    const { error: k2e } = await svc.from("calendars").insert(cal(c1.id, "primary"));
    const { data: k3 } = await svc.from("calendars").insert(cal(c2.id, "primary")).select("id").single();
    check(!k1e && k2e?.code === "23505" && !!k3, "un calendario es unico por conexion + id externo (el mismo id en otra cuenta entra)", k1e?.message);

    const { data: mios } = await member.client.from("calendars").select("id").eq("workspace_id", ws.id);
    check((mios ?? []).length === 2, "la dueña ve sus calendarios");
    const { data: deOtro } = await otro.client.from("calendars").select("id").eq("workspace_id", ws.id);
    check((deOtro ?? []).length === 0, "un Member sin manage_others no ve calendarios ajenos");
    const { data: deOwner } = await owner.client.from("calendars").select("id").eq("workspace_id", ws.id);
    check((deOwner ?? []).length === 2, "el Owner (manage_others) los ve");
    const { data: cruz } = await ajeno.client.from("calendars").select("id").eq("workspace_id", ws.id);
    check((cruz ?? []).length === 0, "otro workspace no ve nada");

    const { error: sw } = await member.client.from("calendars").update({ check_conflicts: false }).eq("id", k1.id);
    const { data: swRow } = await svc.from("calendars").select("check_conflicts").eq("id", k1.id).single();
    check(!sw && swRow.check_conflicts === false, "la dueña cambia su switch de conflictos", sw?.message);
    await otro.client.from("calendars").update({ check_conflicts: true }).eq("id", k1.id);
    const { data: swRow2 } = await svc.from("calendars").select("check_conflicts").eq("id", k1.id).single();
    check(swRow2.check_conflicts === false, "otro Member no cambia el switch ajeno");
    const { error: ins } = await member.client.from("calendars").insert(cal(c1.id, "a-mano"));
    check(!!ins, "ni la dueña inserta calendarios a mano: eso lo hace la sincronizacion (servidor)");

    const { error: dest } = await member.client.from("scheduling_profiles").update({ default_destination_calendar_id: k1.id }).eq("user_id", member.id);
    check(!dest, "la persona elige su calendario destino por defecto", dest?.message);
    await svc.from("oauth_connections").delete().eq("id", c1.id);
    const { data: afterDel } = await svc.from("scheduling_profiles").select("default_destination_calendar_id").eq("user_id", member.id).single();
    const { data: calsLeft } = await svc.from("calendars").select("id").eq("connection_id", c1.id);
    check(afterDel.default_destination_calendar_id === null && (calsLeft ?? []).length === 0, "borrar la conexion se lleva sus calendarios y vacia el destino del perfil (ON DELETE)");
  }

  console.log("\n— Horarios y tiempo fuera (00096, F9, F10, F13) —");
  {
    // ensure_default_schedule: el perfil del Member ya existe, asi que crea "Horario normal".
    const { data: hid, error: eh } = await member.client.rpc("ensure_default_schedule", { p_workspace_id: ws.id, p_user_id: member.id });
    const { data: h1 } = await svc.from("availability_schedules").select("id, name, is_default, timezone, weekly_hours").eq("user_id", member.id).is("deleted_at", null);
    check(!eh && (h1 ?? []).length === 1 && h1[0].name === "Horario normal" && h1[0].is_default === true && h1[0].timezone === "America/Costa_Rica" && Object.keys(h1[0].weekly_hours).length === 5,
      "al crear el perfil existe exactamente un horario por defecto: Horario normal, lun a vie, en la zona del perfil", eh?.message);
    const { data: hid2 } = await member.client.rpc("ensure_default_schedule", { p_workspace_id: ws.id, p_user_id: member.id });
    check(hid2 === hid, "llamarla de nuevo no crea otro");
    const { data: prof } = await svc.from("scheduling_profiles").select("default_schedule_id").eq("user_id", member.id).single();
    check(prof.default_schedule_id === hid, "el perfil apunta a ese horario");

    const { error: e2 } = await member.client.from("availability_schedules")
      .insert({ workspace_id: ws.id, user_id: member.id, name: "Tardes", timezone: "America/Costa_Rica", is_default: true, weekly_hours: {}, date_overrides: [] });
    check(e2?.code === "23505", "un segundo horario por defecto para la misma persona falla (unico parcial)", e2?.message);

    const { data: tardes, error: e3 } = await member.client.from("availability_schedules")
      .insert({ workspace_id: ws.id, user_id: member.id, name: "Tardes", timezone: "America/Costa_Rica", weekly_hours: { "2": [{ start: "14:00", end: "18:00" }] }, date_overrides: [] })
      .select("id").single();
    check(!e3, "un Member crea un segundo horario (no por defecto)", e3?.message);

    const { error: e4 } = await member.client.rpc("set_default_schedule", { p_schedule_id: tardes.id });
    const { data: after } = await svc.from("availability_schedules").select("id, is_default").eq("user_id", member.id).is("deleted_at", null);
    const defaults = (after ?? []).filter((r) => r.is_default).map((r) => r.id);
    check(!e4 && defaults.length === 1 && defaults[0] === tardes.id, "marcar otro por defecto apaga el anterior en la misma transaccion", e4?.message);

    const { error: e5 } = await otro.client.rpc("set_default_schedule", { p_schedule_id: hid });
    check(!!e5, "otro Member no puede marcar por defecto un horario ajeno");

    const { data: ajenos } = await otro.client.from("availability_schedules").select("id").eq("workspace_id", ws.id);
    check((ajenos ?? []).length === 0, "un Member no ve los horarios de otra persona");
    const { data: deAdmin } = await owner.client.from("availability_schedules").select("id").eq("workspace_id", ws.id);
    check((deAdmin ?? []).length === 2, "el Owner (manage_others) los ve");
    const { data: cruz } = await ajeno.client.from("availability_schedules").select("id").eq("workspace_id", ws.id);
    check((cruz ?? []).length === 0, "otro workspace no ve ninguno");
    const { error: e6 } = await otro.client.from("availability_schedules").insert({ workspace_id: ws.id, user_id: member.id, name: "Colado", timezone: "UTC" });
    check(!!e6, "un Member no crea horarios a nombre de otro");
    const { error: e7 } = await member.client.from("availability_schedules").delete().eq("id", tardes.id);
    const { data: still } = await svc.from("availability_schedules").select("id").eq("id", tardes.id);
    check((still ?? []).length === 1, "no hay DELETE para usuarios: se borra con deleted_at", e7?.message);

    const { error: o1 } = await member.client.from("out_of_office")
      .insert({ workspace_id: ws.id, user_id: member.id, starts_at: "2026-12-20T06:00:00Z", ends_at: "2027-01-01T06:00:00Z", all_day: true, reason: "vacation", note: "zz" });
    check(!o1, "un Member carga su tiempo fuera", o1?.message);
    const { error: o2 } = await member.client.from("out_of_office")
      .insert({ workspace_id: ws.id, user_id: member.id, starts_at: "2026-12-20T06:00:00Z", ends_at: "2026-12-19T06:00:00Z", reason: "travel" });
    check(!!o2, "un fin anterior al inicio lo rechaza el CHECK");
    const { error: o3 } = await member.client.from("out_of_office")
      .insert({ workspace_id: ws.id, user_id: member.id, starts_at: "2026-12-20T06:00:00Z", ends_at: "2026-12-21T06:00:00Z", reason: "fiesta" });
    check(!!o3, "un motivo fuera de la lista lo rechaza el CHECK");
    const { data: oAjeno } = await otro.client.from("out_of_office").select("id").eq("workspace_id", ws.id);
    check((oAjeno ?? []).length === 0, "otro Member no ve el tiempo fuera ajeno");
    const { data: oCruz } = await ajeno.client.from("out_of_office").select("id").eq("workspace_id", ws.id);
    check((oCruz ?? []).length === 0, "otro workspace tampoco");

    const { data: purga, error: pe } = await svc.rpc("purge_soft_deleted", { p_retention_days: 30 });
    check(!pe && purga && "availability_schedules" in purga && "out_of_office" in purga, "purge_soft_deleted conoce las dos tablas nuevas", pe?.message);
  }

  console.log("\n— Categorias (00097, F50) —");
  {
    const { data: cats } = await svc.from("booking_categories").select("id, name, parent_id, is_system").eq("workspace_id", ws.id);
    const areas = (cats ?? []).filter((c) => !c.parent_id);
    const tipos = (cats ?? []).filter((c) => c.parent_id);
    check(areas.length === 2 && tipos.length === 5, `al crear un workspace hay exactamente 2 areas y 5 tipos (hay ${areas.length} y ${tipos.length})`);
    check(areas.every((a) => a.is_system) && areas.map((a) => a.name).sort().join(",") === "Servicio,Ventas", "las areas son Ventas y Servicio, de sistema");

    const ventas = areas.find((a) => a.name === "Ventas");
    const triaje = tipos.find((t) => t.name === "Triaje");
    const { error: e3 } = await svc.from("booking_categories").insert({ workspace_id: ws.id, parent_id: triaje.id, name: "Tercer nivel" });
    check(!!e3 && /dos niveles/.test(e3.message), "un tipo cuyo padre es otro tipo lo rechaza el trigger", e3?.message);

    const { error: eDup } = await svc.from("booking_categories").insert({ workspace_id: ws.id, name: "ventas" });
    check(eDup?.code === "23505", "un area con el nombre de otra activa (sin importar mayusculas) choca", eDup?.message);

    const { error: eCruz } = await svc.from("booking_categories").insert({ workspace_id: ws2.id, parent_id: ventas.id, name: "Colado" });
    check(!!eCruz, "un tipo cuyo padre es de otro workspace se rechaza");

    // Un Member sin el permiso no escribe; el Owner si.
    const { error: eMember } = await member.client.from("booking_categories").insert({ workspace_id: ws.id, name: "zz-member" });
    check(!!eMember, "un Member sin scheduling.manage_categories no crea categorias");
    const { data: verMember } = await member.client.from("booking_categories").select("id").eq("workspace_id", ws.id);
    check((verMember ?? []).length === 7, "pero SI las ve (hacen falta para elegir y filtrar)");
    const { data: nueva, error: eOwner } = await owner.client.from("booking_categories").insert({ workspace_id: ws.id, name: "zz-comunidad", color: "#16a34a" }).select("id").single();
    check(!eOwner, "el Owner si crea un area", eOwner?.message);
    const { error: eDel } = await owner.client.from("booking_categories").delete().eq("id", nueva.id);
    const { data: sigue } = await svc.from("booking_categories").select("id").eq("id", nueva.id);
    check((sigue ?? []).length === 1, "no hay DELETE para nadie: se archiva", eDel?.message);
    const { error: eArch } = await owner.client.from("booking_categories").update({ archived_at: new Date().toISOString() }).eq("id", nueva.id);
    check(!eArch, "archivar es un update normal", eArch?.message);
    const { data: cruzados } = await ajeno.client.from("booking_categories").select("id").eq("workspace_id", ws.id);
    check((cruzados ?? []).length === 0, "otro workspace no ve estas categorias");
  }

  console.log("\n— Eventos (00098, F16) —");
  {
    const { data: cats } = await svc.from("booking_categories").select("id, name").eq("workspace_id", ws.id).is("parent_id", null);
    const ventas = cats.find((c) => c.name === "Ventas");
    const base = { workspace_id: ws.id, category_id: ventas.id, title: "zz-test-evento", duration_minutes: 30 };

    const { data: ev1, error: e1 } = await member.client.from("event_types").insert({ ...base, owner_user_id: member.id, slug: "zz-llamada" }).select("id").single();
    check(!e1, "un Member crea su propio evento", e1?.message);

    const { error: e2 } = await member.client.from("event_types").insert({ ...base, owner_user_id: member.id, slug: "zz-llamada" });
    check(e2?.code === "23505", "el mismo slug para la misma persona choca", e2?.message);

    const { error: e3 } = await svc.from("event_types").insert({ ...base, owner_user_id: otro.id, slug: "zz-llamada" });
    check(!e3, "otra persona SI puede usar el mismo slug (el link lleva su usuario adelante)", e3?.message);

    const { error: e4 } = await member.client.from("event_types").insert({ ...base, owner_user_id: otro.id, slug: "zz-ajeno" });
    check(!!e4, "un Member no crea eventos a nombre de otra persona");

    const { error: e5 } = await otro.client.from("event_types").update({ title: "Hackeado" }).eq("id", ev1.id);
    const { data: intacto } = await svc.from("event_types").select("title").eq("id", ev1.id).single();
    check(intacto.title === "zz-test-evento", "un Member no edita un evento ajeno (RLS)", e5?.message);

    const { data: verMember } = await member.client.from("event_types").select("id").eq("workspace_id", ws.id);
    check((verMember ?? []).length === 2, "los eventos los ven todos los miembros (para elegirlos en flows y al agendar)");
    const { data: cruz } = await ajeno.client.from("event_types").select("id").eq("workspace_id", ws.id);
    check((cruz ?? []).length === 0, "otro workspace no ve ningun evento");

    const { error: e6 } = await svc.from("event_types").insert({ ...base, owner_user_id: member.id, slug: "Con Mayusculas" });
    check(!!e6, "un slug con mayusculas o espacios lo rechaza el CHECK");
    const { error: e7 } = await svc.from("event_types").insert({ ...base, owner_user_id: member.id, slug: "zz-corto", duration_minutes: 3 });
    check(!!e7, "una duracion menor a 5 minutos la rechaza el CHECK");
    const { error: e8 } = await svc.from("event_types").insert({ ...base, owner_user_id: member.id, slug: "zz-estado", status: "inventado" });
    check(!!e8, "un estado fuera de la lista lo rechaza el CHECK");

    // flows.event_type_id y workspaces.scheduling_auto_create_flows
    const { data: flow, error: eF } = await svc.from("flows").insert({ workspace_id: ws.id, name: "zz-test-flujo", status: "draft", event_type_id: ev1.id, template_key: "confirmation" }).select("id, event_type_id, template_key").single();
    check(!eF && flow.event_type_id === ev1.id && flow.template_key === "confirmation", "un flow puede pertenecer a un evento", eF?.message);
    const { data: wsRow } = await svc.from("workspaces").select("scheduling_auto_create_flows, scheduling_public_base_url").eq("id", ws.id).single();
    check(wsRow.scheduling_auto_create_flows === true && wsRow.scheduling_public_base_url === null, "el workspace trae la opcion de flujos sugeridos encendida y sin dominio propio");

    // La purga conoce los eventos.
    const { data: purga } = await svc.rpc("purge_soft_deleted", { p_retention_days: 30 });
    check(purga && "event_types" in purga, "purge_soft_deleted conoce event_types");
  }

  console.log("\n— scheduling_can_manage —");
  {
    const { data: a } = await member.client.rpc("scheduling_can_manage", { p_workspace_id: ws.id, p_user_id: member.id });
    const { data: b } = await member.client.rpc("scheduling_can_manage", { p_workspace_id: ws.id, p_user_id: otro.id });
    const { data: c } = await owner.client.rpc("scheduling_can_manage", { p_workspace_id: ws.id, p_user_id: otro.id });
    const { data: d } = await ajeno.client.rpc("scheduling_can_manage", { p_workspace_id: ws.id, p_user_id: ajeno.id });
    check(a === true && b === false && c === true && d === false, "propia si; ajena solo admin/manage_others; otro workspace nunca", JSON.stringify({ a, b, c, d }));
  }

  console.log("\n— contacts.timezone —");
  {
    const { data: ct, error } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test-tz", timezone: "America/Mexico_City" }).select("timezone").single();
    check(!error && ct.timezone === "America/Mexico_City", "la columna existe y guarda una zona IANA", error?.message);
  }

  console.log("\n— Bucket avatars —");
  {
    const { data: bucket } = await svc.storage.getBucket("avatars");
    check(bucket?.public === true && bucket?.file_size_limit === 2097152, "existe, es publico y limita a 2 MB", JSON.stringify(bucket));
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const propio = `${ws.id}/${member.id}/zz-test.png`;
    const { error: up } = await member.client.storage.from("avatars").upload(propio, png, { contentType: "image/png", upsert: true });
    check(!up, "un miembro sube su foto en la carpeta de su workspace", up?.message);
    const { error: upAjeno } = await ajeno.client.storage.from("avatars").upload(`${ws.id}/${ajeno.id}/zz-test.png`, png, { contentType: "image/png", upsert: true });
    check(!!upAjeno, "alguien de otro workspace no sube en esa carpeta");
    await svc.storage.from("avatars").remove([propio]);
  }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}
console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
