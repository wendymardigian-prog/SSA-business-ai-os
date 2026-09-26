/**
 * Los guards de permisos (F70).
 *
 * Lo que mas se cuida: que `requireWorkspaceAdmin` y `getAdminContext` NO
 * cambien de comportamiento. Son los que usan doce paginas y once archivos
 * de acciones; si cambiaran, el bloque 9 rompe medio sistema.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getWorkspace, redirect } = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("@/lib/workspace", () => ({ getWorkspace }));
vi.mock("next/navigation", () => ({ redirect }));

import { memoryDb } from "@/lib/agent/testing/memory-db";
import { SYSTEM_ROLE_PERMISSIONS } from "./permissions";
import {
  getAdminContext,
  getPermissionAction,
  getPermissionContext,
  requirePermission,
  requireWorkspaceAdmin,
} from "./guards";

const WS = "ws-1";

function context(over: { role?: string; roleId?: string | null; roles?: Array<Record<string, unknown>> } = {}) {
  const memory = memoryDb({ workspace_roles: over.roles ?? [] });
  getWorkspace.mockResolvedValue({
    user: { id: "u-1" },
    workspace: { id: WS },
    role: over.role ?? "member",
    roleId: over.roleId ?? null,
    supabase: memory.client,
  });
  return memory;
}

beforeEach(() => vi.clearAllMocks());

describe("los guards de siempre no cambiaron (F70)", () => {
  it("un Admin pasa requireWorkspaceAdmin", async () => {
    context({ role: "admin" });

    await expect(requireWorkspaceAdmin()).resolves.toMatchObject({ role: "admin" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("un Member no pasa, y va al dashboard", async () => {
    context({ role: "member" });

    await expect(requireWorkspaceAdmin()).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("getAdminContext devuelve null para un Member", async () => {
    context({ role: "member" });

    expect(await getAdminContext()).toBeNull();
  });

  it("y el contexto para un Owner", async () => {
    context({ role: "owner" });

    expect(await getAdminContext()).toMatchObject({ role: "owner" });
  });
});

describe("resolver los permisos (F70)", () => {
  it("un Owner puede todo, sin leer la base", async () => {
    // Los permisos de Owner y Admin son la tabla de TypeScript: leer el
    // jsonb para ellos daria dos lugares donde definir lo mismo.
    context({ role: "owner" });
    const ctx = await getPermissionContext();

    expect(ctx.can("workspace.transfer")).toBe(true);
    expect(ctx.scope("leads")).toBe("all");
  });

  it("un Admin puede todo menos transferir", async () => {
    context({ role: "admin" });
    const ctx = await getPermissionContext();

    expect(ctx.can("integrations.manage")).toBe(true);
    expect(ctx.can("workspace.transfer")).toBe(false);
  });

  it("un Member sin rol asignado tiene los permisos de Member", async () => {
    context({ role: "member" });
    const ctx = await getPermissionContext();

    expect(ctx.can("content.create")).toBe(true);
    expect(ctx.can("content.publish")).toBe(false);
    expect(ctx.scope("leads")).toBe("own");
  });

  it("un Member con rol personalizado usa los permisos de su fila", async () => {
    context({
      role: "member",
      roleId: "r-1",
      roles: [
        {
          id: "r-1",
          workspace_id: WS,
          system_role: null,
          permissions: {
            keys: ["dashboards.content.view", "content.publish"],
            scopes: { leads: "all", conversations: "own" },
          },
        },
      ],
    });

    const ctx = await getPermissionContext();

    expect(ctx.can("dashboards.content.view")).toBe(true);
    expect(ctx.can("content.publish")).toBe(true);
    expect(ctx.scope("leads")).toBe("all");
    // Lo que el rol no da, no lo tiene, aunque un Member normal si.
    expect(ctx.can("flows.edit")).toBe(false);
  });

  it("un Member apuntando a la fila del rol de sistema usa la tabla", async () => {
    // La fila de sistema tiene los permisos vacios a proposito: la fuente es
    // TypeScript. Si se leyera el jsonb, ese Member no podria hacer nada.
    context({
      role: "member",
      roleId: "r-sys",
      roles: [{ id: "r-sys", workspace_id: WS, system_role: "member", permissions: { keys: [] } }],
    });

    const ctx = await getPermissionContext();

    expect(ctx.can("content.create")).toBe(true);
    expect(ctx.permissions).toEqual(SYSTEM_ROLE_PERMISSIONS.member);
  });

  it("un rol que ya no existe deja los permisos de Member", async () => {
    // Del lado seguro: nunca mas permisos de los que corresponden.
    context({ role: "member", roleId: "r-borrado", roles: [] });

    const ctx = await getPermissionContext();

    expect(ctx.permissions).toEqual(SYSTEM_ROLE_PERMISSIONS.member);
  });
});

describe("exigir un permiso (F70)", () => {
  it("con el permiso, pasa", async () => {
    context({ role: "admin" });

    await expect(requirePermission("integrations.manage")).resolves.toMatchObject({ role: "admin" });
  });

  it("sin el permiso, va al dashboard y no a un 403", async () => {
    // Una pantalla de error para algo que nunca va a poder abrir es un
    // callejon: el dashboard es lo que SI puede ver.
    context({ role: "member" });

    await expect(requirePermission("integrations.manage")).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("para una accion, devuelve null en vez de lanzar", async () => {
    context({ role: "member" });

    expect(await getPermissionAction("integrations.manage")).toBeNull();
    expect(await getPermissionAction("content.create")).not.toBeNull();
  });

  it("un permiso que no existe nunca alcanza", async () => {
    context({ role: "owner" });

    expect(await getPermissionAction("telepatia.usar")).toBeNull();
  });
});
