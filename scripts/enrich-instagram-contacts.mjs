#!/usr/bin/env node
/**
 * Completa el perfil de los contactos de Instagram que ya estan en la base.
 *
 * Por que hace falta: los contactos se importaron con un backfill que no
 * pasaba el @usuario, asi que ninguno lo tiene aunque Zernio lo devuelva. De
 * ahora en mas los mensajes entrantes lo completan solos (migracion 00031),
 * pero los que ya estan solo se arreglan yendo a buscarlos.
 *
 * Lo que NO puede hacer: recuperar el nombre de quien nunca respondio.
 * Instagram no expone el perfil de alguien que no interactuo con la cuenta, y
 * Zernio manda "Instagram User" y usuario nulo. Esos se cuentan aparte y se
 * dejan como estan.
 *
 * Toca datos de verdad, asi que por defecto NO escribe: muestra que haria.
 *
 *   node scripts/enrich-instagram-contacts.mjs           # simulacion
 *   node scripts/enrich-instagram-contacts.mjs --apply   # escribe
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import Zernio from "@zernio/node";
import { profileUpdateFor, isPlaceholderName } from "../lib/contacts/anonymous.ts";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** La key de Zernio: Vault primero, columna vieja como respaldo. */
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

  const { data } = await svc.from("workspaces")
    .select("late_api_key_encrypted").eq("id", workspaceId).maybeSingle();
  return data?.late_api_key_encrypted?.trim() || null;
}

/** Todas las conversaciones de un canal, paginando hasta que se acaben. */
async function todasLasConversaciones(zernio, accountId) {
  const conversaciones = [];
  let cursor;

  for (let pagina = 0; pagina < 20; pagina++) {
    const res = await zernio.messages.listInboxConversations({
      query: { accountId, limit: 50, sortOrder: "desc", cursor },
    });
    // La respuesta viene envuelta: { data: { data: [...], pagination } }.
    const lote = res?.data?.data ?? [];
    if (!Array.isArray(lote) || lote.length === 0) break;

    conversaciones.push(...lote);
    cursor = res?.data?.pagination?.nextCursor;
    if (!cursor) break;
  }

  return conversaciones;
}

console.log(APPLY ? "Modo ESCRITURA\n" : "Simulacion: no se escribe nada. Con --apply se aplica.\n");

const { data: canales } = await svc
  .from("channels")
  .select("id, workspace_id, late_account_id, display_name")
  .eq("platform", "instagram")
  .eq("is_active", true);

let actualizados = 0;
let sinPerfil = 0;
let yaCompletos = 0;

for (const canal of canales ?? []) {
  const key = await zernioKey(canal.workspace_id);
  if (!key) {
    console.error(`  ${canal.display_name}: sin API key de Zernio, lo salteo`);
    continue;
  }

  const zernio = new Zernio({ apiKey: key });
  const conversaciones = await todasLasConversaciones(zernio, canal.late_account_id);
  console.log(`${canal.display_name}: ${conversaciones.length} conversaciones en Zernio`);

  for (const conv of conversaciones) {
    if (!conv.participantId) continue;

    // Por el id de la plataforma, nunca por nombre: dos personas pueden
    // llamarse igual y el nombre es justamente lo que falta.
    const { data: link } = await svc
      .from("contact_channels")
      .select("contact_id, contacts(id, display_name, instagram_username, avatar_url)")
      .eq("channel_id", canal.id)
      .eq("platform_sender_id", conv.participantId)
      .maybeSingle();

    const contacto = link?.contacts;
    if (!contacto) continue;

    // Zernio no sabe quien es: no hay nada que traer.
    if (isPlaceholderName(conv.participantName) && !conv.participantUsername) {
      sinPerfil++;
      continue;
    }

    const update = profileUpdateFor(contacto, {
      name: conv.participantName,
      username: conv.participantUsername,
      picture: conv.participantPicture,
    });

    if (Object.keys(update).length === 0) {
      yaCompletos++;
      continue;
    }

    console.log(
      `  ${contacto.display_name ?? "(sin nombre)"} → ${JSON.stringify(update)}`,
    );

    if (APPLY) {
      const { error } = await svc.from("contacts").update(update).eq("id", contacto.id);
      if (error) {
        console.error(`    no pude actualizar: ${error.message}`);
        continue;
      }

      if (update.instagram_username) {
        await svc.from("contact_channels")
          .update({ platform_username: update.instagram_username })
          .eq("channel_id", canal.id)
          .eq("platform_sender_id", conv.participantId);
      }

      // Sin autor: lo hizo el sistema, no una persona.
      await svc.from("audit_log").insert({
        workspace_id: canal.workspace_id,
        entity_type: "contact",
        entity_id: contacto.id,
        action: "update",
        changes: Object.fromEntries(
          Object.entries(update).map(([k, v]) => [k, { old: contacto[k] ?? null, new: v }]),
        ),
        metadata: { source: "backfill_instagram" },
        performed_by: null,
      });
    }

    actualizados++;
  }
}

console.log("\n— Resumen —");
console.log(`  ${actualizados} contactos ${APPLY ? "actualizados" : "por actualizar"}`);
console.log(`  ${yaCompletos} ya estaban completos`);
console.log(`  ${sinPerfil} siguen anonimos: Instagram no expone el perfil de quien nunca respondio`);
if (!APPLY && actualizados > 0) console.log("\n  Volve a correrlo con --apply para escribir.");
