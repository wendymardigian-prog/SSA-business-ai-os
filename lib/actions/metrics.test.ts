/**
 * "Actualizar" por red (F47): la espera de 15 minutos es de cada cuenta. Que
 * Instagram se haya leido hace un minuto no puede trabar a YouTube.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { getAdminContext, createServiceClient } = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ getAdminContext }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { refreshMetricsNow } from "./metrics";

const WS = "ws-1";
const NOW = new Date("2026-10-07T14:22:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function setup(accounts: Array<Record<string, unknown>>) {
  const db = memoryDb({
    social_accounts: accounts.map((a) => ({ workspace_id: WS, is_active: true, ...a })),
    scheduled_jobs: [],
  });
  getAdminContext.mockResolvedValue({ workspace: { id: WS }, supabase: db.client, user: { id: "u1" } });
  createServiceClient.mockResolvedValue(db.client);
  return db;
}

const queuedFor = (db: ReturnType<typeof memoryDb>) =>
  db.rows("scheduled_jobs").map((j) => (j.payload as { socialAccountId: string }).socialAccountId);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("refreshMetricsNow por red", () => {
  const accounts = [
    { id: "sa-ig", platform: "instagram", profile_synced_at: minutesAgo(1) },
    { id: "sa-yt", platform: "youtube", profile_synced_at: null },
  ];

  it("YouTube se actualiza aunque Instagram se haya leido hace un minuto", async () => {
    const db = setup(accounts);

    const result = await refreshMetricsNow("youtube");

    expect(result).toEqual({ ok: true, queued: 1 });
    expect(queuedFor(db)).toEqual(["sa-yt"]);
  });

  it("Instagram, leida hace un minuto, frena con su propia espera", async () => {
    const db = setup(accounts);

    const result = await refreshMetricsNow("instagram");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Instagram se actualizo hace poco. Proba de nuevo en 14 minutos.");
    expect(queuedFor(db)).toEqual([]);
  });

  it("sin red (Todas) encola solo las que ya pueden", async () => {
    const db = setup(accounts);

    const result = await refreshMetricsNow(null);

    expect(result).toEqual({ ok: true, queued: 1 });
    expect(queuedFor(db)).toEqual(["sa-yt"]);
  });

  it("sin red, si todas esperan, dice cuanto falta para la mas proxima", async () => {
    setup([
      { id: "sa-ig", platform: "instagram", profile_synced_at: minutesAgo(1) },
      { id: "sa-yt", platform: "youtube", profile_synced_at: minutesAgo(10) },
    ]);

    const result = await refreshMetricsNow();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/en 5 minutos/);
  });

  it("una red que no esta conectada lo dice", async () => {
    setup(accounts);

    const result = await refreshMetricsNow("linkedin");

    expect(result).toEqual({ ok: false, error: "LinkedIn no esta conectada" });
  });

  it("una red que no existe da error y no lee nada", async () => {
    const db = setup(accounts);

    const result = await refreshMetricsNow("myspace");

    expect(result).toEqual({ ok: false, error: "Esa red no existe" });
    expect(queuedFor(db)).toEqual([]);
  });

  it("un Member no puede actualizar", async () => {
    getAdminContext.mockResolvedValue(null);

    const result = await refreshMetricsNow("youtube");

    expect(result.ok).toBe(false);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
