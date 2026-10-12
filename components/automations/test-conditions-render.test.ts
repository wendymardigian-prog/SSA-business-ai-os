/** Prueba de humo de "Probar condiciones": se dibuja sin navegador y dice lo que tiene que decir. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExplanationView } from "@/components/automations/explanation-view";
import { TestConditionsButton } from "@/components/automations/test-conditions-sheet";
import { explainPaths } from "@/lib/automations/explain-paths";
import type { StepTree } from "@/lib/automations/step-tree";

const TREE: StepTree = {
  trigger: { id: "trigger", data: { triggerType: "form_submitted" } },
  steps: [
    {
      kind: "branch",
      id: "b1",
      data: { label: "Según facturación" },
      otherwise: [],
      paths: [
        { id: "p_alta", label: "Facturación alta", logic: "and", steps: [], conditions: [{ field: "answer.facturacion", operator: "is", value: "Mucho", valueType: "single_select" }] },
        { id: "p_up", label: "Con dato de antes", logic: "and", steps: [], conditions: [{ field: "variable:x", operator: "is_not_empty", valueType: "text" }] },
      ],
    },
  ],
};

describe("Probar condiciones se dibuja", () => {
  it("el boton se ve y no abre nada por si solo", () => {
    const html = renderToStaticMarkup(createElement(TestConditionsButton, { flowId: "f", tree: TREE, catalog: null }));
    expect(html).toContain("Probar condiciones");
    expect(html).not.toContain('role="dialog"');
  });

  it("el resultado dice por donde iria, con ✓ y ✗", () => {
    const html = renderToStaticMarkup(createElement(ExplanationView, { explanation: explainPaths(TREE, { "answer.facturacion": "Mucho" }, []) }));
    expect(html).toContain("Iría por");
    expect(html).toContain("Facturación alta");
    expect(html).toContain("✓");
  });

  it("por «Si no» y con un campo sin dato lo aclara", () => {
    const html = renderToStaticMarkup(createElement(ExplanationView, { explanation: explainPaths(TREE, { "answer.facturacion": "Poco" }, []) }));
    expect(html).toContain("Ningún camino se cumple");
    expect(html).toContain("sin dato en la prueba");
    expect(html).toContain("✗");
  });

  it("sin ningun Condiciones al que se llegue, lo dice", () => {
    const html = renderToStaticMarkup(createElement(ExplanationView, { explanation: { branches: [] } }));
    expect(html).toContain("No hay ningún paso Condiciones");
  });
});
