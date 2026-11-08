#!/usr/bin/env node
/**
 * Verificacion de los grupos de WhatsApp (00280, 00281, 00282).
 *
 * Prueba contra la base real, con usuarios de verdad, lo que vitest no puede:
 *   1. Quien ve un grupo (`can_see_whatsapp_group`) y quien escribe (`can_write_whatsapp_group`): las gemelas de
 *      TypeScript con los casos de lib/auth/whatsapp-group-access.cases.json, con un rol personalizado por caso.
 *      Owner ve y escribe; el Member de sistema (solo lo asignado) no ve un grupo.
 *   2. La RLS de las cinco tablas: un Member sin acceso no ve mensajes, miembros, reacciones ni votos; nadie
 *      escribe con la sesion (escribe el servidor).
 *   3. Los unicos: un grupo por numero, un miembro por grupo, una reaccion y un voto por persona y mensaje, y el
 *      `(group_id, platform_message_id)` que junta el eco con el envio (con varios envios fallidos sin id).
 *   4. El toque `whatsapp_group` se acepta y es ORGANICO (touch_channel, 00281); un origen inventado sigue afuera.
 *   5. `triggers.type` acepta los tres disparadores nuevos (00282).
 *   6. Borrar el grupo se lleva sus mensajes, miembros, reacciones y votos (cascada).
 *
 * Crea y limpia sus datos (prefijo `zz-test-`). No correr en simultaneo con los otros verify-*: tomar el candado
 * /private/tmp/ssa-verify.lock.
 *
 *   node scripts/verify-whatsapp-groups.mjs
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
const cases = JSON.parse(readFileSync("lib/auth/whatsapp-group-access.cases.json", "utf8")).cases;

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();

async function makeUser(tag) {
  const email = `zz-test-groups-${tag}-${stamp}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-groups", slug: `zz-test-groups-${stamp}` }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);
  const { data: ch, error: chErr } = await svc.from("channels").insert({
    workspace_id: ws.id, platform: "whatsapp", late_account_id: `zz-wa-groups-${stamp}`, username: "zzwa", display_name: "zz wa", is_active: true,
  }).select("id").single();
  if (chErr) throw new Error(`no pude crear el canal: ${chErr.message}`);

  const owner = await makeUser("owner");
  const member = await makeUser("member");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
  ]);

  const { data: group, error: gErr } = await svc.from("whatsapp_groups").insert({
    workspace_id: ws.id, channel_id: ch.id, group_jid: "120363000000000001@g.us", subject: "zz-test grupo", in_inbox: true, save_contacts: true,
  }).select("id").single();
  if (gErr) throw new Error(`no pude crear el grupo: ${gErr.message}`);

  // -------------------------------------------------------------------------
  console.log("\n1. Quien ve y quien escribe un grupo (gemelas SQL <-> TS)");
  {
    const see = await owner.client.rpc("can_see_whatsapp_group", { p_group_id: group.id });
    const write = await owner.client.rpc("can_write_whatsapp_group", { p_group_id: group.id });
    check(see.data === true && write.data === true, "el Owner ve y escribe", see.error?.message ?? write.error?.message);
    const mSee = await member.client.rpc("can_see_whatsapp_group", { p_group_id: group.id });
    check(mSee.data === false, "el Member de sistema (solo lo asignado) no ve un grupo", JSON.stringify(mSee));

    for (const c of cases) {
      const channels = JSON.parse(JSON.stringify(c.channels).replaceAll('"CH"', JSON.stringify(ch.id)));
      const { data: role, error } = await svc.from("workspace_roles").insert({
        workspace_id: ws.id, name: `zz-test ${c.name}`.slice(0, 60), description: "", permissions: { keys: [], scopes: {}, channels },
      }).select("id").single();
      if (error) { fail(`no pude crear el rol del caso «${c.name}»`, error.message); continue; }
      await svc.from("workspace_members").update({ role_id: role.id }).eq("workspace_id", ws.id).eq("user_id", member.id);
      const s = await member.client.rpc("can_see_whatsapp_group", { p_group_id: group.id });
      const w = await member.client.rpc("can_write_whatsapp_group", { p_group_id: group.id });
      check(s.data === c.see && w.data === c.write, `caso «${c.name}»: ve=${c.see}, escribe=${c.write}`, `dio ve=${s.data}, escribe=${w.data}`);
    }
    // Vuelve a ser un Member de sistema para lo que sigue.
    await svc.from("workspace_members").update({ role_id: null }).eq("workspace_id", ws.id).eq("user_id", member.id);
    const otro = await svc.rpc("can_see_whatsapp_group", { p_group_id: randomUUID() });
    check(otro.data === false, "un grupo que no existe da false, nunca NULL", JSON.stringify(otro.data));
  }

  // -------------------------------------------------------------------------
  console.log("\n2. La RLS de las tablas");
  const { data: msg } = await svc.from("whatsapp_group_messages").insert({
    workspace_id: ws.id, group_id: group.id, platform_message_id: `zz-${stamp}`, direction: "outbound", text: "zz-test hola", origin: "app",
  }).select("id").single();
  await svc.from("whatsapp_group_members").insert({ workspace_id: ws.id, group_id: group.id, participant_id: "+5491100000001", source: "join" });
  await svc.from("whatsapp_group_reactions").insert({ workspace_id: ws.id, group_id: group.id, message_id: msg.id, participant_id: "+5491100000001", emoji: "🔥" });
  await svc.from("whatsapp_poll_votes").insert({ workspace_id: ws.id, group_id: group.id, message_id: msg.id, participant_id: "+5491100000001", selected_options: ["a"] });
  {
    for (const table of ["whatsapp_groups", "whatsapp_group_messages", "whatsapp_group_members", "whatsapp_group_reactions", "whatsapp_poll_votes"]) {
      const o = await owner.client.from(table).select("id").eq("workspace_id", ws.id);
      const m = await member.client.from(table).select("id").eq("workspace_id", ws.id);
      check((o.data ?? []).length > 0 && (m.data ?? []).length === 0, `${table}: el Owner ve, el Member sin acceso no`, `${o.error?.message ?? ""} ${JSON.stringify([o.data?.length, m.data?.length])}`);
    }
    const write = await owner.client.from("whatsapp_group_messages").insert({ workspace_id: ws.id, group_id: group.id, direction: "outbound", text: "x" });
    check(Boolean(write.error), "nadie escribe con la sesion (ni el Owner): escribe el servidor");
    const upd = await owner.client.from("whatsapp_groups").update({ in_inbox: false }).eq("id", group.id).select("id");
    check(Boolean(upd.error) || (upd.data ?? []).length === 0, "ni cambia un grupo con la sesion");
  }

  // -------------------------------------------------------------------------
  console.log("\n3. Los unicos");
  {
    const dupGroup = await svc.from("whatsapp_groups").insert({ workspace_id: ws.id, channel_id: ch.id, group_jid: "120363000000000001@g.us", subject: "x" });
    check(dupGroup.error?.code === "23505", "un grupo por numero", dupGroup.error?.message);
    const badJid = await svc.from("whatsapp_groups").insert({ workspace_id: ws.id, channel_id: ch.id, group_jid: "5491100000000@s.whatsapp.net", subject: "x" });
    check(Boolean(badJid.error), "el CHECK rechaza un JID que no es de un grupo");
    const dupMember = await svc.from("whatsapp_group_members").insert({ workspace_id: ws.id, group_id: group.id, participant_id: "+5491100000001" });
    check(dupMember.error?.code === "23505", "un miembro por grupo");
    const dupReaction = await svc.from("whatsapp_group_reactions").insert({ workspace_id: ws.id, group_id: group.id, message_id: msg.id, participant_id: "+5491100000001", emoji: "👍" });
    check(dupReaction.error?.code === "23505", "una reaccion por persona y mensaje");
    const dupVote = await svc.from("whatsapp_poll_votes").insert({ workspace_id: ws.id, group_id: group.id, message_id: msg.id, participant_id: "+5491100000001" });
    check(dupVote.error?.code === "23505", "un voto por persona y encuesta");
    const echo = await svc.from("whatsapp_group_messages")
      .upsert({ workspace_id: ws.id, group_id: group.id, platform_message_id: `zz-${stamp}`, direction: "outbound", text: "eco", origin: "external" }, { onConflict: "group_id,platform_message_id", ignoreDuplicates: true })
      .select("id");
    check(!echo.error && (echo.data ?? []).length === 0, "el eco con el mismo id no duplica (on_conflict sobre el indice)", echo.error?.message);
    const failed = await svc.from("whatsapp_group_messages").insert([
      { workspace_id: ws.id, group_id: group.id, direction: "outbound", text: "f1", status: "failed" },
      { workspace_id: ws.id, group_id: group.id, direction: "outbound", text: "f2", status: "failed" },
    ]);
    check(!failed.error, "varios envios fallidos (sin id de WhatsApp) conviven", failed.error?.message);
  }

  // -------------------------------------------------------------------------
  console.log("\n4. El toque del grupo (00281)");
  {
    const { data: contact } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test miembro", phone: `+54911${String(stamp).slice(-8)}` }).select("id").single();
    const touch = await svc.from("contact_touches").insert({
      workspace_id: ws.id, contact_id: contact.id, occurred_at: new Date().toISOString(), source: "whatsapp", medium: "whatsapp_group",
      origin: "whatsapp_group", content_label: "zz-test grupo", dedupe_key: `wa-group:${group.id}:${contact.id}`,
    }).select("channel").single();
    check(!touch.error && touch.data?.channel === "organic", "el origen whatsapp_group se acepta y cuenta como organico", touch.error?.message ?? touch.data?.channel);
    const rpc = await svc.rpc("touch_channel", {
      p_origin: "whatsapp_group", p_medium: "whatsapp_group", p_source: "whatsapp", p_ad_id: null, p_adset_id: null, p_campaign_id: null, p_meta_ad_id: null,
      p_meta_campaign_id: null, p_gclid: null, p_ttclid: null, p_li_fat_id: null, p_ctwa_clid: null, p_fbclid: null, p_social_post_id: null, p_content_post_id: null,
    });
    check(rpc.data === "organic", "touch_channel (gemela) da organico", JSON.stringify(rpc));
    const bad = await svc.from("contact_touches").insert({ workspace_id: ws.id, contact_id: contact.id, source: "web", origin: "inventado", dedupe_key: `zz-bad-${stamp}` });
    check(Boolean(bad.error), "un origen inventado sigue rechazado");
  }

  // -------------------------------------------------------------------------
  console.log("\n5. Los tres disparadores nuevos (00282)");
  {
    const { data: flow } = await svc.from("flows").insert({ workspace_id: ws.id, name: "zz-test grupos", nodes: [], edges: [] }).select("id").single();
    for (const type of ["whatsapp_group_joined", "whatsapp_group_reaction", "whatsapp_group_poll_vote"]) {
      const t = await svc.from("triggers").insert({ flow_id: flow.id, type, config: {} });
      check(!t.error, `triggers.type acepta ${type}`, t.error?.message);
    }
    const bad = await svc.from("triggers").insert({ flow_id: flow.id, type: "zz_inventado", config: {} });
    check(Boolean(bad.error), "un tipo inventado sigue rechazado");
  }

  // -------------------------------------------------------------------------
  if (process.argv.includes("--despues-de-00344")) {
    console.log("\n5b. Comunidades (00344)");
    const COMMUNITY = "120363000000000099@g.us";
    const ok = await svc.from("whatsapp_groups").update({ kind: "announce", parent_group_jid: COMMUNITY, community_subject: "zz-test comunidad", number_is_admin: true }).eq("id", group.id);
    check(!ok.error, "un grupo de Avisos con su comunidad se guarda", ok.error?.message);
    const noParent = await svc.from("whatsapp_groups").update({ kind: "announce", parent_group_jid: null }).eq("id", group.id);
    check(Boolean(noParent.error), "Avisos sin comunidad se rechaza");
    const badKind = await svc.from("whatsapp_groups").update({ kind: "community" }).eq("id", group.id);
    check(Boolean(badKind.error), "un tipo inventado se rechaza (la comunidad madre no se guarda)");
    const badParent = await svc.from("whatsapp_groups").update({ parent_group_jid: "no-es-un-grupo" }).eq("id", group.id);
    check(Boolean(badParent.error), "un JID de comunidad invalido se rechaza");
    const { data: read } = await owner.client.from("whatsapp_groups").select("kind, parent_group_jid, community_subject").eq("id", group.id).maybeSingle();
    check(read?.community_subject === "zz-test comunidad", "quien ve el grupo lee su comunidad (RLS de siempre)", JSON.stringify(read));
    const write = await owner.client.from("whatsapp_groups").update({ community_subject: "hackeado" }).eq("id", group.id).select("id");
    check((write.data ?? []).length === 0, "nadie la escribe desde el navegador");
  }

  // -------------------------------------------------------------------------
  console.log("\n6. Borrar el grupo se lleva todo lo suyo");
  {
    await svc.from("whatsapp_groups").delete().eq("id", group.id);
    const left = await Promise.all(
      ["whatsapp_group_messages", "whatsapp_group_members", "whatsapp_group_reactions", "whatsapp_poll_votes"].map((t) => svc.from(t).select("id").eq("group_id", group.id)),
    );
    check(left.every((r) => (r.data ?? []).length === 0), "mensajes, miembros, reacciones y votos se borran en cascada");
  }
} catch (err) {
  fail("la verificacion se corto", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\nLimpieza");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures === 0 ? "\nTodo en verde." : `\n${failures} comprobacion(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
