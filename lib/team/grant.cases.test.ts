/**
 * Los casos compartidos de `grant.cases.json` contra la version TypeScript (`assertCanGrant`).
 * `scripts/verify-roles.mjs` corre los MISMOS casos contra `public.can_grant_permissions` (00212):
 * si las dos gemelas se separan, uno de los dos se pone en rojo.
 */
import { describe, expect, it } from "vitest";
import cases from "./grant.cases.json";
import { assertCanGrant, type GrantActor } from "@/lib/team/grant";
import { SYSTEM_ROLE_PERMISSIONS, type PermissionScope, type ScopedModule } from "@/lib/auth/permissions";

type Actor = "owner" | "admin" | "member" | { keys: string[]; scopes: Record<string, string> };

function toActor(a: Actor): GrantActor {
  if (a === "owner" || a === "admin" || a === "member") {
    return { userId: "u", role: a, roleId: null, permissions: SYSTEM_ROLE_PERMISSIONS[a] };
  }
  return {
    userId: "u",
    role: "member",
    roleId: "r",
    permissions: { keys: a.keys, scopes: a.scopes as Partial<Record<ScopedModule, PermissionScope>> } as GrantActor["permissions"],
  };
}

describe("casos compartidos de assertCanGrant", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const result = assertCanGrant(toActor(c.actor as Actor), {
        keys: c.keys,
        scopes: c.scopes as Partial<Record<ScopedModule, PermissionScope>>,
      });
      expect(result.ok).toBe(c.allowed);
    });
  }
});
