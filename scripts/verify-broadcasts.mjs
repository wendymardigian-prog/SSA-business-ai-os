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
 *   - las tres funciones no las puede llamar un usuario con sesion;
 *   - (00288) `claim_broadcast_recipient` da primero al contacto con actividad mas
 *     reciente (`sort_key`) y deja al final a los que no tienen dato;
 *   - (00347) `delete_unsent_broadcast`: borra un pausado o cancelado que no mando
 *     nada (con su cola), y se niega con uno enviando, uno con un envio o uno de
 *     otro workspace.
 *
 *   node scripts/verify-broadcasts.mjs --despues-de-00347   # suma el bloque 7
 *   - (00355) `reopen_unsent_broadcast`: vuelve a borrador un programado o
 *     pausado sin envios (vacia su cola y los contadores) y se niega con uno
 *     enviando, uno con envios, uno terminado o de otro workspace.
 *
 *   node scripts/verify-broadcasts.mjs --despues-de-00355   # suma el bloque 8
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
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
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
  console.log("\n4b. (00288) primero los mas activos");
  {
    const { data: b2, error: b2Err } = await svc.from("broadcasts").insert({
      workspace_id: ws.id, name: "zz-test-orden", status: "sending", channel_id: ch.id, message_variants: ["Hola"],
    }).select("id").single();
    check(!b2Err, "un segundo broadcast para el orden", b2Err?.message);
    const keys = [new Date(Date.now() - 30 * 86400_000).toISOString(), new Date().toISOString(), null];
    const ins = await svc.from("broadcast_recipients").insert(contacts.map((c, i) => ({
      broadcast_id: b2.id, workspace_id: ws.id, contact_id: c, channel_id: ch.id, status: "pending", target: "+1", sort_key: keys[i],
    })));
    check(!ins.error, "tres destinatarios con distinta actividad", ins.error?.message);
    const order = [];
    for (let i = 0; i < 3; i++) {
      const r = await svc.rpc("claim_broadcast_recipient", { p_broadcast_id: b2.id });
      order.push((r.data ?? [])[0]?.contact_id);
    }
    check(order[0] === contacts[1] && order[1] === contacts[0] && order[2] === contacts[2], "sale primero el mas activo, despues el viejo y al final el que no tiene dato", JSON.stringify(order));
    const { data: act, error: actErr } = await svc.rpc("contact_last_activity", { p_workspace_id: ws.id, p_contact_ids: contacts });
    check(!actErr && (act ?? []).length === contacts.length && (act ?? []).every((a) => a.activity_at), "contact_last_activity da una fecha por contacto (sin actividad: el alta)", actErr?.message);
    const actAsUser = await owner.client.rpc("contact_last_activity", { p_workspace_id: ws.id, p_contact_ids: contacts });
    check(Boolean(actAsUser.error), "un usuario con sesion no puede llamar contact_last_activity");
    await svc.from("broadcast_recipients").delete().eq("broadcast_id", b2.id);
    await svc.from("broadcasts").delete().eq("id", b2.id);
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

  // -------------------------------------------------------------------------
  if (process.argv.includes("--despues-de-00347")) {
    console.log("\n7. (00347) eliminar un broadcast que nunca mando nada");
    const mk = async (name, status, recipientStatus) => {
      const { data, error } = await svc.from("broadcasts").insert({ workspace_id: ws.id, name, status, channel_id: ch.id }).select("id").single();
      if (error) throw new Error(`no pude crear ${name}: ${error.message}`);
      if (recipientStatus) {
        const ins = await svc.from("broadcast_recipients").insert(contacts.map((c, i) => ({
          broadcast_id: data.id, workspace_id: ws.id, contact_id: c, channel_id: ch.id, target: "+1",
          status: i === 0 ? recipientStatus : "cancelled",
        })));
        if (ins.error) throw new Error(`no pude crear los destinatarios de ${name}: ${ins.error.message}`);
      }
      return data.id;
    };
    const del = (id, workspaceId = ws.id) => svc.rpc("delete_unsent_broadcast", { p_workspace_id: workspaceId, p_broadcast_id: id });
    const exists = async (id) => ((await svc.from("broadcasts").select("id").eq("id", id)).data ?? []).length === 1;

    const cancelled = await mk("zz-test-borrar-cancelado", "cancelled", "cancelled");
    const r1 = await del(cancelled);
    const left = await svc.from("broadcast_recipients").select("id").eq("broadcast_id", cancelled);
    check(r1.data === "deleted" && !(await exists(cancelled)) && (left.data ?? []).length === 0, "un cancelado sin envios se borra con toda su cola", r1.error?.message ?? r1.data);

    const paused = await mk("zz-test-borrar-pausado", "paused", "pending");
    const r2 = await del(paused);
    check(r2.data === "deleted" && !(await exists(paused)), "un pausado con pendientes (sin envios) se borra", r2.error?.message ?? r2.data);

    const withSent = await mk("zz-test-borrar-con-envio", "cancelled", "sent");
    const r3 = await del(withSent);
    check(r3.data === "has_sends" && (await exists(withSent)), "uno con un enviado NO se borra (queda como historia)", r3.data);

    const withFailed = await mk("zz-test-borrar-con-fallo", "paused", "failed");
    check((await del(withFailed)).data === "has_sends", "uno con un fallido NO se borra");

    const inFlight = await mk("zz-test-borrar-saliendo", "paused", "sending");
    check((await del(inFlight)).data === "has_sends", "uno con un envio a mitad de camino NO se borra");

    const sending = await mk("zz-test-borrar-enviando", "sending", null);
    check((await del(sending)).data === "sending" && (await exists(sending)), "uno que se esta enviando NO se borra (primero se pausa)");

    const draft = await mk("zz-test-borrar-borrador", "draft", null);
    const { data: otherWs } = await svc.from("workspaces").insert({ name: "zz-test-broadcasts-otro", slug: `zz-test-broadcasts-otro-${stamp}` }).select("id").single();
    check((await del(draft, otherWs.id)).data === "not_found" && (await exists(draft)), "con otro workspace no lo encuentra ni lo borra");
    check((await del(draft)).data === "deleted", "un borrador se sigue borrando");

    const asUser = await owner.client.rpc("delete_unsent_broadcast", { p_workspace_id: ws.id, p_broadcast_id: withSent });
    check(Boolean(asUser.error), "un usuario con sesion no puede llamarla");
  }

  // -------------------------------------------------------------------------
  if (process.argv.includes("--despues-de-00355")) {
    console.log("\n8. (00355) volver a borrador para editar");
    const mk = async (name, status, recipientStatus) => {
      const { data, error } = await svc.from("broadcasts").insert({
        workspace_id: ws.id, name, status, channel_id: ch.id, total_recipients: 3, skipped: 1, started_at: new Date().toISOString(),
      }).select("id").single();
      if (error) throw new Error(`no pude crear ${name}: ${error.message}`);
      if (recipientStatus) {
        const ins = await svc.from("broadcast_recipients").insert(contacts.map((c, i) => ({
          broadcast_id: data.id, workspace_id: ws.id, contact_id: c, channel_id: ch.id, target: "+1",
          status: i === 0 ? recipientStatus : "pending",
        })));
        if (ins.error) throw new Error(`no pude crear los destinatarios de ${name}: ${ins.error.message}`);
      }
      return data.id;
    };
    const reopen = (id, workspaceId = ws.id) => svc.rpc("reopen_unsent_broadcast", { p_workspace_id: workspaceId, p_broadcast_id: id });
    const row = async (id) => (await svc.from("broadcasts").select("status, total_recipients, skipped, started_at").eq("id", id).single()).data;
    const queued = async (id) => ((await svc.from("broadcast_recipients").select("id").eq("broadcast_id", id)).data ?? []).length;

    const scheduled = await mk("zz-test-editar-programado", "scheduled", "pending");
    const r1 = await reopen(scheduled);
    const s1 = await row(scheduled);
    check(r1.data === "reopened" && s1.status === "draft" && s1.total_recipients === 0 && s1.skipped === 0 && s1.started_at === null && (await queued(scheduled)) === 0,
      "un programado sin envios vuelve a borrador, con la cola y los contadores vacios", r1.error?.message ?? JSON.stringify(s1));
    check((await reopen(scheduled)).data === "already_draft", "pedirlo de nuevo sobre un borrador no rompe nada");

    const paused = await mk("zz-test-editar-pausado", "paused", "cancelled");
    check((await reopen(paused)).data === "reopened" && (await row(paused)).status === "draft", "un pausado sin envios vuelve a borrador");

    const withSent = await mk("zz-test-editar-con-envio", "paused", "sent");
    check((await reopen(withSent)).data === "has_sends" && (await row(withSent)).status === "paused" && (await queued(withSent)) === 3,
      "uno pausado con un enviado NO vuelve a borrador y su cola queda igual");

    const inFlight = await mk("zz-test-editar-saliendo", "paused", "sending");
    check((await reopen(inFlight)).data === "has_sends", "uno con un envio a mitad de camino NO vuelve a borrador");

    const sending = await mk("zz-test-editar-enviando", "sending", null);
    check((await reopen(sending)).data === "sending" && (await row(sending)).status === "sending", "uno que se esta enviando NO vuelve (primero se pausa)");

    const done = await mk("zz-test-editar-terminado", "completed", null);
    check((await reopen(done)).data === "not_editable", "uno terminado no se edita");

    const other = await mk("zz-test-editar-otro-ws", "scheduled", null);
    const { data: otherWs } = await svc.from("workspaces").insert({ name: "zz-test-broadcasts-otro2", slug: `zz-test-broadcasts-otro2-${stamp}` }).select("id").single();
    check((await reopen(other, otherWs.id)).data === "not_found" && (await row(other)).status === "scheduled", "con otro workspace no lo encuentra ni lo toca");

    const asUser = await owner.client.rpc("reopen_unsent_broadcast", { p_workspace_id: ws.id, p_broadcast_id: other });
    check(Boolean(asUser.error), "un usuario con sesion no puede llamarla");
  }
} catch (err) {
  fail("la verificacion se corto", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\nLimpieza");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures === 0 ? "\nTodo en verde." : `\n${failures} comprobacion(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
