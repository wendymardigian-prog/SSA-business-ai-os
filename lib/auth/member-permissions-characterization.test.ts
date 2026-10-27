/**
 * Caracterizacion de los roles de sistema: el set EXACTO de claves y alcances
 * de cada rol, escrito con `toEqual`. Lo que cambie en un rol de sistema tiene
 * que cambiar aca, a la vista, con su decision.
 *
 * Llamadas suma (decision 152): `calls.view` con alcance `own` al Member, y  @plantilla-quitar(llamadas)
 * las tres claves de `calls` al Owner y al Admin. Nada mas.  @plantilla-quitar(llamadas)
 *  @plantilla-quitar(llamadas)
 * Formularios suma (alcance v7.1 §4.5): `forms.view` al Member (ve las respuestas  @plantilla-quitar(formularios)
 * de los contactos que ve; la RLS lo aplica) y `forms.view` + `forms.manage` al  @plantilla-quitar(formularios)
 * Owner y al Admin. El Member NO tiene `forms.manage`.  @plantilla-quitar(formularios)
 *  @plantilla-quitar(formularios)
 * Ventas suma (plano §5): `sales.view`, `sales.manage` y `payments.manage` a los  @plantilla-quitar(ventas)
 * tres roles de sistema, con alcance `sales` = `own` para el Member y `all` para  @plantilla-quitar(ventas)
 * Owner y Admin. El Member NO tiene `products.manage` ni `sales.settings`.  @plantilla-quitar(ventas)
 *  @plantilla-quitar(ventas)
 * Equipo y roles (plano §9.3, cambio aprobado el 13/10/2026): el Member suma `contacts.assign` y
 * `flows.publish` (las dos ya las podia hacer de hecho; se conservan) y pierde `sequences.edit`
 * (la base nunca se lo dejo usar: corrige el catalogo, sin cambio real). Son 27 claves.
 */
import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_PERMISSIONS, ALL_PERMISSION_KEYS } from "./permissions";

describe("Member de sistema", () => {
  it("tiene exactamente estas claves", () => {
    expect([...SYSTEM_ROLE_PERMISSIONS.member.keys].sort()).toEqual(
      [
        "dashboards.chat.view",
        // La bandeja ya no son claves (00249/00250): ver `channels` abajo.
        "contacts.view", "contacts.edit",
        // Cambio aprobado, plano §9.3: reasignar los leads que ve (ya podia, sin que hubiera una clave).
        "contacts.assign",
        "flows.view", "flows.edit",
        // Cambio aprobado, plano §9.3: publicar flujos (ya podia). Se conserva.
        "flows.publish",
        // Cambio aprobado, plano §9.3: sale `sequences.edit` (las acciones de secuencias ya eran solo de Admin).
        "sequences.view",
        "agents.view",
        "content.view", "content.create",
        "scheduling.use", "bookings.view", "bookings.manage",
        // @plantilla-desde(llamadas)
        // Llamadas (decision 152): el unico permiso nuevo del Member.
        "calls.view",
        // @plantilla-hasta(llamadas)
        // @plantilla-desde(formularios)
        // Formularios (alcance v7.1 §4.5): el unico permiso nuevo del Member.
        "forms.view",
        // @plantilla-hasta(formularios)
        // @plantilla-desde(ventas)
        // Ventas (Etapa 5, §5): el unico permiso nuevo del Member. Alcance `own`.
        "sales.view", "sales.manage", "payments.manage",
        // @plantilla-hasta(ventas)
        // @plantilla-desde(tareas)
        // Tareas (Extra A, §4): las dos claves nuevas del Member. Alcance `own`. SIN `tasks.delete`.
        "tasks.view", "tasks.edit",
        // @plantilla-hasta(tareas)
        // @plantilla-desde(comisiones)
        // Comisiones (Extra I, cambio aprobado M9): el unico permiso nuevo del Member. Alcance `own` (las suyas).
        // SIN `commissions.manage` y SIN `expenses.*`.
        "commissions.view",
        // @plantilla-hasta(comisiones)
      ].sort(),
    );
  });

  it("ve y responde en todas las cuentas de la bandeja, solo lo asignado (lo mismo que con las seis claves de antes)", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.member.channels).toEqual({ mode: "all", all: { scope: "own", reply: true } });
  });

  it("tiene alcance 'own' en todo lo que tiene alcance", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.member.scopes).toEqual({ leads: "own", bookings: "own", calls: "own", sales: "own", commissions: "own", tasks: "own" }); // @plantilla-quitar(llamadas,ventas,comisiones,tareas)
    // @plantilla-sin(llamadas,ventas,comisiones,tareas): expect(SYSTEM_ROLE_PERMISSIONS.member.scopes).toEqual({ leads: "own", bookings: "own" });
  });
});

describe("Owner y Admin", () => {
  it("el Owner tiene todas las claves y el alcance 'all'", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.owner.keys).toEqual(ALL_PERMISSION_KEYS);
    expect(SYSTEM_ROLE_PERMISSIONS.owner.scopes).toEqual({ leads: "all", bookings: "all", calls: "all", sales: "all", commissions: "all", tasks: "all" }); // @plantilla-quitar(llamadas,ventas,comisiones,tareas)
    // @plantilla-sin(llamadas,ventas,comisiones,tareas): expect(SYSTEM_ROLE_PERMISSIONS.owner.scopes).toEqual({ leads: "all", bookings: "all" });
  });

  it("el Admin tiene todas menos las dos solo-Owner: transferir la propiedad y quitar personas", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.admin.keys).toEqual(ALL_PERMISSION_KEYS.filter((k) => k !== "workspace.transfer" && k !== "team.remove"));
  });
});
