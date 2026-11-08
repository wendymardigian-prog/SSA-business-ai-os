#!/usr/bin/env node
// @plantilla-quitar(servicios)
/**
 * Los esquemas que la API de datos (PostgREST) deja leer, en el proyecto vinculado con la CLI.
 *
 * El modulo de Servicios necesita que la API vea `app_servicio` (las pantallas lo leen con la sesion de quien mira,
 * y la RLS decide que ve). `app_servicio_portal` NUNCA se expone: es del portal y lo lee solo el servidor.
 *
 *   node scripts/servicios-api-schema.mjs                 # muestra la lista de hoy (solo lee)
 *   node scripts/servicios-api-schema.mjs --sumar         # escribe la MISMA lista + app_servicio al final
 *   node scripts/servicios-api-schema.mjs --restaurar "public,graphql_public"   # vuelve a una lista guardada
 *
 * Usa la Management API con el token de la CLI (`supabase login`), que nunca se imprime. Sin token sale 2.
 * Nunca quita ni reordena lo que ya estaba: solo agrega al final.
 */
import { management, projectRef } from "./lib/management-api.mjs";

export const MODULE_SCHEMA = "app_servicio";
export const CLOSED_SCHEMA = "app_servicio_portal";

/** La lista de esquemas como texto -> array, sin espacios ni vacios. */
export function parseSchemas(text) {
  return String(text ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** La lista con app_servicio al final, sin tocar el orden de lo demas. Nunca suma el esquema cerrado. */
export function withModuleSchema(list) {
  const clean = list.filter((s) => s !== CLOSED_SCHEMA);
  return clean.includes(MODULE_SCHEMA) ? clean : [...clean, MODULE_SCHEMA];
}

async function main() {
  const ref = projectRef();
  if (!ref) {
    console.error("No encuentro el proyecto vinculado (supabase/.temp/project-ref).");
    process.exit(2);
  }
  const current = await management(`/projects/${ref}/postgrest`);
  if (current.noToken) {
    console.error("No hay token de la CLI: corré `supabase login` o sumá app_servicio a mano en Supabase › Project Settings › Data API › Exposed schemas.");
    process.exit(2);
  }
  if (current.status !== 200 || !current.body) {
    console.error(`La Management API respondio ${current.status} al leer la configuracion de la API.`);
    process.exit(1);
  }
  const list = parseSchemas(current.body.db_schema);
  console.log(`Esquemas expuestos hoy: ${list.join(",")}`);

  const restoreIdx = process.argv.indexOf("--restaurar");
  let next = null;
  if (process.argv.includes("--sumar")) next = withModuleSchema(list);
  else if (restoreIdx > 0) next = parseSchemas(process.argv[restoreIdx + 1]);
  if (!next) return;
  if (next.length === 0) {
    console.error("La lista nueva quedo vacia: no se escribe nada.");
    process.exit(1);
  }
  if (next.join(",") === list.join(",")) {
    console.log("No hay nada que cambiar.");
    return;
  }
  const res = await management(`/projects/${ref}/postgrest`, { method: "PATCH", body: { db_schema: next.join(",") } });
  if (res.status !== 200) {
    console.error(`La Management API respondio ${res.status} al escribir la lista.`);
    process.exit(1);
  }
  console.log(`Esquemas expuestos ahora: ${parseSchemas(res.body?.db_schema).join(",")}`);
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
