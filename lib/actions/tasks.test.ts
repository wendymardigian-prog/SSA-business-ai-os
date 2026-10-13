import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), audit: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: mocks.audit }));

import { completeTask, createTask, deleteTask, planCompletion, setTaskBlockers, updateTask } from "./tasks";

const ME = "11111111-1111-4111-8111-111111111111";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function session(allowed: string[]) {
  const user = fakeDb({
    "tasks:insert": { data: [{ id: T1, workspace_id: "ws1", title: "Hola", owner_id: ME, follower_ids: [] }] },
  });
  const service = fakeDb({ "workspace_members:select": { data: [{ user_id: ME }] } });
  mocks.permission.mockImplementation(async (key: string) => (allowed.includes(key) ? { workspace: { id: "ws1", timezone: "UTC" }, user: { id: ME }, supabase: user.client } : null));
  mocks.service.mockResolvedValue(service.client);
  return { user, service };
}

beforeEach(() => vi.clearAllMocks());

describe("Server Actions de Tareas (F8)", () => {
  it("sin permiso: error de permiso en castellano, sin tocar la base (ninguna lanza)", async () => {
    const { user } = session([]);
    const results = await Promise.all([
      createTask({ title: "a" }),
      updateTask(T1, { title: "b" }),
      planCompletion(T1),
      completeTask(T1, true),
      setTaskBlockers(T1, []),
      deleteTask(T1),
    ]);
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(user.calls).toHaveLength(0);
    expect(user.rpcCalls).toHaveLength(0);
  });

  it("borrar pide `tasks.delete`: quien solo puede editar no borra", async () => {
    const { user } = session(["tasks.edit"]);
    expect(await deleteTask(T1)).toMatchObject({ ok: false, code: "forbidden" });
    expect(user.rpcCalls).toHaveLength(0);
    expect(mocks.permission).toHaveBeenCalledWith("tasks.delete");
  });

  it("crear pide `tasks.edit`, valida en el servidor y revalida la pantalla", async () => {
    session(["tasks.edit"]);
    expect(await createTask({ title: "" })).toMatchObject({ ok: false, code: "validation" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    const ok = await createTask({ title: "Hola" });
    expect(ok.ok).toBe(true);
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/tareas");
  });

  it("un error inesperado no llega al cliente como excepcion", async () => {
    mocks.permission.mockRejectedValue(new Error("boom"));
    const r = await createTask({ title: "a" });
    expect(r).toMatchObject({ ok: false, code: "server" });
  });
});
