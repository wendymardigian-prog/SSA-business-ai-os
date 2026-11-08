import { describe, expect, it } from "vitest";
import { canDeleteBroadcast, canEditBroadcastMessage, canReopenBroadcast, parseStatusFilter, STATUS_FILTERS, statusFilterParam } from "./list";
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

describe("canReopenBroadcast", () => {
  it("se ofrece en un programado o pausado que nunca mandó nada", () => {
    expect(canReopenBroadcast({ status: "scheduled", sent: 0, failed: 0 })).toBe(true);
    expect(canReopenBroadcast({ status: "paused", sent: 0, failed: 0 })).toBe(true);
  });

  it("no se ofrece si ya salió o falló alguno", () => {
    expect(canReopenBroadcast({ status: "paused", sent: 2, failed: 0 })).toBe(false);
    expect(canReopenBroadcast({ status: "paused", sent: 0, failed: 1 })).toBe(false);
  });

  it("no se ofrece en un borrador, uno enviándose, terminado o cancelado", () => {
    for (const status of ["draft", "sending", "completed", "cancelled"] as const) {
      expect(canReopenBroadcast({ status, sent: 0, failed: 0 })).toBe(false);
    }
  });
});

describe("canEditBroadcastMessage", () => {
  it("solo en programado o pausado", () => {
    expect(canEditBroadcastMessage("scheduled")).toBe(true);
    expect(canEditBroadcastMessage("paused")).toBe(true);
    for (const status of ["draft", "sending", "completed", "cancelled"] as const) expect(canEditBroadcastMessage(status)).toBe(false);
  });
});
