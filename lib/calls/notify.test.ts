import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const once = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications/create", () => ({ createNotificationOnce: once }));

import { membersWithPermission, notifyBudgetBlocked, notifyObjection } from "./notify";

const members = [
  { user_id: "owner", role: "owner", role_id: null },
  { user_id: "admin", role: "admin", role_id: null },
  { user_id: "plain", role: "member", role_id: "r-sys" },
  { user_id: "custom", role: "member", role_id: "r-custom" },
  { user_id: "other", role: "member", role_id: "r-other" },
];
const roles = [
  { id: "r-sys", system_role: "member", permissions: { keys: [], scopes: {} } },
  { id: "r-custom", system_role: null, permissions: { keys: ["calls.configure", "calls.view"], scopes: {} } },
  { id: "r-other", system_role: null, permissions: { keys: ["calls.view"], scopes: {} } },
];

beforeEach(() => {
  vi.clearAllMocks();
  once.mockResolvedValue(true);
});

describe("membersWithPermission", () => {
  it("Owner y Admin por tabla, un rol personalizado por su fila, el Member de sistema solo con lo que da la tabla", async () => {
    const db = fakeDb({ "workspace_members:select": { data: members }, "workspace_roles:select": { data: roles } });
    const who = await membersWithPermission(db.client, "ws1", "calls.configure");
    expect(who.sort()).toEqual(["admin", "custom", "owner"]);
  });

  it("calls.view lo tiene el Member de sistema tambien", async () => {
    const db = fakeDb({ "workspace_members:select": { data: members }, "workspace_roles:select": { data: roles } });
    const who = await membersWithPermission(db.client, "ws1", "calls.view");
    expect(who).toContain("plain");
    expect(who).toContain("other");
  });

  it("si la consulta explota, devuelve lista vacia sin lanzar", async () => {
    const boom = { from: () => { throw new Error("db caida"); } } as never;
    expect(await membersWithPermission(boom, "ws1", "calls.configure")).toEqual([]);
  });
});

describe("notifyBudgetBlocked", () => {
  it("manda un aviso por persona, con perRecipient y una ventana de un dia", async () => {
    const db = fakeDb({ "workspace_members:select": { data: members }, "workspace_roles:select": { data: roles } });
    const n = await notifyBudgetBlocked(db.client, "ws1", "c1");
    expect(n).toBe(3);
    expect(once).toHaveBeenCalledTimes(3);
    const arg = once.mock.calls[0][0];
    expect(arg).toMatchObject({ type: "call_analysis_budget", perRecipient: true, withinMinutes: 1440, workspaceId: "ws1" });
    expect(once.mock.calls.map((c) => c[0].recipientId).sort()).toEqual(["admin", "custom", "owner"]);
  });

  it("no cuenta los avisos que ya existian", async () => {
    once.mockResolvedValueOnce(false).mockResolvedValue(true);
    const db = fakeDb({ "workspace_members:select": { data: members }, "workspace_roles:select": { data: roles } });
    expect(await notifyBudgetBlocked(db.client, "ws1", "c1")).toBe(2);
  });
});

describe("alcance y objeciones", () => {
  const scoped = [
    { id: "r-all", system_role: null, permissions: { keys: ["calls.edit"], scopes: { calls: "all" } } },
    { id: "r-own", system_role: null, permissions: { keys: ["calls.edit"], scopes: { calls: "own" } } },
  ];
  const people = [
    { user_id: "owner", role: "owner", role_id: null },
    { user_id: "ed-all", role: "member", role_id: "r-all" },
    { user_id: "ed-own", role: "member", role_id: "r-own" },
  ];

  it("con scope all solo quedan quienes ven todas las llamadas", async () => {
    const db = fakeDb({ "workspace_members:select": { data: people }, "workspace_roles:select": { data: scoped } });
    expect((await membersWithPermission(db.client, "ws1", "calls.edit", { scope: "all" })).sort()).toEqual(["ed-all", "owner"]);
    expect((await membersWithPermission(db.client, "ws1", "calls.edit")).sort()).toEqual(["ed-all", "ed-own", "owner"]);
  });

  it("la objecion avisa a los editores con alcance all y NUNCA al closer", async () => {
    const db = fakeDb({ "workspace_members:select": { data: people }, "workspace_roles:select": { data: scoped } });
    const n = await notifyObjection(db.client, { workspaceId: "ws1", callId: "c1", closerId: "ed-all", callTitle: "Llamada con Ana" });
    expect(n).toBe(1);
    expect(once).toHaveBeenCalledTimes(1);
    expect(once.mock.calls[0][0]).toMatchObject({ type: "call_objection", recipientId: "owner", entityType: "call", entityId: "c1", perRecipient: true });
  });
});
