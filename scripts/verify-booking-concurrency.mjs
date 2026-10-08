#!/usr/bin/env node
/**
 * Doble reserva del mismo horario, de verdad (F26, F29).
 *
 * Esto no se puede probar con vitest: la garantia no esta en el codigo, esta
 * en la base (la restriccion de exclusion con btree_gist y el advisory lock
 * por anfitrion). El script manda DOS llamadas a `create_booking` en paralelo
 * al mismo horario y afirma que una crea y la otra recibe 23P01.
 *
 * Se repite varias veces: una carrera que sale bien una vez puede ser suerte.
 *
 *   node scripts/verify-booking-concurrency.mjs
 *
 * No correrlo en simultaneo con otro verify-*: comparten el prefijo zz-test-.
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
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

const uid = () => `zztest${randomUUID().replace(/-/g, "").slice(0, 16)}`;

/** Cuantas veces se corre la carrera. */
const RONDAS = 5;

try {
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-conc", slug: `zz-test-conc-${Date.now()}` }).select("id").single();

  const email = `zz-test-conc-host-${Date.now()}@example.test`;
  const { data: created, error: eU } = await svc.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
  if (eU) throw new Error(`no pude crear el anfitrion: ${eU.message}`);
  const host = created.user.id;
  await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: host, role: "owner" });

  // El trigger de la 00097 precarga las categorias del workspace: se usa un tipo.
  const { data: cat } = await svc.from("booking_categories")
    .select("id").eq("workspace_id", ws.id).not("parent_id", "is", null).limit(1).single();

  const { data: ev, error: eE } = await svc.from("event_types").insert({
    workspace_id: ws.id, owner_user_id: host, category_id: cat.id, title: "zz-test-carrera", slug: "zz-test-carrera",
    duration_minutes: 30, status: "active", location_type: "manual", location_text: "Zoom",
  }).select("id").single();
  if (eE) throw new Error(`no pude crear el evento: ${eE.message}`);

  const args = (startAt, endAt) => ({
    p_workspace_id: ws.id,
    p_event_type_id: ev.id,
    p_host_user_id: host,
    p_start_at: startAt,
    p_end_at: endAt,
    p_title: "zz-test-carrera",
    p_name: "zz-test Carrera",
    p_email: `zz-test-carrera-${randomUUID().slice(0, 8)}@example.test`,
    p_phone: null,
    p_timezone: "America/Costa_Rica",
    p_host_timezone: "America/Costa_Rica",
    p_location_type: "manual",
    p_location_text: "Zoom",
    p_responses: {},
    p_origin: "public_page",
    p_utm: {},
    p_referrer_url: null,
    p_uid: uid(),
    p_category_id: cat.id,
    p_category_snapshot: {},
    p_contact_assignment: "none",
  });

  console.log(`\n— ${RONDAS} carreras por el mismo horario —`);
  for (let i = 0; i < RONDAS; i++) {
    // Un horario distinto por ronda, para que la ronda anterior no interfiera.
    const start = new Date(Date.UTC(2030, 5, 10 + i, 15, 0, 0)).toISOString();
    const end = new Date(Date.UTC(2030, 5, 10 + i, 15, 30, 0)).toISOString();

    const [a, b] = await Promise.all([
      svc.rpc("create_booking", args(start, end)),
      svc.rpc("create_booking", args(start, end)),
    ]);

    const creadas = [a, b].filter((r) => !r.error).length;
    const rechazos = [a, b].filter((r) => r.error?.code === "23P01").length;
    const otros = [a, b].filter((r) => r.error && r.error.code !== "23P01").map((r) => `${r.error.code}: ${r.error.message}`);

    check(
      creadas === 1 && rechazos === 1,
      `ronda ${i + 1}: una crea, la otra recibe 23P01 (creadas: ${creadas}, rechazos: ${rechazos})`,
      otros.join(" | ") || undefined,
    );

    const { count } = await svc.from("bookings").select("id", { count: "exact", head: true })
      .eq("event_type_id", ev.id).eq("start_at", start).eq("status_group", "active");
    check(count === 1, `ronda ${i + 1}: queda exactamente una agenda activa en ese horario (quedaron ${count})`);
  }

  console.log("\n— Diez llamadas a la vez —");
  {
    const start = "2030-07-01T15:00:00.000Z";
    const end = "2030-07-01T15:30:00.000Z";
    const results = await Promise.all(Array.from({ length: 10 }, () => svc.rpc("create_booking", args(start, end))));
    const creadas = results.filter((r) => !r.error).length;
    const rechazos = results.filter((r) => r.error?.code === "23P01").length;
    const otros = results.filter((r) => r.error && r.error.code !== "23P01").map((r) => `${r.error.code}: ${r.error.message}`);
    check(creadas === 1 && rechazos === 9, `una sola gana entre diez (creadas: ${creadas}, rechazos: ${rechazos})`, otros.join(" | ") || undefined);
  }

  console.log("\n— Horarios distintos en paralelo si entran las dos —");
  {
    const results = await Promise.all([
      svc.rpc("create_booking", args("2030-08-01T15:00:00.000Z", "2030-08-01T15:30:00.000Z")),
      svc.rpc("create_booking", args("2030-08-01T16:00:00.000Z", "2030-08-01T16:30:00.000Z")),
    ]);
    const errores = results.filter((r) => r.error).map((r) => `${r.error.code}: ${r.error.message}`);
    check(errores.length === 0, "dos horarios que no se pisan entran los dos", errores.join(" | ") || undefined);
  }

  console.log("\n— El mismo horario con otro anfitrion no choca —");
  {
    const email2 = `zz-test-conc-host2-${Date.now()}@example.test`;
    const { data: c2 } = await svc.auth.admin.createUser({ email: email2, password: randomUUID(), email_confirm: true });
    await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: c2.user.id, role: "member" });
    const { data: ev2 } = await svc.from("event_types").insert({
      workspace_id: ws.id, owner_user_id: c2.user.id, category_id: cat.id, title: "zz-test-carrera-2", slug: "zz-test-carrera-2",
      duration_minutes: 30, status: "active", location_type: "manual", location_text: "Zoom",
    }).select("id").single();

    const start = "2030-09-01T15:00:00.000Z";
    const end = "2030-09-01T15:30:00.000Z";
    const otroArgs = { ...args(start, end), p_event_type_id: ev2.id, p_host_user_id: c2.user.id, p_uid: uid() };
    const results = await Promise.all([
      svc.rpc("create_booking", args(start, end)),
      svc.rpc("create_booking", otroArgs),
    ]);
    const errores = results.filter((r) => r.error).map((r) => `${r.error.code}: ${r.error.message}`);
    check(errores.length === 0, "la exclusion es por anfitrion, no por horario global", errores.join(" | ") || undefined);
  }

  console.log("\n— Liberar espacio (Agenda v2): el horario vuelve a estar libre —");
  {
    const start = "2030-10-01T15:00:00.000Z";
    const end = "2030-10-01T15:30:00.000Z";
    const { data: r1 } = await svc.rpc("create_booking", args(start, end));
    await svc.from("bookings").update({ slot_released_at: new Date().toISOString(), slot_released_by: host }).eq("id", r1.booking_id);

    const { error: eSegunda } = await svc.rpc("create_booking", args(start, end));
    check(!eSegunda, "con la primera liberada, la segunda agenda entra en el mismo horario", eSegunda?.message);

    const { error: eOcupar } = await svc.from("bookings").update({ slot_released_at: null, slot_released_by: null }).eq("id", r1.booking_id);
    check(eOcupar?.code === "23P01", "volver a ocupar la primera choca con la segunda, que ya tomó el lugar", eOcupar?.message);
  }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}
console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
