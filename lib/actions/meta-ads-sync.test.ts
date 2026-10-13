import { describe, expect, it, vi, beforeEach } from "vitest";

const scheduleJob = vi.fn();
let allowed = true;
let config: unknown = { ad_accounts: [{ ad_account_id: "act_1", sync_enabled: true }] };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/scheduler", () => ({ scheduleJob: (...args: unknown[]) => scheduleJob(...args) }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) => (allowed && key === "settings.manage" ? { workspace: { id: "ws-1" }, user: { id: "u-1" } } : null),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { config } }) }) }) }) }),
    }),
  }),
}));

const { syncMetaAdsNow } = await import("./meta-ads-sync");

beforeEach(() => {
  scheduleJob.mockReset();
  allowed = true;
  config = { ad_accounts: [{ ad_account_id: "act_1", sync_enabled: true }] };
});

describe("syncMetaAdsNow", () => {
  it("encola el job de la cuenta del workspace de la sesion, con su clave de bloque", async () => {
    scheduleJob.mockResolvedValue({ id: "j" });
    const r = await syncMetaAdsNow("act_1");
    expect(r).toEqual({ ok: true, alreadyQueued: false });
    const [, type, payload, , key] = scheduleJob.mock.calls[0];
    expect(type).toBe("meta_ads_sync");
    expect(payload).toEqual({ workspaceId: "ws-1", adAccountId: "act_1" });
    expect(String(key)).toMatch(/^meta-ads-manual:act_1:\d+$/);
  });

  it("sin el permiso settings.manage no encola nada", async () => {
    allowed = false;
    const r = await syncMetaAdsNow("act_1");
    expect(r.ok).toBe(false);
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("una cuenta que no esta activada para sincronizar se rechaza", async () => {
    const r = await syncMetaAdsNow("act_otra");
    expect(r.ok).toBe(false);
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  it("si ya hay un job pendiente (23505) lo dice y no es un error", async () => {
    scheduleJob.mockRejectedValue({ code: "23505" });
    expect(await syncMetaAdsNow("act_1")).toEqual({ ok: true, alreadyQueued: true });
  });

  it("un fallo inesperado vuelve como error, sin lanzar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    scheduleJob.mockRejectedValue(new Error("base caida"));
    const r = await syncMetaAdsNow("act_1");
    expect(r.ok).toBe(false);
  });
});
