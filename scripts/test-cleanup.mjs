/**
 * Limpieza de los datos que dejan los scripts de verificacion.
 *
 * Todo lo que crean verify-rls.mjs y verify-crm.mjs se llama "zz-test-...",
 * y esta funcion barre por ese prefijo en vez de por una lista de ids.
 *
 * Por que por prefijo y no por lista: el workspace que el trigger
 * on_auth_user_created le arma a cada usuario de prueba a veces todavia no
 * esta cuando el script lo va a buscar, asi que nunca entraba en la lista y
 * quedaba dando vueltas. Barrer por prefijo tambien se lleva lo que quedo de
 * corridas anteriores que murieron a la mitad.
 *
 * El prefijo es la unica salvaguarda, asi que no se toca: ningun dato real
 * empieza con "zz-test-".
 *
 * El orden importa: primero los workspaces, despues los usuarios.
 * workspace_invites.invited_by referencia auth.users SIN "on delete", asi que
 * mientras exista una invitacion la base no deja borrar a quien la mando.
 * Borrar el workspace se lleva sus invitaciones por cascade y recien entonces
 * el usuario se puede eliminar. (Al reves fallaba, y como el error se ignoraba,
 * los usuarios de prueba se venian acumulando corrida tras corrida.)
 */

const PREFIX = "zz-test-";

export async function cleanupTestData(svc) {
  let users = 0;
  let workspaces = 0;
  const problems = [];

  // Por nombre Y por slug: el workspace que arma el trigger para un usuario de prueba se llama
  // "zz-test <tag>'s Workspace" (con espacio, por el full_name), asi que el nombre solo no lo agarraba y se
  // acumulaban (316 llegaron a quedar), pero su slug siempre empieza con "zz-test-".
  const { data: rows, error: listError } = await svc
    .from("workspaces")
    .select("id, name")
    .or(`name.like.${PREFIX}%,slug.like.${PREFIX}%`);
  if (listError) problems.push(`no pude listar workspaces: ${listError.message}`);

  for (const ws of rows ?? []) {
    const { error: e } = await svc.from("workspaces").delete().eq("id", ws.id);
    if (e) problems.push(`workspace ${ws.name}: ${e.message}`);
    else workspaces++;
  }

  const { data, error } = await svc.auth.admin.listUsers({ perPage: 1000 });
  if (error) problems.push(`no pude listar usuarios: ${error.message}`);

  for (const user of data?.users ?? []) {
    if (!user.email?.startsWith(PREFIX)) continue;
    const { error: e } = await svc.auth.admin.deleteUser(user.id);
    if (e) problems.push(`usuario ${user.email}: ${e.message}`);
    else users++;
  }

  return { users, workspaces, problems };
}

/** Imprime el resultado con el mismo formato que usan los scripts. */
export async function runCleanup(svc) {
  const { users, workspaces, problems } = await cleanupTestData(svc);
  console.log(`  ${users} usuarios y ${workspaces} workspaces de prueba borrados`);
  for (const p of problems) console.error(`  no pude limpiar: ${p}`);
  return problems.length === 0;
}

/**
 * Informe de residuos: cuenta lo que quedo con el prefijo de prueba, tabla por tabla. Despues de una limpieza tiene que dar todo en cero.
 * Cada fila es [tabla, columna donde vive el prefijo, "like" o "ilike"].
 */
const RESIDUE_CHECKS = [
  ["workspaces", "slug"],
  ["workspaces", "name"],
  ["contacts", "display_name"],
  ["contacts", "email"],
  ["tasks", "title"],
  ["products", "name"],
  ["event_types", "title"],
  ["bookings", "uid"],
  ["calls", "title"],
  ["forms", "name"],
  ["flows", "name"],
  ["tags", "name"],
  ["sequences", "name"],
  ["broadcasts", "name"],
  ["webhook_endpoints", "name"],
  ["social_post_comments", "external_comment_id"],
];

export async function residueReport(svc) {
  const rows = [];
  for (const [table, column] of RESIDUE_CHECKS) {
    const { count, error } = await svc.from(table).select(column, { count: "exact", head: true }).like(column, `${PREFIX}%`);
    rows.push({ table: `${table}.${column}`, count: error ? null : (count ?? 0), error: error?.message });
  }
  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
  rows.push({ table: "auth.users.email", count: (data?.users ?? []).filter((u) => u.email?.startsWith(PREFIX)).length });
  return rows;
}

/** Corre la limpieza y despues el informe; sale con error si queda algo (o si no se pudo contar una tabla). */
export async function runCleanupWithReport(svc) {
  const ok = await runCleanup(svc);
  const report = await residueReport(svc);
  console.log("  Residuos con el prefijo zz-test-:");
  for (const r of report) console.log(`    ${String(r.count ?? "?").padStart(4)}  ${r.table}${r.error ? `  (no se pudo contar: ${r.error})` : ""}`);
  return ok && report.every((r) => r.count === 0);
}

// Uso directo: `node scripts/test-cleanup.mjs` limpia y muestra el informe.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { readFileSync } = await import("node:fs");
  const { createClient } = await import("@supabase/supabase-js");
  const env = Object.fromEntries(
    readFileSync(".env", "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
  );
  const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  process.exitCode = (await runCleanupWithReport(svc)) ? 0 : 1;
}
