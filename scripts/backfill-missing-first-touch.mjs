#!/usr/bin/env node
/**
 * Le da origen a los contactos de chat de Instagram que quedaron SIN ningún toque de atribución.
 *
 * Desde el 28/10/2026 (importación de conversaciones, 00267) el eco de un mensaje que manda ManyChat o la app de
 * Instagram crea el contacto. Ese contacto quedaba sin toque, y cuando la persona respondía tampoco se anotaba su
 * primer mensaje (el contacto "ya existía"). El código ya lo resuelve para los nuevos
 * (`lib/contacts/touch-external-start.ts` y `lib/contacts/touch-inbound.ts`); esto arregla los que ya estaban.
 *
 * Por cada contacto vivo con conversación de Instagram y CERO toques:
 *   1. Si la conversación la empezó el negocio (el primer mensaje es saliente, o no hay mensajes): un toque
 *      «chat iniciado fuera del sistema» (`medium = 'dm_external'`) con la fecha del primer saliente, o la de la
 *      conversación. Misma clave que el receptor (`external-start:<conversación de Zernio>`).
 *   2. Si la persona escribió alguna vez: el toque de su primer mensaje (`medium = 'dm'`, clave `msg:<id>`), igual
 *      que el receptor.
 *   3. Encola `comment_backfill` del contacto: vincula sus comentarios por el id de Instagram (necesita el código
 *      nuevo desplegado; si no, el job solo mira el @).
 *
 * Los toques pasan por `record_contact_touch` (recalcula primer y último toque y `contacts.attribution`). Repetirlo
 * no duplica nada: las claves son las mismas. No borra ni pisa nada.
 *
 *   node scripts/backfill-missing-first-touch.mjs              # simulación: muestra qué haría
 *   node scripts/backfill-missing-first-touch.mjs --limit=5    # probar con pocos
 *   node scripts/backfill-missing-first-touch.mjs --apply      # escribe
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : null;
const CHUNK = 200;

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Igual que `accountLabel` (lib/inbox/accounts.ts) para Instagram. */
const accountLabel = (ch) => {
  const username = ch.username?.trim().replace(/^@+/, "") ?? "";
  return username ? `@${username}` : ch.display_name?.trim() || "Instagram";
};

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data ?? [];
}

/** Los canales de Instagram, con lo que hace falta para nombrar la cuenta en el toque. */
const channels = await must(
  svc.from("channels").select("id, workspace_id, platform, late_account_id, username, display_name").eq("platform", "instagram"),
  "no pude leer los canales",
);
const channelById = new Map(channels.map((c) => [c.id, c]));

/** Todas sus conversaciones, de a páginas. */
const conversations = [];
for (const ids of chunks([...channelById.keys()], 50)) {
  for (let from = 0; ; from += 1000) {
    const page = await must(
      svc
        .from("conversations")
        .select("id, workspace_id, channel_id, contact_id, late_conversation_id, created_at")
        .in("channel_id", ids)
        .order("id")
        .range(from, from + 999),
      "no pude leer las conversaciones",
    );
    conversations.push(...page);
    if (page.length < 1000) break;
  }
}

/** Los contactos vivos que no tienen ningún toque. */
const contactIds = [...new Set(conversations.map((c) => c.contact_id))];
const withoutTouch = new Set();
for (const ids of chunks(contactIds, CHUNK)) {
  const alive = await must(svc.from("contacts").select("id").in("id", ids).is("deleted_at", null), "no pude leer los contactos");
  const touched = await must(svc.from("contact_touches").select("contact_id").in("contact_id", ids), "no pude leer los toques");
  const hasTouch = new Set(touched.map((t) => t.contact_id));
  for (const { id } of alive) if (!hasTouch.has(id)) withoutTouch.add(id);
}

let targets = conversations.filter((c) => withoutTouch.has(c.contact_id));
if (LIMIT) {
  const keep = new Set([...new Set(targets.map((c) => c.contact_id))].slice(0, LIMIT));
  targets = targets.filter((c) => keep.has(c.contact_id));
}

const stats = { contactos: new Set(targets.map((c) => c.contact_id)).size, externo: 0, primerMensaje: 0, comentarios: 0, yaEstaba: 0, errores: 0 };
console.log(`${APPLY ? "ESCRIBIENDO" : "SIMULACION (--apply para escribir)"}: ${stats.contactos} contactos sin toque, ${targets.length} conversaciones\n`);

async function touch(workspaceId, contactId, payload) {
  if (!APPLY) return true;
  const { data, error } = await svc.rpc("record_contact_touch", { p_workspace_id: workspaceId, p_contact_id: contactId, p_touch: payload });
  if (error) {
    stats.errores += 1;
    console.error(`  error en ${contactId}: ${error.message}`);
    return false;
  }
  if (data?.inserted !== true) stats.yaEstaba += 1;
  return true;
}

const queued = new Set();
for (const conv of targets) {
  const channel = channelById.get(conv.channel_id);
  const account = { account_id: channel.late_account_id, account_label: accountLabel(channel) };

  const [first] = await must(
    svc.from("messages").select("id, direction, platform_message_id, created_at").eq("conversation_id", conv.id).order("created_at").limit(1),
    "no pude leer los mensajes",
  );
  const [firstIn] = await must(
    svc
      .from("messages")
      .select("id, platform_message_id, created_at")
      .eq("conversation_id", conv.id)
      .eq("direction", "inbound")
      .order("created_at")
      .limit(1),
    "no pude leer los mensajes",
  );

  // 1. La empezó el negocio: el mismo toque que `externalStartTouch`.
  if (!first || first.direction === "outbound") {
    const ok = await touch(conv.workspace_id, conv.contact_id, {
      occurred_at: new Date(first?.created_at ?? conv.created_at).toISOString(),
      source: "instagram",
      medium: "dm_external",
      origin: "dm",
      dedupe_key: `external-start:${conv.late_conversation_id ?? conv.id}`,
      raw: { via: "external_outbound", message_id: first?.platform_message_id ?? undefined, backfill: true, ...account },
    });
    if (ok) stats.externo += 1;
  }

  // 2. Su primer mensaje: el mismo toque que `recordInboundTouch` con motivo `first_message`.
  if (firstIn) {
    const ok = await touch(conv.workspace_id, conv.contact_id, {
      occurred_at: new Date(firstIn.created_at).toISOString(),
      source: "instagram",
      medium: "dm",
      origin: "dm",
      dedupe_key: firstIn.platform_message_id ? `msg:${firstIn.platform_message_id}` : `msg:${conv.id}:${new Date(firstIn.created_at).toISOString()}`,
      raw: { message_id: firstIn.platform_message_id ?? undefined, backfill: true, ...account },
    });
    if (ok) stats.primerMensaje += 1;
  }

  // 3. El vínculo con sus comentarios.
  if (!queued.has(conv.contact_id)) {
    queued.add(conv.contact_id);
    if (APPLY) {
      const { error } = await svc.from("scheduled_jobs").insert({
        type: "comment_backfill",
        payload: { workspace_id: conv.workspace_id, contact_id: conv.contact_id },
        run_at: new Date().toISOString(),
        dedupe_key: `comment_backfill:${conv.contact_id}:external-start`,
      });
      if (error && error.code !== "23505") {
        stats.errores += 1;
        console.error(`  no pude encolar los comentarios de ${conv.contact_id}: ${error.message}`);
      } else stats.comentarios += 1;
    } else stats.comentarios += 1;
  }
}

console.log(`Toques «chat iniciado fuera del sistema»: ${stats.externo}`);
console.log(`Toques del primer mensaje de la persona:  ${stats.primerMensaje}`);
console.log(`Vínculos de comentarios encolados:        ${stats.comentarios}`);
if (APPLY) console.log(`Ya estaban (no se duplicaron):             ${stats.yaEstaba}`);
console.log(`Errores:                                  ${stats.errores}`);
if (stats.errores > 0) process.exitCode = 1;
