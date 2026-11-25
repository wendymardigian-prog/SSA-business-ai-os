import { beforeEach, describe, expect, it, vi } from "vitest";

const viewer = vi.fn();
const upserts: unknown[] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ getMemberAction: () => viewer() }));
vi.mock("@/lib/supabase/server", () => {
  const table = {
    select: () => table,
    eq: () => table,
    maybeSingle: async () => ({ data: { notification_prefs: {} }, error: null }),
    update: (row: unknown) => (upserts.push(row), table),
    upsert: async (row: unknown) => (upserts.push(row), { error: null }),
    insert: async (row: unknown) => (upserts.push(row), { error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }) },
    from: () => table,
  };
  return { createClient: async () => client, createServiceClient: async () => client };
});

import { setNotificationPref } from "./account";

beforeEach(() => {
  viewer.mockReset();
  upserts.length = 0;
});

describe("setNotificationPref y los avisos solo para Owner y Admin", () => {
  it("un Member no puede activar los fallos del sistema, aunque tenga otros permisos", async () => {
    viewer.mockResolvedValue({ role: "member", can: () => true });
    const res = await setNotificationPref({ eventKey: "system_failures", channel: "email", value: true });
    expect(res).toEqual({ ok: false, error: "Ese aviso no es para tu rol." });
    expect(upserts).toHaveLength(0);
  });

  it("sin contexto de miembro tampoco", async () => {
    viewer.mockResolvedValue(null);
    expect((await setNotificationPref({ eventKey: "system_failures", channel: "bell", value: false })).ok).toBe(false);
  });

  it("un Admin sí", async () => {
    viewer.mockResolvedValue({ role: "admin", can: () => false });
    const res = await setNotificationPref({ eventKey: "system_failures", channel: "email", value: false });
    expect(res.ok).toBe(true);
  });

  it("un aviso de Owner y Admin que un permiso abre sí lo guarda quien tiene ese permiso", async () => {
    viewer.mockResolvedValue({ role: "member", can: (key: string) => key === "agents.edit" });
    expect((await setNotificationPref({ eventKey: "ai_learning", channel: "email", value: true })).ok).toBe(true);
  });

  it("un aviso para todos no pide rol", async () => {
    const res = await setNotificationPref({ eventKey: "bookings", channel: "email", value: true });
    expect(res.ok).toBe(true);
    expect(viewer).not.toHaveBeenCalled();
  });
});
