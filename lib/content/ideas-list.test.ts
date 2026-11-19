import { describe, expect, it } from "vitest";
import { ideaListRow, parseIdeaFilter, sortIdeaRows, type IdeaSourceRow } from "./ideas-list";

const idea = (over: Partial<IdeaSourceRow> = {}): IdeaSourceRow => ({
  id: "i1",
  title: "De 3 a 12 visitas",
  status: "aprobada",
  source: "call",
  call_id: "c1",
  discarded_reason: null,
  approved_at: "2026-11-10T10:00:00Z",
  created_at: "2026-11-09T10:00:00Z",
  calls: { id: "c1", title: "Seguimiento semanal", recorded_at: "2026-11-08T15:00:00Z" },
  ...over,
});

describe("Contenido › Ideas: cada idea con su estado, su pieza y de dónde salió", () => {
  it("una idea de una grabación que quien mira puede ver: con su título y el link", () => {
    const r = ideaListRow(idea(), [{ id: "p1", idea_id: "i1", title: "Reel de visitas", status: "draft" }, { id: "p2", idea_id: "otra", title: "x", status: "draft" }]);
    expect(r.origin).toEqual({ kind: "call", callId: "c1", label: "Seguimiento semanal", recordedAt: "2026-11-08T15:00:00Z", visible: true });
    expect(r.pieces).toEqual([{ id: "p1", title: "Reel de visitas", statusLabel: expect.any(String) }]);
    expect(r).toMatchObject({ statusLabel: "Aprobada", tone: "green", date: "2026-11-10T10:00:00Z" });
  });
  it("una grabación que no puede ver (la RLS no la trae) se nombra sin título ni link", () => {
    expect(ideaListRow(idea({ calls: null }), []).origin).toMatchObject({ kind: "call", label: "Una grabación", visible: false });
  });
  it("de un agente o de una persona", () => {
    expect(ideaListRow(idea({ call_id: null, calls: null, source: "agent" }), []).origin).toEqual({ kind: "agent", label: "Un agente de IA" });
    expect(ideaListRow(idea({ call_id: null, calls: null, source: "manual" }), []).origin).toEqual({ kind: "manual", label: "Una persona" });
  });
  it("la nueva va en amarillo y su fecha es la de creación", () => {
    expect(ideaListRow(idea({ status: "nueva", approved_at: null }), [])).toMatchObject({ tone: "yellow", date: "2026-11-09T10:00:00Z" });
  });
  it("un filtro raro vuelve a las aprobadas", () => {
    expect(parseIdeaFilter("nueva")).toBe("nueva");
    expect(parseIdeaFilter("cualquiera")).toBe("aprobada");
    expect(parseIdeaFilter(undefined)).toBe("aprobada");
  });
  it("el orden: lo que espera primero; empates, lo más nuevo arriba", () => {
    const rows = [idea({ id: "a", status: "aprobada" }), idea({ id: "b", status: "nueva", approved_at: null, created_at: "2026-11-01T00:00:00Z" }), idea({ id: "c", status: "nueva", approved_at: null, created_at: "2026-11-05T00:00:00Z" })].map((i) => ideaListRow(i, []));
    expect(sortIdeaRows(rows, "status", "asc").map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});
