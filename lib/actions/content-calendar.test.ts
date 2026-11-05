/**
 * Arrastrar una pieza en el calendario: el calendario dibuja los dias en la zona de quien mira, y la accion tiene que
 * leer `fromDay` y `toDay` en la misma. Si los leyera en la del negocio, una pieza cerca de la medianoche "no estaria"
 * en el dia desde el que se la arrastra, o caeria en otro.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const POST = "post-1";

let db: MemoryDb;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async () => "America/Argentina/Buenos_Aires" }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: "user-1" },
    workspace: { id: WS, timezone: "UTC" },
    role: "owner",
    roleId: null,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));

const { movePieceToDay } = await import("./content-calendar");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  db = memoryDb({
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        // 10/11 22:00 en Buenos Aires, que en UTC (la zona del negocio en este test) ya es el 11/11.
        networks: [{ platform: "instagram", planned_at: "2026-11-11T01:00:00.000Z" }],
      },
    ],
    social_posts: [],
    workspace_roles: [],
  });
});

afterEach(() => vi.useRealTimers());

describe("movePieceToDay", () => {
  it("lee los dias en la zona de quien mira y conserva su hora", async () => {
    const result = await movePieceToDay({ postId: POST, fromDay: "2026-11-10", toDay: "2026-11-12" });

    expect(result).toEqual({ ok: true, moved: ["instagram"] });
    const networks = db.rows("content_posts")[0].networks as Array<{ planned_at: string }>;
    // 12/11 22:00 en Buenos Aires.
    expect(networks[0].planned_at).toBe("2026-11-13T01:00:00.000Z");
  });

  it("el dia en UTC no es el dia que ve la persona", async () => {
    const result = await movePieceToDay({ postId: POST, fromDay: "2026-11-11", toDay: "2026-11-12" });

    expect(result.ok).toBe(false);
    const networks = db.rows("content_posts")[0].networks as Array<{ planned_at: string }>;
    expect(networks[0].planned_at).toBe("2026-11-11T01:00:00.000Z");
  });
});
