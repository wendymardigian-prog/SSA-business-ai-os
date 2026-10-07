#!/usr/bin/env node
/**
 * Crea el primer Owner de un clon nuevo (white label).
 *
 * El registro publico no existe: la unica forma de entrar la primera vez es
 * que alguien con la Service Role Key cree la cuenta a mano. Este script la
 * crea, deja que el trigger `handle_new_user` (00001) le arme su workspace, y
 * lo renombra con el nombre del negocio y le pone su zona horaria.
 *
 *   node scripts/create-owner.mjs --email=duena@negocio.com --name="Duena del negocio" --workspace="Nombre del negocio" [--timezone=America/Costa_Rica]
 *
 * Sin --password se genera una, se imprime una sola vez y no se guarda en
 * ningun archivo: copiala antes de cerrar la terminal.
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

const email = arg("email");
const name = arg("name");
const workspaceName = arg("workspace");
const timezone = arg("timezone");
const password = arg("password") || randomBytes(12).toString("base64url");

if (!email || !name || !workspaceName) {
  console.error("Uso: node scripts/create-owner.mjs --email=... --name=... --workspace=... [--timezone=...] [--password=...]");
  process.exit(1);
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

async function main() {
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });

  if (createError || !created?.user) {
    console.error("No se pudo crear el usuario:", createError?.message);
    process.exit(1);
  }

  // El trigger handle_new_user (00001) ya le creo un workspace ("<name>'s
  // Workspace") y lo hizo owner. Se lo busca y se renombra.
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", created.user.id)
    .limit(1)
    .single();

  if (membershipError || !membership) {
    console.error("El usuario se creo pero no tiene workspace. Revisa el trigger handle_new_user.");
    process.exit(1);
  }

  const patch = { name: workspaceName };
  if (timezone) patch.timezone = timezone;

  const { error: updateError } = await supabase
    .from("workspaces")
    .update(patch)
    .eq("id", membership.workspace_id);

  if (updateError) {
    console.error("El usuario y el workspace se crearon, pero no se pudo renombrar:", updateError.message);
    process.exit(1);
  }

  console.log("Owner creado.");
  console.log("  Email:      ", email);
  console.log("  Contraseña: ", password);
  console.log("  Workspace:  ", workspaceName, `(${membership.workspace_id})`);
  console.log("\nGuarda la contraseña ahora: no se guarda en ningun archivo ni se vuelve a mostrar.");
}

main();
