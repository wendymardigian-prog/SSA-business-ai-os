#!/usr/bin/env node
/**
 * Verificacion de la persistencia de mensajes (F19, F20, F21) contra la base real.
 *
 * Prueba lo que los tests de vitest NO pueden probar. Los tests mockean a
 * Supabase: verifican que el codigo mande el insert que corresponde, no que la
 * base haga lo que se espera con el. Y casi todo lo que importa en este bloque
 * vive del lado de la base — el indice unico parcial, el trigger que completa
 * workspace_id, el borrado en cascada, las funciones de purga.
 *
 * Lo mas importante que prueba: **que el mismo mensaje no se pueda guardar dos
 * veces**, que es la unica garantia que sostiene al backfill y a los reintentos
 * de los webhooks.
 *
 * Crea sus propios datos con el prefijo zz-test- y los borra al final, pase lo
 * que pase.
 *
 *   node scripts/verify-message-persistence.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

const TAG = `zz-test-${Date.now()}`;
let contactId = null;
let contactId2 = null;

try {
  // ── Preparacion ──────────────────────────────────────────────────────────
  const { data: ws } = await svc.from("workspaces").select("id").limit(1).single();
  const { data: channel } = await svc
    .from("channels")
    .select("id, provider")
    .eq("workspace_id", ws.id)
    .eq("provider", "zernio")
    .limit(1)
    .single();

  if (!channel) {
    console.log("No hay un canal de Zernio en este workspace. No hay nada que verificar.");
    process.exit(0);
  }

  const { data: contact, error: contactError } = await svc
    .from("contacts")
    .insert({ workspace_id: ws.id, display_name: TAG })
    .select("id")
    .single();
  if (contactError) throw new Error(`no pude crear el contacto: ${contactError.message}`);
  contactId = contact.id;

  const { data: conv, error: convError } = await svc
    .from("conversations")
    .insert({
      workspace_id: ws.id,
      channel_id: channel.id,
      contact_id: contactId,
      platform: "instagram",
    })
    .select("id")
    .single();
  if (convError) throw new Error(`no pude crear la conversacion: ${convError.message}`);

  // ── 1. El trigger completa workspace_id ──────────────────────────────────
  console.log("\n— workspace_id se completa solo —");

  const { error: e1 } = await svc.from("messages").insert({
    conversation_id: conv.id,
    direction: "inbound",
    text: `${TAG} uno`,
    platform_message_id: `${TAG}-m1`,
    status: "delivered",
    // a proposito sin workspace_id: lo tiene que poner el trigger
  });
  check(!e1, "un insert sin workspace_id entra igual", e1?.message);

  const { data: m1 } = await svc
    .from("messages")
    .select("workspace_id, direction")
    .eq("platform_message_id", `${TAG}-m1`)
    .single();
  check(m1?.workspace_id === ws.id, "el trigger lo completo desde la conversacion");
  check(m1?.direction === "inbound", "la direccion quedo en inbound");

  // ── 2. Lo que sostiene todo: no se puede duplicar ────────────────────────
  console.log("\n— el mismo mensaje no entra dos veces —");

  const { error: e2 } = await svc.from("messages").insert({
    conversation_id: conv.id,
    direction: "inbound",
    text: `${TAG} duplicado`,
    platform_message_id: `${TAG}-m1`, // el MISMO id
    status: "delivered",
  });
  check(e2?.code === "23505", "el indice unico rechaza el segundo insert", e2?.message);

  const { count: repetidos } = await svc
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("platform_message_id", `${TAG}-m1`);
  check(repetidos === 1, `quedo una sola fila (hay ${repetidos})`);

  // El mismo id en OTRA conversacion si puede existir: la unicidad es por hilo.
  // Hace falta otro contacto porque conversations tiene unique(channel_id, contact_id).
  const { data: contact2 } = await svc
    .from("contacts")
    .insert({ workspace_id: ws.id, display_name: `${TAG}-dos` })
    .select("id")
    .single();
  contactId2 = contact2?.id ?? null;

  const { data: conv2, error: conv2Error } = await svc
    .from("conversations")
    .insert({
      workspace_id: ws.id,
      channel_id: channel.id,
      contact_id: contactId2,
      platform: "instagram",
      late_conversation_id: `${TAG}-otra`,
    })
    .select("id")
    .maybeSingle();
  check(!!conv2, "se pudo crear una segunda conversacion para la prueba", conv2Error?.message);

  if (conv2) {
    const { error: e3 } = await svc.from("messages").insert({
      conversation_id: conv2.id,
      direction: "inbound",
      text: `${TAG} otra conversacion`,
      platform_message_id: `${TAG}-m1`,
      status: "delivered",
    });
    check(!e3, "el mismo id en otra conversacion si entra: la unicidad es por hilo", e3?.message);
  }

  // Los mensajes sin id no chocan entre si (el indice es parcial).
  const { error: e4 } = await svc.from("messages").insert([
    { conversation_id: conv.id, direction: "outbound", text: `${TAG} sin id a`, status: "sent" },
    { conversation_id: conv.id, direction: "outbound", text: `${TAG} sin id b`, status: "sent" },
  ]);
  check(!e4, "dos mensajes sin platform_message_id conviven", e4?.message);

  // ── 3. Los dos ids ───────────────────────────────────────────────────────
  console.log("\n— los dos ids del mensaje —");

  await svc.from("messages").insert({
    conversation_id: conv.id,
    direction: "inbound",
    text: `${TAG} con id nativo`,
    platform_message_id: `${TAG}-m2`,
    platform_native_message_id: `${TAG}-nativo`,
    status: "delivered",
  });

  const { data: m2 } = await svc
    .from("messages")
    .select("platform_message_id, platform_native_message_id")
    .eq("platform_message_id", `${TAG}-m2`)
    .single();
  check(
    m2?.platform_native_message_id === `${TAG}-nativo`,
    "el id nativo de la plataforma queda guardado aparte",
  );

  // ── 4. Retencion ─────────────────────────────────────────────────────────
  console.log("\n— retencion de 12 meses —");

  const hace13Meses = new Date();
  hace13Meses.setMonth(hace13Meses.getMonth() - 13);
  const hace11Meses = new Date();
  hace11Meses.setMonth(hace11Meses.getMonth() - 11);

  await svc.from("messages").insert([
    {
      conversation_id: conv.id,
      direction: "inbound",
      text: `${TAG} viejo`,
      platform_message_id: `${TAG}-viejo`,
      status: "delivered",
      created_at: hace13Meses.toISOString(),
    },
    {
      conversation_id: conv.id,
      direction: "inbound",
      text: `${TAG} reciente`,
      platform_message_id: `${TAG}-reciente`,
      status: "delivered",
      created_at: hace11Meses.toISOString(),
    },
  ]);

  const { error: purgeError } = await svc.rpc("purge_old_messages", {
    p_retention_months: 12,
  });
  check(!purgeError, "la purga por antiguedad corre", purgeError?.message);

  const { count: quedaViejo } = await svc
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("platform_message_id", `${TAG}-viejo`);
  check(quedaViejo === 0, "el mensaje de 13 meses se borro");

  const { count: quedaReciente } = await svc
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("platform_message_id", `${TAG}-reciente`);
  check(quedaReciente === 1, "el de 11 meses sigue: todavia no vence");

  // ── 5. La purga del interruptor ──────────────────────────────────────────
  console.log("\n— deshacer la persistencia de Zernio —");

  const { data: cuenta, error: dryError } = await svc.rpc("purge_zernio_inbound_messages", {
    p_workspace_id: ws.id,
    p_apply: false,
  });
  check(!dryError, "la purga del interruptor corre en seco", dryError?.message);
  check(typeof cuenta === "number" && cuenta > 0, `cuenta los entrantes de Zernio (${cuenta})`);

  const { count: siguenTodos } = await svc
    .from("messages")
    .select("*", { count: "exact", head: true })
    .like("text", `${TAG}%`);
  check(siguenTodos > 0, "en seco no borro nada");

  // ── 6. El borrado en cascada ─────────────────────────────────────────────
  console.log("\n— borrar el contacto se lleva sus mensajes —");

  await svc.from("contacts").delete().eq("id", contactId);
  contactId = null;
  if (contactId2) {
    await svc.from("contacts").delete().eq("id", contactId2);
    contactId2 = null;
  }

  const { count: sobrevivientes } = await svc
    .from("messages")
    .select("*", { count: "exact", head: true })
    .like("text", `${TAG}%`);
  check(
    sobrevivientes === 0,
    `no quedo ningun mensaje del contacto borrado (quedaron ${sobrevivientes})`,
  );
} catch (err) {
  fail("error inesperado", err instanceof Error ? err.message : String(err));
} finally {
  // Red de seguridad: si algo fallo antes del borrado en cascada, se limpia igual.
  if (contactId) await svc.from("contacts").delete().eq("id", contactId);
  if (contactId2) await svc.from("contacts").delete().eq("id", contactId2);
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
