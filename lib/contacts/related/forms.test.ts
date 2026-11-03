import { describe, expect, it } from "vitest";
import { contactListPlan, parseContactListFilters } from "../list-query";
import { formCells } from "./forms";

const A = "9f0d1b6e-1111-2222-3333-444455556666";
const F = "9f0d1b6e-aaaa-bbbb-cccc-ddddeeeeffff";
const plan = (params: Record<string, string | string[]>) => {
  const p = contactListPlan(parseContactListFilters(params, []));
  return { embeds: p.embeds, clauses: p.clauses.filter((c) => !("column" in c && c.column === "is_anonymous")) };
};

describe("formularios en la lista de contactos", () => {
  it("respondió: join con la respuesta, sin spam", () => {
    expect(plan({ formulario: F })).toEqual({
      embeds: ["con_form_submissions:form_submissions!inner(form_id,status)"],
      clauses: [
        { op: "neq", column: "con_form_submissions.status", value: "spam" },
        { op: "in", column: "con_form_submissions.form_id", values: [F] },
      ],
    });
  });

  it("no respondió: anti-join propio, que no choca con «respondió» otro", () => {
    const p = plan({ formulario: A, sin_formulario: F });
    expect(p.embeds).toEqual(["sin_form_submissions_1:form_submissions(form_id,status)", "con_form_submissions:form_submissions!inner(form_id,status)"]);
    expect(p.clauses).toContainEqual({ op: "in", column: "sin_form_submissions_1.form_id", values: [F] });
    expect(p.clauses).toContainEqual({ op: "is_null", column: "sin_form_submissions_1" });
  });

  it("las columnas: la última respuesta con el nombre del formulario y cuántas", () => {
    const rows = [
      { contact_id: A, form_id: F, created_at: "2026-11-01T10:00:00Z" },
      { contact_id: A, form_id: "otro", created_at: "2026-10-01T10:00:00Z" },
    ];
    const cells = formCells([A], ["last_form", "forms_count"], rows, new Map([[F, "Aplicación"]]))[A];
    expect(cells.last_form).toEqual({ t: "date", at: "2026-11-01T10:00:00Z", mode: "day", sub: "Aplicación" });
    expect(cells.forms_count).toEqual({ t: "text", text: "2 respuestas" });
  });
});
