#!/usr/bin/env node
/**
 * Recupera los archivos de WhatsApp que no se pudieron bajar (Evolution respondió 400).
 *
 * Entre el 1/10 y el 20/11/2026 el pedido del archivo a Evolution iba con el contenido del mensaje
 * suelto (`data.message`), sin `{ key, message }`, y Evolution contestaba 400: casi ninguna nota de voz,
 * foto o video de WhatsApp se guardó. El código ya está arreglado para lo nuevo; esto encola, por cada
 * mensaje con un adjunto fallido de los últimos N días, un job `whatsapp_media_retry` que le vuelve a pedir
 * el archivo a Evolution por el id del mensaje (`retryWhatsappMedia`, el mismo del botón «Reintentar»).
 *
 * Solo baja el archivo y lo transcribe o describe: no dispara automatizaciones ni el agente. Lo que Evolution
 * ya no tiene queda con «WhatsApp ya no tiene este archivo». Los jobs se escalonan (uno cada --cada segundos)
 * para no saturar Evolution, y la clave por mensaje evita encolar dos veces lo mismo.
 *
 *   node scripts/recover-whatsapp-media.mjs                 # simulación: cuenta qué encolaría
 *   node scripts/recover-whatsapp-media.mjs --dias=30       # ventana (por defecto 30)
 *   node scripts/recover-whatsapp-media.mjs --aplicar       # encola
 *   node scripts/recover-whatsapp-media.mjs --cada=5        # segundos entre jobs (por defecto 5)
 *
 * Necesita el código nuevo desplegado (el job `whatsapp_media_retry` tiene que existir en la app).
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--aplicar");
const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  const value = found ? Number(found.split("=")[1]) : fallback;
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const DAYS = arg("dias", 30);
const EVERY_SECONDS = arg("cada", 5);
const PAGE = 500;

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Igual que `whatsappRetryableItems` (lib/chat-media/whatsapp-retry.ts): fallido, sin URL ni archivo. */
const retryable = (item) => item && item.status === "failed" && !item.sourceUrl && !item.storagePath;
const itemsOf = (attachments) => (attachments && Array.isArray(attachments.items) ? attachments.items : []);

// 1. Los canales de WhatsApp.
const { data: channels, error: chErr } = await svc.from("channels").select("id").eq("platform", "whatsapp");
if (chErr) throw new Error(`No pude leer los canales: ${chErr.message}`);
const channelIds = new Set((channels ?? []).map((c) => c.id));

// 2. Los mensajes con algún adjunto fallido en la ventana.
const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
const candidates = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await svc
    .from("messages")
    .select("id, conversation_id, platform_message_id, direction, created_at, attachments, conversations!inner(channel_id)")
    .gte("created_at", since)
    .contains("attachments", { items: [{ status: "failed" }] })
    .order("created_at", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw new Error(`No pude leer los mensajes: ${error.message}`);
  for (const row of data ?? []) {
    if (!channelIds.has(row.conversations?.channel_id)) continue;
    const items = itemsOf(row.attachments).filter(retryable);
    if (items.length === 0 || !row.platform_message_id) continue;
    candidates.push({ ...row, kinds: items.map((i) => i.kind) });
  }
  if (!data || data.length < PAGE) break;
}

// 3. El resumen.
const byKind = {};
const byDirection = {};
for (const c of candidates) {
  for (const k of c.kinds) byKind[k] = (byKind[k] ?? 0) + 1;
  byDirection[c.direction] = (byDirection[c.direction] ?? 0) + 1;
}
console.log(`Mensajes de WhatsApp con archivos fallidos (últimos ${DAYS} días): ${candidates.length}`);
console.log("Por tipo:", byKind);
console.log("Por dirección:", byDirection);

if (!APPLY) {
  console.log("\nSimulación: no se encoló nada. Para encolar: --aplicar");
  process.exit(0);
}

// 4. Encolar, escalonados.
let queued = 0;
let already = 0;
let failed = 0;
const start = Date.now();
for (const [i, c] of candidates.entries()) {
  const { error } = await svc.from("scheduled_jobs").insert({
    type: "whatsapp_media_retry",
    payload: { messageId: c.id },
    run_at: new Date(start + i * EVERY_SECONDS * 1000).toISOString(),
    dedupe_key: `whatsapp_media_retry:${c.id}`,
  });
  if (!error) queued += 1;
  else if (error.code === "23505") already += 1;
  else {
    failed += 1;
    console.error(`  no pude encolar ${c.id}: ${error.message}`);
  }
}
const minutes = Math.ceil((candidates.length * EVERY_SECONDS) / 60);
console.log(`\nEncolados: ${queued} · ya estaban: ${already} · errores: ${failed}`);
console.log(`Terminan en ~${minutes} min (uno cada ${EVERY_SECONDS} s).`);
