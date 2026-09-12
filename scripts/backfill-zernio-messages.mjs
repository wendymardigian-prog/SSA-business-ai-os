#!/usr/bin/env node
/**
 * Trae de Zernio los mensajes historicos que nunca se guardaron localmente.
 *
 * Hasta la Fase 3 los DMs de Instagram no se persistian: la bandeja se los
 * pedia a Zernio en vivo. Ahora se guardan, pero solo los que entran de acá en
 * más; la tabla arranca vacia y el agente y los dashboards no tienen de que
 * hablar. Esto rellena lo que la API todavia tenga.
 *
 * CUANTA historia hay, en concreto: Meta le replica a Zernio las 500
 * conversaciones mas recientes por cuenta y, de cada una, los ultimos 500
 * mensajes. Lo anterior no lo tiene nadie. No hay parametro que lo cambie.
 *
 * Se corre A MANO y una vez. No lo agenda ningun cron. Conviene igual correrlo
 * DOS veces con unos dias de diferencia: el replay de Meta corre en segundo
 * plano y puede terminar despues del primer barrido (el propio SDK lo
 * advierte). Correrlo de nuevo es gratis — el indice unico
 * (conversation_id, platform_message_id) descarta lo que ya esta, asi que la
 * segunda pasada solo suma lo que aparecio en el medio.
 *
 * Solo toca conversaciones que YA existen en la base. No crea contactos ni
 * conversaciones nuevas: de eso se ocupa el sync de canales.
 *
 * Toca datos de verdad, asi que por defecto NO escribe: muestra que haria.
 *
 *   node scripts/backfill-zernio-messages.mjs                # simulacion
 *   node scripts/backfill-zernio-messages.mjs --limit=5      # probar con pocas
 *   node scripts/backfill-zernio-messages.mjs --apply        # escribe
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import Zernio from "@zernio/node";
import { backfillConversation, addStats, emptyStats } from "../lib/backfill-messages.ts";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : null;

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** La key del workspace, igual que lib/integrations/zernio-key.ts. */
async function zernioKey(workspaceId) {
  try {
    const { data: fromVault } = await svc.rpc("read_secret", {
      p_workspace_id: workspaceId,
      p_secret_name: "zernio_api_key",
    });
    if (fromVault) return fromVault;
  } catch {
    // Vault no disponible: se sigue con el campo viejo.
  }

  const { data } = await svc
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", workspaceId)
    .maybeSingle();
  return data?.late_api_key_encrypted?.trim() || null;
}

console.log(
  APPLY
    ? "\n— ESCRITURA —\n"
    : "\n— Simulacion: no se escribe nada. Con --apply se aplica. —\n",
);

const { data: channels, error: chError } = await svc
  .from("channels")
  .select("id, workspace_id, platform, username, late_account_id")
  .eq("provider", "zernio")
  .eq("is_active", true);

if (chError) {
  console.error("No pude leer los canales:", chError.message);
  process.exit(1);
}

if (!channels?.length) {
  console.log("No hay canales de Zernio activos. Nada que hacer.");
  process.exit(0);
}

let total = emptyStats();
let conversaciones = 0;
let conErrores = 0;

for (const channel of channels) {
  const key = await zernioKey(channel.workspace_id);
  if (!key) {
    console.error(`  ${channel.username ?? channel.id}: sin API key de Zernio, se saltea`);
    process.exitCode = 1;
    continue;
  }

  const zernio = new Zernio({ apiKey: key });

  // Solo las que ya existen en la base y tienen hilo en Zernio.
  let query = svc
    .from("conversations")
    .select("id, late_conversation_id")
    .eq("channel_id", channel.id)
    .not("late_conversation_id", "is", null)
    .order("last_message_at", { ascending: false });

  if (LIMIT) query = query.limit(LIMIT);

  const { data: convs, error: convError } = await query;
  if (convError) {
    console.error(`  ${channel.username ?? channel.id}: ${convError.message}`);
    process.exitCode = 1;
    continue;
  }

  console.log(
    `\n${channel.platform} @${channel.username ?? "?"} — ${convs?.length ?? 0} conversaciones`,
  );

  for (const conv of convs ?? []) {
    const stats = await backfillConversation({
      supabase: svc,
      zernio,
      conversationId: conv.id,
      lateConversationId: conv.late_conversation_id,
      accountId: channel.late_account_id,
      workspaceId: channel.workspace_id,
      apply: APPLY,
    });

    conversaciones++;
    total = addStats(total, stats);

    if (stats.error) {
      conErrores++;
      console.error(`  ${conv.id}: ${stats.error}`);
    } else if (stats.inserted > 0) {
      const verbo = APPLY ? "guardados" : "se guardarian";
      console.log(
        `  ${conv.id}: ${stats.inserted} ${verbo}` +
          (stats.skipped ? `, ${stats.skipped} ya estaban` : "") +
          (stats.discarded ? `, ${stats.discarded} descartados` : ""),
      );
    }
  }
}

console.log("\n— Resumen —");
console.log(`  conversaciones recorridas: ${conversaciones}`);
console.log(`  mensajes que devolvio la API: ${total.fetched}`);
console.log(`  ${APPLY ? "guardados" : "se guardarian"}: ${total.inserted}`);
console.log(`  ya estaban: ${total.skipped}`);
console.log(`  descartados (borrados por el remitente o sin id): ${total.discarded}`);
if (total.failed) console.log(`  FALLARON: ${total.failed}`);
if (conErrores) console.log(`  conversaciones con error: ${conErrores}`);

if (!APPLY && total.inserted > 0) {
  console.log("\nVolve a correrlo con --apply para guardarlos.");
}
