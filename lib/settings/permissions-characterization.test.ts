import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAdminRole } from "@/lib/auth/roles";
import { can, systemRolePermissions, type RolePermissions } from "@/lib/auth/permissions";

/**
 * Paso 0 del Bloque S: fija, ANTES de tocar una sola pantalla, qué guard usa
 * cada pestaña de Configuración y qué pestañas ve cada rol. El bloque
 * reordena la navegación; no cambia quién ve qué. Si una de estas
 * aserciones se rompe durante S1-S7, es una señal de que algo movió un
 * guard sin querer, y hay que parar y avisar (regla del documento).
 *
 * Mismo patrón de deteccion por texto que lib/auth/member-baseline.test.ts:
 * no reimplementa el guard, busca su nombre en el archivo real.
 */

const ROOT = join(process.cwd(), "app/(dashboard)/dashboard/settings");

/** Las siete pestañas, con el archivo que resuelve la ruta y el guard que usa hoy. */
const PAGES: Record<string, { file: string; guardMarker: string }> = {
  general: { file: "page.tsx", guardMarker: "requireWorkspaceAdmin" },
  team: { file: "team/page.tsx", guardMarker: "requireWorkspaceAdmin" },
  roles: { file: "roles/page.tsx", guardMarker: "listRoles" },
  "custom-fields": { file: "custom-fields/page.tsx", guardMarker: "requireWorkspaceAdmin" },
  recursos: { file: "recursos/page.tsx", guardMarker: "getWorkspace" },
  integrations: { file: "integrations/page.tsx", guardMarker: "requireWorkspaceAdmin" },
  background: { file: "background/page.tsx", guardMarker: "requireWorkspaceAdmin" },
};

describe("Bloque S — guard de cada pestaña (no cambia en S1-S7)", () => {
  for (const [key, { file, guardMarker }] of Object.entries(PAGES)) {
    it(`${key} (${file}) sigue usando ${guardMarker}`, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source).toContain(guardMarker);
    });
  }
});

/**
 * Qué pestañas ve cada rol, simulando la misma decisión que toma cada
 * página hoy: `isAdminRole` para las que usan `requireWorkspaceAdmin`,
 * `can(permissions, "roles.manage")` para Roles (vía `listRoles`), y
 * "siempre visible" para Recursos (no tiene guard de rol, solo RLS).
 */
function visibleTabs(role: "owner" | "admin" | "member", permissions: RolePermissions) {
  const admin = isAdminRole(role);
  return {
    general: admin,
    team: admin,
    roles: can(permissions, "roles.manage"),
    "custom-fields": admin,
    recursos: true,
    integrations: admin,
    background: admin,
  };
}

const ALL_VISIBLE = {
  general: true,
  team: true,
  roles: true,
  "custom-fields": true,
  recursos: true,
  integrations: true,
  background: true,
};

describe("Bloque S — qué pestaña ve cada rol (caracterización)", () => {
  it("Owner ve las siete", () => {
    expect(visibleTabs("owner", systemRolePermissions("owner")!)).toEqual(ALL_VISIBLE);
  });

  it("Admin ve las siete", () => {
    expect(visibleTabs("admin", systemRolePermissions("admin")!)).toEqual(ALL_VISIBLE);
  });

  it("Member de sistema (sin rol personalizado) solo ve Recursos", () => {
    expect(visibleTabs("member", systemRolePermissions("member")!)).toEqual({
      general: false,
      team: false,
      roles: false,
      "custom-fields": false,
      recursos: true,
      integrations: false,
      background: false,
    });
  });

  it("Member con rol personalizado y roles.manage ve Recursos y Roles, nada más", () => {
    // Importante, y no obvio mirando el código: `roles.manage` es un permiso
    // fino, pero las demás pestañas miran el campo `role` grueso
    // (owner/admin/member) vía `isAdminRole`, no los permisos del rol
    // personalizado. Un rol con `role: "member"` + `roles.manage` entra a
    // Roles pero sigue sin ver Equipo, Campos personalizados, Integraciones
    // ni Tareas, aunque administre los roles del workspace. Es el
    // comportamiento real hoy; S3 (el segmented Miembros|Roles) no lo cambia.
    const customPermissions: RolePermissions = {
      keys: ["roles.manage"],
      scopes: { leads: "own", conversations: "own", bookings: "own" },
    };
    expect(visibleTabs("member", customPermissions)).toEqual({
      general: false,
      team: false,
      roles: true,
      "custom-fields": false,
      recursos: true,
      integrations: false,
      background: false,
    });
  });
});
