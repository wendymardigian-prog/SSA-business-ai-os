import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { membersWithPermission } from "./permission-members";

const WS = "11111111-2222-4333-8444-555555555555";

const db = () =>
  memoryDb({
    workspace_members: [
      { workspace_id: WS, user_id: "owner", role: "owner", role_id: null },
      { workspace_id: WS, user_id: "admin", role: "admin", role_id: null },
      { workspace_id: WS, user_id: "member", role: "member", role_id: null },
      { workspace_id: WS, user_id: "generador", role: "member", role_id: "r1" },
      { workspace_id: WS, user_id: "lector", role: "member", role_id: "r2" },
      { workspace_id: "otro-negocio", user_id: "ajeno", role: "owner", role_id: null },
    ],
    workspace_roles: [
      { id: "r1", workspace_id: WS, system_role: null, permissions: { keys: ["designer.view", "designer.generate"], scopes: {} } },
      { id: "r2", workspace_id: WS, system_role: null, permissions: { keys: ["designer.view"], scopes: {} } },
    ],
  }).client;

describe("quiénes tienen designer.generate (avisos de «falta un dato»)", () => {
  it("Owner, Admin y un rol personalizado con la clave; no el Member de sistema ni quien solo ve", async () => {
    expect((await membersWithPermission(db(), WS, "designer.generate")).sort()).toEqual(["admin", "generador", "owner"]);
  });

  it("solo del negocio pedido", async () => {
    expect(await membersWithPermission(db(), WS, "designer.generate")).not.toContain("ajeno");
  });

  it("quien solo ve aparece al pedir designer.view", async () => {
    expect(await membersWithPermission(db(), WS, "designer.view")).toContain("lector");
  });

  it("nunca lanza: si la base falla, lista vacía", async () => {
    const broken = { from: () => { throw new Error("boom"); } } as never;
    expect(await membersWithPermission(broken, WS, "designer.generate")).toEqual([]);
  });
});
