/**
 * Prueba de humo del editor de pasos: se dibuja (renderToString, sin navegador)
 * con arboles de todas las formas y no se rompe. No reemplaza mirarlo en
 * pantalla; atrapa lo que rompe al primer dibujo (un import circular mal
 * resuelto, un dato que falta, un key repetido).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/response-assets", () => ({ listAssets: vi.fn(async () => []) }));
vi.mock("@/lib/actions/flow-conditions", () => ({ getConditionCatalogInputs: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
// La barra de arriba depende del layout del dashboard: aca solo importa lo de adentro.
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title, left, right }: { title: string; left?: unknown; right?: unknown }) => createElement("header", null, title, left as never, right as never),
}));

import { StepList } from "@/components/automations/step-list";
import { StepTreeEditor } from "@/components/automations/step-tree-editor";
import { StepEditorProvider, type StepEditorContextValue } from "@/components/automations/step-tree-context";
import { PathConditions } from "@/components/automations/path-conditions";
import { ConditionBuilder } from "@/components/automations/condition-builder";
import { VisibilityRuleBuilder } from "@/components/forms/builder/visibility-rule-builder";
import { availableConditionFields } from "@/lib/flow-engine/condition-catalog";
import { formVariableSchema } from "@/lib/forms/automation/variable-schema";
import { FLOW_TEMPLATES, templateGraph } from "@/lib/scheduling/automation/templates";
import { flowToTree, type StepTree } from "@/lib/automations/step-tree";
import { ROOT } from "@/lib/automations/step-tree-edit";
import { offeredFields, recognizedFields } from "@/lib/automations/condition-builder-model";

const FACT = ["Poco", "Mucho"];
const catalog = {
  triggerSchema: formVariableSchema("form_submitted", [{ id: "f1", fields: [{ id: "1", key: "facturacion", type: "single_select", label: "Facturación", required: true, options: FACT }] }]),
  customFields: [],
  tags: [{ name: "vip" }],
  sequences: [{ id: "s1", name: "Bienvenida" }],
};

const cond = (value: string) => ({ field: "answer.facturacion", operator: "is", valueType: "single_select" as const, value });
const email = (id: string) => ({ kind: "action" as const, id, nodeType: "action", data: { actionType: "send_email", to: "contact", subject: `Hola ${id}`, body: "Cuerpo" } });

const TREE: StepTree = {
  trigger: { id: "trigger", data: { triggerType: "form_submitted" } },
  steps: [
    email("a"),
    { kind: "action", id: "d", nodeType: "delay", data: { duration: 2, unit: "hours" } },
    { kind: "action", id: "m", nodeType: "sendMessage", data: { messages: [{ text: "Hola", buttons: [] }], onlyIfPhone: true } },
    { kind: "action", id: "t", nodeType: "action", data: { actionType: "addTag", tagName: "vip" } },
    { kind: "action", id: "h", nodeType: "action", data: { actionType: "httpRequest", label: "Avisar al CRM" } },
    {
      kind: "branch",
      id: "b1",
      data: { label: "Según facturación" },
      paths: [
        { id: "p_aaaaaa", label: "Mucho", logic: "and", conditions: [cond("Mucho")], steps: [email("e1"), { kind: "gate", id: "g", data: { conditions: [{ field: "tag:vip", operator: "equals", value: "true" }], logic: "and" }, steps: [email("e2")] }] },
        {
          id: "p_bbbbbb",
          label: "",
          logic: "or",
          conditions: [cond(""), { field: "answer.borrada", operator: "is", valueType: "text", value: "x" }, { field: "tag:vip", operator: "equals", value: "true" }],
          steps: [
            {
              kind: "branch",
              id: "b2",
              data: {},
              paths: [{ id: "p_cccccc", label: "Adentro", logic: "and", conditions: [cond("Poco")], steps: [email("e3")] }],
              otherwise: [email("e4")],
            },
          ],
        },
      ],
      otherwise: [email("e5")],
    },
  ],
};

function context(tree: StepTree, screen: "forms" | "agenda" = "forms"): StepEditorContextValue {
  return { screen, tree, edit: () => {}, disabled: false, catalog, sendStepTest: () => {}, canSendTest: true, announce: () => {}, ask: () => {}, members: [], variableKeys: [] };
}

function render(tree: StepTree, screen: "forms" | "agenda" = "forms"): string {
  return renderToStaticMarkup(createElement(StepEditorProvider, { value: context(tree, screen) }, createElement(StepList, { steps: tree.steps, listRef: ROOT })));
}

describe("el editor de pasos se dibuja", () => {
  const html = render(TREE);

  it("muestra los pasos en palabras, los caminos y 'Si no'", () => {
    expect(html).toContain("1. Email al contacto");
    expect(html).toContain("Esperar 2 horas");
    expect(html).toContain("Agregar el tag");
    expect(html).toContain("Avisar al CRM");
    expect(html).toContain("Condiciones");
    expect(html).toContain("Si no");
    expect(html).toContain("Si se cumple:");
  });

  it("un camino sin nombre se ve como 'Camino 2' y cada camino tiene su condicion en palabras", () => {
    expect(html).toContain('placeholder="Camino 2"');
    expect(html).toContain("Facturación es");
  });

  it("una condicion incompleta o con una pregunta que ya no existe se avisa", () => {
    expect(html).toContain("Elegí una opción.");
    expect(html).toContain("Esta pregunta ya no existe en el formulario.");
    // y la condicion vieja del nodo `condition` se lee como frase, sin romper
    expect(html).toContain("formato anterior");
  });

  it("hay un '+ Agregar paso' entre los pasos y al final, y ninguno despues de Condiciones", () => {
    expect((html.match(/Agregar paso/g) ?? []).length).toBeGreaterThan(8);
  });

  it("una lista vacia ofrece agregar el primer paso", () => {
    const empty = render({ ...TREE, steps: [] });
    expect(empty).toContain("Agregar paso");
  });

  it("la Agenda se dibuja con sus pasos (estado de la reunion, cancelar) y las plantillas precreadas", () => {
    const agenda: StepTree = {
      trigger: { id: "trigger", data: { triggerType: "booking_created" } },
      steps: [
        { kind: "action", id: "s", nodeType: "action", data: { actionType: "set_booking_status", status: "no_show" } },
        { kind: "action", id: "c", nodeType: "action", data: { actionType: "cancel_booking", status: "cancelled_other" } },
      ],
    };
    const out = render(agenda, "agenda");
    expect(out).toContain("Cambiar el estado de la reunión a No-show");
    expect(out).toContain("Cancelar la reunión");
    for (const template of FLOW_TEMPLATES) {
      const g = templateGraph(template, "ev-1");
      const tree = flowToTree(g.nodes, g.edges)!;
      expect(() => render(tree, "agenda"), template.key).not.toThrow();
    }
  });
});

describe("el constructor de condiciones se dibuja", () => {
  const groups = availableConditionFields(catalog);

  it("un camino con una seleccion pide un desplegable con las opciones, no texto", () => {
    const html = renderToStaticMarkup(createElement(PathConditions, { path: { logic: "and", conditions: [cond("Mucho")] }, groups, onChange: () => {} }));
    expect(html).toContain('<option value="Poco">Poco</option>');
    expect(html).toContain('<option value="Mucho" selected');
    expect(html).not.toContain('type="text"');
  });

  it("una opcion guardada que ya no existe se muestra marcada", () => {
    const html = renderToStaticMarkup(createElement(PathConditions, { path: { logic: "and", conditions: [cond("Borrada")] }, groups, onChange: () => {} }));
    expect(html).toContain("Borrada (ya no existe)");
  });

  it("los operadores de un numero y los campos agrupados", () => {
    const fields = offeredFields(groups);
    const html = renderToStaticMarkup(
      createElement(ConditionBuilder, { value: { rootConjunction: "and", conditions: [{ field: "contact.tags", operator: "includes_any", valueType: "multi_select", values: ["vip"] }], groups: [] }, onChange: () => {}, fields, recognized: recognizedFields(groups) }),
    );
    expect(html).toContain("<optgroup");
    expect(html).toContain("incluye alguna de");
    expect(html).toContain('type="checkbox"');
  });

  it("el envoltorio de Formularios sigue dibujando las reglas de siempre", () => {
    const html = renderToStaticMarkup(
      createElement(VisibilityRuleBuilder, {
        value: { rootConjunction: "or", conditions: [{ id: "c_1", fieldKey: "edad", operator: "gte", value: "18" }, { id: "c_2", fieldKey: "edad", operator: "is_empty", value: "" }], groups: [{ id: "g_1", conjunction: "and", conditions: [{ id: "c_3", fieldKey: "plan", operator: "includes_any", value: "a, b" }] }] },
        onChange: () => {},
        sources: [{ key: "edad", label: "Edad", type: "number" }, { key: "plan", label: "Plan", type: "single_select", options: ["a", "b"] }],
      }),
    );
    expect(html).toContain("Mostrar si");
    expect(html).toContain("es mayor o igual a");
    expect(html).toContain("Agregar grupo");
    expect(html).toContain('placeholder="a, b, c"');
    expect(html).toContain("Grupo: cumple");
  });

  it("sin campos antes avisa lo de siempre", () => {
    const html = renderToStaticMarkup(createElement(VisibilityRuleBuilder, { value: undefined, onChange: () => {}, sources: [] }));
    expect(html).toContain("Para usar condiciones tiene que haber campos antes que este.");
  });
});

describe("el editor completo", () => {
  const base = {
    screen: "forms" as const,
    backHref: null,
    routeForHeader: "/dashboard/formularios/f1/automatizaciones/x",
    flowId: "22222222-2222-4222-8222-222222222222",
    flowName: "Aplicación · Automatización 1",
    trigger: { type: "form_submitted", config: { triggerType: "form_submitted" } },
    enabled: false,
    variableKeys: ["form.name"],
    variableExample: "answer.nombre",
    describeTrigger: () => "Se envía un formulario en «Aplicación»",
    onSave: async () => ({ ok: true as const }),
    onSendTest: async () => ({ ok: true as const }),
  };

  it("arriba el Cuándo, despues el Solo si… con su frase, los pasos y los botones", () => {
    const html = renderToStaticMarkup(
      createElement(StepTreeEditor, {
        ...base,
        tree: TREE,
        onlyIf: { sources: [{ key: "edad", label: "Edad", type: "number" as const }], value: undefined },
      }),
    );
    const order = ["Cuándo", "Solo si…", "Pasos", "Variables"].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("Si no se cumple, el flujo no arranca. Para hacer cosas distintas según la respuesta, usá el paso Condiciones.");
    expect(html).toContain("Se envía un formulario en «Aplicación»");
    expect(html).toContain("Guardar");
    expect(html).toContain("Enviarme una prueba");
    expect(html).toContain("cada email tiene su propio");
    expect(html).toContain("Abrir en el canvas");
  });

  it("la Agenda no tiene Solo si…", () => {
    const html = renderToStaticMarkup(createElement(StepTreeEditor, { ...base, screen: "agenda", tree: { ...TREE, steps: [email("a")] }, reach: 3, describeReach: (n: number) => `Hoy alcanzaría a ${n}` }));
    expect(html).not.toContain("Solo si…");
    expect(html).toContain("Hoy alcanzaría a 3");
  });

  it("si el flujo no es un arbol: solo lectura, con el aviso y sin Guardar ni pasos", () => {
    const html = renderToStaticMarkup(createElement(StepTreeEditor, { ...base, tree: null }));
    expect(html).toContain("no se puede editar como lista de pasos");
    expect(html).toContain("Abrir en el canvas");
    expect(html).not.toContain("Guardar");
    expect(html).not.toContain("Agregar paso");
    expect(html).toContain("Se envía un formulario en «Aplicación»");
  });

  it("sin preguntas publicadas el Solo si… lo explica", () => {
    const html = renderToStaticMarkup(createElement(StepTreeEditor, { ...base, tree: TREE, onlyIf: { sources: [], value: undefined } }));
    expect(html).toContain("todavía no tiene preguntas publicadas");
  });
});
