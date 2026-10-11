import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { CONTACT_CALLS_LIMIT, loadBookingCalls, loadContactCalls, toCallSectionRows, viewAllCallsHref } from "./contact-section";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  recorded_at: "2026-10-07T15:00:00Z",
  call_type: "cierre",
  recorded_by_user_id: "u1",
  outcome: "venta",
  closer_score: 80,
  lead_score: 70,
  analysis_status: "analyzed",
  ...over,
});
const names = new Map([["u1", "Ana"]]);

describe("toCallSectionRows", () => {
  it("arma la fila con el nombre del closer, y un closer desconocido queda null", () => {
    expect(toCallSectionRows([row("c1"), row("c2", { recorded_by_user_id: "otro" }), row("c3", { recorded_by_user_id: null })], names).map((r) => r.closerName)).toEqual(["Ana", null, null]);
    expect(toCallSectionRows([row("c1")], names)[0]).toEqual({ id: "c1", recordedAt: "2026-10-07T15:00:00Z", callType: "cierre", closerName: "Ana", outcome: "venta", closerScore: 80, leadScore: 70, status: "analyzed" });
  });
});

describe("loadContactCalls", () => {
  it("muestra las 2 que la RLS deja ver (la tercera, que no ve, no llega) y el total es de las visibles", async () => {
    // La RLS filtra en la base: aca la consulta devuelve solo lo visible.
    const db = fakeDb({ "calls:select": { data: [row("c1"), row("c2")], count: 2 } as never });
    const r = await loadContactCalls(db.client, { workspaceId: "ws1", contactId: "ct1", names });
    expect(r.rows).toHaveLength(2);
    expect(r.total).toBe(2);
  });

  it("pide como mucho 10, las mas recientes, solo del contacto y activas, con el cliente que recibe", async () => {
    const db = fakeDb({ "calls:select": { data: [] } });
    await loadContactCalls(db.client, { workspaceId: "ws1", contactId: "ct1", names });
    const q = db.calls[0];
    expect(q.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "eq", column: "workspace_id", value: "ws1" }),
      expect.objectContaining({ method: "eq", column: "contact_id", value: "ct1" }),
      expect.objectContaining({ method: "is", column: "archived_at" }),
      expect.objectContaining({ method: "limit", column: CONTACT_CALLS_LIMIT }),
    ]));
    expect(CONTACT_CALLS_LIMIT).toBe(10);
    expect(db.writes()).toHaveLength(0);
  });

  it("el total puede ser mayor que lo que se muestra (para 'Ver todas')", async () => {
    const db = fakeDb({ "calls:select": { data: [row("c1")], count: 14 } as never });
    expect((await loadContactCalls(db.client, { workspaceId: "ws1", contactId: "ct1", names })).total).toBe(14);
  });

  it("no pide la transcripcion ni el analisis", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/calls/contact-section.ts", "utf8");
    expect(src).not.toMatch(/transcript|select\("\*"|createServiceClient/);
  });

  it("una falla de lectura no rompe la ficha: devuelve vacio", async () => {
    const db = fakeDb({ "calls:select": { error: { message: "boom" } } });
    expect(await loadContactCalls(db.client, { workspaceId: "ws1", contactId: "ct1", names })).toEqual({ rows: [], total: 0 });
  });
});

describe("loadBookingCalls", () => {
  it("una agenda con 2 llamadas lista las dos", async () => {
    const db = fakeDb({ "calls:select": { data: [row("c1"), row("c2")] } });
    expect(await loadBookingCalls(db.client, { workspaceId: "ws1", bookingId: "b1", names })).toHaveLength(2);
    expect(db.calls[0].filters).toContainEqual(expect.objectContaining({ method: "eq", column: "booking_id", value: "b1" }));
  });
  it("sin llamadas, lista vacia; si falla, tambien", async () => {
    expect(await loadBookingCalls(fakeDb({ "calls:select": { data: [] } }).client, { workspaceId: "ws1", bookingId: "b1", names })).toEqual([]);
    expect(await loadBookingCalls(fakeDb({ "calls:select": { error: { message: "x" } } }).client, { workspaceId: "ws1", bookingId: "b1", names })).toEqual([]);
  });
});

describe("viewAllCallsHref", () => {
  it("lleva a la lista filtrada por el contacto", () => {
    expect(viewAllCallsHref("abc")).toBe("/dashboard/llamadas?contacto=abc");
  });
});
