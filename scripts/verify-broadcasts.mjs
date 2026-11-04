#!/usr/bin/env node
/**
 * Verificacion de Broadcasts y la cola de envios (00285).
 *
 * Corre contra la base real. Prueba lo que Vitest NO puede probar: que la BASE
 * haga lo que dice
 *   - RLS: Owner lee los broadcasts; un Member (sin `broadcasts.manage`) no los
 *     ve, y nadie escribe con su sesion (escribe solo el servidor);
 *   - un contacto una sola vez por broadcast (indice unico);
 *   - `claim_lane_slot`: 10 pedidos a la vez sobre un carril vencido = UNO gana;
 *     un carril pausado o que todavia no vencio no se toma;
 *   - `claim_broadcast_recipient`: 10 pedidos a la vez sobre 3 pendientes = 3
 *     destinatarios distintos (ninguno dos veces) y 7 vacios; no toma uno cuyo
 *     reintento todavia no llego;
 *   - `refresh_broadcast_counts`: cuenta desde los destinatarios y cierra el
 *     broadcast cuando no queda nada;
 *   - las tres funciones no las puede llamar un usuario con sesion.
 *
 * Crea y borra todo lo suyo (prefijo zz-test-). No se corre a la vez que otro
 * verify-*: comparten prefijo. Tomar el candado /private/tmp/ssa-verify.lock.
 *
 *   node scripts/verify-broadcasts.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
  const email = `zz-test-broadcasts-${tag}-${stamp}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-broadcasts", slug: `zz-test-broadcasts-${stamp}` }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);

  const owner = await makeUser("owner");
  const member = await makeUser("member");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
  ]);

  const { data: ch, error: chErr } = await svc.from("channels").insert({
    workspace_id: ws.id, platform: "whatsapp", provider: "evolution", late_account_id: `evolution:zz-bc-${stamp}`,
    evolution_instance: `zz-test-bc-${stamp}`, display_name: "zz bc", is_active: true,
  }).select("id").single();
  if (chErr) throw new Error(`no pude crear el canal: ${chErr.message}`);

  const contacts = [];
  for (let i = 0; i < 3; i++) {
    const { data, error } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: `zz-test bc ${i}`, phone: `+54911${String(stamp + i).slice(-8)}` }).select("id").single();
    if (error) throw new Error(`no pude crear el contacto: ${error.message}`);
    contacts.push(data.id);
  }

  const { data: b, error: bErr } = await svc.from("broadcasts").insert({
    workspace_id: ws.id, name: "zz-test-broadcast", status: "sending", channel_id: ch.id, message_variants: ["Hola {{contact.first_name|che}}"],
  }).select("id").single();
  if (bErr) throw new Error(`no pude crear el broadcast: ${bErr.message}`);

  // -------------------------------------------------------------------------
  console.log("\n1. RLS: lee quien tiene broadcasts.manage; nadie escribe con su sesion");
  {
    const asOwner = await owner.client.from("broadcasts").select("id").eq("id", b.id);
    check(!asOwner.error && (asOwner.data ?? []).length === 1, "el Owner ve el broadcast", asOwner.error?.message);
    const asMember = await member.client.from("broadcasts").select("id").eq("id", b.id);
    check(!asMember.error && (asMember.data ?? []).length === 0, "el Member NO ve el broadcast (M6)");
    const insert = await owner.client.from("broadcasts").insert({ workspace_id: ws.id, name: "zz-test-desde-sesion" }).select("id");
    check(Boolean(insert.error) || (insert.data ?? []).length === 0, "ni el Owner inserta con su sesion (escribe el servidor)");
    const update = await owner.client.from("broadcasts").update({ name: "zz-test-cambiado" }).eq("id", b.id).select("id");
    check(!update.error && (update.data ?? []).length === 0, "ni el Owner edita con su sesion");
    const rec = await member.client.from("broadcast_recipients").insert({ broadcast_id: b.id, contact_id: contacts[0], channel_id: ch.id });
    check(Boolean(rec.error), "el Member no crea destinatarios");
  }

  // -------------------------------------------------------------------------
  console.log("\n2. Un contacto una sola vez por broadcast");
  {
    const rows = contacts.map((c) => ({ broadcast_id: b.id, workspace_id: ws.id, contact_id: c, channel_id: ch.id, status: "pending", target: "+1" }));
    const first = await svc.from("broadcast_recipients").insert(rows);
    check(!first.error, "se guardan los 3 destinatarios", first.error?.message);
    const dup = await svc.from("broadcast_recipients").insert(rows[0]);
    check(dup.error?.code === "23505", "el mismo contacto dos veces lo rechaza la base", dup.error?.message);
    const badStatus = await svc.from("broadcast_recipients").update({ status: "otro" }).eq("broadcast_id", b.id).eq("contact_id", contacts[0]);
    check(Boolean(badStatus.error), "un estado que no existe lo rechaza el CHECK");
  }

  // -------------------------------------------------------------------------
  console.log("\n3. claim_lane_slot: gana uno solo");
  {
    await svc.from("channel_send_lanes").insert({ channel_id: ch.id, workspace_id: ws.id, next_send_at: new Date(Date.now() - 1000).toISOString() });
    const next = new Date(Date.now() + 60_000).toISOString();
    const results = await Promise.all(Array.from({ length: 10 }, () => svc.rpc("claim_lane_slot", { p_channel_id: ch.id, p_next: next })));
    const wins = results.filter((r) => r.data === true).length;
    check(results.every((r) => !r.error) && wins === 1, "10 pedidos a la vez: gana 1", `ganaron ${wins}`);
    const again = await svc.rpc("claim_lane_slot", { p_channel_id: ch.id, p_next: next });
    check(again.data === false, "un carril que todavia no vencio no se toma");
    await svc.from("channel_send_lanes").update({ next_send_at: new Date(Date.now() - 1000).toISOString(), paused_at: new Date().toISOString() }).eq("channel_id", ch.id);
    const paused = await svc.rpc("claim_lane_slot", { p_channel_id: ch.id, p_next: next });
    check(paused.data === false, "un carril pausado no se toma");
    const asUser = await owner.client.rpc("claim_lane_slot", { p_channel_id: ch.id, p_next: next });
    check(Boolean(asUser.error), "un usuario con sesion no puede llamarla");
    const laneAsMember = await member.client.from("channel_send_lanes").select("channel_id").eq("channel_id", ch.id);
    check(!laneAsMember.error && (laneAsMember.data ?? []).length === 0, "el Member no ve el carril");
  }

  // -------------------------------------------------------------------------
  console.log("\n4. claim_broadcast_recipient: cada destinatario una sola vez");
  {
    await svc.from("broadcast_recipients").update({ next_attempt_at: new Date(Date.now() + 3600_000).toISOString() }).eq("broadcast_id", b.id).eq("contact_id", contacts[2]);
    const results = await Promise.all(Array.from({ length: 10 }, () => svc.rpc("claim_broadcast_recipient", { p_broadcast_id: b.id })));
    const claimed = results.flatMap((r) => r.data ?? []);
    const ids = new Set(claimed.map((r) => r.id));
    check(results.every((r) => !r.error), "ninguna llamada falla", results.find((r) => r.error)?.error?.message);
    check(claimed.length === 2 && ids.size === 2, "10 pedidos sobre 2 listos: 2 distintos (el del reintento futuro espera)", `tomados ${claimed.length}`);
    check(claimed.every((r) => r.status === "sending" && r.claimed_at), "quedan en 'sending' con su hora");
    const asUser = await owner.client.rpc("claim_broadcast_recipient", { p_broadcast_id: b.id });
    check(Boolean(asUser.error), "un usuario con sesion no puede llamarla");
  }

  // -------------------------------------------------------------------------
  console.log("\n5. refresh_broadcast_counts: cuenta y cierra");
  {
    await svc.from("broadcast_recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("broadcast_id", b.id).eq("status", "sending");
    const mid = await svc.rpc("refresh_broadcast_counts", { p_broadcast_id: b.id });
    const { data: row1 } = await svc.from("broadcasts").select("status, sent, skipped").eq("id", b.id).single();
    check(mid.data === "sending" && row1.sent === 2, "con uno pendiente sigue enviando, con 2 enviados", JSON.stringify(row1));
    await svc.from("broadcast_recipients").update({ status: "skipped", skip_reason: "do_not_contact" }).eq("broadcast_id", b.id).eq("status", "pending");
    const end = await svc.rpc("refresh_broadcast_counts", { p_broadcast_id: b.id });
    const { data: row2 } = await svc.from("broadcasts").select("status, sent, skipped, completed_at").eq("id", b.id).single();
    check(end.data === "completed" && row2.skipped === 1 && row2.completed_at, "sin pendientes termina, con su salteado contado", JSON.stringify(row2));
    const asUser = await owner.client.rpc("refresh_broadcast_counts", { p_broadcast_id: b.id });
    check(Boolean(asUser.error), "un usuario con sesion no puede llamarla");
  }

  // -------------------------------------------------------------------------
  console.log("\n6. Un broadcast pausado no se cierra solo");
  {
    const { data: p } = await svc.from("broadcasts").insert({ workspace_id: ws.id, name: "zz-test-pausado", status: "paused", channel_id: ch.id }).select("id").single();
    const res = await svc.rpc("refresh_broadcast_counts", { p_broadcast_id: p.id });
    check(res.data === "paused", "sin destinatarios pendientes, un pausado sigue pausado");
  }
} catch (err) {
  fail("la verificacion se corto", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\nLimpieza");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures === 0 ? "\nTodo en verde." : `\n${failures} comprobacion(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
