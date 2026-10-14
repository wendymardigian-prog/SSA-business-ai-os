import { describe, expect, it } from "vitest";
import { buildHistory, HISTORY_PAGE_SIZE, openInvites, pendingInvites, type HistoryInvite } from "./invite-history";

const now = new Date("2026-10-13T12:00:00Z");
const inv = (id: string, over: Partial<HistoryInvite>): HistoryInvite => ({
  id, status: "pending", expires_at: "2026-10-20T00:00:00Z", created_at: "2026-10-01T00:00:00Z", ...over,
});

const rows = [
  inv("vigente", {}),
  inv("vencida", { expires_at: "2026-10-05T00:00:00Z" }),
  inv("aceptada", { status: "accepted", accepted_at: "2026-10-10T00:00:00Z" }),
  inv("anulada", { status: "revoked", revoked_at: "2026-10-11T00:00:00Z" }),
];

describe("pendientes", () => {
  it("las vigentes, y las abiertas incluyen las vencidas", () => {
    expect(pendingInvites(rows, now).map((i) => i.id)).toEqual(["vigente"]);
    expect(openInvites(rows, now).map((i) => i.id)).toEqual(["vigente", "vencida"]);
  });
});

describe("buildHistory", () => {
  it("junta aceptadas, anuladas y vencidas, de la más nueva a la más vieja", () => {
    const h = buildHistory(rows, { now });
    expect(h.entries.map((e) => `${e.invite.id}:${e.state}`)).toEqual(["anulada:revoked", "aceptada:accepted", "vencida:expired"]);
  });

  it("filtra por estado", () => {
    expect(buildHistory(rows, { filter: "accepted", now }).entries.map((e) => e.invite.id)).toEqual(["aceptada"]);
    expect(buildHistory(rows, { filter: "revoked", now }).entries.map((e) => e.invite.id)).toEqual(["anulada"]);
    expect(buildHistory(rows, { filter: "expired", now }).entries.map((e) => e.invite.id)).toEqual(["vencida"]);
  });

  it("pagina de a 20 y acota la página pedida", () => {
    const many = Array.from({ length: 45 }, (_, i) => inv(`a${i}`, { status: "revoked", revoked_at: new Date(2026, 9, 1, 0, i).toISOString() }));
    const first = buildHistory(many, { now });
    expect(first.entries).toHaveLength(HISTORY_PAGE_SIZE);
    expect(first).toMatchObject({ total: 45, page: 1, pages: 3 });
    expect(buildHistory(many, { page: 3, now }).entries).toHaveLength(5);
    expect(buildHistory(many, { page: 99, now }).page).toBe(3);
    expect(buildHistory([], { now })).toMatchObject({ total: 0, page: 1, pages: 1 });
  });
});
