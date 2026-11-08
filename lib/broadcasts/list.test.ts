import { describe, expect, it } from "vitest";
import { canDeleteBroadcast, parseStatusFilter, STATUS_FILTERS, statusFilterParam } from "./list";
import { BROADCAST_STATUS } from "./status";

describe("parseStatusFilter", () => {
  it("lee cada estado y vuelve con la misma palabra", () => {
    for (const f of STATUS_FILTERS) {
      expect(parseStatusFilter(f.param)).toBe(f.status);
      expect(statusFilterParam(f.status)).toBe(f.param);
    }
  });

  it("todo lo que no conoce es Todos", () => {
    expect(parseStatusFilter(null)).toBeNull();
    expect(parseStatusFilter("")).toBeNull();
    expect(parseStatusFilter("draft")).toBeNull();
    expect(parseStatusFilter("cualquiera")).toBeNull();
  });

  it("cubre todos los estados de un broadcast", () => {
    expect(STATUS_FILTERS.map((f) => f.status).sort()).toEqual(Object.keys(BROADCAST_STATUS).sort());
  });
});

describe("canDeleteBroadcast", () => {
  it("se ofrece si nunca salió nada y no se está enviando", () => {
    for (const status of ["draft", "scheduled", "paused", "cancelled", "completed"] as const) {
      expect(canDeleteBroadcast({ status, sent: 0, failed: 0 })).toBe(true);
    }
  });

  it("no se ofrece mientras se envía", () => {
    expect(canDeleteBroadcast({ status: "sending", sent: 0, failed: 0 })).toBe(false);
  });

  it("no se ofrece si salió o falló alguno", () => {
    expect(canDeleteBroadcast({ status: "cancelled", sent: 3, failed: 0 })).toBe(false);
    expect(canDeleteBroadcast({ status: "paused", sent: 0, failed: 1 })).toBe(false);
  });
});
