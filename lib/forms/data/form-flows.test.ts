import { describe, it, expect } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { flowsForForm, formFlowGraph } from "./form-flows";

/**
 * `flows` NO tiene `deleted_at`: filtrar por esa columna hace fallar la consulta y
 * la pantalla queda vacia o da 404 (se vio en la revision visual). Este test lo fija.
 */
describe("los flujos de un formulario", () => {
  it("la lista no filtra por una columna que flows no tiene", async () => {
    const db = fakeDb({ "flows:select": { data: [] } });
    await flowsForForm(db.client, "form-1");
    expect(db.calls.flatMap((c) => c.filters.map((f) => f.column))).not.toContain("deleted_at");
  });

  it("el grafo de un flujo tampoco", async () => {
    const db = fakeDb({ "flows:select": { data: { id: "f1", name: "x", status: "draft", form_id: "form-1", workspace_id: "ws", nodes: [], edges: [] } } });
    const found = await formFlowGraph(db.client, "f1");
    expect(found?.flow.id).toBe("f1");
    expect(db.calls.flatMap((c) => c.filters.map((f) => f.column))).not.toContain("deleted_at");
  });

  it("arma la fila con el trigger y si esta encendido", async () => {
    const db = fakeDb({
      "flows:select": { data: [{ id: "f1", name: "Avisarme", status: "published" }, { id: "f2", name: "Apagada", status: "draft" }] },
      "triggers:select": { data: [{ flow_id: "f1", type: "form_submitted", config: { form_ids: [] }, is_active: true }, { flow_id: "f2", type: "survey_answered", config: {}, is_active: false }] },
    });
    const rows = await flowsForForm(db.client, "form-1", {});
    expect(rows).toEqual([
      { id: "f1", name: "Avisarme", enabled: true, describe: "Se envía un formulario en cualquier formulario" },
      { id: "f2", name: "Apagada", enabled: false, describe: "Se responde una encuesta en cualquier formulario" },
    ]);
  });
});
