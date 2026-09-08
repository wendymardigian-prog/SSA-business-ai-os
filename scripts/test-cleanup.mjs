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

  const { data: rows, error: listError } = await svc
    .from("workspaces")
    .select("id, name")
    .like("name", `${PREFIX}%`);
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
