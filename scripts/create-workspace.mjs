#!/usr/bin/env node
/**
 * Crea un SEGUNDO negocio (workspace) para una persona que ya tiene cuenta, en
 * esta misma instalacion. La persona queda como Owner y lo elige con el
 * selector de arriba a la izquierda; cada negocio tiene sus propias claves
 * (Zernio, IA, Resend...), sus canales, su equipo y su marca.
 *
 *   node scripts/create-workspace.mjs --owner-email=duena@negocio.com --name="BusinessXcelerator" [--timezone=America/Costa_Rica]
 *
 * Que hace:
 *   1. Busca la cuenta por email (no crea cuentas: para el primer Owner de una
 *      copia nueva esta scripts/create-owner.mjs).
 *   2. Crea el workspace y la fila de Owner. Los triggers de la base siembran
 *      solos lo que necesita un negocio nuevo (categorias de mensajes, roles,
 *      el copywriter, areas de la agenda, ventas).
 *   3. Copia los precios de los modelos de IA (`model_pricing`) del negocio mas
 *      viejo de la instalacion: sin precios, cada corrida de IA queda con el
 *      costo en blanco. Si no hay de donde copiar, avisa que hay que correr
 *      supabase/seeds/00_model_pricing.sql y 01_transcription_pricing.sql.
 *
 * Usa la Service Role Key del .env (nunca la imprime). No se puede correr dos
 * veces con el mismo nombre para la misma persona: frena antes de duplicar.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const env = existsSync(".env")
  ? Object.fromEntries(
      readFileSync(".env", "utf8")
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
    )
  : process.env;

function arg(name) {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
}

const ownerEmail = arg("owner-email")?.trim().toLowerCase();
const name = arg("name")?.trim();
const timezone = arg("timezone")?.trim();

if (!ownerEmail || !name) {
  console.error('Uso: node scripts/create-workspace.mjs --owner-email=... --name="..." [--timezone=America/Costa_Rica]');
  process.exit(1);
}

if (timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    console.error(`La zona horaria "${timezone}" no es valida (ejemplo: America/Costa_Rica).`);
    process.exit(1);
  }
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

/** La cuenta por email, recorriendo las paginas de usuarios (la API no busca por email). */
async function findUserByEmail(email) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`No pude listar las cuentas: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  return null;
}

function slugify(value) {
  const base = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "negocio"}-${randomBytes(4).toString("hex")}`;
}

async function copyPricing(targetId) {
  const { data: source } = await supabase
    .from("workspaces")
    .select("id, name")
    .neq("id", targetId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!source) return { copied: 0, from: null };

  const { data: rows, error } = await supabase.from("model_pricing").select("*").eq("workspace_id", source.id);
  if (error) throw new Error(`No pude leer los precios de IA: ${error.message}`);
  if (!rows?.length) return { copied: 0, from: source.name };

  const copies = rows.map(({ id: _id, created_at: _c, updated_at: _u, workspace_id: _w, ...rest }) => ({ ...rest, workspace_id: targetId }));
  const { error: insertError } = await supabase.from("model_pricing").insert(copies);
  if (insertError) throw new Error(`No pude copiar los precios de IA: ${insertError.message}`);
  return { copied: copies.length, from: source.name };
}

async function main() {
  const user = await findUserByEmail(ownerEmail);
  if (!user) {
    console.error(`No hay ninguna cuenta con el email ${ownerEmail}. Para el primer Owner de una copia nueva, usa scripts/create-owner.mjs.`);
    process.exit(1);
  }

  // Frenar antes de duplicar: la misma persona ya es Owner de un negocio con ese nombre.
  const { data: memberships, error: membershipsError } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name)")
    .eq("user_id", user.id);
  if (membershipsError) {
    console.error("No pude leer los negocios de la persona:", membershipsError.message);
    process.exit(1);
  }
  const duplicate = (memberships ?? []).find((m) => m.workspaces?.name?.trim().toLowerCase() === name.toLowerCase());
  if (duplicate) {
    console.error(`${ownerEmail} ya es parte de un negocio llamado "${duplicate.workspaces.name}" (${duplicate.workspaces.id}). No se creo nada.`);
    process.exit(1);
  }

  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .insert({ name, slug: slugify(name), ...(timezone ? { timezone } : {}) })
    .select("id")
    .single();
  if (wsError || !workspace) {
    console.error("No pude crear el workspace:", wsError?.message);
    process.exit(1);
  }

  // Mismo alta que handle_new_user (00119): la persona es owner, sin role_id (los permisos del Owner salen del codigo).
  const { error: memberError } = await supabase
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });
  if (memberError) {
    console.error("Cree el workspace pero no pude sumar a la persona como Owner:", memberError.message);
    // Recien creado y sin nadie adentro: se borra para no dejar un negocio huerfano.
    const { error: cleanupError } = await supabase.from("workspaces").delete().eq("id", workspace.id);
    if (cleanupError) console.error(`Tampoco pude borrarlo: queda el workspace ${workspace.id} sin dueño.`, cleanupError.message);
    process.exit(1);
  }

  let pricing;
  try {
    pricing = await copyPricing(workspace.id);
  } catch (err) {
    pricing = { copied: 0, from: null, error: err instanceof Error ? err.message : String(err) };
  }

  console.log("Negocio creado.");
  console.log("  Nombre:     ", name, `(${workspace.id})`);
  console.log("  Owner:      ", ownerEmail);
  if (timezone) console.log("  Zona:       ", timezone);
  if (pricing.copied > 0) {
    console.log("  Precios IA: ", `${pricing.copied} copiados de "${pricing.from}"`);
  } else {
    console.log("  Precios IA:  no se copiaron", pricing.error ? `(${pricing.error})` : "");
    console.log("               Corre supabase/seeds/00_model_pricing.sql y 01_transcription_pricing.sql en el SQL editor.");
  }
  console.log("\nProximos pasos (en la app, con el selector de arriba a la izquierda en el negocio nuevo):");
  console.log("  1. Ajustes → General → Marca: nombre, logo, color y tono de la IA.");
  console.log("  2. Ajustes → Integraciones: la clave de Zernio de este negocio, la IA, Resend y lo que use.");
  console.log("  3. Agenda → Configuración → Ajustes: un usuario de agenda distinto al del otro negocio.");
  console.log("  4. Ajustes → Equipo: invitar a las personas de este negocio.");
}

main().catch((err) => {
  console.error("Algo fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
