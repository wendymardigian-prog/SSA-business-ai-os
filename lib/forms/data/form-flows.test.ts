import { describe, it, expect } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { flowsForForm, formFlowGraph } from "./form-flows";
import { formTemplateGraph } from "@/lib/forms/automation/templates";

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
      { id: "f1", name: "Avisarme", enabled: true, describe: "Se envía un formulario en cualquier formulario", summary: "Armado en el canvas" },
      { id: "f2", name: "Apagada", enabled: false, describe: "Se responde una encuesta en cualquier formulario", summary: "Armado en el canvas" },
    ]);
  });

  it("la fila trae el resumen del flujo: «2 caminos + si no · 3 emails», o «Armado en el canvas»", async () => {
    const tree = formTemplateGraph("email_by_answer", {
      form: { id: "form-1", name: "A", type: "custom" },
      userEmail: "yo@ejemplo.com",
      question: { key: "plan", label: "Plan", type: "single_select", options: ["Uno", "Dos"] },
    });
    const db = fakeDb({
      "flows:select": {
        data: [
          { id: "f1", name: "Con caminos", status: "draft", nodes: tree.nodes, edges: tree.edges },
          { id: "f2", name: "A mano", status: "draft", nodes: [{ id: "trigger", type: "trigger", data: { triggerType: "form_submitted" }, position: { x: 0, y: 0 } }, { id: "s", type: "split", data: {}, position: { x: 0, y: 0 } }, { id: "a", type: "action", data: {}, position: { x: 0, y: 0 } }, { id: "b", type: "action", data: {}, position: { x: 0, y: 0 } }], edges: [{ id: "e", source: "trigger", target: "s" }, { id: "e1", source: "s", target: "a", sourceHandle: "A" }, { id: "e2", source: "s", target: "b", sourceHandle: "B" }] },
        ],
      },
    });
    const rows = await flowsForForm(db.client, "form-1");
    expect(rows.map((r) => r.summary)).toEqual(["Cuando se envía · 2 caminos + si no · 3 emails", "Armado en el canvas"]);
  });
});
