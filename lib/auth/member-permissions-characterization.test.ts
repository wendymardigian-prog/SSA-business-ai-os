/**
 * Caracterizacion de los roles de sistema (Llamadas, §4.3): el set EXACTO de
 * claves y alcances de cada rol, escrito con `toEqual`. Lo que cambie en un
 * rol de sistema tiene que cambiar aca, a la vista, con su decision.
 *
 * Llamadas suma (decision 152): `calls.view` con alcance `own` al Member, y
 * las tres claves de `calls` al Owner y al Admin. Nada mas.
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
        "flows.view", "flows.edit",
        "sequences.view", "sequences.edit",
        "agents.view",
        "content.view", "content.create",
        "scheduling.use", "bookings.view", "bookings.manage",
        // Llamadas (decision 152): el unico permiso nuevo del Member.
        "calls.view",
      ].sort(),
    );
  });

  it("tiene alcance 'own' en todo lo que tiene alcance", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.member.scopes).toEqual({ leads: "own", conversations: "own", bookings: "own", calls: "own" });
  });
});

describe("Owner y Admin", () => {
  it("el Owner tiene todas las claves y el alcance 'all'", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.owner.keys).toEqual(ALL_PERMISSION_KEYS);
    expect(SYSTEM_ROLE_PERMISSIONS.owner.scopes).toEqual({ leads: "all", conversations: "all", bookings: "all", calls: "all" });
  });

  it("el Admin tiene todas menos transferir la propiedad", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.admin.keys).toEqual(ALL_PERMISSION_KEYS.filter((k) => k !== "workspace.transfer"));
  });
});
