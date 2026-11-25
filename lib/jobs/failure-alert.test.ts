import { beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn(async (_input: Record<string, unknown>) => true);
vi.mock("@/lib/notifications/system-alerts", () => ({ notifySystemFailure: (input: Record<string, unknown>) => notify(input) }));

import { jobLabel, jobWorkspaceId, notifyJobFailure } from "./failure-alert";

const WS = "11111111-2222-3333-4444-555555555555";

beforeEach(() => notify.mockClear());

describe("notifyJobFailure", () => {
  it("avisa a Owner y Admin con el negocio del payload y el motivo", async () => {
    expect(await notifyJobFailure({}, { type: "svc_daily", payload: { workspace_id: WS } }, "svc_daily_run: código 57014 · timeout")).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      workspaceId: WS,
      type: "system_job_failed",
      key: "job:svc_daily",
      area: "integrations",
      metadata: { job_type: "svc_daily" },
    });
    expect(String(notify.mock.calls[0][0].body)).toContain("57014");
    expect(String(notify.mock.calls[0][0].title)).toContain("Servicios");
  });

  it("acepta workspaceId en camelCase", () => {
    expect(jobWorkspaceId({ workspaceId: WS })).toBe(WS);
    expect(jobWorkspaceId({ workspace_id: "no-es-uuid" })).toBeNull();
    expect(jobWorkspaceId(null)).toBeNull();
  });

  it("el job que manda los avisos nunca avisa de sí mismo (bucle), ni los que ya tienen su aviso", async () => {
    for (const type of ["notification_deliver", "content_publish", "content_copy", "agent_burst"]) {
      expect(await notifyJobFailure({}, { type, payload: { workspaceId: WS } }, "x")).toBe(false);
    }
    expect(notify).not.toHaveBeenCalled();
  });

  it("sin negocio en el payload no avisa", async () => {
    expect(await notifyJobFailure({}, { type: "resume_flow", payload: { sessionId: "s" } }, "x")).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("nunca lanza", async () => {
    notify.mockRejectedValueOnce(new Error("caída"));
    await expect(notifyJobFailure({}, { type: "svc_daily", payload: { workspace_id: WS } }, "x")).resolves.toBe(false);
  });

  it("un tipo sin nombre conocido igual se entiende", () => {
    expect(jobLabel("tipo_nuevo")).toContain("tipo_nuevo");
  });
});
