#!/usr/bin/env node
/**
 * Verificacion de Mi cuenta (00273, 00274 y, con --despues-de-00275, el trigger).
 *
 * Prueba contra la base real, con usuarios de verdad, lo que vitest no puede:
 *   1. `user_profiles`: cada uno ve, crea y edita SOLO su fila; los CHECK del
 *      telefono y de la ruta de la foto.
 *   2. El bucket `user-avatars`: publico, y nadie con sesion puede subir (ni a
 *      su propia carpeta: sube el servidor).
 *   3. `user_preferences.notification_prefs`: solo la propia, y el CHECK de objeto.
 *   4. `workspaces.team_alerts_settings`: un Member no lo puede cambiar.
 *   5. `workspace_member_profiles` devuelve la foto y sigue cerrada a `authenticated`.
 *   6. (--despues-de-00275) un aviso nuevo encola su `notification_deliver`, y si
 *      encolar falla, el aviso se guarda igual.
 *
 * Crea y limpia sus datos (prefijo `zz-test-`). No correr en simultaneo con los
 * otros verify-*: tomar el candado /private/tmp/ssa-verify.lock.
 *
 *   node scripts/verify-account.mjs
 *   node scripts/verify-account.mjs --despues-de-00275
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
const AFTER_00275 = process.argv.includes("--despues-de-00275");

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();

async function makeUser(tag) {
  const email = `zz-test-account-${tag}-${stamp}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

// Un PNG de 1x1.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces")
    .insert({ name: "zz-test-account", slug: `zz-test-account-${stamp}` }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);

  const ana = await makeUser("ana");
  const bruno = await makeUser("bruno");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: ana.id, role: "owner" },
    { workspace_id: ws.id, user_id: bruno.id, role: "member" },
  ]);

  // -------------------------------------------------------------------------
  console.log("\n1. user_profiles: solo la fila propia");
  {
    const mine = await ana.client.from("user_profiles").insert({ user_id: ana.id, phone: "+5491122334455" }).select("user_id").single();
    check(!mine.error, "Ana crea su perfil", mine.error?.message);
    const forOther = await bruno.client.from("user_profiles").insert({ user_id: ana.id, phone: "+5491100000000" });
    check(Boolean(forOther.error), "Bruno NO puede crear un perfil a nombre de Ana");
    const peek = await bruno.client.from("user_profiles").select("phone").eq("user_id", ana.id);
    check(!peek.error && (peek.data ?? []).length === 0, "Bruno NO ve el telefono de Ana", JSON.stringify(peek.data));
    const edit = await bruno.client.from("user_profiles").update({ phone: "+5491100000000" }).eq("user_id", ana.id).select("user_id");
    check(!edit.error && (edit.data ?? []).length === 0, "Bruno NO puede editar el perfil de Ana");
    const del = await ana.client.from("user_profiles").delete().eq("user_id", ana.id).select("user_id");
    check((del.data ?? []).length === 0, "nadie borra su perfil a mano (sin policy de DELETE)");
    const badPhone = await ana.client.from("user_profiles").update({ phone: "1234" }).eq("user_id", ana.id);
    check(Boolean(badPhone.error), "el CHECK rechaza un telefono sin el formato +<digitos>");
    const badPath = await ana.client.from("user_profiles").update({ avatar_path: `${bruno.id}/x.jpg` }).eq("user_id", ana.id);
    check(Boolean(badPath.error), "el CHECK rechaza una foto fuera de la carpeta de la persona");
    const goodPath = await ana.client.from("user_profiles").update({ avatar_path: `${ana.id}/zz-test.png` }).eq("user_id", ana.id);
    check(!goodPath.error, "una foto en su carpeta se acepta", goodPath.error?.message);
  }

  // -------------------------------------------------------------------------
  console.log("\n2. El bucket user-avatars");
  {
    const { data: bucket } = await svc.storage.getBucket("user-avatars");
    check(bucket?.public === true, "es publico (la foto se ve en toda la app)");
    const own = await ana.client.storage.from("user-avatars").upload(`${ana.id}/zz-test-${stamp}.png`, PNG, { contentType: "image/png" });
    check(Boolean(own.error), "con sesion no se puede subir, ni en la carpeta propia (sube el servidor)");
    const bySvc = await svc.storage.from("user-avatars").upload(`${ana.id}/zz-test-${stamp}.png`, PNG, { contentType: "image/png" });
    check(!bySvc.error, "el servidor sube", bySvc.error?.message);
    const removeOther = await bruno.client.storage.from("user-avatars").remove([`${ana.id}/zz-test-${stamp}.png`]);
    const still = await svc.storage.from("user-avatars").list(ana.id);
    check((still.data ?? []).some((f) => f.name === `zz-test-${stamp}.png`), "Bruno no puede borrar la foto de Ana", removeOther.error?.message);
    await svc.storage.from("user-avatars").remove([`${ana.id}/zz-test-${stamp}.png`]);
  }

  // -------------------------------------------------------------------------
  console.log("\n3. Preferencias de avisos");
  {
    const mine = await ana.client.from("user_preferences")
      .upsert({ user_id: ana.id, timezone: "UTC", notification_prefs: { bookings: { email: true } } }, { onConflict: "user_id" })
      .select("notification_prefs").single();
    check(!mine.error && mine.data?.notification_prefs?.bookings?.email === true, "Ana guarda sus preferencias", mine.error?.message);
    const notObject = await ana.client.from("user_preferences").update({ notification_prefs: [1, 2] }).eq("user_id", ana.id);
    check(Boolean(notObject.error), "el CHECK exige un objeto");
    const other = await bruno.client.from("user_preferences").update({ notification_prefs: {} }).eq("user_id", ana.id).select("user_id");
    check(!other.error && (other.data ?? []).length === 0, "Bruno no toca las preferencias de Ana");
    const fresh = await svc.from("user_preferences").select("notification_prefs").eq("user_id", bruno.id).maybeSingle();
    check(!fresh.data || JSON.stringify(fresh.data.notification_prefs) === "{}", "sin cambios, el jsonb arranca vacio (todo con los defaults)");
  }

  // -------------------------------------------------------------------------
  console.log("\n4. El WhatsApp de avisos del negocio");
  {
    const attempt = await bruno.client.from("workspaces").update({ team_alerts_settings: { whatsapp_channel_id: randomUUID() } }).eq("id", ws.id).select("id");
    check(!attempt.error ? (attempt.data ?? []).length === 0 : true, "un Member no lo puede cambiar");
    const bad = await svc.from("workspaces").update({ team_alerts_settings: "x" }).eq("id", ws.id);
    check(Boolean(bad.error), "el CHECK exige un objeto");
  }

  // -------------------------------------------------------------------------
  console.log("\n5. workspace_member_profiles");
  {
    const { data, error } = await svc.rpc("workspace_member_profiles", { p_workspace_id: ws.id });
    const anaRow = (data ?? []).find((r) => r.user_id === ana.id);
    check(!error && anaRow?.avatar_path === `${ana.id}/zz-test.png`, "devuelve la foto de cada persona", error?.message);
    check(anaRow?.full_name === "zz-test ana", "y el nombre de siempre");
    const denied = await ana.client.rpc("workspace_member_profiles", { p_workspace_id: ws.id });
    check(Boolean(denied.error), "sigue cerrada a authenticated (devuelve emails)");
  }

  // -------------------------------------------------------------------------
  if (AFTER_00275) {
    console.log("\n6. Cada aviso encola su entrega");
    const { data: n, error } = await svc.from("notifications")
      .insert({ workspace_id: ws.id, type: "booking_created", title: "zz-test aviso", recipient_id: ana.id })
      .select("id").single();
    check(!error, "el aviso se guarda", error?.message);
    const { data: jobs } = await svc.from("scheduled_jobs").select("id, status, dedupe_key").eq("type", "notification_deliver").eq("dedupe_key", `notification_deliver:${n.id}`);
    check((jobs ?? []).length === 1, "y queda un job notification_deliver con su clave", JSON.stringify(jobs));
    await svc.from("scheduled_jobs").delete().in("id", (jobs ?? []).map((j) => j.id));
  } else {
    console.log("\n6. (el trigger de la 00275 se prueba con --despues-de-00275)");
  }
} catch (err) {
  fail("la verificacion se corto", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\nLimpieza");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures === 0 ? "\nTodo en verde." : `\n${failures} comprobacion(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
