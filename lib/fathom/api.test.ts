import { describe, expect, it, vi } from "vitest";
import { BudgetExhausted, getTranscript, listMeetings, normalizeTranscript, secondsBetween, toAttendees } from "./api";
import { FathomError } from "./errors";
import { createRequestBudget } from "./rate-budget";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const deps = (fetchImpl: unknown, limit = 9) => ({ accessToken: "TOKEN-SECRETO", budget: createRequestBudget(limit), fetchImpl: fetchImpl as typeof fetch });

describe("listMeetings", () => {
  it("pide con created_after, un recorded_by[] por closer y el cursor", async () => {
    const fetchImpl = vi.fn(async () => json({ items: [{ recording_id: 1 }], next_cursor: "C2" }));
    const page = await listMeetings(deps(fetchImpl), { createdAfter: "2026-10-01T00:00:00Z", recordedBy: ["a@x.io", "b@y.io"], cursor: "C1" });
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe("/external/v1/meetings");
    expect(url.searchParams.get("created_after")).toBe("2026-10-01T00:00:00Z");
    expect(url.searchParams.getAll("recorded_by[]")).toEqual(["a@x.io", "b@y.io"]);
    expect(url.searchParams.get("cursor")).toBe("C1");
    expect(url.searchParams.has("include_transcript")).toBe(false);
    expect(page).toEqual({ items: [{ recording_id: 1 }], nextCursor: "C2" });
  });

  it("manda el token en la cabecera, nunca en la URL", async () => {
    const fetchImpl = vi.fn(async () => json({ items: [] }));
    await listMeetings(deps(fetchImpl), { recordedBy: [] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("TOKEN-SECRETO");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-SECRETO");
  });

  it("sin next_cursor, no hay otra pagina", async () => {
    const page = await listMeetings(deps(async () => json({ items: [] })), { recordedBy: [] });
    expect(page.nextCursor).toBeNull();
  });

  it("un 429 lanza temporal con el Retry-After", async () => {
    const err = await listMeetings(deps(async () => json({}, 429, { "Retry-After": "30" })), { recordedBy: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(FathomError);
    expect(err).toMatchObject({ kind: "temporary", status: 429, retryAfterMs: 30_000 });
  });

  it("un 502 y un error de red son temporales", async () => {
    expect((await listMeetings(deps(async () => json({}, 502)), { recordedBy: [] }).catch((e) => e)).kind).toBe("temporary");
    expect((await listMeetings(deps(async () => { throw new Error("red"); }), { recordedBy: [] }).catch((e) => e)).kind).toBe("temporary");
  });

  it("un 401 lanza permanente con status 401 (la ingesta fuerza UNA renovacion)", async () => {
    const err = await listMeetings(deps(async () => json({}, 401)), { recordedBy: [] }).catch((e) => e);
    expect(err).toMatchObject({ kind: "permanent", status: 401 });
  });

  it("con el presupuesto agotado no hace el pedido", async () => {
    const fetchImpl = vi.fn();
    await expect(listMeetings(deps(fetchImpl, 0), { recordedBy: [] })).rejects.toBeInstanceOf(BudgetExhausted);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("getTranscript", () => {
  it("normaliza las lineas y conserva el correo del invitado de cada voz", async () => {
    const lines = await getTranscript(deps(async () => json({ transcript: [{ speaker: { display_name: "Ana", matched_calendar_invitee_email: "ana@x.io" }, text: " Hola ", timestamp: "00:00:05" }, { text: "" }, null] })), 123);
    expect(lines).toEqual([{ speaker: { display_name: "Ana", matched_calendar_invitee_email: "ana@x.io" }, text: "Hola", timestamp: "00:00:05" }]);
  });
  it("un 404 es una transcripcion vacia, no un error", async () => {
    expect(await getTranscript(deps(async () => json({}, 404)), 123)).toEqual([]);
  });
  it("pide /recordings/{id}/transcript", async () => {
    const fetchImpl = vi.fn(async () => json({ transcript: [] }));
    await getTranscript(deps(fetchImpl), 456);
    expect(new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]).pathname).toBe("/external/v1/recordings/456/transcript");
  });
});

describe("helpers", () => {
  it("normalizeTranscript tolera basura", () => {
    expect(normalizeTranscript(null)).toEqual([]);
    expect(normalizeTranscript("x")).toEqual([]);
  });
  it("toAttendees deja null lo que Fathom no marca", () => {
    expect(toAttendees([{ name: "A", email: "a@x.io", is_external: true }, { email: "b@x.io" }])).toEqual([
      { name: "A", email: "a@x.io", is_external: true },
      { name: null, email: "b@x.io", is_external: null },
    ]);
  });
  it("secondsBetween", () => {
    expect(secondsBetween("2026-10-01T10:00:00Z", "2026-10-01T10:45:00Z")).toBe(2700);
    expect(secondsBetween(null, "2026-10-01T10:45:00Z")).toBeNull();
    expect(secondsBetween("2026-10-01T10:45:00Z", "2026-10-01T10:00:00Z")).toBeNull();
  });
});
