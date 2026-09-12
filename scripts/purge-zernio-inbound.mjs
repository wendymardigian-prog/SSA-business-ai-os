#!/usr/bin/env node
/**
 * Deshace la persistencia de los entrantes de Instagram.
 *
 * Es la otra mitad del interruptor `workspaces.persist_zernio_inbound`. Apagar
 * el interruptor frena el guardado de ahi en adelante, pero deja intacto todo
 * lo que ya se guardo, y la purga por antiguedad recien lo alcanzaria a los 12
 * meses. Si la confirmacion de los terminos de Zernio y Meta llega y dice que
 * no, doce meses no es una respuesta: esto lo borra ahora.
 *
 * Que borra: los mensajes ENTRANTES de conversaciones de canales de Zernio.
 * Que NO borra:
 *   - los SALIENTES (los escribio el sistema o el equipo, no el lead);
 *   - nada de WhatsApp (Evolution no pasa por los terminos de Zernio, y ahi
 *     esta tabla es la unica fuente del hilo: borrarla vaciaria la bandeja).
 *
 * El borrado es fisico y NO se puede deshacer. Lo unico que se podria
 * recuperar despues es lo que la API de Zernio todavia tenga, corriendo el
 * backfill — que son los ultimos ~500 mensajes por conversacion y nada mas.
 *
 * Toca datos de verdad, asi que por defecto NO borra: muestra cuanto borraria.
 *
 *   node scripts/purge-zernio-inbound.mjs            # dice cuanto
 *   node scripts/purge-zernio-inbound.mjs --apply    # borra
 *
 * Acordate de apagar tambien el interruptor desde Ajustes: si queda prendido,
 * el proximo DM vuelve a guardarse y esto hay que correrlo de nuevo.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: workspaces, error: wsError } = await svc
  .from("workspaces")
  .select("id, name, persist_zernio_inbound");

if (wsError) {
  console.error("No pude leer los workspaces:", wsError.message);
  process.exit(1);
}

console.log(APPLY ? "\n— BORRANDO —\n" : "\n— Simulacion (no borra nada) —\n");

let total = 0;

for (const ws of workspaces ?? []) {
  const { data: count, error } = await svc.rpc("purge_zernio_inbound_messages", {
    p_workspace_id: ws.id,
    p_apply: APPLY,
  });

  if (error) {
    console.error(`  ${ws.name}: FALLA — ${error.message}`);
    process.exitCode = 1;
    continue;
  }

  total += count ?? 0;
  const verbo = APPLY ? "borrados" : "se borrarian";
  console.log(`  ${ws.name}: ${count ?? 0} mensajes entrantes de Zernio ${verbo}`);

  if (ws.persist_zernio_inbound) {
    console.log(
      "    OJO: el interruptor de este workspace sigue PRENDIDO. " +
        "Apagalo en Ajustes o el proximo DM se vuelve a guardar.",
    );
  }
}

if (!APPLY) {
  console.log(`\nTotal a borrar: ${total}. Volve a correrlo con --apply para borrar de verdad.`);
} else {
  console.log(`\nBorrados: ${total}.`);
}
