import { describe, it, expect } from "vitest";
import { dueLabel, flowIdOf, formatDay, formatDayShort, formatSource } from "./format";

const TODAY = "2026-10-13";

describe("formato de fechas", () => {
  it("formatDay y formatDayShort", () => {
    expect(formatDay("2026-10-05")).toBe("05/10/2026");
    expect(formatDayShort("2026-10-05", TODAY)).toBe("05/10");
    expect(formatDayShort("2027-01-05", TODAY)).toBe("05/01/2027");
  });
  it("dueLabel: hoy, manana, ayer, vencidas, cercanas, lejanas, sin fecha y completadas", () => {
    const l = (due: string | null, status: "pending" | "completed" = "pending") => dueLabel({ due_date: due, status }, TODAY);
    expect(l("2026-10-13")).toEqual({ text: "Hoy", tone: "today" });
    expect(l("2026-10-14")).toEqual({ text: "Mañana", tone: "soon" });
    expect(l("2026-10-12")).toEqual({ text: "Ayer", tone: "overdue" });
    expect(l("2026-10-10")).toEqual({ text: "Hace 3 días", tone: "overdue" });
    expect(l("2026-10-17")).toEqual({ text: "17/10", tone: "soon" });
    expect(l("2026-10-30")).toEqual({ text: "30/10", tone: "normal" });
    expect(l(null)).toEqual({ text: "Sin fecha", tone: "none" });
    expect(l("2026-10-01", "completed")).toEqual({ text: "01/10", tone: "done" });
  });
});

describe("formatSource (F26)", () => {
  const FLOW = "11111111-1111-4111-8111-111111111111";
  it("manual y CX", () => {
    expect(formatSource({ source: "manual", source_ref: null, conversation_id: null })).toEqual({ label: "Manual", href: null });
    expect(formatSource({ source: "cx", source_ref: "x", conversation_id: null })).toEqual({ label: "CX", href: null });
  });
  it("flujo: con nombre y enlace; sin nombre conocido, solo «Flujo»", () => {
    const task = { source: "flow" as const, source_ref: `${FLOW}:run1:nodo1`, conversation_id: null };
    expect(formatSource(task, { flowNames: new Map([[FLOW, "Bienvenida"]]) })).toEqual({ label: "Flujo: Bienvenida", href: `/dashboard/flows/${FLOW}` });
    expect(formatSource(task)).toEqual({ label: "Flujo", href: `/dashboard/flows/${FLOW}` });
    expect(formatSource({ source: "flow", source_ref: null, conversation_id: null })).toEqual({ label: "Flujo", href: null });
  });
  it("agente: enlaza a la conversacion si la hay", () => {
    expect(formatSource({ source: "agent", source_ref: "run", conversation_id: "conv-1" })).toEqual({ label: "Agente", href: "/dashboard/inbox?c=conv-1" });
    expect(formatSource({ source: "agent", source_ref: "run", conversation_id: null })).toEqual({ label: "Agente", href: null });
  });
  it("flowIdOf descarta lo que no es un id", () => {
    expect(flowIdOf(`${FLOW}:a:b`)).toBe(FLOW);
    expect(flowIdOf("no-es-un-id:x")).toBeNull();
    expect(flowIdOf(null)).toBeNull();
  });
});
