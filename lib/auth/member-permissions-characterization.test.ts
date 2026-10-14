/**
 * Caracterizacion de los roles de sistema (Llamadas, §4.3): el set EXACTO de
 * claves y alcances de cada rol, escrito con `toEqual`. Lo que cambie en un
 * rol de sistema tiene que cambiar aca, a la vista, con su decision.
 *
 * Llamadas suma (decision 152): `calls.view` con alcance `own` al Member, y
 * las tres claves de `calls` al Owner y al Admin. Nada mas.
 *
 * Formularios suma (alcance v7.1 §4.5): `forms.view` al Member (ve las respuestas
 * de los contactos que ve; la RLS lo aplica) y `forms.view` + `forms.manage` al
 * Owner y al Admin. El Member NO tiene `forms.manage`.
 *
 * Ventas suma (plano §5): `sales.view`, `sales.manage` y `payments.manage` a los
 * tres roles de sistema, con alcance `sales` = `own` para el Member y `all` para
 * Owner y Admin. El Member NO tiene `products.manage` ni `sales.settings`.
 *
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
        "inbox.instagram.view", "inbox.instagram.reply",
        "inbox.whatsapp.view", "inbox.whatsapp.reply",
        "inbox.email.view", "inbox.email.reply",
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
        // Llamadas (decision 152): el unico permiso nuevo del Member.
        "calls.view",
        // Formularios (alcance v7.1 §4.5): el unico permiso nuevo del Member.
        "forms.view",
        // Ventas (Etapa 5, §5): el unico permiso nuevo del Member. Alcance `own`.
        "sales.view", "sales.manage", "payments.manage",
        // Tareas (Extra A, §4): las dos claves nuevas del Member. Alcance `own`. SIN `tasks.delete`.
        "tasks.view", "tasks.edit",
      ].sort(),
    );
  });

  it("tiene alcance 'own' en todo lo que tiene alcance", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.member.scopes).toEqual({ leads: "own", conversations: "own", bookings: "own", calls: "own", sales: "own", tasks: "own" });
  });
});

describe("Owner y Admin", () => {
  it("el Owner tiene todas las claves y el alcance 'all'", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.owner.keys).toEqual(ALL_PERMISSION_KEYS);
    expect(SYSTEM_ROLE_PERMISSIONS.owner.scopes).toEqual({ leads: "all", conversations: "all", bookings: "all", calls: "all", sales: "all", tasks: "all" });
  });

  it("el Admin tiene todas menos las dos solo-Owner: transferir la propiedad y quitar personas", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.admin.keys).toEqual(ALL_PERMISSION_KEYS.filter((k) => k !== "workspace.transfer" && k !== "team.remove"));
  });
});
