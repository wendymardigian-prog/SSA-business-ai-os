/**
 * El alcance de leads de los Members de un workspace de prueba, por ROL.
 *
 * Desde la 00136 la visibilidad de los leads sale del rol
 * (`workspace_roles.permissions.scopes.leads`: own | own_unassigned | all) y ya
 * no de los dos interruptores de `workspaces`. Los scripts de verificacion
 * armaban cada caso prendiendo y apagando esos interruptores; este ayudante
 * hace lo mismo con roles, asi cada caso se escribe igual.
 *
 *   const scope = leadScopeHelper(svc);
 *   await scope.apply(wsId, "own_unassigned");   // todos los Members del workspace
 *   await scope.apply(wsId, "own");              // el Member de sistema, sin rol
 *
 * `own` deja a los Members sin rol personalizado (el Member de sistema, que
 * vive en el codigo con alcance own). Solo toca a los Members sin rol o que ya
 * tienen uno de los de este ayudante: si un caso le puso a alguien un rol suyo,
 * no se lo pisa.
 *
 * Los roles que crea cuelgan del workspace de prueba (`zz-test-`), asi que los
 * borra la limpieza con el workspace. Sin permisos (`keys: []`) a proposito:
 * el alcance de leads es lo unico que tiene que diferir del Member de sistema.
 */
export function leadScopeHelper(svc) {
  const roles = new Map(); // `${wsId}:${mode}` -> id

  async function roleFor(wsId, mode) {
    const key = `${wsId}:${mode}`;
    if (roles.has(key)) return roles.get(key);
    const { data, error } = await svc
      .from("workspace_roles")
      .insert({
        workspace_id: wsId,
        name: `zz-test-alcance-${mode}`,
        description: "Rol de prueba: solo cambia el alcance de leads",
        permissions: { keys: [], scopes: { leads: mode, conversations: "own", bookings: "own" } },
      })
      .select("id")
      .single();
    if (error) throw new Error(`no pude crear el rol de alcance ${mode}: ${error.message}`);
    roles.set(key, data.id);
    return data.id;
  }

  return {
    async apply(wsId, mode) {
      const roleId = mode === "own" ? null : await roleFor(wsId, mode);
      const allMine = [...roles.entries()].filter(([k]) => k.startsWith(`${wsId}:`)).map(([, id]) => id);

      const { data: members } = await svc
        .from("workspace_members")
        .select("user_id, role_id")
        .eq("workspace_id", wsId)
        .eq("role", "member");

      for (const m of members ?? []) {
        // Un Member con un rol que puso otro caso no se toca.
        if (m.role_id !== null && !allMine.includes(m.role_id)) continue;
        const { error } = await svc
          .from("workspace_members")
          .update({ role_id: roleId })
          .eq("workspace_id", wsId)
          .eq("user_id", m.user_id);
        if (error) throw new Error(`no pude asignar el alcance ${mode}: ${error.message}`);
      }
    },
  };
}
