/**
 * setDefaultPublisher (G7): el publicador por defecto de una cuenta social se
 * puede elegir a mano, no solo post por post.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { getAdminContext, logAudit } = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ getAdminContext }));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setDefaultPublisher } from "./social-accounts";

const WS = "ws-1";
const USER = "user-1";
const ACCOUNT = "account-1";

function admin(socialAccounts: Array<Record<string, unknown>>) {
  const db = memoryDb({ social_accounts: socialAccounts });
  getAdminContext.mockResolvedValue({ workspace: { id: WS }, supabase: db.client, user: { id: USER } });
  return db;
}

const account = (over: Record<string, unknown> = {}) => ({
  id: ACCOUNT,
  workspace_id: WS,
  platform: "youtube",
  default_publisher: "postproxy",
  publishers: [
    { publisher: "postproxy", status: "available", account_ref: null, status_reason: null, verified_at: null, manually_enabled: false },
    { publisher: "youtube_api", status: "unverified", account_ref: null, status_reason: null, verified_at: null, manually_enabled: false },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  logAudit.mockResolvedValue("audit-1");
});

describe("setDefaultPublisher", () => {
  it("un Member no puede", async () => {
    getAdminContext.mockResolvedValue(null);
    const result = await setDefaultPublisher(ACCOUNT, "postproxy");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Owner y Admin") });
  });

  it("cambia el publicador cuando esta disponible", async () => {
    const db = admin([account()]);
    const result = await setDefaultPublisher(ACCOUNT, "postproxy");
    expect(result).toEqual({ ok: true });
    expect(db.rows("social_accounts")[0].default_publisher).toBe("postproxy");
  });

  it("no cambia si el publicador no esta disponible todavia", async () => {
    admin([account()]);
    // youtube_api esta 'unverified' y no habilitado a mano: no se puede elegir.
    const result = await setDefaultPublisher(ACCOUNT, "youtube_api");
    expect(result.ok).toBe(false);
  });

  it("habilitado a mano, aunque no este 'available', si se puede elegir", async () => {
    const db = admin([
      account({
        publishers: [
          { publisher: "youtube_api", status: "unverified", account_ref: null, status_reason: null, verified_at: null, manually_enabled: true },
        ],
      }),
    ]);
    const result = await setDefaultPublisher(ACCOUNT, "youtube_api");
    expect(result).toEqual({ ok: true });
    expect(db.rows("social_accounts")[0].default_publisher).toBe("youtube_api");
  });

  it("una cuenta de otro workspace no se puede tocar", async () => {
    admin([account({ workspace_id: "otro-ws" })]);
    const result = await setDefaultPublisher(ACCOUNT, "postproxy");
    expect(result.ok).toBe(false);
  });

  it("deja registro en el audit log", async () => {
    admin([account()]);
    await setDefaultPublisher(ACCOUNT, "postproxy");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        entityType: "social_account",
        entityId: ACCOUNT,
        action: "update",
        performedBy: USER,
      }),
    );
  });
});
