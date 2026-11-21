import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { getBusy } = vi.hoisted(() => ({ getBusy: vi.fn() }));
vi.mock("@/lib/google-calendar/client", () => ({ getBusy }));

import { loadTeamBusy, resetTeamBusyCache } from "./team-busy";

const FROM = "2026-11-24T06:00:00.000Z";
const TO = "2026-11-25T06:00:00.000Z";

function db() {
  return memoryDb({
    calendars: [
      { workspace_id: "ws", user_id: "ana", connection_id: "c-ana", external_calendar_id: "ana@x.com", is_active: true, check_conflicts: true },
      { workspace_id: "ws", user_id: "ana", connection_id: "c-ana", external_calendar_id: "familia", is_active: true, check_conflicts: true },
      { workspace_id: "ws", user_id: "bruno", connection_id: "c-bruno", external_calendar_id: "bruno@x.com", is_active: true, check_conflicts: true },
      { workspace_id: "ws", user_id: "caro", connection_id: "c-caro", external_calendar_id: "caro@x.com", is_active: true, check_conflicts: true },
      { workspace_id: "ws", user_id: "dani", connection_id: "c-dani", external_calendar_id: "dani@x.com", is_active: true, check_conflicts: false },
    ],
    oauth_connections: [
      { id: "c-ana", status: "active" },
      { id: "c-bruno", status: "revoked" },
      { id: "c-caro", status: "active" },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTeamBusyCache();
});

describe("ocupado del equipo", () => {
  it("lee el ocupado de los calendarios de conflicto, por conexión, solo horarios", async () => {
    getBusy.mockImplementation(async (_d: unknown, conn: string) =>
      conn === "c-caro" ? Promise.reject(new Error("google caído")) : [{ startUtc: "2026-11-24T15:00:00.000Z", endUtc: "2026-11-24T16:00:00.000Z" }],
    );
    const r = await loadTeamBusy(db().client, { workspaceId: "ws", userIds: ["ana", "bruno", "caro", "dani", "eli"], fromUtc: FROM, toUtc: TO });
    const by = Object.fromEntries(r.map((x) => [x.userId, x]));
    expect(by.ana).toEqual({ userId: "ana", status: "ok", busy: [{ startAt: "2026-11-24T15:00:00.000Z", endAt: "2026-11-24T16:00:00.000Z" }] });
    expect(getBusy).toHaveBeenCalledWith(expect.anything(), "c-ana", ["ana@x.com", "familia"], FROM, TO);
    expect(by.bruno.status).toBe("broken");
    expect(by.caro.status).toBe("unavailable");
    expect(by.dani.status).toBe("no_google");
    expect(by.eli.status).toBe("no_google");
  });

  it("guarda un minuto lo leído", async () => {
    getBusy.mockResolvedValue([]);
    const d = db();
    let t = 1_000;
    await loadTeamBusy(d.client, { workspaceId: "ws", userIds: ["ana"], fromUtc: FROM, toUtc: TO, now: () => t });
    t += 30_000;
    await loadTeamBusy(d.client, { workspaceId: "ws", userIds: ["ana"], fromUtc: FROM, toUtc: TO, now: () => t });
    expect(getBusy).toHaveBeenCalledTimes(1);
    t += 40_000;
    await loadTeamBusy(d.client, { workspaceId: "ws", userIds: ["ana"], fromUtc: FROM, toUtc: TO, now: () => t });
    expect(getBusy).toHaveBeenCalledTimes(2);
  });
});
